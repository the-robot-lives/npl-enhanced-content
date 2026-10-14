/**
 * data/yaml — YAML subset parsing for sem-data-source (phase 2).
 *
 * Spec: spec/data-visualizer.md §7.3. A deliberately small subset, not a
 * general parser: block mappings, block sequences, comments, quoted scalars,
 * plain-scalar typing, flow sequences of scalars. Flow mappings, anchors,
 * aliases, tags, block scalars and multi-document streams are OUT of scope —
 * each rejects with a clear error naming the construct. Pure, no DOM.
 */

import type { SourceParse, TableData } from './table.js';

export type YamlValue = null | boolean | number | string | YamlValue[] | { [key: string]: YamlValue };

interface YLine { indent: number; text: string }

/** Parse a YAML-subset document to a plain value. */
export function parseYamlSubset(src: string): { ok: true; value: YamlValue } | { ok: false; error: string } {
  const lines: YLine[] = [];
  for (const raw of src.split('\n')) {
    if (/^\s*#/.test(raw) || !raw.trim()) continue;
    if (/^\s*---(\s|$)/.test(raw)) {
      return { ok: false, error: 'yaml subset: multi-document streams ("---") are out of scope' };
    }
    if (/^\t/.test(raw)) {
      return { ok: false, error: 'yaml subset: tab indentation is out of scope — indent with spaces' };
    }
    const text = stripComment(raw);
    const indent = (/^ */.exec(text) as RegExpExecArray)[0].length;
    lines.push({ indent, text: text.slice(indent) });
  }
  if (lines.length === 0) return { ok: false, error: 'yaml subset: the payload is empty' };
  try {
    const [value, next] = parseBlock(lines, 0, lines[0].indent);
    if (next < lines.length) {
      return { ok: false, error: 'yaml subset: unexpected content at line "' + lines[next].text.trim() + '" — check indentation' };
    }
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Strip a trailing `#` comment outside quotes. */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line.replace(/\s+$/, '');
}

function parseBlock(lines: YLine[], i: number, indent: number): [YamlValue, number] {
  if (lines[i].text.startsWith('- ') || lines[i].text === '-') return parseSequence(lines, i, indent);
  return parseMapping(lines, i, indent);
}

function parseSequence(lines: YLine[], i: number, indent: number): [YamlValue[], number] {
  const out: YamlValue[] = [];
  while (i < lines.length && lines[i].indent === indent && (lines[i].text.startsWith('- ') || lines[i].text === '-')) {
    const rest = lines[i].text === '-' ? '' : lines[i].text.slice(2).trim();
    if (rest === '') {
      // nested block belongs to this item
      if (i + 1 < lines.length && lines[i + 1].indent > indent) {
        const [v, n] = parseBlock(lines, i + 1, lines[i + 1].indent);
        out.push(v); i = n;
      } else { out.push(null); i++; }
      continue;
    }
    if (isMappingStart(rest)) {
      // compact mapping: reparse the item body as a mapping at the item's column
      const synthetic: YLine[] = [{ indent: indent + 2, text: rest }];
      let j = i + 1;
      while (j < lines.length && lines[j].indent > indent) synthetic.push(lines[j++]);
      const [v, n] = parseMapping(synthetic, 0, indent + 2);
      if (n < synthetic.length) throw new Error('yaml subset: unexpected indentation in sequence item "' + rest + '"');
      out.push(v); i = j;
      continue;
    }
    out.push(parseScalar(rest));
    i++;
  }
  return [out, i];
}

function parseMapping(lines: YLine[], i: number, indent: number): [{ [key: string]: YamlValue }, number] {
  const out: { [key: string]: YamlValue } = {};
  while (i < lines.length && lines[i].indent === indent) {
    const key = splitKey(lines[i].text);
    if (key === null) throw new Error('yaml subset: expected "key:" mapping entry, got "' + lines[i].text + '"');
    const rest = lines[i].text.slice(key.length + 1).trim();
    if (rest === '') {
      if (i + 1 < lines.length && lines[i + 1].indent > indent) {
        const [v, n] = parseBlock(lines, i + 1, lines[i + 1].indent);
        out[key] = v; i = n;
      } else { out[key] = null; i++; }
      continue;
    }
    out[key] = parseScalar(rest);
    i++;
  }
  return [out, i];
}

/** Does this line's text open a mapping (`key:` before any value)? */
function isMappingStart(text: string): boolean {
  return splitKey(text) !== null;
}

/** The mapping key of `key: value`, or null when the line is not a mapping entry. */
function splitKey(text: string): string | null {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === ':' && (i + 1 === text.length || /\s/.test(text[i + 1]))) {
      const key = text.slice(0, i).trim();
      if (!key) throw new Error('yaml subset: a mapping entry needs a key before ":"');
      return unquote(key);
    }
  }
  return null;
}

