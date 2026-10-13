/**
 * complete — the pure Tab-completion engine for the shell.
 *
 * Input: the current input line and the core. Output: one of
 *   { kind: 'none' }                          — nothing to add
 *   { kind: 'extend', line }                  — replace input with `line`
 *   { kind: 'list', line, candidates }        — extended + candidates to show
 *
 * The first word of a stage (after an unquoted `|`) completes against
 * command names + aliases; every later word (and any word after an
 * unquoted `>`) completes against VFS paths — relative, absolute, or
 * `~`-led, with directories getting a trailing `/` and completed files a
 * trailing space. Candidates with spaces/quotes get single-quoted when
 * the typed word was unquoted. A second Tab (the element decides) lists
 * the candidates; the engine returns them all, capped display lives in
 * the element. No DOM here — unit-tests in plain Node.
 */

import type { CompletionContext, TerminalCore } from './terminal-core.js';
import type { Vfs } from './vfs.js';
import { resolvePath } from './vfs.js';

export type Completion =
  | { kind: 'none' }
  | { kind: 'extend'; line: string }
  | { kind: 'list'; line: string; candidates: string[] };

/** Characters that force quoting when they appear in a candidate. */
const NEEDS_QUOTES = /[\s'"*?[\]{}()<>|&;$#\\]/;

/** Single-quote a candidate for the shell grammar ('' for an embedded '). */
function shellQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/**
 * One whitespace-separated word of the input line, with quote state.
 * `quote` is the quote character the word opened with ('' or "), or null.
 */
interface RawWord {
  /** Raw text as typed, quotes included. */
  text: string;
  /** The word's text with quotes stripped (incomplete pairs tolerated). */
  value: string;
  /** The quote character opening this word, when it stays open. */
  quote: string | null;
  /** Index of the word's first character in the line. */
  start: number;
}

/** Split a line into words, honoring ' and " loosely (completer-grade). */
function splitWords(line: string): RawWord[] {
  const words: RawWord[] = [];
  let current: RawWord | null = null;
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      } else if (current) {
        current.value += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      if (!current) {
        current = { text: char, value: '', quote: char, start: i };
        words.push(current);
      } else {
        current.text += char;
        current.quote = char;
      }
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        current.quote = null;
        current = null;
      }
      continue;
    }
    if (!current) {
      current = { text: char, value: char, quote: null, start: i };
      words.push(current);
    } else {
      current.text += char;
      current.value += char;
    }
  }
  return words;
}

/** Index of the last unquoted separator (`|` or `>`) in the line, or -1. */
function lastSeparator(line: string): number {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '|' || char === '>') return i;
  }
  return -1;
}

/** Longest common prefix of the candidates (byte-wise). */
export function longestCommonPrefix(values: string[]): string {
  if (values.length === 0) return '';
  let prefix = values[0];
  for (const value of values) {
    while (!value.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (prefix === '') return '';
    }
  }
  return prefix;
}

/**
 * Candidate names of the entries of `dir` matching `prefix`. Directories
 * come back with a trailing `/`. Absolute `dir` expected (pre-resolved).
 */
function pathCandidates(vfs: Vfs, dir: string, prefix: string): string[] {
  const entries = vfs.list(dir);
  const names: string[] = [];
  for (const node of entries) {
    if (!node.name.startsWith(prefix)) continue;
    names.push(node.kind === 'dir' ? `${node.name}/` : node.name);
  }
  names.sort((a, b) => a.localeCompare(b));
  return names;
}

/**
 * Complete `input` against the core. Pure: reads the vfs and the command
 * registry, mutates nothing.
 */
