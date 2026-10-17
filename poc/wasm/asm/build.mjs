/**
 * poc/wasm/asm/build.mjs — regenerate poc/wasm/bin/*.wasm and print the
 * WASM-POC measurements (fixture sizes + compile/instantiate/run latency
 * through src/terminal/wasm via a quick esbuild-free smoke import).
 *
 *   node poc/wasm/asm/build.mjs            # write bin/ + sizes
 *   node poc/wasm/asm/build.mjs --bench    # + latency bench (50 runs)
 *
 * The committed bin/*.wasm fixtures are the build output; the unit suite
 * re-assembles and byte-compares so the pair cannot drift.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PROGRAMS } from './programs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const binDir = resolve(here, '../bin');
mkdirSync(binDir, { recursive: true });

const sizes = [];
for (const [name, build] of Object.entries(PROGRAMS)) {
  const bytes = build();
  const file = resolve(binDir, `${name}.wasm`);
  writeFileSync(file, bytes);
  sizes.push([name, bytes.length, bytes]);
  if (!WebAssembly.validate(bytes)) {
    console.error(`✗ ${name}.wasm: invalid module`);
    process.exit(1);
  }
}

for (const [name, len] of sizes) console.log(`${name}.wasm  ${len} B`);

if (process.argv.includes('--bench')) {
  // Wasm-side latency: compile + instantiate + run `_start` against a
  // generic stub host built from the module's own import list (the full
  // shim's cost is measured by the vitest suite through runWasi()).
  const N = 50;
  for (const [name, , bytes] of sizes) {
    const t = [];
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      const module = new WebAssembly.Module(bytes);
      const stubs = {};
      for (const imp of WebAssembly.Module.imports(module)) {
        stubs[imp.name] = imp.name === 'proc_exit' ? () => {} : () => 0;
      }
      const instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: stubs });
      try {
        instance.exports._start();
      } catch {
        /* proc_exit stub does not throw — nothing expected here */
      }
      t.push(performance.now() - t0);
    }
    t.sort((a, b) => a - b);
    console.log(`${name}: compile+instantiate+run median ${t[Math.floor(N / 2)].toFixed(3)} ms (n=${N})`);
  }
}
