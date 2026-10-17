/**
 * packages/wasm/stub — the always-loaded registration of the `wasm`
 * package (packages round, LANE=pkg-infra). See ../README.md and
 * ./index.ts (the chunk). Same shape as the hello stub: name, usage and a
 * short man page answer before the chunk loads; the real spec — tty app
 * included — takes over once semtext-pkg-wasm.js resolves.
 */

import { createLazyPackage, importPackageChunk, type LazyPackage } from '../lazy.js';
import type { PackageStub } from '../types.js';

const stub: PackageStub = {
  name: 'wasm',
  description: 'run WASI command modules (the WASM PoC, GO per WASM-POC.md §6)',
  commands: [
    {
      name: 'wasm',
      summary: 'run a WASI command module from the VFS',
      usage: 'wasm <module.wasm> [args...] — run a WASI command module (tty: interactive; piped: batch)',
      man: [
        'WASM(1)                   semtext-sh manual',
        '',
        'NAME',
        '     wasm — run a WASI command module (short page: the package body',
        '     has not loaded; `man wasm` prints the full page once it has).',
      ],
    },
  ],
};

/** The stub metadata, exported for tests (they build their own instances). */
export { stub };

export const wasmPackage: LazyPackage = createLazyPackage(stub, () => importPackageChunk('wasm'));

export default wasmPackage;
