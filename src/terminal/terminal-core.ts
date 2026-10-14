/**
 * sem-terminal — the terminal core: plugin registry, command dispatch.
 *
 * Knows nothing about SemText. Two generic builtins (`help`, `clear`);
 * everything else arrives through plugins — the bundled `posix-sh` plugin
 * (src/terminal/plugins/posix/) is the POSIX-style command set, the bundled
 * `semtext-demo` plugin carries the document commands. The full plugin
 * contract is src/terminal/PLUGINS.md.
 *
 * Dispatch is pipeline-shaped (`cat f | grep x > out.txt`): the input line
 * is parsed by src/terminal/sh-parse.ts (quoting, $VAR/$? expansion, `~`,
 * glob expansion, `|` stages, `>`/`>>` redirects, aliases), then stages run
 * left to right against a shared ShellState; each stage's `out()` text
 * becomes the next stage's `stdin`, every command sets an exit status
 * (`$?`, echoed on a `status` transcript line), and errors are stderr
 * lines — never thrown. The side effects a command may request are DATA
 * (`ShellAction`: open a document in a window, open the flashcard TUI) for
 * the element to perform; the core stays DOM-free and unit-testable in
 * plain Node.
 */

import { Vfs, type VfsBackend, type VfsNode } from './vfs.js';
import { parseCommandLine } from './sh-parse.js';
import {
  checkSourceAllowed,
  fetchText,
  importCommandsModule,
  isIntegrityFormat,
  PluginRefusedError,
  splitIntegrityFragment,
  verifyIntegrity,
  type LoadDescriptor,
  type MountedPlugin,
} from './loader.js';
import type { TuiAction } from './tui.js';
import type { App as TerminalApp } from './screen/types.js';

export interface ShellState {
  cwd: string;
  /** Environment variables ($VAR): HOME/PWD/SHELL start set; export/unset mutate. */
  env: Record<string, string>;
  /** Command aliases — the first word of a stage, expanded to leading words. */
  aliases: Record<string, string>;
  /** Executed input lines, oldest first (the `history` builtin reads this). */
  history: string[];
  /** Previous working directory (`cd -`), or null before the first cd. */
  oldpwd: string | null;
  /** Exit status of the last command ($?). Blank lines leave it untouched. */
  lastStatus: number;
}

export type ShellLineKind = 'cmd' | 'stdout' | 'stderr' | 'status' | 'comment';

export interface ShellLine {
  kind: ShellLineKind;
  text: string;
}

/** Data-only request to show content in a window; the element performs it. */
export interface WindowAction {
  kind: 'window';
  filename: string;
  blob: string;
  contentType: string;
}

/** Data-only request to hand the screen to a full-screen app (CORE-V2 §6.4). */
export interface AppSpawnAction {
  kind: 'app';
  /** The app instance the element's AppRunner will spawn. */
  app: TerminalApp;
}

export type ShellAction = WindowAction | TuiAction | AppSpawnAction;

/**
 * Page-supplied S3 request signer (`core.setS3Signer`): given one
 * operation and object key, returns (or resolves to) the URL to fetch —
 * presigned, short-lived, and issued by the page's own backend. The
 * browser bundle NEVER holds static AWS credentials.
 */
export type S3Signer = (op: 'get' | 'put' | 'delete', key: string) => string | Promise<string>;

/** One mountable backend kind, registered by an optional bundle (s3). */
export interface MountKindSpec {
  /** Kind word in `mount <kind> …`, e.g. `s3`. */
  id: string;
  /** One-line help shown by `mount` with no args. */
  help: string;
  /** Parse the arguments; return a ready backend or an error message. */
  create(args: string[]): VfsBackend | string;
}

/** The word a completer is asked about, with the stage's parsed args. */
export interface CompletionContext {
  /** The stage's argument words, with the word under the cursor removed. */
  args: string[];
  /** The text being completed (may be ''). */
  word: string;
  /** All registered command names + aliases, sorted. */
  commands: readonly string[];
  /** The vfs + cwd, for path-aware completers (e.g. cd's dirs only). */
  vfs: Vfs;
  cwd: string;
  /** The expanded home dir (`$HOME`), for `~`-led completions. */
  home: string;
}

