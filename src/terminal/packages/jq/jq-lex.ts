/**
 * packages/jq/jq-lex — the jq tokenizer (packages round, LANE=pkg-jq).
 *
 * Turns a jq program into tokens for ./jq-parse.ts. jq-specific bits the
 * shared shape needs: `.field` paths (the dot is its own token, the parser
 * binds it), string interpolation `"\(expr)"` (the raw expression text is
 * captured here, recursively lexed+parsed by the parser), `@format` words,
 * `$var` references, and `#` comments to end of line.
 *
 * Assignment operators (`=`, `|=`, `+=`, …) tokenize here and now parse as
 * real update expressions; `..` and `$__loc__` (with line tracking) also
 * tokenize here.
 */

/** A tokenizer error: message plus where in the source it happened. */
export class JqSyntaxError extends Error {
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(message);
    this.name = 'JqSyntaxError';
  }
}

/** One interpolation hole inside a string literal (raw program text). */
export interface InterpPart {
  raw: string;
  pos: number;
}

export type Tok =
  | { k: 'dot'; pos: number }
  | { k: 'dotdot'; pos: number }
  | { k: '['; pos: number }
  | { k: ']'; pos: number }
  | { k: '{'; pos: number }
  | { k: '}'; pos: number }
  | { k: '('; pos: number }
  | { k: ')'; pos: number }
  | { k: 'pipe'; pos: number }
  | { k: 'comma'; pos: number }
  | { k: 'colon'; pos: number }
  | { k: 'semi'; pos: number }
  | { k: 'question'; pos: number }
  | { k: 'op'; op: string; pos: number }
  | { k: 'num'; v: number; pos: number }
  | { k: 'str'; parts: Array<string | InterpPart>; pos: number }
  | { k: 'ident'; name: string; pos: number; adj: boolean }
  | { k: 'var'; name: string; pos: number; line: number }
  | { k: 'format'; name: string; pos: number }
  | { k: 'eof'; pos: number };

const IDENT_START = /[A-Za-z_]/;
const IDENT_BODY = /[A-Za-z0-9_]/;
const NUM_BODY = /[0-9]/;

/** `=`-carrying operators tokenize (the parser turns them into updates). */
const ONE_CHAR_OPS = new Set(['<', '>', '+', '-', '*', '/', '%', '=']);

const ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

const WS = new Set([' ', '\t', '\n', '\r']);

export function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;

  const fail = (msg: string, pos = i): never => {
    throw new JqSyntaxError(msg, pos);
  };

  while (i < n) {
    const c = src[i]!;
    // whitespace + comments
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      if (c === '\n') line++;
      i++;
      continue;
    }
    if (c === '#') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    // punctuation
    switch (c) {
      case '.':
        if (src[i + 1] === '.') {
          toks.push({ k: 'dotdot', pos: i });
          i += 2;
        } else {
          toks.push({ k: 'dot', pos: i });
          i++;
        }
        continue;
      case '[':
        toks.push({ k: '[', pos: i });
        i++;
        continue;
      case ']':
        toks.push({ k: ']', pos: i });
        i++;
        continue;
      case '{':
        toks.push({ k: '{', pos: i });
        i++;
        continue;
      case '}':
        toks.push({ k: '}', pos: i });
        i++;
        continue;
      case '(':
        toks.push({ k: '(', pos: i });
        i++;
        continue;
      case ')':
        toks.push({ k: ')', pos: i });
        i++;
        continue;
      case '|':
        if (src[i + 1] === '=') {
          toks.push({ k: 'op', op: '|=', pos: i });
          i += 2;
        } else {
          toks.push({ k: 'pipe', pos: i });
          i++;
        }
        continue;
      case ',':
        toks.push({ k: 'comma', pos: i });
        i++;
        continue;
      case ':':
        toks.push({ k: 'colon', pos: i });
        i++;
        continue;
      case ';':
        toks.push({ k: 'semi', pos: i });
        i++;
        continue;
      case '?':
        toks.push({ k: 'question', pos: i });
        i++;
        continue;
      default:
        break;
    }
    // three-char `//=` must be checked before two-char `//`
    if (src.slice(i, i + 3) === '//=') {
      toks.push({ k: 'op', op: '//=', pos: i });
      i += 3;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '//'].includes(two)) {
      toks.push({ k: 'op', op: two, pos: i });
      i += 2;
      continue;
    }
    if (['+=', '-=', '*=', '/=', '%='].includes(two)) {
      toks.push({ k: 'op', op: two, pos: i });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.has(c)) {
      toks.push({ k: 'op', op: c, pos: i });
      i++;
      continue;
    }
    // numbers
    if (NUM_BODY.test(c)) {
      const start = i;
      while (i < n && NUM_BODY.test(src[i]!)) i++;
      if (src[i] === '.' && NUM_BODY.test(src[i + 1] ?? '')) {
        i++; // the dot
        while (i < n && NUM_BODY.test(src[i]!)) i++;
      }
      if (src[i] === 'e' || src[i] === 'E') {
        const save = i;
        i++;
        if (src[i] === '+' || src[i] === '-') i++;
        if (!NUM_BODY.test(src[i] ?? '')) i = save; // not an exponent after all
        else while (i < n && NUM_BODY.test(src[i]!)) i++;
      }
      const text = src.slice(start, i);
      const v = Number(text);
      if (!Number.isFinite(v)) fail(`invalid number literal '${text}'`, start);
      toks.push({ k: 'num', v, pos: start });
      continue;
    }
    // strings (with \(...) interpolation)
    if (c === '"') {
      toks.push({ k: 'str', parts: lexString(src, i), pos: i });
      i = stringEnd(src, i);
      continue;
    }
    // variables
    if (c === '$') {
      const start = i;
      i++;
      if (!IDENT_START.test(src[i] ?? '')) fail("' $' must be followed by a name", start);
      let name = '';
      while (i < n && IDENT_BODY.test(src[i]!)) name += src[i++];
      toks.push({ k: 'var', name, pos: start, line });
      continue;
    }
    // format strings
    if (c === '@') {
      const start = i;
      i++;
      let name = '';
      while (i < n && IDENT_BODY.test(src[i]!)) name += src[i++];
      if (name === '') fail("'@' must be followed by a format name", start);
      toks.push({ k: 'format', name, pos: start });
      continue;
    }
    // identifiers / keywords (adj = no whitespace before it — `.foo` fields
    // need this: `if . then` must not lex as the field `.then`)
    if (IDENT_START.test(c)) {
      const start = i;
      let name = '';
      while (i < n && IDENT_BODY.test(src[i]!)) name += src[i++];
      toks.push({ k: 'ident', name, pos: start, adj: start > 0 && !WS.has(src[start - 1]!) });
      continue;
    }
    fail(`unexpected character '${c}'`);
  }
  toks.push({ k: 'eof', pos: n });
  return toks;
}

