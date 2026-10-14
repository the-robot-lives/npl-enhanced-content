/**
 * SemText — agent toolkit.
 *
 * The machine-facing half of the vocabulary: filter, search, outline /
 * lazy expand, write (Markdown or SemText fragment in, valid SemText XHTML
 * out) and surgical edit-by-id, all on top of the canonical extractor
 * (`src/extract`). Normative contracts: spec/conventions.md (§8 machine
 * readability), spec/extraction.md. CLI front end: bin/semtext-agent.mjs.
 *
 * Bundled as `dist/semtext-agent.js` (global `SemTextAgent`) by the same
 * build as the other artifacts. Same vanilla-tier rules as `src/extract`:
 * no runtime dependency, no fetch, no top-level await, no environment
 * access — every function takes the parsed DOM (or plain strings) and is
 * pure: parsing lives with the caller (the CLI uses happy-dom, a page can
 * pass `document`), so the module never chooses an HTML parser.
 *
 * Addressing. Every command speaks in BLOCK ids: the authored `id`
 * attribute when an element has one, otherwise a minted id derived from
 * the element's type and text (`x-note-rotation-per-session`). Minting is
 * a pure function of the document, so ids an agent reads back from
 * `outline` resolve in `expand` and `edit` on the same file. Minted ids
 * carry the `x-` prefix; authored ids always win.
 */

import {
  extractRecordPairs,
  renderRecordsAsText,
  type RecordPair,
  type SemRecord
} from '../extract/records.js';
import { deriveSummary, normalize } from '../shared/summary.js';
import { normalizeMd } from '../shared/mdsource.js';

// Re-exported so consumers of the agent bundle keep the canonical text
// renderer on hand without loading a second artifact.
export { renderRecordsAsText, extractRecords } from '../extract/records.js';

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

/** One addressable block: a record, a heading (virtual section), or any
 *  authored-id element. `id` is authored or minted (never both sources). */
export interface BlockRef {
  el: Element;
  id: string;
  idSource: 'authored' | 'minted';
  /** Record type (`sem-fact`), `section` for headings, or the tag name. */
  type: string;
  /** Heading level 1-6 for sections, 0 otherwise. */
  level: number;
  /** The extracted record when the block mints one. */
  record: SemRecord | null;
  /** One-line human summary (≤ 90 chars). */
  summary: string;
  /** Heading text for sections; record text otherwise. */
  label: string;
}

export interface OutlineNode {
  id: string;
  idSource: 'authored' | 'minted';
  type: string;
  label: string;
  /** Heading level for sections; nesting depth of a record under its
   *  nearest record ancestor, root entries at 0. */
  level: number;
  summary: string;
  /** Record blocks in this subtree (the node itself included). */
  blocks: number;
  children: OutlineNode[];
}

export interface FilterOpts {
  /** Record type; `fact` and `sem-fact` both accepted. */
  type?: string;
  id?: string;
  kind?: string;
  /** One `data-tags` token. */
  tag?: string;
  /** Audience profile name; negation (`!operator`) and profile
   *  `implies` chains are honoured (spec/schema/sem-audiences.md). */
  audience?: string;
  /** Element attribute test: `"name"` (present) or `"name=value"`. */
  attr?: string;
  /** CSS selector run against the parsed document. */
  selector?: string;
  /** Case-insensitive substring over the record's normalised text. */
  text?: string;
}

export interface SearchOpts {
  /** Interpret `query` as a case-insensitive RegExp. */
  regex?: boolean;
  /** Attribute search: match attribute values instead of record text. */
  attrs?: boolean;
  /** Context characters around each match (default 48). */
  context?: number;
}

export interface SearchHit {
  id: string;
  type: string;
  /** Which payload matched: `text`, `id`, `kind`, `tags`, `audience`,
   *  a field name (`statement`, `source`, …), or the attribute name. */
  field: string;
  match: string;
  context: string;
}

