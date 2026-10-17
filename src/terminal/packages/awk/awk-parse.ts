/**
 * awk — the program-text side: lexer + recursive-descent parser
 * (LANE=pkg-awk, package `src/terminal/packages/awk/`).
 *
 * Produces the AST the interpreter in ./awk-run.ts evaluates. Fidelity
 * target: POSIX awk (the one-true-awk dialect) with gawk-compatible
 * record splitting and printf. Regex literals are ERE; division vs `/re/`
 * is disambiguated the classic way — `/` after something that can END an
 * expression (number, string, name, `)`, `]`, a complete statement) is
 * division, otherwise a regex starts. Error messages carry the source
 * line (`awk: cmd. line:3: ...`) in the gawk shape.
 */

/* ------------------------------------------------------------------ *
 * errors
 * ------------------------------------------------------------------ */

/** Any parse-time failure. `awk: ` + message is the printed form. */
export class AwkParseError extends Error {}

/* ------------------------------------------------------------------ *
 * tokens
 * ------------------------------------------------------------------ */

export type Tok =
  | { t: 'num'; v: number; ln: number }
  | { t: 'str'; v: string; ln: number }
  | { t: 'ere'; v: string; ln: number }
  | { t: 'name'; v: string; ln: number }
  | { t: 'kw'; v: string; ln: number }
  | { t: 'op'; v: string; ln: number }
  | { t: 'nl'; v: null; ln: number };

const KEYWORDS = new Set([
  'BEGIN', 'END', 'function', 'func', 'if', 'else', 'while', 'for', 'do',
  'break', 'continue', 'next', 'nextfile', 'delete', 'return', 'exit',
  'in', 'getline', 'print', 'printf',
]);

const TWO_CHAR_OPS = new Set([
  '>>', '++', '--', '+=', '-=', '*=', '/=', '%=', '^=',
  '&&', '||', '==', '!=', '<=', '>=', '!~',
]);

const ONE_CHAR_OPS = new Set([
  '+', '-', '*', '/', '%', '^', '<', '>', '=', '!', '~', '?', ':', ';',
  ',', '(', ')', '[', ']', '{', '}', '$', '|',
]);

/* ------------------------------------------------------------------ *
 * lexer
 * ------------------------------------------------------------------ */

/**
 * Tokenize the program. Newlines become tokens (they terminate
 * statements); every other whitespace and `# comment` is dropped.
 */
