// @vitest-environment happy-dom
// Unit spec — the semtext-demo plugin: the SemText commands and the shipped
// manifest (src/terminal/plugins/demo/)
//
// Feature: the SemText commands over the mounted demo tree
//   Scenario: outline renders the document skeleton
//   Scenario: format --json emits the canonical record array
//   Scenario: filter selects by type and by text; missing criteria errors
//   Scenario: render prints the machine-readable tour (embeds, records, skeleton)
//   Scenario: tui --help; expand prints one record fully; bad order errors
//   Scenario: open refuses non-HTML with a clear message and emits nothing
//   Scenario: open accepts .html and emits a data-only window action
// Feature: the shipped manifest.json stays in sync with plugin.ts
//   Scenario: same name, version and file paths; every src exists on disk
//
// The POSIX commands (ls, cat, cd, pwd, …) moved to the posix-sh plugin —
// their specs live in shell-posix.test.ts.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TerminalCore, type ExecResult } from '../../src/terminal/terminal-core.js';
import { demoPlugin } from '../../src/terminal/plugins/demo/plugin.js';
import manifestJson from '../../src/terminal/plugins/demo/manifest.json';

let core: TerminalCore;

const out = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stdout').map((l) => l.text);
const errs = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stderr').map((l) => l.text);

beforeEach(() => {
  core = new TerminalCore();
  const result = core.mountPlugin(demoPlugin);
  if (!result.ok) throw new Error(result.error ?? 'demo plugin failed to mount');
});

describe('semtext', () => {
  it('outline renders the document skeleton', () => {
    const lines = out(core.execLine('semtext outline demo/token-rotation.html'));
    expect(lines[0]).toBe('h1 Token Rotation');
    expect(lines).toContain('  sem-properties glossary');
    expect(lines).toContain('  h2 Rotation');
    expect(lines).toContain('    sem-note tip');
    expect(lines).toContain('    sem-code src/rotate.ts');
  });

  it('format --json emits the canonical record array', () => {
    const records = JSON.parse(out(core.execLine('semtext format demo/quiz.html --json')).join('\n'));
    expect(records.some((r: { type: string }) => r.type === 'sem-fact')).toBe(true);
  });

  it('filter selects by type and by text', () => {
    expect(out(core.execLine('semtext filter demo/token-rotation.html --type sem-note')).join('\n')).toContain('<sem-note variant="tip">');
    expect(out(core.execLine('semtext filter demo/token-rotation.html --text Proof Key')).join('\n')).toContain('key="PKCE"');
  });

  it('filter without criteria and unknown subcommands error', () => {
    expect(errs(core.execLine('semtext filter demo/quiz.html')).join(' ')).toMatch(/--type/);
    expect(errs(core.execLine('semtext bogus demo/quiz.html')).join(' ')).toMatch(/unknown subcommand/);
  });

  it('render prints the machine-readable tour: header, embeds, records, skeleton', () => {
    const lines = out(core.execLine('semtext render demo/token-rotation.html'));
    expect(lines[0]).toBe('# semtext render — demo/token-rotation.html');
    expect(lines).toContain('# embeds: (none)'); // the demo doc carries no script/link embeds
    expect(lines).toContain('# records:');
    expect(lines.join('\n')).toContain('Token Rotation'); // record text (h1)
    const skeletonAt = lines.indexOf('# skeleton:');
    expect(skeletonAt).toBeGreaterThan(lines.indexOf('# records:'));
    expect(lines.slice(skeletonAt + 1)).toContain('h1 Token Rotation');
  });

  it('--help works per subcommand and in general', () => {
    expect(out(core.execLine('semtext render --help')).join(' ')).toMatch(/render/);
    expect(out(core.execLine('semtext tui --help')).join(' ')).toMatch(/tui/);
    expect(out(core.execLine('semtext --help')).join('\n')).toContain('render');
  });

  it('expand prints one record fully; a bad order errors', () => {
    const lines = out(core.execLine('semtext expand demo/token-rotation.html 2'));
    expect(lines[0]).toMatch(/^2\. /);
    expect(lines.length).toBeGreaterThan(1); // the record text, then its fields
    expect(errs(core.execLine('semtext expand demo/token-rotation.html 99')).join(' ')).toMatch(/no record 99/);
  });
});

describe('open', () => {
  it('refuses non-HTML with a clear message and emits nothing', () => {
    const result = core.execLine('open README.md');
    expect(errs(result)).toEqual(['open: README.md: not an HTML document (only .html files open)']);
    expect(result.actions).toEqual([]);
  });

  it('accepts .html and emits a data-only window action with the exact bytes', () => {
    const result = core.execLine('open demo/welcome.html');
    expect(errs(result)).toEqual([]);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].kind).toBe('window');
    expect(result.actions[0].filename).toBe('welcome.html');
    expect(result.actions[0].contentType).toBe('text/html');
    expect((result.actions[0] as { blob: string }).blob).toContain('<h1>Welcome</h1>');
  });

  it('a missing file errors', () => {
    expect(errs(core.execLine('open nope.html'))).toEqual(['nope.html: no such file or directory']);
  });
});

describe('manifest.json <-> plugin.ts sync', () => {
  it('same name, version and file paths; every src exists on disk', () => {
    expect(manifestJson.name).toBe(demoPlugin.name);
    expect(manifestJson.version).toBe(demoPlugin.version);
    const jsonPaths = manifestJson.files.map((f) => f.path).sort();
    const tsPaths = demoPlugin.files.map((f) => f.path).sort();
    expect(jsonPaths).toEqual(tsPaths);
    const base = resolve('src/terminal/plugins/demo');
    for (const entry of manifestJson.files) {
      expect(readFileSync(join(base, entry.src!), 'utf8').length).toBeGreaterThan(0);
    }
  });
});
