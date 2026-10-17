/**
 * poc/wasm/asm/programs.mjs — the four PoC programs, hand-encoded through
 * minias (see minias.mjs for why this exists). Each builder returns the
 * .wasm bytes for one WASI command module exporting _start + memory.
 *
 *   hello.wasm  fd_write + proc_exit — the smallest possible guest.
 *   wcat.wasm   fd_read loop echoing stdin to stdout (cat); n == 0 is EOF.
 *   wargs.wasm  args_get + environ_get + clock_time_get + decimal
 *               formatting with i64 division — real compute, real ABI.
 *   wtype.wasm  path_open against the preopen snapshot + read loop +
 *               fd_close (cat FILE): proves the VFS-backed fd table.
 *
 * JS functions are the macro layer: strlenInto / copyBytes / writeStatic /
 * writeRange. Rebuild with `node poc/wasm/asm/build.mjs` (writes
 * poc/wasm/bin/ — the committed fixtures are byte-identical; the unit
 * suite re-assembles and compares).
 */

import { flat, I, SIG, WASI, WasmModule } from './minias.mjs';

const I32 = 0x7f;
const I64 = 0x7e;

/* ------------------------------------------------------------------ *
 * macros (emit instruction arrays; locals are numbered by the caller)
 * ------------------------------------------------------------------ */

/**
 * strlen into $len walking $cur from $src (a local holding an address).
 * Stack-neutral; clobbers $cur and $len.
 */
const strlenInto = ($len, $cur, $src) =>
  flat(
    I.localGet($src),
    I.localSet($cur),
    I.block(),
    I.loop(),
    I.localGet($cur),
    I.i32load8u(),
    I.i32eqz(),
    I.br_if(1),
    I.localGet($cur),
    I.i32const(1),
    I.i32add(),
    I.localSet($cur),
    I.br(0),
    I.end(),
    I.end(),
    I.localGet($cur),
    I.localGet($src),
    I.i32sub(),
    I.localSet($len),
  );

/**
 * Copy `len` bytes (a JS number, immediate) from the literal address
 * `src` to the address in local $dst, advancing $dst by len. Clobbers
 * $cur and $k.
 */
const copyBytes = ($dst, $cur, $k, src, len) =>
  flat(
    I.i32const(src),
    I.localSet($cur),
    I.i32const(0),
    I.localSet($k),
    I.block(),
    I.loop(),
    I.localGet($k),
    I.i32const(len),
    I.i32ltu(),
    I.i32eqz(),
    I.br_if(1),
    I.localGet($dst),
    I.localGet($cur),
    I.i32load8u(),
    I.i32store8(),
    I.localGet($dst),
    I.i32const(1),
    I.i32add(),
    I.localSet($dst),
    I.localGet($cur),
    I.i32const(1),
    I.i32add(),
    I.localSet($cur),
    I.localGet($k),
    I.i32const(1),
    I.i32add(),
    I.localSet($k),
    I.br(0),
    I.end(),
    I.end(),
  );

/** fd_write(1, iov, 1, nw) with the iov patched to ($ptr, $len) locals. */
const writeRange = (write, $ptr, $len, iov, nw) =>
  flat(
    I.i32const(iov),
    I.localGet($ptr),
    I.i32store(),
    I.i32const(iov + 4),
    I.localGet($len),
    I.i32store(),
    I.i32const(1),
    I.i32const(iov),
    I.i32const(1),
    I.i32const(nw),
    I.call(write),
    I.drop(),
  );

/** fd_write(1, iov, 1, nw) with the iov patched to literal (src, len). */
const writeStatic = (write, src, len, iov, nw) =>
  flat(
    I.i32const(iov),
    I.i32const(src),
    I.i32store(),
    I.i32const(iov + 4),
    I.i32const(len),
    I.i32store(),
    I.i32const(1),
    I.i32const(iov),
    I.i32const(1),
    I.i32const(nw),
    I.call(write),
    I.drop(),
  );

