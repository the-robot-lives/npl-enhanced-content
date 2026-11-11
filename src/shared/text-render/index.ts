/**
 * text-render — the shared, pure terminal renderer for SemText elements.
 *
 * One text vocabulary for every surface that shows a SemText document in a
 * terminal: the browser-side `render-mode="tui"` presentation
 * (src/lit/shared/render-mode.ts, the `<sem-tui>` wrapper) and any CLI or
 * agent tool that wants a per-element view. The CONTENT always comes from
 * the canonical extraction layer (src/extract/records.ts) wherever a
 * record exists, so the browser's terminal view and `semtext format
 * --text` quote the same text by construction; the newer families that
 * extraction does not yet mint records for are read straight off the
 * authored DOM with the same `param`/`part`/`sel` helpers the vocabulary
 * uses everywhere else.
 *
 * Presentation lives only here: box-drawing frames for callouts,
 * `▸/▾` state carets for disclosures (honoring `collapsed`/`open`),
 * `├─ └─` glyphs for trees and collections, aligned columns for tables
 * and property lists, `[TL;DR]`-style labels, and word wrapping at the
 * caller's `cols` width. No DOM is written, no CSS is read: given the
 * same element and width, the output is a pure function.
 *
 * The tree parsers are imported from src/lit/sem-tree.ts, which ships
 * them pure for exactly this kind of reuse (and is already in every
 * bundle that includes this module via the core barrel).
 */

import { extractRecordPairs, type RecordPair, type SemRecord } from '../../extract/records.js';
import { param, hasParam } from '../attr.js';
import { part } from '../sel.js';
import { normalize } from '../summary.js';
import { parseTreeContainer, type TreeNode } from '../../lit/sem-tree.js';

/* ------------------------------------------------------------------ *
 * Options and primitives
 * ------------------------------------------------------------------ */

export interface TextRenderOptions {
  /** Wrap/frame width. Defaults to 80; the `<sem-tui>` wrapper forwards
   *  its own `cols` attribute here. */
  cols?: number;
}

interface Ctx {
  cols: number;
}

const DEFAULT_COLS = 80;

/** Longest line length in a block, ignoring the trailing-space padding. */
function widthOf(lines: string[]): number {
  let w = 0;
  for (const l of lines) w = Math.max(w, l.length);
  return w;
}

/** Word-wrap one logical line to `cols`, keeping a continuation indent. */
export function wrapLine(text: string, cols: number, indent = ''): string[] {
  const clean = normalize(text);
  if (!clean) return [''];
  const width = Math.max(8, cols - indent.length);
  const words = clean.split(' ');
  const out: string[] = [];
  let line = '';
  for (const word of words) {
    if (!line.length) {
      line = word;
    } else if (line.length + 1 + word.length <= width) {
      line += ' ' + word;
    } else {
      out.push(indent + line);
      line = word;
    }
  }
  if (line.length) out.push(indent + line);
  return out.length ? out : [''];
}

/**
 * A box-drawing frame around `lines`: `┌─ TITLE ─…┐` / `│ …` / `└─…┘`.
 * Width is content-driven, capped at `cols`; the title is truncated to
 * fit. Long content lines are hard-cut at the frame edge — callout bodies
 * arrive pre-wrapped, the cap only guards authored exceptions.
 */
export function box(title: string, lines: string[], cols: number): string[] {
  const body = lines.length ? lines : [''];
  const inner = Math.min(
    cols - 2,
    Math.max(widthOf(body), stripAnsiish(title).length + 4, 3)
  );
  const t = truncate(title, Math.max(0, inner - 4));
  const head = t ? `┌─ ${t} ` + '─'.repeat(Math.max(0, inner - t.length - 4)) + '┐'
                 : '┌' + '─'.repeat(inner) + '┐';
  const out = [head];
  for (const l of body) {
    const cut = truncate(l, inner);
    out.push('│ ' + cut + ' '.repeat(Math.max(0, inner - cut.length - 1)) + '│');
  }
  out.push('└' + '─'.repeat(inner) + '┘');
  return out;
}

/** Terminal placeholder characters never appear in output; kept for the
 *  title fit math so a future ANSI-tinted title cannot skew widths. */
