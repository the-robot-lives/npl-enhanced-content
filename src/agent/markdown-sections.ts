/**
 * markdown-sections — ".sem.md" (semtext markdown v1) structural parser.
 *
 * SemText's agent toolkit addresses XHTML blocks by id; plain Markdown has
 * no ids at all. This module gives Markdown the same addressing contract:
 * an ATX heading (outside fenced code) opens a virtual section owning the
 * content that follows until a heading of the same or higher level, and
 * an optional authoring marker binds a stable id, kind and tags to it:
 *
 *     <!-- semtext:md v1 -->                  (optional line 1; any .md accepted)
 *     ## Deployment
 *     <sem-section id="deploy" kind="howto" tags="ops,ship"></sem-section>
 *     <sem-tldr>Ship through CI only.</sem-tldr>
 *     Body prose...
 *
 * The line-1 `<!-- semtext:md v1 -->` comment is a label, not a gate: any
 * `.md`/`.markdown` document parses. A `<sem-tldr>` right after the marker
 * (or the heading) is an AUTHORED tldr — focus never auto-overwrites it.
 * `kind="hard-rule"` (or a `data-pin` attribute) pins a section: purpose
 * driven collapse never hides it.
 *
 * Pure string work — no DOM, no fs, no environment. The shapes mirror
 * src/agent/index.ts (OutlineNode / BlockRef) with optional `kind`, `tags`,
 * `tldr`, `pinned` added, so the CLIs can serve both formats through one
 * contract. Minted ids follow the toolkit rule (`x-sec-<slug24>`, `-2`
 * collision suffixes); authored marker ids always win.
 */

/** One parsed section. `children` nest lower-level headings. */
export interface MdSection {
  id: string;
  idSource: 'authored' | 'minted';
  /** ATX level 1-6. */
  level: number;
  heading: string;
  kind?: string;
  tags?: string[];
  /** Authored `<sem-tldr>` text; absent unless the author wrote one. */
  tldr?: string;
  /** `kind="hard-rule"` or `data-pin` — never collapsed. */
  pinned: boolean;
  /** 1-based source line of the heading. */
  line: number;
  /** 1-based source line of a `<sem-tldr data-auto>` block (write-back refresh), else 0. */
  autoTldrLine: number;
  /** Expand body: heading + owned lines (+ nested sections), markup lines
   *  (markers, auto tldr) stripped. */
  text: string;
  /** Owned body only — no heading line, no nested sections. The right text
   *  for per-section summarisation (focus). */
  ownText: string;
  /** Raw source slice of the whole section span (nested sections included). */
  raw: string;
  children: MdSection[];
}

/** OutlineNode shape (mirrors src/agent/index.ts) + section qualifiers. */
export interface MdOutlineNode {
  id: string;
  idSource: 'authored' | 'minted';
  type: 'section';
  label: string;
  level: number;
  summary: string;
  /** Sections in this subtree, self excluded (0 for a leaf) — the same
   *  "blocks in the subtree" slot the XHTML outline uses for records. */
  blocks: number;
  children: MdOutlineNode[];
  kind?: string;
  tags?: string[];
  tldr?: string;
  pinned?: boolean;
}

const SUMMARY_MAX = 90;

function at(s: string, max = SUMMARY_MAX): string {
  return s.length <= max ? s : s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

export function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '');
  return slug || 'block';
}

/** The optional line-1 version label. */
const VERSION_RE = /^\s*<!--\s*semtext:md\s+v\d+\s*-->\s*$/;

/**
 * Whether a document should take the Markdown path: by extension
 * (`.md` / `.markdown` / `.sem.md`, case-insensitive) or by the line-1
 * `<!-- semtext:md vN -->` comment (stdin has no name to inspect).
 */