export function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let ln = 1;
  // True when the previous token could END an expression — decides
  // division vs regex at each `/` (see the module note).
  let canEnd = false;

  const err = (msg: string): never => {
    throw new AwkParseError(`cmd. line:${ln}: ${msg}`);
  };

  while (i < src.length) {
    const c = src[i]!;
    if (c === '\n') {
      toks.push({ t: 'nl', v: null, ln });
      ln++;
      i++;
      canEnd = false;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') {
      i++;
      continue;
    }
    if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }

    // numbers: 12, 3.5, .5, 5., 1e-3, 0x1f
    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] !== undefined && src[i + 1]! >= '0' && src[i + 1]! <= '9')) {
      let j = i;
      if (c === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X')) {
        j = i + 2;
        while (j < src.length && /[0-9a-fA-F]/.test(src[j]!)) j++;
        if (j === i + 2) err('bad hex constant');
        toks.push({ t: 'num', v: parseInt(src.slice(i, j), 16), ln });
        i = j;
        canEnd = true;
        continue;
      }
      while (j < src.length && src[j]! >= '0' && src[j]! <= '9') j++;
      if (src[j] === '.') {
        j++;
        while (j < src.length && src[j]! >= '0' && src[j]! <= '9') j++;
      }
      if (src[j] === 'e' || src[j] === 'E') {
        let k = j + 1;
        if (src[k] === '+' || src[k] === '-') k++;
        if (src[k] !== undefined && src[k]! >= '0' && src[k]! <= '9') {
          while (k < src.length && src[k]! >= '0' && src[k]! <= '9') k++;
          j = k;
        }
      }
      toks.push({ t: 'num', v: Number(src.slice(i, j)), ln });
      i = j;
      canEnd = true;
      continue;
    }

    // strings
    if (c === '"') {
      let s = '';
      i++;
      for (;;) {
        if (i >= src.length) err('unterminated string');
        const ch = src[i]!;
        if (ch === '"') {
          i++;
          break;
        }
        if (ch === '\n') err('unterminated string');
        if (ch === '\\') {
          i++;
          const [text, next] = readEscape(src, i, ln, err);
          s += text;
          i = next;
          continue;
        }
        s += ch;
        i++;
      }
      toks.push({ t: 'str', v: s, ln });
      canEnd = true;
      continue;
    }

    // regex literal — `/` only when an expression cannot be in progress
    if (c === '/' && !canEnd) {
      let s = '';
      i++;
      for (;;) {
        if (i >= src.length) err('unterminated regexp');
        const ch = src[i]!;
        if (ch === '/') {
          i++;
          break;
        }
        if (ch === '\n') err('unterminated regexp');
        if (ch === '\\') {
          // keep the escape for the ERE converter; a missing char is its error
          if (i + 1 >= src.length) err('unterminated regexp');
          s += '\\' + src[i + 1]!;
          i += 2;
          continue;
        }
        s += ch;
        i++;
      }
      toks.push({ t: 'ere', v: s, ln });
      canEnd = true;
      continue;
    }

    // names / keywords
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      const word = src.slice(i, j);
      i = j;
      if (KEYWORDS.has(word)) {
        toks.push({ t: 'kw', v: word, ln });
        // complete simple statements — a `/` after one starts a NEW item's pattern
        canEnd = word === 'next' || word === 'nextfile' || word === 'break' || word === 'continue';
      } else {
        toks.push({ t: 'name', v: word, ln });
        canEnd = true;
      }
      continue;
    }

    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      // `a /= b` is divide-assign; `!/=/x/` still reads as match-not regex-eq
      if (two === '/=' && !canEnd) {
        toks.push({ t: 'op', v: '/', ln });
        i++;
        canEnd = false;
        continue;
      }
      toks.push({ t: 'op', v: two, ln });
      i += 2;
      canEnd = two === '++' || two === '--';
      continue;
    }
    if (ONE_CHAR_OPS.has(c)) {
      toks.push({ t: 'op', v: c, ln });
      i++;
      canEnd = c === ')' || c === ']';
      continue;
    }
    err(`syntax error at or near '${c}'`);
  }
  return toks;
}

/** String/regex escape after the backslash; returns [text, nextIndex]. */
function readEscape(src: string, i: number, ln: number, err: (m: string) => never): [string, number] {
  const c = src[i];
  if (c === undefined) err('unterminated escape at end of input');
  const simple: Record<string, string> = {
    n: '\n', t: '\t', r: '\r', f: '\f', b: '\b', v: '\v', a: '\a',
    '\\': '\\', '"': '"', '/': '/', '?': '?',
  };
  if (c in simple) return [simple[c]!, i + 1];
  // octal \ooo (1–3 digits)
  if (c !== undefined && c >= '0' && c <= '7') {
    let j = i;
    let val = 0;
    while (j < src.length && j < i + 3 && src[j]! >= '0' && src[j]! <= '7') {
      val = val * 8 + (src[j]!.charCodeAt(0) - 48);
      j++;
    }
    return [String.fromCharCode(val), j];
  }
  // hex \xhh
  if (c === 'x') {
    let j = i + 1;
    let val = 0;
    while (j < src.length && j < i + 3 && /[0-9a-fA-F]/.test(src[j]!)) {
      val = val * 16 + parseInt(src[j]!, 16);
      j++;
    }
    if (j === i + 1) return ['x', j]; // lone \x stays literal (gawk keeps it too)
    return [String.fromCharCode(val), j];
  }
  return [c!, i + 1];
}

