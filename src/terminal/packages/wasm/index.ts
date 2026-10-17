/**
 * packages/wasm/index — the bridge that ships the WASM PoC as a command
 * package (packages round, LANE=pkg-infra; sources: src/terminal/wasm/,
 * the r3-wasm-poc lane's module, GO decision in WASM-POC.md §6).
 *
 * This file is the CHUNK (`semtext-pkg-wasm.js` once built): it re-exports
 * the PoC's `wasmCommand` under the PackageModule shape so the generic
 * loader (../lazy.ts) swaps it in exactly like any other package. The
 * re-export is the README's documented exception to the type-only import
 * rule — the wasm sources ARE the payload. The worker reference inside
 * runner.ts (`new Worker(new URL('./worker-wasm.js', import.meta.url))`)
 * is emitted by the build as its own file next to this chunk.
 *
 * The PoC §6 bridge sketch (Object.assign onto a spec in the posix
 * plugin) is superseded by this package: registration is the two
 * manifest.ts lines, no posix plugin edit, no shell-bundle bytes beyond
 * the stub.
 */

import type { Command, PackageModule } from '../types.js';
import { wasmCommand } from '../../wasm/command.js';

export const commands: Command[] = [wasmCommand];

export const manPages: Record<string, string[]> = {
  wasm: [
    'WASM(1)                   semtext-sh manual',
    '',
    'NAME',
    '     wasm — run a WASI command module (the CORE-V2 Appendix-A spike)',
    '',
    'SYNOPSIS',
    '     wasm <module.wasm> [args...]',
    '',
    'DESCRIPTION',
    '     Runs a WASI command module from the VFS. `.wasm` files carry a',
    '     binary string (charCodeAt <= 0xff, the vfs.write convention);',
    '     `.b64` files carry base64. On a terminal the module claims the',
    '     screen (WasmRunApp); piped or redirected it runs batch with the',
    '     pipeline feeding stdin. Execution is worker-first and falls back',
    '     in-thread where Workers are unavailable. The VFS snapshot given',
    '     to the module is read-only and capped (500 files / 2 MiB).',
    '     Module fixtures: poc/wasm/bin (hello, wcat, wargs, wtype).',
  ],
};

/** The chunk shape, for loader type checks and tests. */
export const pkg: PackageModule = { commands, manPages };
