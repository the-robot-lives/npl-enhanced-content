/**
 * semtext-demo plugin — the shell commands, as plugin CommandSpecs.
 *
 * POSIX-style commands (ls/cat/cd/pwd and friends) live in the posix-sh
 * plugin (src/terminal/plugins/posix/); this plugin carries the SemText
 * commands over the demo documents:
 *
 *   semtext render <file>   text render: embeds, record summaries, skeleton
 *   semtext --render <file> [--section <id>]   one section instead of all
 *   semtext toc <file>      sections, subsections, figures and tables
 *   semtext tui <file>      flashcard view — emits a DATA-only TuiAction
 *                           the element performs (boxed panels, q closes)
 *   semtext outline|filter|format|expand  — the CLI-parity operations
 *   open <file.html>        emits a data-only WindowAction (blob, noopener)
 *
 * Published form: compiled to commands.js, referenced by manifest.json's
 * `load.src`. In-repo form: bundled with <sem-shell>, no fetch at all.
 */

import type { CommandContext, CommandSpec } from '../../terminal-core.js';
import { completePaths } from '../../complete.js';
import { filterDoc, formatDoc, outlineDoc, parseHtml } from '../../../shell/semtext-cli.js';
import { extractRecords, type SemRecord } from '../../../extract/records.js';
import { buildTuiTree } from './tui-tree.js';
import { createTuiApp } from '../../tui-app.js';
import type { TuiNode } from '../../tui.js';

function readArg(ctx: CommandContext, arg: string): { path: string; kind: 'file' | 'dir' } | { error: string } {
  const path = ctx.vfs.resolve(ctx.state.cwd, arg);
  const node = ctx.vfs.nodeAt(path);
  if (!node) return { error: `${arg}: no such file or directory` };
  return { path, kind: node.kind };
}

/** Resolve the input document: the named file, else piped stdin. */
function readDoc(ctx: CommandContext, fileArgs: string[]): { html: string; label: string } | { error: string } {
  const fileArg = fileArgs[0];
  if (!fileArg || fileArg === '-') {
    if (ctx.stdin === null) return { error: 'semtext: no input file (pipe one in: cat <file> | semtext <sub>)' };
    return { html: ctx.stdin, label: '(stdin)' };
  }
  const found = readArg(ctx, fileArg);
  if ('error' in found) return { error: found.error };
  if (found.kind === 'dir') return { error: `semtext: ${fileArg}: is a directory` };
  return { html: ctx.vfs.read(found.path) ?? '', label: fileArg };
}

/* ------------------------------------------------------------------ *
 * semtext render / tui — record and outline projections
 * ------------------------------------------------------------------ */

/** The piped `tui` renderer: the tree as an indented listing. */
function plainOutline(nodes: TuiNode[], depth = 0, out: string[] = []): string[] {
  for (const node of nodes) {
    const head = node.number !== '' ? `${node.number} ${node.label}` : node.label;
    out.push(`${'  '.repeat(depth)}${node.kind === 'block' ? '· ' : ''}${head}`);
    if (node.kind === 'block' && node.meta !== '') out.push(`${'  '.repeat(depth + 1)}${node.meta}`);
    plainOutline(node.children, depth + 1, out);
  }
  return out;
}

const OUTLINE_INDENT = (depth: number): string => '  '.repeat(Math.max(0, depth - 1));

/* ------------------------------------------------------------------ *
 * the semtext command
 * ------------------------------------------------------------------ */

const HELP: Record<string, string[]> = {
  outline: ['usage: semtext outline <file>', '', 'The document skeleton in reading order: headings at their own', 'level, structural sem-* blocks one under the last heading.'],
  filter: [
    'usage: semtext filter <file> [--type <el>] [--text <s>]',
    '',
    "Elements by type and/or text, one outerHTML per line. --text reports",
    'minimal matches only: no ancestors of a deeper match.',
  ],
  format: ['usage: semtext format <file> [--json]', '', 'The document as plain text (the extractText recipe) or as the', 'canonical SemRecord[] JSON.'],
  expand: [
    'usage: semtext expand <file> [order]',
    '',
    'Every record fully expanded: the header line, the record text, then',
    'each field. A numeric order (1-based) prints just that record.',
  ],
  render: [
    'usage: semtext render <file> [--section <id|number|heading>]',
    '',
    'The text render of a document — what a machine reads: the embeds it',
    'loaded, each element with its record summary (the extractText shape the',
    'landing page shows), then the skeleton tree. --section narrows the',
    'render to one section: its id, its computed number (see `semtext toc`),',
    'or its heading text.',
    '',
    '  semtext render demo/token-rotation.html',
  ],
  toc: [
    'usage: semtext toc <file>',
    '',
    'The table of contents: every section and subsection, numbered in',
    'reading order, then the figures, charts and tables under the section',
    'that holds them, with their captions (e.g. "Diagram flow: The auth',
    'flow", "Table apple: GDP By Region"). A listing uses the element id',
    'when the document sets one, else its per-kind ordinal.',
    '',
    '  semtext toc demo/token-rotation.html',
  ],
  tui: [
    'usage: semtext tui <file>',
    '',
    'Full-screen browser for the document outline on the alternate',
    'screen: sections and their blocks, records inlined in place.',
    '',
    '  j / ArrowDown   next row            k / ArrowUp   previous row',
    '  Enter / Space   expand or collapse  h / l         fold / unfold',
    '  g / Home, G / End   first / last    PgUp / PgDn   page',
    '  /               filter rows (Enter or Esc ends the filter)',
    '  q / Esc         close the view and return to the prompt',
    '',
    '  semtext tui demo/auth-notes.sem.html',
  ],
};