/* ------------------------------------------------------------------ *
 * AST
 * ------------------------------------------------------------------ */

export type Expr =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'ere'; src: string; ln: number }
  | { k: 'var'; name: string }
  | { k: 'index'; name: string; args: Expr[]; ln: number }
  | { k: 'field'; e: Expr }
  | { k: 'call'; name: string; args: Expr[]; ln: number }
  | { k: 'assign'; op: string; target: Expr; src: Expr }
  | { k: 'ternary'; c: Expr; a: Expr; b: Expr }
  | { k: 'logic'; op: '&&' | '||'; a: Expr; b: Expr }
  | { k: 'in'; args: Expr[]; name: string; ln: number }
  | { k: 'match'; a: Expr; b: Expr; neg: boolean }
  | { k: 'cmp'; op: string; a: Expr; b: Expr }
  | { k: 'cat'; a: Expr; b: Expr }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '%' | '^'; a: Expr; b: Expr; ln: number }
  | { k: 'neg'; op: '-' | '+' | '!'; e: Expr }
  | { k: 'pre'; op: '++' | '--'; e: Expr }
  | { k: 'post'; op: '++' | '--'; e: Expr }
  | { k: 'group'; exprs: Expr[] }
  | { k: 'getline'; target: Expr | null; file: Expr | null; ln: number };

export interface Redirect {
  op: '>' | '>>';
  target: Expr;
}

export type Stmt =
  | { k: 'block'; body: Stmt[] }
  | { k: 'print'; args: Expr[]; redir: Redirect | null; ln: number }
  | { k: 'printf'; args: Expr[]; redir: Redirect | null; ln: number }
  | { k: 'if'; c: Expr; a: Stmt; b: Stmt | null }
  | { k: 'while'; c: Expr; body: Stmt }
  | { k: 'do'; body: Stmt; c: Expr }
  | { k: 'forC'; init: Expr | null; cond: Expr | null; step: Expr | null; body: Stmt }
  | { k: 'forIn'; name: string; arr: string; body: Stmt; ln: number }
  | { k: 'break'; ln: number }
  | { k: 'continue'; ln: number }
  | { k: 'next'; ln: number }
  | { k: 'nextfile'; ln: number }
  | { k: 'exit'; e: Expr | null }
  | { k: 'return'; e: Expr | null; ln: number }
  | { k: 'delete'; name: string; args: Expr[] | null; ln: number }
  | { k: 'expr'; e: Expr; ln: number };

export interface AwkFunction {
  name: string;
  params: string[];
  body: Stmt[];
  ln: number;
}

export interface AwkItem {
  /** BEGIN / END / main pattern-action rules. */
  kind: 'BEGIN' | 'END' | 'main';
  pattern: Expr | null;
  body: Stmt[];
}

export interface AwkProgram {
  items: AwkItem[];
  functions: Map<string, AwkFunction>;
}

/** Builtins the interpreter knows; user functions must not shadow these. */
export const BUILTINS = new Set([
  'length', 'substr', 'index', 'split', 'sub', 'gsub', 'match', 'sprintf',
  'tolower', 'toupper', 'sin', 'cos', 'atan2', 'exp', 'log', 'sqrt', 'int',
  'rand', 'srand', 'close', 'fflush', 'system',
]);

/* ------------------------------------------------------------------ *
 * parser
 * ------------------------------------------------------------------ */

class Parser {
  pos = 0;
  inFunction = false;
  /**
   * Inside print/printf's output list `>` is REDIRECTION, not comparison
   * (the classic awk grammar quirk: `print n > "f"` writes a file; use
   * parens for `print (n > m)`). Nested parens restore the full grammar.
   */
  inPrintList = false;
  /** User function calls seen; verified against definitions at the end. */
  calls: { name: string; ln: number }[] = [];

  constructor(
    private readonly toks: Tok[],
    private readonly functions: Map<string, AwkFunction>,
  ) {}