/** Parse a scalar (or flow sequence of scalars); rejects the out-of-scope forms. */
function parseScalar(text: string): YamlValue {
  const t = text.trim();
  if (t.startsWith('[')) return parseFlowSeq(t);
  if (t.startsWith('{')) throw new Error('yaml subset: flow mappings ("{k: v}") are out of scope — use block form');
  if (/^[&*!]/.test(t)) throw new Error('yaml subset: anchors, aliases and tags ("' + t[0] + '") are out of scope');
  if (t === '|' || t === '>') throw new Error('yaml subset: block scalars ("' + t + '") are out of scope');
  if (t === '' || t === '~' || t === 'null') return null;
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^[+-]?\d+$/.test(t)) return parseInt(t, 10);
  if (/^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(t) && /\d/.test(t)) return parseFloat(t);
  return unquote(t);
}

function unquote(t: string): string {
  if (t.length >= 2 && t[0] === "'" && t[t.length - 1] === "'") return t.slice(1, -1).replace(/''/g, "'");
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') {
    return t.slice(1, -1).replace(/\\(["\\n])/g, (_, c) => (c === 'n' ? '\n' : c));
  }
  return t;
}

/** Flow sequence of scalars: `[a, b, "c d"]`. */
function parseFlowSeq(t: string): YamlValue[] {
  if (!t.endsWith(']')) throw new Error('yaml subset: unterminated flow sequence "' + t + '"');
  const body = t.slice(1, -1).trim();
  if (body === '') return [];
  const items: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) { cur += c; if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === ',') { items.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  items.push(cur.trim());
  return items.map((item) => {
    if (item.startsWith('[') || item.startsWith('{') || item.startsWith('&') || item.startsWith('*')) {
      throw new Error('yaml subset: flow sequences hold scalars only — "' + item + '" is out of scope');
    }
    return parseScalar(item) as Exclude<YamlValue, YamlValue[] | { [key: string]: YamlValue }>;
  });
}

/**
 * A plain `yaml` payload must be a sequence of mappings ⇒ rows (columns are
 * the key union, first-seen order). Nested mapping values serialize as JSON
 * cells. Anything else is a clear error pointing at data-type="yaml-schema".
 */
export function yamlToTable(value: YamlValue): SourceParse {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'a yaml payload must be a sequence of mappings (- key: value rows); for nested shapes declare data-type="yaml-schema"' };
  }
  if (value.length === 0) {
    return { ok: false, error: 'no data found: the yaml sequence is empty' };
  }
  if (!value.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item))) {
    return { ok: false, error: 'a yaml payload must be a sequence of mappings (- key: value rows); scalar or sequence items are not rows' };
  }
  const columns: string[] = [];
  for (const row of value as { [key: string]: YamlValue }[]) {
    for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
  }
  const rows = (value as { [key: string]: YamlValue }[]).map((row) =>
    columns.map((c) => cell(row[c])));
  return { ok: true, table: { columns, rows } as TableData };
}

/** Stringify one cell value: null ⇒ '', nested shapes ⇒ JSON, scalars ⇒ text. */
export function cell(v: YamlValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
