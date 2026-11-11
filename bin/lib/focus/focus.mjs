/**
 * focus/focus — purpose-driven collapse: keep the sections of a document
 * that serve a stated purpose, collapse the rest to a TL;DR reveal.
 *
 * This module owns the DECISIONS; the CLI owns the environment. Every
 * side-effectful capability is injected via `deps`:
 *
 *   deps.classifier  async (input, questions) -> { [qid]: {type, value, probability} }
 *                    questions: [{id, type: boolean|choice|score,
 *                                 instructions, options?|levels?}]
 *   deps.summarizer  async ({heading, text?, mode: generic|tweak|note,
 *                            prior?, diff?, task?}) -> string
 *   deps.cache       the focus/cache.mjs shape
 *   deps.clock       () -> epoch ms
 *   deps.log         (line) -> void (verbose tracing)
 *
 * Tests substitute fakes; `--dry-run` swaps the real deps for recorders.
 * Pipeline (per spec):
 *   1. task match — exact normalized purpose reuse, else top-5
 *      token-Jaccard neighbours through one :choice classifier question;
 *      probability >= matchThreshold reuses the task, else a new one.
 *   2. TL;DR per section — authored tldr wins; then cache by content sha;
 *      then drift check against the prior sha recorded in the document
 *      index (one batched :boolean question per drifted section: "does
 *      this change alter the summary?" — no rebinds the prior entry,
 *      yes runs the tweak prompt); no prior -> generic summary.
 *   3. relevance — ONE batched :score question (10-level rubric) over
 *      every section lacking a note for this task; pinned / hard-rule /
 *      --keep sections are always relevant.
 *   4. --track-refs — sha256 file references carried in section entries;
 *      a changed file counts as drift.
 */

import { sha256, sha12 } from './cache.mjs';

export class FocusError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FocusError';
  }
}

