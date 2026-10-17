/**
 * packages/jq/stub — the always-loaded registration of the jq package
 * (packages round, LANE=pkg-jq). See ../README.md for the contract and
 * ./index.ts for the chunk this stub loads.
 *
 * The shell answers `help jq` / `help json`, completion, and short
 * `man` pages from these bytes alone; the real lexer + parser + evaluator
 * (a few tens of KB) arrives as semtext-pkg-jq.js on boot.
 */

import { createLazyPackage, importPackageChunk, type LazyPackage } from '../lazy.js';
import type { PackageStub } from '../types.js';

const stub: PackageStub = {
  name: 'jq',
  description: 'jq — JSON filter and pretty-printer',
  commands: [
    {
      name: 'jq',
      summary: 'filter and transform JSON',
      usage: "jq [-rscn] [--arg name value] [--argjson name json] 'FILTER' [file ...]",
      man: [
        'JQ(1)                     semtext-sh manual',
        '',
        'NAME',
        '     jq — filter and transform JSON (short page: the package body',
        '     has not loaded; `jq --help` prints the full usage and the',
        '     supported language once it has).',
      ],
    },
    {
      name: 'json',
      summary: 'pretty-print and validate JSON',
      usage: 'json [-c] [-r] [file ...]',
      man: [
        'JSON(1)                   semtext-sh manual',
        '',
        'NAME',
        '     json — pretty-print and validate JSON (short page: the',
        '     package body has not loaded; `json --help` prints the full',
        '     usage once it has).',
      ],
    },
  ],
};

/** The stub metadata, exported for tests (they build their own instances). */
export { stub as jqStub };

export const jqPackage: LazyPackage = createLazyPackage(stub, () => importPackageChunk('jq'));

export default jqPackage;
