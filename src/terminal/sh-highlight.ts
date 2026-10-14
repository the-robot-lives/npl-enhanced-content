/**
 * sh-highlight — the tiny built-in tokenizer behind `bat`.
 *
 * One job: project text (HTML, or anything else) to an ANSI-SGR-decorated
 * string with a fixed five-color scheme — no dependency, no regex beyond
 * character scans, safe on any input. `bat` emits these codes when its
 * stdout is "a terminal" (the last pipeline stage); `<sem-terminal>` turns
 * SGR codes into styled spans, and anything piped downstream sees them
 * only when the command is forced to color.
 *
 * HTML tokens: comments (dim), doctype (dim), tag names (cyan), attribute
 * names (yellow), quoted attribute values (green). Everything else passes
 * through untouched — a text document tokenizes to itself.
 *
 * Tokenizing runs per line, so ANSI runs never span a newline and `bat`'s
 * line-number gutter stays balanced.
 */

/** SGR parameter → semantic for the element's span classes (whitelist). */
export const SGR_CODES = new Set(['0', '1', '2', '30', '31', '32', '33', '34', '35', '36', '37']);

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';

const wrap = (code: string, text: string): string => code + text + RESET;

/** Highlight one line of HTML; plain text for anything else. */
function highlightHtmlLine(line: string): string {
  let out = '';
  let i = 0;
  const plain = (stop: string): void => {
    const start = i;
    while (i < line.length && !line.startsWith(stop, i)) i++;
    out += line.slice(start, i);
  };
  while (i < line.length) {
    if (line.startsWith('<!--', i)) {
      const end = line.indexOf('-->', i);
      const stop = end === -1 ? line.length : end + 3;
      out += wrap(DIM, line.slice(i, stop));
      i = stop;
      continue;
    }
    if (line.startsWith('<!', i)) {
      const end = line.indexOf('>', i);
      const stop = end === -1 ? line.length : end + 1;
      out += wrap(DIM, line.slice(i, stop));
      i = stop;
      continue;
    }
    if (line[i] === '<') {
      const end = findTagEnd(line, i);
      if (end === -1) {
        out += line.slice(i);
        break;
      }
      out += highlightTag(line.slice(i, end + 1));
      i = end + 1;
      continue;
    }
    plain('<');
  }
  return out;
}

/** End of the current tag's `>` (quoted `>` inside attribute values excluded). */
function findTagEnd(line: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i;
  }
  return -1;
}

/** Colorize one complete tag: name cyan, attribute names yellow, values green. */
function highlightTag(tag: string): string {
  const open = /^<\/?[A-Za-z][A-Za-z0-9-]*/.exec(tag);
  if (!open) return tag; // `<>`, `</>` — nothing to color
  const nameStart = tag.startsWith('</') ? 2 : 1;
  let out = tag.slice(0, nameStart) + wrap(CYAN, open[0].slice(nameStart));
  let i = open[0].length;
  let inValue = false; // consuming an unquoted attribute value
  while (i < tag.length) {
    const c = tag[i];
    if (c === '"' || c === "'") {
      const end = tag.indexOf(c, i + 1);
      const stop = end === -1 ? tag.length : end + 1;
      out += wrap(GREEN, tag.slice(i, stop));
      i = stop;
      inValue = false;
    } else if (inValue && /\S/.test(c) && c !== '>') {
      const start = i;
      while (i < tag.length && !/[\s>]/.test(tag[i])) i++;
      out += wrap(GREEN, tag.slice(start, i));
    } else if (!inValue && /[A-Za-z_:@-]/.test(c)) {
      const start = i;
      while (i < tag.length && !/[\s=>]/.test(tag[i])) i++;
      out += wrap(YELLOW, tag.slice(start, i));
    } else {
      inValue = c === '=';
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * Project `content` to ANSI for `lang`. Known languages: `html` (+ `xml`,
 * `svg` — same tokenizer). Everything else (including plain text) returns
 * the content unchanged; callers add their own line-number gutter.
 */
export function highlightAnsi(content: string, lang: string): string {
  const normalized = lang.trim().toLowerCase();
  if (normalized !== 'html' && normalized !== 'xml' && normalized !== 'svg') return content;
  return content.split('\n').map(highlightHtmlLine).join('\n');
}

export interface SgrSpan {
  text: string;
  /** Active SGR codes for this span (subset of SGR_CODES, e.g. `31`, `1`). */
  codes: string[];
}

/**
 * Split text with embedded SGR sequences into spans for the element to
 * render as styled (plain-text, auto-escaped) `<span>`s. Unknown/unsupported
 * codes are dropped; consecutive output with no codes yields one span.
 */
export function splitSgr(text: string): SgrSpan[] {
  const spans: SgrSpan[] = [];
  const active = new Set<string>();
  let plain = '';
  const push = (): void => {
    if (plain !== '') spans.push({ text: plain, codes: [...active] });
    plain = '';
  };
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    plain += text.slice(last, m.index);
    last = m.index + m[0].length;
    for (const code of m[1].split(';')) {
      if (code === '0' || code === '') active.clear();
      else if (SGR_CODES.has(code)) active.add(code);
    }
    push();
  }
  plain += text.slice(last);
  push();
  return spans;
}

/** Strip every SGR sequence — for tests and plain-text consumers. */
export function stripSgr(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}
