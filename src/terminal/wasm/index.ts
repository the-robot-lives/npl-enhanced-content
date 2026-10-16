/**
 * wasm — the CORE-V2 Appendix-A spike behind the terminal app API.
 *
 *   engine.ts    batch + JSPI execution over the WASI shim
 *   wasi.ts      the wasi_snapshot_preview1 host (fd table, preopens)
 *   runner.ts    one program as a job, worker-first / in-thread
 *   worker-main  the worker side of that protocol
 *   app.ts       `wasm <module>` as a full-screen TerminalApp
 *   command.ts   the CommandSpec (tty: app; piped: batch run)
 *
 * NOT part of the shell bundle: src/js-shell.ts does not import this
 * barrel (or anything under wasm/) — registration is a tabs-ui request,
 * see docs/terminal/WASM-POC.md § productionization.
 */

export { jspiAvailable, runInteractive, runWasi, type WasiRunOptions, type WasiRunResult } from './engine.js';
export {
  ERRNO,
  WasiExit,
  type WasiEnvironment,
  type WasiHostOptions,
  type WasiPreopen,
  type WasiStdinSource,
  type WasiStdio,
} from './wasi.js';
export { startWasiJob, type WasiJob, type WasiJobEvents, type WasiJobOptions } from './runner.js';
export { WasmRunApp } from './app.js';
export { decodeModuleBytes, snapshotPreopen, wasmApp, wasmCommand } from './command.js';