  private peek(o = 0): Tok | undefined {
    return this.toks[this.pos + o];
  }
  private at(t: string, v?: string): boolean {
    const tok = this.peek();
    return tok !== undefined && tok.t === t && (v === undefined || tok.v === v);
  }
  private next(): Tok {
    const tok = this.toks[this.pos];
    if (tok === undefined) throw new AwkParseError('unexpected end of program');
    this.pos++;
    return tok;
  }
  private ln(): number {
    return this.peek()?.ln ?? 1;
  }
  private describe(tok: Tok | undefined): string {
    if (tok === undefined) return 'end of program';
    if (tok.t === 'nl') return 'newline';
    return `'${tok.v}'`;
  }
  private err(msg: string): never {
    throw new AwkParseError(`cmd. line:${this.ln()}: ${msg}`);
  }
  private expectOp(v: string): void {
    if (!this.at('op', v)) this.err(`syntax error at or near ${this.describe(this.peek())}, expected '${v}'`);
    this.pos++;
  }
  private skipNl(): void {
    while (this.at('nl')) this.pos++;
  }
  /** Optional semicolons/newlines that may trail a simple statement. */
  private skipTerminator(): void {
    while (this.at('nl') || this.at('op', ';')) this.pos++;
  }

  /* ---------------- program ---------------- */

  program(): AwkProgram {
    const items: AwkItem[] = [];
    this.skipTerminator();
    while (this.pos < this.toks.length) {
      if (this.at('kw', 'function') || this.at('kw', 'func')) {
        const fn = this.functionDef();
        this.functions.set(fn.name, fn);
      } else {
        items.push(this.item());
      }
      this.skipTerminator();
    }
    // every call must resolve to a builtin or a defined function
    for (const call of this.calls) {
      if (!BUILTINS.has(call.name) && !this.functions.has(call.name)) {
        throw new AwkParseError(`cmd. line:${call.ln}: calling undefined function ${call.name}`);
      }
    }
    return { items, functions: this.functions };
  }

  /** `function name(params) { body }` — `func` too (one-true-awk spelling). */
  private functionDef(): AwkFunction {
    this.pos++; // function / func
    if (!this.at('name')) this.err('syntax error in function definition, expected name');
    const nameTok = this.next() as { v: string; ln: number };
    const name = nameTok.v;
    if (BUILTINS.has(name)) {
      throw new AwkParseError(`cmd. line:${nameTok.ln}: function name '${name}' conflicts with a builtin`);
    }
    this.expectOp('(');
    const params: string[] = [];
    while (!this.at('op', ')')) {
      if (!this.at('name')) this.err('bad function parameter list');
      params.push((this.next() as { v: string }).v);
      if (this.at('op', ',')) this.pos++;
      else break;
    }
    this.expectOp(')');
    const wasInFunction = this.inFunction;
    this.inFunction = true;
    const body = this.block();
    this.inFunction = wasInFunction;
    return { name, params, body, ln: nameTok.ln };
  }

  private item(): AwkItem {
    if (this.at('kw', 'BEGIN') || this.at('kw', 'END')) {
      const kind = (this.next() as { v: string }).v as 'BEGIN' | 'END';
      if (!this.at('op', '{')) this.err(`syntax error at or near ${this.describe(this.peek())}, expected '{'`);
      return { kind, pattern: null, body: this.block() };
    }
    if (this.at('op', '{')) {
      return { kind: 'main', pattern: null, body: this.block() };
    }
    const pattern = this.expr();
    if (this.at('op', '{')) {
      return { kind: 'main', pattern, body: this.block() };
    }
    // pattern-only rule: the default action prints the record
    return { kind: 'main', pattern, body: [] };
  }

  private block(): Stmt[] {
    this.expectOp('{');
    const body: Stmt[] = [];
    this.skipTerminator();
    while (!this.at('op', '}')) {
      if (this.pos >= this.toks.length) this.err('unexpected end of program, missing \'}\'');
      body.push(this.statement());
      this.skipTerminator();
    }
    this.pos++;
    return body;
  }