export function isMarkdownSource(source: string, path?: string | null): boolean {
  if (path && /\.(md|markdown|sem\.md)$/i.test(path)) return true;
  const first = (source.split('\n', 1)[0] || '').trim();
  return VERSION_RE.test(first);
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING_RE = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/;
const SEM_SECTION_RE = /^<sem-section\b([^>]*?)(?:\/>|>\s*<\/sem-section>)\s*$/i;
const SEM_TLDR_RE = /^<sem-tldr\b([^>]*)>([\s\S]*)<\/sem-tldr>\s*$/i;
const ATTR_RE = /([a-zA-Z][\w:-]*)\s*=\s*"([^"]*)"/g;

function parseAttrs(raw: string): { names: Set<string>; values: Map<string, string> } {
  const names = new Set<string>();
  const values = new Map<string, string>();
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(raw))) {
    names.add(m[1].toLowerCase());
    values.set(m[1].toLowerCase(), m[2]);
  }
  // Bare attributes (data-auto, data-pin) count as present-and-true.
  for (const token of raw.split(/\s+/)) {
    if (/^[a-zA-Z][\w:-]*$/.test(token)) names.add(token.toLowerCase());
  }
  return { names, values };
}

function parseMarker(line: string): { id?: string; kind?: string; tags?: string[]; pinned: boolean } | null {
  const m = SEM_SECTION_RE.exec(line.trim());
  if (!m) return null;
  const { names, values } = parseAttrs(m[1]);
  const tagsRaw = values.get('tags');
  return {
    id: values.get('id'),
    kind: values.get('kind'),
    tags: tagsRaw
      ? tagsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined,
    pinned: values.get('kind') === 'hard-rule' || names.has('data-pin')
  };
}

/** Structural scan: headings outside fenced code, in source order. */
function scanHeadings(lines: string[]): { level: number; text: string; index: number }[] {
  const out: { level: number; text: string; index: number }[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const fm = FENCE_RE.exec(lines[i]);
    if (fm) {
      if (!fence) fence = fm[1][0];
      else if (fm[1][0] === fence && fm[1].length >= 3) fence = null;
      continue;
    }
    if (fence) continue;
    const hm = HEADING_RE.exec(lines[i]);
    if (hm) out.push({ level: hm[1].length, text: (hm[2] || '').trim(), index: i });
  }
  return out;
}

/**
 * Parse a Markdown document into a section tree. Content before the first
 * heading is returned as `preamble` (not addressable — Markdown sections
 * start at headings, like the XHTML outline).
 */
