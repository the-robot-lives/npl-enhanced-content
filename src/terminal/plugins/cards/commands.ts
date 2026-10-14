/**
 * cards plugin — the render-card command.
 *
 * `render-card <file.card>` reads a .card file (the YAML subset parsed by
 * cardfile.ts) and prints it through a frame theme (themes.ts). Flags:
 * `--theme <id>` and `--width <n>` override the card header, `--list-themes`
 * lists the theme registry, `-` takes the piped stdin as the card. Color
 * follows the shell's tty flag (ctx.color): the title's SGR-4 underline is
 * a terminal-only affordance; pipes and redirects stay plain. The man page
 * (renderCardMan) is exported for the posix plugin's `man` table — this
 * command owns its text; `render-card --help` prints the same lines.
 */

import type { CommandContext, CommandSpec, CompletionContext } from '../../terminal-core.js';
import { CardFileError, parseCardFile } from './cardfile.js';
import { CARD_THEMES, renderCardLines, themeIds } from './themes.js';

export const RENDER_CARD_USAGE = 'render-card <file.card>... [-] [--theme <id>] [--width <n>] [--list-themes]';

/** The man page, also printed by --help. Wired into posix MAN by cross-lane request. */
export const renderCardMan: string[] = [
  'render-card — print a framed card from a .card file',
  '',
  'SYNOPSIS',
  `  ${RENDER_CARD_USAGE}`,
  '',
  'DESCRIPTION',
  '  Reads each .card file (a small YAML header: name, title,',
  '  description, theme, optional width) and prints it as a framed,',
  '  wrapped card. `--theme <id>` and `--width <n>` override the',
  '  header (width is clamped to 24..120 columns). `-` reads the',
  '  piped stdin as the card. The title underlines (SGR 4) on a tty;',
  '  piped or redirected output stays plain.',
  '',
  'THEMES',
  ...themeIds().map((id) => `  ${id}`),
];

function isDirectory(ctx: CommandContext, file: string): boolean {
  const node = ctx.vfs.nodeAt(ctx.vfs.resolve(ctx.state.cwd, file));
  return node?.kind === 'dir';
}

const renderCard: CommandSpec = {
  name: 'render-card',
  usage: RENDER_CARD_USAGE,
  complete(ctx: CompletionContext): string[] {
    const prev = ctx.args[ctx.args.length - 1];
    if (prev === '--theme') return themeIds().filter((id) => id.startsWith(ctx.word));
    if (prev === '--width' || prev === '--list-themes') return [];
    const slash = ctx.word.lastIndexOf('/');
    const dirPart = slash === -1 ? '' : ctx.word.slice(0, slash + 1);
    const rest = slash === -1 ? ctx.word : ctx.word.slice(slash + 1);
    const base = ctx.vfs.resolve(ctx.cwd, dirPart === '' ? '.' : dirPart);
    const found: string[] = [];
    for (const node of ctx.vfs.list(base)) {
      if (!node.name.startsWith(rest)) continue;
      found.push(dirPart + node.name + (node.kind === 'dir' ? '/' : ''));
    }
    return found.sort((a, b) => a.localeCompare(b));
  },
  run(ctx: CommandContext): void {
    let theme: string | null = null;
    let width: number | null = null;
    let listThemes = false;
    const files: string[] = [];
    for (let i = 0; i < ctx.args.length; i++) {
      const arg = ctx.args[i]!;
      if (arg === '--help' || arg === '-h') {
        for (const line of renderCardMan) ctx.out(line);
        return;
      }
      if (arg === '--list-themes') {
        listThemes = true;
        continue;
      }
      if (arg === '--theme') {
        theme = ctx.args[++i] ?? null;
        continue;
      }
      if (arg === '--width') {
        const parsed = Number.parseInt(ctx.args[++i] ?? '', 10);
        width = Number.isFinite(parsed) ? parsed : null;
        continue;
      }
      files.push(arg);
    }
    if (listThemes) {
      for (const item of CARD_THEMES) ctx.out(`  ${item.id.padEnd(8)} ${item.label}`);
      return;
    }
    if (files.length === 0 && ctx.stdin !== null) files.push('-');
    if (files.length === 0) {
      ctx.err('render-card: missing file operand (try render-card --help)');
      ctx.exit(2);
      return;
    }
    let failed = false;
    let first = true;
    for (const file of files) {
      if (!first) ctx.out(''); // one blank line between cards
      first = false;
      let source: string | null;
      let label: string;
      if (file === '-') {
        if (ctx.stdin === null) {
          ctx.err('render-card: `-` needs piped input (cat x.card | render-card -)');
          failed = true;
          continue;
        }
        source = ctx.stdin;
        label = '(stdin)';
      } else {
        const path = ctx.vfs.resolve(ctx.state.cwd, file);
        const node = ctx.vfs.nodeAt(path);
        if (!node) {
          ctx.err(`render-card: ${file}: no such file or directory`);
          failed = true;
          continue;
        }
        if (node.kind !== 'file') {
          ctx.err(`render-card: ${file}: is a directory`);
          failed = true;
          continue;
        }
        source = ctx.vfs.read(path);
        label = file;
      }
      try {
        const card = parseCardFile(source ?? '', { label });
        for (const line of renderCardLines(card, { width: width ?? undefined, theme: theme ?? undefined, color: ctx.color })) {
          ctx.out(line);
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        ctx.err(`render-card: ${label}: ${message}${cause instanceof CardFileError ? ` (line ${cause.line})` : ''}`);
        failed = true;
      }
    }
    if (failed) ctx.exit(1);
  },
};

export const cardCommands: CommandSpec[] = [renderCard];
export default cardCommands;