/* ------------------------------------------------------------------ *
 * hello
 * ------------------------------------------------------------------ */

const HELLO_TEXT = 'hello from wasm\n';

export function buildHello() {
  const m = new WasmModule();
  const fdWrite = m.import(WASI, 'fd_write', ...SIG.iiii_i);
  const procExit = m.import(WASI, 'proc_exit', ...SIG.i_);
  const HELLO = 64;
  m.data(HELLO, HELLO_TEXT);
  m.memory(1);
  const start = m.func(
    [],
    [],
    flat(
      I.i32const(8),
      I.i32const(HELLO),
      I.i32store(),
      I.i32const(12),
      I.i32const(HELLO_TEXT.length),
      I.i32store(),
      I.i32const(1),
      I.i32const(8),
      I.i32const(1),
      I.i32const(24),
      I.call(fdWrite),
      I.drop(),
      I.i32const(0),
      I.call(procExit),
      I.end(),
    ),
  );
  m.exportFunc('_start', start);
  m.exportMemory('memory');
  return m.build();
}

/* ------------------------------------------------------------------ *
 * wcat — echo stdin to stdout until EOF
 * ------------------------------------------------------------------ */

export function buildWcat() {
  const m = new WasmModule();
  const fdRead = m.import(WASI, 'fd_read', ...SIG.iiii_i);
  const fdWrite = m.import(WASI, 'fd_write', ...SIG.iiii_i);
  const procExit = m.import(WASI, 'proc_exit', ...SIG.i_);
  m.memory(1);
  const N = 0; // local $n
  const start = m.func(
    [],
    [['n', I32]],
    flat(
      // iov_in at 8: {1024, 32768}; iov_out at 16: {1024, patched per turn}
      I.i32const(8),
      I.i32const(1024),
      I.i32store(),
      I.i32const(12),
      I.i32const(32768),
      I.i32store(),
      I.i32const(16),
      I.i32const(1024),
      I.i32store(),
      I.i32const(20),
      I.i32const(0),
      I.i32store(),
      I.block(),
      I.loop(),
      I.i32const(0),
      I.i32const(8),
      I.i32const(1),
      I.i32const(24),
      I.call(fdRead),
      I.drop(), // errno — the read count lands in memory at 24
      I.i32const(24),
      I.i32load(),
      I.localSet(N),
      I.localGet(N),
      I.i32eqz(),
      I.br_if(1), // EOF
      I.i32const(20),
      I.localGet(N),
      I.i32store(),
      I.i32const(1),
      I.i32const(16),
      I.i32const(1),
      I.i32const(28),
      I.call(fdWrite),
      I.drop(),
      I.br(0),
      I.end(),
      I.end(),
      I.i32const(0),
      I.call(procExit),
      I.end(),
    ),
  );
  m.exportFunc('_start', start);
  m.exportMemory('memory');
  return m.build();
}

/* ------------------------------------------------------------------ *
 * wargs — print argv, environ, realtime clock (decimal, i64 math)
 * ------------------------------------------------------------------ */

