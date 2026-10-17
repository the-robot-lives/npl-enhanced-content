/**
 * packages/awk/stub — the always-loaded registration of the awk package
 * (packages round, LANE=pkg-awk). See ../README.md for the contract and
 * ./index.ts for the chunk this stub loads.
 *
 * The shell answers `help awk`, completion, and a short `man awk` from
 * these bytes alone; the real interpreter (lexer + parser + evaluator,
 * a few tens of KB) arrives as semtext-pkg-awk.js on boot.
 */

import { createLazyPackage, importPackageChunk, type LazyPackage } from '../lazy.js';
import type { PackageStub } from '../types.js';

const stub: PackageStub = {
  name: 'awk',
  description: 'POSIX awk — pattern scanning and processing language',
  commands: [
    {
      name: 'awk',
      summary: 'pattern scanning and processing language',
      usage: "awk [-F fs] [-v var=val] [-f progfile] ['program'] [file ...]",
      man: [
        'AWK(1)                    semtext-sh manual',
        '',
        'NAME',
        '     awk — pattern scanning and processing language (short page:',
        '     the package body has not loaded; `awk --help` prints the full',
        '     usage once it has).',
      ],
    },
  ],
};

/** The stub metadata, exported for tests (they build their own instances). */
export { stub };

export const awkPackage: LazyPackage = createLazyPackage(stub, () => importPackageChunk('awk'));

export default awkPackage;