/** What a command run receives. `state` is shared across pipeline stages. */
export interface CommandContext {
  args: string[];
  /** Text piped in from the previous stage; null in stage one. */
  stdin: string | null;
  vfs: Vfs;
  state: ShellState;
  /**
   * True when this stage's stdout goes to the terminal (last stage, not
   * redirected) — the "is a tty" flag commands use to decide on color.
   */
  color: boolean;
  /** Every registered command, for introspection commands like `which`. */
  commands: ReadonlyMap<string, CommandSpec>;
  /** One output line (and a chunk of piped stdout). */
  out(text: string): void;
  /** One error line — errors are printed, never thrown. */
  err(text: string): void;
  /** Request a side effect (window | tui). */
  emit(action: ShellAction): void;
  /** Set the exit status; default is 1 when stderr was written, else 0. */
  exit(code: number): void;
}

export interface CommandSpec {
  name: string;
  /** Full usage string, shown by `help`, e.g. `ls [-l] [path]`. */
  usage: string;
  run(ctx: CommandContext): void;
  /**
   * Tab-completion candidates for the word at this stage's cursor.
   * Given the args so far (word removed) and the word itself; the shell
   * common-prefix-extends, and lists on a second Tab.
   */
  complete?(ctx: CompletionContext): string[];
  /**
   * Full-screen app handover (CORE-V2 §6.4, additive). When the stage's
   * stdout is a terminal (`ctx.color`) the core calls this INSTEAD of
   * `run`; return the app to spawn, or null to fall back to `run`.
   * Piped/redirected stages never see it — apps are tty-only, and `run`
   * remains the piped fallback so plugins stay usable in pipelines.
   */
  app?(ctx: CommandContext): TerminalApp | null;
}

/** One virtual file-system entry a plugin contributes. */
export interface PluginFileEntry {
  /** Absolute mount path, e.g. /demo/welcome.html. */
  path: string;
  /** Inline content (bundled / JS-object manifests). */
  content?: string;
  /** Fetched relative to the manifest URL (JSON manifests). */
  src?: string;
}

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  commands: CommandSpec[];
  files: PluginFileEntry[];
  load?: LoadDescriptor;
}

/** The JSON-manifest shape: commands arrive via the module `load.src`. */
export interface RemoteJsonManifest {
  name: string;
  version: string;
  description?: string;
  load?: LoadDescriptor;
  files?: Array<{ path: string; src?: string; content?: string }>;
}

export interface MountResult {
  ok: boolean;
  error: string | null;
  /** The mounted plugin provenance (ok only). */
  plugin?: MountedPlugin;
}

export interface LoadError {
  plugin: string;
  url: string;
  message: string;
}

export interface ExecResult {
  lines: ShellLine[];
  state: ShellState;
  /** `clear` wipes the transcript instead of appending. */
  clear: boolean;
  actions: ShellAction[];
}

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * The registry + dispatcher. One terminal owns one; the element
 * (`sem-terminal.ts`) wraps it with input/history/DOM.
 */
export class TerminalCore {
  readonly vfs = new Vfs();
  state: ShellState = {
    cwd: '/',
    env: { HOME: '/', PWD: '/', SHELL: 'semtext-sh' },
    aliases: {},
    history: [],
    oldpwd: null,
    lastStatus: 0,
  };
  readonly commands = new Map<string, CommandSpec>();
  readonly plugins: MountedPlugin[] = [];
  readonly loadErrors: LoadError[] = [];
  /** Page-supplied S3 signer (setS3Signer); used by s3 mounts for writes. */
  s3Signer: S3Signer | null = null;
  /** Mountable backend kinds, registered by optional modules (the s3 backend). */
  readonly mountKinds = new Map<string, MountKindSpec>();
  /** Async line subscribers (onLine) — backend hydration reports here. */
  #lineHandlers = new Set<(line: ShellLine) => void>();

