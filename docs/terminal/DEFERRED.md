# sem-shell — deliberately deferred work

Status as of 2026-11-11. Everything here is **designed or half-wired but not
shipped**, on purpose. Each entry says what it is, why it waits, and what must
land first. Ordering across entries: shell grammar needs run-time expansion
first; async queue/cancel comes before any streaming or fuel work; the plugin
SDK waits on the async contract settling; VFS metadata precedes the
editor-shell bridge.

## 1. Shell grammar: `;` `&&` `||` `2>` `<` `VAR=x cmd`

What: today a line is `|` pipelines with `>`/`>>` redirects only
(`src/terminal/sh-parse.ts`, `parseCommandLine`). Command lists, conditional
chaining, stderr redirection, input redirection and per-command env
assignment are not parsed. Why deferred: `parseCommandLine` expands `$VAR`,
`$?`, `~` and globs at **parse time**, for the whole line, before any stage
runs (sh-parse.ts expansion in `expandDollar`, header comment lines 5-20;
called once from `terminal-core.ts:635`). `a && b` and `a; export X=1; echo
$X` are wrong under parse-time expansion — `$?` and `$X` must see the effect
of the earlier command. What must land first: move expansion from parse time
to **run time** (the parser returns unexpanded word structures; the core
expands each stage immediately before it runs, with the current `ShellState`
and VFS). Only then add the new operators, in this order: `;`, `&&`/`||`
(need run-time `$?`), `VAR=x cmd`, then `2>` and `<` (need per-stage stdin/
stderr plumbing).

## 2. Async queue, `AbortSignal` cancellation, Ctrl+C = 130, streaming

What: commands may already return a Promise (`terminal-core.ts:150-152`;
CORE-V2 §6.5), but there is no queue (the element just chains `outcome.then(...)`,
sem-terminal.ts:1283-1286 — nothing serializes lines), no cancel (an in-flight command cannot be
interrupted by the keyboard; only full-screen apps stop on Ctrl+C, status 130
— CORE-V2 §6.3), and output is buffered per stage, not streamed. Why
deferred: it needs a settled execution model — one line in flight per
session, a cancellation token the core hands every command
(`ctx.signal: AbortSignal`), and a defined interrupt path for non-app
commands. What must land first: the per-line execution state in the element
(`sem-terminal.ts#execLine`) must own a queue and an `AbortController`; the
shell-grammar run-time expansion (1) should land first so a cancelled `a &&
b` has defined semantics. Streaming (`ctx.out` flushing to the screen while
the stage runs, piped stdin as a stream rather than a string) follows
cancellation.

## 3. Public plugin SDK

What: a published, versioned surface for third-party plugin authors — a
types export (`CommandSpec`, `CommandContext`, `PluginManifest`, …),
`apiVersion` in the manifest with a compatibility check, `unmount` (today a
plugin cannot be removed once mounted; `mountPlugin` only adds,
terminal-core.ts:523), per-tab replay (a plugin mounted after tabs exist
must be applied to every session core, not only the active one), and
`ready`/`plugin-loaded` events so embedders can await mounting. Why
deferred: the contract (`src/terminal/PLUGINS.md`) is still moving — async
commands, `app`, `tab` actions and packages landed this round, and plugins
run with full page privilege, so freezing a public API now would freeze the
wrong thing. What must land first: the async/cancel contract (2) and the
manifest-loader hardening (resolve against `baseURI`, same-origin vs
cross-origin integrity policy) must be stable; then the types can be
published and an `apiVersion` stamped.

## 4. VFS metadata: mtime, mode, symlinks, byte content

What: the VFS (`src/terminal/vfs.ts`) stores string content in a tree of
files and directories only — no modification time, no mode bits, no
symlinks, and no binary (byte) content (`VfsStat` is `{kind, size}`, vfs.ts:45-48; `read`
returns `string | null`, vfs.ts:65). Commands that want these (`ls -l`
times, `stat`, `chmod`, `ln -s`, `cp -p`, tar/zip with real timestamps,
binary `wasm` modules without base64) fake or skip them. Why deferred:
every backend (local-storage JSON, S3) and every package that reads the
VFS depends on the node shape; changing it is a cross-cutting migration
with a persisted-format version bump (`semtext:shell:v1:` payloads). What
must land first: a `VfsNode` v2 shape with a storage-format version and
migration for local-storage; backends must declare which metadata they can
persist (S3 can carry mtime, not mode). Bytes (`Uint8Array`) content is the
first slice since it unblocks wasm and archive without base64.

## 5. Editor <-> shell VFS bridge

What: `<sem-editor>` and `<sem-shell>` each have their own storage; saving
a document in the editor does not create a file the shell can `cat`, and a
file the shell writes cannot be opened in the editor. Why deferred: the two
bundles are separate opt-in tools (`semtext-editor.js`,
`semtext-js-shell.js`) that must not import each other, and the VFS has no
change-notification surface. What must land first: VFS metadata (4) at
least for mtime/etag conflict detection, a small shared VFS interface
(types only) that both can depend on, and change events from the VFS so
the editor can refresh. Until then, share through an S3 or local-storage
mount used by both.

## 6. Wasm fuel / step budget

What: the `wasm` package (`src/terminal/packages/wasm/`, `src/terminal/wasm/`)
runs WASI guests with no execution limit — there is no instruction fuel, step
counter or wall-clock deadline. A guest in a busy loop can pin the worker
(or the page, when the worker is unavailable and the run falls back
in-thread, `wasm/runner.ts:119-134`); only `job.kill()` (Ctrl+C in the tty
app, `wasm/app.ts:82,122`) stops it, and a piped/batch run has no kill path.
Why deferred: WebAssembly has no native fuel metering; it needs either
instrumented modules (a rewrite pass) or a worker-termination watchdog, and
the watchdog needs the cancellation story from (2) so a batch run inside a
pipeline can be aborted. What must land first: `AbortSignal` plumbing (2);
then a per-job wall-clock deadline that terminates the worker (cheap, safe
for the worker placement), with true instruction fuel as a later option.

## 7. TAB_THEME

What: the direnv feed (`TAB_THEME` in `.envrc`, CORE-V2 §12) is read and
written to a frame attribute — `data-sem-tab-theme` on `.sem-shell-frame`
(`sem-terminal.ts#applyTabTheme`, ~line 967; fed from
`sem-terminal.ts:387`) — but **no stylesheet reads that attribute**, so
setting `TAB_THEME` has no visible effect. Why deferred: theming the tab
strip and frame needs a design decision on the allowed theme names and how
they map onto the `--sem-*` token set and the existing `data-sem-theme`
themes (`themes/`), including contrast checks. What must land first: that
theme-name-to-token mapping (a small CSS block in the shell's styles),
validation of the value (an unknown name must fall back, not inject an
arbitrary attribute value into CSS selectors), and an a11y contrast pass.
