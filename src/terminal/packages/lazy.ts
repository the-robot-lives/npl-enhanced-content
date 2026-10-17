/**
 * packages/lazy — the generalised lazy-package loader (packages round,
 * LANE=pkg-infra).
 *
 * One routine every package stub reuses, generalising the two hand-rolled
 * lazy bridges in the tree: nano's LazyNano (apps/nano/nano-command.ts,
 * input buffering for the full-screen app surface) and find/sed's
 * boot-preloaded stub (plugins/posix/find-sed.ts).
 *
 * The contract in one paragraph: a stub registers real `CommandSpec`
 * objects immediately (so `help`, completion and `man` never wait on the
 * network), kicks the chunk's dynamic import at boot in parallel with the
 * shell's own startup — `CommandSpec.run` and `execLine` are synchronous,
 * so a load on first use would deterministically fail the first pipeline
 * stage (see find-sed.ts) — and every surface delegates to the chunk's
 * specs once they are resident. An invocation that still beats the fetch
 * gets a one-line retry hint, never a hang; a failed fetch gets a load
 * error naming the chunk. `--help` and `man` are answered from the stub
 * without the chunk, so docs survive even a failed download.
 *
 * Chunk resolution uses the repo's established runtime-specifier pattern
 * (src/lazy/boot.ts#defaultImportChunk): `@vite-ignore` + a URL resolved
 * against `import.meta.url`, which Rollup leaves alone in the IIFE shell
 * build and the browser fetches from next to the built script — the same
 * no-fetch-outside-bundle-dir rule as the nano chunk. Tests inject a
 * loader instead (the built chunk file does not exist in the source tree).
 */

import type { CommandContext, CommandSpec, CompletionContext, PluginManifest } from '../terminal-core.js';
import type { PackageModule, PackageStub } from './types.js';

/** The chunk file name the build emits for a package (see scripts/build.mjs). */
export function packageChunkFile(pkg: string): string {
  return `semtext-pkg-${pkg}.js`;
}

/** The production loader: dynamic-import the chunk next to the built script. */
export function importPackageChunk(pkg: string): Promise<PackageModule> {
  return import(/* @vite-ignore */ new URL(packageChunkFile(pkg), import.meta.url).href).then(
    (mod) => mod as PackageModule,
  );
}

export interface LazyPackage {
  /** Package id (= directory name = chunk stem). */
  readonly name: string;
  /** The stub-backed specs — these are what a manifest mounts. */
  readonly commands: CommandSpec[];
  /** Kick (once) and await the chunk; resolves false when it fails to load. */
  ensure(): Promise<boolean>;
  /** True once the chunk's real specs are resident. */
  loaded(): boolean;
  /** Chunk-load lifecycle: `loading` (fetch in flight), `resident`
   *  (real specs answer), `failed` (the fetch rejected). The supersedes
   *  mount consults this to keep a replaced base command answering until
   *  — and only until — the package takes over (manifest.ts). */
  state(): 'loading' | 'resident' | 'failed';
  /** Command names this package can answer `man` for right now. */
  manNames(): ReadonlySet<string>;
  /** Man page lines for one command: the chunk's page once resident, else
   *  the stub's short page; null when this package has none. Consulted
   *  live on every `man` call, so the swap needs no re-registration. */
  manPage(name: string): string[] | null;
  /** Base command names the stub declares it intentionally replaces
   *  (types.ts#PackageStub.supersedes) — silent supersedes at mount. */
  readonly supersedes: ReadonlySet<string>;
}

/** True when the invocation only asks for help (answered from the stub). */
export function isHelpRequest(args: readonly string[]): boolean {
  return args.includes('--help') || args.includes('-h');
}

/**
 * Build one lazy package from its stub + a chunk loader. Kicks the import
 * immediately (boot-parallel preload — see the header note); every spec
 * delegates read-through, so nothing mutates after registration.
 */
