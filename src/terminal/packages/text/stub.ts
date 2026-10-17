/**
 * packages/text/stub — the always-loaded registration of the text package
 * (packages round, LANE=pkg-text). See ../README.md for the contract and
 * ./index.ts for the chunk this stub loads.
 *
 * Everything the shell can answer before the chunk arrives lives here: the
 * command names (registry/completion), the usage lines (`help`), and a
 * short man page per command (`man <cmd>`). The chunk's full manPages take
 * over once semtext-pkg-text.js is resident (lazy.ts swaps live). The
 * loader is the production one — `importPackageChunk('text')` — so the
 * only difference from tests is the injected loader they pass to
 * createLazyPackage.
 *
 * Package-supersedes-base: grep, wc, head and tail already exist as simpler
 * variants in the posix plugin. The registry rejects duplicate names and
 * mountPlugin fails atomically, so the SHELL-side resolution of "the
 * package replaces the simpler base command" is a cross-lane decision
 * (reported to the coordinator: a supersedes-aware mount for
 * packagesPlugin). Tests here register via `core.commands.set`, which is
 * what such a mount reduces to.
 */

import { createLazyPackage, importPackageChunk, type LazyPackage } from '../lazy.js';
import type { PackageStub } from '../types.js';

const stub: PackageStub = {
  name: 'text',
  description: 'GNU-style text tools — grep, sort, uniq, wc, head/tail, cut, tr, tee, xargs and friends',
  // grep/wc/head/tail exist as simpler posix commands — this package
  // replaces them on purpose (integration TODO #9: silences the four
  // [packages] mount warnings). Until the chunk is resident the superseded
  // base commands answer (manifest.ts fallback wrapper).
  supersedes: ['grep', 'wc', 'head', 'tail'],
  commands: [
    {
      name: 'grep', summary: 'print lines matching a pattern',
      usage: 'grep [-EFivnclLowx] [-A|-B|-C N] [--color[=when]] PATTERN [file...]',
      man: [
        'GREP(1)                   semtext-sh manual',
        '',
        'NAME',
        '     grep — print lines matching a pattern (short page; the full one',
        '     prints once the package body has loaded).',
      ],
    },
    {
      name: 'sort', summary: 'sort lines of text',
      usage: 'sort [-nruhV] [-k POS[,POS]] [-t C] [file...]',
      man: [
        'SORT(1)                   semtext-sh manual',
        '',
        'NAME',
        '     sort — sort lines of text (-n numeric, -r reverse, -u unique,',
        '     -k keys, -t separator; short page until the body loads).',
      ],
    },
    {
      name: 'uniq', summary: 'drop adjacent duplicate lines',
      usage: 'uniq [-cdui] [file...]',
      man: [
        'UNIQ(1)                   semtext-sh manual',
        '',
        'NAME',
        '     uniq — drop adjacent duplicate lines (-c counts, -d/-u filter,',
        '     -i ignore case; short page until the body loads).',
      ],
    },
    {
      name: 'wc', summary: 'count lines, words, chars, bytes',
      usage: 'wc [-l | -w | -c | -m] [file...]',
      man: [
        'WC(1)                     semtext-sh manual',
        '',
        'NAME',
        '     wc — count lines, words, characters and bytes (short page until',
        '     the body loads).',
      ],
    },
    {
      name: 'head', summary: 'print the first lines/bytes',
      usage: 'head [-n N | -N] [-c N] [file...]',
      man: [
        'HEAD(1)                   semtext-sh manual',
        '',
        'NAME',
        '     head — print the first lines or bytes of each file (short page',
        '     until the body loads).',
      ],
    },
    {
      name: 'tail', summary: 'print the last lines/bytes',
      usage: 'tail [-n N | -N | -n +N] [-c N] [-f] [file...]',
      man: [
        'TAIL(1)                   semtext-sh manual',
        '',
        'NAME',
        '     tail — print the last lines or bytes (-n +N starts at line N;',
        '     short page until the body loads).',
      ],
    },
    {
      name: 'cut', summary: 'select fields or characters per line',
      usage: 'cut (-d C -f LIST | -c LIST) [file...]',
      man: [
        'CUT(1)                    semtext-sh manual',
        '',
        'NAME',
        '     cut — select fields (-d/-f) or characters (-c) from each line',
        '     (short page until the body loads).',
      ],
    },
    {
      name: 'tr', summary: 'translate, squeeze, delete characters',
      usage: 'tr [-cds] SET1 [SET2]',
      man: [
        'TR(1)                     semtext-sh manual',
        '',
        'NAME',
        '     tr — translate, squeeze or delete characters from stdin (short',
        '     page until the body loads).',
      ],
    },
    {
      name: 'tee', summary: 'copy stdin to files and stdout',
      usage: 'tee [-a] [file...]',
      man: [
        'TEE(1)                    semtext-sh manual',
        '',
        'NAME',
        '     tee — copy stdin into files while passing it through (-a appends;',
        '     short page until the body loads).',
      ],
    },
    {
      name: 'xargs', summary: 'build command lines from stdin',
      usage: 'xargs [-0] [-n N] [-I STR] [-r] [CMD [ARG...]]',
      man: [
        'XARGS(1)                  semtext-sh manual',
        '',
        'NAME',
        '     xargs — build and run command lines from stdin items (short page',
        '     until the body loads).',
      ],
    },
    {
      name: 'nl', summary: 'number lines',
      usage: 'nl [-b a|t] [-w N] [-s SEP] [file...]',
      man: [
        'NL(1)                     semtext-sh manual',
        '',
        'NAME',
        '     nl — number lines (-b a|t style, -w width, -s separator; short',
        '     page until the body loads).',
      ],
    },
    {
      name: 'rev', summary: 'reverse each line',
      usage: 'rev [file...]',
      man: [
        'REV(1)                    semtext-sh manual',
        '',
        'NAME',
        '     rev — reverse the characters of each line (short page until the',
        '     body loads).',
      ],
    },
    {
      name: 'paste', summary: 'join files line-wise side by side',
      usage: 'paste [-d LIST] [-s] [file...]',
      man: [
        'PASTE(1)                  semtext-sh manual',
        '',
        'NAME',
        '     paste — join files line-wise (-s serial, -d delimiters; short',
        '     page until the body loads).',
      ],
    },
    {
      name: 'column', summary: 'align whitespace-separated columns',
      usage: 'column [-t] [file...]',
      man: [
        'COLUMN(1)                 semtext-sh manual',
        '',
        'NAME',
        '     column -t — align whitespace-separated input into columns (short',
        '     page until the body loads).',
      ],
    },
    {
      name: 'fold', summary: 'wrap long lines',
      usage: 'fold [-w N] [-s] [file...]',
      man: [
        'FOLD(1)                   semtext-sh manual',
        '',
        'NAME',
        '     fold — wrap each line at a width (-s breaks after blanks; short',
        '     page until the body loads).',
      ],
    },
    {
      name: 'expand', summary: 'expand tabs to spaces',
      usage: 'expand [-t N | -t LIST] [file...]',
      man: [
        'EXPAND(1)                 semtext-sh manual',
        '',
        'NAME',
        '     expand — expand tabs to spaces (-t sets the stops; short page',
        '     until the body loads).',
      ],
    },
  ],
};

/** The stub metadata, exported for tests and the chunk's usage lines. */
export { stub as textStub };

export const textPackage: LazyPackage = createLazyPackage(stub, () => importPackageChunk('text'));

export default textPackage;
