/**
 * apps/nano — the `nano` CommandSpec (CORE-V2 §6.4, round-3 LANE=nano).
 *
 * This module is the BASE-BUNDLE stub: spec fields, the tty/decline
 * validation (worded exactly as run() reports it), file completion, and
 * LazyNano — a thin App shell that dynamically imports the real editor
 * (./nano-app.js) on first `nano` invocation and delegates every app
 * surface to it. The editor body is the payload of the lazy chunk; the
 * base shell carries only this stub. Under today's single-entry IIFE
 * build the dynamic import is inlined (no regression); when the build
 * emits nano-app.js as its own chunk the boundary is already correct —
 * keys arriving before the import resolves are buffered, not dropped.
 *
 * `CommandSpec.app` is synchronous by contract, so the claim/decline
 * decision (operands, directory, options) lives here; the chunk exports
 * the editor plus the same decision re-used by tests.
 */

import type { App, AppContext, KeyEvent, MouseEvent } from '../../screen/types.js';
import type { CommandContext, CommandSpec, CompletionContext } from '../../terminal-core.js';
import { resolvePath } from '../../vfs.js';
import type { NanoEditor, NanoIo, NanoOptions } from './nano-app.js';

/** File + directory completion for the single operand (cd's shape, files too). */
function completePaths(ctx: CompletionContext): string[] {
  const slash = ctx.word.lastIndexOf('/');
  const dirPart = slash === -1 ? '' : ctx.word.slice(0, slash + 1);
  const rest = slash === -1 ? ctx.word : ctx.word.slice(slash + 1);
  const expanded = dirPart.startsWith('~') ? ctx.home + dirPart.slice(1) : dirPart;
  const base = resolvePath(ctx.cwd, expanded === '' ? '.' : expanded);
  const out: string[] = [];
  for (const node of ctx.vfs.list(base)) {
    if (!node.name.startsWith(rest)) continue;
    out.push(dirPart + node.name + (node.kind === 'dir' ? '/' : ''));
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/** The exact wording run() reports; app() declines on the same paths. */
function validate(ctx: CommandContext): { error: string; code: number } | null {
  const option = ctx.args.find((a) => a.startsWith('-') && a !== '-');
  if (option !== undefined) return { error: `nano: unrecognized option '${option}'`, code: 2 };
  const operands = ctx.args.filter((a) => !a.startsWith('-') || a === '-');
  if (operands.length > 1) return { error: 'nano: opening more than one file at a time is not supported', code: 1 };
  if (operands.length === 1) {
    const path = ctx.vfs.resolve(ctx.state.cwd, operands[0]!);
    const node = ctx.vfs.nodeAt(path);
    if (node !== null && node.kind === 'dir') return { error: `nano: ${operands[0]}: Is a directory`, code: 1 };
  }
  return null;
}

/** Buffer decision shared by the stub (sync) and the chunk (tests). */
function nanoOptions(ctx: CommandContext): NanoOptions {
  const io: NanoIo = {
    write: (path, text) => {
      try {
        ctx.vfs.mountFile(path, text);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    resolve: (name) => ctx.vfs.resolve(ctx.state.cwd, name),
  };
  const operands = ctx.args.filter((a) => !a.startsWith('-') || a === '-');
  if (operands.length === 1) {
    const path = ctx.vfs.resolve(ctx.state.cwd, operands[0]!);
    const node = ctx.vfs.nodeAt(path);
    const backend = ctx.vfs.backendFor(path);
    const file = node !== null && node.kind === 'file' ? node : null;
    return { path, content: file?.content ?? '', readonly: backend !== null && !backend.writable, io };
  }
  // No operand: piped stdin becomes the buffer, else a fresh untitled one.
  return { path: null, content: ctx.stdin ?? '', readonly: false, io };
}

/**
 * The lazy hand-off: spawn now, load the editor chunk, replay what the
 * user typed in the meantime. An import failure exits 1 through the
 * runner (the crash line prints; the shell is never left in raw mode).
 */
class LazyNano implements App {
  readonly id = 'nano';

  #inner: Promise<NanoEditor | null>;
  #editor: NanoEditor | null = null;
  #stopped = false;
  #keys: KeyEvent[] = [];
  #mouse: MouseEvent[] = [];
  #pastes: string[] = [];

  constructor(options: NanoOptions) {
    this.#inner = import('./nano-app.js').then(
      (mod) => new mod.NanoEditor(options),
      () => null,
    );
  }

  start(api: AppContext): void {
    void this.#inner.then((editor) => {
      if (this.#stopped) return;
      if (editor === null) {
        api.setStatus('nano: editor chunk failed to load', 'alert');
        api.exit(1);
        return;
      }
      this.#editor = editor;
      editor.start(api);
      for (const ev of this.#keys) editor.key(ev);
      for (const ev of this.#mouse) editor.mouse?.(ev);
      for (const text of this.#pastes) editor.paste?.(text);
      this.#keys = [];
      this.#mouse = [];
      this.#pastes = [];
    });
  }

  key(ev: KeyEvent): void {
    if (this.#editor !== null) this.#editor.key(ev);
    else this.#keys.push(ev);
  }

  resize(cols: number, rows: number): void {
    this.#editor?.resize?.(cols, rows);
  }

  paste(text: string): void {
    if (this.#editor !== null) this.#editor.paste?.(text);
    else this.#pastes.push(text);
  }

  mouse(ev: MouseEvent): void {
    if (this.#editor !== null) this.#editor.mouse?.(ev);
    else this.#mouse.push(ev);
  }

  stop(): void {
    this.#stopped = true;
    this.#editor?.stop();
  }

  a11ySummary(): string {
    return this.#editor?.a11ySummary?.() ?? 'nano: loading';
  }

  find(): void {
    this.#editor?.find?.();
  }
}

export const nanoCommand: CommandSpec = {
  name: 'nano',
  usage: 'nano [file] — edit a file in a full-screen buffer',
  complete: completePaths,
  app: (ctx) => {
    if (!ctx.color || validate(ctx) !== null) return null; // run() reports it
    return new LazyNano(nanoOptions(ctx));
  },
  run(ctx) {
    const invalid = validate(ctx);
    if (invalid !== null) {
      ctx.err(invalid.error);
      ctx.exit(invalid.code);
      return;
    }
    // A terminal is required; the app hook owns the tty case.
    ctx.err('nano: standard input is not a terminal');
    ctx.exit(1);
  },
};
