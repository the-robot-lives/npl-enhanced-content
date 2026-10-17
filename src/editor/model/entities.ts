/**
 * Entity decode/encode for the editor model.
 *
 * Policy (see types.ts header): numeric entities always decode; named
 * entities decode against the table below (the common HTML4/typography set —
 * enough for every entity the spec corpus actually uses); unknown named
 * entities stay verbatim in the decoded value and raise a
 * `{ code: 'unknown-entity', severity: 'warning' }` parse issue, so
 * `raw` keeps emitting them byte-exactly until the text is edited.
 */

import type { ParseIssue, SourceRange } from './types.js';

/** Common named entities (HTML4 latin-1, symbols/typography, arrows). */
export const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  iexcl: '¡',
  cent: '¢',
  pound: '£',
  curren: '¤',
  yen: '¥',
  brvbar: '¦',
  sect: '§',
  uml: '¨',
  copy: '©',
  ordf: 'ª',
  laquo: '«',
  not: '¬',
  shy: '­',
  reg: '®',
  macr: '¯',
  deg: '°',
  plusmn: '±',
  sup2: '²',
  sup3: '³',
  acute: '´',
  micro: 'µ',
  para: '¶',
  middot: '·',
  cedil: '¸',
  sup1: '¹',
  ordm: 'º',
  raquo: '»',
  frac14: '¼',
  frac12: '½',
  frac34: '¾',
  iquest: '¿',
  times: '×',
  divide: '÷',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  rsaquo: '›',
  lsaquo: '‹',
  bull: '•',
  dagger: '†',
  Dagger: '‡',
  permil: '‰',
  prime: '′',
  Prime: '″',
  larr: '←',
  uarr: '↑',
  rarr: '→',
  darr: '↓',
  harr: '↔',
  crarr: '↵',
  lArr: '⇐',
  uArr: '⇑',
  rArr: '⇒',
  dArr: '⇓',
  hArr: '⇔',
  check: '✓',
  cross: '✗',
  le: '≤',
  ge: '≥',
  ne: '≠',
  asymp: '≈',
  equiv: '≡',
  minus: '−',
  lowast: '∗',
  infin: '∞',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  theta: 'θ',
  lambda: 'λ',
  mu: 'μ',
  pi: 'π',
  sigma: 'σ',
  phi: 'φ',
  omega: 'ω',
  Alpha: 'Α',
  Beta: 'Β',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Pi: 'Π',
  Sigma: 'Σ',
  Phi: 'Φ',
  Omega: 'Ω',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  agrave: 'à',
  egrave: 'è',
  igrave: 'ì',
  ograve: 'ò',
  ugrave: 'ù',
  acirc: 'â',
  ecirc: 'ê',
  icirc: 'î',
  ocirc: 'ô',
  ucirc: 'û',
  ccedil: 'ç',
  ntilde: 'ñ',
  auml: 'ä',
  euml: 'ë',
  iuml: 'ï',
  ouml: 'ö',
  uuml: 'ü',
  szlig: 'ß',
  oslash: 'ø',
  aring: 'å',
  aelig: 'æ',
};

const ENTITY_RE = /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;

export interface DecodeResult {
  value: string;
  issues: ParseIssue[];
}

/** Decode entities in a text/attribute raw slice. `range` maps matches to
 *  source coordinates: `offset` is the absolute source offset of `raw[0]`. */
export function decodeEntities(raw: string, offset: number): DecodeResult {
  if (!raw.includes('&')) return { value: raw, issues: [] };
  const issues: ParseIssue[] = [];
  const value = raw.replace(ENTITY_RE, (m, body: string, at: number) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
        issues.push({
          code: 'unknown-entity',
          severity: 'warning',
          message: `numeric entity ${m} out of range — kept verbatim`,
          range: { start: offset + at, end: offset + at + m.length },
        });
        return m;
      }
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[body];
    if (named === undefined) {
      issues.push({
        code: 'unknown-entity',
        severity: 'warning',
        message: `unknown entity ${m} — kept verbatim`,
        range: { start: offset + at, end: offset + at + m.length },
      });
      return m;
    }
    return named;
  });
  return { value, issues };
}

/** Escape a decoded text value for emission. */
export function escapeText(value: string): string {
  return value.replace(/[&<>]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;',
  );
}

/** Escape a decoded attribute value for emission inside `quote`. */
export function escapeAttr(value: string, quote: '"' | "'"): string {
  const escaped = value.replace(/[&<>]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;',
  );
  return quote === '"' ? escaped.replace(/"/g, '&quot;') : escaped.replace(/'/g, '&apos;');
}

/**
 * Make an edited comment body safe to wrap in `<!-- … -->`. Comments have
 * no entity escapes, so the only hazards are the dashes themselves: `--`
 * is forbidden in a well-formed comment and `-->` would end it early.
 * Every dash run is broken with spaces (`--` → `- -`, `---` → `- - -`)
 * and a trailing `-` gets one too, so the closing `-->` never gains a
 * fourth dash. Authored (unedited) comments keep their source bytes — the
 * untouched round-trip invariant wins there; this guards editor-typed
 * bodies.
 */
export function escapeCommentBody(value: string): string {
  return value
    .replace(/-{2,}/g, (run) => '- '.repeat(run.length).trim())
    .replace(/-$/, '- ');
}

/** Source-range helper for issue construction over `raw` slices. */
export function rangeAt(start: number, raw: string): SourceRange {
  return { start, end: start + raw.length };
}