/** Read a string literal starting at `start` (the quote); returns its parts. */
function lexString(src: string, start: number): Array<string | InterpPart> {
  const parts: Array<string | InterpPart> = [];
  let buf = '';
  let i = start + 1;
  const n = src.length;
  const flush = () => {
    if (buf !== '') {
      parts.push(buf);
      buf = '';
    }
  };
  while (i < n) {
    const c = src[i]!;
    if (c === '"') {
      flush();
      return parts;
    }
    if (c === '\\') {
      const esc = src[i + 1];
      if (esc === undefined) break;
      if (esc === '(') {
        // interpolation: capture raw text to the matching ')'
        flush();
        const rawStart = i + 2;
        let depth = 1;
        let j = rawStart;
        while (j < n && depth > 0) {
          const d = src[j]!;
          if (d === '"') {
            // skip a nested string (escapes included)
            j++;
            while (j < n && src[j] !== '"') {
              if (src[j] === '\\') j++;
              j++;
            }
            if (j >= n) throw new JqSyntaxError('unterminated string in interpolation', rawStart);
          } else if (d === '(') {
            depth++;
          } else if (d === ')') {
            depth--;
            if (depth === 0) break;
          }
          j++;
        }
        if (depth !== 0) throw new JqSyntaxError("unterminated interpolation (missing ')')", rawStart);
        parts.push({ raw: src.slice(rawStart, j), pos: rawStart });
        i = j + 1;
        continue;
      }
      const mapped = ESCAPES[esc];
      if (mapped === undefined && esc !== 'u') {
        throw new JqSyntaxError(`invalid escape '\\${esc}' in string`, i);
      }
      if (esc === 'u') {
        const hex = src.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new JqSyntaxError('invalid \\u escape in string', i);
        buf += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      }
      buf += mapped;
      i += 2;
      continue;
    }
    buf += c;
    i++;
  }
  throw new JqSyntaxError('unterminated string literal', start);
}

/** Advance past the string literal that starts at `start`; returns the index after the close. */
function stringEnd(src: string, start: number): number {
  // Re-walk exactly like lexString so the two agree on where strings end.
  let i = start + 1;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (c === '"') return i + 1;
    if (c === '\\') {
      if (src[i + 1] === '(') {
        let depth = 1;
        let j = i + 2;
        while (j < n && depth > 0) {
          const d = src[j]!;
          if (d === '"') {
            j++;
            while (j < n && src[j] !== '"') {
              if (src[j] === '\\') j++;
              j++;
            }
          } else if (d === '(') depth++;
          else if (d === ')') depth--;
          j++;
        }
        i = j;
        continue;
      }
      i += src[i + 1] === 'u' ? 6 : 2;
      continue;
    }
    i++;
  }
  return n; // lexString will have raised already
}
