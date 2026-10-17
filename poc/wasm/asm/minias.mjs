/**
 * poc/wasm/asm/minias.mjs — the wat2wasm-free path (round-3 LANE=wasm-poc).
 *
 * This machine has no wasm-capable toolchain today (rustup carries no
 * wasm32 target; Apple clang ships no wasm32 backend) and the brief
 * forbids installing one. This file is the blessed fallback: a tiny JS
 * assembler that emits real .wasm binaries (sections, imports, memory,
 * code, data) for a fixed set of small WASI programs, so the shim and
 * the app run REAL WebAssembly modules — hand-encoded, not vendored,
 * and byte-reproducible (test/unit/wasm-shim.test.ts re-assembles and
 * compares against the committed poc/wasm/bin/*.wasm fixtures).
 *
 * Scope is deliberately minimal: i32/i64 only, named instruction
 * emitters, no control-flow verification beyond what the encoder
 * produces. Programs are written as JS (see programs.mjs) composing
 * emitter arrays — JS functions ARE the macro facility.
 */

/* ------------------------------------------------------------------ *
 * LEB128
 * ------------------------------------------------------------------ */

/** Unsigned LEB128 (indices, lengths, counts). */
export function uleb(n) {
  const out = [];
  let v = n;
  do {
    let byte = v & 0x7f;
    v = Math.floor(v / 128);
    if (v > 0) byte |= 0x80;
    out.push(byte);
  } while (v > 0);
  return out;
}

/** Signed LEB128 for an i32 immediate. */
export function sleb32(n) {
  const out = [];
  let v = n;
  while (true) {
    let byte = v & 0x7f;
    v >>= 7;
    const done = (v === 0 && (byte & 0x40) === 0) || (v === -1 && (byte & 0x40) !== 0);
    if (!done) byte |= 0x80;
    out.push(byte);
    if (done) return out;
  }
}

/** Signed LEB128 for an i64 immediate (BigInt). */
export function sleb64(v) {
  const out = [];
  let x = BigInt(v);
  while (true) {
    let byte = Number(x & 0x7fn);
    x >>= 7n;
    const done = (x === 0n && (byte & 0x40) === 0) || (x === -1n && (byte & 0x40) !== 0);
    if (!done) byte |= 0x80;
    out.push(byte);
    if (done) return out;
  }
}

/** UTF-8 name bytes with their u32 length prefix. */
export function nameBytes(s) {
  const bytes = [...new TextEncoder().encode(s)];
  return [...uleb(bytes.length), ...bytes];
}

/** Flatten a mix of numbers/arrays into one flat byte array. */
export function flat(...parts) {
  const out = [];
  const push = (p) => {
    if (typeof p === 'number') out.push(p);
    else for (const b of p) push(b);
  };
  for (const p of parts) push(p);
  return out;
}

/* ------------------------------------------------------------------ *
 * Instruction emitters (i32/i64 core subset)
 * ------------------------------------------------------------------ */

export const I = {
  unreachable: () => [0x00],
  nop: () => [0x01],
  block: () => [0x02, 0x40], // void blocktype
  loop: () => [0x03, 0x40],
  end: () => [0x0b],
  br: (l) => [0x0c, ...uleb(l)],
  br_if: (l) => [0x0d, ...uleb(l)],
  return_: () => [0x0f],
  call: (f) => [0x10, ...uleb(f)],
  drop: () => [0x1a],
  select: () => [0x1b],
  localGet: (i) => [0x20, ...uleb(i)],
  localSet: (i) => [0x21, ...uleb(i)],
  localTee: (i) => [0x22, ...uleb(i)],
  i32const: (n) => [0x41, ...sleb32(n)],
  i64const: (n) => [0x42, ...sleb64(n)],
  i32load: (off = 0) => [0x28, 0x02, ...uleb(off)],
  i64load: (off = 0) => [0x29, 0x03, ...uleb(off)],
  i32load8u: (off = 0) => [0x2d, 0x00, ...uleb(off)],
  i32store: (off = 0) => [0x36, 0x02, ...uleb(off)],
  i64store: (off = 0) => [0x37, 0x03, ...uleb(off)],
  i32store8: (off = 0) => [0x3a, 0x00, ...uleb(off)],
  i32eqz: () => [0x45],
  i32eq: () => [0x46],
  i32ne: () => [0x47],
  i32lts: () => [0x48],
  i32ltu: () => [0x49],
  i32gts: () => [0x4a],
  i32gtu: () => [0x4b],
  i32les: () => [0x4c],
  i32leu: () => [0x4d],
  i32ges: () => [0x4e],
  i32geu: () => [0x4f],
  i64eqz: () => [0x50],
  i32add: () => [0x6a],
  i32sub: () => [0x6b],
  i32mul: () => [0x6c],
  i32divu: () => [0x6e],
  i32remu: () => [0x70],
  i32and: () => [0x71],
  i32or: () => [0x72],
  i32shl: () => [0x74],
  i32shru: () => [0x76],
  i64add: () => [0x7c],
  i64sub: () => [0x7d],
  i64mul: () => [0x7e],
  i64divu: () => [0x80],
  i64remu: () => [0x82],
  i64shr_u: () => [0x88],
  i32wrapI64: () => [0xa7],
};

/* ------------------------------------------------------------------ *
 * Module builder
 * ------------------------------------------------------------------ */

const I32 = 0x7f;
const I64 = 0x7e;

