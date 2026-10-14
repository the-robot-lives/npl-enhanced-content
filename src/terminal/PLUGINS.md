# sem-terminal — plugin contract

`<sem-terminal>` is a reusable terminal core (input, history, transcript,
prompt, dispatch) that knows nothing about SemText. Everything it can do
beyond two builtins (`help`, `clear`) arrives through **plugins**.
`<sem-shell>` is the core with two bundled plugins mounted: `posix-sh`
(the POSIX-style commands over the virtual file system) and `semtext-demo`
(the demo documents and the `semtext`/`open` commands).

## Manifest

A plugin manifest is a JSON object or an equivalent JS object:

```jsonc
{
  "name": "semtext-demo",            // required, unique per terminal
  "version": "0.1.0",                // required
  "description": "…",                // optional
  "load": {                          // optional: where shipped code lives
    "src": "./commands.js",          //   relative to the manifest URL, or
    "integrity": "sha256-<64 hex>"   //   absolute https — which REQUIRES this
  },
  "commands": [ … ],                 // JS-object manifests: full specs
  "files": [ … ]                     // virtual file-system entries
}
```

One line, as you would declare it on the element (hash rides the URL as a
fragment):

```html
<sem-terminal plugins="https://cdn.example.com/semtext/manifest.json#sha256-9f2c… demo/manifest.json">
```

## File structure a plugin ships

```
my-plugin/
  manifest.json      the manifest above (name, version, load, files)
  commands.js        ES module, default-exports the CommandSpec[] array
  files/             the documents the plugin mounts (referenced by files[].src)
```

The in-repo examples are `src/terminal/plugins/demo/` (the same manifest
as a JS object in `plugin.ts`, bundled, zero fetches) and
`src/terminal/plugins/posix/` (the POSIX command set, bundled-only).
`manifest.json` is the JSON serialization for the shipped form; a test
pins the two in sync.

## Command signature

```ts
interface CommandSpec {
  name: string;              // /^[a-z][a-z0-9-]*$/, unique per terminal
  usage: string;             // shown by `help`, e.g. "ls [-l] [path]"
  run(ctx: CommandContext): void;
}

interface CommandContext {
  args: string[];            // argv after the command name — expanded
  stdin: string | null;      // piped text from the previous stage, else null
  vfs: Vfs;                  // the terminal's virtual file system
  state: ShellState;         // shared, persistent (see below)
  color: boolean;            // stdout goes to the terminal (a "tty"), so
                             //   ANSI color is welcome; false when piped
                             //   or redirected
  commands: ReadonlyMap;     // every registered command (for `which`-likes)
  out(text: string): void;   // one stdout line (also piped stdout)
  err(text: string): void;   // one stderr line — errors print, never throw
  emit(action): void;        // side-effect requests, DATA only:
  exit(code): void;          // set the exit status (default: 1 if stderr
}                            //   was written, else 0)
```

`ShellState` is the persistent shell, shared by every command of a
terminal: `cwd`, `env` (HOME/PWD/SHELL seeded; `export`/`unset` mutate),
`aliases`, `history` (every executed line), `oldpwd`, and `lastStatus`
(`$?`). Commands mutate `state.cwd`/`state.env` directly; the core keeps
`env.PWD` in step with `cwd` after each line.

## Shell grammar (src/terminal/sh-parse.ts)

Pipelines run left to right (`cat f | grep x > out.txt`). Before a command
runs, the core parses the line:

- `|` splits stages; `>` truncates, `>>` appends a stage's stdout to a
  virtual file (`> f` alone creates an empty f). Redirect targets are never
  glob-expanded.
- Quoting: `'…'` literal; `"…"` expands `$VAR`/`${VAR}`/`$?`; `\` escapes.
- `~` and `~/…` expand from `$HOME` on unquoted words.
- `$VAR`, `${VAR}` expand from `state.env`; `$?` is the previous exit
  status. Unset variables expand empty.
- `*` and `?` glob against the VFS on unquoted words (leading-dot names
  need a literal leading dot); no match leaves the pattern literal.
- The first word of a stage may be an `alias` — its space-split value
  becomes the stage's leading words; an alias never re-expands itself.
- Every executed command appends a `status` transcript line (`exit 0`).
  Exit statuses: explicit `ctx.exit(code)` wins; unknown commands are 127;
  a thrown exception or any stderr means 1; otherwise 0.

## Actions (the one side-effect channel, DATA only)

```ts
{ kind: 'window', filename, blob, contentType }  // open content in a window
{ kind: 'tui', title, cards: [{front, back, meta}] }  // the flashcard view
```

The element performs both; the core stays DOM-free. A `tui` action opens
the read-only card view (boxed panels; `j`/`k`/arrows move, `Enter`
expands, `/` filters, `q` closes). Emit it only when `ctx.color` is true —
a piped `semtext tui` prints its summary line and does not hijack the
terminal. The card/state machine lives in src/terminal/tui.ts.

## Files and mounting

`files[]` entries mount into the terminal's (initially empty) virtual file
system: `{ path: "/demo/welcome.html", content: "…" }` in a JS-object
manifest, or `{ "path": "/demo/welcome.html", "src": "files/welcome.html" }`
in a JSON manifest (fetched relative to the manifest URL). Paths must be
absolute; intermediate directories are created; a later mount replaces an
earlier file at the same path (last write wins). Plugins see the whole
tree — mount under your plugin's own prefix (`/demo`, `/my-plugin`) to
avoid stepping on others.

## CDN load rules

- `<sem-terminal plugins="URL …">` loads each URL independently: one
  failure prints a stderr line and is recorded in `core.loadErrors`; the
  other plugins still mount.
- **Absolute https only.** `http://` and protocol-relative `//` are
  refused outright. Relative / same-origin paths always load.
