# WASM PoC — verdict, measurements, and the path (round-3 LANE=wasm-poc)

Spikes CORE-V2 **Appendix A**: the smallest real kernel surface behind the
SAME terminal app API. Everything below ran, measured, and is committed in
this worktree — nothing is vendored and nothing needed a system toolchain.

**Verdict: GO.** A WASI-preview1 shim + four real wasm programs behind the
standard `CommandSpec`/`App` surface, with JSPI-based interactive stdin,
at a cost of **0 bytes to the shell bundle** and **15.4 KB raw / 5.5 KB
gzip** as a lazy chunk.

---

## 1. What exists now

| piece | where | what it proves |
| --- | --- | --- |
| WASI preview1 host | `src/terminal/wasm/wasi.ts` | args/environ, fd table (0/1/2 + preopens), fd_read/write/seek/close/fdstat/filestat, prestat ×2, path_open/path_filestat_get (read-only snapshot, `..` clamps at the root), clock, random, proc_exit as a thrown sentinel, ENOSYS/ENOTSUP/EROFS stubs so real wasi libc binaries never wedge |
| engines | `src/terminal/wasm/engine.ts` | `runWasi` (batch, sync — every host) and `runInteractive` (JSPI: only fd_read is `Suspending`-wrapped, so the guest suspends mid-instruction until stdin arrives); `jspiAvailable()` feature-detects |
| job runner | `src/terminal/wasm/runner.ts` + `worker-main.ts` | worker-first placement with an in-thread fallback that speaks the identical protocol; worker 404/CSP degrades in-thread, never fails the job |
| terminal app | `src/terminal/wasm/app.ts` | `WasmRunApp` (CORE-V2 §6.1 `App`): alt screen, typed lines → guest stdin, Ctrl+D EOF, Ctrl+C kill → exit 130, `a11ySummary` as the DOM-mirror surface |
| command | `src/terminal/wasm/command.ts` | `wasm <module.wasm> [args…]`: `app:` claims the tty (§6.4), `run()` is the piped/redirected batch path with exit-code propagation; modules load from the VFS (`.wasm` binary string or `.b64` base64); preopen = in-memory VFS snapshot at spawn |
| fixtures | `poc/wasm/**` | the wat2wasm-free path: a ~300-line JS assembler + four programs (below); `bin/*.wasm` are committed build output, byte-re-producible by the unit suite |

## 2. Measurements

### 2.1 Fixtures (committed binaries, hand-encoded)

| fixture | size | syscall surface exercised |
| --- | --- | --- |
| hello.wasm | 189 B | fd_write, proc_exit |
| wcat.wasm | 254 B | fd_read loop, EOF, fd_write |
| wargs.wasm | 1,119 B | args/environ get+sizes, clock_time_get, i64 div/rem decimal formatting |
| wtype.wasm | 720 B | args_get, path_open, fd_read, fd_close, error paths (usage=2, ENOENT=1) |

Total kernel+programs: **2.3 KB** — three orders under the appendix's
300 KB envelope.

### 2.2 Latency (Node 26, this machine, `node poc/wasm/asm/build.mjs --bench`, n=50)

| fixture | compile+instantiate+run, median |
| --- | --- |
| hello | 0.019 ms |
| wcat | 0.019 ms |
| wargs | 0.024 ms |
| wtype | 0.023 ms |

Through the full shim (`runWasi`, vitest): sub-millisecond per program,
dominated by instantiation; the appendix's <100 ms budget has ~4 orders of
headroom. JSPI round trip (fd_read suspends 15 ms on a Promise, resumes,
echoes): covered by `test/unit/wasm-shim.test.ts` — "fd_read suspends
until a delayed stdin Promise resolves".

### 2.3 Bundle impact (the round-3 invariant)

- Shell bundle: **0 bytes from this lane.** Nothing under
  `src/terminal/wasm/` is imported by `src/js-shell.ts` or any module in
  its graph. Proof: private build `node scripts/build.mjs --out
  /tmp/semtext-snap/shell-v3-wasm-poc/`, then `grep -c` for
  `wasi_snapshot_preview1|startWasiJob|WasiExit|proc_exit|fd_prestat|
  WasmRunApp|snapshotPreopen|jspiAvailable` over `semtext-js-shell.js` →
  **0 hits for every marker**.