function stripAnsiish(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : (max >= 2 ? s.slice(0, max - 1) + '…' : s.slice(0, max));
}

/** `[██████░░░░░░] 42%` — a bracket meter, `width` cells wide. */
export function meter(value: number, width: number): string {
  const cells = Math.max(1, width);
  const filled = Math.round(Math.min(1, Math.max(0, value)) * cells);
  return '[' + '█'.repeat(filled) + '░'.repeat(cells - filled) + ']';
}

/**
 * Aligned columns for a table: `│` separators, a `─` rule under the
 * header. Falls back to one wrapped pipe-row per record line when the
 * aligned grid cannot honor `cols` even with per-column minimums.
 */
export function renderAlignedTable(
  columns: string[],
  rows: string[][],
  cols: number
): string[] {
  const body = rows.length ? rows : [];
  const n = columns.length;
  if (!n) return [];
  const widths = columns.map((c, i) =>
    Math.min(
      Math.max(c.length, ...body.map((r) => (r[i] ?? '').length), 3),
      Math.max(8, Math.floor((cols - n - 1) / n))
    )
  );
  const total = widths.reduce((a, b) => a + b, 0) + (n + 1);
  const cell = (text: string, w: number) => ' ' + truncate(text, w).padEnd(w);
  const out: string[] = [];
  if (total <= cols) {
    const top = (joiner: string) => '┌' + widths.map((w) => '─'.repeat(w + 2)).join(joiner) + '┐';
    out.push(top('┬'));
    out.push('│' + columns.map((c, i) => cell(c, widths[i])).join('│') + '│');
    out.push('╪' + widths.map((w) => '─'.repeat(w + 2)).join('╪') + '╪');
    for (const r of body) {
      out.push('│' + columns.map((_c, i) => cell(r[i] ?? '', widths[i])).join('│') + '│');
    }
    out.push('└' + widths.map((w) => '─'.repeat(w + 2)).join('┴') + '┘');
    return out;
  }
  // Narrow terminal: header line, then each row on its own wrapped lines.
  out.push(columns.join(' | '));
  for (const r of body) out.push(r.map((c, i) => truncate(c ?? '', widths[i])).join(' | '));
  return out;
}

/** `├─` / `└─` connector for a child block among `count` siblings. */
function connector(isLast: boolean): string {
  return isLast ? '└─ ' : '├─ ';
}

/** Indent every line of a block by `pad` spaces (tree continuation gutters
 *  are the caller's business; this is plain spacing). */
function indentLines(lines: string[], pad: string): string[] {
  return lines.map((l) => (l.length ? pad + l : l));
}

/* ------------------------------------------------------------------ *
 * Record-backed rendering (the classic extraction vocabulary)
 * ------------------------------------------------------------------ */

/** `#id kind=… tags=… audience=…` — the same annotations extraction's
 *  plain-text recipe prints, kept so both views identify a record alike. */
function annotations(rec: SemRecord): string {
  const bits: string[] = [];
  if (rec.id) bits.push('#' + rec.id);
  if (rec.kind) bits.push('kind=' + rec.kind);
  if (rec.tags.length) bits.push('tags=' + rec.tags.join('|'));
  if (rec.audience) bits.push('audience=' + rec.audience);
  return bits.length ? ' (' + bits.join(' ') + ')' : '';
}

/** Collapsed state of a disclosure element, honoring both spellings. */
function isCollapsed(el: Element): boolean {
  return el.hasAttribute('collapsed') || el.hasAttribute('data-collapsed');
}

/** Expanded state of a one-way reveal (open attr, or already revealed). */
function isRevealed(el: Element): boolean {
  return el.hasAttribute('open') || el.hasAttribute('data-open') ||
    el.hasAttribute('data-revealed');
}

/** State caret for a disclosure: `▸` closed, `▾` open. */
function caret(open: boolean): string {
  return open ? '▾' : '▸';
}

/** The collapsed teaser: the leading sentence, so the second line of the
 *  body can never leak into a collapsed view. */
