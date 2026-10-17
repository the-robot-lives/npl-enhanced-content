/**
 * wasm/command — `wasm <module.wasm> [args…]` (CommandSpec, CORE-V2 §6.4).
 *
 * On a tty the spec claims the screen (WasmRunApp); piped or redirected
 * stages keep `run()` — batch execution with the pipeline's stdin, output
 * through ctx.out/ctx.err, the module's exit code as the stage status.
 *
 * Module bytes reach the shim through the VFS, where file content is a
 * string: `.wasm` files carry a binary string (charCodeAt ≤ 0xff, the
 * same convention `vfs.write` preserves) and `.b64` files carry base64.
 * Both decode here, before any engine call — the shim only ever sees
 * real bytes.
 *
 * The preopen is a snapshot of the in-memory VFS tree at spawn time
 * (CORE-V2 Appendix A's "flat filesystem image"): read-only, no backend
 * hydration (mounted s3/local-storage content is not preopened — noted
 * as a PoC boundary in docs/terminal/WASM-POC.md).
 */

import type { CommandContext, CommandSpec } from '../terminal-core.js';
import type { Vfs } from '../vfs.js';
import { runWasi } from './engine.js';
import { WasmRunApp } from './app.js';
import type { WasiPreopen } from './wasi.js';

const USAGE = 'usage: wasm <module.wasm> [args...]';
const SNAPSHOT_FILE_CAP = 500;
const SNAPSHOT_BYTE_CAP = 2 * 1024 * 1024;

/** Decode VFS file content into module bytes; a string result is an error. */
export function decodeModuleBytes(path: string, content: string): Uint8Array | string {
  if (path.endsWith('.b64')) {
    try {
      const binary = atob(content.replace(/\s+/g, ''));
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
      return out;
    } catch {
      return 'wasm: invalid base64 in ' + path;
    }
  }
  const out = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) out[i] = content.charCodeAt(i) & 0xff;
  return out;
}

/** Snapshot the in-memory VFS tree as one read-only preopen. */
export function snapshotPreopen(vfs: Vfs, root = '/'): WasiPreopen {
  const files = new Map<string, Uint8Array>();
  let bytes = 0;
  const walk = (dir: string, depth: number): void => {
    if (depth > 6 || files.size >= SNAPSHOT_FILE_CAP || bytes >= SNAPSHOT_BYTE_CAP) return;
    for (const node of vfs.list(dir)) {
      const path = dir === '/' ? `/${node.name}` : `${dir}/${node.name}`;
      if (node.kind === 'dir') {
        walk(path, depth + 1);
        continue;
      }
      const content = vfs.read(path);
      if (content === null) continue;
      const encoded = new TextEncoder().encode(content);
      bytes += encoded.length;
      files.set(path, encoded);
      if (files.size >= SNAPSHOT_FILE_CAP || bytes >= SNAPSHOT_BYTE_CAP) return;
    }
  };
  walk(root === '/' ? '' : root, 0);
  return { name: '/', files };
}

/** The tty hook (§6.4): claim the screen when there is a module to run. */
export function wasmApp(ctx: CommandContext): WasmRunApp | null {
  const target = ctx.args[0];
  if (target === undefined) return null; // run() prints usage
  const path = ctx.vfs.resolve(ctx.state.cwd, target);
  const content = ctx.vfs.read(path);
  if (content === null) return null; // run() reports the missing file
  const bytes = decodeModuleBytes(path, content);
  if (bytes instanceof Uint8Array && bytes.length === 0) return null;
  if (typeof bytes === 'string') return null; // run() reports the decode error
  return new WasmRunApp(target, bytes, [target, ...ctx.args.slice(1)], [snapshotPreopen(ctx.vfs)]);
}

export const wasmCommand: CommandSpec = {
  name: 'wasm',
  usage: 'wasm <module.wasm> [args...] — run a WASI command module (tty: interactive; piped: batch)',
  app: wasmApp,
  run(ctx) {
    const target = ctx.args[0];
    if (target === undefined) {
      ctx.err(USAGE);
      ctx.exit(2);
      return;
    }
    const path = ctx.vfs.resolve(ctx.state.cwd, target);
    const content = ctx.vfs.read(path);
    if (content === null) {
      ctx.err(`wasm: no such module: ${target}`);
      ctx.exit(66);
      return;
    }
    const bytes = decodeModuleBytes(path, content);
    if (typeof bytes === 'string') {
      ctx.err(bytes);
      ctx.exit(65);
      return;
    }
    if (bytes.length === 0 || !(bytes[0] === 0x00 && bytes[1] === 0x61)) {
      ctx.err(`wasm: not a wasm module: ${target}`);
      ctx.exit(65);
      return;
    }
    const piped = ctx.stdin ?? '';
    let fed = false;
    const result = runWasi(bytes, {
      args: [target, ...ctx.args.slice(1)],
      preopens: [snapshotPreopen(ctx.vfs)],
      stdio: {
        stdout: (b) => {
          const text = new TextDecoder().decode(b);
          for (const line of text.split('\n')) if (line !== '') ctx.out(line);
        },
        stderr: (b) => {
          const text = new TextDecoder().decode(b);
          for (const line of text.split('\n')) if (line !== '') ctx.err(line);
        },
      },
      stdin: {
        pull: () => {
          if (fed) return new Uint8Array(0);
          fed = true;
          return new TextEncoder().encode(piped);
        },
      },
    });
    if (result.crash !== null) {
      ctx.err(`wasm: ${target}: ${result.crash}`);
      ctx.exit(1);
      return;
    }
    ctx.exit(result.code);
  },
};
