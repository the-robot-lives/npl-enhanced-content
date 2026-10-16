/**
 * packages/types — the command-package contract (packages round, LANE=pkg-infra).
 *
 * A "package" is a group of shell commands that ships as its own lazy chunk:
 * the base bundle carries only the package's STUB (names, help, completion,
 * man) and every body byte loads on demand from a sibling
 * `semtext-pkg-<pkg>.js` chunk (scripts/build.mjs globs
 * `src/terminal/packages/<pkg>/index.ts`). See ./README.md for the full
 * contract, including how a lane registers.
 *
 * Two shapes meet here:
 *
 *   - `PackageStub`  — what `stub.ts` exports: the always-loaded
 *     registration (command names, summaries, usage lines, optional short
 *     man pages). Target ≤ 0.6 KB per package once minified.
 *   - `PackageModule` — what the chunk (`index.ts`) exports: the real
 *     `CommandSpec`s (the plugin Command shape) plus optional full man
 *     pages, which take over from the stub pages once the chunk is resident.
 */

import type { CommandSpec } from '../terminal-core.js';

/** The command shape plugins already use (alias kept for contract prose). */
export type Command = CommandSpec;

/** One command as registered by the stub — metadata only, no behaviour. */
export interface PackageCommandStub {
  /** The command word (validated by the core's NAME_PATTERN at mount). */
  name: string;
  /** One-line summary (help lists and docs cite it). */
  summary: string;
  /** Full usage line, shown by `help` — e.g. `hello [name] — greet`. */
  usage: string;
  /**
   * Short man page lines for `man <cmd>` answered from the stub — the
   * chunk's `manPages` (if any) replace these once resident. Keep it to a
   * handful of lines: the stub rides in the base bundle.
   */
  man?: string[];
}

/** What a package's `stub.ts` default-exports (via `createLazyPackage`). */
export interface PackageStub {
  /** Package id — must equal the directory name (it names the chunk). */
  name: string;
  /** Human-readable line for docs; not mounted as a command. */
  description?: string;
  commands: readonly PackageCommandStub[];
}

/** What a package's chunk (`index.ts`) exports. */
export interface PackageModule {
  /** The real command specs; must cover every name the stub registered. */
  commands: CommandSpec[];
  /** Full man pages; keyed by command name, override the stub's short ones. */
  manPages?: Record<string, string[]>;
}