/**
 * A minimal wasm module builder. Usage:
 *
 *   const m = new WasmModule();
 *   const write = m.import('wasi_snapshot_preview1', 'fd_write', [I32, I32, I32, I32], [I32]);
 *   const start = m.func([], [], [ ...I.i32const(0), ...I.call(write), ...I.drop, ...I.end() ]);
 *   m.memory(1);
 *   m.exportFunc('_start', start);
 *   m.exportMemory('memory');
 *   m.data(64, 'hello\n');
 *   const bytes = m.build();
 */
export class WasmModule {
  #types = [];
  #imports = [];
  #funcs = [];
  #exports = [];
  #memory = null;
  #data = [];
  #dataBytes = 0;

  /** Register a functype; returns its index (deduplicated). */
  type(params, results) {
    const key = `${params.join(',')}=>${results.join(',')}`;
    const found = this.#types.findIndex((t) => t.key === key);
    if (found !== -1) return found;
    this.#types.push({ key, params, results });
    return this.#types.length - 1;
  }

  /** Import a function; returns its function index. */
  import(module, field, params, results) {
    this.#imports.push({ module, field, type: this.type(params, results) });
    return this.#imports.length - 1;
  }

  /** Define a function with locals (e.g. [['n', I32]]) and a flat body. */
  func(params, locals, body) {
    if (body[body.length - 1] !== 0x0b) {
      throw new Error('minias: function body must end with I.end() (0x0b)');
    }
    this.#funcs.push({ type: this.type(params, []), locals, body });
    return this.#imports.length + this.#funcs.length - 1;
  }

  memory(minPages) {
    this.#memory = minPages;
  }

  exportFunc(name, index) {
    this.#exports.push({ name, kind: 0x00, index });
  }

  exportMemory(name) {
    this.#exports.push({ name, kind: 0x02, index: 0 });
  }

  /** Active data segment at a constant offset. `bytes` is string | number[]. */
  data(offset, bytes) {
    const arr = typeof bytes === 'string' ? [...new TextEncoder().encode(bytes)] : bytes;
    if (offset + arr.length > this.#dataBytes) this.#dataBytes = offset + arr.length;
    this.#data.push({ offset, bytes: arr });
  }

  build() {
    const pages = Math.max(this.#memory ?? 0, Math.ceil(this.#dataBytes / 65536));
    if (pages === 0) throw new Error('minias: no memory and no data — call memory()');
    const sections = [];
    const section = (id, payload) => {
      sections.push(id, ...uleb(payload.length), ...payload);
    };

    // 1 type
    if (this.#types.length > 0) {
      const payload = [...uleb(this.#types.length)];
      for (const t of this.#types) {
        payload.push(0x60, ...uleb(t.params.length), ...t.params, ...uleb(t.results.length), ...t.results);
      }
      section(1, payload);
    }
    // 2 import
    if (this.#imports.length > 0) {
      const payload = [...uleb(this.#imports.length)];
      for (const imp of this.#imports) {
        payload.push(...nameBytes(imp.module), ...nameBytes(imp.field), 0x00, ...uleb(imp.type));
      }
      section(2, payload);
    }
    // 3 function
    if (this.#funcs.length > 0) {
      const payload = [...uleb(this.#funcs.length)];
      for (const f of this.#funcs) payload.push(...uleb(f.type));
      section(3, payload);
    }
    // 5 memory
    if (this.#memory !== null || this.#data.length > 0) {
      section(5, [0x01, 0x00, ...uleb(pages)]);
    }
    // 7 export
    if (this.#exports.length > 0) {
      const payload = [...uleb(this.#exports.length)];
      for (const e of this.#exports) payload.push(...nameBytes(e.name), e.kind, ...uleb(e.index));
      section(7, payload);
    }
    // 10 code
    if (this.#funcs.length > 0) {
      const bodies = [];
      for (const f of this.#funcs) {
        const locals = [];
        for (const [, ty] of f.locals) locals.push(0x01, ty); // one each, uleb count 1
        const body = [...uleb(f.locals.length), ...locals, ...f.body];
        bodies.push(...uleb(body.length), ...body);
      }
      section(10, [...uleb(this.#funcs.length), ...bodies]);
    }
    // 11 data
    if (this.#data.length > 0) {
      const payload = [...uleb(this.#data.length)];
      for (const seg of this.#data) {
        payload.push(0x00, ...I.i32const(seg.offset), ...I.end(), ...uleb(seg.bytes.length), ...seg.bytes);
      }
      section(11, payload);
    }

    return new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, ...sections]);
  }
}

/** The wasi import module name the shim serves. */
export const WASI = 'wasi_snapshot_preview1';

/** Common wasi import signatures as (params, results) pairs. */
export const SIG = {
  /** (i32,i32,i32,i32) -> i32 — fd_write / fd_read / fd_seek(fd,off:i32?,..) */
  iiii_i: [[I32, I32, I32, I32], [I32]],
  /** (i32,i32) -> i32 — args_sizes_get etc. */
  ii_i: [[I32, I32], [I32]],
  /** (i32) -> i32 — fd_close, fd_fdstat_get, random_get-ish, fd_prestat_get */
  i_i: [[I32], [I32]],
  /** (i32) -> () — proc_exit */
  i_: [[I32], []],
  /** (i32,i64,i32) -> i32 — clock_time_get */
  iLi_i: [[I32, I64, I32], [I32]],
  /** (i32,i32,i32,i32,i32,i64,i64,i32) -> i32 — path_open */
  iiiiiLLi_i: [[I32, I32, I32, I32, I32, I64, I64, I32], [I32]],
  /** (i32,i32,i32,i32,i32,i64,i64,i32...) path_filestat_get: (i32,i32,i32,i32,i32) -> i32 */
  iiiii_i: [[I32, I32, I32, I32, I32], [I32]],
};

export { I32, I64 };
