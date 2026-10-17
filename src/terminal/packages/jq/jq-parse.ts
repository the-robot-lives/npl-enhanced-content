/**
 * packages/jq/jq-parse — the jq parser (packages rounds 1–2, LANE=pkg-jq).
 *
 * Recursive-descent over ./jq-lex.ts tokens, with jq's precedence ladder
 * (loosest first):
 *   `|`  <  `,`  <  `//`  <  `= |= += …` (nonassoc)  <  `or`  <  `and`
 *   <  comparisons  <  `+ -`  <  `* / %`
 * (probe-verified against real jq: `.a = false // "x"` is `(.a = false) // "x"`
 * — assignment binds tighter than the alternative operator).
 *
 * Term-level extras: `.foo` / `[..]` / `?` suffixes, `EXPR as $x | body`,
 * `reduce`, `foreach`, `if/elif/else/end`, `try/catch`, `def f: …; rest`,
 * `label $x | body` / `break $x`, `..` (recurse), `@format` words and
 * `@format "\(interp)"` strings, `[..]` / `{..}` construction, calls.
 *
 * Path expressions compose as pipes: `.a.b` is `. | .a | .b`, so a `?`
 * suffix (a try without catch) wraps exactly the chain built so far —
 * `.a?.b` and `.a.b?` differ the way jq says they do.
 */

import { lex, type Tok } from './jq-lex.js';
import type { JVal } from './jq-eval.js';

export class JqParseError extends Error {
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(message);
    this.name = 'JqParseError';
  }
}

/** A `def` parameter: `$name` (call-by-value) or `name` (filter closure). */
export interface DefParam {
  dollar: boolean;
  name: string;
}

