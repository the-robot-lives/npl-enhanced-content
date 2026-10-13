/**
 * ansi/parser — the streaming ANSI/VT state machine (stage 1).
 *
 * `AnsiStateMachine.write(chunk)` tokenises a chunk of command output into
 * AnsiToken values: printable text runs, SGR snapshots, cursor/erase/other
 * CSI, OSC, and the few C0 controls renderers care about. Raw escape bytes
 * are never part of a text token — unknown, unsupported or unterminated
 * sequences are consumed into typed tokens (or dropped at `flush()`, where
 * they are counted in `droppedSequences`) so no renderer can ever print
 * them as noise.
 *
 * Streaming guarantees:
 *  - a sequence split across chunks parses exactly once, when its final
 *    byte arrives — byte-at-a-time feeding is token-identical to
 *    whole-string feeding (modulo text-run coalescing);
 *  - attribute state (SGR) persists across write/flush until `reset()`;
 *  - every text token carries the frozen SGR snapshot in force when its
 *    run was cut — consumers never read the machine's live state;
 *  - a write boundary ends the current text run (it is emitted with that
 *    chunk's tokens); only whole sequences are carried across writes, and
 *    they are parsed exactly once, when their final byte arrives;
 *  - OSC/DCS string bodies are capped, so a pathological unterminated
 *    sequence cannot grow memory without bound.
 *
 * Renderer-neutral by design: the DOM adapter (dom.ts) keeps only text +
 * SGR + the C0 controls it can express; the Epoch-2 canvas driver consumes
 * cursor/erase/mode tokens against the screen model.
 */

import { applySgr, splitCsiParams, type SgrParam } from './sgr.js';
import { DEFAULT_SGR, type AnsiToken, type SgrAttrs } from './types.js';

type Phase =
  | 'ground' // printable text / C0
  | 'esc' // after ESC
  | 'csi' // after ESC [ — parameters + intermediates
  | 'osc' // after ESC ] — string until BEL or ST
  | 'oscEsc' // after ESC inside OSC (expecting ST's `\`)
  | 'str' // after ESC P / X / ^ / _ — string until ST (BEL tolerated)
  | 'strEsc' // after ESC inside str (expecting ST's `\`)
  | 'charset'; // after ESC ( / ) — one designator byte

const STRING_CAP = 4096;

/** CSI finals that map to the `cursor` token (movement + save/restore). */
const CURSOR_FINALS: ReadonlySet<string> = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'd', 'f', 's', 'u']);

export class AnsiStateMachine {
  #phase: Phase = 'ground';
  #text = '';
  #csi = '';
  #csiPrefix = '';
  #csiIntermediates = false;
  #osc = '';
  #str = '';
  #sgr: SgrAttrs = DEFAULT_SGR;
  #dropped = 0;
  #out: AnsiToken[] = [];

  /** Attribute snapshot in force right now (frozen; held by reference). */
  get sgr(): SgrAttrs {
    return this.#sgr;
  }

  /** Sequences dropped incomplete at `flush()` (and malformed aborts) — a health metric, not an error. */
  get droppedSequences(): number {
    return this.#dropped;
  }

  /** Feed one chunk; returns every token completed by it. */
  write(chunk: string): AnsiToken[] {
    this.#out = [];
    for (let i = 0; i < chunk.length; i++) this.#step(chunk.charCodeAt(i), chunk[i]);
    this.#emitText(); // a chunk boundary ends the text run — consumers render per chunk
    return this.#out;
  }

  /**
   * End the stream: any half-received sequence is dropped (counted), any
   * pending text is emitted. Attribute state persists — `flush()` ends
   * sequences, it does not reset the terminal.
   */
  flush(): AnsiToken[] {
    this.#out = [];
    if (this.#phase !== 'ground') {
      this.#dropped++;
      this.#abort();
    }
    this.#emitText();
    return this.#out;
  }

  /** Back to a fresh terminal: attributes reset, buffers and pending text cleared. */
  reset(): void {
    this.#phase = 'ground';
    this.#text = '';
    this.#csi = '';
    this.#csiPrefix = '';
    this.#csiIntermediates = false;
    this.#osc = '';
    this.#str = '';
    this.#sgr = DEFAULT_SGR;
  }

  /* ------------------------------------------------------------------ */

