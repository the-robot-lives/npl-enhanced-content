/**
 * wasm/wasi — a WASI preview1 (wasi_snapshot_preview1) host for the
 * CORE-V2 Appendix-A spike: the smallest real kernel surface behind the
 * SAME terminal app API. The shim owns:
 *
 *   - args / environ (copied into module memory on demand),
 *   - a VFS-backed fd table: 0/1/2 stdio, preopen dirs snapshotted from
 *     the shell VFS at spawn (the appendix's "flat filesystem image",
 *     ours snapshotted rather than linked), files opened by path_open,
 *   - clock_time_get / random_get,
 *   - proc_exit as a thrown sentinel that unwinds through _start.
 *
 * What is deliberately NOT here (documented in docs/terminal/WASM-POC.md):
 * writes (the snapshot is read-only — O_CREAT asks get EROFS), fd_readdir,
 * poll_oneoff, sockets, signals. ENOSYS / ENOTSUP answers keep real
 * wasm32-wasi binaries from wedging on the missing calls.
 *
 * Blocking reads: `stdin.pull(max)` may return a Promise (JSPI — the
 * engine wraps the imports with WebAssembly.Suspending so the wasm stack
 * suspends until bytes arrive). A sync source never returns a thenable
 * and an empty pull means EOF — the batch semantics `runWasi()` uses.
 *
 * No DOM, no Worker, no Node imports: this module runs on any ES2022 host
 * with WebAssembly, which is what keeps the whole lane unit-testable in
 * plain Node and shippable as a lazy chunk later.
 */

/** wasi_snapshot_preview1 errno values (wasi/api.h, subset in use). */
export const ERRNO = Object.freeze({
  SUCCESS: 0,
  E2BIG: 1,
  EACCES: 2,
  EAGAIN: 6,
  EBADF: 8,
  EFAULT: 21,
  EINVAL: 28,
  EIO: 29,
  EISDIR: 31,
  ELOOP: 33,
  EMFILE: 34,
  ENFILE: 41,
  ENOENT: 44,
  ENOMEM: 48,
  ENOSPC: 51,
  ENOSYS: 52,
  ENOTDIR: 54,
  ENOTSUP: 58,
  EPERM: 63,
  ESPIPE: 70,
  EROFS: 69,
  ENOTCAPABLE: 76,
} as const);

/** Sentinel thrown by proc_exit; the engine catches it for the exit code. */
export class WasiExit {
  constructor(readonly code: number) {}
}

/** filetype field of fdstat/filestat (wasi). */
const FILETYPE = {
  UNKNOWN: 0,
  BLOCK: 1,
  CHAR_DEVICE: 2,
  DIRECTORY: 3,
  REGULAR_FILE: 4,
} as const;

/** fdstat rights bits granted (not enforced — informational for guests). */
const RIGHTS_READ = 0x0000_0000_0000_0006n; // fd_read | fd_seek
const RIGHTS_STD = RIGHTS_READ | 0x40n; // + fd_write

/** One preopen directory: a name and the snapshot it serves. */
export interface WasiPreopen {
  /** Guest-visible mount name, e.g. "/" or "/usr". */
  name: string;
  /** Normalized guest paths ("/a/b") → bytes. */
  files: Map<string, Uint8Array>;
}

/** Byte view of one stdio stream (the app owns what these do). */
export interface WasiStdio {
  stdout(bytes: Uint8Array): void;
  stderr(bytes: Uint8Array): void;
}

/**
 * stdin strategy. `pull(max)` returns bytes now, an empty array for EOF,
 * or (JSPI hosts only) a Promise of either — the suspended wasm resumes
 * when it settles.
 */
export interface WasiStdinSource {
  pull(max: number): Uint8Array | Promise<Uint8Array>;
}

/** Clock + entropy, injectable for tests. */
export interface WasiEnvironment {
  now(): { realtime: bigint; monotonic: bigint };
  random(bytes: Uint8Array): void;
}

