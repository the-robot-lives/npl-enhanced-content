/**
 * semtext-cards plugin — the JS-object manifest <sem-shell> can mount
 * alongside posix-sh and semtext-demo.
 *
 * The demo cards are the REAL files in `files/` (imported `?raw`, so the
 * bundle carries their exact bytes and there is one source of truth); the
 * command comes from `commands.ts`. `load` documents where this plugin
 * SHIPS as a CDN plugin (manifest.json + commands.js + files/) — a bundled
 * mount never fetches it.
 *
 * manifest.json is the JSON serialization of this manifest for that
 * shipped form; test/unit/terminal-cards-plugin.test.ts pins the two in
 * sync (name, version, file list).
 */

import type { PluginManifest } from '../../terminal-core.js';
import { cardCommands } from './commands.js';
import readme from './files/README.md?raw';
import renderDemo from './files/render-demo.card?raw';
import renderSubsection from './files/render-subsection.card?raw';
import renderToc from './files/render-toc.card?raw';

export const cardsPlugin: PluginManifest = {
  name: 'semtext-cards',
  version: '0.1.0',
  description: 'render-card: framed terminal cards over the virtual file system',
  load: {
    // Where the published plugin's commands module lives. Same-origin form
    // shown; a CDN deployment must add `integrity: "sha256-<64 hex>"`.
    src: './commands.js',
    integrity: null,
  },
  commands: cardCommands,
  files: [
    { path: '/demos/README.md', content: readme },
    { path: '/demos/render-demo.card', content: renderDemo },
    { path: '/demos/render-subsection.card', content: renderSubsection },
    { path: '/demos/render-toc.card', content: renderToc },
  ],
};

export default cardsPlugin;