const GENERAL_USAGE = [
  'usage: semtext <sub> [file] — render | toc | tui | outline | filter | format | expand',
  '',
  'Document operations; `semtext <sub> --help` explains one.',
].join('\n');

const semtext: CommandSpec = {
  name: 'semtext',
  usage: 'semtext <sub> [file] — render | toc | tui | outline | filter | format | expand',
  complete: (ctx) => (ctx.args.length === 0 ? ['render', 'tui', 'outline', 'filter', 'format', 'expand'] : completePaths(ctx)),
  // Full-screen handover (CORE-V2 §6.4): the core only asks on a tty, and
  // declining (null) falls back to run() — the plain renderer and the
  // error path stay here. Only `semtext tui <file>` with a browsable
  // tree spawns; every other subcommand keeps running inline.
  app(ctx) {
    const [subArg, ...rest] = ctx.args;
    const sub = subArg === '--render' ? 'render' : subArg === '--toc' ? 'toc' : subArg;
    if (sub !== 'tui' || rest.includes('--help') || rest.includes('-h')) return null;
    const fileArgs: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i]!;
      if (a === '--type' || a === '--text' || a === '--section') i += 1; // valued flags
      else if (a !== '--json') fileArgs.push(a);
    }
    const doc = readDoc(ctx, fileArgs);
    if ('error' in doc) return null;
    const built = buildTuiTree(doc.html);
    if (built.roots.length === 0) return null;
    return createTuiApp(built.roots, built.title);
  },
  run(ctx) {
    const [subArg, ...rest] = ctx.args;
    // Flag spellings (CLI parity): `semtext --render f` == `semtext render f`,
    // `semtext --toc f` == `semtext toc f`.
    const sub = subArg === '--render' ? 'render' : subArg === '--toc' ? 'toc' : subArg;
    if (!sub) {
      ctx.err('semtext: missing subcommand — use render, toc, tui, outline, filter, format or expand');
      ctx.exit(2);
      return;
    }
    if (sub === '--help' || sub === '-h') {
      ctx.out(GENERAL_USAGE);
      return;
    }
    const help = HELP[sub];
    if (!help) {
      ctx.err(`semtext: unknown subcommand "${sub}" — use render, toc, tui, outline, filter, format or expand`);
      ctx.exit(2);
      return;
    }
    if (rest.includes('--help') || rest.includes('-h')) {
      for (const line of help) ctx.out(line);
      return;
    }

    const fileArgs: string[] = [];
    let type: string | null = null;
    let text: string | null = null;
    let json = false;
    let section: string | null = null;
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i]!;
      if (a === '--type') type = rest[++i] ?? null;
      else if (a === '--text') text = rest[++i] ?? null;
      else if (a === '--json') json = true;
      else if (a === '--section') section = rest[++i] ?? null;
      else fileArgs.push(a);
    }
    const doc = readDoc(ctx, fileArgs);
    if ('error' in doc) {
      ctx.err(doc.error);
      ctx.exit(1);
      return;
    }
    try {
      if (sub === 'outline') {
        for (const entry of outlineDoc(doc.html)) {
          ctx.out(OUTLINE_INDENT(entry.depth) + entry.tag + ' ' + entry.label);
        }
        return;
      }
      if (sub === 'filter') {
        if (!type && !text) {
          ctx.err('semtext filter: give --type <element> or --text <string>');
          ctx.exit(2);
          return;
        }
        const result = filterDoc(doc.html, { type, text });
        ctx.out(result === '' ? 'no matches' : result);
        return;
      }
      if (sub === 'format') {
        ctx.out(formatDoc(doc.html, json ? 'json' : 'text'));
        return;
      }
      if (sub === 'render') {
        if (section !== null) renderSectionDoc(ctx, doc.html, doc.label, section);
        else renderDoc(ctx, doc.html, doc.label);
        return;
      }
      if (sub === 'toc') {
        tocDoc(ctx, doc.html, doc.label);
        return;
      }
      if (sub === 'tui') {
        // Reached when piped (the tty path spawns the grid app above):
        // the plain renderer — the outline listing, no interaction.
        const built = buildTuiTree(doc.html);
        if (built.roots.length === 0) {
          ctx.err('semtext tui: nothing to browse in this document');
          ctx.exit(1);
          return;
        }
        ctx.out(`tui: ${built.title}`);
        for (const line of plainOutline(built.roots)) ctx.out(line);
        return;
      }
      if (sub === 'expand') {
        const records = extractRecords(parseHtml(doc.html));
        const orderArg = fileArgs[1];
        if (orderArg !== undefined) {
          const order = Number.parseInt(orderArg, 10);
          const record = records[order - 1];
          if (!record) {
            ctx.err(`semtext expand: no record ${orderArg} (document has ${records.length})`);
            ctx.exit(1);
            return;
          }
          expandRecord(ctx, order, record);
          return;
        }
        for (let i = 0; i < records.length; i++) expandRecord(ctx, i + 1, records[i]!);
        return;
      }
    } catch (cause) {
      ctx.err(cause instanceof Error ? cause.message : String(cause));
      ctx.exit(1);
    }
  },
};

