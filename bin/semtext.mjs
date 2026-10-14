#!/usr/bin/env node
/**
 * semtext — user-facing CLI: pipes first, terminal browser second.
 *
 * Every pipe command reads a document from a file or stdin (`-`), writes
 * data to stdout ONLY, and never prompts. Errors and "no matches" notes
 * go to stderr. This is the grep-style contract (0 ok · 1 usage/parse
 * error · 2 no matches) and is deliberately different from
 * bin/semtext-agent.mjs, whose agent contract is 0 ok · 1 domain error ·
 * 2 usage error — that CLI predates this one and its `--json` shapes are
 * depended on.
 *
 * Commands:
 *   outline <file|->  [--depth N] [--json]     heading tree
 *   filter  <file|->  [criteria] [--text|--json]
 *                                              matching blocks, normalised
 *   format  <file|->  [--text|--json]          normalised document
 *   view    <file|->                           plain text of the whole document
 *   expand  <file|-> <id> [--format t|x] [--json]
 *   tui     <file>                             interactive terminal browser
 *
 * Pipe examples:
 *   semtext filter --type sem-facts doc.html | semtext format --text
 *   semtext outline doc.html | head -20
 *   semtext filter --attr data-variant=warning doc.html --json | jq '.[].id'
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createState,
  handleKey,
  visibleRows,
  current,
  rawSource
} from '../src/agent/tui-state.js';

const HELP = `semtext — browse, filter and format SemText documents

Usage: semtext <command> [args] [options]

Commands:
  outline <file|->  [--depth N] [--json]   heading tree of the document
  filter  <file|->  [criteria] [--text|--json]
                                           matching blocks as normalised XHTML
  format  <file|->  [--text|--json]        the document, normalised
  view    <file|->                         plain text of the whole document
  expand  <file|-> <id> [--format F] [--json]
                                           one block, in full
  tui     <file>                           interactive terminal browser

Filter criteria (AND-combined):
  --type T         record type (fact / sem-fact / sem-facts / ...)
  --attr N[=V]     attribute present, or equal to V
  --text S         case-insensitive substring of the record text
  --id ID --kind K --tag T --audience A --selector CSS
Output:  --text rendered plain text (format/view) · --json machine-readable
TUI keys: arrows or j/k move · Enter expand/collapse · / search ·
          n next match · r raw source · q quit

Exit codes: 0 ok · 1 usage or parse error · 2 no matches
Errors go to stderr only; pipe commands write data to stdout only.`;

class UsageError extends Error {} // -> 1
class DomainError extends Error {} // -> 1
class NoMatches extends Error {} // -> 2

/* ------------------------------------------------------------------ *
 * Core loading (the built bundle is the single source of truth)
 * ------------------------------------------------------------------ */

function loadCore() {
  const dist = fileURLToPath(new URL('../dist/semtext-agent.js', import.meta.url));
  if (!existsSync(dist)) {
    process.stderr.write('semtext: dist/semtext-agent.js is missing — run `npm run build` first\n');
    process.exit(2);
  }
  const src = readFileSync(dist, 'utf8');
  const factory = new Function(
    src + '\n;return typeof SemTextAgent !== "undefined" ? SemTextAgent : globalThis.SemTextAgent;'
  );
  return factory();
}

let Window = null;
async function ensureHappyDom() {
  if (Window) return;
  try {
    ({ Window } = await import('happy-dom'));
  } catch {
    throw new DomainError('semtext needs the "happy-dom" package — install it (npm i -D happy-dom)');
  }
}

function parseHtml(source) {
  const win = new Window({ settings: { disableCSSFileLoading: true } });
  return new win.DOMParser().parseFromString(source, 'text/html');
}

function readInput(path) {
  if (!path || path === '-') {
    let data = '';
    try {
      data = readFileSync(0, 'utf8');
    } catch {
      data = '';
    }
    if (!data.trim()) throw new DomainError('empty input on stdin (pass a file, or pipe a document)');
    return data;
  }
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    throw new DomainError(`${path}: cannot read — ${e.message}`);
  }
}

