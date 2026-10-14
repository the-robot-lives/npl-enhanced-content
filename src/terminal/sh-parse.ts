/**
 * sh-parse — the shell line parser: quoting, expansion, pipes, redirects,
 * globs (src/terminal/PLUGINS.md § shell grammar).
 *
 * One input line becomes pipeline stages. Per stage: `argv` (expanded
 * words) and an optional stdout `redirect` (`>` truncate, `>>` append).
 * Expansion happens at parse time, exactly once, left to right:
 *
 *   '…'   literal — nothing inside is touched
 *   "…"   $VAR / ${VAR} / $? expand; backslash escapes only \$ \` \" \\
 *   \     outside quotes escapes the next character
 *   ~     leading `~` or `~/…` on an unquoted word → $HOME
 *   $VAR  ${VAR} value or '' when unset; `$?` the previous exit status
 *   * ?   glob on any unquoted word, expanded against the VFS (leading-dot
 *         names need a literal leading dot in the pattern); no match → the
 *         pattern stays literal, like sh with nullglob off
 *
 * `|` splits stages; `>` / `>>` redirect one stage's stdout to a file
 * (redirect targets are never glob-expanded, like sh). Alias expansion is
 * NOT done here — the core expands the first word of each stage from
 * state.aliases after parsing, so aliases stay simple word prefixes.
 *
 * Pure string + VFS math: no IO, no async, unit-tests in plain Node.
 */

import { resolvePath, type Vfs } from './vfs.js';
import type { ShellState } from './terminal-core.js';

/** stdout redirect for one pipeline stage. */
export interface ShellRedirect {
  mode: '>' | '>>';
  target: string;
}

/** One pipeline stage: expanded argv plus an optional stdout redirect. */
export interface ShellStage {
  argv: string[];
  redirect: ShellRedirect | null;
}

export type ParsedLine = { ok: true; stages: ShellStage[] } | { ok: false; error: string };

const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*/;
const GLOB_CHARS = /[*?]/;

/** Expand one `$…` at `line[i]`; returns the value and how much was consumed. */
function expandDollar(line: string, i: number, state: ShellState): { text: string; len: number } {
  const rest = line.slice(i + 1);
  if (rest.startsWith('?')) return { text: String(state.lastStatus), len: 2 };
  if (rest.startsWith('{')) {
    const close = rest.indexOf('}');
    if (close > 0) {
      const name = rest.slice(1, close);
      const value = name === '?' ? String(state.lastStatus) : (state.env[name] ?? '');
      return { text: value, len: close + 2 };
    }
    return { text: '${', len: 2 }; // no closing brace: literal
  }
  const name = VAR_NAME.exec(rest)?.[0];
  if (name) return { text: state.env[name] ?? '', len: 1 + name.length };
  return { text: '$', len: 1 }; // bare dollar: literal
}