  #step(code: number, ch: string): void {
    switch (this.#phase) {
      case 'ground':
        this.#groundStep(code, ch);
        return;
      case 'esc':
        this.#escStep(code);
        return;
      case 'csi':
        this.#csiStep(code);
        return;
      case 'osc':
      case 'str':
        this.#stringStep(code);
        return;
      case 'oscEsc':
      case 'strEsc':
        this.#stringEscapeStep(code);
        return;
      case 'charset':
        this.#phase = 'ground'; // the designator byte is consumed
        return;
    }
  }

  #groundStep(code: number, ch: string): void {
    if (code === 0x1b) {
      this.#phase = 'esc';
      return;
    }
    if (code === 0x0a) {
      this.#emitText();
      this.#out.push({ type: 'control', char: '\n' });
      return;
    }
    if (code === 0x0d) {
      this.#emitText();
      this.#out.push({ type: 'control', char: '\r' });
      return;
    }
    if (code === 0x08) {
      this.#emitText();
      this.#out.push({ type: 'control', char: '\b' });
      return;
    }
    if (code === 0x09) {
      this.#emitText();
      this.#out.push({ type: 'control', char: '\t' });
      return;
    }
    if ((code >= 0x20 && code < 0x7f) || code >= 0x80) {
      this.#text += ch; // printable ASCII + all non-ASCII (surrogates included) verbatim
      return;
    }
    this.#emitText(); // other C0 (BEL, NUL, SI…) and DEL: a run boundary, then dropped
  }

  #escStep(code: number): void {
    switch (code) {
      case 0x5b: // [ — CSI
        this.#phase = 'csi';
        this.#csi = '';
        this.#csiPrefix = '';
        this.#csiIntermediates = false;
        return;
      case 0x5d: // ] — OSC
        this.#phase = 'osc';
        this.#osc = '';
        return;
      case 0x50: // P — DCS
      case 0x58: // X — SOS
      case 0x5e: // ^ — PM
      case 0x5f: // _ — APC
        this.#phase = 'str';
        this.#str = '';
        return;
      case 0x28: // ( — charset designator (one byte)
      case 0x29: // )
        this.#phase = 'charset';
        return;
      case 0x37: // ESC 7 — save cursor
        this.#emitText();
        this.#out.push({ type: 'cursor', final: 's', params: [] });
        this.#phase = 'ground';
        return;
      case 0x38: // ESC 8 — restore cursor
        this.#emitText();
        this.#out.push({ type: 'cursor', final: 'u', params: [] });
        this.#phase = 'ground';
        return;
      case 0x1b: // ESC ESC — restart the escape
        return;
      default:
        this.#phase = 'ground'; // two-char escapes we don't model (RIS, IND, RI…) — consumed
    }
  }

  #csiStep(code: number): void {
    if (code >= 0x40 && code <= 0x7e) {
      this.#dispatchCsi(String.fromCharCode(code));
      return;
    }
    if (code >= 0x20 && code <= 0x2f) {
      this.#csiIntermediates = true; // non-standard CSI; still consumed at the final byte
      return;
    }
    if (code >= 0x30 && code <= 0x3b) {
      this.#csi += String.fromCharCode(code);
      return;
    }
    if (code >= 0x3c && code <= 0x3f) {
      // Private marker (< = > ?) — only valid leading the parameters.
      if (this.#csi === '' && this.#csiPrefix === '') this.#csiPrefix += String.fromCharCode(code);
      return;
    }
    if (code === 0x1b) {
      this.#dropped++; // the aborted CSI never completed
      this.#abort();
      this.#phase = 'esc'; // an ESC inside CSI restarts the escape
      return;
    }
    this.#dropped++; // any other C0 inside CSI aborts the (malformed) sequence
    this.#abort();
  }

  #dispatchCsi(final: string): void {
    const hadIntermediates = this.#csiIntermediates;
    const prefix = this.#csiPrefix;
    const groups = hadIntermediates ? null : splitCsiParams(this.#csi);
    this.#phase = 'ground';
    this.#csi = '';
    this.#csiPrefix = '';
    this.#csiIntermediates = false;
    this.#emitText();
    if (groups === null) {
      this.#out.push({ type: 'csi', final, params: [], prefix });
      return;
    }
    if (final === 'm') {
      this.#sgr = applySgr(this.#sgr, groups);
      this.#out.push({ type: 'sgr', attrs: this.#sgr });
      return;
    }
    if (final === 'J' || final === 'K') {
      const mode = groups[0]?.[0] ?? null;
      this.#out.push({ type: 'erase', final, mode: mode ?? 0 });
      return;
    }
    if (CURSOR_FINALS.has(final)) {
      const mapped = final === 'f' ? 'H' : final;
      const params = groups.map((g) => g[0] ?? null);
      this.#out.push({ type: 'cursor', final: mapped as 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'd' | 's' | 'u', params });
      return;
    }
    this.#out.push({ type: 'csi', final, params: groups.map((g) => g[0] ?? null), prefix });
  }

  #stringStep(code: number): void {
    if (code === 0x07) {
      // BEL terminates OSC (xterm convention) and is tolerated for DCS-family strings.
      if (this.#phase === 'osc') this.#dispatchOsc();
      else this.#endString();
      return;
    }
    if (code === 0x1b) {
      this.#phase = this.#phase === 'osc' ? 'oscEsc' : 'strEsc';
      return;
    }
    if (this.#phase === 'osc') {
      if (this.#osc.length < STRING_CAP) this.#osc += String.fromCharCode(code);
      return;
    }
    if (this.#str.length < STRING_CAP) this.#str += String.fromCharCode(code);
    // over the cap: keep consuming to the terminator, stop growing the buffer
  }

  #stringEscapeStep(code: number): void {
    if (code === 0x5c) {
      // ESC \ = ST, the canonical terminator.
      if (this.#phase === 'oscEsc') this.#dispatchOsc();
      else this.#endString();
      return;
    }
    this.#dropped++; // ESC + anything else inside a string aborts it (malformed)
    this.#abort();
  }

  /** OSC complete: split `code;data`, emit, back to ground. */
  #dispatchOsc(): void {
    const body = this.#osc;
    const semi = body.indexOf(';');
    const head = semi === -1 ? body : body.slice(0, semi);
    const code = /^\d+$/.test(head) ? Number(head) : -1;
    const data = semi === -1 ? '' : body.slice(semi + 1);
    this.#emitText();
    this.#out.push({ type: 'osc', code, data });
    this.#phase = 'ground';
    this.#osc = '';
  }

  #endString(): void {
    this.#phase = 'ground';
    this.#str = '';
  }

  /** Abandon whatever sequence was in flight (never emitted, never printed). */
  #abort(): void {
    this.#phase = 'ground';
    this.#csi = '';
    this.#csiPrefix = '';
    this.#csiIntermediates = false;
    this.#osc = '';
    this.#str = '';
  }

  #emitText(): void {
    if (this.#text === '') return;
    // The snapshot in force NOW — emitted before any new SGR applies.
    this.#out.push({ type: 'text', text: this.#text, attrs: this.#sgr });
    this.#text = '';
  }
}