function documentRoot(source) {
  const doc = parseHtml(source);
  return (
    doc.querySelector('.sem-enhanced-document, sem-enhanced-document') ||
    doc.body ||
    doc.documentElement
  );
}

function emit(value, json) {
  if (json) {
    process.stdout.write(JSON.stringify(value) + '\n');
    return;
  }
  process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
}

function outlineText(nodes, indent = '') {
  const lines = [];
  for (const n of nodes) {
    const meta = n.blocks > 1 ? ` (${n.blocks - 1} nested)` : '';
    lines.push(`${indent}- [${n.id}] ${n.type}: ${n.summary}${meta}`);
    lines.push(...outlineText(n.children, indent + '  '));
  }
  return lines;
}

/* ------------------------------------------------------------------ *
 * Arguments
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const opts = { _: [] };
  // `--text` is filter's match criteria (takes a value) but format/view's
  // output flag (boolean) — decide from the command, i.e. the first
  // positional token.
  const command = argv.find((a) => !a.startsWith('-'));
  const textTakesValue = command === 'filter';
  const flagWith = new Set([
    '--depth', '--format', '--type', '--id', '--kind', '--tag', '--audience',
    '--attr', '--selector', '--label'
  ]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--text') {
      if (textTakesValue) {
        const v = argv[++i];
        if (v === undefined) {
          throw new UsageError(
            '--text expects a value when filtering (plain-text output: pipe to `semtext format --text`)'
          );
        }
        opts.text = v;
      } else {
        opts.text = true;
      }
    }
    else if (flagWith.has(a)) {
      const v = argv[++i];
      if (v === undefined) throw new UsageError(`${a} expects a value`);
      opts[a.slice(2)] = v;
    } else if (a.startsWith('--') && a !== '--') {
      throw new UsageError(`unknown option "${a}"`);
    } else {
      opts._.push(a);
    }
  }
  return opts;
}

/* ------------------------------------------------------------------ *
 * Pipe commands
 * ------------------------------------------------------------------ */

function commandOutline(core, opts) {
  const [file] = opts._;
  const root = documentRoot(readInput(file));
  let depth = Infinity;
  if (opts.depth !== undefined) {
    depth = Number(opts.depth);
    if (!Number.isFinite(depth) || depth < 1) throw new UsageError('--depth expects a positive number');
  }
  const nodes = core.outline(root, depth);
  if (opts.json) return emit(nodes, true);
  if (!nodes.length) throw new NoMatches('no headings or records in document');
  emit(outlineText(nodes).join('\n'), false);
}

function commandFilter(core, opts) {
  const [file] = opts._;
  const root = documentRoot(readInput(file));
  let blocks;
  try {
    blocks = core.filterBlocks(root, {
      type: opts.type,
      id: opts.id,
      kind: opts.kind,
      tag: opts.tag,
      audience: opts.audience,
      attr: opts.attr,
      selector: opts.selector,
      text: opts.text
    });
  } catch (e) {
    throw new UsageError(e.message);
  }
  if (!blocks.length) throw new NoMatches('no records match the given criteria');
  if (opts.json) {
    emit(blocks.map((b) => ({ id: b.id, idSource: b.idSource, type: b.type, record: b.record })), true);
    return;
  }
  if (opts.text) {
    emit(blocks.map((b) => core.renderRecordsAsText([b.record])).filter(Boolean).join('\n'), false);
    return;
  }
  // Default: normalised XHTML, one block per element — markup goes back
  // down the pipe so `| semtext format` keeps working.
  emit(blocks.map((b) => core.serialize(b.el)).join('\n'), false);
}

function commandFormat(core, opts) {
  const [file] = opts._;
  const root = documentRoot(readInput(file));
  // extractText is not exported from the bundle; compose it.
  const asText = () => core.renderRecordsAsText(core.extractRecords(root));
  if (opts.json) {
    emit({ xhtml: core.serialize(root), text: asText() }, true);
    return;
  }
  if (opts.text) return emit(asText(), false);
  emit(core.serialize(root), false);
}

