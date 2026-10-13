// @vitest-environment happy-dom
// Unit spec — the semtext-cards plugin: render-card, the .card parser,
// display-width layout and the frame themes (src/terminal/plugins/cards/)
//
// Feature: the .card parser
//   Scenario: header keys, quoting, literal and folded blocks, comments, markers
//   Scenario: unknown keys and a missing name warn; the name falls back to the file
//   Scenario: structural failures throw CardFileError with a 1-based line
// Feature: display-width layout
//   Scenario: CJK and emoji count two columns, combining marks zero, SGR none
//   Scenario: wrapDisplay breaks words, breaks between wide glyphs, hard-slices runs
// Feature: the frame themes
//   Scenario: five themes registered; zigzag is the default; unknown ids throw
//   Scenario: every theme draws exact-width frames with the NAME in both rules
//   Scenario: the title underlines only in color mode
// Feature: the render-card command
//   Scenario: renders a mounted card; --theme and --width override the header
//   Scenario: --list-themes; errors for missing files, unknown themes, bad cards
// Feature: the shipped manifest.json stays in sync with plugin.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TerminalCore, type ExecResult } from '../../src/terminal/terminal-core.js';
import { cardsPlugin } from '../../src/terminal/plugins/cards/plugin.js';
import { parseCardFile, CardFileError } from '../../src/terminal/plugins/cards/cardfile.js';
import { displayWidth, truncateDisplay, wrapDisplay } from '../../src/terminal/plugins/cards/width.js';
import {
  CARD_THEMES,
  themeIds,
  resolveCardTheme,
  clampCardWidth,
  renderCardLines,
} from '../../src/terminal/plugins/cards/themes.js';
import cardsManifest from '../../src/terminal/plugins/cards/manifest.json';

let core: TerminalCore;

const out = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stdout').map((l) => l.text);
const errs = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stderr').map((l) => l.text);

const SIMPLE = 'name: render-demo\ntitle: SemText in one file\ndescription: body text\n';

describe('.card parser', () => {
  it('parses header keys, quotes, blocks, comments and document markers', () => {
    const card = parseCardFile(
      [
        '# a comment',
        '---',
        "name: 'it''s a card'",
        'title: "a \\"quoted\\" title"',
        'theme: double',
        'width: 40',
        'description: |',
        '  one',
        '',
        '  two',
        '...',
      ].join('\n'),
    );
    expect(card.name).toBe("it's a card");
    expect(card.title).toBe('a "quoted" title');
    expect(card.theme).toBe('double');
    expect(card.width).toBe(40);
    expect(card.description).toBe('one\n\ntwo\n');
    expect(card.warnings).toEqual([]);
  });

  it('folds > blocks to paragraphs; plain values stay text', () => {
    expect(parseCardFile('description: >\n  a\n  b\n\n  c\n').description).toBe('a b\nc\n');
    expect(parseCardFile('description: keeps # and : inside\n').description).toBe('keeps # and : inside');
  });

  it('warns on unknown keys and a missing name, falling back to the file name', () => {
    const card = parseCardFile('foo: bar\ntitle: T\n', { label: 'demo/render-demo.card' });
    expect(card.name).toBe('render-demo');
    expect(card.warnings.some((w) => w.includes('foo'))).toBe(true);
    expect(card.warnings.some((w) => w.includes('name'))).toBe(true);
  });

  it('throws CardFileError with a 1-based line for structural failures', () => {
    expect(() => parseCardFile('name: ok\nthis line has no colon\n')).toThrow(CardFileError);
    try {
      parseCardFile('name: ok\nno colon here\n');
      expect.unreachable('parser should have thrown');
    } catch (cause) {
      expect(cause).toBeInstanceOf(CardFileError);
      expect((cause as CardFileError).line).toBe(2);
    }
    expect(() => parseCardFile('name: |\n  blocked\n')).toThrow(/block scalars/);
    expect(() => parseCardFile('name: ok\n')).not.toThrow();
  });

  it('rejects a non-integer width with a warning, keeping the default', () => {
    const card = parseCardFile('name: x\nwidth: wide\n');
    expect(card.width).toBeNull();
    expect(card.warnings.join(' ')).toMatch(/width/);
  });
});

describe('display-width layout', () => {
  it('counts CJK and emoji as two columns, combining marks and SGR as none', () => {
    expect(displayWidth('中')).toBe(2);
    expect(displayWidth('👍')).toBe(2);
    expect(displayWidth('é')).toBe(1);
    expect(displayWidth('\x1b[4mhi\x1b[24m')).toBe(2);
  });

  it('truncateDisplay never splits a wide glyph', () => {
    expect(truncateDisplay('hello', 4)).toBe('hell');
    expect(truncateDisplay('日本語', 4)).toBe('日本');
    expect(truncateDisplay('日本語', 3)).toBe('日');
  });

  it('wrapDisplay breaks words, wide runs, and hard-slices narrow runs', () => {
    expect(wrapDisplay('hello world', 5)).toEqual(['hello', 'world']);
    expect(wrapDisplay('abcdefgh', 3)).toEqual(['abc', 'def', 'gh']);
    expect(wrapDisplay('日本語', 4)).toEqual(['日本', '語']);
    expect(wrapDisplay('', 8)).toEqual(['']);
  });
});

