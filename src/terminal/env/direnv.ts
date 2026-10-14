/**
 * env/direnv — the declarative `.envrc` subset evaluated on `cd`
 * (CORE-V2 §12).
 *
 * What this module is: one evaluator (`parseEnvrc`) that turns `.envrc`
 * text into ordered set/unset operations, and one session (`DirenvSession`)
 * the shell drives after every directory change. The session layers
 * approved `.envrc` files outermost-first as the working directory
 * deepens, and unwinds exactly the layers it applied when the shell
 * leaves them — every layer remembers the previous value of each name it
 * touched, so unwinding restores what was there before, including
 * restoring a variable an `.envrc` had unset.
 *
 * What it refuses, by design (CORE-V2 §12): `.envrc` is a *declarative
 * subset* — lines of `export NAME=value`, `unset NAME`, comments (`#`),
 * and blanks. Anything else is refused with a stderr warning and the line
 * is skipped; there is no command execution from a document, ever. Values
 * use the same quoting rules as `sh-parse` words: single quotes are
 * literal, double quotes expand `$VAR` / `${VAR}` / `$?` at load time
 * (against the environment as the file has built it so far), bare words
 * expand and honor backslash escapes.
 *
 * Approvals (the allow/deny model): an `.envrc` does not load until
 * `direnv allow` approves its exact content. The approval is stored as a
 * VFS file — `~/.cache/direnv/allow/<sha256-of-content>` — so it
 * persists through whatever backend covers `$HOME` (local-storage, s3)
 * and disappears on `direnv deny` or `storage reset`. Editing the file
 * invalidates the approval (the hash no longer matches).
 *
 * Pure data + VFS reads/writes: no async, no DOM, no imports from the
 * plugin layer — unit-tests in plain Node.
 */

import type { ShellState } from '../terminal-core.js';
import { resolvePath, type Vfs } from '../vfs.js';

/* ------------------------------------------------------------------ *
 * sha256 — content addressing for approvals (sync, dependency-free)
 * ------------------------------------------------------------------ */

/* prettier-ignore */
const SHA_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** SHA-256 of `text` (UTF-8) as lowercase hex — the approval key. */
export function sha256Hex(text: string): string {
  const buf: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) buf.push(c);
    else if (c < 0x800) buf.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) buf.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else buf.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  const bitLen = buf.length * 8;
  const lenHi = Math.floor(bitLen / 0x100000000);
  const lenLo = bitLen >>> 0;
  buf.push(0x80);
  while (buf.length % 64 !== 56) buf.push(0);
  buf.push((lenHi >>> 24) & 255, (lenHi >>> 16) & 255, (lenHi >>> 8) & 255, lenHi & 255);
  buf.push((lenLo >>> 24) & 255, (lenLo >>> 16) & 255, (lenLo >>> 8) & 255, lenLo & 255);

  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  for (let block = 0; block < buf.length; block += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] =
        ((buf[block + i * 4] ?? 0) << 24) |
        ((buf[block + i * 4 + 1] ?? 0) << 16) |
        ((buf[block + i * 4 + 2] ?? 0) << 8) |
        (buf[block + i * 4 + 3] ?? 0);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h[0]!, b = h[1]!, c = h[2]!, d = h[3]!, e = h[4]!, f = h[5]!, g = h[6]!, hh = h[7]!;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + SHA_K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const done = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = (h[i]! + done[i]!) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, '0')).join('');
}

/* ------------------------------------------------------------------ *
 * the .envrc subset — one ordered op list per file
 * ------------------------------------------------------------------ */

export type EnvrcOp =
  /** `export NAME=value` (value already expanded). */
  | { kind: 'set'; name: string; value: string }
  /** `unset NAME`. */
  | { kind: 'unset'; name: string }
  /** Anything else: skipped with this warning — never executed. */
  | { kind: 'refused'; line: number; text: string; reason: string };

const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LEAD_NAME = /^[A-Za-z_][A-Za-z0-9_]*/;