export function parseMarkdownSections(source: string): { sections: MdSection[]; preamble: string } {
  const hadFinalNewline = source.endsWith('\n');
  const lines = source.split('\n');
  if (hadFinalNewline) lines.pop();
  const headings = scanHeadings(lines);

  // Authored ids reserve the namespace before minting starts.
  const used = new Set<string>();
  const markers = new Map<number, ReturnType<typeof parseMarker>>();
  const tldrs = new Map<number, { text: string; auto: boolean; index: number }>();
  // Markup lines the expand body drops: marker lines and data-auto tldrs.
  const markupLines = new Set<number>();
  for (const h of headings) {
    // The first non-blank lines after a heading may carry the marker and
    // (right after it) an authored tldr.
    let cursor = h.index + 1;
    while (cursor < lines.length && !lines[cursor].trim()) cursor++;
    const marker = cursor < lines.length ? parseMarker(lines[cursor]) : null;
    if (marker) {
      markers.set(h.index, marker);
      markupLines.add(cursor);
      if (marker.id) used.add(marker.id);
      cursor++;
      while (cursor < lines.length && !lines[cursor].trim()) cursor++;
    }
    const tm = cursor < lines.length ? SEM_TLDR_RE.exec(lines[cursor].trim()) : null;
    if (tm) {
      const attrs = parseAttrs(tm[1]);
      const entry = { text: tm[2].trim(), auto: attrs.names.has('data-auto'), index: cursor };
      tldrs.set(h.index, entry);
      if (entry.auto) markupLines.add(cursor);
    }
  }

  const counts = new Map<string, number>();
  function mint(heading: string): string {
    const n = (counts.get('sec') || 0) + 1;
    counts.set('sec', n);
    const candidate = 'x-sec-' + slugify(heading);
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    let k = 2;
    while (used.has(candidate + '-' + k)) k++;
    const final = candidate + '-' + k;
    used.add(final);
    return final;
  }

  /** Markup lines the expand body drops: markers + auto tldrs. */
  function bodyLines(from: number, to: number): string[] {
    const out: string[] = [];
    for (let i = from; i < to; i++) {
      if (markupLines.has(i)) continue;
      out.push(lines[i]);
    }
    return out;
  }

  const roots: MdSection[] = [];
  const stack: MdSection[] = [];
  for (let hi = 0; hi < headings.length; hi++) {
    const h = headings[hi];
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    // Span: everything up to the next heading of the same or higher level.
    let end = lines.length;
    for (let j = hi + 1; j < headings.length; j++) {
      if (headings[j].level <= h.level) {
        end = headings[j].index;
        break;
      }
    }
    // Own lines stop at the first nested heading of any level.
    let ownEnd = end;
    for (let j = hi + 1; j < headings.length; j++) {
      if (headings[j].index < end && headings[j].level > h.level) {
        ownEnd = headings[j].index;
        break;
      }
    }
    const marker = markers.get(h.index);
    const tldrEntry = tldrs.get(h.index);
    const own = bodyLines(h.index + 1, ownEnd);
    const nested = bodyLines(ownEnd, end);
    const text = ['#'.repeat(h.level) + ' ' + h.text, ...own, ...nested]
      .join('\n')
      .replace(/[ \t]+$/gm, '')
      .replace(/^\n+/, '')
      .replace(/\s+$/, '');
    const rawSlice = lines.slice(h.index, end).join('\n');
    const sec: MdSection = {
      id: (marker && marker.id) || mint(h.text || 'section'),
      idSource: marker && marker.id ? 'authored' : 'minted',
      level: h.level,
      heading: h.text,
      kind: marker?.kind,
      tags: marker?.tags,
      tldr: tldrEntry && !tldrEntry.auto ? tldrEntry.text : undefined,
      pinned: !!marker?.pinned,
      line: h.index + 1,
      autoTldrLine: tldrEntry?.auto ? tldrEntry.index + 1 : 0,
      text,
      ownText: own.join('\n').replace(/\s+$/, ''),
      raw: hadFinalNewline ? rawSlice + '\n' : rawSlice,
      children: []
    };
    if (stack.length) stack[stack.length - 1].children.push(sec);
    else roots.push(sec);
    stack.push(sec);
  }

  const preambleEnd = headings.length ? headings[0].index : lines.length;
  return { sections: roots, preamble: lines.slice(0, preambleEnd).join('\n') };
}

/** Flatten the tree in document order. */
export function flattenSections(sections: MdSection[]): MdSection[] {
  const out: MdSection[] = [];
  for (const s of sections) {
    out.push(s);
    out.push(...flattenSections(s.children));
  }
  return out;
}

function toOutlineNode(s: MdSection): MdOutlineNode {
  return {
    id: s.id,
    idSource: s.idSource,
    type: 'section',
    label: at(s.heading),
    level: s.level,
    summary: at(s.heading),
    blocks: 0,
    children: s.children.map(toOutlineNode),
    ...(s.kind !== undefined ? { kind: s.kind } : {}),
    ...(s.tags ? { tags: s.tags } : {}),
    ...(s.tldr !== undefined ? { tldr: s.tldr } : {}),
    ...(s.pinned ? { pinned: true } : {})
  };
}

function countBlocks(nodes: MdOutlineNode[]): number {
  let total = 0;
  for (const n of nodes) {
    total += 1 + countBlocks(n.children);
  }
  return total;
}