/* ------------------------------------------------------------------ *
 * Purpose normalization + task similarity
 * ------------------------------------------------------------------ */

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizePurpose(purpose) {
  return String(purpose || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(norm) {
  return norm ? norm.split(' ').filter(Boolean) : [];
}

/** Token Jaccard similarity in [0, 1]. */
export function jaccard(aTokens, bTokens) {
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/* ------------------------------------------------------------------ *
 * Small inline LCS line diff (no dependency)
 * ------------------------------------------------------------------ */

const DIFF_MAX_LINES = 2000;

/**
 * Unified-ish diff of two texts: `@@` hunk headers with `-`/`+`/` `
 * lines. Inputs are capped; oversized inputs degrade to whole-file
 * -/+ blocks rather than an O(n*m) blow-up.
 */
export function unifiedDiff(aText, bText, context = 2) {
  const aLines = String(aText || '').split('\n');
  const bLines = String(bText || '').split('\n');
  const capped =
    aLines.length > DIFF_MAX_LINES || bLines.length > DIFF_MAX_LINES;
  if (capped) {
    return [
      `@@ -1,${aLines.length} +1,${bLines.length} @@ (input truncated)`,
      ...aLines.slice(0, 20).map((l) => '-' + l),
      '(…truncated…)',
      ...bLines.slice(0, 20).map((l) => '+' + l)
    ].join('\n');
  }
  // LCS table
  const n = aLines.length;
  const m = bLines.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = aLines[i] === bLines[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      ops.push([' ', aLines[i]]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push(['-', aLines[i++]]);
    } else {
      ops.push(['+', bLines[j++]]);
    }
  }
  while (i < n) ops.push(['-', aLines[i++]]);
  while (j < m) ops.push(['+', bLines[j++]]);
  return formatHunks(ops, context);
}

function formatHunks(ops, context) {
  const changed = [];
  for (let k = 0; k < ops.length; k++) if (ops[k][0] !== ' ') changed.push(k);
  if (!changed.length) return '';
  // Group changes separated by <= 2*context unchanged lines into one hunk.
  const groups = [];
  let group = [changed[0]];
  for (let x = 1; x < changed.length; x++) {
    if (changed[x] - group[group.length - 1] <= 2 * context) group.push(changed[x]);
    else {
      groups.push(group);
      group = [changed[x]];
    }
  }
  groups.push(group);
  const aNum = [];
  const bNum = [];
  let aLine = 1;
  let bLine = 1;
  for (const [op] of ops) {
    aNum.push(aLine);
    bNum.push(bLine);
    if (op === ' ') {
      aLine++;
      bLine++;
    } else if (op === '-') aLine++;
    else bLine++;
  }
  const out = [];
  for (const g of groups) {
    const start = Math.max(0, g[0] - context);
    const end = Math.min(ops.length - 1, g[g.length - 1] + context);
    let aCount = 0;
    let bCount = 0;
    const body = [];
    for (let i2 = start; i2 <= end; i2++) {
      const [op, text] = ops[i2];
      body.push(op + text);
      if (op !== '+') aCount++;
      if (op !== '-') bCount++;
    }
    out.push(`@@ -${aNum[start]},${aCount} +${bNum[start]},${bCount} @@`);
    out.push(...body);
  }
  return out.join('\n');
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function collapse(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/** The --no-llm / dry-run fallback: first ~90 chars at a word boundary. */
export function first90(text) {
  const s = collapse(text);
  if (s.length <= 90) return s;
  const cut = s.slice(0, 89);
  const sp = cut.lastIndexOf(' ');
  return (sp > 40 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '') + '…';
}

function mintTaskId(norm, tasks) {
  const base = 't-' + sha256(norm).slice(0, 10);
  const taken = new Set(tasks.map((t) => t.task_id));
  if (!taken.has(base)) return base;
  let k = 2;
  while (taken.has(base + '-' + k)) k++;
  return base + '-' + k;
}

/** Backticked or bare paths with a slash + extension that exist on disk. */
export function findRefs(text, { cwd, exists }) {
  const out = [];
  const seen = new Set();
  const backticked = String(text || '').match(/`([^`\n]+)`/g) || [];
  const candidates = [];
  for (const b of backticked) candidates.push(b.slice(1, -1).trim());
  const bare = String(text || '').match(/(?:^|[\s(`])((?:\.{1,2}\/)?[\w.-]+(?:\/[\w.-]+)+\.[\w]{1,8})(?=[\s).,!?:;]|$)/g) || [];
  for (const b of bare) candidates.push(b.trim().replace(/^[\s(`]/, ''));
  for (const c of candidates) {
    if (!c || !c.includes('/') || c.includes(' ') || seen.has(c)) continue;
    seen.add(c);
    const abs = c.startsWith('/') ? c : cwd ? cwd + '/' + c : c;
    if (exists(abs)) out.push({ path: c, sha256: null });
  }
  return out;
}

function refsChanged(oldRefs, newRefs) {
  if (!oldRefs || !oldRefs.length) return false;
  if (!newRefs || !newRefs.length) return true;
  const map = new Map(newRefs.map((r) => [r.path, r.sha256]));
  for (const r of oldRefs) {
    const now = map.get(r.path);
    if (now === undefined) return true; // reference vanished from the section
    if (r.sha256 && now && r.sha256 !== now) return true;
  }
  return false;
}

const RUBRIC = [
  { label: 'not relevant', score: 0 },
  { label: 'marginal', score: 1 / 9 },
  { label: 'low relevance', score: 2 / 9 },
  { label: 'partial relevance', score: 3 / 9 },
  { label: 'moderately relevant', score: 4 / 9 },
  { label: 'relevant', score: 5 / 9 },
  { label: 'clearly relevant', score: 6 / 9 },
  { label: 'highly relevant', score: 7 / 9 },
  { label: 'critical', score: 8 / 9 },
  { label: 'essential', score: 1 }
];

/* ------------------------------------------------------------------ *
 * focus()
 * ------------------------------------------------------------------ */

/**
 * Run the focus pipeline over `doc`. Returns
 *   { taskId, taskReused, sections: [{id, heading, kind?, relevant, score,
 *     tldr, note?, collapsed}], stats: {classifier_calls, summarizer_calls,
 *     cache_hits}, planned? }
 * Rendering lives in renderFocus(); write-back in writeBack().
 *
 * @param doc {path: string|null, sections: [{id, heading, level, kind?,
 *        tags?, tldr?, pinned, text, raw?, html?}]}
 * @param opts {purpose, threshold, matchThreshold, keep[], notes, trackRefs,
 *        noLlm, refresh, dryRun, verbose, model, fileLabel, cwd, exists, readFile}
 * @param deps {classifier, summarizer, cache, clock, log}
 */
export async function focus(doc, opts, deps) {
  const stats = { classifier_calls: 0, summarizer_calls: 0, cache_hits: 0 };
  const planned = [];
  const log = (line) => {
    if (opts.verbose && deps.log) deps.log(line);
  };
  const clockMs = () => (deps.clock ? deps.clock() : Date.now());
  const iso = () => new Date(clockMs()).toISOString();

  const norm = normalizePurpose(opts.purpose);
  if (!norm) throw new FocusError('--purpose must be non-empty');
  if (!doc.sections.length) throw new FocusError('document has no sections — nothing to focus');

  const classifier = opts.noLlm ? null : deps.classifier;
  const summarizer = opts.noLlm ? null : deps.summarizer;
  const record = (kind, payload) => {
    planned.push({ kind, ...payload });
  };

  /* ---- 1. task match ---- */

  const cache = deps.cache;
  const tasks = cache.loadTasks();
  let task = tasks.find((t) => t.normalized === norm);
  let taskReused = !!task;
  if (!task && classifier) {
    const ranked = tasks
      .map((t) => ({ t, j: jaccard(tokenize(norm), tokenize(t.normalized)) }))
      .filter((x) => x.j > 0)
      .sort((a, b) => b.j - a.j)
      .slice(0, 5);
    if (ranked.length) {
      const questions = [
        {
          id: 'task-match',
          type: 'choice',
          instructions:
            'The input is a purpose statement. Which prior task is the SAME request? ' +
            'Answer "none" only when no option is the same request.',
          options: [
            ...ranked.map((x) => ({ id: x.t.task_id, label: x.t.purpose })),
            { id: 'none', label: 'none of these' }
          ]
        }
      ];
      record('classifier', { call: 'choice:task-match', input: norm, questions });
      stats.classifier_calls++;
      const answers = await classifier(norm, questions);
      const a = answers['task-match'];
      if (a && a.value && a.value !== 'none' && (a.probability === undefined || a.probability >= opts.matchThreshold)) {
        task = tasks.find((t) => t.task_id === a.value) || null;
        if (task) {
          taskReused = true;
          if (!opts.dryRun) cache.bumpTask(task.task_id);
        }
      }
    }
  }
  if (!task) {
    task = {
      task_id: mintTaskId(norm, tasks),
      purpose: opts.purpose,
      normalized: norm,
      created: iso(),
      hits: 0
    };
    if (!opts.dryRun) cache.appendTask(task);
  }

  /* ---- 2. TL;DR per section ---- */

  const pathKey = sha256(doc.path || 'stdin:-');
  const index = opts.refresh ? null : cache.getIndex(pathKey);
  const indexSections = index && index.sections ? { ...index.sections } : {};
  const exists = opts.exists || (() => false);
  const readFile = opts.readFile || (() => null);

  const plan = doc.sections.map((sec) => {
    const e = {
      sec,
      key: sha256(collapse(sec.text)),
      source: 'miss',
      tldr: undefined,
      entry: null,
      prior: null,
      diff: null
    };
    if (sec.tldr) {
      e.tldr = sec.tldr;
      e.source = 'authored';
      return e;
    }
    const cached = opts.refresh ? null : cache.getSection(e.key);
    if (cached) {
      stats.cache_hits++;
      e.tldr = cached.tldr;
      e.entry = cached;
      e.source = 'cache';
      log(`cache: hit sections/${e.key.slice(0, 12)} (${sec.id})`);
      if (opts.trackRefs && Array.isArray(cached.refs) && cached.refs.length) {
        const current = hashRefs(findRefs(sec.text, { cwd: opts.cwd, exists }), readFile);
        if (refsChanged(cached.refs, current)) {
          e.source = 'refs-drift';
          e.currentRefs = current;
          log(`cache: refs drifted (${sec.id})`);
        }
      }
      return e;
    }
    log(`cache: miss sections/${e.key.slice(0, 12)} (${sec.id})`);
    const priorSha = indexSections[sec.id];
    const prior = priorSha && priorSha !== e.key ? cache.getSection(priorSha) : null;
    if (prior && typeof prior.tldr === 'string') {
      e.prior = prior;
      e.diff = unifiedDiff(prior.source_snapshot || '', sec.text);
      e.source = 'drift';
    }
    return e;
  });

  // One batched :boolean round over every drift candidate.
  const drifters = plan.filter((e) => e.source === 'drift' || e.source === 'refs-drift');
  if (drifters.length && classifier) {
    const questions = drifters.map((e) => ({
      id: 'drift:' + e.sec.id,
      type: 'boolean',
      instructions:
        `Section "${e.sec.heading}" changed since its summary ("${e.prior ? e.prior.tldr : e.tldr}") was written. ` +
        `Does this change alter the summary?\n\n` +
        (e.source === 'refs-drift'
          ? 'A file referenced by this section changed on disk.'
          : `Unified diff:\n${truncate(e.diff, 2000)}`)
    }));
    record('classifier', { call: 'boolean:drift', input: norm, questions });
    stats.classifier_calls++;
    const answers = await classifier(norm, questions);
    for (const e of drifters) {
      const a = answers['drift:' + e.sec.id];
      const alters = a ? a.value === true : true;
      e.source = alters ? 'tweak' : 'rebind';
      if (!alters && e.prior) e.tldr = e.prior.tldr; // rebind carries the prior summary forward
      log(`cache: ${e.source} (${e.sec.id})`);
    }
  }

  // Generic / tweak summaries (independent — run together).
  const pending = plan.filter((e) => !e.tldr && (e.source === 'tweak' || e.source === 'miss'));
  if (pending.length && summarizer) {
    await Promise.all(
      pending.map(async (e) => {
        if (e.source === 'tweak') {
          record('summarizer', { call: 'tweak', id: e.sec.id, prior: e.prior.tldr, diff: truncate(e.diff, 2000) });
          stats.summarizer_calls++;
          e.tldr = await summarizer({
            heading: e.sec.heading,
            mode: 'tweak',
            prior: e.prior.tldr,
            diff: e.diff,
            text: e.sec.text
          });
        } else {
          record('summarizer', { call: 'generic', id: e.sec.id });
          stats.summarizer_calls++;
          e.tldr = await summarizer({
            heading: e.sec.heading,
            mode: 'generic',
            text: e.sec.text
          });
        }
        e.entry = {
          tldr: e.tldr,
          generic: e.source === 'miss',
          model: opts.model || '',
          generated_at: iso(),
          source_snapshot: e.sec.text
        };
      })
    );
  }

  // Fallbacks + cache writes.
  for (const e of plan) {
    if (!e.tldr) {
      e.tldr = first90(e.sec.text);
      e.source = 'fallback';
    }
    if (opts.dryRun) continue;
    if (e.source === 'authored' || e.source === 'cache') continue;
    if (e.source === 'rebind') {
      cache.putSection(e.key, {
        tldr: e.prior.tldr,
        generic: !!e.prior.generic,
        model: e.prior.model || '',
        generated_at: iso(),
        source_snapshot: e.sec.text,
        ...(opts.trackRefs ? { refs: e.currentRefs || [] } : {})
      });
    } else if (e.entry) {
      if (opts.trackRefs) e.entry.refs = hashRefs(findRefs(e.sec.text, { cwd: opts.cwd, exists }), readFile);
      cache.putSection(e.key, e.entry);
    }
    indexSections[e.sec.id] = e.key;
  }
  if (!opts.dryRun) {
    cache.putIndex(pathKey, { path: doc.path || 'stdin:-', sections: indexSections });
  }

  /* ---- 3. relevance (one batched :score round) ---- */

  const keepSet = new Set(opts.keep || []);
  const results = plan.map((e) => ({
    id: e.sec.id,
    heading: e.sec.heading,
    level: e.sec.level,
    kind: e.sec.kind,
    tags: e.sec.tags,
    tldr: e.tldr,
    source: e.source,
    pinned: !!e.sec.pinned,
    collapsed: false,
    relevant: false,
    score: undefined,
    note: undefined
  }));
  const byId = new Map(results.map((r) => [r.id, r]));

  const noNote = plan.filter((e) => opts.refresh || !cache.getNote(task.task_id, e.key));
  for (const e of plan) {
    if (noNote.includes(e)) continue;
    const note = cache.getNote(task.task_id, e.key);
    if (note) {
      stats.cache_hits++;
      const r = byId.get(e.sec.id);
      r.score = note.score;
      r.note = note.note;
      r.relevant = !!note.relevant;
      log(`cache: hit notes/${task.task_id}/${e.key.slice(0, 12)} (${e.sec.id})`);
    }
  }

  if (noNote.length && classifier) {
    const questions = noNote.map((e) => ({
      id: 'rel:' + e.sec.id,
      type: 'score',
      instructions:
        `How relevant is this section to the input purpose? ` +
        `Section: "${e.sec.heading}". Summary: ${e.tldr}`,
      levels: RUBRIC
    }));
    record('classifier', { call: 'score:relevance', input: norm, questions });
    stats.classifier_calls++;
    const answers = await classifier(norm, questions);
    for (const e of noNote) {
      const r = byId.get(e.sec.id);
      const a = answers['rel:' + e.sec.id];
      const score = a && typeof a.value === 'number' ? a.value : undefined;
      r.score = score;
      const relevant = e.sec.pinned || keepSet.has(e.sec.id) || (score !== undefined && score >= opts.threshold);
      r.relevant = relevant;
      const noteEntry = {
        score,
        relevant,
        model: opts.classifierModel || '',
        at: iso()
      };
      if (opts.notes && relevant && summarizer) {
        record('summarizer', { call: 'note', id: e.sec.id, task: task.task_id });
        stats.summarizer_calls++;
        noteEntry.note = await summarizer({
          heading: e.sec.heading,
          mode: 'note',
          task: opts.purpose,
          text: e.sec.text
        });
        r.note = noteEntry.note;
      }
      if (!opts.dryRun) cache.putNote(task.task_id, e.key, noteEntry);
    }
  }

  // Fail-open relevance: no classifier (or no answer) ⇒ relevant. A cached
  // or fresh note already decided; a score below threshold stays collapsed.
  for (const r of results) {
    if (r.pinned || keepSet.has(r.id)) {
      r.relevant = true;
    } else if (r.score === undefined && r.relevant !== true) {
      r.relevant = true;
    }
  }

  /* ---- 4. render ---- */

  for (const e of plan) {
    const r = byId.get(e.sec.id);
    r.collapsed = !r.relevant;
  }

  return {
    taskId: task.task_id,
    taskReused,
    taskPurpose: task.purpose,
    sections: results,
    stats,
    planned: opts.dryRun ? planned : undefined
  };
}

function hashRefs(refs, readFile) {
  return refs.map((r) => ({
    path: r.path,
    sha256: readFile ? sha256(String(readFile(r.path) ?? '')) : null
  }));
}

function truncate(s, max) {
  s = String(s || '');
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

const REVEAL_HINT = 'collapsed — semtext expand <file> <id>';

/**
 * Render a focus() result. Returns { text, json } — the CLI picks the
 * payload for the requested format (`json` sections are pre-shaped).
 */
export function renderFocus(result, doc, opts) {
  const format = opts.format || 'md';
  const notesList = result.sections.filter((s) => s.note);
  const footnoteId = (id) => 'fn-' + id;

  if (format === 'json') {
    return {
      text: null,
      json: {
        task_id: result.taskId,
        task_reused: result.taskReused,
        sections: result.sections.map((s) => ({
          id: s.id,
          heading: s.heading,
          ...(s.kind !== undefined ? { kind: s.kind } : {}),
          relevant: s.relevant,
          ...(s.score !== undefined ? { score: s.score } : {}),
          tldr: s.tldr,
          ...(s.note ? { note: s.note } : {})
        })),
        stats: result.stats
      }
    };
  }

  const out = [];
  for (const s of result.sections) {
    const sec = doc.sections.find((x) => x.id === s.id) || {};
    const hint = REVEAL_HINT.replace('<file>', opts.fileLabel || '<file>').replace('<id>', s.id);
    if (format === 'html') {
      if (s.relevant && !s.collapsed) {
        out.push(sec.html || `<sem-md id="${s.id}">\n${trimTrailing(sec.text || '')}\n</sem-md>`);
        if (s.note) out.push(`<sem-references kind="footnotes"><p id="${footnoteId(s.id)}">${escapeHtml(s.note)}</p></sem-references>`);
      } else {
        const head = `<h${clampLevel(s.level)}> ${escapeHtml(s.heading)}</h${clampLevel(s.level)}>`;
        out.push(`<sem-reveal summary="${escapeAttr(s.tldr || '')}" collapsed>\n${head}\n</sem-reveal><!-- ${hint} -->`);
      }
      continue;
    }
    if (format === 'text') {
      if (s.relevant && !s.collapsed) {
        out.push(trimTrailing(sec.text || s.heading));
        if (s.note) out.push(`note: ${s.note}`);
      } else {
        out.push(`${'#'.repeat(clampLevel(s.level))} ${s.heading}\n  TL;DR: ${s.tldr}\n  (${hint})`);
        if (s.note) out.push(`  note: ${s.note}`);
      }
      continue;
    }
    // markdown (default)
    if (s.relevant && !s.collapsed) {
      out.push(trimTrailing(sec.raw || sec.text || s.heading));
    } else {
      const head = `${'#'.repeat(clampLevel(s.level))} ${s.heading}`;
      out.push(`${head}\n> TL;DR: ${s.tldr}  (${hint})`);
    }
    if (s.note) out.push(`[^${footnoteId(s.id)}]: ${s.note}`);
  }
  return { text: out.join('\n\n') + '\n', json: null };
}

function clampLevel(level) {
  return Math.min(6, Math.max(1, Number(level) || 1));
}

function trimTrailing(s) {
  return String(s || '').replace(/\s+$/, '');
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------------ *
 * Write-back
 * ------------------------------------------------------------------ */

/**
 * In-place TL;DR maintenance for .sem.md documents: insert or refresh
 * `<sem-tldr data-auto data-digest="…">` under every section heading that
 * lacks an AUTHORED tldr. Idempotent — identical digests are left alone;
 * changed summaries replace the auto block in place. Returns
 * { source, changed, writes: [{id, line}] }.
 *
 * `entries`: [{id, tldr}] — only sections that should carry an auto tldr
 * (focus result entries whose source is NOT 'authored').
 * `md`: { parseMarkdownSections, flattenSections } — the markdown-sections
 * module (from the built agent bundle in the CLI, the TS source in tests).
 */
export function writeBack(source, entries, md) {
  const { sections } = md.parseMarkdownSections(source);
  const byId = new Map(entries.map((e) => [e.id, e.tldr]));
  const flat = md.flattenSections(sections).filter((s) => byId.has(s.id) && !s.tldr);
  if (!flat.length) return { source, changed: false, writes: [] };
  const lines = source.split('\n');
  const writes = [];
  // Bottom-up: earlier insertions never shift later line numbers.
  for (const sec of flat.slice().reverse()) {
    const tldr = byId.get(sec.id);
    const digest = sha12(tldr);
    const block = `<sem-tldr data-auto data-digest="${digest}">${tldr}</sem-tldr>`;
    const idx = sec.line - 1; // 0-based heading line
    if (sec.autoTldrLine > 0) {
      const existing = lines[sec.autoTldrLine - 1];
      if (existing === block) continue;
      lines[sec.autoTldrLine - 1] = block;
      writes.push({ id: sec.id, line: sec.autoTldrLine, refreshed: true });
      continue;
    }
    // Insert directly under the heading (a marker line stays first if present).
    let at = idx + 1;
    while (at < lines.length && !lines[at].trim()) at++;
    if (at < lines.length && /<sem-section\b/.test(lines[at])) at++;
    lines.splice(at, 0, block);
    writes.push({ id: sec.id, line: at + 1, refreshed: false });
  }
  return { source: lines.join('\n'), changed: writes.length > 0, writes };
}