/** `$VAR` / `${VAR}` / `$?` — the `sh-parse` expansion grammar, at load time. */
function expandDollar(src: string, at: number, work: Record<string, string>, lastStatus: number): { value: string; len: number } {
  const rest = src.slice(at + 1);
  if (rest.startsWith('?')) return { value: String(lastStatus), len: 2 };
  if (rest.startsWith('{')) {
    const close = rest.indexOf('}');
    if (close > 0) {
      const name = rest.slice(1, close);
      return { value: name === '?' ? String(lastStatus) : (work[name] ?? ''), len: close + 2 };
    }
    return { value: '${', len: 2 }; // no closing brace: literal, like sh-parse
  }
  const name = LEAD_NAME.exec(rest)?.[0];
  if (name) return { value: work[name] ?? '', len: 1 + name.length };
  return { value: '$', len: 1 }; // bare dollar: literal
}

/** Read one value word starting at `i` (quote-aware); returns the value and end index. */
function scanValueWord(src: string, i: number, work: Record<string, string>, lastStatus: number): { value: string; end: number } | { error: string } {
  let acc = '';
  let at = i;
  while (at < src.length && src[at] !== ' ' && src[at] !== '\t') {
    const c = src[at];
    if (c === "'") {
      const end = src.indexOf("'", at + 1);
      if (end === -1) return { error: 'unterminated single quote' };
      acc += src.slice(at + 1, end); // single quotes: literal
      at = end + 1;
    } else if (c === '"') {
      at++;
      let closed = false;
      while (at < src.length) {
        const d = src[at];
        if (d === '"') {
          closed = true;
          at++;
          break;
        }
        if (d === '\\' && '`"$\\'.includes(src[at + 1] ?? '')) {
          acc += src[at + 1];
          at += 2;
        } else if (d === '$') {
          const got = expandDollar(src, at, work, lastStatus);
          acc += got.value;
          at += got.len;
        } else {
          acc += d;
          at++;
        }
      }
      if (!closed) return { error: 'unterminated double quote' };
    } else if (c === '\\') {
      acc += src[at + 1] ?? '\\'; // escapes the next character (even a space)
      at += 2;
    } else if (c === '$') {
      const got = expandDollar(src, at, work, lastStatus);
      acc += got.value;
      at += got.len;
    } else {
      acc += c;
      at++;
    }
  }
  return { value: acc, end: at };
}

/**
 * Evaluate `.envrc` text to ordered ops. `env` is the environment the
 * file loads on top of (double/bare expansions see it, plus every export
 * earlier in the same file); `lastStatus` feeds `$?`. Refused lines carry
 * their 1-based line number and the raw text — the session prints them,
 * the surrounding lines still apply.
 */
export function parseEnvrc(text: string, env: Record<string, string>, lastStatus = 0): EnvrcOp[] {
  const work: Record<string, string> = { ...env };
  const ops: EnvrcOp[] = [];
  const rows = text.split('\n');
  if (rows[rows.length - 1] === '') rows.pop();
  for (let n = 0; n < rows.length; n++) {
    const line = rows[n]!.trim();
    const refused = (reason: string): EnvrcOp => ({ kind: 'refused', line: n + 1, text: rows[n]!, reason });
    if (line === '' || line.startsWith('#')) continue;
    const [head, ...tail] = line.split(/\s+/);
    if (head === 'export') {
      const rest = line.slice('export'.length).trim();
      if (rest === '') {
        ops.push(refused('bare export is not supported (want export NAME=value)'));
        continue;
      }
      let i = 0;
      let assigned = false;
      let failed = false;
      while (i < rest.length) {
        while (rest[i] === ' ' || rest[i] === '\t') i++;
        if (i >= rest.length) break;
        if (rest[i] === '#') break; // trailing comment
        const name = LEAD_NAME.exec(rest.slice(i))?.[0];
        if (!name || rest[i + name.length] !== '=') {
          ops.push(refused(`"${rest.slice(i).split(/\s+/)[0]}" is not NAME=value`));
          failed = true;
          break;
        }
        i += name.length + 1;
        const scanned = scanValueWord(rest, i, work, lastStatus);
        if ('error' in scanned) {
          ops.push(refused(scanned.error));
          failed = true;
          break;
        }
        ops.push({ kind: 'set', name, value: scanned.value });
        work[name] = scanned.value; // later lines see earlier exports
        assigned = true;
        i = scanned.end;
      }
      if (!assigned && !failed) ops.push(refused('export needs NAME=value'));
      continue;
    }
    if (head === 'unset') {
      if (tail.length === 0) {
        ops.push(refused('unset needs a NAME'));
        continue;
      }
      for (const name of tail) {
        if (!VAR_NAME.test(name)) {
          ops.push(refused(`"${name}" is not a variable name`));
          break;
        }
        ops.push({ kind: 'unset', name });
      }
      continue;
    }
    ops.push(refused('only export/unset assignments are supported (no command execution)'));
  }
  return ops;
}