  /* ---------------- statements ---------------- */

  private statement(): Stmt {
    const ln = this.ln();
    if (this.at('op', '{')) {
      return { k: 'block', body: this.block() };
    }
    if (this.at('kw', 'print') || this.at('kw', 'printf')) {
      const isPrintf = (this.next().v) === 'printf';
      let args: Expr[] = [];
      let redir: Redirect | null = null;
      // no output list when a terminator OR the redirection `>`/`>>` follows
      if (!this.stmtEndAhead() && !this.at('op', '>') && !this.at('op', '>>')) {
        const outerPrintList = this.inPrintList;
        this.inPrintList = true;
        try {
          args.push(this.expr());
          while (this.at('op', ',')) {
            this.pos++;
            args.push(this.expr());
          }
        } finally {
          this.inPrintList = outerPrintList;
        }
      }
      if (args.length === 0 && !isPrintf) args = [{ k: 'field', e: { k: 'num', v: 0 } }]; // bare print → $0
      if (this.at('op', '>') || this.at('op', '>>')) {
        const op = this.next().v as '>' | '>>';
        redir = { op, target: this.concat() };
        if (this.at('op', '>') || this.at('op', '>>')) this.err('syntax error: multiple output redirections');
      }
      if (this.at('op', '|')) this.err('output pipes are not supported by this awk');
      return isPrintf ? { k: 'printf', args, redir, ln } : { k: 'print', args, redir, ln };
    }
    if (this.at('kw', 'if')) {
      this.pos++;
      this.expectOp('(');
      const c = this.expr();
      this.expectOp(')');
      this.skipNl();
      const a = this.statement();
      this.skipTerminator(); // `if (c) print 1; else print 2` — gawk allows `; else`
      let b: Stmt | null = null;
      if (this.at('kw', 'else')) {
        this.pos++;
        this.skipNl();
        b = this.statement();
      }
      return { k: 'if', c, a, b };
    }
    if (this.at('kw', 'while')) {
      this.pos++;
      this.expectOp('(');
      const c = this.expr();
      this.expectOp(')');
      this.skipNl();
      const body = this.statement();
      return { k: 'while', c, body };
    }
    if (this.at('kw', 'do')) {
      this.pos++;
      this.skipNl();
      const body = this.statement();
      this.skipTerminator();
      if (!this.at('kw', 'while')) this.err('syntax error, expected \'while\' after do-body');
      this.pos++;
      this.expectOp('(');
      const c = this.expr();
      this.expectOp(')');
      return { k: 'do', body, c };
    }
    if (this.at('kw', 'for')) {
      this.pos++;
      this.expectOp('(');
      // for (var in array)
      if (this.at('name') && this.peek(1) !== undefined && this.peek(1)!.t === 'kw' && (this.peek(1) as { v: string }).v === 'in') {
        const name = (this.next() as { v: string }).v;
        this.pos++; // in
        if (!this.at('name')) this.err('syntax error in for-in, expected array name');
        const arr = (this.next() as { v: string }).v;
        this.expectOp(')');
        this.skipNl();
        return { k: 'forIn', name, arr, body: this.statement(), ln };
      }
      const init = this.at('op', ';') ? null : this.expr();
      this.expectOp(';');
      const cond = this.at('op', ';') ? null : this.expr();
      this.expectOp(';');
      const step = this.at('op', ')') ? null : this.expr();
      this.expectOp(')');
      this.skipNl();
      return { k: 'forC', init, cond, step, body: this.statement() };
    }
    if (this.at('kw', 'break')) { this.pos++; return { k: 'break', ln }; }
    if (this.at('kw', 'continue')) { this.pos++; return { k: 'continue', ln }; }
    if (this.at('kw', 'next')) { this.pos++; return { k: 'next', ln }; }
    if (this.at('kw', 'nextfile')) { this.pos++; return { k: 'nextfile', ln }; }
    if (this.at('kw', 'exit')) {
      this.pos++;
      const e = this.stmtEndAhead() ? null : this.expr();
      return { k: 'exit', e };
    }
    if (this.at('kw', 'return')) {
      this.pos++;
      if (!this.inFunction) this.err('return outside of a function');
      const e = this.stmtEndAhead() ? null : this.expr();
      return { k: 'return', e, ln };
    }
    if (this.at('kw', 'delete')) {
      this.pos++;
      if (!this.at('name')) this.err('syntax error in delete, expected array name');
      const name = (this.next() as { v: string }).v;
      let args: Expr[] | null = null;
      if (this.at('op', '[')) {
        this.pos++;
        args = [this.expr()];
        while (this.at('op', ',')) {
          this.pos++;
          args.push(this.expr());
        }
        this.expectOp(']');
      }
      return { k: 'delete', name, args, ln };
    }
    const e = this.expr();
    return { k: 'expr', e, ln };
  }

