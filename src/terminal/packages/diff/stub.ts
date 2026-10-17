/**
 * packages/diff/stub — the always-loaded registration of the diff package
 * (packages round, LANE=pkg-diff). See ../README.md for the contract and
 * ./index.ts for the chunk this stub loads.
 *
 * The shell answers `help diff|patch|cmp`, completion and the short man
 * pages from these bytes alone; the real engines (Myers diff, the patch
 * parser/applier, cmp's byte comparator) arrive as semtext-pkg-diff.js on
 * boot.
 */

import { createLazyPackage, importPackageChunk, type LazyPackage } from '../lazy.js';
import type { PackageStub } from '../types.js';

const stub: PackageStub = {
  name: 'diff',
  description: 'GNU-style difference tools — diff, patch and cmp over the VFS',
  commands: [
    {
      name: 'diff',
      summary: 'compare files line by line',
      usage: 'diff [-ruqiswb] [-u|-c] [-U N] [--color[=WHEN]] FILE1 FILE2',
      man: [
        'DIFF(1)                   semtext-sh manual',
        '',
        'NAME',
        '     diff — compare files line by line (normal format by default;',
        '     -u unified, -c context, -r trees, -q brief; short page until',
        '     the package body loads).',
      ],
    },
    {
      name: 'patch',
      summary: 'apply a diff to a file',
      usage: 'patch [-p NUM] [-R] [-F N] [--dry-run] [<ORIGFILE [<PATCHFILE>]]',
      man: [
        'PATCH(1)                  semtext-sh manual',
        '',
        'NAME',
        '     patch — apply a diff to a file (unified and normal formats,',
        '     -p strip, -R reverse, --dry-run, .rej rejects; short page',
        '     until the package body loads).',
      ],
    },
    {
      name: 'cmp',
      summary: 'compare two files byte by byte',
      usage: 'cmp [-l | -s] FILE1 [FILE2]',
      man: [
        'CMP(1)                    semtext-sh manual',
        '',
        'NAME',
        '     cmp — compare two files byte by byte (-l lists every differing',
        '     byte, -s silent; short page until the package body loads).',
      ],
    },
  ],
};

/** The stub metadata, exported for tests (they build their own instances). */
export { stub as diffStub };

export const diffPackage: LazyPackage = createLazyPackage(stub, () => importPackageChunk('diff'));

export default diffPackage;
