/**
 * packages/fs/stub — the always-loaded registration of the fs package
 * (packages round, LANE=pkg-fs). See ../README.md for the contract and
 * ./index.ts for the chunk this stub loads.
 *
 * Everything the shell can answer before the chunk arrives lives here: the
 * command names (registry/completion), the usage lines (`help`), and a
 * short man page per command (`man <cmd>`). The chunk's full manPages take
 * over once semtext-pkg-fs.js is resident (lazy.ts swaps live). The loader
 * is the production one — `importPackageChunk('fs')` — so the only
 * difference from tests is the injected loader they pass to
 * createLazyPackage.
 *
 * Base-overlap note: printf, touch, true, false and which already exist in
 * the posix plugin and are deliberately NOT here — the registry rejects
 * duplicate names and would fail the whole packages mount (the lane
 * brief's extend-instead-of-duplicate rule; extending base commands is a
 * cross-lane change to posix/commands.ts). The VFS also stores no
 * timestamps, so a `touch -d/-t` extension would have nothing to write to.
 */

import { createLazyPackage, importPackageChunk, type LazyPackage } from '../lazy.js';
import type { PackageStub } from '../types.js';

const stub: PackageStub = {
  name: 'fs',
  description: 'file-system utilities — mv, chmod, stat, tree, du/df, file, mktemp, date, cal, seq, yes, expr, test and friends',
  commands: [
    {
      name: 'mv', summary: 'move (rename) files',
      usage: 'mv [-fnv] SOURCE... DEST',
      man: [
        'MV(1)                     semtext-sh manual',
        '',
        'NAME',
        '     mv — move (rename) files (short page; the full one prints',
        '     once the package body has loaded).',
      ],
    },
    {
      name: 'ln', summary: 'create links (VFS supports none — reports)',
      usage: 'ln [-sf] TARGET... LINK',
      man: [
        'LN(1)                     semtext-sh manual',
        '',
        'NAME',
        '     ln — create links; this VFS has no symlink/hard-link nodes,',
        '     so ln validates operands then reports honestly (short page).',
      ],
    },
    {
      name: 'chmod', summary: 'change file mode bits (session-scoped)',
      usage: 'chmod [-R] OCTAL-MODE FILE...',
      man: [
        'CHMOD(1)                  semtext-sh manual',
        '',
        'NAME',
        '     chmod — octal modes only, kept in a session-scoped map the',
        '     VFS cannot persist (short page until the body loads).',
      ],
    },
    {
      name: 'stat', summary: 'display file status (size, kind, mode, backend)',
      usage: 'stat FILE...',
      man: [
        'STAT(1)                   semtext-sh manual',
        '',
        'NAME',
        '     stat — size, kind, access mode and the backend that would',
        '     persist the file; no timestamps exist (short page).',
      ],
    },
    {
      name: 'tree', summary: 'list directories recursively as a tree',
      usage: 'tree [-ad] [-L LEVEL] [DIR...]',
      man: [
        'TREE(1)                   semtext-sh manual',
        '',
        'NAME',
        '     tree — box-drawing recursion with a summary line (-a dot',
        '     files, -d dirs only, -L depth cap; short page).',
      ],
    },
    {
      name: 'du', summary: 'estimate file space usage (bytes)',
      usage: 'du [-ash] [FILE|DIR...]',
      man: [
        'DU(1)                     semtext-sh manual',
        '',
        'NAME',
        '     du — content-byte totals per directory (-s totals, -a files,',
        '     -h humanize; short page until the body loads).',
      ],
    },
    {
      name: 'df', summary: 'report mounted-backend usage',
      usage: 'df [-h] [PATH...]',
      man: [
        'DF(1)                     semtext-sh manual',
        '',
        'NAME',
        "     df — one line per mounted backend: Used bytes; Avail and",
        '     Capacity are unknown (-). (Short page until the body loads.)',
      ],
    },
    {
      name: 'file', summary: 'determine file type by content',
      usage: 'file [-b] [FILE...]   (- reads stdin)',
      man: [
        'FILE(1)                   semtext-sh manual',
        '',
        'NAME',
        '     file — magic sniffing: text, JSON, XML/HTML/SemText, PNG,',
        '     gzip, zip, tar, scripts (short page until the body loads).',
      ],
    },
    {
      name: 'realpath', summary: 'print resolved absolute paths',
      usage: 'realpath FILE...',
      man: [
        'REALPATH(1)               semtext-sh manual',
        '',
        'NAME',
        '     realpath — normalize against the cwd; every operand must',
        '     exist (short page until the body loads).',
      ],
    },
    {
      name: 'basename', summary: 'strip directory and suffix from a name',
      usage: 'basename [-a | -s SUFFIX] NAME [SUFFIX...]',
      man: [
        'BASENAME(1)               semtext-sh manual',
        '',
        'NAME',
        '     basename — the final path segment, minus an optional',
        '     suffix (-a many names; short page until the body loads).',
      ],
    },
    {
      name: 'dirname', summary: 'strip the last segment from each name',
      usage: 'dirname NAME...',
      man: [
        'DIRNAME(1)                semtext-sh manual',
        '',
        'NAME',
        "     dirname — 'a/b' -> 'a', 'x' -> '.', trailing slashes off",
        '     (short page until the body loads).',
      ],
    },
    {
      name: 'mktemp', summary: 'create a unique temp file or directory',
      usage: 'mktemp [-d] [-p DIR] [TEMPLATE]',
      man: [
        'MKTEMP(1)                 semtext-sh manual',
        '',
        'NAME',
        "     mktemp — unique name from a template's X-run (default",
        '     tmp.XXXXXXXXXX under /tmp; -d for a dir; short page).',
      ],
    },
    {
      name: 'readlink', summary: 'resolve links (VFS has none — reports)',
      usage: 'readlink [-f] FILE...',
      man: [
        'READLINK(1)               semtext-sh manual',
        '',
        'NAME',
        "     readlink — 'not a symbolic link' for everything (no symlink",
        '     nodes exist); -f canonicalizes like realpath (short page).',
      ],
    },
    {
      name: 'type', summary: 'how the shell resolves a command word',
      usage: 'type [-a] NAME...',
      man: [
        'TYPE(1)                   semtext-sh manual',
        '',
        'NAME',
        '     type — alias and/or registered command per name, or',
        "     'not found' (exit 1); complements which (short page).",
      ],
    },
    {
      name: 'date', summary: 'print or format the date and time',
      usage: "date [-u] [-d DATE] [+FORMAT]",
      man: [
        'DATE(1)                   semtext-sh manual',
        '',
        'NAME',
        '     date — GNU-style output, a strftime-subset +FORMAT, -u for',
        '     UTC and -d for fixed dates (short page until the body loads).',
      ],
    },
    {
      name: 'cal', summary: 'print a calendar',
      usage: 'cal [[MONTH] YEAR]   (cal YEAR — full sheet)',
      man: [
        'CAL(1)                    semtext-sh manual',
        '',
        'NAME',
        '     cal — Sunday-first month grid; month by number or name,',
        '     or a full-year sheet (short page until the body loads).',
      ],
    },
    {
      name: 'sleep', summary: 'validate a duration (returns at once)',
      usage: 'sleep SECONDS[s|m|h|d]...',
      man: [
        'SLEEP(1)                  semtext-sh manual',
        '',
        'NAME',
        '     sleep — validates GNU-style durations but cannot block: the',
        '     command path is synchronous (short page until the body loads).',
      ],
    },
    {
      name: 'seq', summary: 'print a sequence of numbers',
      usage: 'seq [-w] [-f FMT] [-s SEP] [FIRST [INCR]] LAST',
      man: [
        'SEQ(1)                    semtext-sh manual',
        '',
        'NAME',
        '     seq — float sequences, -w pad, -s separator, -f printf',
        '     float form; 100000-line cap (short page until loaded).',
      ],
    },
    {
      name: 'yes', summary: 'repeat a string (bounded emission)',
      usage: 'yes [STRING]',
      man: [
        'YES(1)                    semtext-sh manual',
        '',
        'NAME',
        '     yes — repeats default y (or STRING) with a 1000-line cap:',
        '     the sync shell cannot stream forever (short page).',
      ],
    },
    {
      name: 'expr', summary: 'evaluate an expression',
      usage: 'expr EXPRESSION',
      man: [
        'EXPR(1)                   semtext-sh manual',
        '',
        'NAME',
        '     expr — arithmetic, comparisons, string ops and BRE :',
        '     matching with GNU precedence and exit codes (short page).',
      ],
    },
    {
      name: 'test', summary: 'evaluate a condition (exit status)',
      usage: 'test EXPRESSION',
      man: [
        'TEST(1)                   semtext-sh manual',
        '',
        'NAME',
        '     test — file/string/integer conditions, ! -a -o ( ); the `[`',
        '     spelling cannot be registered (short page until loaded).',
      ],
    },
  ],
};

/** The stub metadata, exported for tests and the chunk's usage lines. */
export { stub as fsStub };

export const fsPackage: LazyPackage = createLazyPackage(stub, () => importPackageChunk('fs'));

export default fsPackage;
