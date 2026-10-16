/**
 * demo-format — the line-based demo-script format for <sem-shell> start
 * scripts (src/terminal/script/README.md has the full grammar).
 *
 * A JS port of tabbing-on's demo-runner format (Projects/tabbing-on,
 * shell-impl/bin/demo-runner), reduced to what a web terminal can do and
 * extended with `@expect`. One directive per line:
 *
 *   # text      a heading — printed instantly as a comment
 *   ## text     a description — printed instantly as a comment
 *   $ command   typed char by char, then executed (a pause follows)
 *   @type text  typed char by char, not executed (input or the open TUI)
 *   @input text alias of @type (tabbing-on compatibility)
 *   @key TOKEN  key sends: `<Down>` `<Esc>` `<PgUp>` `<Enter>` …, or bare
 *               characters (`@key q`; `@key :q` — a char sequence)
 *   @sleep N.N  pause N.N seconds
 *   @expect s   assert the transcript contains s; a miss prints + halts
 *   @prompt [s] tabbing-on waited for Enter on a tty; a web demo cannot
 *               block, so this prints s (default phrasing) and pauses
 *   @clear      tabbing-on cleared the tty; the web shell has no clear
 *               command yet, so this is a documented no-op
 *
 * Parsing is line-based and lenient: an unknown directive becomes a comment
 * step (never a throw) so one bad line cannot take down a landing page.
 * JSON arrays — the `script` attribute's format — stay valid through
 * resolveScriptValue, so existing pages keep working unchanged.
 */

import { parseScriptAttribute } from '../playback.js';
import { landingScript } from './landing-scripts.js';

export type DemoStep =
  | { type: 'type'; text: string; delayMs?: number }
  | { type: 'key'; key: string }
  | { type: 'wait'; ms?: number }
  | { type: 'run' }
  | { type: 'comment'; text: string }
  | { type: 'expect'; text: string };

export const DEFAULT_TYPE_MS = 45;
export const DEFAULT_WAIT_MS = 400;
export const DEFAULT_PAUSE_MS = 900;

/** Bracketed key tokens and their KeyboardEvent `key` values. */
const KEY_NAMES: Record<string, string> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  esc: 'Escape',
  escape: 'Escape',
  enter: 'Enter',
  cr: 'Enter',
  return: 'Enter',
  space: ' ',
  tab: 'Tab',
  bs: 'Backspace',
  bspace: 'Backspace',
  del: 'Delete',
  home: 'Home',
  end: 'End',
  pgup: 'PageUp',
  pgdn: 'PageDown',
  pageup: 'PageUp',
  pagedown: 'PageDown',
};

/** One @key token → the key presses it stands for (a char sequence splits). */
export function keyPresses(token: string): string[] {
  const bracket = token.match(/^<(.+)>$/);
  if (bracket) {
    const name = (bracket[1] ?? '').toLowerCase();
    return [KEY_NAMES[name] ?? (bracket[1] as string)];
  }
  // A bare multi-character token (`:q`, `dd`) is a sequence of plain keys.
  return Array.from(token);
}

/** Parse a demo script's line format into steps. Blank → null (no script). */
export function parseDemoScript(source: string | null | undefined): DemoStep[] | null {
  if (source == null || source.trim() === '') return null;
  const steps: DemoStep[] = [];
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('#')) {
      steps.push({ type: 'comment', text: line.replace(/^#+\s*/, '') });
      continue;
    }
    if (line.startsWith('$ ')) {
      steps.push({ type: 'type', text: line.slice(2) });
      steps.push({ type: 'run' });
      steps.push({ type: 'wait' }); // the inter-command pause; runner sizes it
      continue;
    }
    if (line.startsWith('@')) {
      const space = line.indexOf(' ');
      const name = space === -1 ? line : line.slice(0, space);
      const rest = space === -1 ? '' : line.slice(space + 1).trim();
      if (name === '@type' || name === '@input') {
        if (rest !== '') steps.push({ type: 'type', text: rest });
        continue;
      }
      if (name === '@key') {
        for (const key of keyPresses(rest)) steps.push({ type: 'key', key });
        continue;
      }
      if (name === '@sleep') {
        const seconds = Number.parseFloat(rest);
        steps.push({ type: 'wait', ms: Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : DEFAULT_WAIT_MS });
        continue;
      }
      if (name === '@expect') {
        if (rest !== '') steps.push({ type: 'expect', text: rest });
        continue;
      }
      if (name === '@prompt') {
        steps.push({ type: 'comment', text: rest === '' ? 'Paused — this is where a live demo waits for you.' : rest });
        steps.push({ type: 'wait' });
        continue;
      }
      if (name === '@clear') continue; // no clear command on the web shell yet
      steps.push({ type: 'comment', text: `demo-script: unknown directive ${name} — skipped` });
      continue;
    }
    steps.push({ type: 'comment', text: line });
  }
  return steps.length === 0 ? null : steps;
}

/**
 * Resolve a start-script attribute value to demo steps: a named demo from
 * landing-scripts.ts, the `script` attribute's JSON (back-compat), or an
 * inline demo-format script. Blank or unparseable -> null (nothing plays).
 */
export function resolveScriptValue(value: string | null | undefined): DemoStep[] | null {
  const text = value?.trim();
  if (text == null || text === '') return null;
  if (text.startsWith('[')) {
    const json = parseScriptAttribute(value);
    if (json === null) return null;
    const known = new Set(['type', 'key', 'wait', 'run', 'comment']);
    return json.filter((step) => known.has((step as { type: string }).type)) as DemoStep[];
  }
  return parseDemoScript(landingScript(text) ?? text);
}

/**
 * Does this start-script value name a FETCHABLE script file rather than an
 * inline script? A single-line path — absolute site path, relative path, or
 * any `.txt`/`.demo` filename — must be fetched and its BODY parsed as
 * demo-format. Before the r2.1 fix such values silently parsed as a
 * one-comment inline script, so the landing's `start-script="/demo/…"`
 * shells never typed anything.
 */
export function looksLikeScriptPath(value: string): boolean {
  const text = value.trim();
  if (text === '' || text.includes('\n')) return false;
  if (/^\.{0,2}\//.test(text)) return true; // /demo/…  ./…  ../…
  return /\.(txt|demo)$/i.test(text);
}
