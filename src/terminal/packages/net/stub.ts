/**
 * packages/net/stub — the always-loaded registration of the net package
 * (packages round, LANE=pkg-net). See ../README.md for the contract and
 * ./index.ts for the chunk this stub loads.
 *
 * Everything the shell can answer before the chunk arrives lives here:
 * command names (registry/completion), usage lines (`help`), and a short
 * man page per command (`man <cmd>`). The chunk's full manPages take over
 * once semtext-pkg-net.js is resident (lazy.ts swaps live). The loader is
 * the production one — `importPackageChunk('net')`.
 */

import { createLazyPackage, importPackageChunk, type LazyPackage } from '../lazy.js';
import type { PackageStub } from '../types.js';

const stub: PackageStub = {
  name: 'net',
  description: 'network clients — curl, wget, http (httpie-style) over a synchronous transport',
  commands: [
    {
      name: 'curl',
      summary: 'transfer a URL (HTTP)',
      usage: 'curl [-sSifL] [-X M] [-H h] [-d d] [-u u:p] [-o f | -O] [-i | -I] [-w fmt] URL',
      man: [
        'CURL(1)                   semtext-sh manual',
        '',
        'NAME',
        '     curl — transfer a URL (short page; the full one prints once the',
        '     package body has loaded). Requests block until they complete.',
      ],
    },
    {
      name: 'wget',
      summary: 'download a URL to a VFS file',
      usage: 'wget [-q] [-O FILE | -O -] URL...',
      man: [
        'WGET(1)                   semtext-sh manual',
        '',
        'NAME',
        '     wget — download a URL into the VFS (short page until the body',
        '     loads). Server errors (4xx/5xx) exit 8 without saving.',
      ],
    },
    {
      name: 'http',
      summary: 'HTTPie-style requests with pretty output',
      usage: 'http [-vbh] [METHOD] URL [key:value | key=v | key:=v ...]',
      man: [
        'HTTP(1)                   semtext-sh manual',
        '',
        'NAME',
        '     http — HTTPie-style requests: JSON bodies from key=value items,',
        '     pretty status/headers/body output (short page until the body',
        '     loads).',
      ],
    },
  ],
};

/** The stub metadata, exported for tests and the chunk's usage lines. */
export { stub as netStub };

export const netPackage: LazyPackage = createLazyPackage(stub, () => importPackageChunk('net'));

export default netPackage;
