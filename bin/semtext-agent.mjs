#!/usr/bin/env node
/**
 * semtext-agent — agent-facing CLI over a SemText document.
 *
 * Every command reads XHTML (never a markdown projection) and answers in
 * compact form; `--json` makes any output machine-parseable. The toolkit
 * proper lives in src/agent (bundled to dist/semtext-agent.js, global
 * `SemTextAgent`); this front end owns the environment: file IO, DOM
 * parsing (happy-dom), XSLT engines, schema validation.
 *
 * Commands:
 *   outline <file> [--depth N]
 *   expand  <file> <id> [--format text|xhtml]
 *   filter  <file> [--type T] [--id ID] [--kind K] [--tag T]
 *                  [--audience A] [--attr N[=V]] [--selector CSS]
 *   search  <file> <query> [--regex] [--attrs] [--context N]
 *   write   [--format md|semtext] [--id ID] [--label L] [--kind K]
 *                  [--tags T] [--audience A] [--class-form]
 *                  [--wrap auto|always|never] [--out FILE]
 *                  [infile|-]
 *   edit    <file> --id ID [--mode inner|outer] [--content-file F]
 *                  [--content TEXT | stdin] [--in-place | --out FILE]
 *   xslt    <file> <stylesheet> [--out FILE]
 *
 * Exit codes: 0 ok · 1 domain error (no such block, validation errors,
 * unreadable file, path refused) · 2 usage error.
 * write/edit always validate the result against spec/schema before it is
 * reported (and before --in-place writes it back).
 *
 * Path policy: every output path (--out, edit --in-place) and the
 * edit --content-file read must resolve inside the working directory —
 * symlinks are followed with realpath and the REAL target is checked, so
 * a link pointing out of the tree is refused (exit 1).
 */

import { readFileSync, writeFileSync, existsSync, realpathSync, lstatSync, readlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename, sep } from 'node:path';
import { validateSource, loadSchema, defaultSchemaPath } from '../src/validate/validate.js';

const HELP = `semtext-agent — filter, search, outline, expand, write and edit SemText

Usage: semtext-agent <command> [args] [options] [--json]

Commands:
  outline <file> [--depth N]            compact outline; one stable id per block
  expand  <file> <id> [--format f]      full content of one block, on demand
  filter  <file> [criteria]             records by type/id/kind/tag/audience/attr/selector
  search  <file> <query> [options]      full-text or attribute search with context
  write   [options] [infile|-]          Markdown or SemText fragment in, SemText XHTML out
  edit    <file> --id ID [options]      surgical replace of one block, by id
  xslt    <file> <stylesheet>           run an XSLT stylesheet; --out FILE writes the result

Criteria (filter): --type T --id ID --kind K --tag T --audience A
                   --attr NAME[=VALUE] --selector CSS
Search: --regex --attrs --context N
Write:  --format md|semtext --id ID --label L --kind K --tags T --audience A
        --class-form --wrap auto|always|never
Edit:   --mode inner|outer --content-file F | --content TEXT (else stdin)
        (--content-file must resolve inside the working directory)
IO:     edit --in-place | --out FILE · write/xslt --out FILE (else stdout)
        output paths must stay inside the working directory; symlinks are
        followed and the real target must sit inside it too, or the path is
        refused (exit 1)
Global: --json compact machine output · -h this help

Exit codes: 0 ok · 1 domain error (incl. refused path) · 2 usage error
Docs: README.md ("Agent toolkit") · spec/conventions.md §8`;

class UsageError extends Error {}

/* ------------------------------------------------------------------ *
 * Core loading (the built bundle is the single source of truth)
 * ------------------------------------------------------------------ */

function loadCore() {
  const dist = fileURLToPath(new URL('../dist/semtext-agent.js', import.meta.url));
  if (!existsSync(dist)) {
    process.stderr.write(
      'semtext-agent: dist/semtext-agent.js is missing — run `npm run build` first\n'
    );
    process.exit(2);
  }
  const src = readFileSync(dist, 'utf8');
  const factory = new Function(
    src + '\n;return typeof SemTextAgent !== "undefined" ? SemTextAgent : globalThis.SemTextAgent;'
  );
  return factory();
}

