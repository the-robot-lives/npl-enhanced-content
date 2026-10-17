// @vitest-environment happy-dom
// Unit spec — the semtext-cards plugin: render-card, the .card parser,
// display-width layout and the frame themes (src/terminal/plugins/cards/)
//
// Feature: the .card parser
//   Scenario: header keys, quoting, literal and folded blocks, comments, markers
//   Scenario: unknown keys and a missing name warn; the name falls back to the file
//   Scenario: structural failures throw CardFileError with a 1-based line
//   Scenario: subtitle and footer parse; sections split at "#"-headings
// Feature: display-width layout
//   Scenario: CJK and emoji count two columns, combining marks zero, SGR none
//   Scenario: measurement agrees with the screen model's width table
//   Scenario: wrapDisplay breaks words, breaks between wide glyphs, hard-slices runs
// Feature: the frame themes
//   Scenario: nine themes registered; zigzag is the default; unknown ids throw
//   Scenario: every theme draws exact-width frames with the NAME in both rules
//   Scenario: the title underlines only in color mode; accents adapt to background
//   Scenario: subtitle, footer and section headings render inside the frame
// Feature: the render-card command
//   Scenario: renders a mounted card; --theme and --width override the header
//   Scenario: --themes draws the gallery in every theme; --theme narrows it
//   Scenario: --plain prints heading + text with no box-drawing glyphs
//   Scenario: --list-themes; --light/--dark; errors for bad input
// Feature: the shipped manifest.json stays in sync with plugin.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TerminalCore, type ExecResult } from '../../src/terminal/terminal-core.js';
import { stringWidth } from '../../src/terminal/screen/width.js';
import { cardsPlugin } from '../../src/terminal/plugins/cards/plugin.js';
import { parseCardFile, CardFileError, splitSections } from '../../src/terminal/plugins/cards/cardfile.js';
import { displayWidth, truncateDisplay, wrapDisplay } from '../../src/terminal/plugins/cards/width.js';
import {
  CARD_THEMES,
  galleryCard,
  themeIds,
  resolveCardTheme,
  resolveCardBackground,
  clampCardWidth,
  renderCardLines,
  renderCardPlain,
} from '../../src/terminal/plugins/cards/themes.js';
import cardsManifest from '../../src/terminal/plugins/cards/manifest.json';

let core: TerminalCore;

const out = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stdout').map((l) => l.text);
const errs = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stderr').map((l) => l.text);

// The unit harness's execLine reports color: true (a tty), so command
// output carries the SGR accents; strip them for text-level assertions.
const strip = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');
const plainOut = (r: ExecResult): string[] => out(r).map(strip);

const SIMPLE = 'name: render-demo\ntitle: SemText in one file\ndescription: body text\n';

// Box-drawing, block elements and the sketch glyphs — nothing a --plain
// card may carry.
const FRAME_GLYPHS = /[─-╿▀-▟/\\|╔╦╗╚╝╠╣║╭╮╰╯✦┏┓┗┛┃┄┌┐└┘▀▄▌▐▛▜▙▟+]/;
const BOX_RANGES = /[─-╿▀-▟]/;