export function buildWargs() {
  const m = new WasmModule();
  const argsSizes = m.import(WASI, 'args_sizes_get', ...SIG.ii_i);
  const argsGet = m.import(WASI, 'args_get', ...SIG.ii_i);
  const envSizes = m.import(WASI, 'environ_sizes_get', ...SIG.ii_i);
  const envGet = m.import(WASI, 'environ_get', ...SIG.ii_i);
  const clockGet = m.import(WASI, 'clock_time_get', ...SIG.iLi_i);
  const fdWrite = m.import(WASI, 'fd_write', ...SIG.iiii_i);
  const procExit = m.import(WASI, 'proc_exit', ...SIG.i_);

  const ARGC = 0,
    ECOUNT = 8,
    CLOCK = 16; // i64
  const ARGV = 64,
    ARGSTR = 512,
    ENVP = 4096,
    ENVSTR = 4608,
    IOV = 8192,
    NW = 8200,
    OUT = 8448,
    DIGITS = 20480;
  const S_ARGS = 32768,
    S_ENV = S_ARGS + 6,
    S_CLOCK = S_ENV + 5;
  m.data(S_ARGS, 'args:\n');
  m.data(S_ENV, 'env:\n');
  m.data(S_CLOCK, 'clock_ms: ');

  // locals 0..9: dst i len cur k argc ecount v(i64) d p
  const L = { dst: 0, i: 1, len: 2, cur: 3, k: 4, argc: 5, ecount: 6, v: 7, d: 8, p: 9 };

  const start = m.func(
    [],
    [
      ['dst', I32],
      ['i', I32],
      ['len', I32],
      ['cur', I32],
      ['k', I32],
      ['argc', I32],
      ['ecount', I32],
      ['v', I64],
      ['d', I32],
      ['p', I32],
    ],
    flat(
      I.i32const(0), // &argc
      I.i32const(4), // &argv_buf_size
      I.call(argsSizes),
      I.drop(),
      I.i32const(ARGV),
      I.i32const(ARGSTR),
      I.call(argsGet),
      I.drop(),
      I.i32const(8), // &env count (ECOUNT)
      I.i32const(12), // &env buf size
      I.call(envSizes),
      I.drop(),
      I.i32const(ENVP),
      I.i32const(ENVSTR),
      I.call(envGet),
      I.drop(),
      I.i32const(0), // realtime
      I.i64const(0), // precision
      I.i32const(CLOCK),
      I.call(clockGet),
      I.drop(),
      I.i32const(0),
      I.i32load(),
      I.localSet(L.argc),
      I.i32const(8),
      I.i32load(),
      I.localSet(L.ecount),
      I.i32const(OUT),
      I.localSet(L.dst),
      // "args:\n"
      ...copyBytes(L.dst, L.cur, L.k, S_ARGS, 6),
      // each arg
      I.i32const(0),
      I.localSet(L.i),
      I.block(),
      I.loop(),
      I.localGet(L.i),
      I.localGet(L.argc),
      I.i32ltu(),
      I.i32eqz(),
      I.br_if(1),
      I.i32const(ARGV),
      I.localGet(L.i),
      I.i32const(4),
      I.i32mul(),
      I.i32add(),
      I.i32load(),
      I.localSet(L.p),
      strlenInto(L.len, L.cur, L.p),
      copyBytesLocalLen(L.dst, L.cur, L.k, L.p, L.len),
      I.localGet(L.dst),
      I.i32const(10),
      I.i32store8(),
      I.localGet(L.dst),
      I.i32const(1),
      I.i32add(),
      I.localSet(L.dst),
      I.localGet(L.i),
      I.i32const(1),
      I.i32add(),
      I.localSet(L.i),
      I.br(0),
      I.end(),
      I.end(),
      // "env:\n"
      ...copyBytes(L.dst, L.cur, L.k, S_ENV, 5),
      I.i32const(0),
      I.localSet(L.i),
      I.block(),
      I.loop(),
      I.localGet(L.i),
      I.localGet(L.ecount),
      I.i32ltu(),
      I.i32eqz(),
      I.br_if(1),
      I.i32const(ENVP),
      I.localGet(L.i),
      I.i32const(4),
      I.i32mul(),
      I.i32add(),
      I.i32load(),
      I.localSet(L.p),
      strlenInto(L.len, L.cur, L.p),
      copyBytesLocalLen(L.dst, L.cur, L.k, L.p, L.len),
      I.localGet(L.dst),
      I.i32const(10),
      I.i32store8(),
      I.localGet(L.dst),
      I.i32const(1),
      I.i32add(),
      I.localSet(L.dst),
      I.localGet(L.i),
      I.i32const(1),
      I.i32add(),
      I.localSet(L.i),
      I.br(0),
      I.end(),
      I.end(),
      // "clock_ms: "
      ...copyBytes(L.dst, L.cur, L.k, S_CLOCK, 10),
      // v = clock / 1_000_000; emit digits backwards from DIGITS+63
      I.i32const(CLOCK),
      I.i64load(),
      I.i64const(1000000),
      I.i64divu(),
      I.localSet(L.v),
      I.i32const(DIGITS + 63),
      I.localSet(L.d),
      I.loop(),
      I.localGet(L.d),
      I.localGet(L.v),
      I.i64const(10),
      I.i64remu(),
      I.i32wrapI64(),
      I.i32const(48),
      I.i32add(),
      I.i32store8(),
      I.localGet(L.d),
      I.i32const(1),
      I.i32sub(),
      I.localSet(L.d),
      I.localGet(L.v),
      I.i64const(10),
      I.i64divu(),
      I.localSet(L.v),
      I.localGet(L.v),
      I.i64eqz(),
      I.i32eqz(),
      I.br_if(0),
      I.end(),
      // p = d+1; len = DIGITS+64-p; copy
      I.localGet(L.d),
      I.i32const(1),
      I.i32add(),
      I.localSet(L.p),
      I.i32const(DIGITS + 64),
      I.localGet(L.p),
      I.i32sub(),
      I.localSet(L.len),
      copyBytesLocalLen(L.dst, L.cur, L.k, L.p, L.len),
      I.localGet(L.dst),
      I.i32const(10),
      I.i32store8(),
      I.localGet(L.dst),
      I.i32const(1),
      I.i32add(),
      I.localSet(L.dst),
      // final write of OUT..dst
      I.i32const(OUT),
      I.localSet(L.p),
      I.localGet(L.dst),
      I.localGet(L.p),
      I.i32sub(),
      I.localSet(L.len),
      writeRange(fdWrite, L.p, L.len, IOV, NW),
      I.i32const(0),
      I.call(procExit),
      I.end(),
    ),
  );
  m.exportFunc('_start', start);
  m.exportMemory('memory');
  return m.build();
}

