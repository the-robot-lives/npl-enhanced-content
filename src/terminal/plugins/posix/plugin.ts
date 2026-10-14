/**
 * posix-sh plugin — the JS-object manifest <sem-shell> mounts for its
 * POSIX-style command set (commands in ./commands.ts, man pages there too).
 *
 * No `files`: the documents live in the semtext-demo plugin. No `load`:
 * this manifest is bundled and never shipped as a CDN plugin — the shipped
 * form would add `load.src`/`load.integrity` per src/terminal/PLUGINS.md.
 */

import type { PluginManifest } from '../../terminal-core.js';
import { posixCommands } from './commands.js';

export const posixPlugin: PluginManifest = {
  name: 'posix-sh',
  version: '0.1.0',
  description: 'POSIX-style commands over the virtual file system: ls, cat, bat, grep, pipes and redirects',
  commands: posixCommands,
  files: [],
};

export default posixPlugin;