function applyBlocks(nodes: MdOutlineNode[]): number {
  // blocks = sections in the subtree, self excluded (leaf = 0).
  for (const n of nodes) n.blocks = countBlocks(n.children);
  let total = nodes.length;
  for (const n of nodes) total += applyBlocks(n.children);
  return total;
}

/** Collapsed heading tree — the OutlineNode contract for Markdown. */
export function mdOutline(source: string, maxDepth = Infinity): MdOutlineNode[] {
  const { sections } = parseMarkdownSections(source);
  const nodes = sections.map(toOutlineNode);
  applyBlocks(nodes);
  if (maxDepth !== Infinity) prune(nodes, maxDepth);
  return nodes;
}

function prune(nodes: MdOutlineNode[], maxDepth: number, depth = 1): void {
  for (const n of nodes) {
    if (depth >= maxDepth) n.children = [];
    else prune(n.children, maxDepth, depth + 1);
  }
}

function findSection(sections: MdSection[], id: string): MdSection | null {
  for (const s of sections) {
    if (s.id === id) return s;
    const hit = findSection(s.children, id);
    if (hit) return hit;
  }
  return null;
}

/**
 * One section in full. `format: 'text'` is the annotated expand body
 * (markup lines stripped); `'xhtml'` returns the section's raw Markdown
 * source slice — Markdown has no XHTML form, and the raw slice is the
 * lossless canonical payload (the CLI documents this).
 */
export function mdExpand(source: string, id: string, format: 'text' | 'xhtml' = 'text'): string {
  const { sections } = parseMarkdownSections(source);
  const sec = findSection(sections, id);
  if (!sec) throw new Error(`no block with id "${id}" — run outline first`);
  if (format === 'xhtml') return sec.raw;
  return '[' + sec.id + '] section\n' + sec.text;
}

export interface MdFilterOpts {
  type?: string;
  id?: string;
  kind?: string;
  tag?: string;
  /** Case-insensitive substring of the section body. */
  text?: string;
}

export interface MdSectionHit {
  id: string;
  idSource: 'authored' | 'minted';
  type: 'section';
  level: number;
  kind?: string;
  tags?: string[];
  tldr?: string;
  pinned: boolean;
  label: string;
  summary: string;
  record: null;
  /** Raw source slice of the section span. */
  content: string;
  /** Expand body (text form). */
  text: string;
}

/**
 * Select Markdown sections by id / kind / tag / text — the record-filter
 * contract for `.md` documents. `type` accepts `section` (or `sem-section`);
 * audience/attribute/selector criteria are XHTML-only.
 */
export function mdFilter(source: string, opts: MdFilterOpts = {}): MdSectionHit[] {
  const { sections } = parseMarkdownSections(source);
  const all = flattenSections(sections);
  const want = opts.type
    ? opts.type.trim().toLowerCase().replace(/^sem-/, '')
    : null;
  if (want && want !== 'section') {
    throw new Error(`markdown documents have no "${opts.type}" records — sections only`);
  }
  const needle = opts.text ? opts.text.toLowerCase() : null;
  return all
    .filter((s) => {
      if (opts.id && s.id !== opts.id) return false;
      if (opts.kind && s.kind !== opts.kind) return false;
      if (opts.tag && !(s.tags || []).includes(opts.tag)) return false;
      if (needle !== null && !s.text.toLowerCase().includes(needle)) return false;
      return true;
    })
    .map((s) => ({
      id: s.id,
      idSource: s.idSource,
      type: 'section' as const,
      level: s.level,
      ...(s.kind !== undefined ? { kind: s.kind } : {}),
      ...(s.tags ? { tags: s.tags } : {}),
      ...(s.tldr !== undefined ? { tldr: s.tldr } : {}),
      pinned: s.pinned,
      label: at(s.heading),
      summary: at(s.heading),
      record: null,
      content: s.raw,
      text: s.text
    }));
}