/** Match one glob `segment` against a path segment name. */
function globMatch(segment: string, name: string): boolean {
  if (name.startsWith('.') && !segment.startsWith('.')) return false; // hidden files need a literal dot
  let re = '';
  for (const ch of segment) {
    if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`).test(name);
}

/** Paths of every node the pattern matches, sorted; [pattern] when none. */
export function globExpand(pattern: string, cwd: string, vfs: Vfs): string[] {
  const absolute = pattern.startsWith('/');
  const base = resolvePath(cwd, '.');
  const segments = pattern.split('/').filter((s) => s !== '' && s !== '.');
  // One round per pattern segment: `live` holds the matched paths so far.
  let live: string[] = [base];
  for (let s = 0; s < segments.length; s++) {
    const segment = segments[s];
    const last = s === segments.length - 1;
    const next: string[] = [];
    for (const path of live) {
      const node = vfs.nodeAt(path);
      if (!node || node.kind !== 'dir') continue;
      if (!GLOB_CHARS.test(segment)) {
        const child = resolvePath(path, segment); // literal segments may be `..`
        const target = vfs.nodeAt(child);
        if (target && (last || target.kind === 'dir')) next.push(child);
        continue;
      }
      for (const entry of node.children) {
        if (!globMatch(segment, entry.name)) continue;
        if (!last && entry.kind !== 'dir') continue;
        next.push(path === '/' ? `/${entry.name}` : `${path}/${entry.name}`);
      }
    }
    live = next;
    if (live.length === 0) break;
  }
  if (live.length === 0) return [pattern]; // sh with nullglob off: the pattern stays literal
  const results = absolute ? live : live.map((p) => (base === '/' ? p.slice(1) : p === base ? '.' : p.startsWith(base + '/') ? p.slice(base.length + 1) : p));
  return results.sort((a, b) => a.localeCompare(b));
}

/**
 * Parse one input line to pipeline stages, or a syntax error (unterminated
 * quote, misplaced operator). Expansion (state-aware) and globbing (VFS)
 * both happen here; aliases are the core's business.
 */
export function parseCommandLine(line: string, state: ShellState, vfs: Vfs): ParsedLine {
  const stages: ShellStage[] = [];
  let stage: ShellStage = { argv: [], redirect: null };
  let word = '';
  let wordQuoted = false; // any part of the word was quoted/escaped → no glob
  let quote: false | '"' | "'" = false;

  const flush = (): void => {
    if (!quote && (word !== '' || wordQuoted)) {
      if (!wordQuoted && GLOB_CHARS.test(word)) stage.argv.push(...globExpand(word, state.cwd, vfs));
      else stage.argv.push(word);
      word = '';
      wordQuoted = false;
    }
  };

  for (let i = 0; i < line.length; ) {
    const c = line[i];
    if (quote === false) {
      if (c === ' ' || c === '\t') {
        flush();
        i++;
      } else if (c === '|') {
        flush();
        if (stage.argv.length === 0 && !stage.redirect) return { ok: false, error: 'syntax error near `|`' };
        stages.push(stage);
        stage = { argv: [], redirect: null };
        i++;
      } else if (c === '>') {
        flush();
        if (stage.redirect) return { ok: false, error: 'syntax error: more than one redirect in a stage' };
        const mode = line[i + 1] === '>' ? '>>' : '>';
        i += mode.length;
        while (line[i] === ' ' || line[i] === '\t') i++;
        // The target word: quotes allowed, no glob, no pipes inside.
        let target = '';
        let targetQuoted = false;
        while (i < line.length && line[i] !== ' ' && line[i] !== '\t' && line[i] !== '|') {
          const t = line[i];
          if (t === "'" || t === '"') {
            const end = line.indexOf(t, i + 1);
            if (end === -1) return { ok: false, error: 'unterminated quote' };
            target += line.slice(i + 1, end);
            targetQuoted = true;
            i = end + 1;
          } else if (t === '\\' && i + 1 < line.length) {
            target += line[i + 1];
            targetQuoted = true;
            i += 2;
          } else {
            target += t;
            i++;
          }
        }
        if (target === '') return { ok: false, error: 'syntax error near `>` — expected a file name' };
        stage.redirect = { mode, target };
      } else if (c === "'") {
        quote = "'";
        wordQuoted = true;
        i++;
      } else if (c === '"') {
        quote = '"';
        wordQuoted = true;
        i++;
      } else if (c === '\\') {
        if (i + 1 < line.length) word += line[i + 1];
        wordQuoted = true;
        i += 2;
      } else if (c === '~' && word === '' && !wordQuoted) {
        if (i + 1 === line.length || line[i + 1] === '/') {
          word += (state.env.HOME ?? '/').replace(/\/+$/, '') || '/';
          i++;
        } else {
          word += c;
          i++;
        }
      } else if (c === '$') {
        const expansion = expandDollar(line, i, state);
        word += expansion.text;
        i += expansion.len;
      } else {
        word += c;
        i++;
      }
      continue;
    }
    if (quote === "'") {
      if (c === "'") quote = false;
      else word += c;
      i++;
      continue;
    }
    // double quotes: $ expands, backslash escapes only $ ` " \
    if (c === '"') {
      quote = false;
      i++;
    } else if (c === '\\' && '`"$\\'.includes(line[i + 1] ?? '')) {
      word += line[i + 1];
      wordQuoted = true;
      i += 2;
    } else if (c === '$') {
      const expansion = expandDollar(line, i, state);
      word += expansion.text;
      i += expansion.len;
    } else {
      word += c;
      i++;
    }
  }
  if (quote !== false) return { ok: false, error: 'unterminated quote' };
  flush();
  if (stage.argv.length > 0 || stage.redirect) stages.push(stage);
  return { ok: true, stages };
}