const indent = '   ';

function expandRecord(ctx: CommandContext, order: number, record: SemRecord): void {
  const head = [`${order}.`, record.type, record.id ? `#${record.id}` : null, record.kind ? `kind=${record.kind}` : null]
    .filter((part): part is string => part !== null)
    .join(' ');
  ctx.out(head);
  if (record.text) ctx.out(`${indent}${record.text}`);
  for (const [key, value] of Object.entries(record.fields)) {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    ctx.out(`${indent}${key}: ${Array.isArray(value) ? value.join(' | ') : String(value)}`);
  }
}

/** The `render` projection: embeds, then record summaries, then the skeleton. */
function renderDoc(ctx: CommandContext, html: string, label: string): void {
  const parsed = parseHtml(html);
  ctx.out(`# semtext render — ${label}`);
  const embeds = parsed.querySelectorAll('script[src], link[href], iframe[src], img[src], object[data]');
  if (embeds.length === 0) {
    ctx.out('# embeds: (none)');
  } else {
    ctx.out(`# embeds: ${embeds.length}`);
    for (const embed of embeds) {
      const url = embed.getAttribute('src') ?? embed.getAttribute('href') ?? embed.getAttribute('data') ?? '';
      ctx.out(`#   ${url} (${embed.tagName.toLowerCase()})`);
    }
  }
  ctx.out('# records:');
  const text = formatDoc(html, 'text');
  if (text !== '') for (const line of text.split('\n')) ctx.out(line);
  ctx.out('# skeleton:');
  for (const entry of outlineDoc(html)) ctx.out(OUTLINE_INDENT(entry.depth) + entry.tag + ' ' + entry.label);
}

/* ------------------------------------------------------------------ *
 * semtext render --section / toc — section projections
 * ------------------------------------------------------------------ */

const SECTION_HEADINGS = 'h1, h2, h3, h4, h5, h6';

function headingLevelOf(el: Element): number {
  return Number.parseInt(el.tagName.slice(1), 10);
}

