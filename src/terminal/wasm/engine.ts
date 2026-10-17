/**
 * wasm/engine — turn wasm bytes + host options into a finished run.
 *
 * Two execution modes over ONE WasiHost implementation:
 *
 *   runWasi(bytes, opts)            synchronous batch: stdin is a plain
 *                                   queue (empty pull = EOF), the call
 *                                   returns when _start returns/throws.
 *                                   Works on every ES2022+WebAssembly
 *                                   host — Node unit tests, file:// pages,
 *                                   the piped `run()` path of the command.
 *
 *   runInteractive(bytes, opts)     JSPI (wasm stack switching): the stdin
 *                                   source may return a Promise and the
 *                                   guest suspends inside fd_read until it
 *                                   settles. Needs WebAssembly.Suspending /
 *                                   .promising (Chromium ≥137, modern V8);
 *                                   `jspiAvailable()` feature-detects, the
 *                                   caller falls back to batch + a status
 *                                   note. Same code path in a Worker and on
 *                                   the main thread — off-thread is an
 *                                   occupancy choice, not a correctness one.
 *
 * proc_exit unwinds as a thrown WasiExit from _start in both modes; any
 * other throw is reported as a crash with the module's _start_error-style
 * message. Timing numbers (compile / instantiate / run) ride on the result
 * for the WASM-POC measurements.
 */

import { WasiExit, WasiHost, type WasiPreopen, type WasiStdinSource, type WasiStdio, type WasiEnvironment } from './wasi.js';

export interface WasiRunOptions {
  args?: string[];
  env?: Record<string, string>;
  preopens?: WasiPreopen[];
  stdio: WasiStdio;
  stdin: WasiStdinSource;
  environment?: WasiEnvironment;
}

export interface WasiRunResult {
  code: number;
  /** Non-null when the guest threw something that was not proc_exit. */
  crash: string | null;
  compileMs: number;
  instantiateMs: number;
  /** _start duration; excludes compile + instantiate. */
  runMs: number;
}

/** WebAssembly JSPI (JS Promise Integration) feature detection. */
export function jspiAvailable(): boolean {
  const w = WebAssembly as unknown as {
    Suspending?: unknown;
    promising?: unknown;
  };
  return typeof w.Suspending === 'function' && typeof w.promising === 'function';
}

/* ------------------------------------------------------------------ *
 * shared instantiation
 * ------------------------------------------------------------------ */

interface Instantiated {
  host: WasiHost;
  start: () => unknown;
  timings: { compileMs: number; instantiateMs: number };
}

/** True when the module imports its linear memory instead of exporting one. */
function importsMemory(module: WebAssembly.Module): boolean {
  for (const imp of WebAssembly.Module.imports(module)) {
    if (imp.kind === 'memory') return true;
  }
  return false;
}

function assertCommandModule(module: WebAssembly.Module): void {
  const exports = WebAssembly.Module.exports(module);
  const start = exports.find((e) => e.name === '_start' && e.kind === 'function');
  if (start === undefined) {
    throw new Error('wasm: module exports no _start (not a WASI command module)');
  }
}

function instantiate(bytes: Uint8Array, opts: WasiRunOptions, suspendReads: boolean): Instantiated {
  const t0 = performanceNow();
  // Copy to a standalone ArrayBuffer (offset 0) — the TS BufferSource
  // contract, and isolated from any caller-side mutation besides.
  const module = new WebAssembly.Module(new Uint8Array(bytes));
  assertCommandModule(module);
  const t1 = performanceNow();
  const host = new WasiHost(opts);
  const imports = host.imports as Record<string, Record<string, unknown>>;
  if (suspendReads) {
    // Only fd_read may block; wrapping it alone keeps every other call
    // synchronous (sync returns still work through a Suspending wrapper).
    const Suspending = (WebAssembly as unknown as { Suspending: new (fn: unknown) => unknown }).Suspending;
    imports.wasi_snapshot_preview1!.fd_read = new Suspending(imports.wasi_snapshot_preview1!.fd_read);
  }
  const provide = { ...imports } as unknown as WebAssembly.Imports;
  if (importsMemory(module)) provide.env = { ...(provide.env ?? {}), memory: new WebAssembly.Memory({ initial: 1 }) };
  const instance = new WebAssembly.Instance(module, provide);
  const memory = instance.exports.memory;
  if (memory === undefined) throw new Error('wasm: module has no linear memory');
  host.bind(memory as WebAssembly.Memory);
  const t2 = performanceNow();
  return {
    host,
    start: instance.exports._start as () => unknown,
    timings: { compileMs: t1 - t0, instantiateMs: t2 - t1 },
  };
}

function performanceNow(): number {
  return typeof performance === 'object' && performance !== null && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/* ------------------------------------------------------------------ *
 * batch
 * ------------------------------------------------------------------ */

export function runWasi(bytes: Uint8Array, opts: WasiRunOptions): WasiRunResult {
  const { start, timings } = instantiate(bytes, opts, false);
  const t3 = performanceNow();
  let code = 0;
  let crash: string | null = null;
  try {
    start();
  } catch (error) {
    if (typeof process !== 'undefined' && (process.env as { WASM_DEBUG?: string }).WASM_DEBUG) {
      console.error('WASM-DEBUG batch crash:', error);
    }
    if (error instanceof WasiExit) code = error.code;
    else crash = error instanceof Error ? error.message : String(error);
  }
  return { code, crash, ...timings, runMs: performanceNow() - t3 };
}

/* ------------------------------------------------------------------ *
 * interactive (JSPI)
 * ------------------------------------------------------------------ */

export async function runInteractive(bytes: Uint8Array, opts: WasiRunOptions): Promise<WasiRunResult> {
  const { start, timings } = instantiate(bytes, opts, true);
  const promisingFn = (WebAssembly as unknown as { promising: (fn: () => unknown) => () => Promise<unknown> }).promising(
    start,
  );
  const t3 = performanceNow();
  let code = 0;
  let crash: string | null = null;
  try {
    await promisingFn();
  } catch (error) {
    if (typeof process !== 'undefined' && (process.env as { WASM_DEBUG?: string }).WASM_DEBUG) {
      console.error('WASM-DEBUG interactive crash:', error);
    }
    if (error instanceof WasiExit) code = error.code;
    else crash = error instanceof Error ? error.message : String(error);
  }
  return { code, crash, ...timings, runMs: performanceNow() - t3 };
}
