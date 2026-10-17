/**
 * packages/hello/stub — the always-loaded registration of the sample
 * package (packages round, LANE=pkg-infra). See ../README.md for the
 * contract and ./index.ts for the chunk this stub loads.
 *
 * Everything the shell can answer before the chunk arrives lives here:
 * the command name (registry/completion), the usage line (`help`), and a
 * short man page (`man hello`). The loader is the production one —
 * `importPackageChunk('hello')` dynamic-imports semtext-pkg-hello.js from
 * next to the built shell — so the only difference from tests is the
 * injected loader they pass to createLazyPackage.
 */

import { createLazyPackage, importPackageChunk, type LazyPackage } from '../lazy.js';
import type { PackageStub } from '../types.js';

const stub: PackageStub = {
  name: 'hello',
  description: 'the sample lazy package (the contract proof)',
  commands: [
    {
      name: 'hello',
      summary: 'print a greeting',
      usage: 'hello [name] — print a greeting',
      man: [
        'HELLO(1)                  semtext-sh manual',
        '',
        'NAME',
        '     hello — print a greeting (short page: the package body has not',
        '     loaded; `hello --help` prints the full usage once it has).',
      ],
    },
  ],
};

/** The stub metadata, exported for tests (they build their own instances). */
export { stub };

export const helloPackage: LazyPackage = createLazyPackage(stub, () => importPackageChunk('hello'));

export default helloPackage;
