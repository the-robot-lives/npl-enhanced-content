/**
 * packages/archive/stub — the always-loaded registration of the archive
 * package (packages round, LANE=pkg-archive). See ../README.md for the
 * contract and ./index.ts for the chunk this stub loads.
 *
 * Everything the shell can answer before the chunk arrives lives here:
 * the command names (registry/completion), the usage lines (`help`), and
 * a short man page per command (`man <cmd>`). The chunk's full manPages
 * take over once semtext-pkg-archive.js is resident (lazy.ts swaps live).
 * The loader is the production one — `importPackageChunk('archive')` —
 * so the only difference from tests is the injected loader they pass to
 * createLazyPackage.
 */

import { createLazyPackage, importPackageChunk, type LazyPackage } from '../lazy.js';
import type { PackageStub } from '../types.js';

const stub: PackageStub = {
  name: 'archive',
  description: 'binary tools — base64, the *sum digests, gzip/gunzip/zcat, tar, zip/unzip',
  commands: [
    {
      name: 'base64', summary: 'encode/decode base64',
      usage: 'base64 [-d] [-w COLS] [-i] [file...]',
      man: [
        'BASE64(1)                 semtext-sh manual',
        '',
        'NAME',
        '     base64 — encode/decode base64 (short page; the full one prints',
        '     once the package body has loaded).',
      ],
    },
    {
      name: 'md5sum', summary: 'MD5 digests + check mode',
      usage: "md5sum [-b | -t] [--tag] [file...] · md5sum -c FILE",
      man: [
        'MD5SUM(1)                 semtext-sh manual',
        '',
        'NAME',
        '     md5sum — MD5 digests and -c verification (short page until the',
        '     body loads).',
      ],
    },
    {
      name: 'sha1sum', summary: 'SHA-1 digests + check mode',
      usage: "sha1sum [-b | -t] [--tag] [file...] · sha1sum -c FILE",
      man: [
        'SHA1SUM(1)                semtext-sh manual',
        '',
        'NAME',
        '     sha1sum — SHA-1 digests and -c verification (short page until',
        '     the body loads).',
      ],
    },
    {
      name: 'sha256sum', summary: 'SHA-256 digests + check mode',
      usage: "sha256sum [-b | -t] [--tag] [file...] · sha256sum -c FILE",
      man: [
        'SHA256SUM(1)              semtext-sh manual',
        '',
        'NAME',
        '     sha256sum — SHA-256 digests and -c verification (short page',
        '     until the body loads).',
      ],
    },
    {
      name: 'sha512sum', summary: 'SHA-512 digests + check mode',
      usage: "sha512sum [-b | -t] [--tag] [file...] · sha512sum -c FILE",
      man: [
        'SHA512SUM(1)              semtext-sh manual',
        '',
        'NAME',
        '     sha512sum — SHA-512 digests and -c verification (short page',
        '     until the body loads).',
      ],
    },
    {
      name: 'gzip', summary: 'compress in the gzip format',
      usage: 'gzip [-cdfktv] [-1..-9] [file...]',
      man: [
        'GZIP(1)                   semtext-sh manual',
        '',
        'NAME',
        '     gzip — gzip-compress files or stdin (short page until the body',
        '     loads).',
      ],
    },
    {
      name: 'gunzip', summary: 'decompress gzip files',
      usage: 'gunzip [-cfkv] [file...]',
      man: [
        'GUNZIP(1)                 semtext-sh manual',
        '',
        'NAME',
        '     gunzip — decompress gzip files or stdin (short page until the',
        '     body loads).',
      ],
    },
    {
      name: 'zcat', summary: 'decompress gzip to stdout',
      usage: 'zcat [file...]',
      man: [
        'ZCAT(1)                   semtext-sh manual',
        '',
        'NAME',
        '     zcat — cat through the gzip decompressor (short page until the',
        '     body loads).',
      ],
    },
    {
      name: 'tar', summary: 'create/list/extract ustar archives',
      usage: 'tar (-c | -x | -t) [-f ARCHIVE] [-v] [-z] [-C DIR] [PATH...]',
      man: [
        'TAR(1)                    semtext-sh manual',
        '',
        'NAME',
        '     tar — ustar create/list/extract, -z for gzip (short page until',
        '     the body loads).',
      ],
    },
    {
      name: 'zip', summary: 'create/update PKZIP archives',
      usage: 'zip [-r] [-q] [-0] ARCHIVE PATH...',
      man: [
        'ZIP(1)                    semtext-sh manual',
        '',
        'NAME',
        '     zip — PKZIP create/update, store + deflate (short page until',
        '     the body loads).',
      ],
    },
    {
      name: 'unzip', summary: 'list/extract PKZIP archives',
      usage: 'unzip [-l] [-o | -n] [-q] [-d DIR] ARCHIVE [MEMBER...]',
      man: [
        'UNZIP(1)                  semtext-sh manual',
        '',
        'NAME',
        '     unzip — PKZIP list/extract with glob members (short page until',
        '     the body loads).',
      ],
    },
  ],
};

/** The stub metadata, exported for tests (they build their own instances). */
export { stub as archiveStub };

export const archivePackage: LazyPackage = createLazyPackage(stub, () => importPackageChunk('archive'));

export default archivePackage;