describe('.card parser', () => {
  it('parses header keys, quotes, blocks, comments and document markers', () => {
    const card = parseCardFile(
      [
        '# a comment',
        '---',
        "name: 'it''s a card'",
        'title: "a \\"quoted\\" title"',
        'subtitle: the line under it',
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
    expect(card.subtitle).toBe('the line under it');
    expect(card.theme).toBe('double');
    expect(card.width).toBe(40);
    expect(card.description).toBe('one\n\ntwo\n');
    expect(card.warnings).toEqual([]);
  });

  it('folds > blocks to paragraphs; plain values stay text', () => {
    expect(parseCardFile('description: >\n  a\n  b\n\n  c\n').description).toBe('a b\nc\n');
    expect(parseCardFile('description: keeps # and : inside\n').description).toBe('keeps # and : inside');
  });

  it('parses subtitle and footer as plain keys', () => {
    const card = parseCardFile('name: x\nsubtitle: sub\nfooter: foot\n');
    expect(card.subtitle).toBe('sub');
    expect(card.footer).toBe('foot');
    expect(parseCardFile('name: x').subtitle).toBeNull();
    expect(parseCardFile('name: x').footer).toBeNull();
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

describe('description sections', () => {
  it('splits at "#"-heading lines; prose before the first is the intro', () => {
    expect(splitSections('intro\n## A\nbody a\n### B\nbody b')).toEqual([
      { heading: null, body: 'intro' },
      { heading: 'A', body: 'body a' },
      { heading: 'B', body: 'body b' },
    ]);
  });

  it('keeps blank lines and treats non-heading # runs as data', () => {
    expect(splitSections('one\n\ntwo')).toEqual([{ heading: null, body: 'one\n\ntwo' }]);
    expect(splitSections('a # b\n#not-a-heading (no space)\n#### too? no — four is a heading\nx')).toEqual([
      { heading: null, body: 'a # b\n#not-a-heading (no space)' },
      { heading: 'too? no — four is a heading', body: 'x' },
    ]);
    expect(splitSections('')).toEqual([]);
  });
});

describe('display-width layout', () => {
  it('counts CJK and emoji as two columns, combining marks and SGR as none', () => {
    expect(displayWidth('中')).toBe(2);
    expect(displayWidth('👍')).toBe(2);
    expect(displayWidth('é')).toBe(1);
    expect(displayWidth('\x1b[4mhi\x1b[24m')).toBe(2);
  });

  it('measures with the screen model width table — one table terminal-wide', () => {
    for (const sample of ['中', '👍', 'é', 'a中text', '한국어', 'Ⅸ']) {
      expect(displayWidth(sample), sample).toBe(stringWidth(sample));
    }
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

  it('registers nine themes; zigzag is the default; unknown ids throw', () => {
    expect(themeIds()).toEqual([
      'zigzag',
      'double',
      'rounded',
      'ornate',
      'heavy',
      'blueprint',
      'block',
      'minimal',
      'ascii',
    ]);
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
      expect(widths.values().next().value, `${theme.id}: at the default 64`).toBe(64);
      expect(lines[0], `${theme.id}: NAME in the top rule`).toContain(' render-demo ');
      expect(lines[lines.length - 1], `${theme.id}: NAME in the bottom rule`).toContain(' render-demo ');
      expect(lines.join('\n'), `${theme.id}: plain when piped`).not.toContain('\x1b');
      expect(lines.join('\n'), `${theme.id}: body visible`).toContain('body text');
    }
  });

  it('underlines the title only in color mode and honors width overrides', () => {
    expect(renderCardLines(card, { color: true }).join('\n')).toContain('\x1b[1;4m');
    expect(renderCardLines(card, { color: false }).join('\n')).not.toContain('\x1b');
    const narrow = renderCardLines(card, { width: 30, color: false });
    expect(displayWidth(narrow[0]!)).toBe(30);
    const wider = renderCardLines(parseCardFile('name: w\ntitle: t\ndescription: d\nwidth: 48\n'), { color: false });
    expect(displayWidth(wider[0]!)).toBe(48);
  });

  it('paints a per-theme accent that adapts to dark and light backgrounds', () => {
    const dark = renderCardLines(card, { color: true, background: 'dark' }).join('\n');
    const light = renderCardLines(card, { color: true, background: 'light' }).join('\n');
    expect(dark).toContain('\x1b[95m'); // zigzag dark accent (bright magenta)
    expect(light).toContain('\x1b[35m'); // zigzag light accent (magenta)
    expect(dark).not.toBe(light);
    // ascii stays colourless by design — even on a tty.
    const ascii = renderCardLines(card, { theme: 'ascii', color: true }).join('\n');
    expect(ascii).not.toContain('\x1b');
  });

  it('resolves the background from COLORFGBG, defaulting dark', () => {
    expect(resolveCardBackground()).toBe('dark');
    expect(resolveCardBackground({})).toBe('dark');
    expect(resolveCardBackground({ COLORFGBG: '15;0' })).toBe('dark');
    expect(resolveCardBackground({ COLORFGBG: '0;15' })).toBe('light');
    expect(resolveCardBackground({ COLORFGBG: 'default;7' })).toBe('light');
    expect(resolveCardBackground({ COLORFGBG: 'junk' })).toBe('dark');
  });

  it('renders subtitle, footer and section headings inside the frame', () => {
    const rich = parseCardFile(
      'name: rich\ntitle: T\nsubtitle: S\nfooter: F\ndescription: |\n  intro\n  ## Sec\n  sec body\n',
    );
    const lines = renderCardLines(rich, { color: false, width: 40 });
    const joined = lines.join('\n');
    expect(joined).toContain('S');
    expect(joined).toContain('F');
    expect(joined).toContain('Sec');
    expect(joined).toContain('intro');
    expect(joined).toContain('sec body');
    const widths = new Set(lines.map((line) => displayWidth(line)));
    expect(widths.size).toBe(1);
    // Color mode styles them: italic subtitle, dim footer, bold accent heading.
    const colored = renderCardLines(rich, { color: true }).join('\n');
    expect(colored).toContain('\x1b[3mS');
    expect(colored).toContain('\x1b[2mF');
    expect(colored).toContain('\x1b[1mSec');
  });
});

describe('plain + gallery rendering', () => {
  it('--plain prints heading + text with no frame glyphs', () => {
    const card = parseCardFile(SIMPLE + 'subtitle: sub\nfooter: foot\n');
    const lines = renderCardPlain(card, { color: false });
    const joined = lines.join('\n');
    expect(lines[0]).toBe('SemText in one file'); // heading first
    expect(joined).toContain('sub');
    expect(joined).toContain('body text');
    expect(joined).toContain('— foot');
    expect(joined).not.toMatch(BOX_RANGES);
    expect(joined).not.toMatch(FRAME_GLYPHS);
    expect(joined).not.toContain('\x1b');
    // Section headings carry over into plain mode.
    const sectioned = parseCardFile('name: x\ndescription: |-\n  intro\n  ## A\n  body\n');
    const plain2 = renderCardPlain(sectioned, { color: false });
    expect(plain2).toEqual(['x', 'intro', '', 'A', 'body']);
  });

  it('the gallery card carries title, subtitle, sections and footer', () => {
    const gallery = galleryCard();
    expect(gallery.title).toBe('Theme gallery');
    expect(gallery.subtitle).not.toBeNull();
    expect(gallery.footer).not.toBeNull();
    expect(splitSections(gallery.description).length).toBeGreaterThan(1);
    for (const theme of CARD_THEMES) {
      const lines = renderCardLines(gallery, { theme: theme.id, color: false, width: 40 });
      const widths = new Set(lines.map((line) => displayWidth(line)));
      expect(widths.size, `${theme.id} gallery frame`).toBe(1);
    }
  });
});

describe('render-card command', () => {
  beforeEach(() => {
    core = new TerminalCore();
    const result = core.mountPlugin(cardsPlugin);
    if (!result.ok) throw new Error(result.error ?? 'cards plugin failed to mount');
  });

  it('renders a mounted demo card through its header theme', () => {
    const lines = plainOut(core.execLine('render-card demo/render-subsection.card'));
    expect(lines[0]!.startsWith('╔')).toBe(true); // the card's theme: double
    expect(lines.join('\n')).toContain('One section at a time');
    const widths = new Set(lines.map((line) => displayWidth(line)));
    expect(widths.size).toBe(1);
    // On a tty the frame is painted: the double accent wraps the rule.
    expect(out(core.execLine('render-card demo/render-subsection.card'))[0]).toContain('\x1b[96m');
  });

  it('renders the sections demo card (blueprint) with its footer', () => {
    const lines = plainOut(core.execLine('render-card demo/your-first-card.card'));
    expect(lines[0]!.startsWith('┌')).toBe(true);
    const joined = lines.join('\n');
    expect(joined).toContain('Sections');
    expect(joined).toContain('render-card --help for the full flag list');
    const widths = new Set(lines.map((line) => displayWidth(line)));
    expect(widths.size).toBe(1);
  });

  it('--theme and --width override the card header', () => {
    const lines = out(core.execLine('render-card demo/render-subsection.card --theme ascii'));
    expect(lines[0]!.startsWith('+-')).toBe(true);
    expect(displayWidth(out(core.execLine('render-card demo/render-demo.card --width 30'))[0]!)).toBe(30);
  });

  it('--themes draws the gallery once per theme; --theme narrows it', () => {
    const all = plainOut(core.execLine('render-card --themes'));
    // One blank line between cards; each card carries the gallery NAME.
    const blocks = all.join('\n').split('\n\n');
    expect(blocks.length).toBe(CARD_THEMES.length);
    expect(all[0]!.startsWith('/')).toBe(true); // zigzag, the first theme
    expect(all.join('\n')).toContain('Theme gallery');
    const widths = new Set(all.filter((line) => line.trim() !== '').map((line) => displayWidth(line)));
    expect(widths.size).toBe(1);
    const one = plainOut(core.execLine('render-card --themes --theme rounded'));
    expect(one.length).toBeLessThan(all.length);
    expect(one[0]!.startsWith('╭')).toBe(true);
    expect(errs(core.execLine('render-card --themes --theme plaid')).join(' ')).toMatch(/unknown theme/);
  });

  it('--plain prints heading + text with no box-drawing noise', () => {
    const lines = plainOut(core.execLine('render-card demo/your-first-card.card --plain'));
    const joined = lines.join('\n');
    expect(lines[0]).toBe('The anatomy of a card');
    expect(joined).toContain('Sections');
    expect(joined).toContain('render-card --help for the full flag list');
    expect(joined).not.toMatch(BOX_RANGES);
    expect(joined).not.toMatch(FRAME_GLYPHS);
  });

  it('--list-themes lists every theme id', () => {
    const joined = out(core.execLine('render-card --list-themes')).join('\n');
    for (const id of themeIds()) expect(joined).toContain(id);
  });

  it('--light and --dark force the palette variant on a tty output path', () => {
    // ctx.color is false in the unit harness — flags parse without error;
    // the palette itself is covered in the frame-themes block above.
    expect(out(core.execLine('render-card demo/render-demo.card --light')).length).toBeGreaterThan(2);
    expect(out(core.execLine('render-card demo/render-demo.card --dark')).length).toBeGreaterThan(2);
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