export type Ast =
  | { t: 'id' }
  | { t: 'lit'; v: JVal }
  | { t: 'str'; parts: Array<string | Ast> }
  | { t: 'fmtnstr'; name: string; parts: Array<string | Ast> }
  | { t: 'field'; name: string }
  | { t: 'index'; key: Ast }
  | { t: 'slice'; lo: Ast | null; hi: Ast | null }
  | { t: 'iter' }
  | { t: 'pipe'; l: Ast; r: Ast }
  | { t: 'comma'; l: Ast; r: Ast }
  | { t: 'alt'; l: Ast; r: Ast }
  | { t: 'or'; l: Ast; r: Ast }
  | { t: 'and'; l: Ast; r: Ast }
  | { t: 'binop'; op: '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '<=' | '>' | '>='; l: Ast; r: Ast }
  | { t: 'neg'; e: Ast }
  | { t: 'try'; body: Ast; catch_: Ast | null }
  | { t: 'if'; clauses: Array<{ cond: Ast; then: Ast }>; els: Ast | null }
  | { t: 'reduce'; src: Ast; name: string; init: Ast; update: Ast }
  | { t: 'foreach'; src: Ast; name: string; init: Ast; update: Ast; extract: Ast | null }
  | { t: 'as'; src: Ast; name: string; body: Ast }
  | { t: 'def'; name: string; params: DefParam[]; body: Ast; rest: Ast }
  | { t: 'label'; name: string; body: Ast }
  | { t: 'break'; name: string }
  | { t: 'assign'; op: string; lhs: Ast; rhs: Ast }
  | { t: 'loc'; line: number }
  | { t: 'var'; name: string }
  | { t: 'call'; name: string; args: Ast[] }
  | { t: 'array'; body: Ast | null }
  | { t: 'object'; entries: Array<{ key: Ast; val: Ast | null }> }
  | { t: 'format'; name: string };

/** Formats this build accepts for `@name` words. */
export const FORMAT_NAMES = new Set(['text', 'json', 'csv', 'tsv', 'html', 'uri', 'base64', 'base64d']);

const ASSIGN_OPS = new Set(['=', '|=', '+=', '-=', '*=', '/=', '%=', '//=']);

/** Words that stay bare object keys (`{if: 1}` works) but are keywords elsewhere. */
const KEYWORDS = new Set([
  'if', 'then', 'elif', 'else', 'end', 'as', 'def', 'foreach', 'reduce', 'try', 'catch', 'label', 'and', 'or', 'import', 'include', 'break', '__loc__',
]);

class Parser {
  private i = 0;
  constructor(
    private readonly toks: Tok[],
    private readonly src: string,
  ) {}

  private peek(offset = 0): Tok {
    return this.toks[Math.min(this.i + offset, this.toks.length - 1)]!;
  }
  private next(): Tok {
    return this.toks[this.i++]!;
  }
  private atOp(op: string): boolean {
    const t = this.peek();
    return t.k === 'op' && t.op === op;
  }
  private atIdent(name: string): boolean {
    const t = this.peek();
    return t.k === 'ident' && t.name === name;
  }
  fail(msg: string, pos?: number): never {
    const at = pos ?? this.peek().pos;
    const line = this.src.slice(0, at).split('\n').length;
    throw new JqParseError(`${msg} at line ${line}`, at);
  }
  private expect(k: Tok['k'], what: string): Tok {
    const t = this.next();
    if (t.k !== k) this.fail(`expected ${what}`, t.pos);
    return t;
  }

  parseProgram(): Ast {
    const ast = this.parsePipe();
    const t = this.peek();
    if (t.k !== 'eof') this.fail(`unexpected ${describe(t)}`, t.pos);
    return ast;
  }

  /**
   * `|` — lowest; right-associated. `EXPR as $x | body` binds here (its body
   * eats the rest of the pipe), as do `def f: …; rest` and `label $x | body`.
   */
  private parsePipe(): Ast {
    if (this.atIdent('def')) return this.parseDef();
    if (this.atIdent('label')) {
      this.next();
      const v = this.expect('var', "a $label after 'label'") as Extract<Tok, { k: 'var' }>;
      if (this.peek().k !== 'pipe') this.fail("expected '|' after 'label $name'", this.peek().pos);
      this.next();
      return { t: 'label', name: v.name, body: this.parsePipe() };
    }
    let l = this.parseComma();
    if (l.t === 'as') return l; // the as-body consumed the rest of the pipe
    if (this.peek().k === 'pipe') {
      this.next();
      const r = this.parsePipe();
      return { t: 'pipe', l, r };
    }
    return l;
  }

  private parseDef(): Ast {
    this.next(); // 'def'
    const nameTok = this.expect('ident', 'a function name after def');
    const name = (nameTok as { k: 'ident'; name: string }).name;
    const params: DefParam[] = [];
    if (this.peek().k === '(') {
      this.next();
      for (;;) {
        const t = this.next();
        if (t.k === 'var') params.push({ dollar: true, name: t.name });
        else if (t.k === 'ident') params.push({ dollar: false, name: t.name });
        else this.fail('expected a parameter name ($var or f) in the def parameter list', t.pos);
        if (this.peek().k === 'semi') {
          this.next();
          continue;
        }
        this.expect(')', "')' after the def parameter list");
        break;
      }
    }
    this.expect('colon', "':' after the def name/parameters");
    const body = this.parsePipe();
    this.expect('semi', "';' after the def body");
    const rest = this.parsePipe();
    return { t: 'def', name, params, body, rest };
  }

  private parseComma(): Ast {
    let l = this.parseAlt();
    while (this.peek().k === 'comma') {
      this.next();
      const r = this.parseAlt();
      if (r.t === 'as') this.fail("'as' must end its pipeline segment", this.peek().pos);
      l = { t: 'comma', l, r };
    }
    return l;
  }

  /** `//` — right-associated, binds looser than assignment (probe-verified). */
  private parseAlt(): Ast {
    const l = this.parseAssign();
    if (this.atOp('//')) {
      this.next();
      return { t: 'alt', l, r: this.parseAlt() };
    }
    return l;
  }

  /** `= |= += -= *= /= %= //=` — nonassociative; operands at `or` level. */
  private parseAssign(): Ast {
    const l = this.parseOr();
    const t = this.peek();
    if (t.k === 'op' && ASSIGN_OPS.has(t.op)) {
      this.next();
      return { t: 'assign', op: t.op, lhs: l, rhs: this.parseOr() };
    }
    return l;
  }

  private parseOr(): Ast {
    let l = this.parseAnd();
    while (this.atIdent('or')) {
      this.next();
      l = { t: 'or', l, r: this.parseAnd() };
    }
    return l;
  }

  private parseAnd(): Ast {
    let l = this.parseCmp();
    while (this.atIdent('and')) {
      this.next();
      l = { t: 'and', l, r: this.parseCmp() };
    }
    return l;
  }

  private parseCmp(): Ast {
    const l = this.parseAdd();
    const t = this.peek();
    if (t.k === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(t.op)) {
      this.next();
      return { t: 'binop', op: t.op as '==', l, r: this.parseAdd() };
    }
    return l;
  }

  private parseAdd(): Ast {
    let l = this.parseMul();
    for (;;) {
      const t = this.peek();
      if (t.k === 'op' && (t.op === '+' || t.op === '-')) {
        this.next();
        l = { t: 'binop', op: t.op, l, r: this.parseMul() };
      } else return l;
    }
  }

  private parseMul(): Ast {
    let l = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.k === 'op' && (t.op === '*' || t.op === '/' || t.op === '%')) {
        this.next();
        l = { t: 'binop', op: t.op, l, r: this.parseUnary() };
      } else return l;
    }
  }

  private parseUnary(): Ast {
    // Unary minus binds looser than postfix suffixes: -.a is -( .a ).
    if (this.atOp('-')) {
      this.next();
      return { t: 'neg', e: this.parsePostfix() };
    }
    return this.parsePostfixAs();
  }

  /** A Term optionally followed by `as $var | body` (jq's as-source is a Term). */
  private parsePostfixAs(): Ast {
    const e = this.parsePostfix();
    if (!this.atIdent('as')) return e;
    this.next();
    const v = this.expect('var', "a $variable after 'as'") as Extract<Tok, { k: 'var' }>;
    if (this.peek().k !== 'pipe') this.fail("expected '|' after 'EXPR as $var'", this.peek().pos);
    this.next();
    const body = this.parsePipe();
    return { t: 'as', src: e, name: v.name, body };
  }

  private parsePostfix(): Ast {
    let e = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (t.k === 'dot') {
        // .foo or ."str" after an expression — the ident must be ADJACENT
        // (`if . then` is identity + keyword, not the field `.then`)
        const nt = this.peek(1);
        if (nt.k === 'ident' && nt.adj) {
          this.next();
          const id = this.next() as { k: 'ident'; name: string };
          e = { t: 'pipe', l: e, r: { t: 'field', name: id.name } };
          continue;
        }
        if (nt.k === 'str') {
          this.next();
          const s = this.next() as Extract<Tok, { k: 'str' }>;
          e = { t: 'pipe', l: e, r: { t: 'field', name: constStr(s, this) } };
          continue;
        }
        this.fail("expected a field name after '.'", nt.pos);
      }
      if (t.k === '[') {
        this.next();
        if (this.peek().k === ']') {
          this.next();
          e = { t: 'pipe', l: e, r: { t: 'iter' } };
        } else if (this.peek().k === 'colon') {
          this.next();
          const hi = this.peek().k === ']' ? null : this.parsePipe();
          this.expect(']', "']'");
          e = { t: 'pipe', l: e, r: { t: 'slice', lo: null, hi } };
        } else {
          const first = this.parsePipe();
          if (this.peek().k === 'colon') {
            this.next();
            const hi = this.peek().k === ']' ? null : this.parsePipe();
            this.expect(']', "']'");
            e = { t: 'pipe', l: e, r: { t: 'slice', lo: first, hi } };
          } else {
            this.expect(']', "']'");
            e = { t: 'pipe', l: e, r: { t: 'index', key: first } };
          }
        }
        continue;
      }
      if (t.k === 'question') {
        this.next();
        e = { t: 'try', body: e, catch_: null };
        continue;
      }
      return e;
    }
  }

  private parsePrimary(): Ast {
    const t = this.next();
    switch (t.k) {
      case 'dot': {
        const nt = this.peek();
        if (nt.k === 'ident' && nt.adj) {
          const id = this.next() as { k: 'ident'; name: string };
          return { t: 'pipe', l: { t: 'id' }, r: { t: 'field', name: id.name } };
        }
        if (nt.k === 'str') {
          const s = this.next() as Extract<Tok, { k: 'str' }>;
          return { t: 'pipe', l: { t: 'id' }, r: { t: 'field', name: constStr(s, this) } };
        }
        return { t: 'id' };
      }
      case 'dotdot':
        // `..` is recurse/0 (jq defines it as a zero-arg function)
        return { t: 'call', name: 'recurse', args: [] };
      case 'num':
        return { t: 'lit', v: t.v };
      case 'str': {
        const parts = t.parts.map((p) => (typeof p === 'string' ? p : parseProgramText(p.raw)));
        return { t: 'str', parts };
      }
      case 'var':
        if (t.name === '__loc__') return { t: 'loc', line: t.line };
        return { t: 'var', name: t.name };
      case 'format': {
        if (!FORMAT_NAMES.has(t.name)) this.fail(`'@${t.name}' is not a known format`, t.pos);
        // @fmt followed directly by a string applies the format to each
        // interpolation (and NOT to the literal parts): @base64 "x\(1)".
        if (this.peek().k === 'str') {
          const s = this.next() as Extract<Tok, { k: 'str' }>;
          const parts = s.parts.map((p) => (typeof p === 'string' ? p : parseProgramText(p.raw)));
          return { t: 'fmtnstr', name: t.name, parts };
        }
        return { t: 'format', name: t.name };
      }
      case '(':
        {
          const inner = this.parsePipe();
          this.expect(')', "')'");
          return inner;
        }
      case '[':
        {
          if (this.peek().k === ']') {
            this.next();
            return { t: 'array', body: null };
          }
          const body = this.parsePipe();
          this.expect(']', "']'");
          return { t: 'array', body };
        }
      case '{':
        return this.parseObject();
      case ')':
      case ']':
      case '}':
      case 'comma':
      case 'colon':
      case 'semi':
      case 'question':
      case 'pipe':
      case 'eof':
        this.fail(`unexpected ${describe(t)}`, t.pos);
      case 'op':
        if (ASSIGN_OPS.has(t.op)) this.fail("an assignment needs a path on its left ('X' is not a path)", t.pos);
        this.fail(`unexpected operator '${t.op}'`, t.pos);
      case 'ident':
        return this.parseIdent(t.name, t.pos);
    }
  }

  /**
   * `{...}` construction. Entries: `{key: VAL}`, `{key}` (= `.key`),
   * `{$var}` (key = the variable's name), `{"str": VAL}`, `{"str"}`,
   * `{(EXPR): VAL}`. Values parse at assignment level so `,` separates
   * entries and `:` never leaks into them; keys accept any identifier word
   * (jq's keywords-as-keys allowance).
   */
  private parseObject(): Ast {
    const entries: Array<{ key: Ast; val: Ast | null }> = [];
    if (this.peek().k === '}') {
      this.next();
      return { t: 'object', entries };
    }
    for (;;) {
      const t = this.next();
      if (t.k === 'var') {
        if (t.name === '__loc__') this.fail('$__loc__ is not a valid object key shorthand', t.pos);
        entries.push({ key: { t: 'lit', v: t.name }, val: { t: 'var', name: t.name } });
      } else if (t.k === 'ident') {
        if (KEYWORDS.has(t.name)) {
          // keywords still work as bare object keys, as in jq
          entries.push({ key: { t: 'lit', v: t.name }, val: { t: 'pipe', l: { t: 'id' }, r: { t: 'field', name: t.name } } });
        } else if (this.peek().k === 'colon') {
          this.next();
          entries.push({ key: { t: 'lit', v: t.name }, val: this.parseObjVal() });
        } else {
          entries.push({ key: { t: 'lit', v: t.name }, val: { t: 'pipe', l: { t: 'id' }, r: { t: 'field', name: t.name } } });
        }
      } else if (t.k === 'str') {
        const key = constStr(t, this);
        if (this.peek().k === 'colon') {
          this.next();
          entries.push({ key: { t: 'lit', v: key }, val: this.parseObjVal() });
        } else {
          entries.push({ key: { t: 'lit', v: key }, val: { t: 'pipe', l: { t: 'id' }, r: { t: 'field', name: key } } });
        }
      } else if (t.k === '(') {
        const keyExpr = this.parsePipe();
        this.expect(')', "')'");
        this.expect('colon', "':'");
        entries.push({ key: keyExpr, val: this.parseObjVal() });
      } else {
        this.fail('expected an object key (name, "string", $var or (expr))', t.pos);
      }
      if (this.peek().k === 'comma') {
        this.next();
        continue;
      }
      this.expect('}', "'}'");
      return { t: 'object', entries };
    }
  }

  private parseObjVal(): Ast {
    return this.parseAssign();
  }

  private parseIdent(name: string, pos: number): Ast {
    if (name === 'import' || name === 'include') this.fail('import/include of module files is not supported by this jq build', pos);
    if (name === 'true') return { t: 'lit', v: true };
    if (name === 'false') return { t: 'lit', v: false };
    if (name === 'null') return { t: 'lit', v: null };
    if (name === 'if') return this.parseIf();
    if (name === 'try') {
      const body = this.parsePostfix();
      if (this.atIdent('catch')) {
        this.next();
        return { t: 'try', body, catch_: this.parsePostfix() };
      }
      return { t: 'try', body, catch_: null };
    }
    if (name === 'reduce') {
      const src = this.parsePostfix();
      if (!this.atIdent('as')) this.fail("expected 'as' after 'reduce SOURCE'", this.peek().pos);
      this.next();
      const v = this.expect('var', 'a $variable') as Extract<Tok, { k: 'var' }>;
      this.expect('(', "'('");
      const init = this.parsePipe();
      this.expect('semi', "';'");
      const update = this.parsePipe();
      this.expect(')', "')'");
      return { t: 'reduce', src, name: v.name, init, update };
    }
    if (name === 'foreach') return this.parseForeach();
    if (name === 'break') {
      const v = this.expect('var', "a $label after 'break'") as Extract<Tok, { k: 'var' }>;
      return { t: 'break', name: v.name };
    }
    if (name === 'as') this.fail("'as' needs a source expression (EXPR as $x | body)", pos);
    if (KEYWORDS.has(name)) this.fail(`unexpected keyword '${name}'`, pos);
    // function call
    if (this.peek().k === '(') {
      this.next();
      const args: Ast[] = [this.parsePipe()];
      while (this.peek().k === 'semi') {
        this.next();
        args.push(this.parsePipe());
      }
      this.expect(')', "')'");
      return { t: 'call', name, args };
    }
    return { t: 'call', name, args: [] };
  }

  /** `foreach SOURCE as $x (INIT; UPDATE)` or `foreach SOURCE as $x (INIT; UPDATE; EXTRACT)`. */
  private parseForeach(): Ast {
    const src = this.parsePostfix();
    if (!this.atIdent('as')) this.fail("expected 'as' after 'foreach SOURCE'", this.peek().pos);
    this.next();
    const v = this.expect('var', 'a $variable') as Extract<Tok, { k: 'var' }>;
    this.expect('(', "'('");
    const init = this.parsePipe();
    this.expect('semi', "';'");
    const update = this.parsePipe();
    let extract: Ast | null = null;
    if (this.peek().k === 'semi') {
      this.next();
      extract = this.parsePipe();
    }
    this.expect(')', "')'");
    return { t: 'foreach', src, name: v.name, init, update, extract };
  }

  private parseIf(): Ast {
    const clauses: Array<{ cond: Ast; then: Ast }> = [];
    const cond = this.parsePipe();
    if (!this.atIdent('then')) this.fail("expected 'then' after 'if' condition", this.peek().pos);
    this.next();
    clauses.push({ cond, then: this.parsePipe() });
    let els: Ast | null = null;
    for (;;) {
      if (this.atIdent('elif')) {
        this.next();
        const c2 = this.parsePipe();
        if (!this.atIdent('then')) this.fail("expected 'then' after 'elif' condition", this.peek().pos);
        this.next();
        clauses.push({ cond: c2, then: this.parsePipe() });
        continue;
      }
      if (this.atIdent('else')) {
        this.next();
        els = this.parsePipe();
      }
      if (!this.atIdent('end')) this.fail("expected 'end' to close 'if'", this.peek().pos);
      this.next();
      return { t: 'if', clauses, els };
    }
  }
}

