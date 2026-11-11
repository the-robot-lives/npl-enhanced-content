/**
 * focus/cli — shared front-end glue for `semtext focus` /
 * `semtext-agent focus`.
 *
 * Both CLIs call runFocus() with their own IO seams; this module owns
 * the whole pipeline assembly: document loading (markdown vs SemText
 * XHTML), config + provider settings resolution (credential checks that
 * name env vars — never values), cache wiring, dep construction for the
 * three run modes (real / --no-llm / --dry-run), rendering, and the
 * opt-in --write-back / --write-notes source surgery.
 *
 * Errors carry `focusKind` ('usage' | 'domain') so each CLI maps them to
 * its own exit-code contract (pipe: 1/1; agent: 2/1).
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { focus, renderFocus, writeBack } from './focus.mjs';
import { makeCache } from './cache.mjs';
import { classify } from './systemone.mjs';
import { summarize } from './summarize.mjs';
import {
  effectiveConfig,
  classifierSettings,
  summarizerSettings,
  settingsReady,
  settingsHint,
  cacheRoot
} from './config.mjs';

export class FocusUsage extends Error {
  constructor(m) {
    super(m);
    this.name = 'FocusUsage';
    this.focusKind = 'usage';
  }
}

export class FocusDomain extends Error {
  constructor(m) {
    super(m);
    this.name = 'FocusDomain';
    this.focusKind = 'domain';
  }
}

export const FOCUS_FORMATS = ['md', 'html', 'text', 'json'];

export const FOCUS_HELP = `focus <file|-> --purpose "<text>" [options]

Purpose-driven collapse: sections that serve the purpose stay verbatim,
the rest collapse to a TL;DR reveal.

  --purpose TEXT      the task this reading serves (required)
  --threshold N       relevance cut on the 0..1 rubric (default 0.5)
  --match-threshold N task-match cut on choice probability (default 0.8)
  --format F          md | html | text | json (default: md for .md input,
                      html for .html input)
  --keep ID[,ID]      never collapse these section ids
  --notes             add a one-line task footnote per relevant section
  --track-refs        cache file references per section; a changed file
                      counts as content drift
  --write-back        insert/refresh <sem-tldr data-auto> in the .md file
  --write-notes       also append the task footnote block (--write-back implied)
  --classifier NAME   alibaba | jev (default: config or alibaba)
  --model M           summarizer model override (default qwen3.8-flash)
  --cache-dir DIR     override the cache root ($SEMTEXT_CACHE_DIR,
                      default ~/.cache/semtext)
  --config FILE       config file override (~/.config/semtext/config.yaml)
  --no-llm            cache-only: missing tldr -> first-90-chars fallback,
                      unknown relevance -> keep the section
  --refresh           ignore cached entries, rewrite them
  --dry-run           print the planned classifier/summarizer calls as
                      JSON, touch no network and no cache
  --verbose           per-section cache hit/miss lines on stderr`;

/**
 * Run the whole focus command. `core` is the built SemTextAgent bundle
 * (the markdown-sections re-exports live there); `parseRoot` parses
 * XHTML into a DOM root (the CLI owns happy-dom); `opts` the parsed
 * flags; `stderr` a line sink; `guardPath` the CLI's workspace-path
 * guard for --write-back. Returns { format, payload, json, wrote, result }.
 */