- Lazy chunk (what registration would fetch on first use, esbuild-bundled
  + minified): **15,375 B raw / 5,519 B gzip** (`wasm-chunk.js`).
- Worker file (`worker-main.ts`, bundled standalone): **10,172 B raw /
  3,594 B gzip**. In a production vite build the worker shares modules
  with the chunk, so the pair's true ceiling is below their sum.
- Context: the shared worktree's `semtext-js-shell.js` currently measures
  **266.2 KB (10.2 KB over the 256 KB cap)** — that overage is concurrent
  lanes' work (tabs-ui session refactor, nano, find+sed, card themes
  all landed in this tree); this lane contributed none of it (grep above)
  and must not be asked to shrink for it.

## 3. JSPI (WebAssembly JS Promise Integration)

Interactive stdin without SharedArrayBuffer: the shim's fd_read returns a
Promise; `WebAssembly.Suspending` wraps exactly that import so the wasm
stack suspends; `WebAssembly.promising(_start)` makes the whole run
awaitable. Feature-detected (`jspiAvailable()` — Chromium ≥ 137, modern
V8/Node ≥ 22 behind flags, stable in Node 26 where this PoC's suite runs
it). Degradation is explicit, not silent: without JSPI the status line
reports "batch (no JSPI: stdin closes at start)" and the run executes
with whatever stdin was queued at spawn.

Worker placement is orthogonal: the same `runInteractive` runs on a
dedicated worker (browsers) or the calling thread (Node tests, worker-less
hosts). Occupancy is a placement choice, not a correctness one.

## 4. v86 evaluation (numbers, not vendored)