/**
 * copyBytes with the length in a LOCAL (runtime length): the loop bound
 * reads $len instead of an immediate. Same clobber rules.
 */
function copyBytesLocalLen($dst, $cur, $k, $src, $len) {
  return flat(
    I.localGet($src),
    I.localSet($cur),
    I.i32const(0),
    I.localSet($k),
    I.block(),
    I.loop(),
    I.localGet($k),
    I.localGet($len),
    I.i32ltu(),
    I.i32eqz(),
    I.br_if(1),
    I.localGet($dst),
    I.localGet($cur),
    I.i32load8u(),
    I.i32store8(),
    I.localGet($dst),
    I.i32const(1),
    I.i32add(),
    I.localSet($dst),
    I.localGet($cur),
    I.i32const(1),
    I.i32add(),
    I.localSet($cur),
    I.localGet($k),
    I.i32const(1),
    I.i32add(),
    I.localSet($k),
    I.br(0),
    I.end(),
    I.end(),
  );
}

/* ------------------------------------------------------------------ *
 * wtype — path_open + read loop (cat FILE against the preopen)
 * ------------------------------------------------------------------ */

const USAGE_TEXT = 'usage: wtype FILE\n';
const FAIL_TEXT = "wtype: cannot open '";
const QNL_TEXT = "'\n";