/* ------------------------------------------------------------------ *
 * DOM plumbing (happy-dom; a browser caller passes `document` instead)
 * ------------------------------------------------------------------ */

let Window = null;
async function ensureHappyDom() {
  if (Window) return;
  try {
    ({ Window } = await import('happy-dom'));
  } catch {
    throw new DomainError(
      'semtext-agent needs the "happy-dom" package — install it (npm i -D happy-dom)'
    );
  }
}

function parseHtml(source) {
  const win = new Window({ settings: { disableCSSFileLoading: true } });
  return new win.DOMParser().parseFromString(source, 'text/html');
}

function readInput(path) {
  if (!path || path === '-') return readStdin();
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    throw new DomainError(`${path}: cannot read — ${e.message}`);
  }
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
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

/* ------------------------------------------------------------------ *
 * Validation (schema-driven, same engine as semtext-validate)
 * ------------------------------------------------------------------ */

let schemaCache = null;
function schema() {
  if (!schemaCache) schemaCache = loadSchema(defaultSchemaPath());
  return schemaCache;
}

function validateText(source, filename) {
  const { diagnostics } = validateSource(source, schema(), { filename });
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity !== 'error');
  return { diagnostics, errors, warnings };
}

function reportValidation(result, json) {
  if (json) return { errors: result.errors.length, warnings: result.warnings.length, diagnostics: result.diagnostics };
  for (const d of result.diagnostics) {
    process.stdout.write(`  ${d.severity} ${d.rule} (line ${d.line}): ${d.message}\n`);
  }
  return { errors: result.errors.length, warnings: result.warnings.length };
}

/* ------------------------------------------------------------------ *
 * XSLT
 * ------------------------------------------------------------------ */