  /** nl, `;`, `}` or end — a statement list terminator. */
  private stmtEndAhead(): boolean {
    const tok = this.peek();
    if (tok === undefined || tok.t === 'nl' || (tok.t === 'op' && (tok.v === ';' || tok.v === '}'))) return true;
    return false;
  }

  /* ---------------- expressions (precedence ladder) ---------------- */

  expr(): Expr {
    return this.assignment();
  }

  private assignment(): Expr {
    const left = this.ternary();
    const tok = this.peek();
    if (tok !== undefined && tok.t === 'op' && ['=', '+=', '-=', '*=', '/=', '%=', '^='].includes(tok.v)) {
      if (left.k !== 'var' && left.k !== 'index' && left.k !== 'field') {
        this.err('syntax error: assignment target is not a variable, array element or field');
      }
      this.pos++;
      return { k: 'assign', op: tok.v, target: left, src: this.assignment() };
    }
    return left;
  }

  private ternary(): Expr {
    const c = this.logicOr();
    if (this.at('op', '?')) {
      this.pos++;
      const a = this.ternary();
      this.expectOp(':');
      const b = this.ternary();
      return { k: 'ternary', c, a, b };
    }
    return c;
  }

  private logicOr(): Expr {
    let a = this.logicAnd();
    while (this.at('op', '||')) {
      this.pos++;
      a = { k: 'logic', op: '||', a, b: this.logicAnd() };
    }
    return a;
  }

  private logicAnd(): Expr {
    let a = this.inExpr();
    while (this.at('op', '&&')) {
      this.pos++;
      a = { k: 'logic', op: '&&', a, b: this.inExpr() };
    }
    return a;
  }

  private inExpr(): Expr {
    let a = this.matchExpr();
    while (this.at('kw', 'in')) {
      const ln = this.ln();
      this.pos++;
      if (!this.at('name')) this.err('syntax error after `in`, expected array name');
      const name = (this.next() as { v: string }).v;
      a = {
        k: 'in',
        args: a.k === 'group' ? a.exprs : [a],
        name,
        ln,
      };
    }
    return a;
  }

  private matchExpr(): Expr {
    const a = this.relational();
    if (this.at('op', '~') || this.at('op', '!~')) {
      const neg = (this.next().v) === '!~';
      const b = this.relational();
      return { k: 'match', a, b, neg };
    }
    return a;
  }

  private relational(): Expr {
    const a = this.concat();
    const inPrint = this.inPrintList;
    const tok = this.peek();
    if (tok !== undefined && tok.t === 'op' && ['<', '<=', '>', '>=', '!=', '=='].includes(tok.v)) {
      if (inPrint && tok.v === '>') return a; // print list: `>` is redirection
      this.pos++;
      const b = this.concat();
      return { k: 'cmp', op: tok.v, a, b };
    }
    return a;
  }

  /** Adjacent value expressions concatenate (weakest binary level). */
  private concat(): Expr {
    let a = this.additive();
    while (this.concatStarts()) {
      a = { k: 'cat', a, b: this.additive() };
    }
    return a;
  }