function teaser(text: string): string {
  const s = normalize(text);
  const m = s.match(/^(.+?[.!?])(?:\s|$)/);
  return m ? m[1] : s;
}

function childrenOf(pairs: RecordPair[], rec: SemRecord): RecordPair[] {
  return pairs.filter((p) => p.record.parent === rec.sourceOrder);
}

/** Wrap a record's own assertion line, with its annotations. */
function recordLine(rec: SemRecord, ctx: Ctx, prefix = ''): string[] {
  const head = prefix + rec.type + annotations(rec);
  if (!rec.text) return [head];
  const body = wrapLine(rec.text, ctx.cols, ' '.repeat(head.length + 2));
  return [head + ': ' + body[0], ...body.slice(1)];
}

/** Per-record-type block: the record's own lines, children nested below. */
function renderRecordBlock(
  pair: RecordPair,
  pairs: RecordPair[],
  ctx: Ctx
): string[] {
  const rec = pair.record;
  const el = pair.el;
  const kids = childrenOf(pairs, rec);
  const lines: string[] = [];

  switch (rec.type) {
    case 'sem-note': {
      const variant = String(rec.fields.variant || 'info');
      const collapsed = isCollapsed(el);
      const title = `${caret(!collapsed)} NOTE · ${variant}${annotations(rec)}`;
      const body = collapsed
        ? wrapLine(teaser(rec.text), ctx.cols - 4).slice(0, 1).map((l) => l + ' …')
        : wrapLine(rec.text, ctx.cols - 4);
      lines.push(...box(title, body, ctx.cols));
      break;
    }
    case 'sem-fact': {
      const stmt = String(rec.fields.statement || '');
      const concl = String(rec.fields.conclusion || '');
      const wrong = (rec.fields.incorrectStatements as string[]) || [];
      const head = `✓ FACT${annotations(rec)}`;
      lines.push(head);
      for (const l of wrapLine(stmt, ctx.cols - 4, '  ')) lines.push('  ' + l);
      if (concl) {
        for (const l of wrapLine('⇒ ' + concl, ctx.cols - 4, '  ')) lines.push('  ' + l);
      }
      for (const w of wrong) {
        for (const l of wrapLine('✗ ' + w, ctx.cols - 4, '  ')) lines.push('  ' + l);
      }
      break;
    }
    case 'sem-detail': {
      const highlights = (rec.fields.highlights as string[]) || [];
      const title = `DETAIL${annotations(rec)}`;
      lines.push(...box(title, wrapLine(rec.text, ctx.cols - 4), ctx.cols));
      for (const h of highlights) {
        for (const l of wrapLine('⟪ ' + h + ' ⟫', ctx.cols - 2, ' ')) lines.push('  ' + l.trim());
      }
      break;
    }
    case 'sem-step': {
      const status = String(rec.fields.status || 'todo');
      const ordinal = Number(rec.fields.ordinal || 0);
      const glyph = status === 'done' ? '✔' : status === 'current' ? '▶' : status === 'blocked' ? '⚠' : '·';
      lines.push(...recordLine(rec, ctx, `${glyph} ${ordinal}. [${status}] `));
      break;
    }
    case 'sem-property': {
      const key = String(rec.fields.key || '');
      const value = String(rec.fields.value || '');
      const pad = key ? key + ' :: ' : '';
      lines.push(...wrapLine(pad + value, ctx.cols));
      break;
    }
    case 'sem-view': {
      const name = String(rec.fields.name || '');
      lines.push(...recordLine(rec, ctx, `▤ ${name ? name + ' · ' : ''}`));
      break;
    }
    case 'sem-progress': {
      const value = Number(rec.fields.value || 0);
      const label = String(rec.fields.label || 'progress');
      const status = rec.fields.status ? ` (${rec.fields.status})` : '';
      lines.push(`${meter(value, 13)} ${Math.round(value * 100)}% ${label}${status}${annotations(rec)}`);
      break;
    }
    case 'sem-reveal': {
      const summary = String(rec.fields.summary || '');
      const open = isRevealed(el);
      const label = summary || rec.text;
      lines.push(`${caret(open)} REVEAL${annotations(rec)}: ` + truncate(label, ctx.cols - 14));
      if (open && rec.text) lines.push(...indentLines(wrapLine(rec.text, ctx.cols - 4), '  '));
      break;
    }
    case 'sem-event': {
      const when = String(rec.fields.when || '');
      const until = String(rec.fields.until || '');
      const stamp = [when && `@ ${when}`, until && `→ ${until}`].filter(Boolean).join(' ');
      const status = rec.fields.status ? ` [${rec.fields.status}]` : '';
      lines.push(...recordLine(rec, ctx, `◈ EVENT${stamp ? ' ' + stamp : ''}${status} `));
      break;
    }
    case 'sem-code':
    case 'sem-md': {
      const lang = String(rec.fields.lang || '');
      const filename = String(rec.fields.filename || '');
      const src = String(rec.fields.source || '');
      const head = [
        rec.type === 'sem-md' ? 'MD' : 'CODE',
        filename && `· ${filename}`,
        lang && `[${lang}]`,
      ].filter(Boolean).join(' ');
      const body: string[] = [];
      if (rec.type === 'sem-md') {
        for (const l of src.split('\n')) body.push(...wrapLine(l, ctx.cols - 4));
      } else {
        for (const l of src.split('\n')) body.push(truncate(l, ctx.cols - 4));
      }
      lines.push(...box(head + annotations(rec), body, ctx.cols));
      break;
    }
    case 'sem-reference': {
      const href = String(rec.fields.href || '');
      const cite = String(rec.fields.cite || '');
      const head = `🔗 [${rec.fields.ordinal ?? rec.sourceOrder}]${href ? ' ' + href : ''}${cite ? ' · ' + cite : ''}`;
      lines.push(...wrapLine(head + (rec.text ? ' — ' + rec.text : ''), ctx.cols));
      break;
    }
    case 'sem-table': {
      const caption = String(rec.fields.caption || '');
      const columns = (rec.fields.columns as string[]) || [];
      const rows = (rec.fields.rows as string[][]) || [];
      lines.push(`▦ TABLE${annotations(rec)}${caption ? ': ' + caption : ''}`);
      if (columns.length) lines.push(...indentLines(renderAlignedTable(columns, rows, ctx.cols), '  '));
      else for (const r of rows) lines.push('  ' + truncate(r.join(' | '), ctx.cols - 2));
      break;
    }
    case 'sem-agent': {
      const name = String(rec.fields.name || '');
      const bio = String(rec.fields.bio || '');
      const instructions = String(rec.fields.instructions || '');
      lines.push(`AGENT${annotations(rec)}${name ? ': ' + name : ''}`);
      if (bio) lines.push(...indentLines(wrapLine('bio: ' + bio, ctx.cols - 2), '  '));
      if (instructions) lines.push(...indentLines(wrapLine('instructions: ' + instructions, ctx.cols - 2), '  '));
      break;
    }
    case 'sem-tag-def': {
      const tag = String(rec.fields.tag || '');
      const name = String(rec.fields.name || '');
      const attrs = (rec.fields.attributes as Record<string, unknown>[]) || [];
      lines.push(`TAG DEF${annotations(rec)}: ${tag}${name && name !== tag ? ' (' + name + ')' : ''}`);
      for (const a of attrs) {
        const bits = [
          a.required ? 'required' : null,
          a.type ? String(a.type) : null,
          a.default !== undefined ? `default ${a.default}` : null,
          Array.isArray(a.allowed) ? `allowed ${a.allowed.join('|')}` : null,
        ].filter(Boolean);
        const desc = a.description ? ' — ' + a.description : '';
        lines.push(...wrapLine(`  ${a.name}${bits.length ? ' (' + bits.join(', ') + ')' : ''}${desc}`, ctx.cols));
      }
      break;
    }
    case 'sem-api-call': {
      const method = String(rec.fields.method || 'GET');
      const endpoint = String(rec.fields.endpoint || '');
      const params = (rec.fields.params as Record<string, unknown>[]) || [];
      lines.push(`API CALL${annotations(rec)}: ${method} ${endpoint}`);
      for (const p of params) {
        const bits = [
          p.in ? `in ${p.in}` : null,
          p.type ? String(p.type) : null,
          p.required ? 'required' : null,
          p.default !== undefined ? `default ${p.default}` : null,
          Array.isArray(p.allowed) ? `allowed ${p.allowed.join('|')}` : null,
        ].filter(Boolean);
        const desc = p.description ? ' — ' + p.description : '';
        lines.push(...wrapLine(`  ${p.name}${bits.length ? ' (' + bits.join(', ') + ')' : ''}${desc}`, ctx.cols));
      }
      break;
    }
    default: {
      // Collection containers (sem-facts, sem-details, sem-procedure, …)
      // mint empty-text records: the head line + nested children is the
      // whole view. Record-carrying unknown types keep the plain recipe.
      lines.push(...recordLine(rec, ctx));
    }
  }

  // Nested records render beneath their parent with tree connectors: the
  // connector prefixes the block's first line; its continuation lines ride
  // the vertical gutter (or plain indent under the last child).
  for (let i = 0; i < kids.length; i++) {
    const last = i === kids.length - 1;
    const block = renderRecordBlock(kids[i], pairs, ctx);
    if (!block.length) continue;
    lines.push('  ' + connector(last) + block[0]);
    if (block.length > 1) lines.push(...indentLines(block.slice(1), '  ' + (last ? '   ' : '│  ')));
  }
  return lines;
}