async function runXslt(xmlSource, stylesheetSource) {
  // Pure-JS engine first (portable), the xsltproc binary as fallback.
  try {
    const xp = await import('xslt-processor');
    const parser = new xp.XmlParser();
    const out = await new xp.Xslt().xsltProcess(
      parser.xmlParse(xmlSource),
      parser.xmlParse(stylesheetSource)
    );
    return { output: String(out), engine: 'xslt-processor' };
  } catch (err) {
    if (!isModuleMissing(err)) throw new DomainError(`XSLT failed — ${err.message}`);
  }
  const dir = mkdtempSync(join(tmpdir(), 'semtext-xslt-'));
  try {
    const xmlPath = join(dir, 'doc.xml');
    const xslPath = join(dir, 'style.xsl');
    writeFileSync(xmlPath, xmlSource);
    writeFileSync(xslPath, stylesheetSource);
    const output = execFileSync('xsltproc', [xslPath, xmlPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { output, engine: 'xsltproc' };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new DomainError(
        'no XSLT engine available — `npm i -D xslt-processor` (pure JS) or install the xsltproc binary'
      );
    }
    throw new DomainError(`XSLT failed (xsltproc) — ${(err.stderr || err.message || '').toString().trim()}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function isModuleMissing(err) {
  return (
    err &&
    ((err.code && String(err.code).startsWith('ERR_MODULE')) ||
      // "Could not resolve … Is it installed?" is the phrasing vite (and so
      // vitest) uses for an unresolvable specifier — without it the pure-JS
      // engine's absence is misreported as an XSLT failure.
      /Cannot find|not found|could not resolve|is it installed|ERR_MODULE_NOT_FOUND/i.test(err.message || ''))
  );
}

/* ------------------------------------------------------------------ *
 * Output helpers
 * ------------------------------------------------------------------ */

class DomainError extends Error {}

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
 * Argument parsing
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const opts = { _: [], json: false };
  const flagWith = new Set([
    '--depth', '--format', '--type', '--id', '--kind', '--tag', '--audience',
    '--attr', '--selector', '--context', '--label', '--tags', '--wrap',
    '--mode', '--content', '--content-file', '--out'
  ]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--in-place') opts.inPlace = true;
    else if (a === '--regex') opts.regex = true;
    else if (a === '--attrs') opts.attrs = true;
    else if (a === '--class-form') opts.classForm = true;
    else if (flagWith.has(a)) {
      const v = argv[++i];
      if (v === undefined) throw new UsageError(`${a} expects a value`);
      opts[a.slice(2)] = v;
    } else if (a.startsWith('--')) {
      throw new UsageError(`unknown option "${a}"`);
    } else {
      opts._.push(a);
    }
  }
  return opts;
}

/* ------------------------------------------------------------------ *
 * Workspace path guard — writes (--out, edit --in-place) and the
 * --content-file read must resolve inside the working directory.
 * Symlinks are FOLLOWED (allowed) but the real target is what gets
 * checked: a link pointing out of the tree is refused. Targets that do
 * not exist yet (a file about to be created, a dangling link) are
 * resolved by hand so the same rule still applies.
 * ------------------------------------------------------------------ */

export function realpathAllowMissing(p, seen = new Set()) {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  let st = null;
  try {
    st = lstatSync(abs);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (st && st.isSymbolicLink()) {
    if (seen.has(abs)) throw new Error(`symlink cycle at ${abs}`);
    seen.add(abs);
    // Dangling symlink: follow it manually — its target may be missing too.
    return realpathAllowMissing(resolve(dirname(abs), readlinkSync(abs)), seen);
  }
  // A missing leaf: anchor on the nearest existing ancestor.
  return join(realpathAllowMissing(dirname(abs), seen), basename(abs));
}

export function guardWorkspacePath(candidate, what = 'path') {
  const root = realpathSync(process.cwd());
  const abs = resolve(root, candidate);
  let real;
  try {
    real = realpathAllowMissing(abs);
  } catch (e) {
    throw new DomainError(`${what} "${candidate}": cannot resolve — ${e.message}`);
  }
  if (real !== root && !real.startsWith(root + sep)) {
    throw new DomainError(
      `${what} "${candidate}": resolves outside the working directory (${real}) — refused`
    );
  }
  return real;
}

function guardTargets(command, opts) {
  const file = opts._[0];
  if (command === 'write') {
    if (opts.inPlace) {
      throw new UsageError('write does not support --in-place — use --out FILE (or stdout)');
    }
    if (opts.out) guardWorkspacePath(opts.out, '--out');
  }
  if (command === 'edit') {
    if (opts.out) guardWorkspacePath(opts.out, '--out');
    if (opts.inPlace) {
      if (!file || file === '-') throw new UsageError('--in-place needs a file path');
      guardWorkspacePath(file, '--in-place target');
    }
    if (opts['content-file']) guardWorkspacePath(opts['content-file'], '--content-file');
  }
  if (command === 'xslt' && opts.out) guardWorkspacePath(opts.out, '--out');
}

function writeFileOutput(path, content, opts) {
  if (opts.out) {
    const real = guardWorkspacePath(opts.out, '--out');
    writeFileSync(real, content);
    return { written: opts.out };
  }
  if (opts.inPlace) {
    if (!path || path === '-') throw new UsageError('--in-place needs a file path');
    const real = guardWorkspacePath(path, '--in-place target');
    writeFileSync(real, content);
    return { written: path };
  }
  return { written: null };
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

function commandOutline(core, opts) {
  const [file] = opts._;
  if (!file) throw new UsageError('outline needs a file');
  const root = documentRoot(readInput(file));
  const depth = opts.depth ? Number(opts.depth) : Infinity;
  if (!Number.isFinite(depth) && opts.depth !== undefined) throw new UsageError('--depth expects a number');
  const nodes = core.outline(root, depth);
  if (opts.json) return emit(nodes, true);
  emit(['# outline ' + file, ...outlineText(nodes)].join('\n'), false);
}

function commandExpand(core, opts) {
  const [file, id] = opts._;
  if (!file || !id) throw new UsageError('expand needs a file and a block id');
  const format = opts.format || 'text';
  if (format !== 'text' && format !== 'xhtml') throw new UsageError('--format must be "text" or "xhtml"');
  const root = documentRoot(readInput(file));
  let content;
  try {
    content = core.expand(root, id, format);
  } catch (e) {
    throw new DomainError(e.message);
  }
  if (opts.json) {
    emit({ id, format, content }, true);
    return;
  }
  emit(content, false);
}

function commandFilter(core, opts) {
  const [file] = opts._;
  if (!file) throw new UsageError('filter needs a file');
  const root = documentRoot(readInput(file));
  const blocks = core.filterBlocks(root, {
    type: opts.type,
    id: opts.id,
    kind: opts.kind,
    tag: opts.tag,
    audience: opts.audience,
    attr: opts.attr,
    selector: opts.selector
  });
  if (opts.json) {
    emit(
      blocks.map((b) => ({ id: b.id, idSource: b.idSource, type: b.type, record: b.record })),
      true
    );
    return;
  }
  if (!blocks.length) {
    process.stdout.write('no matching records\n');
    return;
  }
  // One annotated entry per selected record; rendered standalone (the
  // canonical renderer needs the full array for container indentation).
  emit(blocks.map((b) => core.renderRecordsAsText([b.record])).filter(Boolean).join('\n'), false);
}

function commandSearch(core, opts) {
  const [file, query] = opts._;
  if (!file || query === undefined) throw new UsageError('search needs a file and a query');
  const root = documentRoot(readInput(file));
  const hits = core.searchBlocks(root, query, {
    regex: opts.regex,
    attrs: opts.attrs,
    context: opts.context ? Number(opts.context) : undefined
  });
  if (opts.json) return emit(hits, true);
  if (!hits.length) {
    process.stdout.write('no matches\n');
    return;
  }
  emit(
    hits.map((h) => `- [${h.id}] ${h.type} ${h.field}: ${h.context}`).join('\n'),
    false
  );
}

function commandWrite(core, opts) {
  const [file] = opts._;
  const input = readInput(file);
  const result = core.writeFragment((src) => parseHtml(src), input, {
    format: opts.format,
    id: opts.id,
    label: opts.label,
    kind: opts.kind,
    tags: opts.tags,
    audience: opts.audience,
    classForm: opts.classForm,
    wrap: opts.wrap
  });
  // A write produces a fragment, but the schema's contracts are per
  // document: validate it in its embedding context (wrapped in a root when
  // it does not carry one).
  const validationSource = result.rootWrapped || /<sem-enhanced-document|class="sem-enhanced-document"/.test(result.xhtml)
    ? result.xhtml
    : '<sem-enhanced-document>' + result.xhtml + '</sem-enhanced-document>';
  const validation = validateText(validationSource, file || '<stdin>');
  const payload = { ...result, validation: reportValidation(validation, true) };
  if (validation.errors.length) {
    if (opts.json) emit(payload, true);
    else process.stdout.write('validation errors — output NOT written\n' + JSON.stringify(payload.validation, null, 2) + '\n');
    throw new DomainError(`write produced ${validation.errors.length} validation error(s)`);
  }
  const target = writeFileOutput(null, result.xhtml + '\n', opts);
  if (opts.json) return emit({ ...payload, written: target.written }, true);
  emit(result.xhtml, false);
  process.stderr.write(
    `${result.rootWrapped ? 'root wrapped, ' : ''}${result.ids.length} block id(s), ` +
    `0 errors, ${validation.warnings.length} warnings${target.written ? ` — wrote ${target.written}` : ''}\n`
  );
}

function commandEdit(core, opts) {
  const [file] = opts._;
  if (!file) throw new UsageError('edit needs a file');
  if (!opts.id) throw new UsageError('edit needs --id <block-id>');
  let content;
  if (opts['content-file']) content = readInput(opts['content-file']);
  else if (opts.content !== undefined) content = opts.content;
  else content = readStdin();
  if (!content.trim()) throw new UsageError('no content given — use --content, --content-file or stdin');
  const source = readInput(file);
  const mode = opts.mode || 'inner';
  if (mode !== 'inner' && mode !== 'outer') throw new UsageError('--mode must be "inner" or "outer"');
  let next;
  try {
    next = core.editBlock(source, opts.id, content.trim(), mode);
  } catch (e) {
    throw new DomainError(e.message);
  }
  if (next === source) {
    if (opts.json) return emit({ file, id: opts.id, changed: false }, true);
    process.stdout.write(`no change: "${opts.id}" already has this content\n`);
    return;
  }
  const validation = validateText(next, file);
  const payload = {
    file: file,
    id: opts.id,
    mode: mode,
    changed: true,
    validation: reportValidation(validation, true)
  };
  if (validation.errors.length) {
    if (opts.json) emit({ ...payload, changed: false }, true);
    else process.stdout.write('validation errors — file NOT written\n' + JSON.stringify(payload.validation, null, 2) + '\n');
    throw new DomainError(`edit produced ${validation.errors.length} validation error(s)`);
  }
  const target = writeFileOutput(file, next, opts);
  if (opts.json) return emit({ ...payload, written: target.written }, true);
  process.stdout.write(
    `edited "${opts.id}" (${mode}), 0 errors, ${validation.warnings.length} warnings` +
    (target.written ? ` — wrote ${target.written}` : ' — result on stdout') + '\n'
  );
  if (!target.written) process.stdout.write('\n' + next);
}

async function commandXslt(core, opts) {
  const [file, stylesheet] = opts._;
  if (!file || !stylesheet) throw new UsageError('xslt needs a file and a stylesheet');
  const doc = parseHtml(readInput(file));
  const rootEl = doc.documentElement;
  // The XML source must be well-formed: serialize through the toolkit's
  // canonical writer (XML-style void elements, escaped text) before parse.
  const xmlSource = '<?xml version="1.0" encoding="utf-8"?>\n' + core.serialize(rootEl);
  const stylesheetSource = readInput(stylesheet);
  const { output, engine } = await runXslt(xmlSource, stylesheetSource);
  // --out was documented but ignored; it now writes the result to the
  // given path under the working-directory rule (same as write/edit).
  if (opts.out) {
    const target = writeFileOutput(null, output.endsWith('\n') ? output : output + '\n', opts);
    if (opts.json) return emit({ file, stylesheet, engine, written: target.written }, true);
    process.stderr.write(`engine: ${engine}\nwrote ${target.written}\n`);
    return;
  }
  if (opts.json) return emit({ file, stylesheet, engine, output }, true);
  emit(output, false);
  process.stderr.write(`engine: ${engine}\n`);
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

export async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`semtext-agent: ${e.message}\n`);
    return 2;
  }
  if (opts.help || argv.length === 0) {
    process.stdout.write(HELP + '\n');
    return 0;
  }
  const [command] = opts._;
  opts._ = opts._.slice(1);
  try {
    // Path hygiene first: refuse out-of-tree targets before any file is
    // read, parsed or written (and before the core bundle is needed).
    guardTargets(command, opts);
    const core = loadCore();
    await ensureHappyDom();
    switch (command) {
      case 'outline':
        commandOutline(core, opts);
        return 0;
      case 'expand':
        commandExpand(core, opts);
        return 0;
      case 'filter':
        commandFilter(core, opts);
        return 0;
      case 'search':
        commandSearch(core, opts);
        return 0;
      case 'write':
        commandWrite(core, opts);
        return 0;
      case 'edit':
        commandEdit(core, opts);
        return 0;
      case 'xslt':
        await commandXslt(core, opts);
        return 0;
      default:
        process.stderr.write(`semtext-agent: unknown command "${command}"\n`);
        return 2;
    }
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`semtext-agent: ${e.message}\n`);
      return 2;
    }
    if (e instanceof DomainError) {
      process.stderr.write(`semtext-agent: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('semtext-agent.mjs')) {
  main().then(
    (code) => { process.exitCode = code; },
    (err) => {
      process.stderr.write(`semtext-agent: ${err && err.stack ? err.stack : err}\n`);
      process.exitCode = 1;
    }
  );
}