/** Parse one jq program (the whole filter argument). */
export function parseProgram(src: string): Ast {
  if (src.trim() === '') throw new JqParseError('empty program', 0);
  return new Parser(lex(src), src).parseProgram();
}

/** Lex+parse an interpolation hole (recursively; it is a full jq expression). */
export function parseProgramText(src: string): Ast {
  return new Parser(lex(src), src).parseProgram();
}

/** A string token used as a constant (field names, object keys) — no interpolation. */
function constStr(t: Extract<Tok, { k: 'str' }>, p: Parser): string {
  if (t.parts.length === 1 && typeof t.parts[0] === 'string') return t.parts[0];
  if (t.parts.length === 0) return '';
  p.fail('interpolated strings are not valid here', t.pos);
}

function describe(t: Tok): string {
  switch (t.k) {
    case 'eof':
      return 'end of program';
    case 'dot':
      return "'.'";
    case 'dotdot':
      return "'..'";
    case 'pipe':
      return "'|'";
    case 'comma':
      return "','";
    case 'str':
      return 'a string';
    case 'ident':
      return `'${t.name}'`;
    case 'var':
      return `'$${t.name}'`;
    case 'num':
      return `number ${t.v}`;
    case 'format':
      return `'@${t.name}'`;
    case 'op':
      return `'${t.op}'`;
    default:
      return `'${t.k}'`;
  }
}