function headingTextOf(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function sectionNumberString(counters: number[], level: number): string {
  const parts = counters.slice(0, level);
  while (parts.length > 1 && parts[0] === 0) parts.shift(); // a doc may start at h2
  return parts.join('.');
}

function bumpSectionCounters(counters: number[], level: number): void {
  counters[level - 1]! += 1;
  for (let i = level; i < counters.length; i++) counters[i] = 0;
}

/** Number every heading once; returns heading → "2.1" (leading zeros trimmed). */
function numberHeadings(doc: Document): Map<Element, string> {
  const counters = [0, 0, 0, 0, 0, 0];
  const numbers = new Map<Element, string>();
  for (const heading of Array.from(doc.querySelectorAll(SECTION_HEADINGS))) {
    const level = headingLevelOf(heading);
    bumpSectionCounters(counters, level);
    numbers.set(heading, sectionNumberString(counters, level));
  }
  return numbers;
}

/**
 * Resolve a --section target: element id, then computed section number,
 * then normalized heading text. A heading hit spans the heading plus
 * following siblings up to the next heading of level <= its own; an
 * id on a non-heading element spans just that element.
 */
function findSection(doc: Document, target: string): { span: Element[]; label: string } | null {
  const headings = Array.from(doc.querySelectorAll(SECTION_HEADINGS));
  const numbers = numberHeadings(doc);
  const wanted = target.trim().toLowerCase();
  for (const heading of headings) {
    const id = heading.getAttribute('id');
    const text = headingTextOf(heading);
    if (
      (id !== null && id.toLowerCase() === wanted) ||
      numbers.get(heading) === wanted ||
      text.toLowerCase() === wanted
    ) {
      const label = `${numbers.get(heading)} ${text}`;
      const span: Element[] = [heading];
      const level = headingLevelOf(heading);
      let next: Element | null = heading.nextElementSibling;
      while (next) {
        if (next.matches(SECTION_HEADINGS) && headingLevelOf(next) <= level) break;
        span.push(next);
        next = next.nextElementSibling;
      }
      return { span, label };
    }
  }
  for (const el of Array.from(doc.querySelectorAll('[id]'))) {
    if ((el.getAttribute('id') ?? '').toLowerCase() === wanted && !el.matches(SECTION_HEADINGS)) {
      return { span: [el], label: `#${el.getAttribute('id')}` };
    }
  }
  return null;
}

/** The `render --section` projection: one section's records, then its skeleton. */
function renderSectionDoc(ctx: CommandContext, html: string, label: string, target: string): void {
  const doc = parseHtml(html);
  const hit = findSection(doc, target);
  if (!hit) {
    ctx.err(`semtext render: no section "${target}" in ${label} — \`semtext toc ${label}\` lists the sections`);
    ctx.exit(1);
    return;
  }
  ctx.out(`# semtext render — ${label} [section ${target}]`);
  const spanHtml = hit.span.map((el) => el.outerHTML).join('\n');
  const text = formatDoc(spanHtml, 'text');
  ctx.out('# records:');
  if (text !== '') for (const line of text.split('\n')) ctx.out(line);
  ctx.out('# skeleton:');
  for (const entry of outlineDoc(spanHtml)) ctx.out(OUTLINE_INDENT(entry.depth) + entry.tag + ' ' + entry.label);
}

/** The `toc` projection: numbered sections, then figures/tables with captions. */
function tocDoc(ctx: CommandContext, html: string, label: string): void {
  const doc = parseHtml(html);
  const counters = [0, 0, 0, 0, 0, 0];
  const ordinals: Record<'diagram' | 'chart' | 'table', number> = { diagram: 0, chart: 0, table: 0 };
  let listed = 0;
  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const level = headingLevelOf(el);
      bumpSectionCounters(counters, level);
      ctx.out(`${OUTLINE_INDENT(level)}${sectionNumberString(counters, level)} ${tag} ${headingTextOf(el)}`);
      listed += 1;
      continue;
    }
    if (tag === 'figure' || tag === 'table') {
      const isFigure = tag === 'figure';
      const kindAttr = (el.getAttribute('kind') ?? (isFigure ? 'diagram' : 'table')).toLowerCase();
      const kind = isFigure ? (kindAttr === 'chart' ? 'Chart' : 'Diagram') : 'Table';
      const key = kind.toLowerCase() as 'diagram' | 'chart' | 'table';
      const id = el.getAttribute('id');
      const ref = id !== null && id !== '' ? id : String((ordinals[key]! += 1));
      const caption = (el.querySelector(isFigure ? 'figcaption' : 'caption')?.textContent ?? '').replace(/\s+/g, ' ').trim();
      ctx.out(`${OUTLINE_INDENT(3)}${kind} ${ref}: ${caption === '' ? '(no caption)' : caption}`);
      listed += 1;
    }
  }
  if (listed === 0) {
    ctx.err(`semtext toc: ${label}: no sections or listings`);
    ctx.exit(1);
  }
}

const open: CommandSpec = {
  name: 'open',
  usage: 'open <file.html> — open a document in a new window (noopener)',
  run(ctx) {
    const target = ctx.args[0];
    if (!target) {
      ctx.err('open: missing file operand');
      return;
    }
    const found = readArg(ctx, target);
    if ('error' in found) {
      ctx.err(found.error);
      return;
    }
    const name = found.path.split('/').pop() ?? target;
    if (found.kind !== 'file' || !name.toLowerCase().endsWith('.html')) {
      ctx.err(`open: ${target}: not an HTML document (only .html files open)`);
      return;
    }
    ctx.emit({ kind: 'window', filename: name, blob: ctx.vfs.read(found.path) ?? '', contentType: 'text/html' });
  },
};

export const demoCommands: CommandSpec[] = [semtext, open];
export default demoCommands;