- **Integrity:** recommended everywhere, REQUIRED for absolute https.
  - Manifest URL: `https://cdn/…/manifest.json#sha256-<64 hex>`.
  - Commands module: the manifest's `load.integrity`.
  - `sha256-<hex>`, hex over the exact fetched text.
- A https source with no hash is **refused before any network request**.
- Verified remote code is imported from a blob URL — there is no `eval`,
  no `new Function`, and no inline `<script>` anywhere in this loader.
  Without a verified hash, no remote code is imported at all.
- Integrity pins bytes; it is not a signature. Rotate hashes when you
  publish new bytes.

## Scripted playback

`<sem-terminal script='[ … ]'>` (or the `playback` property: the same
array as a JS value) makes the terminal demo itself on open. A script is
a list of steps:

```jsonc
[
  { "type": "comment", "text": "A 40-second tour." },
  { "type": "type",  "text": "ls -l", "delayMs": 55 }, // typed char by char
  { "type": "key",   "key": "Enter" },                 // ArrowDown, j, q, …
  { "type": "wait",  "ms": 600 },
  { "type": "run" }                                    // executes the line
]
```

- `type` types into the prompt (`delayMs` per character, default 45);
- `key` presses a named key — routed to the input line, or to the open
  TUI view when one is up;
- `wait` pauses; `run` executes the typed line; `comment` prints a note
  that is not executed.
- On open the script starts typing. **Escape stops it and hands the
  terminal to the user**; a `replay` button restarts from the top.
- `prefers-reduced-motion: reduce` runs the whole script at full speed —
  no typing delay, no waits.
- No `script` attribute and no `playback` property → no playback.
- The zero-JS fallback is untouched: the authored static transcript stays
  exactly what it was.

The runner is src/terminal/playback.ts — pure scheduling with an
injected driver and timer, unit-tested without a DOM.

## Programmatic mounting

```ts
const el = document.querySelector('sem-terminal');
el.core.mountPlugin({ name: 'x', version: '1.0.0', commands: [...], files: [...] });
```

Bundled JS-object manifests carry inline `content` files and real `run`
functions — nothing is fetched. A mount is all-or-nothing: a duplicate
command name or a bad file path fails the whole plugin with no partial
state.

## Tab completion (src/terminal/complete.ts)

Tab is driven by a pure function over the current line, the command
registry and the VFS — no DOM in the engine, so it unit-tests in plain
Node and survives the Epoch-2 input swap (the canvas/raw-mode terminal
reuses it verbatim).

- `completeLine(input, core)` returns one of
  `{ kind: 'none' }` · `{ kind: 'extend', line }` (replace the input) ·
  `{ kind: 'list', line, candidates }` (extend AND show).
- **Command position** — the first word of a stage (after an unquoted
  `|`) completes against command names and aliases. After an unquoted
  `>` the word completes paths, never commands.
- **Paths** — every other word completes VFS entries: relative,
  absolute or `~`-led (`~` expands against `$HOME`). Directories gain a
  trailing `/`; a completed file ends with a space. Candidates that
  need quoting (spaces, quotes, globs, shell metacharacters) are
  single-quoted when the typed word was unquoted; a completed quoted
  word closes its quote.
- **Hooks** — a `CommandSpec` may carry `complete(ctx)`; it runs first
  for the first-argument position (e.g. `cd` offers directories only,
  `which`/`man` offer command names, `semtext` offers subcommands, then
  paths for the file operand). `completePaths(ctx)` from the engine
  gives plugins the same relative/absolute/`~` listing for later args.
- A trailing space reaches the hook as word `''` — `cd ` and
  `semtext render ` complete their FIRST argument position.
- Keyboard: the element handles Tab — one candidate extends quietly;
  several candidates extend to the common prefix and show the list
  (display-capped at 8 with an `… +N more` note) as a comment line;
  no match leaves the line untouched.

## Storage backends (src/terminal/backends/)

A backend implements `VfsBackend` and is attached to a mountpoint:
`attachBackend(vfs, backend)` / `detachBackend(vfs, mountpoint)`. Every
mutating op (`write`, `mkdirp`, `rm`, `rename`) flushes through
`#flush(backend, op, path, run)` — write-through, last write wins.

- **Flush failure ≠ lost data.** The in-memory tree is authoritative;
  a failed flush records exactly one `VfsStorageError`
  (`{backend, mountpoint, op, path, message}`) on `core.storageErrors`,
  emits one stderr warning via `core.onError`, and execution continues.
  Non-writable backends skip write flushes entirely (reads and cache
  mutations still work).