/* ------------------------------------------------------------------ *
 * the session — layered loads on `cd`, unwinding on leave
 * ------------------------------------------------------------------ */

/** Dim transcript lines (SGR 2; the renderer's ANSI path draws them dim). */
export const ENVRC_LOADED = '[2mdirenv: loaded .envrc[0m';
export const ENVRC_UNLOADED = '[2mdirenv: unloaded .envrc[0m';

/** Where the shell prints direnv's lines — a CommandContext subset. */
export interface DirenvReport {
  out(text: string): void;
  err(text: string): void;
}

interface DirenvLayer {
  dir: string;
  /** Previous value per name this layer touched (null = it was absent). */
  touched: Map<string, string | null>;
}

/** `.envrc` feeds for the chrome (CORE-V2 §11.3: TAB_TITLE / TAB_THEME). */
export interface EnvFeed {
  dir: string;
  /** The live chrome variables after the load — absent keys were unset. */
  vars: Readonly<Record<string, string>>;
}

const feedHandlers = new Set<(feed: EnvFeed) => void>();

/** Subscribe to `.envrc` chrome feeds (TAB_TITLE / TAB_THEME) → unsubscribe. */
export function onEnvFeed(handler: (feed: EnvFeed) => void): () => void {
  feedHandlers.add(handler);
  return () => feedHandlers.delete(handler);
}

const CHROME_VARS = ['TAB_TITLE', 'TAB_THEME'] as const;

export class DirenvSession {
  readonly #state: ShellState;
  readonly #vfs: Vfs;
  /** Loaded layers, outermost first. */
  #layers: DirenvLayer[] = [];

  constructor(state: ShellState, vfs: Vfs) {
    this.#state = state;
    this.#vfs = vfs;
  }

