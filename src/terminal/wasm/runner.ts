/**
 * wasm/runner — one wasm program as a job, worker-first.
 *
 * `startWasiJob` runs a WASI command module either in a dedicated Web
 * Worker (browsers: off the main thread, structuredClone carries the
 * bytes) or in-thread (Node unit tests, file:// pages, workers-disabled
 * environments) over the exact same engine calls. The caller speaks the
 * same WasiJob protocol in both cases — occupancy is a placement choice,
 * not a correctness one (CORE-V2 Appendix A constraint).
 *
 * Worker notes: the worker URL is `new URL('./worker-wasm.js', …)` so the
 * pair stays colocated under src/terminal/wasm/. vite only emits a worker
 * chunk when this module is in an entry graph — the shell bundle does not
 * import it (see docs/terminal/WASM-POC.md, productionization), so the
 * 256 KB budget is untouched. A worker that fails to construct (CSP,
 * file://) falls back in-thread; nothing about the protocol changes.
 */

import { jspiAvailable, runInteractive, runWasi, type WasiRunResult } from './engine.js';
import type { WasiPreopen } from './wasi.js';

export interface WasiJobOptions {
  args?: string[];
  env?: Record<string, string>;
  preopens?: WasiPreopen[];
}

export interface WasiJobEvents {
  stdout(bytes: Uint8Array): void;
  stderr(bytes: Uint8Array): void;
  /** Lifecycle notes for a status line ("running", "batch (no JSPI)", …). */
  status(text: string): void;
  done(result: WasiRunResult): void;
}

export interface WasiJob {
  /** Queue guest stdin (typically one typed line, '\n' included). */
  write(bytes: Uint8Array): void;
  /** Close guest stdin — fd_read reports EOF from the next pull on. */
  eof(): void;
  /** Terminate: pending reads trap, the run reports crash "wasm: killed". */
  kill(): void;
}

/** The in-thread stdin plumbing, shared by both placements. */
class StdinHub {
  #queue: Uint8Array[] = [];
  #waiters: Array<(chunk: Uint8Array) => void> = [];
  #eof = false;
  #killed = false;

  pull(): Uint8Array | Promise<Uint8Array> {
    if (this.#queue.length > 0) return this.#queue.shift()!;
    if (this.#eof || this.#killed) return new Uint8Array(0);
    return new Promise((resolve, reject) => {
      this.#waiters.push((chunk) => {
        if (this.#killed) reject(new Error('wasm: killed'));
        else resolve(chunk);
      });
    });
  }

  write(bytes: Uint8Array): void {
    if (this.#killed || bytes.length === 0) return;
    this.#queue.push(bytes);
    this.#drain();
  }

  eof(): void {
    this.#eof = true;
    for (const waiter of this.#waiters.splice(0)) waiter(new Uint8Array(0));
  }

  kill(): void {
    this.#killed = true;
    this.#queue = [];
    for (const waiter of this.#waiters.splice(0)) waiter(new Uint8Array(0));
  }

  #drain(): void {
    while (this.#queue.length > 0 && this.#waiters.length > 0) {
      this.#waiters.shift()!(this.#queue.shift()!);
    }
  }
}

/** Run in the current thread (tests, Node, worker-construction failures). */
function startInThread(bytes: Uint8Array, opts: WasiJobOptions, events: WasiJobEvents): WasiJob {
  const hub = new StdinHub();
  const interactive = jspiAvailable();
  if (!interactive) events.status('batch (no JSPI: stdin closes at start)');
  const settle = (result: WasiRunResult): void => events.done(result);
  const options = {
    args: opts.args,
    env: opts.env,
    preopens: opts.preopens,
    stdio: {
      stdout: events.stdout,
      stderr: events.stderr,
    },
    stdin: { pull: () => hub.pull() },
  };
  if (interactive) {
    void runInteractive(bytes, options).then(settle, (cause: unknown) => {
      if (typeof process !== 'undefined' && (process.env as { WASM_DEBUG?: string }).WASM_DEBUG) {
        console.error('WASM-DEBUG runner rejection:', cause);
      }
      settle({ code: 1, crash: cause instanceof Error ? cause.message : String(cause), compileMs: 0, instantiateMs: 0, runMs: 0 });
    });
  } else {
    // Batch mode: everything queued so far, then EOF. Typed input after
    // start cannot be delivered — the status line says so up front.
    hub.eof();
    settle(runWasi(bytes, options));
  }
  return { write: (b) => hub.write(b), eof: () => hub.eof(), kill: () => hub.kill() };
}

/** Run in a dedicated worker; fall back in-thread when workers are absent. */
export function startWasiJob(bytes: Uint8Array, opts: WasiJobOptions, events: WasiJobEvents): WasiJob {
  if (typeof Worker === 'undefined') return startInThread(bytes, opts, events);
  let worker: Worker;
  try {
    worker = new Worker(new URL('./worker-wasm.js', import.meta.url), { type: 'module' });
  } catch {
    return startInThread(bytes, opts, events);
  }
  events.status('worker');
  let target: WasiJob | null = null;
  let settled = false;
  const fallbackInThread = (why: string): void => {
    if (settled || target !== null) return;
    events.status(`worker unavailable (${why}) — in-thread`);
    target = startInThread(bytes, opts, {
      ...events,
      done: (result) => {
        settled = true;
        events.done(result);
      },
    });
  };
  worker.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data as
      | { type: 'stdout'; bytes: Uint8Array }
      | { type: 'stderr'; bytes: Uint8Array }
      | { type: 'status'; text: string }
      | { type: 'done'; result: WasiRunResult };
    if (msg.type === 'stdout') events.stdout(msg.bytes);
    else if (msg.type === 'stderr') events.stderr(msg.bytes);
    else if (msg.type === 'status') events.status(msg.text);
    else {
      settled = true;
      events.done(msg.result);
    }
  });
  worker.addEventListener('error', (ev: ErrorEvent) => {
    // A worker that never loaded (404 under a dev server, CSP, file://):
    // rerun in-thread rather than fail the job.
    fallbackInThread(ev.message || 'error');
  });
  worker.postMessage({ type: 'run', bytes, args: opts.args, env: opts.env, preopens: opts.preopens });
  return {
    write: (b) => {
      if (target !== null) target.write(b);
      else worker.postMessage({ type: 'stdin', bytes: b });
    },
    eof: () => {
      if (target !== null) target.eof();
      else worker.postMessage({ type: 'stdin-eof' });
    },
    kill: () => {
      if (target !== null) target.kill();
      else worker.terminate();
    },
  };
}