export interface WriteOpts {
  /** `md` wraps Markdown into a `sem-md` block; `semtext` canonicalises a
   *  SemText/HTML fragment. Default: `semtext` when the input starts with
   *  `<`, else `md`. */
  format?: 'md' | 'semtext';
  /** Id for the produced block (minted from the content when omitted). */
  id?: string;
  label?: string;
  kind?: string;
  tags?: string;
  audience?: string;
  /** Emit `div class="sem-md"` (v0.4 alias) instead of the canonical
   *  `<sem-md>` tag form. */
  classForm?: boolean;
  /** Wrap a fragment that carries vocabulary in `<sem-enhanced-document>`:
   *  `auto` (default) wraps only when a root is missing, `always` /
   *  `never` force it. */
  wrap?: 'auto' | 'always' | 'never';
}

export interface WriteResult {
  xhtml: string;
  /** Id of the produced block (md) or of the first minted/authored block
   *  (semtext); null when the fragment carries none. */
  id: string | null;
  /** Whether a `<sem-enhanced-document>` root was added. */
  rootWrapped: boolean;
  /** Ids minted during the write (authored ids are not listed). */
  ids: string[];
}

export interface BlockSpan {
  tag: string;
  /** Offset of `<`. */
  start: number;
  /** Just past the opening tag's `>`. */
  innerStart: number;
  /** Offset of the matching `</tag>`, or === innerStart when empty. */
  innerEnd: number;
  /** Just past the closing `>` (or the open tag when void/self-closed). */
  end: number;
  /** 1-based source line of `<`. */
  line: number;
}

/* ------------------------------------------------------------------ *
 * Small helpers (no library, no mutation)
 * ------------------------------------------------------------------ */

const SUMMARY_MAX = 90;

function at(s: string, max = SUMMARY_MAX): string {
  return s.length <= max ? s : s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '');
  return slug || 'block';
}

function isHeading(el: Element): boolean {
  return /^(h[1-6])$/.test(el.tagName.toLowerCase());
}

function headingLevel(el: Element): number {
  return Number(el.tagName.toLowerCase()[1]);
}

function isMdHeading(el: Element): boolean {
  // Markdown headings inside a sem-md block are the block's text, not
  // document structure.
  let cur: Element | null = el.parentElement;
  while (cur) {
    const tag = cur.tagName.toLowerCase();
    if (tag === 'sem-md' || cur.classList.contains('sem-md')) return true;
    cur = cur.parentElement;
  }
  return false;
}

function attrAny(el: Element, name: string): string | null {
  return el.getAttribute(name) ?? el.getAttribute('data-' + name);
}

/** Document-order index for every element under `root`. */
function docOrder(root: Element): Map<Element, number> {
  const order = new Map<Element, number>();
  const all = root.querySelectorAll('*');
  for (let i = 0; i < all.length; i++) order.set(all[i], i);
  return order;
}

/* ------------------------------------------------------------------ *
 * Audience resolution (spec/schema/sem-audiences.md)
 * ------------------------------------------------------------------ */

/**
 * Profile name → the set of names it satisfies (itself + the transitive
 * closure of `implies`). Profiles are `sem-profile` / `.sem-profile`
 * elements keyed by their `id`.
 */
export function audienceProfiles(root: Element): Map<string, Set<string>> {
  const raw = new Map<string, string[]>();
  const list = root.querySelectorAll('sem-profile, .sem-profile');
  for (let i = 0; i < list.length; i++) {
    const el = list[i];
    const name = el.getAttribute('id');
    if (!name) continue;
    const impliesRaw = attrAny(el, 'implies') || '';
    raw.set(
      name,
      impliesRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }
  const out = new Map<string, Set<string>>();
  for (const name of raw.keys()) {
    const seen = new Set<string>([name]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const member of seen) {
        for (const implied of raw.get(member) || []) {
          if (!seen.has(implied)) {
            seen.add(implied);
            grew = true;
          }
        }
      }
    }
    out.set(name, seen);
  }
  return out;
}

/**
 * Whether content carrying `audienceAttr` is visible to `profile`.
 * No profile → no filtering. Unqualified content is for everyone. A token
 * list passes when every positive token names the profile (or a profile
 * it implies) and no `!negative` token does.
 */