  private concatStarts(): boolean {
    const tok = this.peek();
    if (tok === undefined) return false;
    return tok.t === 'num' || tok.t === 'str' || tok.t === 'ere' || tok.t === 'name'
      || (tok.t === 'op' && (tok.v === '(' || tok.v === '$' || tok.v === '!'));
  }

  private additive(): Expr {
    let a = this.multiplicative();
    for (;;) {
      if (this.at('op', '+') || this.at('op', '-')) {
        const op = this.next().v as '+' | '-';
        a = { k: 'bin', op, a, b: this.multiplicative(), ln: this.ln() };
        continue;
      }
      return a;
    }
  }

  private multiplicative(): Expr {
    let a = this.unary();
    for (;;) {
      if (this.at('op', '*') || this.at('op', '/') || this.at('op', '%')) {
        const op = this.next().v as '*' | '/' | '%';
        a = { k: 'bin', op, a, b: this.unary(), ln: this.ln() };
        continue;
      }
      return a;
    }
  }

  private unary(): Expr {
    const tok = this.peek();
    if (tok !== undefined && tok.t === 'op' && (tok.v === '-' || tok.v === '+' || tok.v === '!')) {
      this.pos++;
      return { k: 'neg', op: tok.v as '-' | '+' | '!', e: this.unary() };
    }
    if (tok !== undefined && tok.t === 'op' && (tok.v === '++' || tok.v === '--')) {
      this.pos++;
      const e = this.unary();
      if (e.k !== 'var' && e.k !== 'index' && e.k !== 'field') this.err('syntax error: ++/-- target is not an lvalue');
      return { k: 'pre', op: tok.v as '++' | '--', e };
    }
    return this.power();
  }

  private power(): Expr {
    const base = this.postfix();
    if (this.at('op', '^')) {
      this.pos++;
      return { k: 'bin', op: '^', a: base, b: this.unary(), ln: this.ln() }; // right-assoc
    }
    return base;
  }

  private postfix(): Expr {
    if (this.at('op', '$')) {
      this.pos++;
      const field: Expr = { k: 'field', e: this.fieldOperand() };
      return this.postfixTail(field);
    }
    return this.postfixTail(this.primary());
  }

  private postfixTail(e: Expr): Expr {
    for (;;) {
      if (this.at('op', '++') || this.at('op', '--')) {
        const op = this.next().v as '++' | '--';
        if (e.k !== 'var' && e.k !== 'index' && e.k !== 'field') this.err('syntax error: ++/-- target is not an lvalue');
        e = { k: 'post', op, e };
        continue;
      }
      return e;
    }
  }

  /** The operand of `$`: a primary, or another `$` chain (`$$x`). */
  private fieldOperand(): Expr {
    if (this.at('op', '$')) {
      this.pos++;
      return { k: 'field', e: this.fieldOperand() };
    }
    return this.primary();
  }

  private primary(): Expr {
    const tok = this.peek();
    if (tok === undefined) this.err('unexpected end of expression');
    const ln = tok.ln;
    if (tok.t === 'num') {
      this.pos++;
      return { k: 'num', v: tok.v };
    }
    if (tok.t === 'str') {
      this.pos++;
      return { k: 'str', v: tok.v };
    }
    if (tok.t === 'ere') {
      this.pos++;
      return { k: 'ere', src: tok.v, ln };
    }
    if (tok.t === 'kw' && tok.v === 'getline') {
      this.pos++;
      return this.getlineRest(ln);
    }
    if (tok.t === 'name') {
      this.pos++;
      const name = tok.v;
      if (this.at('op', '(')) {
        this.pos++;
        if (BUILTINS.has(name)) return this.builtinArgs(name, ln);
        this.calls.push({ name, ln });
        const args: Expr[] = [];
        if (!this.at('op', ')')) {
          args.push(this.expr());
          while (this.at('op', ',')) {
            this.pos++;
            args.push(this.expr());
          }
        }
        this.expectOp(')');
        return { k: 'call', name, args, ln };
      }
      if (this.at('op', '[')) {
        this.pos++;
        const args = [this.expr()];
        while (this.at('op', ',')) {
          this.pos++;
          args.push(this.expr());
        }
        this.expectOp(']');
        return { k: 'index', name, args, ln };
      }
      if (name === 'length') return { k: 'call', name, args: [], ln }; // `length` without parens
      return { k: 'var', name };
    }
    if (tok.t === 'op' && tok.v === '(') {
      this.pos++;
      // parens restore the full expression grammar (print's `>` quirk ends)
      const outerPrintList = this.inPrintList;
      this.inPrintList = false;
      try {
        const exprs = [this.expr()];
        while (this.at('op', ',')) {
          this.pos++;
          exprs.push(this.expr());
        }
        this.expectOp(')');
        return { k: 'group', exprs };
      } finally {
        this.inPrintList = outerPrintList;
      }
    }
    this.err(`syntax error at or near ${this.describe(tok)}`);
  }