interface FdEntry {
  kind: 'stdin' | 'stdout' | 'stderr' | 'preopen' | 'file';
  filetype: number;
  /** Open files: the bytes and the read cursor. */
  bytes?: Uint8Array;
  pos?: number;
  preopen?: WasiPreopen;
}

export interface WasiHostOptions {
  args?: string[];
  env?: Record<string, string>;
  preopens?: WasiPreopen[];
  stdio: WasiStdio;
  stdin: WasiStdinSource;
  environment?: WasiEnvironment;
}

/** Default clock: realtime from Date, monotonic from performance if present. */
function defaultNow(): { realtime: bigint; monotonic: bigint } {
  const realtime = BigInt(Date.now()) * 1_000_000n;
  const mono =
    typeof performance === 'object' && performance !== null && typeof performance.now === 'function'
      ? BigInt(Math.round(performance.now() * 1e6))
      : realtime;
  return { realtime, monotonic: mono };
}

/** Default entropy: crypto when present, Math.random bytes otherwise. */
function defaultRandom(bytes: Uint8Array): void {
  const c = (globalThis as { crypto?: { getRandomValues?(b: Uint8Array): Uint8Array } }).crypto;
  if (c !== undefined && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
    return;
  }
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
}

/**
 * Normalize a guest path inside a preopen. `..` CLAMPS at the preopen root
 * (POSIX behavior — "/../../x" is "/x"), so no path can address anything
 * outside the snapshot; the result is always a rooted "/a/b" form.
 */
function normalizeGuestPath(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      out.pop(); // at root this is a no-op — the sandbox floor
      continue;
    }
    out.push(part);
  }
  return '/' + out.join('/');
}

/**
 * The preview1 host. One instance serves one wasm instance; build it,
 * instantiate the guest with `imports`, run `_start`, catch `WasiExit`.
 */
export class WasiHost {
  readonly args: string[];
  readonly env: Array<[string, string]>;
  readonly #stdio: WasiStdio;
  readonly #stdin: WasiStdinSource;
  readonly #env: WasiEnvironment;
  readonly #fds = new Map<number, FdEntry>();
  #nextFd = 0;
  #mem: WebAssembly.Memory | null = null;

  constructor(opts: WasiHostOptions) {
    this.args = opts.args ?? [];
    this.env = Object.entries(opts.env ?? {});
    this.#stdio = opts.stdio;
    this.#stdin = opts.stdin;
    this.#env = opts.environment ?? { now: defaultNow, random: defaultRandom };
    this.#fds.set(0, { kind: 'stdin', filetype: FILETYPE.CHAR_DEVICE });
    this.#fds.set(1, { kind: 'stdout', filetype: FILETYPE.CHAR_DEVICE });
    this.#fds.set(2, { kind: 'stderr', filetype: FILETYPE.CHAR_DEVICE });
    for (const pre of opts.preopens ?? []) {
      this.#fds.set(this.#nextFreeFd(), { kind: 'preopen', filetype: FILETYPE.DIRECTORY, preopen: pre });
    }
  }

  /** The import object for WebAssembly instantiation. */
  get imports(): WebAssembly.Imports {
    return { wasi_snapshot_preview1: this.#functions() };
  }

  /** Bind module memory (called by the engine after instantiation). */
  bind(memory: WebAssembly.Memory): void {
    this.#mem = memory;
  }

  #view(): DataView {
    if (this.#mem === null) throw new Error('wasi: memory not bound');
    return new DataView(this.#mem.buffer);
  }

  #bytes(): Uint8Array {
    if (this.#mem === null) throw new Error('wasi: memory not bound');
    return new Uint8Array(this.#mem.buffer);
  }

  #nextFreeFd(): number {
    while (this.#fds.has(this.#nextFd)) this.#nextFd++;
    const fd = this.#nextFd;
    this.#nextFd++;
    return fd;
  }

  /* -- memory helpers --------------------------------------------------- */

  #readIovs(ptr: number, len: number): Array<[number, number]> {
    const view = this.#view();
    const iovs: Array<[number, number]> = [];
    for (let i = 0; i < len; i++) {
      const base = ptr + i * 8;
      iovs.push([view.getUint32(base, true), view.getUint32(base + 4, true)]);
    }
    return iovs;
  }

  #readCString(ptr: number, max = 4096): string {
    const bytes = this.#bytes();
    let end = ptr;
    const stop = Math.min(bytes.length, ptr + max);
    while (end < stop && bytes[end] !== 0) end++;
    return new TextDecoder().decode(bytes.subarray(ptr, end));
  }

  /* -- args / env -------------------------------------------------------- */

  #args_sizes_get(argcPtr: number, bufSizePtr: number): number {
    let size = 0;
    for (const a of this.args) size += utf8(a).length + 1;
    const view = this.#view();
    view.setUint32(argcPtr, this.args.length, true);
    view.setUint32(bufSizePtr, size, true);
    return ERRNO.SUCCESS;
  }