function commandExpand(core, opts) {
  const [file, id] = opts._;
  if (!id) throw new UsageError('expand needs a block id');
  const format = opts.format || 'text';
  if (format !== 'text' && format !== 'xhtml') throw new UsageError('--format must be "text" or "xhtml"');
  const root = documentRoot(readInput(file));
  let content;
  try {
    content = core.expand(root, id, format);
  } catch (e) {
    if (/no block with id|no such block|not found|unknown/i.test(e.message || '')) throw new NoMatches(e.message);
    throw new DomainError(e.message);
  }
  if (opts.json) return emit({ id, format, content }, true);
  emit(content, false);
}

/* ------------------------------------------------------------------ *
 * TUI runner — the only interactive command; everything it DECIDES
 * lives in src/agent/tui-state.ts (unit-tested without a terminal).
 * ------------------------------------------------------------------ */

function logicalKeys(chunk, pending) {
  // Translate raw stdin bytes into logical keys; returns [keys, rest].
  let s = pending + chunk;
  const keys = [];
  while (s.length) {
    if (s.startsWith('\x1b[A')) { keys.push('up'); s = s.slice(3); continue; }
    if (s.startsWith('\x1b[B')) { keys.push('down'); s = s.slice(3); continue; }
    if (s.startsWith('\x1b')) {
      // Lone ESC (no more bytes buffered) or an unhandled sequence: treat
      // the escape as Esc, drop any sequence bytes we do not know.
      if (s.length === 1) { keys.push('esc'); s = ''; continue; }
      const m = s.slice(1).match(/^[A-Za-z0-9~]/);
      keys.push('esc');
      s = m ? s.slice(2) : s.slice(1);
      continue;
    }
    const c = s[0];
    const code = c.charCodeAt(0);
    if (code === 3) { keys.push('ctrl-c'); s = s.slice(1); continue; }
    if (c === '\r' || c === '\n') { keys.push('enter'); s = s.slice(1); continue; }
    if (code === 127 || code === 8) { keys.push('backspace'); s = s.slice(1); continue; }
    if (code < 32) { s = s.slice(1); continue; } // other control bytes: ignore
    keys.push(c);
    s = s.slice(1);
  }
  return [keys, ''];
}

function paint(state, file) {
  const cols = process.stdout.columns || 80;
  const totalRows = process.stdout.rows || 24;
  const out = [];
  out.push(`\x1b[1m${file}\x1b[0m`);
  if (state.raw) {
    const row = current(state);
    out.push(`raw source — ${row ? row.node.id : '(none)'} (Esc/r to return)`);
    const src = (rawSource(state) || '(no source kept)').split('\n');
    const body = Math.max(1, totalRows - 3);
    out.push(...src.slice(0, body).map((l) => l.slice(0, cols)));
  } else {
    const rows = visibleRows(state);
    const body = Math.max(1, totalRows - 3);
    let start = Math.max(0, Math.min(state.cursor - Math.floor(body / 2), rows.length - body));
    const matchedIds = new Set(state.matches.map((m) => m.node.id));
    const shown = rows.slice(start, start + body);
    for (let i = 0; i < shown.length; i++) {
      const { node, depth } = shown[i];
      const idx = start + i;
      const caret = node.children.length ? (node.expanded ? '▾' : '▸') : '·';
      let line = `${'  '.repeat(depth)}${caret} [${node.id}] ${node.type}: ${node.summary}`;
      if (line.length > cols) line = line.slice(0, cols - 1) + '…';
      if (idx === state.cursor) line = `\x1b[7m${line}\x1b[0m`;
      else if (matchedIds.has(node.id)) line += ' \x1b[36m*\x1b[0m';
      out.push(line);
    }
    for (let i = shown.length; i < body; i++) out.push('');
  }
  const rows = state.raw ? [] : visibleRows(state);
  let status = `[${rows.length ? state.cursor + 1 : 0}/${rows.length}] `;
  if (state.searching) status += `/${state.query}⠀  (${state.matches.length} matches)  `;
  else if (state.query) status += `filter "${state.query}" ${state.matches.length}/${state.matches.length}  `;
  if (state.status) status += `${state.status}  `;
  status += 'j/k move · Enter expand · / search · n next · r raw · q quit';
  out.push(status.slice(0, cols));
  process.stdout.write('\x1b[H\x1b[2J' + out.join('\n') + '\n');
}