  constructor() {
    this.#register(
      {
        name: 'help',
        usage: 'help — list commands',
        run: (ctx) => {
          ctx.out('commands:');
          for (const spec of [...this.commands.values()].sort((a, b) => a.name.localeCompare(b.name))) {
            ctx.out('  ' + spec.usage);
          }
        },
      },
      '(builtin)',
    );
    this.#register(
      {
        name: 'clear',
        usage: 'clear — wipe the transcript (also Ctrl+L)',
        run: () => {},
      },
      '(builtin)',
    );
    this.#register(
      {
        name: 'mount',
        usage: 'mount [kind …] — list storage backends, or mount one (`mount s3 <url> <mountpoint>`)',
        run: (ctx) => {
          const kind = ctx.args[0];
          if (kind === '--logout') {
            const target = ctx.args[1];
            if (!target) {
              ctx.err('mount --logout: missing mountpoint');
              return;
            }
            const mountpoint = ctx.vfs.resolve(ctx.state.cwd, target);
            const backend = ctx.vfs.mounts.get(mountpoint) ?? null;
            if (!backend || !ctx.vfs.detachBackend(mountpoint)) {
              ctx.err(`mount --logout: nothing mounted at ${mountpoint}`);
              return;
            }
            (backend as { dispose?: () => void }).dispose?.();
            ctx.out(`logged out of ${mountpoint} (temporary session dropped)`);
            return;
          }
          if (!kind) {
            ctx.out('storage backends:');
            if (ctx.vfs.mounts.size === 0) ctx.out('  (none)');
            for (const [mountpoint, backend] of ctx.vfs.mounts) {
              const describe = (backend as { describe?: () => string }).describe?.() ?? '';
              ctx.out(`  ${mountpoint}  ${backend.id}${describe}${backend.writable ? '' : ' (read-only)'}`);
            }
            const kinds = [...this.mountKinds.keys()];
            ctx.out(`mountable kinds: ${kinds.length > 0 ? kinds.join(', ') : '(none loaded)'}`);
            return;
          }
          const factory = this.mountKinds.get(kind);
          if (!factory) {
            ctx.err(`mount: unknown backend kind "${kind}"`);
            const kinds = [...this.mountKinds.keys()];
            if (kinds.length > 0) ctx.err(`mount: available kinds: ${kinds.join(', ')}`);
            return;
          }
          const backend = factory.create(ctx.args.slice(1));
          if (typeof backend === 'string') {
            ctx.err(`mount: ${backend}`);
            return;
          }
          const detachDropped = (): void => {
            this.vfs.detachBackend(backend.mountpoint);
            (backend as { dispose?: () => void }).dispose?.();
          };
          ctx.out(`${kind}: mounted at ${backend.mountpoint}${backend.writable ? '' : ' (read-only)'}`);
          const startHydrate = (): void => {
            if (typeof (backend as { hydrate?: unknown }).hydrate !== 'function') return;
            ctx.out(`${kind}: hydrating ${backend.mountpoint} ...`);
            const hydrate = (
              backend as {
                hydrate?: (
                  put: (path: string, content: string) => void,
                  report: (line: ShellLine) => void,
                ) => Promise<void>;
              }
            ).hydrate!;
            const put = (path: string, content: string): void => {
              try {
                this.vfs.mountFile(backend.mountpoint + (path.startsWith('/') ? path : `/${path}`), content);
              } catch {
                // Paths crossing the mount edge stay unseeded; hydration keeps going.
              }
            };
            hydrate
              .call(backend, put, (line) => this.emitLine(line))
              .catch((cause: unknown) => {
                this.emitLine({
                  kind: 'stderr',
                  text: `${kind}: ${backend.mountpoint}: ${cause instanceof Error ? cause.message : String(cause)}`,
                });
              });
          };
          const ensureSession = (backend as { ensureSession?: unknown }).ensureSession;
          if (typeof ensureSession === 'function') {
            // oidc: attach now, authenticate async — hydration waits for it.
            (ensureSession as (report: (line: ShellLine) => void) => Promise<boolean>)
              .call(backend, (line) => this.emitLine(line))
              .then((signedIn: boolean) => {
                if (signedIn) {
                  startHydrate();
                } else {
                  detachDropped();
                  this.emitLine({ kind: 'stderr', text: `${kind}: ${backend.mountpoint}: mount dropped (not signed in)` });
                }
              })
              .catch((cause: unknown) => {
                detachDropped();
                this.emitLine({
                  kind: 'stderr',
                  text: `${kind}: ${backend.mountpoint}: ${cause instanceof Error ? cause.message : String(cause)}`,
                });
              });
            return;
          }
          startHydrate();
        },
      },
      '(builtin)',
    );
    this.#register(
      {
        name: 'umount',
        usage: 'umount <mountpoint> — detach a storage backend',
        run: (ctx) => {
          const target = ctx.args[0];
          if (!target) {
            ctx.err('umount: missing mountpoint');
            return;
          }
          const mountpoint = ctx.vfs.resolve(ctx.state.cwd, target);
          const backend = ctx.vfs.mounts.get(mountpoint) ?? null;
          if (!backend || !ctx.vfs.detachBackend(mountpoint)) {
            ctx.err(`umount: nothing mounted at ${mountpoint}`);
            return;
          }
          (backend as { dispose?: () => void }).dispose?.();
          ctx.out(`umounted ${mountpoint}`);
        },
      },
      '(builtin)',
    );
    this.#register(
      {
        name: 'storage',
        usage: 'storage [status|reset] — storage status, or reset persisted state',
        run: (ctx) => {
          const sub = ctx.args[0] ?? 'status';
          if (sub === 'status') {
            ctx.out(`storage errors recorded: ${ctx.vfs.storageErrors.length}`);
            for (const error of ctx.vfs.storageErrors.slice(-5)) {
              ctx.out(`  ${error.op} ${error.path} (${error.backend}): ${error.message}`);
            }
            return;
          }
          if (sub === 'reset') {
            const backend = ctx.vfs.backendFor('/');
            const reset = (backend as { reset?: unknown } | null)?.reset;
            if (typeof reset !== 'function') {
              ctx.err('storage reset: no resettable backend mounted at /');
              return;
            }
            ctx.out((reset as (vfs: Vfs) => string).call(backend, ctx.vfs));
            return;
          }
          ctx.err(`storage: unknown subcommand "${sub}" (want status|reset)`);
        },
      },
      '(builtin)',
    );
  }

  /** Register one command; refuses duplicates and malformed names. */
  #register(spec: CommandSpec, plugin: string): void {
    if (!NAME_PATTERN.test(spec.name)) {
      throw new Error(`invalid command name "${spec.name}" [${plugin}]`);
    }
    if (this.commands.has(spec.name)) {
      throw new Error(`command "${spec.name}" already registered [${plugin}]`);
    }
    if (typeof spec.run !== 'function') {
      throw new Error(`command "${spec.name}" has no run function [${plugin}]`);
    }
    this.commands.set(spec.name, spec);
  }

  hasCommand(name: string): boolean {
    return this.commands.has(name);
  }

  /** Supply the S3 request signer used by `mount s3` (page-side API). */
  setS3Signer(signer: S3Signer): void {
    this.s3Signer = signer;
  }

  /** Subscribe to async lines (hydration, storage warnings) → unsubscribe. */
  onLine(handler: (line: ShellLine) => void): () => void {
    this.#lineHandlers.add(handler);
    return () => this.#lineHandlers.delete(handler);
  }

  /** Emit one async line — storage backends report progress through this. */
  emitLine(line: ShellLine): void {
    for (const handler of [...this.#lineHandlers]) handler(line);
  }

  /** Every registered command name + alias name, sorted, unique. */
  commandNames(): string[] {
    const names = new Set<string>([...this.commands.keys(), ...Object.keys(this.state.aliases)]);
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  /** Spec for one command word (aliases resolve first), for completion. */
  commandSpec(name: string): CommandSpec | undefined {
    const direct = this.commands.get(name);
    if (direct) return direct;
    const expanded = this.#expandAliases([name])[0] ?? name;
    return this.commands.get(expanded);
  }

  /**
   * Mount a JS-object manifest: all commands are checked before any is
   * registered, then files mount (last write wins). All-or-nothing per
   * plugin — a failed mount changes nothing.
   */
  mountPlugin(manifest: PluginManifest): MountResult {
    const label = manifest?.name ?? '(unnamed)';
    try {
      if (typeof manifest?.name !== 'string' || manifest.name === '') {
        throw new Error('plugin manifest needs a name');
      }
      if (typeof manifest.version !== 'string' || manifest.version === '') {
        throw new Error(`plugin manifest ${label} needs a version`);
      }
      const commands = manifest.commands ?? [];
      const seen = new Set<string>();
      for (const spec of commands) {
        if (!NAME_PATTERN.test(spec.name)) {
          throw new Error(`invalid command name "${spec.name}" [${label}]`);
        }
        if (typeof spec.run !== 'function') {
          throw new Error(`command "${spec.name}" has no run function [${label}]`);
        }
        if (this.commands.has(spec.name) || seen.has(spec.name)) {
          throw new Error(`command "${spec.name}" already registered [${label}]`);
        }
        seen.add(spec.name);
      }
      for (const entry of manifest.files ?? []) {
        if (typeof entry?.content !== 'string') {
          throw new Error(`file ${entry?.path} has no inline content (src loads only from a manifest URL)`);
        }
        this.vfs.mountFile(entry.path, entry.content);
      }
      for (const spec of commands) this.#register(spec, label);
      const plugin: MountedPlugin = { name: manifest.name, version: manifest.version };
      this.plugins.push(plugin);
      return { ok: true, error: null, plugin };
    } catch (cause) {
      return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  /**
   * Fetch + mount one manifest URL. Manifest URL rules: absolute https
   * needs an integrity fragment and is refused (pre-fetch) without one;
   * relative/same-origin loads freely. Failures print nothing here — they
   * are recorded (this.loadErrors) and returned so the caller decides how
   * to surface them; one plugin failing never stops the others.
   */
  async loadPluginFromUrl(url: string): Promise<MountResult> {
    const { base, integrity } = splitIntegrityFragment(url);
    try {
      checkSourceAllowed({ src: base, integrity }, 'manifest');
      if (integrity !== null && !isIntegrityFormat(integrity)) {
        throw new PluginRefusedError(`bad integrity format in ${url} (want sha256-<64 hex>)`);
      }
      const text = await fetchText(base);
      if (integrity !== null && !(await verifyIntegrity(text, integrity))) {
        throw new PluginRefusedError(`refused: integrity mismatch for manifest ${base}`);
      }
      const json = JSON.parse(text) as RemoteJsonManifest;
      const name = typeof json?.name === 'string' ? json.name : '(unnamed)';
      const mounted = await this.#mountRemote(json, base, name, url);
      return { ok: true, error: null, plugin: mounted };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      this.loadErrors.push({ plugin: '(unknown)', url, message });
      return { ok: false, error: message };
    }
  }

  /** Files resolve inline or relative to the manifest; commands via load.src. */
  async #mountRemote(json: RemoteJsonManifest, baseUrl: string, name: string, url: string): Promise<MountedPlugin> {
    checkSourceAllowed(json.load, `manifest ${name}`);
    const commands = (json.load?.src ? await importCommandsModule(json.load, baseUrl) : []) as CommandSpec[];
    const files: PluginFileEntry[] = [];
    for (const entry of json.files ?? []) {
      files.push({ path: entry.path, content: entry.content ?? (await fetchText(new URL(entry.src ?? '', baseUrl).toString())) });
    }
    const result = this.mountPlugin({ name, version: json.version, description: json.description, commands, files });
    if (!result.ok) throw new Error(result.error ?? 'mount failed');
    return result.plugin!;
  }

  /**
   * Alias expansion: the first word of a stage may name an alias, whose
   * (space-split) value becomes the stage's leading words. An alias never
   * re-expands itself, and the chain stops after five hops.
   */
  #expandAliases(argv: string[]): string[] {
    let words = argv;
    const seen = new Set<string>();
    for (let hop = 0; hop < 5; hop++) {
      const alias = this.state.aliases[words[0]];
      if (alias === undefined || seen.has(words[0])) break;
      seen.add(words[0]);
      const leading = alias.split(/\s+/).filter((w) => w !== '');
      if (leading.length === 0) break;
      words = [...leading, ...words.slice(1)];
    }
    return words;
  }

  /**
   * Run one input line — `cmd args | cmd args > file` pipelines included.
   * The first line is always the echo of what was typed; parse errors,
   * unknown commands and failing commands come back as stderr lines; every
   * executed command appends a `status` line with its exit status; actions
   * accumulate for the element to perform. Never throws.
   */
  execLine(input: string): ExecResult {
    const lines: ShellLine[] = [{ kind: 'cmd', text: `${this.state.cwd} $ ${input}` }];
    const result: ExecResult = { lines, state: this.state, clear: false, actions: [] };
    if (input.trim() !== '') this.state.history.push(input);
    const parsed = parseCommandLine(input, this.state, this.vfs);
    if (!parsed.ok) {
      lines.push({ kind: 'stderr', text: `sh: ${parsed.error}` });
      this.state.lastStatus = 2;
      lines.push({ kind: 'status', text: `exit ${this.state.lastStatus}` });
      return result;
    }
    let ran = false;
    let spawnedApp = false;
    let stdin: string | null = null;
    for (let i = 0; i < parsed.stages.length; i++) {
      const stage = parsed.stages[i];
      const argv = this.#expandAliases(stage.argv);
      const redirect = stage.redirect;
      if (argv.length === 0 && !redirect) continue; // empty stage: stdin passes through
      if (argv[0] === 'clear') {
        result.clear = true;
        continue;
      }
      ran = true;
      let stdout = '';
      const isTty = i === parsed.stages.length - 1 && redirect === null;
      let explicitStatus: number | null = null;
      let stderrLines = 0;
      const ctx: CommandContext = {
        args: argv.slice(1),
        stdin,
        vfs: this.vfs,
        state: this.state,
        color: isTty,
        commands: this.commands,
        out: (text) => {
          stdout += text + '\n';
          if (isTty) lines.push({ kind: 'stdout', text }); // piped/redirected stages stay off the transcript
        },
        err: (text) => {
          stderrLines++;
          lines.push({ kind: 'stderr', text });
        },
        emit: (action) => result.actions.push(action),
        exit: (code) => {
          explicitStatus = code;
        },
      };
      if (argv.length === 0) {
        // `> file` with no command: truncate or create, like sh.
        stdout = '';
      } else {
        const spec = this.commands.get(argv[0]);
        if (!spec) {
          lines.push({ kind: 'stderr', text: `sh: command not found: ${argv[0]}` });
          this.state.lastStatus = 127;
          continue;
        }
        try {
          // Full-screen app handover (CORE-V2 §6.4): tty-only, additive —
          // app may decline (null) or the stage may be piped (no ctx.color),
          // in which case `run` remains the fallback path.
          const spawned = isTty ? spec.app?.(ctx) ?? null : null;
          if (spawned !== null) {
            result.actions.push({ kind: 'app', app: spawned });
            spawnedApp = true;
            explicitStatus = 0; // the app reports its own exit status (§6.2)
          } else {
            spec.run(ctx);
          }
        } catch (cause) {
          stderrLines++;
          lines.push({ kind: 'stderr', text: `${argv[0]}: ${cause instanceof Error ? cause.message : String(cause)}` });
        }
      }
      if (redirect !== null) {
        const targetPath = this.vfs.resolve(this.state.cwd, redirect.target);
        try {
          const previous = redirect.mode === '>>' ? (this.vfs.read(targetPath) ?? '') : '';
          this.vfs.mountFile(targetPath, previous + stdout);
        } catch (cause) {
          stderrLines++;
          lines.push({ kind: 'stderr', text: `sh: ${redirect.target}: ${cause instanceof Error ? cause.message : String(cause)}` });
        }
      }
      this.state.lastStatus = explicitStatus ?? (stderrLines > 0 ? 1 : 0);
      stdin = stdout;
    }
    // An app launch prints no `exit N` — the runner adds it when the app
    // exits, with the app's own status (§6.2).
    if (ran && !result.clear && !spawnedApp) lines.push({ kind: 'status', text: `exit ${this.state.lastStatus}` });
    this.state.env.PWD = this.state.cwd;
    return result;
  }
}

/** Node-type helpers re-exported for plugin authors' convenience. */
export type { VfsNode };