- **local-storage** — `attachLocalStorage(vfs, { key, store?, mountpoint='/' })`
  persists the tree as JSON under `semtext:shell:v1:<key>`
  (`localStorage`; a `KeyValueStore` can be injected for tests).
  - `<sem-shell local-storage>` (or `local-storage="key"`) enables it;
    an empty key warns and stays off — give the element an `id`.
  - **Boot order matters:** the element peeks the stored payload
    (`peekStored()`) BEFORE any plugin mounts, then passes it to
    `restore(preRead)` in a microtask — boot mounts re-seed storage
    with the fresh tree, and a naive restore-after-mount would read the
    just-clobbered payload instead of the user's tree on every reload.
  - `restore()` → `'seeded' | 'restored' | 'corrupt'`; corrupt or
    wrong-version payloads warn on stderr and re-seed. `storage reset`
    restores the factory tree and rewrites the store.
  - The payload is plain JSON (no eval anywhere), versioned by the key
    prefix; quota errors surface as the one flush warning. Two elements
    sharing a key clobber each other — give each its own key.
- **s3** — `createS3Backend(args, signer?)` / `attachBackend` mounts an
  object store under a mountpoint:
  `mount s3 <https://host/bucket/prefix/> <mountpoint>`.
  - `https://` only; URLs carrying credentials (`user:pass@`) are
    refused outright — credentials never ride markup or URLs.
  - **public** mode is read-only (plain GETs); **presign** mints writes
    through `presignEndpoint` (`?op=put&key=…` → a PUT to the returned
    URL); **signer** takes a callback that returns the same shape.
  - Listing is a `?list-type=2` GET parsed from S3 XML (dir markers
    skipped; keys are base-relative, so a key `docs/a.txt` under
    `https://host/bucket/prefix/` serves `/mount/docs/a.txt`).
  - **The browser needs CORS** on the bucket for GET/PUT — a failed
    request surfaces as the one flush warning (`request failed
    (network/CORS)`), never a partial mount.
  - Hydration is capped (`maxObjects` 64, `maxBytes` 1 MiB defaults)
    and reports `ready — N objects hydrated (capped at …)` on stdout;
    unreadable objects are skipped, a failed list lands on stderr and
    the mount stays empty rather than half-read.

  - **oidc** mode — self-hosted cognito-style sign-in (e.g. Authentik,
    Keycloak, MinIO's STS); no static key ever reaches the page:
    `mount s3 <base> <mnt> mode=oidc issuer=<openid issuer>
    client_id=<public client> redirect=<redirect uri> sts=<sts endpoint>
    [role=<role arn>] [scope=<scope>] [session_name=<name>]
    [region=<region>] [persist=session|local]`.
    1. The shell runs authorization-code + PKCE in a popup against the
       issuer's discovery document (`.well-known/openid-configuration`);
       the redirect page must `postMessage({source: 'semtext-s3-auth',
       state, code}, origin)` back — same origin only, state checked,
       120 s timeout.
    2. The `id_token` is exchanged at the STS endpoint with
       `AssumeRoleWithWebIdentity` (MinIO supports this), yielding
       temporary `AccessKeyId/SecretAccessKey/SessionToken` (default
       role session name `semtext-shell`).
    3. Every request is signed in-browser with SigV4
       (`src/terminal/backends/sigv4.ts`, WebCrypto HMAC-SHA256) —
       GET/PUT/DELETE/ListObjectsV2, path-style, custom endpoints.
    4. The temporary credential set lives in `sessionStorage` by
       default (`persist="local"` opts into `localStorage`), namespaced
       per mountpoint (`semtext:shell:s3:<mount>`), and is refreshed
       silently ~60 s before expiry through the refresh token (or
       re-sign-in if none was issued). `mount --logout <mnt>` and
       `umount` clear the store and stop the timer. Values are never
       logged — `mount` listings show mode, store kind, and expiry
       only.
    - **Security notes.** Configure CORS on BOTH the bucket and the STS
      endpoint for the app origin, methods GET/PUT/DELETE/POST and the
      `Authorization`, `x-amz-*` headers. Scope the assumed role to the
      mount prefix — least privilege, e.g.
      `{"Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject",
      "s3:DeleteObject", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::bucket/prefix/*",
      "arn:aws:s3:::bucket"]}`. Temporary credentials in web storage are
      XSS-readable — keep the STS TTL short (minutes), prefer
      `sessionStorage` (dies with the tab) over `localStorage`, and
      never paste credentials into markup: static
      `access_key`/`secret_key` flags are REFUSED at parse time. A
      strict CSP (`connect-src` limited to the bucket + issuer + STS,
      no `unsafe-inline` scripts) bounds what an injected script can
      reach.

The element wires ANSI output through `AnsiStateMachine` +
`ansiSpans` (see src/terminal/ansi/) — one machine per terminal so
SGR state persists across lines, reset on clear/Ctrl+L; raw escape
bytes never reach the DOM.