/** Record tree for one element: `el`'s own record as root, or its child
 *  records as a forest when `el` mints nothing (wrapper tags). */
function renderRecordTree(el: Element, ctx: Ctx): string | null {
  const pairs = extractRecordPairs(el);
  if (!pairs.length) return null;
  const own = pairs[0].record.parent === null &&
    pairs[0].el === el ? [pairs[0]] : pairs.filter((p) => p.record.parent === null);
  const lines: string[] = [];
  for (const root of own) lines.push(...renderRecordBlock(root, pairs, ctx));
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * DOM-read renderers — families extraction does not yet mint records for
 * ------------------------------------------------------------------ */

/** The direct records minted inside `el` (any depth), element paired. */
function recordsIn(el: Element): RecordPair[] {
  return extractRecordPairs(el).filter((p) => p.el !== el);
}

function childLines(el: Element, ctx: Ctx): string[] {
  const out: string[] = [];
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) {
      const t = normalize(node.nodeValue);
      if (t) out.push(...wrapLine(t, ctx.cols));
    } else if (node.nodeType === 1) {
      const child = node as Element;
      const block = renderElementAsText(child, { cols: ctx.cols });
      if (block) out.push(...block.split('\n'));
    }
  }
  return out;
}

/** One label line naming a container: `TAG (annotations)`. */
function headLine(el: Element, tag: string, extra = ''): string {
  const fake: SemRecord = {
    type: tag,
    id: el.getAttribute('id'),
    kind: param(el, 'kind'),
    tags: (param(el, 'tags') || '').split(',').map((s) => s.trim()).filter(Boolean),
    audience: param(el, 'audience'),
    parent: null,
    fields: {},
    text: '',
    sourceOrder: 0,
  };
  return tag.toUpperCase() + annotations(fake) + (extra ? ': ' + extra : '');
}

