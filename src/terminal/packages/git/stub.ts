/**
 * packages/git/stub — the always-loaded registration of the git package
 * (packages round, LANE=pkg-git). See ../README.md for the contract and
 * ./index.ts for the chunk this stub loads.
 *
 * One command (`git`) with real subcommands; everything answerable before
 * the chunk arrives lives here: the name (registry/completion), the usage
 * line (`help`), and a short man page (`man git`). The chunk's full
 * manPages take over once semtext-pkg-git.js is resident (lazy.ts swaps
 * live). The loader is the production one — `importPackageChunk('git')`.
 */

import { createLazyPackage, importPackageChunk, type LazyPackage } from '../lazy.js';
import type { PackageStub } from '../types.js';

const stub: PackageStub = {
  name: 'git',
  description: 'git over the VFS — init/add/status/commit/log/diff/branch/checkout/show (pure-JS store)',
  commands: [
    {
      name: 'git',
      summary: 'the stupid content tracker, over the VFS',
      usage: 'git <command> [<args>] — init add status commit log diff branch checkout show config rev-parse',
      man: [
        'GIT(1)                    semtext-sh manual',
        '',
        'NAME',
        '     git — version control over the VFS (short page: the package',
        '     body has not loaded; the full page prints once it has).',
      ],
    },
  ],
};

/** The stub metadata, exported for tests (they build their own instances). */
export { stub as gitStub };

export const gitPackage: LazyPackage = createLazyPackage(stub, () => importPackageChunk('git'));

export default gitPackage;
