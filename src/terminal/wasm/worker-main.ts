/**
 * wasm/worker-main — the dedicated-worker side of startWasiJob.
 *
 * Protocol (mirrors runner.ts):
 *   ← run    {bytes, args, env, preopens}
 *   ← stdin  {bytes} | stdin-eof | kill
 *   → stdout {bytes} | stderr {bytes} | status {text} | done {result}
 *
 * Interactive when the engine reports JSPI (Chromium/modern V8 workers
 * have it): fd_read suspends until a stdin message arrives. Without JSPI
 * the run is batch — queued bytes, then EOF — and the status line says
 * so; guests finish what they can, exactly like the in-thread fallback.
 */

import { jspiAvailable, runInteractive, runWasi, type WasiRunResult } from './engine.js';
import type { WasiPreopen } from './wasi.js';

interface RunMessage {
  type: 'run';
  bytes: Uint8Array;
  args?: string[];
  env?: Record<string, string>;
  preopens?: WasiPreopen[];
}
type Inbound = RunMessage | { type: 'stdin'; bytes: Uint8Array } | { type: 'stdin-eof' } | { type: 'kill' };

const queue: Uint8Array[] = [];
let waiters: Array<(chunk: Uint8Array) => void> = [];
let eof = false;
let killed = false;

function pull(): Uint8Array | Promise<Uint8Array> {
  if (queue.length > 0) return queue.shift()!;
  if (eof || killed) return new Uint8Array(0);
  return new Promise((resolve) => waiters.push(resolve));
}

self.addEventListener('message', (ev: MessageEvent<Inbound>) => {
  const msg = ev.data;
  if (msg.type === 'stdin') {
    if (killed || msg.bytes.length === 0) return;
    queue.push(msg.bytes);
    while (queue.length > 0 && waiters.length > 0) waiters.shift()!(queue.shift()!);
    return;
  }
  if (msg.type === 'stdin-eof') {
    eof = true;
    for (const waiter of waiters.splice(0)) waiter(new Uint8Array(0));
    return;
  }
  if (msg.type === 'kill') {
    killed = true;
    queue.length = 0;
    for (const waiter of waiters.splice(0)) waiter(new Uint8Array(0));
    return;
  }
  // run
  const post = (m: unknown): void => (self as unknown as Worker).postMessage(m);
  const report = (result: WasiRunResult): void => post({ type: 'done', result });
  const options = {
    args: msg.args,
    env: msg.env,
    preopens: msg.preopens,
    stdio: {
      stdout: (bytes: Uint8Array) => post({ type: 'stdout', bytes }),
      stderr: (bytes: Uint8Array) => post({ type: 'stderr', bytes }),
    },
    stdin: { pull },
  };
  if (jspiAvailable()) {
    post({ type: 'status', text: 'worker' });
    void runInteractive(msg.bytes, options).then(report, (cause: unknown) => {
      report({ code: 1, crash: cause instanceof Error ? cause.message : String(cause), compileMs: 0, instantiateMs: 0, runMs: 0 });
    });
    return;
  }
  post({ type: 'status', text: 'batch (no JSPI: stdin closed)' });
  eof = true;
  for (const waiter of waiters.splice(0)) waiter(new Uint8Array(0));
  report(runWasi(msg.bytes, options));
});