v86 ([copy/v86](https://github.com/copy/v86), [copy.sh/v86](https://copy.sh/v86/))
is an x86 PC emulator with an x86-to-wasm JIT — a different animal from a
command runtime:

- **License:** BSD-2-Clause (permissive; repo also ships `LICENSE.MIT`
  for qemu-derived parts of `src/floppy.js` — both must travel with a
  redistribution).
- **Size:** the npm package (`v86` 0.5.471) unpacks to
  **18,569,080 bytes ≈ 18.7 MB** (libv86 variants + v86.wasm + BIOS
  blobs) — before any guest. Guest images on the demo page run from
  ~0.5 MB (MS-DOS 4) through 54+ MB (Android); a minimal usable Linux is
  ~4.9 MB (Buildroot).
- **Boot time:** upstream publishes no figure; the maintained 64-bit fork
  ([portlandhodl/v86_64](https://github.com/portlandhodl/v86_64)) reports
  Alpine Linux booting to an interactive shell in **~28 s** at ~530 MIPS
  (JIT; ~80 interpreted).
- **Embedding constraints:** the JIT wants `SharedArrayBuffer` →
  COOP/COEP response headers → **breaks file:// and cross-origin
  embedding** (the appendix's own strike against it).

**Conclusion:** v86 is the wrong shape for `wasm <module>` — 18.7 MB of
emulator plus megabytes of disk image and multi-second boots to run
189-byte programs, with an embedding constraint the demo pages can't
satisfy. It stays interesting as a future "full OS in a tab" feature,
loaded on demand behind its own origin policy. The micro-kernel path
(this PoC) wins on every axis the appendix scored.

## 5. Toolchain gap (reported, not installed)

Per the brief nothing was installed. For the record, the real-compiler
path would need exactly one of:

```sh
rustup target add wasm32-wasip1     # Rust: cargo build --target wasm32-wasip1 --release
brew install wabt                   # wat2wasm for hand-written .wat
brew install llvm                   # clang --target=wasm32-wasi
```

Until then the committed `poc/wasm/asm/` path is the source of truth:
`node poc/wasm/asm/build.mjs` regenerates `bin/*.wasm`, and
`test/unit/wasm-shim.test.ts` fails if the pair ever drifts.

## 6. Productionization (the one Cross-lane request)

CORE-V2 §6.4's `app?(ctx)` is synchronous, and the pipeline's `run()` is
synchronous — a cold dynamic `import()` cannot satisfy either mid-command.
Two pieces land the command without touching the shell bundle:

**(a) a build stanza** — `scripts/build.mjs` emits the shim as a sibling
chunk exactly like `semtext-lazy.js` / `npl-lazy.js` (esbuild API, same
directory as `semtext-js-shell.js`):

```js
// scripts/build.mjs — coordinator/build-owner addition (NOT this lane's edit)
await esbuild.build({
  entryPoints: ['src/terminal/wasm/index.ts'],
  bundle: true, format: 'esm', minify: true,
  outfile: resolve(distDir, 'semtext-wasm.js'),   // 15.4 KB raw / 5.5 KB gzip
});
```

**(b) the bridge** — `src/terminal/plugins/posix/plugin.ts` (tabs-ui's
file). A plain relative `import('../../wasm/index.js')` would be *inlined*
by the IIFE lib build (Rollup cannot code-split IIFE), so the bridge must
use the repo's established runtime-specifier pattern
(`src/lazy/boot.ts#defaultImportChunk`): `@vite-ignore` + a URL resolved
against `import.meta.url`, which Rollup leaves alone and the browser
fetches next to the shell script:

```ts
// src/terminal/plugins/posix/plugin.ts (tabs-ui's file — Cross-lane request)
import type { CommandSpec } from '../../terminal-core.js';
import type { wasmCommand as WasmCommand } from '../../wasm/index.js';

type WasmSpec = typeof WasmCommand;
// Pre-warm at plugin load: resolves long before a user types `wasm`.
const warmed: Promise<WasmSpec | null> = import(
  /* @vite-ignore */ new URL('semtext-wasm.js', import.meta.url).href
).then((m) => (m as { wasmCommand?: WasmSpec }).wasmCommand ?? null, () => null);

export const wasmBridge: CommandSpec = {
  name: 'wasm',
  usage: 'wasm <module.wasm> [args...] — run a WASI command module',
  run(ctx) {
    // Pre-warm miss (chunk still loading / unavailable): honest degrade.
    ctx.err('wasm: runtime not loaded yet — try again in a moment');
    ctx.exit(75); // EX_TEMPFAIL
  },
};
// once the chunk is resident, swap in the real run/app — the registration
// identity stays stable, `app:` claims only when the code is loaded:
void warmed.then((spec) => { if (spec) Object.assign(wasmBridge, spec); });
```

`Object.assign` keeps the registration identity stable while swapping in
the real `run`/`app` once the chunk is resident — no pipeline change, no
core change, `app:` claims only when the code is actually loaded. If the
shell later moves to an async-capable command pipeline (a CORE-V2
question, not this lane's), the bridge collapses to a plain
`app: async (ctx) => (await import('…')).wasmApp(ctx)`.

The `import type` line is erased at build time — it types the swap without
adding a byte to the bundle. The worker reference
(`new URL('./worker-main.js', import.meta.url)`) inside the chunk is
emitted as its own file by any bundler that builds the chunk; under
`vite dev` it 404s (sources are `.ts`) and the runner degrades in-thread
by design.

## 7. Test evidence

- `test/unit/wasm-shim.test.ts` (18): all four fixtures through `runWasi`;
  EOF; argv/environ/clock with non-ASCII args; preopen open/ENOENT/usage;
  `..` clamping; EBADF through proc_exit; missing `_start` refused;
  exit-code propagation; fixture byte-reproducibility ×4; JSPI suspension
  with a delayed stdin Promise; `WasiExit` sentinel shape.
- `test/unit/wasm-app.test.ts` (14): batch `run()` (usage/missing/not-wasm/
  base64/hello/wcat-piped/wtype-snapshot); `app:` claim/decline matrix;
  real-Screen `AppRunner` harness — output on the alt screen, typed lines
  reach the guest, Ctrl+D EOF, exit codes land, Ctrl+C → 130, a11y
  summaries.
- Full-suite + e2e status: see the round-3 report
  (`.tmp/semtext-shell-epochs/reports/r3-wasm-poc.md`).