export function visibleTo(
  audienceAttr: string | null,
  profile: string | undefined,
  profiles: Map<string, Set<string>>
): boolean {
  if (!profile) return true;
  if (!audienceAttr) return true;
  const implied = profiles.get(profile) || new Set<string>([profile]);
  const tokens = audienceAttr.split(',').map((s) => s.trim()).filter(Boolean);
  for (const token of tokens) {
    if (token[0] === '!') {
      if (implied.has(token.slice(1).trim())) return false;
    } else if (!implied.has(token)) {
      return false;
    }
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Block collection + id minting
 * ------------------------------------------------------------------ */

/**
 * Every addressable block of a document, in document order: record
 * elements (from the canonical extractor), headings (virtual sections,
 * markdown headings inside `sem-md` excluded), and any other authored-id
 * element. Minted ids are a pure function of the document: assigned in
 * document order, never colliding with an authored id.
 */
export function collectBlocks(root: Element): BlockRef[] {
  const pairs = extractRecordPairs(root);
  const byEl = new Map<Element, RecordPair>();
  for (const p of pairs) byEl.set(p.el, p);

  const refs: BlockRef[] = [];
  const used = new Set<string>();
  const all = root.querySelectorAll('*');
  for (let i = 0; i < all.length; i++) {
    const id = all[i].getAttribute('id');
    if (id) used.add(id);
  }

  const counts = new Map<string, number>();
  function mint(prefix: string, text: string): string {
    const n = (counts.get(prefix) || 0) + 1;
    counts.set(prefix, n);
    let candidate = 'x-' + prefix + '-' + slugify(text);
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

  // Candidates in document order: headings + records, then authored-id
  // elements that are neither (addressable, but not outlined).
  const order = docOrder(root);
  type Cand = { el: Element; kind: 'section' | 'record' | 'anchor'; pair: RecordPair | null };
  const cands: Cand[] = [];
  const heads = root.querySelectorAll('h1, h2, h3, h4, h5, h6');
  for (let i = 0; i < heads.length; i++) {
    if (!isMdHeading(heads[i])) cands.push({ el: heads[i], kind: 'section', pair: null });
  }
  for (const p of pairs) cands.push({ el: p.el, kind: 'record', pair: p });
  const ided = root.querySelectorAll('[id]');
  for (let i = 0; i < ided.length; i++) {
    const el = ided[i];
    if (byEl.has(el) || isHeading(el)) continue;
    cands.push({ el: el, kind: 'anchor', pair: null });
  }
  cands.sort((a, b) => (order.get(a.el) ?? 0) - (order.get(b.el) ?? 0));

  for (const c of cands) {
    const authored = c.el.getAttribute('id');
    let ref: BlockRef;
    if (c.kind === 'section') {
      const label = normalize(c.el.textContent);
      ref = {
        el: c.el,
        id: authored || mint('sec', label),
        idSource: authored ? 'authored' : 'minted',
        type: 'section',
        level: headingLevel(c.el),
        record: null,
        summary: at(label),
        label: label
      };
    } else if (c.pair) {
      const r = c.pair.record;
      ref = {
        el: c.el,
        id: authored || mint(r.type.replace(/^sem-/, ''), r.text || r.type),
        idSource: authored ? 'authored' : 'minted',
        type: r.type,
        level: 0,
        record: r,
        summary: at(r.text || r.type),
        label: at(r.text || r.type)
      };
    } else {
      const label = normalize(c.el.textContent);
      ref = {
        el: c.el,
        id: authored as string,
        idSource: 'authored',
        type: c.el.tagName.toLowerCase(),
        level: 0,
        record: null,
        summary: at(label),
        label: label
      };
    }
    refs.push(ref);
  }
  return refs;
}

function findBlock(refs: BlockRef[], id: string): BlockRef | null {
  for (const r of refs) if (r.id === id) return r;
  return null;
}

/* ------------------------------------------------------------------ *
 * Outline + lazy expand
 * ------------------------------------------------------------------ */

/**
 * Compact outline: heading-based virtual sections (a heading owns the
 * blocks that follow it until a heading of the same or higher level) and
 * record blocks nested under their nearest record ancestor. Collapsed by
 * construction — one summary line per block; bodies come from `expand`.
 */
export function outline(root: Element, maxDepth = Infinity): OutlineNode[] {
  const refs = collectBlocks(root).filter((r) => r.type === 'section' || r.record);
  const topLevel: OutlineNode[] = [];
  const sections: OutlineNode[] = [];
  const recordNodes = new Map<Element, OutlineNode>();
  let total = 0;

  for (const ref of refs) {
    const node: OutlineNode = {
      id: ref.id,
      idSource: ref.idSource,
      type: ref.type,
      label: at(ref.label),
      level: ref.level,
      summary: ref.summary,
      blocks: ref.record ? 1 : 0,
      children: []
    };
    total++;
    if (ref.type === 'section') {
      while (sections.length && sections[sections.length - 1].level >= ref.level) sections.pop();
      (sections.length ? sections[sections.length - 1].children : topLevel).push(node);
      sections.push(node);
      continue;
    }
    // Record: nest under the nearest ancestor record, else the current
    // section, else the top level.
    let cur: Element | null = ref.el.parentElement;
    let parent: OutlineNode | null = null;
    while (cur) {
      const hit = recordNodes.get(cur);
      if (hit) {
        parent = hit;
        break;
      }
      cur = cur.parentElement;
    }
    if (!parent && sections.length) parent = sections[sections.length - 1];
    // `blocks` counts records in the subtree: the node, every ancestor
    // record, and every open section.
    node.blocks = 1;
    let anc: Element | null = ref.el.parentElement;
    while (anc) {
      const hit = recordNodes.get(anc);
      if (hit) hit.blocks++;
      anc = anc.parentElement;
    }
    for (const s of sections) s.blocks++;
    recordNodes.set(ref.el, node);
    (parent ? parent.children : topLevel).push(node);
  }

  if (maxDepth !== Infinity) prune(topLevel, maxDepth);
  return topLevel;
}

function prune(nodes: OutlineNode[], maxDepth: number, depth = 1): void {
  for (const n of nodes) {
    if (depth >= maxDepth) n.children = [];
    else prune(n.children, maxDepth, depth + 1);
  }
}

/**
 * Render the content region of one block as annotated plain text.
 * A heading resolves to its virtual section (the heading plus following
 * siblings until a heading of the same or higher level); any other block
 * resolves to its own element. Lazy by contract: only the requested
 * subtree is materialised.
 */
export function expand(root: Element, id: string, format: 'text' | 'xhtml' = 'text'): string {
  const refs = collectBlocks(root);
  const ref = findBlock(refs, id);
  let el: Element | null = ref ? ref.el : null;
  if (!el) {
    // Any authored id is addressable even when it is not a block.
    const ided = root.querySelectorAll('[id]');
    for (let i = 0; i < ided.length; i++) {
      if (ided[i].getAttribute('id') === id) {
        el = ided[i];
        break;
      }
    }
  }
  if (!el) throw new Error(`no block with id "${id}" — run outline first`);
  if (format === 'xhtml') return serialize(el);

  const isSection = !!ref && ref.type === 'section';
  const lines: string[] = [];
  lines.push('[' + (ref ? ref.id : id) + '] ' + (ref ? ref.type : 'anchor'));
  if (isSection) {
    const sec = ref as BlockRef;
    lines.push('#'.repeat(sec.level) + ' ' + sec.label);
  }
  const region = regionOf(el);
  const recordEls = new Set(extractRecordPairs(region.root).map((p) => p.el));
  renderRegion(region, isSection ? (el as Element) : null, lines, recordEls);
  return lines.join('\n');
}

interface Region {
  nodes: Node[];
  root: Element;
}

/** Heading → its virtual section; anything else → itself. */
function regionOf(el: Element): Region {
  if (isHeading(el) && el.parentElement) {
    const level = headingLevel(el);
    const nodes: Node[] = [el];
    const siblings = el.parentElement.children;
    let after = false;
    for (let i = 0; i < siblings.length; i++) {
      const s = siblings[i];
      if (s === el) {
        after = true;
        continue;
      }
      if (after) {
        if (isHeading(s) && headingLevel(s) <= level) break;
        nodes.push(s);
      }
    }
    return { nodes: nodes, root: el.parentElement };
  }
  return { nodes: [el], root: el };
}

/** Render region content in document order, records via the canonical
 *  text renderer, prose as plain text, headings as `#` lines. */
function renderRegion(region: Region, skipHeading: Element | null, lines: string[], recordEls: Set<Element>): void {
  for (const node of region.nodes) {
    if (node.nodeType !== 1) {
      if (node.nodeType === 3 && normalize(node.nodeValue || '')) {
        lines.push(normalize(node.nodeValue as string));
      }
      continue;
    }
    const el = node as Element;
    if (el === skipHeading) continue;
    if (recordEls.has(el)) {
      const rendered = renderRecordsAsText(extractRecordPairs(el).map((p) => p.record));
      if (rendered) lines.push(rendered);
      continue;
    }
    if (isHeading(el) && el !== skipHeading) {
      lines.push('#'.repeat(headingLevel(el)) + ' ' + normalize(el.textContent || ''));
      continue;
    }
    // Plain element: descend when it wraps records or headings, else emit
    // its own text (avoids double emission of record text).
    const structured = el.querySelector('*') && Array.from(el.children).some(
      (c) => recordEls.has(c) || isHeading(c)
    );
    if (structured) {
      renderRegion({ nodes: Array.from(el.childNodes), root: el }, skipHeading, lines, recordEls);
    } else {
      const text = normalize(el.textContent || '');
      if (text) lines.push(text);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Filter
 * ------------------------------------------------------------------ */

function normalizeType(t: string): string {
  t = t.trim().toLowerCase();
  return t.indexOf('sem-') === 0 || t === 'section' ? t : 'sem-' + t;
}

/**
 * Select records by element type, id, kind, tag, audience, attribute
 * test, or CSS selector — all AND-combined. Returns the matching blocks
 * (element + minted-or-authored id + canonical record).
 */
export function filterBlocks(root: Element, opts: FilterOpts = {}): BlockRef[] {
  const refs = collectBlocks(root).filter((r) => r.record);
  const profiles = opts.audience ? audienceProfiles(root) : null;
  let selectorSet: Set<Element> | null = null;
  if (opts.selector) {
    selectorSet = new Set<Element>();
    let list: NodeListOf<Element>;
    try {
      list = root.querySelectorAll(opts.selector);
    } catch {
      throw new Error(`invalid selector "${opts.selector}"`);
    }
    for (let i = 0; i < list.length; i++) selectorSet.add(list[i]);
  }
  let attrName: string | null = null;
  let attrValue: string | null = null;
  if (opts.attr) {
    const eq = opts.attr.indexOf('=');
    if (eq === -1) attrName = opts.attr;
    else {
      attrName = opts.attr.slice(0, eq);
      attrValue = opts.attr.slice(eq + 1);
    }
  }
  const want = opts.type ? normalizeType(opts.type) : null;
  const needle = opts.text ? opts.text.toLowerCase() : null;
  return refs.filter((r) => {
    const rec = r.record as SemRecord;
    if (want && rec.type !== want) return false;
    if (needle !== null && !rec.text.toLowerCase().includes(needle)) return false;
    if (opts.id && rec.id !== opts.id && r.id !== opts.id) return false;
    if (opts.kind && rec.kind !== opts.kind) return false;
    if (opts.tag && !rec.tags.includes(opts.tag)) return false;
    if (opts.audience && !visibleTo(rec.audience, opts.audience, profiles as Map<string, Set<string>>)) return false;
    if (attrName !== null) {
      const v = attrAny(r.el, attrName);
      if (v === null) return false;
      if (attrValue !== null && v !== attrValue) return false;
    }
    if (selectorSet && !selectorSet.has(r.el)) return false;
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

function fieldStrings(rec: SemRecord): [string, string][] {
  const out: [string, string][] = [['text', rec.text]];
  if (rec.id) out.push(['id', rec.id]);
  if (rec.kind) out.push(['kind', rec.kind]);
  if (rec.audience) out.push(['audience', rec.audience]);
  if (rec.tags.length) out.push(['tags', rec.tags.join(' ')]);
  for (const [k, v] of Object.entries(rec.fields)) {
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) out.push([k, v.map(String).join(' ')]);
    } else if (typeof v !== 'object') {
      out.push([k, String(v)]);
    }
  }
  return out;
}

function contextAround(s: string, index: number, length: number, ctx: number): string {
  const from = Math.max(0, index - ctx);
  const to = Math.min(s.length, index + length + ctx);
  return (from > 0 ? '…' : '') + s.slice(from, to) + (to < s.length ? '…' : '');
}

/**
 * Search record payloads (default) or element attributes (`opts.attrs`).
 * Returns addressable hits: block id, what matched, and a short context
 * window. Only blocks an agent can address (block id or authored id) are
 * reported.
 */
export function searchBlocks(root: Element, query: string, opts: SearchOpts = {}): SearchHit[] {
  if (!query) return [];
  const ctx = opts.context === undefined ? 48 : opts.context;
  const hits: SearchHit[] = [];
  const matcher: (s: string) => number = opts.regex
    ? (s) => {
        const re = new RegExp(query, 'i');
        const m = re.exec(s);
        return m ? m.index : -1;
      }
    : (s) => s.toLowerCase().indexOf(query.toLowerCase());

  if (opts.attrs) {
    const addressable = new Map<Element, BlockRef>();
    for (const r of collectBlocks(root)) addressable.set(r.el, r);
    const all = root.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      const ref = addressable.get(el);
      if (!ref) continue; // unaddressable elements would orphan the hit
      for (const a of Array.from(el.attributes)) {
        const haystack = a.name + '=' + a.value;
        const at = matcher(haystack);
        if (at < 0) continue;
        hits.push({
          id: ref.id,
          type: ref.type,
          field: a.name,
          match: a.name + '=' + a.value,
          context: contextAround(haystack, at, query.length, ctx)
        });
      }
    }
    return hits;
  }

  for (const ref of collectBlocks(root)) {
    const rec = ref.record;
    if (!rec) continue;
    for (const [field, value] of fieldStrings(rec)) {
      const at = matcher(value);
      if (at < 0) continue;
      hits.push({
        id: ref.id,
        type: ref.type,
        field: field,
        match: value.slice(at, at + query.length),
        context: contextAround(value, at, query.length, ctx)
      });
    }
  }
  return hits;
}

/* ------------------------------------------------------------------ *
 * Serialization (canonical XHTML)
 * ------------------------------------------------------------------ */

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr'
]);
const RAW_TAGS = new Set(['script', 'style']);

function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/** Serialize one element as canonical XHTML (double quotes, XML-style
 *  void elements, `&`, `<`, `>` escaped in text; raw text kept for
 *  script/style). Whitespace is preserved as parsed. */
export function serialize(el: Element): string {
  const tag = el.tagName.toLowerCase();
  let out = '<' + tag;
  for (const a of Array.from(el.attributes)) {
    out += ' ' + a.name + '="' + escAttr(a.value) + '"';
  }
  if (VOID_TAGS.has(tag)) return out + ' />';
  out += '>';
  if (RAW_TAGS.has(tag)) {
    // XHTML treats script/style content as #PCDATA (C.4): escape `<`/`&`
    // so a literal `</script` inside the source stays well-formed instead
    // of terminating the element mid-text for XML consumers.
    out += escText(el.textContent || '');
  } else {
    for (const n of Array.from(el.childNodes)) out += serializeNode(n);
  }
  return out + '</' + tag + '>';
}

function serializeNode(n: Node): string {
  if (n.nodeType === 3) return escText(n.nodeValue || '');
  if (n.nodeType === 8) return '<!--' + (n.nodeValue || '') + '-->';
  if (n.nodeType === 1) return serialize(n as Element);
  return '';
}

/** Serialize the children of an element (fragment form of `serialize`). */
export function serializeChildren(el: Element): string {
  let out = '';
  for (const n of Array.from(el.childNodes)) out += serializeNode(n);
  return out;
}

/* ------------------------------------------------------------------ *
 * Write — Markdown or SemText fragment in, valid SemText XHTML out
 * ------------------------------------------------------------------ */

function attrString(opts: WriteOpts, classForm: boolean): string {
  const parts: string[] = [];
  const push = (bare: string, value: string | undefined): void => {
    if (!value) return;
    parts.push((classForm ? 'data-' : '') + bare + '="' + escAttr(value) + '"');
  };
  push('kind', opts.kind);
  push('tags', opts.tags);
  push('audience', opts.audience);
  return parts.join(' ');
}

/**
 * Markdown in → a `sem-md` block (the format's designated Markdown
 * carrier; source normalised per spec/schema/sem-md.md). SemText fragment
 * in → canonicalised XHTML: ids minted for id-less record blocks, wrapped
 * in `<sem-enhanced-document>` when the fragment carries vocabulary
 * without a root. The caller supplies the parser; nothing here touches an
 * environment.
 */
export function writeFragment(
  parse: (src: string) => Document,
  input: string,
  opts: WriteOpts = {}
): WriteResult {
  const format = opts.format || (input.trimStart()[0] === '<' ? 'semtext' : 'md');
  if (format === 'md') {
    const classForm = !!opts.classForm;
    const source = normalizeMd(input);
    const id = opts.id || 'x-md-' + slugify(source.split('\n')[0] || 'markdown');
    const attrs = [classForm ? 'class="sem-md"' : '', 'id="' + escAttr(id) + '"'];
    const label = opts.label ? (classForm ? 'data-label' : 'label') + '="' + escAttr(opts.label) + '"' : '';
    if (label) attrs.push(label);
    const qualifiers = attrString(opts, classForm);
    if (qualifiers) attrs.push(qualifiers);
    const open = '<' + (classForm ? 'div' : 'sem-md') + (attrs.some(Boolean) ? ' ' : '') + attrs.filter(Boolean).join(' ') + '>';
    return {
      xhtml: open + '\n' + escText(source) + '\n</' + (classForm ? 'div' : 'sem-md') + '>',
      id: id,
      rootWrapped: false,
      ids: [id]
    };
  }

  const doc = parse(input);
  const body = doc.body || (doc.documentElement as HTMLElement);
  const hasRoot = !!body.querySelector('sem-enhanced-document, .sem-enhanced-document');
  const vocab = hasVocabulary(body);
  let rootWrapped = false;
  if ((opts.wrap === 'always' || (opts.wrap !== 'never' && vocab && !hasRoot)) && !hasRoot) {
    const rootEl = doc.createElement('sem-enhanced-document');
    while (body.firstChild) rootEl.appendChild(body.firstChild);
    body.appendChild(rootEl);
    rootWrapped = true;
  }
  const ids: string[] = [];
  const pairs = extractRecordPairs(body);
  const used = new Set<string>();
  const ided = body.querySelectorAll('[id]');
  for (let i = 0; i < ided.length; i++) used.add(ided[i].getAttribute('id') as string);
  const counts = new Map<string, number>();
  for (const p of pairs) {
    if (p.record.id) {
      ids.push(p.record.id);
      continue;
    }
    const prefix = p.record.type.replace(/^sem-/, '');
    const n = (counts.get(prefix) || 0) + 1;
    counts.set(prefix, n);
    let candidate = 'x-' + prefix + '-' + slugify(p.record.text || p.record.type);
    let k = 2;
    while (used.has(candidate)) candidate = 'x-' + prefix + '-' + slugify(p.record.text || p.record.type) + '-' + k++;
    used.add(candidate);
    p.el.setAttribute('id', candidate);
    p.record.id = candidate;
    ids.push(candidate);
  }
  const first = pairs.length ? pairs[0].record.id : null;
  return { xhtml: serializeChildren(body).trim(), id: first, rootWrapped: rootWrapped, ids: ids };
}

function hasVocabulary(scope: Element): boolean {
  const all = scope.querySelectorAll('*');
  for (let i = 0; i < all.length; i++) {
    const tag = all[i].tagName.toLowerCase();
    if (tag.indexOf('sem-') === 0) return true;
    const cls = all[i].getAttribute('class') || '';
    for (const c of cls.split(/\s+/)) if (c.indexOf('sem-') === 0) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Edit — surgical, source-level replace of one block
 * ------------------------------------------------------------------ */

type SpanWithMatch = BlockSpan & { idMatched?: boolean };

/**
 * Locate one element's source span by id, without a parser: an open-tag
 * scan with a stack, comments and raw-text bodies skipped. Exact byte
 * offsets are what makes the edit surgical — everything outside the span
 * survives untouched.
 */
export function locateBlock(source: string, id: string): BlockSpan | null {
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)(\/?)>/g;
  const idRe = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/;
  const stack: { tag: string; span: BlockSpan }[] = [];
  let m: RegExpExecArray | null;
  let pos = 0;
  while (pos < source.length) {
    const lt = source.indexOf('<', pos);
    if (lt < 0) break;
    if (source.startsWith('<!--', lt)) {
      const close = source.indexOf('-->', lt + 4);
      pos = close < 0 ? source.length : close + 3;
      continue;
    }
    tagRe.lastIndex = lt;
    m = tagRe.exec(source);
    if (!m || m.index !== lt) {
      // A `<` that does not open a tag (text like `a < b`): step past it.
      pos = lt + 1;
      continue;
    }
    pos = tagRe.lastIndex;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          const entry = stack[i];
          stack.length = i;
          entry.span.innerEnd = m.index;
          entry.span.end = pos;
          if ((entry.span as SpanWithMatch).idMatched) return entry.span;
          break;
        }
      }
      continue;
    }
    const attrs = m[3];
    const idm = idRe.exec(attrs);
    const line = 1 + countLines(source, lt);
    const span: BlockSpan & { idMatched?: boolean } = {
      tag: tag,
      start: lt,
      innerStart: pos,
      innerEnd: pos,
      end: pos,
      line: line
    };
    if (idm && (idm[1] !== undefined ? idm[1] : idm[2] !== undefined ? idm[2] : idm[3]) === id) {
      span.idMatched = true;
    }
    const selfClosed = m[4] === '/';
    if (selfClosed || VOID_TAGS.has(tag)) {
      if (span.idMatched) return span;
      continue;
    }
    stack.push({ tag: tag, span: span });
    if (RAW_TAGS.has(tag)) {
      const closeRe = new RegExp('</' + tag + '\\s*>', 'i');
      closeRe.lastIndex = pos;
      const cm = closeRe.exec(source);
      // Do not tokenize inside raw text; emit the span when it matches.
      if (span.idMatched) {
        span.innerEnd = cm ? cm.index : source.length;
        span.end = cm ? closeRe.lastIndex : source.length;
        return span;
      }
      pos = cm ? closeRe.lastIndex : source.length;
      stack.pop();
    }
  }
  return null;
}

function countLines(s: string, to: number): number {
  let n = 0;
  for (let i = 0; i < to; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

/**
 * Replace one block in the source without rewriting the rest of the file.
 * `mode: 'inner'` (default) swaps the element's content and keeps its
 * open tag (and therefore its id and attributes); `mode: 'outer'`
 * replaces the whole element. Returns the new source; the original string
 * is never mutated.
 */
export function editBlock(
  source: string,
  id: string,
  content: string,
  mode: 'inner' | 'outer' = 'inner'
): string {
  const span = locateBlock(source, id);
  if (!span) throw new Error(`no element with id "${id}" found in source`);
  if (mode === 'outer') {
    return source.slice(0, span.start) + content + source.slice(span.end);
  }
  return source.slice(0, span.innerStart) + content + source.slice(span.innerEnd);
}