  /** After the `getline` keyword: optional target, optional `< file`. */
  private getlineRest(ln: number): Expr {
    let target: Expr | null = null;
    if (this.at('name')) {
      const name = (this.next() as { v: string }).v;
      target = this.maybeIndex(name, ln);
    } else if (this.at('op', '$')) {
      this.pos++;
      target = { k: 'field', e: this.fieldOperand() };
    }
    let file: Expr | null = null;
    if (this.at('op', '<')) {
      this.pos++;
      file = this.concat();
    }
    return { k: 'getline', target, file, ln };
  }

  /** Name possibly followed by `[subscripts]` (a getline target). */
  private maybeIndex(name: string, ln: number): Expr {
    if (this.at('op', '[')) {
      this.pos++;
      const args = [this.expr()];
      while (this.at('op', ',')) {
        this.pos++;
        args.push(this.expr());
      }
      this.expectOp(']');
      return { k: 'index', name, args, ln };
    }
    return { k: 'var', name };
  }

  /** Builtin-call argument grammars (split's 2nd arg is an array lvalue). */
  private builtinArgs(name: string, ln: number): Expr {
    const args: Expr[] = [];
    if (!this.at('op', ')')) {
      args.push(this.expr());
      if (name === 'split' && this.at('op', ',')) {
        // second arg is an array lvalue — plain name/index node
        this.pos++;
        if (!this.at('name')) this.err('split: second argument must be an array name');
        const arr = (this.next() as { v: string }).v;
        let second: Expr = { k: 'var', name: arr };
        if (this.at('op', '[')) {
          this.pos++;
          const iargs = [this.expr()];
          while (this.at('op', ',')) {
            this.pos++;
            iargs.push(this.expr());
          }
          this.expectOp(']');
          second = { k: 'index', name: arr, args: iargs, ln };
        }
        args.push(second);
        if (this.at('op', ',')) {
          this.pos++;
          args.push(this.expr());
        }
      } else {
        while (this.at('op', ',')) {
          this.pos++;
          args.push(this.expr());
        }
      }
    }
    this.expectOp(')');
    return { k: 'call', name, args, ln };
  }
}

/** Pre-scan `function name(` / `func name(` so forward calls resolve. */
function scanDefines(toks: Tok[]): Map<string, AwkFunction> {
  const defines = new Map<string, AwkFunction>();
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i]!;
    if (tok.t === 'kw' && (tok.v === 'function' || tok.v === 'func')) {
      const next = toks[i + 1];
      if (next !== undefined && next.t === 'name') {
        defines.set(next.v, { name: next.v, params: [], body: [], ln: next.ln });
      }
    }
  }
  return defines;
}

/**
 * Parse a whole awk program: items (BEGIN/END/pattern-action) + functions,
 * in source order. Throws AwkParseError with a `cmd. line:N:` location on
 * any bad input.
 */
export function parseProgram(src: string): AwkProgram {
  const toks = lex(src);
  const functions = scanDefines(toks);
  const parser = new Parser(toks, functions);
  return parser.program();
}
