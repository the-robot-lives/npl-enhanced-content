# Command packages — the sem-shell lazy-package contract

Packages round (`LANE=pkg-infra` owns this directory, `scripts/build.mjs`
and this contract). A **package** is a group of shell commands shipped as
its own lazy chunk: the base shell bundle carries only the package's stub,
and every body byte loads on demand from a sibling chunk file. Seven lanes
build packages on this contract; register by appending to
`src/terminal/packages/manifest.ts` — never by touching plugin files.

## Layout

```
src/terminal/packages/<pkg>/
  stub.ts     always-loaded registration (rides in the base bundle)
  index.ts    the body — the chunk entry (never imported by the base bundle)
```

- `stub.ts` builds a `LazyPackage` via `createLazyPackage(stub, load)` and
  exports it; the stub metadata is `PackageStub` (`types.ts`): package name
  (= directory name, it names the chunk), plus per command `name`,
  `summary`, `usage` and an optional short `man` page.
- `index.ts` default-shape is `PackageModule`: `commands: CommandSpec[]`
  (the plugin Command shape — full behaviour, flags, errors) and optional
  `manPages` (full pages; they replace the stub's short ones once
  resident). Every stub name must be covered.
- Import rule for `index.ts`: only **types** from outside the package
  directory (`terminal-core`, `vfs`, …). Types erase at build; values
  would inline shell runtime into the chunk and double its size. The
  exception is an intentional re-export bridge (the `wasm` package
  re-exports its lane's `src/terminal/wasm/` barrel).

## Registering (the two-line rule)

Append, never reorder or edit existing lines:

```ts
import { textPackage } from './text/stub.js';   // 1. import, in the block
                                                // 2. entry, in PACKAGES:
const PACKAGES: LazyPackage[] = [/* … */ textPackage];
```

That is the whole registration: `mountPackages` (sem-shell.ts, called
after the base plugins) picks the commands up and the shell mounts them
per session core; `applyPackageMan` makes `man <cmd>` answer from your
package. Do NOT add commands to the posix plugin, do NOT touch
`sem-terminal.ts`/`terminal-core.ts`.

## Name clashes — `supersedes`

Packages mount AFTER the base plugins, so a name collision with an
existing command is possible (e.g. a richer `grep`). Mounts never fail on
a clash: declare the intentional replacements in the stub and they
replace the base command silently —

```ts
const stub: PackageStub = { name: 'text', supersedes: ['grep', 'wc', 'head', 'tail'], commands: [/* … */] };
```

An UNDECLARED collision still resolves last-wins (your package wins),
but emits a `[packages]` console warning naming the command — declare it
to silence the warning. `packagesPlugin` (the single-manifest view) is
kept for suites; the shell mounts per-package via `mountPackages`.

## Stub budget

Target **≤ 0.6 KB per package** in the built shell bundle — names, usage
lines and short man pages only. Behaviour, help prose and full man pages
belong in the chunk. The build table reports the shell size; report your
stub + chunk bytes from a private build:

```
node scripts/build.mjs --out /tmp/semtext-snap/pkg-<lane>/
```

Never build to `dist/` (shared) — private builds only. No `npm install`;
`node_modules` is already provisioned.

## Load semantics (what `createLazyPackage` gives you)

- **Boot-parallel preload.** The stub kicks
  `import(/* @vite-ignore */ new URL('semtext-pkg-<pkg>.js', import.meta.url).href)`
  at module-eval (shell boot). `execLine`/`run` are synchronous, so a
  load-on-first-use would deterministically fail the first pipeline stage
  — the same reasoning as the find/sed stub (and why bytes-lazy ≠
  fetch-lazy: chunks load in parallel, off the critical path).
- **Delegation is read-through.** Once the chunk resolves, `run`,
  `complete` and `app` delegate to the real specs; nothing mutates after
  registration. `app` claims the screen only when the code is resident
  (CORE-V2 §6.4); otherwise `run` reports.
- **A first invocation that beats the fetch** gets
  `<cmd>: chunk still loading — try again` (exit 1) — a hint, never a
  hang. A failed fetch gets
  `<cmd>: package chunk failed to load (semtext-pkg-<pkg>.js)`.
- **`--help` / `-h` before the chunk** is answered from the stub (usage
  line, exit 0). Once resident, the real command answers `--help` itself,
  so chunk-side help can be richer.
- **`man <cmd>`** prefers the chunk's page, falls back to the stub's short
  page, then to the base man ("No manual entry"). Works with the chunk
  absent entirely. Completion of command names is free (the registry lists
  the stub names); per-command flag completion arrives with the chunk.
- The chunk file name is a contract: `semtext-pkg-<pkg>.js`, emitted next
  to `semtext-js-shell.js` (the same no-fetch-outside-bundle-dir rule as
  the nano chunk). The build globs every `src/terminal/packages/*/index.ts`
  — a directory without `index.ts` is skipped, never fatal.

## Chunk format

Package chunks build as **ES modules** (not IIFE): a dynamic `import()`
needs real exports. Each chunk is self-contained (its own build). If the
package needs a worker (the `wasm` package does), reference it with
`new Worker(new URL('./worker-wasm.js', import.meta.url), { type: 'module' })`
from inside the chunk's module graph — the build emits it as its own file
next to the chunk.

## Testing (vitest)

The built chunk file does not exist in the source tree, so tests inject a
loader — the same seam `src/lazy/boot.ts` uses for its chunk importer:

```ts
const pkg = createLazyPackage(stub, () => import('./index.js')); // source body
await pkg.ensure();
```

Prove per package: help-without-load (never-resolving loader → `--help`
still answers), retry hint (run before load → one line, no hang), load
failure message, post-load delegation (output + completion + man page
swap), and the command body itself (happy path, flags, pipes, errors,
empty input, unicode, CRLF). End-to-end through a real build belongs in
the lane report: build privately, assert the chunk exists next to the
bundle, report bytes.