  /** Dirs from `/` down to `dir` (inclusive) that contain an `.envrc`. */
  chain(dir: string): string[] {
    const found: string[] = [];
    if (this.#vfs.read('/.envrc') !== null) found.push('/');
    let walk = '';
    for (const part of dir.split('/')) {
      if (part === '') continue;
      walk += `/${part}`;
      if (this.#vfs.read(`${walk}/.envrc`) !== null) found.push(walk);
    }
    return found;
  }

  /** Directories of the currently loaded layers, outermost first. */
  stack(): string[] {
    return this.#layers.map((layer) => layer.dir);
  }

  /** True when the `.envrc` at `dir` has a current approval for its content. */
  isAllowed(dir: string): boolean {
    const content = this.#vfs.read(resolvePath(dir, '.envrc'));
    if (content === null) return false;
    return this.#vfs.read(`${this.#allowRoot()}/${sha256Hex(content)}`) !== null;
  }

  /**
   * Reconcile the applied layers with the chain of `.envrc` dirs at
   * `dir`: unwind layers the shell left, load newly entered ones
   * (outermost first, stopping at the first blocked file — a deeper
   * `.envrc` never loads over a denied parent). Prints the dim
   * loaded/unloaded comment line through `report` when the chain moved;
   * silence when nothing changed.
   */
  sync(dir: string, report: DirenvReport): void {
    const wanted = this.chain(dir);
    let keep = 0;
    while (keep < this.#layers.length && keep < wanted.length && this.#layers[keep]!.dir === wanted[keep]) keep++;
    let unloaded = 0;
    for (let i = this.#layers.length - 1; i >= keep; i--) {
      this.#unwind(this.#layers[i]!);
      unloaded++;
    }
    this.#layers.length = keep;
    let loaded = 0;
    for (let i = keep; i < wanted.length; i++) {
      const rcDir = wanted[i]!;
      if (!this.isAllowed(rcDir)) {
        report.err(`direnv: ${rcDir}/.envrc is blocked. Run 'direnv allow' to approve its content.`);
        break; // containment: no deeper layer loads over a denied parent
      }
      if (this.#applyLayer(rcDir, report)) loaded++;
    }
    if (loaded > 0) report.out(ENVRC_LOADED);
    else if (unloaded > 0) report.out(ENVRC_UNLOADED);
    if (loaded > 0 || unloaded > 0) this.#notify(dir);
  }

  /**
   * Approve the `.envrc` at `dir` (content-hashed, persisted in the VFS)
   * and load it now: layers at or beneath `dir` unwind first, then
   * `sync` re-walks the chain. False when the dir has no `.envrc`.
   */
  allow(dir: string, report: DirenvReport): boolean {
    const content = this.#vfs.read(resolvePath(dir, '.envrc'));
    if (content === null) return false;
    this.#vfs.mountFile(`${this.#allowRoot()}/${sha256Hex(content)}`, dir);
    this.#dropLayersAtOrBeneath(dir);
    this.sync(this.#state.cwd, report);
    return true;
  }

  /**
   * Revoke the approval for `dir`'s `.envrc` and unload its layer and
   * every layer stacked on top of it. False when the dir has no
   * `.envrc` (nothing to deny).
   */
  deny(dir: string, report: DirenvReport): boolean {
    const content = this.#vfs.read(resolvePath(dir, '.envrc'));
    if (content === null) return false;
    this.#vfs.rm(`${this.#allowRoot()}/${sha256Hex(content)}`, { force: true });
    const dropped = this.#dropLayersAtOrBeneath(dir);
    if (dropped > 0) {
      report.out(ENVRC_UNLOADED);
      this.#notify(this.#state.cwd);
    }
    return true;
  }

  /** The `direnv status` report: allow-list, stack, cwd state. */
  statusLines(): string[] {
    const cwd = this.#state.cwd;
    const inChain = this.chain(cwd).includes(cwd);
    const word = !inChain ? 'not found' : this.isAllowed(cwd) ? 'allowed' : "blocked — run 'direnv allow'";
    const stack = this.stack();
    return [
      'direnv status (semtext-sh declarative subset)',
      `  allow-list: ${this.#allowRoot()}`,
      `  loaded .envrc: ${stack.length > 0 ? stack.join(' ') : '(none)'}`,
      `  .envrc (${cwd}): ${word}`,
    ];
  }

  /* internals */

  #allowRoot(): string {
    return resolvePath(this.#state.env.HOME ?? '/', '.cache/direnv/allow');
  }

  #applyLayer(rcDir: string, report: DirenvReport): boolean {
    const content = this.#vfs.read(resolvePath(rcDir, '.envrc'));
    if (content === null) return false;
    const touched = new Map<string, string | null>();
    const env = this.#state.env;
    for (const op of parseEnvrc(content, env, this.#state.lastStatus)) {
      if (op.kind === 'refused') {
        report.err(`direnv: ${rcDir}/.envrc:${op.line}: skipped: ${op.text.trim()} (${op.reason})`);
        continue;
      }
      if (!touched.has(op.name)) touched.set(op.name, env[op.name] ?? null);
      if (op.kind === 'set') env[op.name] = op.value;
      else delete env[op.name];
    }
    this.#layers.push({ dir: rcDir, touched });
    return true;
  }

  #unwind(layer: DirenvLayer): void {
    const env = this.#state.env;
    for (const [name, previous] of layer.touched) {
      if (previous === null) delete env[name];
      else env[name] = previous;
    }
  }

  /** Unwind layers at or beneath `dir` (all of them when `dir` is `/`). */
  #dropLayersAtOrBeneath(dir: string): number {
    const atOrBeneath = (d: string): boolean => dir === '/' || d === dir || d.startsWith(`${dir}/`);
    const keep = this.#layers.filter((layer) => !atOrBeneath(layer.dir));
    const dropped = this.#layers.length - keep.length;
    for (const layer of this.#layers) {
      if (!keep.includes(layer)) this.#unwind(layer);
    }
    this.#layers = keep;
    return dropped;
  }

  #notify(dir: string): void {
    if (feedHandlers.size === 0) return;
    const vars: Record<string, string> = {};
    for (const name of CHROME_VARS) {
      const value = this.#state.env[name];
      if (value !== undefined) vars[name] = value;
    }
    for (const handler of [...feedHandlers]) handler({ dir, vars });
  }
}

const sessions = new WeakMap<ShellState, DirenvSession>();

/** The session for one shell state (created on first use). */
export function direnvSession(state: ShellState, vfs: Vfs): DirenvSession {
  let session = sessions.get(state);
  if (!session) {
    session = new DirenvSession(state, vfs);
    sessions.set(state, session);
  }
  return session;
}