  #args_get(argvPtr: number, bufPtr: number): number {
    const view = this.#view();
    const bytes = this.#bytes();
    let cursor = bufPtr;
    for (let i = 0; i < this.args.length; i++) {
      const arg = this.args[i]!;
      view.setUint32(argvPtr + i * 4, cursor, true);
      const encoded = new TextEncoder().encode(arg);
      bytes.set(encoded, cursor);
      bytes[cursor + encoded.length] = 0;
      cursor += encoded.length + 1;
    }
    return ERRNO.SUCCESS;
  }

  #environ_sizes_get(countPtr: number, bufSizePtr: number): number {
    let size = 0;
    for (const [k, v] of this.env) size += utf8(`${k}=${v}`).length + 1;
    const view = this.#view();
    view.setUint32(countPtr, this.env.length, true);
    view.setUint32(bufSizePtr, size, true);
    return ERRNO.SUCCESS;
  }

  #environ_get(environPtr: number, bufPtr: number): number {
    const view = this.#view();
    const bytes = this.#bytes();
    let cursor = bufPtr;
    for (let i = 0; i < this.env.length; i++) {
      const entry = `${this.env[i]![0]}=${this.env[i]![1]}`;
      view.setUint32(environPtr + i * 4, cursor, true);
      const encoded = new TextEncoder().encode(entry);
      bytes.set(encoded, cursor);
      bytes[cursor + encoded.length] = 0;
      cursor += encoded.length + 1;
    }
    return ERRNO.SUCCESS;
  }

  /* -- stdio + fds -------------------------------------------------------- */

  #fd_write(fd: number, iovsPtr: number, iovsLen: number, nwrittenPtr: number): number {
    const entry = this.#fds.get(fd);
    if (entry === undefined) return ERRNO.EBADF;
    if (entry.kind !== 'stdout' && entry.kind !== 'stderr') return ERRNO.EBADF;
    let total = 0;
    const chunks: Uint8Array[] = [];
    for (const [ptr, len] of this.#readIovs(iovsPtr, iovsLen)) {
      if (len === 0) continue;
      chunks.push(this.#bytes().slice(ptr, ptr + len));
      total += len;
    }
    if (total > 0) (entry.kind === 'stdout' ? this.#stdio.stdout : this.#stdio.stderr)(concat(chunks, total));
    this.#view().setUint32(nwrittenPtr, total, true);
    return ERRNO.SUCCESS;
  }

  /**
   * Read into iovs. Sync paths return a plain errno; a stdin source that
   * returns a Promise yields a Promise (the JSPI engine's Suspending
   * wrapper suspends the guest until it settles — batch callers must pass
   * sync-only sources, per the WasiStdinSource contract).
   */
  #fd_read(fd: number, iovsPtr: number, iovsLen: number, nreadPtr: number): number | Promise<number> {
    const entry = this.#fds.get(fd);
    if (entry === undefined) return ERRNO.EBADF;
    const iovs = this.#readIovs(iovsPtr, iovsLen);
    if (iovs.length === 0) {
      this.#view().setUint32(nreadPtr, 0, true);
      return ERRNO.SUCCESS;
    }
    if (entry.kind === 'stdin') {
      const want = iovs.reduce((n, [, len]) => n + len, 0);
      const got = this.#stdin.pull(Math.max(1, want));
      if (isThenable(got)) {
        return got.then((bytes) => {
          const written = scatter(this.#bytes(), bytes, iovs);
          this.#view().setUint32(nreadPtr, written, true);
          return ERRNO.SUCCESS;
        });
      }
      const written = scatter(this.#bytes(), got, iovs);
      this.#view().setUint32(nreadPtr, written, true);
      return ERRNO.SUCCESS;
    }
    if (entry.kind === 'file' && entry.bytes !== undefined) {
      const bytes = entry.bytes;
      const pos = entry.pos ?? 0;
      const written = scatterAt(this.#bytes(), bytes, pos, iovs);
      entry.pos = pos + written;
      this.#view().setUint32(nreadPtr, written, true);
      return ERRNO.SUCCESS;
    }
    return ERRNO.EBADF; // dirs and the rest do not read
  }

  #fd_close(fd: number): number {
    const entry = this.#fds.get(fd);
    if (entry === undefined) return ERRNO.EBADF;
    if (fd <= 2) return ERRNO.SUCCESS; // closing stdio is a no-op for the guest
    this.#fds.delete(fd);
    return ERRNO.SUCCESS;
  }

  #fd_seek(fd: number, offset: number, whence: number, newOffsetPtr: number): number {
    const entry = this.#fds.get(fd);
    if (entry === undefined) return ERRNO.EBADF;
    if (entry.kind !== 'file') return ERRNO.ESPIPE;
    const size = entry.bytes?.length ?? 0;
    const base = whence === 0 ? 0 : whence === 1 ? entry.pos ?? 0 : whence === 2 ? size : NaN;
    if (!Number.isFinite(base)) return ERRNO.EINVAL;
    const next = Math.max(0, Math.min(size, base + offset));
    entry.pos = next;
    this.#view().setBigUint64(newOffsetPtr, BigInt(next), true);
    return ERRNO.SUCCESS;
  }

  #fd_fdstat_get(fd: number, statPtr: number): number {
    const entry = this.#fds.get(fd);
    if (entry === undefined) return ERRNO.EBADF;
    const view = this.#view();
    view.setUint8(statPtr, entry.filetype);
    view.setUint16(statPtr + 2, 0, true); // fd_flags: append/nonblock unused
    view.setBigUint64(statPtr + 8, entry.kind === 'stderr' || entry.kind === 'stdout' ? RIGHTS_STD : RIGHTS_READ, true);
    view.setBigUint64(statPtr + 16, 0n, true);
    return ERRNO.SUCCESS;
  }

  #fd_filestat_get(fd: number, statPtr: number): number {
    const entry = this.#fds.get(fd);
    if (entry === undefined) return ERRNO.EBADF;
    this.#writeFilestat(statPtr, entry.filetype, entry.bytes?.length ?? 0);
    return ERRNO.SUCCESS;
  }

  #writeFilestat(ptr: number, filetype: number, size: number): void {
    const view = this.#view();
    view.setBigUint64(ptr, 1n, true); // dev
    view.setBigUint64(ptr + 8, 0n, true); // ino (PoC: no identity)
    view.setUint8(ptr + 16, filetype);
    view.setBigUint64(ptr + 24, 1n, true); // nlink
    view.setBigUint64(ptr + 32, BigInt(size), true);
    view.setBigUint64(ptr + 40, 0n, true); // atim
    view.setBigUint64(ptr + 48, 0n, true); // mtim
    view.setBigUint64(ptr + 56, 0n, true); // ctim
  }

  /* -- preopens + path_open ---------------------------------------------- */

  #fd_prestat_get(fd: number, prestatPtr: number): number {
    const entry = this.#fds.get(fd);
    if (entry === undefined) return ERRNO.EBADF;
    if (entry.kind !== 'preopen' || entry.preopen === undefined) return ERRNO.EINVAL; // not a preopen: EINVAL per spec errata (was EBADF)
    const view = this.#view();
    view.setUint8(prestatPtr, 0); // pr_type = dir
    view.setUint32(prestatPtr + 4, entry.preopen.name.length, true);
    return ERRNO.SUCCESS;
  }

  #fd_prestat_dir_name(fd: number, namePtr: number, nameLen: number): number {
    const entry = this.#fds.get(fd);
    if (entry === undefined) return ERRNO.EBADF;
    if (entry.kind !== 'preopen' || entry.preopen === undefined) return ERRNO.EINVAL;
    const name = entry.preopen.name;
    const take = Math.min(nameLen, name.length);
    this.#bytes().set(new TextEncoder().encode(name.slice(0, take)), namePtr);
    return ERRNO.SUCCESS;
  }

  #path_open(
    dirfd: number,
    _dirflags: number,
    pathPtr: number,
    pathLen: number,
    oflags: number,
    _rightsBase: bigint,
    _rightsInheriting: bigint,
    fdPtr: number,
  ): number {
    const dir = this.#fds.get(dirfd);
    if (dir === undefined) return ERRNO.EBADF;
    if (dir.kind !== 'preopen' || dir.preopen === undefined) return ERRNO.ENOTDIR;
    const raw = new TextDecoder().decode(this.#bytes().subarray(pathPtr, pathPtr + pathLen));
    const guest = normalizeGuestPath(raw); // clamps '..' at the preopen root
    if ((oflags & 1) !== 0 || (oflags & (1 << 1)) !== 0) return ERRNO.EROFS; // creat/trunc: snapshot is read-only
    const bytes = dir.preopen.files.get(guest);
    if (bytes === undefined) return ERRNO.ENOENT;
    const fd = this.#nextFreeFd();
    this.#fds.set(fd, { kind: 'file', filetype: FILETYPE.REGULAR_FILE, bytes, pos: 0 });
    this.#view().setUint32(fdPtr, fd, true);
    return ERRNO.SUCCESS;
  }

  #path_filestat_get(dirfd: number, _flags: number, pathPtr: number, pathLen: number, bufPtr: number): number {
    const dir = this.#fds.get(dirfd);
    if (dir === undefined) return ERRNO.EBADF;
    if (dir.kind !== 'preopen' || dir.preopen === undefined) return ERRNO.ENOTDIR;
    const raw = new TextDecoder().decode(this.#bytes().subarray(pathPtr, pathPtr + pathLen));
    const guest = normalizeGuestPath(raw); // clamps '..' at the preopen root
    if (guest === '/') {
      this.#writeFilestat(bufPtr, FILETYPE.DIRECTORY, 0);
      return ERRNO.SUCCESS;
    }
    const bytes = dir.preopen.files.get(guest);
    if (bytes === undefined) {
      for (const known of dir.preopen.files.keys()) {
        if (known.startsWith(guest + '/')) {
          this.#writeFilestat(bufPtr, FILETYPE.DIRECTORY, 0);
          return ERRNO.SUCCESS;
        }
      }
      return ERRNO.ENOENT;
    }
    this.#writeFilestat(bufPtr, FILETYPE.REGULAR_FILE, bytes.length);
    return ERRNO.SUCCESS;
  }

  /* -- clock / random / misc ---------------------------------------------- */

  #clock_time_get(_id: number, _precision: bigint, timePtr: number): number {
    const { realtime, monotonic } = this.#env.now();
    this.#view().setBigUint64(timePtr, _id === 1 ? monotonic : realtime, true);
    return ERRNO.SUCCESS;
  }

  #random_get(bufPtr: number, bufLen: number): number {
    const slice = this.#bytes().subarray(bufPtr, bufPtr + bufLen);
    this.#env.random(slice);
    return ERRNO.SUCCESS;
  }

  /* -- the import surface -------------------------------------------------- */

  #functions(): Record<string, (...args: never[]) => unknown> {
    const h = this;
    return {
      args_sizes_get: (p: number, q: number) => h.#args_sizes_get(p, q),
      args_get: (p: number, q: number) => h.#args_get(p, q),
      environ_sizes_get: (p: number, q: number) => h.#environ_sizes_get(p, q),
      environ_get: (p: number, q: number) => h.#environ_get(p, q),
      clock_time_get: (id: number, prec: bigint, out: number) => h.#clock_time_get(id, prec, out),
      fd_write: (fd: number, p: number, n: number, w: number) => h.#fd_write(fd, p, n, w),
      // async: resolves now for file/preopen reads, may await the stdin
      // source (JSPI suspends the guest for the duration).
      fd_read: (fd: number, p: number, n: number, w: number) => h.#fd_read(fd, p, n, w),
      fd_close: (fd: number) => h.#fd_close(fd),
      fd_seek: (fd: number, off: number, whence: number, out: number) => h.#fd_seek(fd, off, whence, out),
      fd_fdstat_get: (fd: number, out: number) => h.#fd_fdstat_get(fd, out),
      fd_filestat_get: (fd: number, out: number) => h.#fd_filestat_get(fd, out),
      fd_prestat_get: (fd: number, out: number) => h.#fd_prestat_get(fd, out),
      fd_prestat_dir_name: (fd: number, p: number, n: number) => h.#fd_prestat_dir_name(fd, p, n),
      path_open: (fd: number, dflags: number, p: number, n: number, oflags: number, rb: bigint, ri: bigint, out: number) =>
        h.#path_open(fd, dflags, p, n, oflags, rb, ri, out),
      path_filestat_get: (fd: number, flags: number, p: number, n: number, out: number) =>
        h.#path_filestat_get(fd, flags, p, n, out),
      random_get: (p: number, n: number) => h.#random_get(p, n),
      sched_yield: () => ERRNO.SUCCESS,
      // Everything else a wasi libc may probe at boot: answer, never wedge.
      fd_datasync: () => ERRNO.ENOTSUP,
      fd_sync: () => ERRNO.SUCCESS,
      fd_tell: () => ERRNO.ENOTSUP,
      fd_advise: () => ERRNO.SUCCESS,
      fd_allocate: () => ERRNO.ENOTSUP,
      fd_readdir: () => ERRNO.ENOTSUP,
      fd_renumber: () => ERRNO.ENOTSUP,
      fd_dup: () => ERRNO.ENOTSUP,
      poll_oneoff: () => ERRNO.ENOTSUP,
      proc_raise: () => ERRNO.ENOTSUP,
      path_create_directory: () => ERRNO.EROFS,
      path_remove_directory: () => ERRNO.EROFS,
      path_unlink_file: () => ERRNO.EROFS,
      path_rename: () => ERRNO.EROFS,
      path_link: () => ERRNO.EROFS,
      path_symlink: () => ERRNO.ENOTSUP,
      path_readlink: () => ERRNO.ENOENT,
      sock_send: () => ERRNO.ENOTSUP,
      sock_recv: () => ERRNO.ENOTSUP,
      sock_shutdown: () => ERRNO.ENOTSUP,
      proc_exit: (code: number) => {
        throw new WasiExit(code);
      },
    };
  }
}

/* ------------------------------------------------------------------ *
 * byte helpers
 * ------------------------------------------------------------------ */

function isThenable(value: unknown): value is Promise<Uint8Array> {
  return typeof (value as { then?: unknown } | null)?.then === 'function';
}

const utf8Encoder = new TextEncoder();
function utf8(text: string): Uint8Array {
  return utf8Encoder.encode(text);
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** Scatter `src` across iovs; returns bytes written. */
function scatter(dst: Uint8Array, src: Uint8Array, iovs: Array<[number, number]>): number {
  let at = 0;
  for (const [ptr, len] of iovs) {
    if (at >= src.length) break;
    const take = Math.min(len, src.length - at);
    dst.set(src.subarray(at, at + take), ptr);
    at += take;
  }
  return at;
}

/** Scatter from an open-file cursor across iovs (file read path). */
function scatterAt(dst: Uint8Array, src: Uint8Array, pos: number, iovs: Array<[number, number]>): number {
  let at = pos;
  for (const [ptr, len] of iovs) {
    if (at >= src.length) break;
    const take = Math.min(len, src.length - at);
    dst.set(src.subarray(at, at + take), ptr);
    at += take;
  }
  return at - pos;
}
