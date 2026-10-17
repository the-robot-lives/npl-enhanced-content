// Unit spec — the WASI preview1 shim + engines (CORE-V2 Appendix A,
// round-3 LANE=wasm-poc)
//
// Feature: real wasm guests over the shim
//   Scenario: hello.wasm writes to fd 1 and exits 0
//   Scenario: wcat.wasm echoes a piped stdin until EOF
//   Scenario: wargs.wasm prints argv, environ and the realtime clock
//   Scenario: wtype.wasm path_opens a preopen file and streams it
//   Scenario: wtype.wasm reports ENOENT-style failures with exit 1 / usage 2
//   Scenario: fd_write to a closed fd surfaces EBADF through proc_exit
// Feature: the committed fixtures are reproducible
//   Scenario: re-assembling poc/wasm/asm matches poc/wasm/bin byte-for-byte
// Feature: interactive execution (JSPI)
//   Scenario: fd_read suspends until a delayed Promise resolves
//   Scenario: a module without _start is refused with a readable error

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { jspiAvailable, runInteractive, runWasi } from '../../src/terminal/wasm/engine.js';
import { WasiExit, type WasiStdio, type WasiStdinSource } from '../../src/terminal/wasm/wasi.js';

const here = dirname(fileURLToPath(import.meta.url));
const binDir = resolve(here, '../../poc/wasm/bin');

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(resolve(binDir, `${name}.wasm`)));

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** Collecting stdio + a seeded (batch) stdin source. */
function batch(text: string): { stdio: WasiStdio; stdin: WasiStdinSource; out(): string; err(): string } {
  const chunks: Uint8Array[] = [];
  const errs: Uint8Array[] = [];
  let fed = false;
  return {
    stdio: {
      stdout: (b) => chunks.push(b),
      stderr: (b) => errs.push(b),
    },
    stdin: {
      pull: () => {
        if (fed) return new Uint8Array(0);
        fed = true;
        return encode(text);
      },
    },
    out: () => decode(concat(chunks)),
    err: () => decode(concat(errs)),
  };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * real guests
 * ------------------------------------------------------------------ */

describe('wasm shim — real fixtures through runWasi', () => {
  it('hello.wasm writes to fd 1 and exits 0', () => {
    const io = batch('');
    const result = runWasi(fixture('hello'), { args: ['hello'], ...io });
    expect(result.crash).toBeNull();
    expect(result.code).toBe(0);
    expect(io.out()).toBe('hello from wasm\n');
  });

  it('wcat.wasm echoes piped stdin until EOF', () => {
    const io = batch('first\nsecond line\n');
    const result = runWasi(fixture('wcat'), { args: ['wcat'], ...io });
    expect(result.crash).toBeNull();
    expect(result.code).toBe(0);
    expect(io.out()).toBe('first\nsecond line\n');
  });

  it('wcat.wasm on empty stdin produces no output and exits 0', () => {
    const io = batch('');
    const result = runWasi(fixture('wcat'), { args: ['wcat'], ...io });
    expect(result.code).toBe(0);
    expect(io.out()).toBe('');
  });

  it('wargs.wasm prints argv, environ and the clock (non-ASCII args round-trip)', () => {
    const io = batch('');
    const result = runWasi(fixture('wargs'), {
      args: ['wargs', 'αrg', 'two'],
      env: { HOME: '/home/w', WASM_POC: '1' },
      ...io,
    });
    expect(result.crash).toBeNull();
    expect(result.code).toBe(0);
    const lines = io.out().split('\n');
    expect(lines[0]).toBe('args:');
    expect(lines).toContain('wargs');
    expect(lines).toContain('αrg');
    expect(lines).toContain('two');
    expect(lines).toContain('env:');
    expect(lines).toContain('HOME=/home/w');
    expect(lines).toContain('WASM_POC=1');
    const clockLine = lines.find((l) => l.startsWith('clock_ms: '));
    expect(clockLine).toMatch(/^clock_ms: \d+$/);
    // Date.now-derived: sanity-bound, never exact.
    const ms = Number(clockLine!.slice('clock_ms: '.length));
    expect(ms).toBeGreaterThan(1_000_000_000_000 - 86_400_000);
  });

  it('wtype.wasm path_opens a preopen file and streams it', () => {
    const io = batch('');
    const result = runWasi(fixture('wtype'), {
      args: ['wtype', '/notes/welcome.txt'],
      preopens: [{ name: '/', files: new Map([['/notes/welcome.txt', encode('first\nsecond\n')]]) }],
      ...io,
    });
    expect(result.crash).toBeNull();
    expect(result.code).toBe(0);
    expect(io.out()).toBe('first\nsecond\n');
  });

  it('wtype.wasm cannot open a missing file: message + exit 1', () => {
    const io = batch('');
    const result = runWasi(fixture('wtype'), {
      args: ['wtype', '/nope.txt'],
      preopens: [{ name: '/', files: new Map() }],
      ...io,
    });
    expect(result.code).toBe(1);
    expect(io.out()).toBe("wtype: cannot open '/nope.txt'\n");
  });

  it('wtype.wasm with no operand prints usage and exits 2', () => {
    const io = batch('');
    const result = runWasi(fixture('wtype'), { args: ['wtype'], preopens: [{ name: '/', files: new Map() }], ...io });
    expect(result.code).toBe(2);
    expect(io.out()).toBe('usage: wtype FILE\n');
  });

  it('preopen traversal cannot escape the snapshot root', () => {
    const io = batch('');
    const result = runWasi(fixture('wtype'), {
      args: ['wtype', '/../../etc/passwd'],
      preopens: [{ name: '/', files: new Map([['/etc/passwd', encode('root:x:0:0\n')]]) }],
      ...io,
    });
    // '..' clamps at the preopen root: /../../etc/passwd resolves to /etc/passwd.
    expect(result.code).toBe(0);
    expect(io.out()).toBe('root:x:0:0\n');
  });
});

/* ------------------------------------------------------------------ *
 * fd error surfaces + module shape guards
 * ------------------------------------------------------------------ */

describe('wasm shim — error surfaces', () => {
  it('fd_write to a closed fd surfaces EBADF (8) through proc_exit', async () => {
    const { WasmModule, I, SIG, WASI } = await import('../../poc/wasm/asm/minias.mjs');
    const m = new WasmModule();
    const fdWrite = m.import(WASI, 'fd_write', ...SIG.iiii_i);
    const procExit = m.import(WASI, 'proc_exit', ...SIG.i_);
    m.memory(1);
    const start = m.func(
      [],
      [],
      [
        ...I.i32const(9), // not an fd
        ...I.i32const(8), // iovs (empty — EBADF is decided before any copy)
        ...I.i32const(0), // iovsLen 0
        ...I.i32const(24), // &nwritten
        ...I.call(fdWrite), // errno stays on the stack
        ...I.call(procExit),
        ...I.end(),
      ],
    );
    m.exportFunc('_start', start);
    m.exportMemory('memory');
    const io = batch('');
    const result = runWasi(m.build(), { args: ['probe'], ...io });
    expect(result.code).toBe(8); // ERRNO.EBADF
    expect(io.out()).toBe('');
  });

  it('a module without _start is refused with a readable error', async () => {
    const { WasmModule } = await import('../../poc/wasm/asm/minias.mjs');
    const m = new WasmModule();
    m.memory(1);
    m.exportMemory('memory');
    const bytes = m.build();
    expect(WebAssembly.validate(bytes)).toBe(true);
    const io = batch('');
    expect(() => runWasi(bytes, { args: [], ...io })).toThrow(/_start/);
  });

  it('proc_exit(3) reaches the result as code 3', async () => {
    const { WasmModule, I, SIG, WASI } = await import('../../poc/wasm/asm/minias.mjs');
    const m = new WasmModule();
    const procExit = m.import(WASI, 'proc_exit', ...SIG.i_);
    m.memory(1);
    const start = m.func([], [], [...I.i32const(3), ...I.call(procExit), ...I.end()]);
    m.exportFunc('_start', start);
    m.exportMemory('memory');
    const result = runWasi(m.build(), { args: [], ...batch('') });
    expect(result.code).toBe(3);
    expect(result.crash).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * fixture reproducibility
 * ------------------------------------------------------------------ */

describe('wasm fixtures are reproducible', () => {
  it.each(['hello', 'wcat', 'wargs', 'wtype'])('%s.wasm matches the assembler output byte-for-byte', async (name) => {
    const programs: Record<string, () => Uint8Array> = await import('../../poc/wasm/asm/programs.mjs').then(
      (m) => m.PROGRAMS,
    );
    expect(programs[name]!()).toEqual(fixture(name));
  });
});

/* ------------------------------------------------------------------ *
 * interactive (JSPI)
 * ------------------------------------------------------------------ */

describe.skipIf(!jspiAvailable())('wasm engine — interactive (JSPI stack switching)', () => {
  it('fd_read suspends until a delayed stdin Promise resolves, then echoes both chunks', async () => {
    const chunks: Uint8Array[] = [];
    let pulls = 0;
    const stdin: WasiStdinSource = {
      pull(max) {
        pulls++;
        if (pulls === 1) {
          return new Promise((resolve) => {
            setTimeout(() => resolve(encode('delayed chunk\n')), 15);
          });
        }
        if (pulls === 2) {
          return Promise.resolve(encode('immediate chunk\n'));
        }
        return new Uint8Array(0); // EOF
      },
    };
    const result = await runInteractive(fixture('wcat'), {
      args: ['wcat'],
      stdio: { stdout: (b) => chunks.push(b), stderr: () => {} },
      stdin,
    });
    expect(result.crash).toBeNull();
    expect(result.code).toBe(0);
    expect(decode(concat(chunks))).toBe('delayed chunk\nimmediate chunk\n');
    expect(pulls).toBe(3);
  });

  it('hello.wasm runs unchanged through the interactive engine', async () => {
    const io = batch('');
    const result = await runInteractive(fixture('hello'), { args: ['hello'], ...io });
    expect(result.code).toBe(0);
    expect(io.out()).toBe('hello from wasm\n');
  });
});

/* ------------------------------------------------------------------ *
 * WasiExit sentinel
 * ------------------------------------------------------------------ */

describe('WasiExit', () => {
  it('is a sentinel, not an Error', () => {
    const e = new WasiExit(7);
    expect(e).not.toBeInstanceOf(Error);
    expect(e.code).toBe(7);
  });
});