function metaCard(el: Element, ctx: Ctx, label: string, attrs: string[]): string {
  const bits = attrs.map((a) => [a, param(el, a)].filter((v) => v !== null && v !== '').join('='))
    .filter((s) => !s.endsWith('='));
  const extra = bits.length ? ` (${bits.join(', ')})` : '';
  const body = childLines(el, ctx);
  const lines = [headLine(el, label, '') + extra];
  if (body.length) lines.push(...indentLines(body, '  '));
  return lines.join('\n');
}

function qna(el: Element, ctx: Ctx, tag: string): string {
  const q = normalize(el.querySelector(part('question'))?.textContent);
  const a = normalize(el.querySelector(part('answer'))?.textContent);
  const lines = [`${caret(true)} Q${annotationsOf(el, tag)}: ${truncate(q || '—', ctx.cols - 8)}`];
  if (a) lines.push(...indentLines(wrapLine('A: ' + a, ctx.cols - 4), '  '));
  return lines.join('\n');
}

function annotationsOf(el: Element, tag: string): string {
  const fake: SemRecord = {
    type: tag,
    id: el.getAttribute('id'),
    kind: param(el, 'kind'),
    tags: (param(el, 'tags') || '').split(',').map((s) => s.trim()).filter(Boolean),
    audience: param(el, 'audience'),
    parent: null,
    fields: {},
    text: '',
    sourceOrder: 0,
  };
  return annotations(fake);
}

