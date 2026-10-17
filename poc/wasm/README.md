# poc/wasm — the wat2wasm-free path (round-3 LANE=wasm-poc)

Real WebAssembly programs, hand-encoded — no system toolchain required.

## Why this exists

This machine has **no wasm-capable toolchain today**:

- `rustup target list --installed` carries no `wasm32-wasip1` / `wasm32-wasi`
- Apple clang ships no wasm32 backend
- no `wat2wasm` / wabt, no wasi-sdk, no emscripten

The round-3 brief forbids installing system toolchains. The blessed
fallback is a **tiny JS assembler** (`asm/minias.mjs`) plus four real
WASI command modules (`asm/programs.mjs`), whose output is committed as
`bin/*.wasm` fixtures — real WebAssembly, byte-reproducible
(`test/unit/wasm-shim.test.ts` re-assembles and byte-compares every
fixture), and exercised end-to-end through the shim in
`src/terminal/wasm/`.

The real path, when a toolchain is wanted (NOT installed here):

```sh
rustup target add wasm32-wasip1        # Rust route
cargo build --target wasm32-wasip1 --release
# or: brew install wabt                # wat2wasm route
```

## Layout

```
asm/minias.mjs     LEB128, instruction emitters, module builder
asm/programs.mjs   hello / wcat / wargs / wtype (JS is the macro layer)
asm/build.mjs      writes bin/*.wasm, validates, --bench latency
bin/*.wasm         committed fixtures (build output — byte-identical)
dev.html           browser verification page (worker path + JSPI)
```

## Programs

| fixture    | bytes | proves                                                      |
| ---------- | ----- | ----------------------------------------------------------- |
| hello.wasm | 189   | fd_write + proc_exit — the smallest possible guest           |
| wcat.wasm  | 254   | fd_read loop, EOF semantics, stdout echo                     |
| wargs.wasm | 1119  | args_get/environ_get ABI, clock_time_get, i64 decimal math   |
| wtype.wasm | 720   | path_open against the preopen snapshot + fd_close (cat FILE) |

## Regenerate + measure

```sh
node poc/wasm/asm/build.mjs          # write bin/ + sizes + validate
node poc/wasm/asm/build.mjs --bench  # + compile/instantiate/run medians
```

## Browser check

With the repo's vite dev server (`npx vite` from the repo root), open
`/poc/wasm/dev.html`: each fixture runs through the full stack —
`startWasiJob` spawns the module worker (`src/terminal/wasm/worker-main.ts`),
stdout streams into the page, the input box feeds guest stdin (JSPI
suspends the wasm stack between keystrokes on Chromium ≥ 137).