async function runTui(core, file) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new UsageError('tui needs an interactive terminal (stdin and stdout must be a TTY)');
  }
  const root = documentRoot(readInput(file));
  const nodes = core.outline(root, Infinity);
  if (!nodes.length) throw new NoMatches('nothing to browse — no headings or records in document');
  // Raw sources materialise lazily: `expand` runs only when a raw view is
  // actually opened for a block.
  const refs = core.collectBlocks(root);
  const ids = new Set(refs.map((r) => r.id));
  class LazySources extends Map {
    has(id) {
      return ids.has(id) || super.has(id);
    }
    get(id) {
      if (!ids.has(id)) return undefined;
      if (!super.has(id)) {
        let src = null;
        try {
          src = core.expand(root, id, 'xhtml');
        } catch {
          src = null;
        }
        super.set(id, src);
      }
      return super.get(id);
    }
  }
  const state = createState(nodes, new LazySources());

  let rawOn = false;
  const restore = () => {
    if (rawOn) {
      try {
        process.stdin.setRawMode(false);
      } catch {}
      rawOn = false;
    }
    process.stdout.write('\x1b[?1049l\x1b[?25h'); // leave alt screen, show cursor
  };
  const onFatal = () => {
    restore();
    process.exit(1);
  };
  process.on('SIGINT', onFatal);
  process.on('SIGTERM', onFatal);
  process.on('uncaughtException', onFatal);

  let pending = '';
  try {
    process.stdout.write('\x1b[?1049h\x1b[?25l'); // alt screen, hide cursor
    process.stdin.setRawMode(true);
    rawOn = true;
    paint(state, file);
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      const [keys, rest] = logicalKeys(String(chunk), pending);
      pending = rest;
      for (const key of keys) {
        handleKey(state, key);
        if (state.shouldQuit) break;
      }
      if (state.shouldQuit) break;
      paint(state, file);
    }
  } finally {
    restore();
    process.removeListener('SIGINT', onFatal);
    process.removeListener('SIGTERM', onFatal);
    process.removeListener('uncaughtException', onFatal);
    process.stdin.pause();
  }
  return 0;
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

export async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`semtext: ${e.message}\n`);
    return 1;
  }
  if (opts.help || argv.length === 0) {
    process.stdout.write(HELP + '\n');
    return 0;
  }
  const [command] = opts._;
  opts._ = opts._.slice(1);
  if (!command) {
    process.stderr.write('semtext: no command given\n');
    return 1;
  }
  try {
    switch (command) {
      case 'tui': {
        const [file] = opts._;
        if (!file || file === '-') throw new UsageError('tui needs a file (stdin is not browsable)');
        const core = loadCore();
        await ensureHappyDom();
        return await runTui(core, file);
      }
      default: {
        const core = loadCore();
        await ensureHappyDom();
        switch (command) {
          case 'outline':
            commandOutline(core, opts);
            return 0;
          case 'filter':
            commandFilter(core, opts);
            return 0;
          case 'format':
            commandFormat(core, opts);
            return 0;
          case 'view':
            opts.text = true; // view IS format --text
            commandFormat(core, opts);
            return 0;
          case 'expand':
            commandExpand(core, opts);
            return 0;
          default:
            throw new UsageError(`unknown command "${command}"`);
        }
      }
    }
  } catch (e) {
    if (e instanceof NoMatches) {
      process.stderr.write(`semtext: ${e.message}\n`);
      return 2;
    }
    if (e instanceof UsageError || e instanceof DomainError) {
      process.stderr.write(`semtext: ${e.message}\n`);
      return 1;
    }
    process.stderr.write(`semtext: ${e && e.stack ? e.stack : e}\n`);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('bin/semtext.mjs')) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(`semtext: ${err && err.stack ? err.stack : err}\n`);
      process.exitCode = 1;
    }
  );
}
