/**
 * semtext-js-shell — the interactive terminal as its own standalone bundle.
 *
 * dist/semtext-js-shell.js (IIFE, global `SemTextShell`). Kept OUT of the
 * core semtext.js entry on purpose: the POSIX plugin surface, the semtext
 * CLI, scripted playback and the flashcard TUI are demo/agent tooling, not
 * document vocabulary — the core bundle must not grow for them. Both
 * elements self-register on load; dist/semtext-js-shell-manifest.json maps
 * their tags back to this artifact.
 */
import './shell/sem-shell.js';
import './terminal/sem-terminal.js';

export { SemShell } from './shell/sem-shell.js';
export { SemTerminal } from './terminal/sem-terminal.js';
export { startPlayback, parseScriptAttribute } from './terminal/playback.js';