export async function runFocus({ core, parseRoot = null, opts, env = process.env, stderr = () => {}, guardPath = null }) {
  // The CLIs set dashed flags verbatim; normalize to the camelCase names
  // the pipeline reads (dashed keys stay the source of truth).
  opts = {
    ...opts,
    noLlm: opts.noLlm ?? opts['no-llm'],
    dryRun: opts.dryRun ?? opts['dry-run'],
    trackRefs: opts.trackRefs ?? opts['track-refs'],
    writeBack: opts.writeBack ?? opts['write-back'],
    writeNotes: opts.writeNotes ?? opts['write-notes']
  };
  const file = opts._[0];
  if (!file) throw new FocusUsage('focus needs a file (or "-" for stdin)');
  if (opts.purpose === undefined || String(opts.purpose).trim() === '') {
    throw new FocusUsage('focus needs --purpose "<text>"');
  }
  if (opts.format !== undefined && !FOCUS_FORMATS.includes(opts.format)) {
    throw new FocusUsage('--format must be md | html | text | json');
  }
  const source = readInput(file);
  const isMd = core.isMarkdownSource(source, file === '-' ? null : file);

  const cfg = effectiveConfig({
    file: opts.config,
    env,
    flags: {
      classifier: opts.classifier,
      threshold: opts.threshold,
      matchThreshold: opts['match-threshold'],
      model: opts.model
    }
  });
  const cls = classifierSettings(cfg, cfg.classifier, env);
  const sum = summarizerSettings(cfg, env);
  if (!opts.noLlm && !opts.dryRun) {
    if (!settingsReady(cls)) {
      throw new FocusDomain(
        `focus: classifier "${cfg.classifier}" is not configured — ${settingsHint(cls)} (or rerun with --no-llm)`
      );
    }
    if (!settingsReady(sum)) {
      throw new FocusDomain(`focus: summarizer is not configured — ${settingsHint(sum)} (or rerun with --no-llm)`);
    }
  }

  const cache = makeCache(cacheRoot(opts, env));
  const cwd = process.cwd();
  const exists = (p) => {
    try {
      return existsSync(p) && statSync(p).isFile();
    } catch {
      return false;
    }
  };
  const readFileForRefs = (p) => {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      return null;
    }
  };

  let doc;
  let format = opts.format;
  if (isMd) {
    if (!format) format = 'md';
    const parsed = core.parseMarkdownSections(source);
    doc = {
      path: file === '-' ? null : resolve(file),
      sections: core.flattenSections(parsed.sections).map((s) => ({
        id: s.id,
        heading: s.heading,
        level: s.level,
        kind: s.kind,
        tags: s.tags,
        tldr: s.tldr,
        pinned: s.pinned,
        // Body without the section's own heading line and without nested
        // sections (they carry their own summaries) — the heading travels
        // separately (prompts, rendering) and must not pollute TL;DRs.
        text: s.ownText,
        raw: s.raw
      }))
    };
  } else {
    if (!format) format = 'html';
    if (!parseRoot) throw new FocusDomain('XHTML input needs a DOM parser (happy-dom)');
    doc = htmlFocusDoc(core, parseRoot(source), file);
  }

  const deps = opts.dryRun
    ? {
        // Record-only: focus() logs every call it WOULD make into result.planned.
        classifier: async () => ({}),
        summarizer: async () => '',
        cache,
        clock: () => Date.now(),
        log: stderr
      }
    : {
        classifier: (input, questions) => classify({ settings: cls, input, questions }),
        summarizer: (args) =>
          summarize({
            settings: sum,
            text: args.text,
            heading: args.heading,
            mode: args.mode,
            prior: args.prior,
            diff: args.diff,
            task: args.task
          }),
        cache,
        clock: () => Date.now(),
        log: stderr
      };

  const focusOpts = {
    purpose: String(opts.purpose),
    threshold: cfg.threshold,
    matchThreshold: cfg.matchThreshold,
    keep: opts.keep ? String(opts.keep).split(/[,\s]+/).filter(Boolean) : [],
    notes: !!opts.notes,
    trackRefs: !!opts.trackRefs,
    noLlm: !!opts.noLlm,
    refresh: !!opts.refresh,
    dryRun: !!opts.dryRun,
    verbose: !!opts.verbose,
    model: sum.model,
    classifierModel: cls.model,
    fileLabel: file === '-' ? '<stdin>' : file,
    cwd,
    exists: opts.trackRefs ? exists : undefined,
    readFile: opts.trackRefs ? readFileForRefs : undefined
  };

  const result = await focus(doc, focusOpts, deps);

  if (opts.dryRun) {
    return {
      format: 'json',
      json: true,
      payload: { planned_calls: result.planned, stats: result.stats },
      wrote: null,
      result
    };
  }

  const rendered = renderFocus(result, doc, { format });
  const wantJson = opts.json || format === 'json';
  const payload = wantJson
    ? rendered.json || {
        task_id: result.taskId,
        task_reused: result.taskReused,
        sections: result.sections,
        stats: result.stats
      }
    : rendered.text;

  // --write-back / --write-notes: source surgery on .md documents only.
  let wrote = null;
  if (opts.writeBack || opts.writeNotes) {
    if (!isMd) throw new FocusDomain('--write-back/--write-notes need a .md/.sem.md file');
    if (!file || file === '-') throw new FocusUsage('--write-back needs a file path (not stdin)');
    const entries = result.sections
      .filter((s) => s.source !== 'authored')
      .map((s) => ({ id: s.id, tldr: s.tldr }));
    let next = writeBack(source, entries, core).source;
    if (opts.writeNotes) next = applyNotes(next, result);
    const target = guardPath ? guardPath(file, '--write-back target') : file;
    writeFileSync(target, next);
    wrote = file;
  }

  return { format, payload, json: wantJson, wrote, result };
}

/** HTML documents: sections from the toolkit, text via lazy expand. */
function htmlFocusDoc(core, root, file) {
  const refs = core.collectBlocks(root).filter((r) => r.type === 'section');
  const sections = refs.map((ref) => {
    let text = ref.label;
    try {
      text = core.expand(root, ref.id, 'text').replace(/^\[[^\]\n]*\][^\n]*\n/, '');
    } catch {
      text = ref.label;
    }
    return {
      id: ref.id,
      heading: ref.label,
      level: ref.level,
      kind: undefined,
      tags: undefined,
      tldr: undefined,
      pinned: false,
      text
    };
  });
  return { path: file === '-' ? null : resolve(file), sections };
}

/** Append (or refresh) the task footnote block at the end of the source. */
export function applyNotes(source, result) {
  const marker = `<!-- semtext:focus footnotes task=${result.taskId} -->`;
  const notes = result.sections.filter((s) => s.note);
  let base = source;
  const lines = source.split('\n');
  const at = lines.indexOf(marker);
  if (at >= 0) {
    // Idempotent refresh: strip the previous block for this task first.
    let end = at + 1;
    while (end < lines.length && /^\[\^fn-/.test(lines[end])) end++;
    base = lines.slice(0, at).concat(lines.slice(end)).join('\n').replace(/\n{3,}$/, '\n\n');
  }
  if (!notes.length) return base;
  const block = [marker, ...notes.map((s) => `[^fn-${s.id}]: ${s.note}`)].join('\n');
  return base.replace(/\s*$/, '\n\n') + block + '\n';
}

function readInput(path) {
  if (!path || path === '-') {
    try {
      return readFileSync(0, 'utf8');
    } catch {
      return '';
    }
  }
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    throw new FocusDomain(`${path}: cannot read — ${e.message}`);
  }
}