export function completeLine(input: string, core: TerminalCore): Completion {
  const words = splitWords(input);
  if (words.length === 0) return { kind: 'none' };
  const last = words[words.length - 1];
  const lineEndsWithSpace = /\s$/.test(input);
  const inFlight: RawWord | null = lineEndsWithSpace ? null : last;

  // Which word of which stage is under the cursor?
  const separator = lastSeparator(input);
  const stageText = input.slice(separator + 1);
  const stageWords = splitWords(stageText);
  const stageInFlight = lineEndsWithSpace ? null : stageWords[stageWords.length - 1] ?? null;
  const isCommandPosition =
    (stageInFlight !== null && stageWords[0] === stageInFlight && stageWords.length === 1) ||
    (lineEndsWithSpace && stageWords.length === 0);
  const afterRedirect = separator >= 0 && input[separator] === '>';
  // A trailing space means the previous word is done: `cd ` and
  // `semtext render ` both complete their FIRST argument position, so the
  // command's completer still gets the call (args typed so far, word '').
  const firstArgPosition = lineEndsWithSpace ? stageWords.length >= 1 : stageWords.length > 1;

  let candidates: string[] = [];
  let word = '';
  if (!afterRedirect && isCommandPosition) {
    word = stageInFlight?.value ?? '';
    const names = core.commandNames();
    candidates = names.filter((name) => name.startsWith(word));
  } else if (!afterRedirect && firstArgPosition) {
    // A command's own completer gets first crack at the word.
    word = stageInFlight?.value ?? '';
    const commandWord = stageWords[0].value;
    const spec = core.commandSpec(commandWord);
    const argsBefore = (lineEndsWithSpace ? stageWords.slice(1) : stageWords.slice(1, -1)).map((w) => w.value);
    if (spec?.complete) {
      candidates = spec.complete({
        args: argsBefore,
        word,
        commands: core.commandNames(),
        vfs: core.vfs,
        cwd: core.state.cwd,
        home: core.state.env.HOME ?? '/',
      });
      candidates = candidates.filter((candidate) => candidate.startsWith(word));
    } else {
      candidates = pathCandidatesFor(core, argsBefore, word, input);
    }
  } else {
    word = inFlight?.value ?? '';
    candidates = pathCandidatesFor(core, [], word, input);
  }

  if (candidates.length === 0) return { kind: 'none' };

  // Present candidates: quote when the typed word is unquoted.
  const typed = inFlight?.text ?? '';
  const quoted = typed.startsWith("'") || typed.startsWith('"');
  const display = candidates.map((candidate) => (quoted ? candidate : NEEDS_QUOTES.test(candidate) ? shellQuote(candidate) : candidate));

  // Extend by the longest common prefix of the presented forms.
  const common = longestCommonPrefix(display);
  let replacement = quoted ? typed.slice(0, 1) + common : common;
  if (quoted && candidates.length === 1 && common !== '' && !common.endsWith("'")) {
    replacement += "'"; // a fully completed quoted word closes its quote
  }
  let trailing = '';
  if (candidates.length === 1) {
    if (replacement.endsWith('/')) {
      trailing = '';
    } else {
      trailing = ' ';
    }
  }
  const head = inFlight ? input.slice(0, inFlight.start) : input;
  const line = head + replacement + trailing;
  if (line === input) {
    return candidates.length > 1 ? { kind: 'list', line: input, candidates: display } : { kind: 'none' };
  }
  return candidates.length > 1 ? { kind: 'list', line, candidates: display } : { kind: 'extend', line };
}

/** Resolve the path word against cwd (with `~`) and list matching entries. */
function pathCandidatesFor(core: TerminalCore, _args: string[], word: string, _input: string): string[] {
  const state = core.state;
  let expanded = word;
  if (expanded.startsWith('~')) {
    const home = state.env['HOME'] ?? '/';
    expanded = home + expanded.slice(1);
  }
  // A trailing slash names a directory outright: strip it before resolving
  // so `cat docs/` lists docs instead of hunting entries named `docs`.
  const trailingSlash = expanded.endsWith('/') && expanded !== '/';
  const absolute = resolvePath(state.cwd, trailingSlash ? expanded.slice(0, -1) : expanded);
  const slash = absolute.lastIndexOf('/');
  const dir = trailingSlash ? absolute : slash <= 0 ? '/' : absolute.slice(0, slash);
  const prefix = trailingSlash ? '' : slash < 0 ? absolute : absolute.slice(slash + 1);
  const absoluteDir = dir === '' ? '/' : dir;
  return pathCandidates(core.vfs, absoluteDir, prefix).map((candidate) => {
    // Prefix back whatever of the typed path wasn't absolute.
    const typedDir = expanded.slice(0, expanded.lastIndexOf('/') + 1);
    if (typedDir === '' && state.cwd !== '/') return candidate;
    if (expanded.startsWith('/')) return typedDir + candidate;
    if (typedDir === '') return candidate;
    return typedDir + candidate;
  });
}

/**
 * Path completion for a completer hook: the same relative/absolute/~
 * listing the engine's default path machinery gives, offered to plugins
 * that override the hook but still want paths afterwards (e.g. semtext
 * completes subcommands for arg 0, then paths for the file operand).
 */
export function completePaths(ctx: CompletionContext): string[] {
  let expanded = ctx.word;
  if (expanded.startsWith('~')) expanded = ctx.home + expanded.slice(1);
  // A trailing slash names a directory outright: strip it before resolving
  // so `semtext render docs/` lists docs instead of hunting entries named docs.
  const trailingSlash = expanded.endsWith('/') && expanded !== '/';
  const absolute = resolvePath(ctx.cwd, trailingSlash ? expanded.slice(0, -1) : expanded);
  const slash = absolute.lastIndexOf('/');
  const dir = trailingSlash ? absolute : slash <= 0 ? '/' : absolute.slice(0, slash);
  const prefix = trailingSlash ? '' : slash < 0 ? absolute : absolute.slice(slash + 1);
  const absoluteDir = dir === '' ? '/' : dir;
  return pathCandidates(ctx.vfs, absoluteDir, prefix).map((candidate) => {
    const typedDir = expanded.slice(0, expanded.lastIndexOf('/') + 1);
    if (typedDir === '' && ctx.cwd !== '/') return candidate;
    if (expanded.startsWith('/')) return typedDir + candidate;
    if (typedDir === '') return candidate;
    return typedDir + candidate;
  });
}