export function buildWtype() {
  const m = new WasmModule();
  const argsSizes = m.import(WASI, 'args_sizes_get', ...SIG.ii_i);
  const argsGet = m.import(WASI, 'args_get', ...SIG.ii_i);
  const pathOpen = m.import(WASI, 'path_open', ...SIG.iiiiiLLi_i);
  const fdRead = m.import(WASI, 'fd_read', ...SIG.iiii_i);
  const fdWrite = m.import(WASI, 'fd_write', ...SIG.iiii_i);
  const fdClose = m.import(WASI, 'fd_close', ...SIG.i_i);
  const procExit = m.import(WASI, 'proc_exit', ...SIG.i_);

  const FD = 8,
    NREAD = 12,
    NW = 16,
    IOVIN = 24,
    IOVOUT = 32,
    ARGV = 64,
    ARGSTR = 512,
    BUF = 1024;
  const S_USAGE = 32768,
    S_FAIL = S_USAGE + USAGE_TEXT.length,
    S_QNL = S_FAIL + FAIL_TEXT.length;
  m.data(S_USAGE, USAGE_TEXT);
  m.data(S_FAIL, FAIL_TEXT);
  m.data(S_QNL, QNL_TEXT);
  m.memory(1);

  // locals 0..4: n argc p len cur
  const L = { n: 0, argc: 1, p: 2, len: 3, cur: 4 };

  const start = m.func(
    [],
    [
      ['n', I32],
      ['argc', I32],
      ['p', I32],
      ['len', I32],
      ['cur', I32],
    ],
    flat(
      I.i32const(0), // &argc
      I.i32const(4), // &argv_buf_size
      I.call(argsSizes),
      I.drop(),
      I.i32const(ARGV),
      I.i32const(ARGSTR),
      I.call(argsGet),
      I.drop(),
      // iovs
      I.i32const(IOVIN),
      I.i32const(BUF),
      I.i32store(),
      I.i32const(IOVIN + 4),
      I.i32const(32768),
      I.i32store(),
      I.i32const(IOVOUT),
      I.i32const(BUF),
      I.i32store(),
      I.i32const(IOVOUT + 4),
      I.i32const(0),
      I.i32store(),
      // argc < 2 → usage, exit 2
      I.i32const(0),
      I.i32load(),
      I.localSet(L.argc),
      I.block(),
      I.localGet(L.argc),
      I.i32const(2),
      I.i32lts(),
      I.i32eqz(),
      I.br_if(0),
      writeStatic(fdWrite, S_USAGE, USAGE_TEXT.length, IOVOUT, NW),
      I.i32const(2),
      I.call(procExit),
      I.end(),
      // p = argv[1]; len = strlen(p)
      I.i32const(ARGV + 4),
      I.i32load(),
      I.localSet(L.p),
      strlenInto(L.len, L.cur, L.p),
      // path_open(3, 0, p, len, 0, -1, 0, &fd) — errno nonzero → fail path
      I.block(),
      I.i32const(3),
      I.i32const(0),
      I.localGet(L.p),
      I.localGet(L.len),
      I.i32const(0),
      I.i64const(-1),
      I.i64const(0),
      I.i32const(FD),
      I.call(pathOpen),
      I.i32eqz(),
      I.br_if(0),
      writeStatic(fdWrite, S_FAIL, FAIL_TEXT.length, IOVOUT, NW),
      writeRange(fdWrite, L.p, L.len, IOVOUT, NW),
      writeStatic(fdWrite, S_QNL, QNL_TEXT.length, IOVOUT, NW),
      I.i32const(1),
      I.call(procExit),
      I.end(),
      // read loop until EOF
      I.block(),
      I.loop(),
      I.i32const(FD),
      I.i32load(),
      I.i32const(IOVIN),
      I.i32const(1),
      I.i32const(NREAD),
      I.call(fdRead),
      I.drop(), // errno — count lands in NREAD
      I.i32const(NREAD),
      I.i32load(),
      I.localSet(L.n),
      I.localGet(L.n),
      I.i32eqz(),
      I.br_if(1),
      I.i32const(IOVOUT + 4),
      I.localGet(L.n),
      I.i32store(),
      I.i32const(1),
      I.i32const(IOVOUT),
      I.i32const(1),
      I.i32const(NW),
      I.call(fdWrite),
      I.drop(),
      I.br(0),
      I.end(),
      I.end(),
      I.i32const(FD),
      I.i32load(),
      I.call(fdClose),
      I.drop(),
      I.i32const(0),
      I.call(procExit),
      I.end(),
    ),
  );
  m.exportFunc('_start', start);
  m.exportMemory('memory');
  return m.build();
}

export const PROGRAMS = {
  hello: buildHello,
  wcat: buildWcat,
  wargs: buildWargs,
  wtype: buildWtype,
};