function entryList(
  el: Element,
  ctx: Ctx,
  tag: string,
  entryTag: string,
  summarize: (entry: Element) => string
): string {
  const sel0 = entryTag;
  const entries = Array.from(el.querySelectorAll(':scope > ' + sel0 + ', :scope > .sem-' + entryTag.slice(4)));
  const lines = [headLine(el, tag)];
  for (let i = 0; i < entries.length; i++) {
    const last = i === entries.length - 1;
    lines.push('  ' + connector(last) + truncate(summarize(entries[i]), ctx.cols - 6));
    // The entry renders through its own dispatcher; its headline line
    // duplicates the summary above, so it is dropped here.
    const own = renderElementAsText(entries[i], { cols: ctx.cols });
    const inner = own ? own.split('\n').slice(1) : [];
    if (inner.length) lines.push(...indentLines(inner, '  ' + (last ? '   ' : '│  ') + '  '));
  }
  return lines.join('\n');
}

function glyphs(roots: TreeNode[], prefix = ''): string[] {
  const out: string[] = [];
  roots.forEach((n, i) => {
    const last = i === roots.length - 1;
    const branch = prefix + connector(last);
    const label = n.label ? `${n.path} — ${n.label}` : n.path;
    const suffix = n.kind && n.kind !== 'dir' ? ` (${n.kind})` : n.kind === 'dir' ? '/' : '';
    out.push(truncate(branch + label + suffix, 200));
    out.push(...glyphs(n.children, prefix + (last ? '   ' : '│  ')));
  });
  return out;
}

function tree(el: Element, ctx: Ctx, tag: string): string {
  const mode = param(el, 'mode');
  const { roots } = parseTreeContainer(el, mode);
  const lines = [headLine(el, tag)];
  if (roots.length) lines.push(...glyphs(roots));
  else {
    const pre = el.querySelector('pre');
    if (pre) lines.push(...pre.textContent!.split('\n').map((l) => '  ' + truncate(l, ctx.cols - 2)));
  }
  return lines.join('\n');
}

/** Workflow steps: numbered rows with the workflow-context parameters. */
function workflow(el: Element, ctx: Ctx): string {
  const duration = param(el, 'duration');
  const label = param(el, 'label');
  const steps = Array.from(el.querySelectorAll(':scope > sem-step, :scope > .sem-step'));
  const lines = [headLine(el, 'sem-workflow', [label, duration].filter(Boolean).join(' · '))];
  steps.forEach((s, i) => {
    const action = param(s, 'action') || normalize(s.textContent).slice(0, 40);
    const status = param(s, 'status');
    const bits = ['gate', 'check', 'if-no', 'if_no', 'output', 'description']
      .map((a) => [a, param(s, a)].filter((v) => v !== null && v !== '').join('='))
      .filter((x) => !x.endsWith('='));
    const head = `${i + 1}. ${action}${status ? ` [${status}]` : ''}`;
    lines.push('  ' + truncate(head, ctx.cols - 4));
    if (bits.length) lines.push(...wrapLine(bits.join(' · '), ctx.cols - 6, '     ').map((l) => '   ' + l));
  });
  return lines.join('\n');
}

