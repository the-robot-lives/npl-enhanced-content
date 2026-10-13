// @vitest-environment happy-dom
// Unit spec — `semtext toc` and `semtext render --section` (the semtext-demo
// plugin): the table of contents and the one-section render projection.
//
// Feature: the table of contents
//   Scenario: sections number hierarchically; figures and tables list under
//             their section with captions, id references or per-kind ordinals
//   Scenario: a document with no sections or listings errors
// Feature: render --section
//   Scenario: an element id selects that section's span alone
//   Scenario: a computed section number (see toc) selects the section
//   Scenario: heading text selects the section
//   Scenario: an unknown section errors, pointing at `semtext toc`
// Feature: flag spellings
//   Scenario: --render/--toc behave exactly like the subcommand forms
//   Scenario: the general and unknown-subcommand messages mention toc

import { describe, it, expect, beforeEach } from 'vitest';
import { TerminalCore, type ExecResult } from '../../src/terminal/terminal-core.js';
import { demoPlugin } from '../../src/terminal/plugins/demo/plugin.js';

let core: TerminalCore;

const out = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stdout').map((l) => l.text);
const errs = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stderr').map((l) => l.text);

const FIXTURE = [
  '<!doctype html><html><body>',
  '<h1 id="top">Auth Notes</h1>',
  '<p>intro text</p>',
  '<h2 id="fetch-queue">Fetch queue</h2>',
  '<p>queue pulls work items</p>',
  '<figure kind="diagram" id="flow"><figcaption>The auth flow</figcaption></figure>',
  '<h2>Store</h2>',
  '<p>rows live in the store</p>',
  '<table id="apple"><caption>GDP By Region</caption><tr><th>region</th></tr></table>',
  '<figure><figcaption>Untitled diagram</figcaption></figure>',
  '</body></html>',
].join('\n');

const DOC = 'demo/fixtures/toc-fixture.html';

beforeEach(() => {
  core = new TerminalCore();
  const result = core.mountPlugin(demoPlugin);
  if (!result.ok) throw new Error(result.error ?? 'demo plugin failed to mount');
  core.vfs.mountFile(`/${DOC}`, FIXTURE);
});

describe('semtext toc', () => {
  it('numbers sections hierarchically and lists figures and tables', () => {
    const lines = out(core.execLine(`semtext toc ${DOC}`));
    expect(lines).toContain('1 h1 Auth Notes');
    expect(lines).toContain('  1.1 h2 Fetch queue');
    expect(lines).toContain('  1.2 h2 Store');
    expect(lines).toContain('    Diagram flow: The auth flow');
    expect(lines).toContain('    Table apple: GDP By Region');
    expect(lines.join('\n')).toMatch(/Diagram 1: Untitled diagram/);
  });

  it('errors on a document with no sections or listings', () => {
    core.vfs.mountFile('/demo/fixtures/empty.html', '<!doctype html><html><body><p>just text</p></body></html>');
    const result = core.execLine('semtext toc demo/fixtures/empty.html');
    expect(errs(result).join(' ')).toMatch(/no sections/);
  });
});

describe('semtext render --section', () => {
  it('renders one section by element id, number or heading text', () => {
    const byId = out(core.execLine(`semtext render ${DOC} --section fetch-queue`));
    expect(byId[0]).toBe(`# semtext render — ${DOC} [section fetch-queue]`);
    expect(byId.join('\n')).toContain('The auth flow'); // the span figure's caption is a record
    expect(byId.join('\n')).not.toContain('GDP By Region');

    const byNumber = out(core.execLine(`semtext render ${DOC} --section 1.2`));
    expect(byNumber.join('\n')).toContain('h2 Store');
    expect(byNumber.join('\n')).not.toContain('The auth flow');

    const byText = out(core.execLine(`semtext render ${DOC} --section store`));
    expect(byText.join('\n')).toContain('h2 Store');
    expect(byText.join('\n')).not.toContain('The auth flow');
  });

  it('errors for an unknown section and points at semtext toc', () => {
    expect(errs(core.execLine(`semtext render ${DOC} --section nope`)).join(' ')).toMatch(/no section "nope"/);
    expect(errs(core.execLine(`semtext render ${DOC} --section nope`)).join(' ')).toMatch(/toc/);
  });
});

describe('flag spellings', () => {
  it('--render/--toc equal the subcommand forms', () => {
    expect(out(core.execLine(`semtext --render ${DOC} --section fetch-queue`))).toEqual(
      out(core.execLine(`semtext render ${DOC} --section fetch-queue`)),
    );
    expect(out(core.execLine(`semtext --toc ${DOC}`))).toEqual(out(core.execLine(`semtext toc ${DOC}`)));
  });

  it('the general and unknown-subcommand messages mention toc', () => {
    expect(out(core.execLine('semtext --help')).join('\n')).toContain('toc');
    expect(errs(core.execLine('semtext bogus demo/quiz.html')).join(' ')).toMatch(/toc/);
    expect(errs(core.execLine('semtext demo/quiz.html')).join(' ')).toMatch(/toc/);
  });
});
