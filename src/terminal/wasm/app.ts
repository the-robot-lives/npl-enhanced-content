/**
 * wasm/app — `wasm <module>` as a full-screen TerminalApp (CORE-V2 §6).
 *
 * The console contract, deliberately small: a header line, the module's
 * stdout as a growing transcript, and one input row. Typed lines are
 * queued as guest stdin; Ctrl+D closes stdin (EOF); Ctrl+C kills the run
 * (exit 130). When the module exits the header reports `exit N` and any
 * of Enter / Ctrl+D / Ctrl+C leaves the app with that code.
 *
 * Keyboard parity: everything is reachable without a pointer (there is no
 * pointer surface at all); prefers-reduced-motion needs nothing special —
 * the app never animates, repaint is damage-driven. The a11y summary is
 * the DOM-mirror surface (§9): one compact line describing state.
 *
 * The run itself is placed by startWasiJob (worker-first, in-thread
 * fallback) — this file owns presentation only.
 */

import type { App, AppContext, KeyEvent } from '../screen/types.js';
import type { WasiPreopen } from './wasi.js';
import { startWasiJob, type WasiJob } from './runner.js';

const HEADER = '\u001b[36m'; // cyan
const DIM = '\u001b[2m';
const RESET = '\u001b[0m';
const PROMPT = HEADER + '›' + RESET + ' ';

export class WasmRunApp implements App {
  readonly id = 'wasm';

  readonly #name: string;
  readonly #bytes: Uint8Array;
  readonly #args: string[];
  readonly #preopens: WasiPreopen[];
  #api: AppContext | null = null;
  #job: WasiJob | null = null;
  #lines: string[] = [];
  #carry = '';
  #input = '';
  #code: number | null = null;
  #crash: string | null = null;
  #status = 'starting';

  constructor(name: string, bytes: Uint8Array, args: string[], preopens: WasiPreopen[]) {
    this.#name = name;
    this.#bytes = bytes;
    this.#args = args;
    this.#preopens = preopens;
  }

  start(api: AppContext): void {
    this.#api = api;
    api.setTitle(`wasm ${this.#name}`);
    api.setStatus(`wasm: ${this.#name} — running`, 'busy');
    this.#paint();
    this.#job = startWasiJob(
      this.#bytes,
      { args: this.#args, preopens: this.#preopens },
      {
        stdout: (bytes) => this.#ingest(new TextDecoder().decode(bytes), false),
        stderr: (bytes) => this.#ingest(new TextDecoder().decode(bytes), true),
        status: (text) => {
          this.#status = text;
          this.#paint();
        },
        done: (result) => {
          this.#code = result.code;
          this.#crash = result.crash;
          api.setStatus(
            result.crash === null ? `wasm: ${this.#name} — exit ${result.code}` : `wasm: ${this.#name} — crashed`,
            result.crash === null && result.code === 0 ? 'idle' : 'alert',
          );
          this.#paint();
        },
      },
    );
    this.#paint();
  }

  key(ev: KeyEvent): void {
    if (ev.ctrl && ev.key === 'c') {
      this.#job?.kill();
      this.#api?.exit(130);
      return;
    }
    if (this.#code !== null) {
      // Finished: Enter / Ctrl+D leave with the module's code.
      if (ev.key === 'Enter' || (ev.ctrl && ev.key === 'd')) this.#api?.exit(this.#code ?? 0);
      return;
    }
    if (ev.ctrl && ev.key === 'd') {
      const line = this.#input;
      this.#input = '';
      if (line.length > 0) this.#send(line + '\n');
      this.#job?.eof();
      this.#paint();
      return;
    }
    if (ev.alt || ev.meta || ev.ctrl) return;
    if (ev.key === 'Enter') {
      this.#send(this.#input + '\n');
      this.#input = '';
      this.#paint();
      return;
    }
    if (ev.key === 'Backspace') {
      this.#input = this.#input.slice(0, -1);
      this.#paint();
      return;
    }
    if (ev.key.length === 1) {
      this.#input += ev.key;
      this.#paint();
    }
  }

  resize(_cols: number, _rows: number): void {
    this.#paint();
  }

  stop(): void {
    this.#job?.kill();
    this.#job = null;
  }

  a11ySummary(): string {
    if (this.#code !== null) {
      return `wasm ${this.#name}: finished, exit ${this.#code}${this.#crash === null ? '' : `, ${this.#crash}`}`;
    }
    return `wasm ${this.#name}: ${this.#lines.length} output lines, input line ready (${this.#status})`;
  }

  /* -- internals ---------------------------------------------------------- */

  #send(line: string): void {
    this.#job?.write(new TextEncoder().encode(line));
  }

  #ingest(text: string, isError: boolean): void {
    this.#carry += text;
    const parts = this.#carry.split('\n');
    this.#carry = parts.pop() ?? '';
    for (const part of parts) this.#lines.push(isError ? DIM + part + RESET : part);
    if (this.#lines.length > 5000) this.#lines.splice(0, this.#lines.length - 5000);
    this.#paint();
  }

  #paint(): void {
    const api = this.#api;
    if (api === null) return;
    const { screen, cols, rows } = api;
    screen.eraseDisplay(2);
    screen.moveTo(0, 0);
    const tail = this.#code !== null ? `exit ${this.#code}` : this.#status;
    screen.write(`${HEADER}wasm ${this.#name}${RESET}  ${DIM}${tail} · Ctrl+D eof · Ctrl+C kill${RESET}`);
    screen.moveTo(0, 1);
    screen.write(DIM + '─'.repeat(Math.max(0, cols - 1)) + RESET);
    const visible = rows - 4; // header, rule, input, one breathing row
    const shown = this.#lines.slice(Math.max(0, this.#lines.length - visible));
    for (let i = 0; i < shown.length; i++) {
      screen.moveTo(0, 2 + i);
      screen.write(shown[i]!.slice(0, cols - 1));
    }
    screen.moveTo(0, Math.max(2, rows - 2));
    if (this.#code !== null) {
      screen.write(`${DIM}finished — Enter to return${RESET}`);
    } else {
      screen.write(PROMPT + this.#input.slice(-(cols - 4)));
    }
    screen.moveTo(Math.min(cols - 1, 2 + this.#input.length), Math.max(2, rows - 2));
    screen.setCursorVisible(true);
  }
}