export function createLazyPackage(stub: PackageStub, load: () => Promise<PackageModule>): LazyPackage {
  const chunkFile = packageChunkFile(stub.name);
  const real = new Map<string, CommandSpec>();
  const chunkMan = new Map<string, string[]>();
  const stubMan = new Map<string, string[]>();
  for (const cmd of stub.commands) {
    if (cmd.man !== undefined) stubMan.set(cmd.name, cmd.man);
  }
  let resident = false; // the chunk resolved (even if it shipped no commands)
  let failed = false;
  let pending: Promise<boolean> | null = null;

  const ensure = (): Promise<boolean> => {
    pending ??= load().then(
      (mod) => {
        for (const spec of mod.commands) real.set(spec.name, spec);
        for (const [name, page] of Object.entries(mod.manPages ?? {})) chunkMan.set(name, page);
        resident = true;
        return true;
      },
      () => {
        failed = true;
        return false;
      },
    );
    return pending;
  };
  void ensure(); // boot-parallel preload; sync pipelines cannot await first use

  const specFor = (cmd: PackageStub['commands'][number]): CommandSpec => {
    const loadedSpec = (): CommandSpec | undefined => real.get(cmd.name);
    return {
      name: cmd.name,
      // Help/completion surfaces read the stub's line — never the chunk.
      usage: cmd.usage,
      run(ctx: CommandContext) {
        const spec = loadedSpec();
        if (spec !== undefined) {
          spec.run(ctx); // the real command owns even --help once resident
          return;
        }
        if (isHelpRequest(ctx.args)) {
          ctx.out(cmd.usage); // answered from the stub, chunk or no chunk
          return;
        }
        if (failed) {
          ctx.err(`${cmd.name}: package chunk failed to load (${chunkFile})`);
          ctx.exit(1);
          return;
        }
        if (resident) {
          // The chunk is resident but forgot this command — a contract bug.
          ctx.err(`${cmd.name}: package chunk ${chunkFile} does not provide it`);
          ctx.exit(70);
          return;
        }
        ctx.err(`${cmd.name}: chunk still loading — try again`);
        ctx.exit(1);
      },
      complete(ctx: CompletionContext): string[] {
        return loadedSpec()?.complete?.(ctx) ?? [];
      },
      app(ctx: CommandContext) {
        // tty handover claims only when the code is actually loaded (§6.4);
        // otherwise run() reports, exactly like the piped path.
        return loadedSpec()?.app?.(ctx) ?? null;
      },
    };
  };

  return {
    name: stub.name,
    commands: stub.commands.map(specFor),
    ensure,
    loaded: () => resident,
    state: () => (resident ? 'resident' : failed ? 'failed' : 'loading'),
    manNames: () => new Set([...chunkMan.keys(), ...stubMan.keys()]),
    manPage: (name) => chunkMan.get(name) ?? stubMan.get(name) ?? null,
    supersedes: new Set(stub.supersedes ?? []),
  };
}

/**
 * Wrap a mounting manifest's `man` with the packages' pages: a chunk page
 * once resident, else the stub's short page, else the original man (whose
 * completion already lists every registered command, packages included).
 * Identity when the manifest has no `man` command — mounting code calls
 * this for every manifest and only the one carrying `man` changes.
 */
export function withPackageMan(manifest: PluginManifest, packages: readonly LazyPackage[]): PluginManifest {
  const man = manifest.commands.find((spec) => spec.name === 'man');
  if (man === undefined) return manifest;
  return {
    ...manifest,
    commands: manifest.commands.map((spec) =>
      spec.name !== 'man'
        ? spec
        : {
            ...spec,
            run(ctx: CommandContext) {
              const name = ctx.args[0];
              if (name !== undefined) {
                // Live lookup — chunk pages appear the moment the chunk
                // resolves, no re-registration (first package wins on a
                // name two stubs both document).
                for (const pkg of packages) {
                  const page = pkg.manPage(name);
                  if (page !== null) {
                    ctx.out(`${name.toUpperCase()}(1)                semtext-sh manual`);
                    ctx.out('');
                    for (const line of page) ctx.out(line);
                    return;
                  }
                }
              }
              man.run(ctx);
            },
          },
    ),
  };
}