describe('frame themes', () => {
  const card = parseCardFile(SIMPLE);

  it('registers five themes; zigzag is the default; unknown ids throw', () => {
    expect(themeIds()).toEqual(['zigzag', 'double', 'rounded', 'ornate', 'ascii']);
    expect(resolveCardTheme(null).id).toBe('zigzag');
    expect(resolveCardTheme('').id).toBe('zigzag');
    expect(() => resolveCardTheme('plaid')).toThrow(/unknown theme/);
    expect(clampCardWidth(4)).toBe(24);
    expect(clampCardWidth(9999)).toBe(120);
    expect(clampCardWidth(null)).toBe(clampCardWidth(undefined));
  });

  it('every theme draws exact-width frames with the NAME in both rules', () => {
    for (const theme of CARD_THEMES) {
      const lines = renderCardLines(card, { theme: theme.id, color: false });
      const widths = new Set(lines.map((line) => displayWidth(line)));
      expect(widths.size, `${theme.id}: uniform frame width`).toBe(1);
      expect(lines[0], `${theme.id}: NAME in the top rule`).toContain(' render-demo ');
      expect(lines[lines.length - 1], `${theme.id}: NAME in the bottom rule`).toContain(' render-demo ');
      expect(lines.join('\n'), `${theme.id}: plain when piped`).not.toContain('\x1b');
      expect(lines.join('\n'), `${theme.id}: body visible`).toContain('body text');
    }
  });

  it('underlines the title only in color mode and honors width overrides', () => {
    expect(renderCardLines(card, { color: true }).join('\n')).toContain('\x1b[4m');
    const narrow = renderCardLines(card, { width: 30, color: false });
    expect(displayWidth(narrow[0]!)).toBe(30);
    const wider = renderCardLines(parseCardFile('name: w\ntitle: t\ndescription: d\nwidth: 48\n'), { color: false });
    expect(displayWidth(wider[0]!)).toBe(48);
  });
});

describe('render-card command', () => {
  beforeEach(() => {
    core = new TerminalCore();
    const result = core.mountPlugin(cardsPlugin);
    if (!result.ok) throw new Error(result.error ?? 'cards plugin failed to mount');
  });

  it('renders a mounted demo card through its header theme', () => {
    const lines = out(core.execLine('render-card demo/render-subsection.card'));
    expect(lines[0]!.startsWith('╔')).toBe(true); // the card's theme: double
    expect(lines.join('\n')).toContain('One section at a time');
    const widths = new Set(lines.map((line) => displayWidth(line)));
    expect(widths.size).toBe(1);
  });

  it('--theme and --width override the card header', () => {
    const lines = out(core.execLine('render-card demo/render-subsection.card --theme ascii'));
    expect(lines[0]!.startsWith('+-')).toBe(true);
    expect(displayWidth(out(core.execLine('render-card demo/render-demo.card --width 30'))[0]!)).toBe(30);
  });

  it('--list-themes lists every theme id', () => {
    const joined = out(core.execLine('render-card --list-themes')).join('\n');
    for (const id of themeIds()) expect(joined).toContain(id);
  });

  it('errors for a missing file, an unknown theme, and `-` without a pipe', () => {
    expect(errs(core.execLine('render-card demo/nope.card')).join(' ')).toMatch(/no such file/);
    expect(errs(core.execLine('render-card demo/render-demo.card --theme plaid')).join(' ')).toMatch(/unknown theme/);
    expect(errs(core.execLine('render-card -')).join(' ')).toMatch(/piped/);
    expect(out(core.execLine('render-card demo/render-demo.card')).length).toBeGreaterThan(2);
  });

  it('reports the failing line of a bad card', () => {
    core.vfs.mountFile('/demo/broken.card', 'name: ok\nno colon on this line\n');
    expect(errs(core.execLine('render-card demo/broken.card')).join(' ')).toMatch(/line 2/);
  });
});

describe('manifest.json <-> plugin.ts sync', () => {
  it('same name, version and file paths; every src exists on disk', () => {
    expect(cardsManifest.name).toBe(cardsPlugin.name);
    expect(cardsManifest.version).toBe(cardsPlugin.version);
    const jsonPaths = cardsManifest.files.map((f) => f.path).sort();
    const tsPaths = cardsPlugin.files.map((f) => f.path).sort();
    expect(jsonPaths).toEqual(tsPaths);
    const base = resolve('src/terminal/plugins/cards');
    for (const entry of cardsManifest.files) {
      expect(readFileSync(join(base, entry.src!), 'utf8').length).toBeGreaterThan(0);
    }
  });
});
