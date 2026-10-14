/**
 * semtext-demo plugin — the JS-object manifest <sem-shell> mounts locally.
 *
 * The demo documents are the REAL files in `files/` (imported `?raw`, so
 * the bundle carries their exact bytes and there is one source of truth);
 * the commands come from `commands.ts`. `load` documents where this plugin
 * SHIPS as a CDN plugin (manifest.json + commands.js + files/) — a bundled
 * mount never fetches it.
 *
 * manifest.json is the JSON serialization of this manifest for that
 * shipped form; test/unit/terminal-demo-plugin.test.ts pins the two in
 * sync (name, version, file list).
 */

import type { PluginManifest } from '../../terminal-core.js';
import { demoCommands } from './commands.js';
import readme from './files/README.md?raw';
import quiz from './files/quiz.html?raw';
import exampleDeck from './files/example-deck.sem.html?raw';
import authNotes from './files/auth-notes.sem.html?raw';
import tokenRotation from './files/token-rotation.html?raw';
import welcome from './files/welcome.html?raw';

export const demoPlugin: PluginManifest = {
  name: 'semtext-demo',
  version: '0.1.0',
  description: 'The SemText demo documents and the shell commands over them',
  load: {
    // Where the published plugin's commands module lives. Same-origin form
    // shown; a CDN deployment must add `integrity: "sha256-<64 hex>"`.
    src: './commands.js',
    integrity: null,
  },
  commands: demoCommands,
  files: [
    { path: '/README.md', content: readme },
    { path: '/demo/welcome.html', content: welcome },
    { path: '/demo/token-rotation.html', content: tokenRotation },
    { path: '/demo/quiz.html', content: quiz },
    { path: '/demo/example-deck.sem.html', content: exampleDeck },
    { path: '/demo/auth-notes.sem.html', content: authNotes },
  ],
};

export default demoPlugin;