/** quiz card: the question, its options marked correct/incorrect. */
function quiz(el: Element, ctx: Ctx): string {
  const prompt = normalize(el.querySelector(part('prompt'))?.textContent) ||
    normalize(el.textContent).slice(0, 60);
  const options = Array.from(el.querySelectorAll(':scope > sem-option, :scope > .sem-option'));
  const lines = [`? QUIZ${annotationsOf(el, 'sem-question')}: ${truncate(prompt, ctx.cols - 10)}`];
  options.forEach((o) => {
    const correct = hasParam(o, 'correct');
    lines.push(`   ${correct ? '◉' : '○'} ${truncate(normalize(o.textContent), ctx.cols - 8)}`);
  });
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * Placeholders — elements whose value is not prose
 * ------------------------------------------------------------------ */

/**
 * One-line placeholders for components whose content cannot sensibly
 * become terminal text (interactive media, embeds, chrome). The summary
 * is a cheap count so the line still says something useful.
 */
const PLACEHOLDERS: Record<string, (el: Element) => string> = {
  'sem-chat': (el) => `chat · ${el.querySelectorAll('sem-chat-message, .sem-chat-message, [data-role]').length} messages`,
  'sem-media-gallery': (el) => `media gallery · ${el.querySelectorAll('img, video, audio, figure').length} items`,
  'sem-upload-drop': () => 'file drop target',
  'sem-browser': (el) => `browser frame · ${truncate(param(el, 'src') || param(el, 'url') || '', 40)}`,
  'sem-data-visualizer': (el) => `data visualizer · ${truncate(param(el, 'kind') || 'chart', 30)}`,
  'sem-quota-meter': (el) => `quota meter · ${truncate(param(el, 'label') || '', 30)}`,
  'sem-artifact-card': (el) => `artifact · ${truncate(param(el, 'name') || '', 30)}`,
  'sem-provider-picker': (el) => `provider picker · ${el.querySelectorAll('option, [data-provider]').length} providers`,
  'sem-review-canvas': () => 'review canvas',
  'sem-reader': () => 'reader chrome',
  'sem-audiences': (el) => `audience profiles · ${el.querySelectorAll('[data-profile], option').length}`,
  'sem-editor': () => 'authoring surface',
};

/** Transparent wrappers: never frame themselves, never count as a tui
 *  ancestor — their children face the renderer directly. */
export const PASS_THROUGH_TAGS = new Set([
  'sem-tui',        // the frame element itself: provides context, renders children
  'sem-source',     // transparent content wrapper (snapshot chrome is generated)
  'sem-enhanced-document',
  'sem-text',       // legacy authoring wrapper
]);

/* ------------------------------------------------------------------ *
 * Per-tag dispatch
 * ------------------------------------------------------------------ */

/**
 * The text view of one element. Returns '' for pass-through wrappers
 * (their children are rendered by the surrounding context) and for
 * placeholders the one-line `[tag: summary]` form.
 */
export function renderElementAsText(el: Element, opts: TextRenderOptions = {}): string {
  const ctx: Ctx = { cols: opts.cols && opts.cols > 8 ? Math.floor(opts.cols) : DEFAULT_COLS };
  const tag = el.localName;

  if (PASS_THROUGH_TAGS.has(tag)) return '';

  // Optional component override: a SemText component may define
  // renderText() to answer for itself (the `<sem-tui>` protocol).
  const self = el as unknown as { renderText?: (opts?: TextRenderOptions) => string };
  if (typeof self.renderText === 'function') {
    return self.renderText(opts) || '';
  }

  if (PLACEHOLDERS[tag]) {
    const label = PLACEHOLDERS[tag](el);
    return `[${tag}${el.getAttribute('id') ? ' #' + el.getAttribute('id') : ''}: ${label}]`;
  }

  switch (tag) {
    // — record-backed types: the extraction tree is the whole answer —
    case 'sem-note':
    case 'sem-fact':
    case 'sem-detail':
    case 'sem-step':
    case 'sem-property':
    case 'sem-view':
    case 'sem-progress':
    case 'sem-reveal':
    case 'sem-event':
    case 'sem-code':
    case 'sem-md':
    case 'sem-reference':
    case 'sem-table':
    case 'sem-agent':
    case 'sem-tag-def':
    case 'sem-api-call':
    case 'sem-facts':
    case 'sem-details':
    case 'sem-procedure':
    case 'sem-properties':
    case 'sem-views':
    case 'sem-chronology':
    case 'sem-references':
      return renderRecordTree(el, ctx) ?? '';

    // — newer families, read off the authored DOM —
    case 'sem-tldr':
      return box('[TL;DR]' + annotationsOf(el, tag), wrapLine(el.textContent || '', ctx.cols - 4), ctx.cols).join('\n');
    case 'sem-summary':
      return box('SUMMARY' + annotationsOf(el, tag), wrapLine(el.textContent || '', ctx.cols - 4), ctx.cols).join('\n');
    case 'sem-faqs':
      return entryList(el, ctx, 'sem-faqs', 'sem-faq', (e) => truncate(normalize(e.querySelector(part('question'))?.textContent), ctx.cols - 10));
    case 'sem-faq':
      return qna(el, ctx, 'sem-faq');
    case 'sem-guard-rails':
      return entryList(el, ctx, 'sem-guard-rails', 'sem-guard-rail', (e) => {
        const sev = param(e, 'severity') || 'info';
        const scope = param(e, 'scope');
        const glyph = sev === 'block' ? '⛔' : sev === 'warn' ? '⚠' : 'ℹ';
        return `${glyph} ${sev}${scope ? ` [${scope}]` : ''}`;
      });
    case 'sem-guard-rail': {
      const sev = param(el, 'severity') || 'info';
      const glyph = sev === 'block' ? '⛔' : sev === 'warn' ? '⚠' : 'ℹ';
      const scope = param(el, 'scope');
      return `${glyph} ${sev.toUpperCase()}${annotationsOf(el, 'sem-guard-rail')}${scope ? ` [${scope}]` : ''}\n` +
        indentLines(wrapLine(el.textContent || '', ctx.cols - 4), '  ').join('\n');
    }
    case 'sem-tsgs':
      return entryList(el, ctx, 'sem-tsgs', 'sem-tsg', (e) =>
        truncate(param(e, 'name') || normalize(e.querySelector(part('title'))?.textContent) || 'tsg', ctx.cols - 10));
    case 'sem-tsg':
      return metaCard(el, ctx, 'TSG', ['name']);
    case 'sem-changelogs':
      return entryList(el, ctx, 'sem-changelogs', 'sem-changelog', (e) => {
        const date = param(e, 'date');
        const title = param(e, 'title') || param(e, 'name');
        return [date, title].filter(Boolean).join(' · ') || 'changelog';
      });
    case 'sem-changelog':
      return metaCard(el, ctx, 'CHANGELOG', ['date', 'name', 'title', 'impacted']);
    case 'sem-workflow':
      return workflow(el, ctx);
    case 'sem-tree':
    case 'sem-file-tree':
    case 'sem-site-tree':
      return tree(el, ctx, tag);
    case 'sem-mockup':
      return box('MOCKUP' + annotationsOf(el, tag), (el.textContent || '').split('\n').map((l) => truncate(l, ctx.cols - 4)), ctx.cols).join('\n');
    case 'sem-question':
      return quiz(el, ctx);
    case 'sem-howto':
    case 'sem-kb':
    case 'sem-runbook':
    case 'sem-plan':
    case 'sem-requirement':
    case 'sem-philosophy':
    case 'sem-threat-model':
    case 'sem-rubric':
    case 'sem-eval':
    case 'sem-profile':
      return metaCard(el, ctx, tag.replace('sem-', '').toUpperCase(), ['status', 'priority', 'scope']);

    default: {
      // Unknown sem-* tag (or a plain HTML child): prose + child blocks.
      if (tag.startsWith('sem-')) {
        const own = normalize(Array.from(el.childNodes)
          .filter((n) => n.nodeType === 3)
          .map((n) => n.nodeValue || '')
          .join(' '));
        const lines = [headLine(el, tag)];
        if (own) lines.push(...indentLines(wrapLine(own, ctx.cols), '  '));
        lines.push(...childBlocks(el, ctx));
        return lines.join('\n');
      }
      const lines = childLines(el, ctx);
      return lines.join('\n');
    }
  }
}

/** Child ELEMENT blocks only (text nodes are handled by the callers). */
function childBlocks(el: Element, ctx: Ctx): string[] {
  const out: string[] = [];
  for (const child of Array.from(el.children)) {
    const block = renderElementAsText(child, { cols: ctx.cols });
    if (block) out.push(...block.split('\n'));
  }
  return out;
}
