// Unit spec — scripts/gen-conventions-html.mjs · spec/conventions.html is
// generated from spec/conventions.md and cannot drift silently
//
// Feature: the HTML spec page is a build artifact of the normative Markdown
//   Scenario: regeneration is deterministic (byte-identical across runs)
//   Scenario: the committed page is in sync with the committed .md
//   Scenario: aliased anchor targets survive — the .md's mis-slugged Appendix A
//             link resolves to the page id (and only via the alias)
//   Scenario: every pinned anchor id asserted elsewhere lands in the output
//   Scenario: removing a pinned anchor from the .md fails generation checks
//   Scenario: the CLI exits 1 on drift and on a missing pinned anchor, writing nothing

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateConventionsHtml, runChecks, ALIASES, INVARIANT_ANCHOR,
} from '../../scripts/gen-conventions-html.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MD_PATH = join(root, 'spec', 'conventions.md');
const OUT_PATH = join(root, 'spec', 'conventions.html');
const GEN = join(root, 'scripts', 'gen-conventions-html.mjs');

// cut the heading whose id build-standalone's llms.txt emission hard-asserts
const cutInvariantHeading = (md) => md.replace(/^## 8\. Machine-readability contract.*$/m, '## 8. Renamed away');

describe('gen-conventions-html', () => {
  it('is deterministic — two runs from the same .md are byte-identical', () => {
    const a = generateConventionsHtml();
    const b = generateConventionsHtml();
    expect(b.html).to.equal(a.html);
  });

  it('the committed spec/conventions.html is in sync with spec/conventions.md', () => {
    const gen = generateConventionsHtml();
    expect(runChecks(gen.html, gen), 'post-generation checks').to.deep.equal([]);
    // the same comparison `npm run gen:conventions:check` performs
    expect(readFileSync(OUT_PATH, 'utf8')).to.equal(gen.html);
  });

  it('aliased anchor targets resolve — and only via the alias', () => {
    const md = readFileSync(MD_PATH, 'utf8');
    const gen = generateConventionsHtml();
    for (const [target, pinned] of Object.entries(ALIASES)) {
      expect(md).to.contain(`#${target}`);          // the .md carries the mis-slugged target
      expect(gen.html).to.contain(`id="${pinned}"`); // the page carries the real id …
      expect(gen.html).not.to.contain(`id="${target}"`); // … and the slugger never emitted the alias itself
    }
  });

  it('every pinned anchor id asserted elsewhere lands in the output', () => {
    const gen = generateConventionsHtml();
    expect(runChecks(gen.html, gen)).to.deep.equal([]);
    expect(gen.html).to.contain(`id="${INVARIANT_ANCHOR}"`);
  });

  it('removing a pinned anchor from the .md fails the checks', () => {
    const md = readFileSync(MD_PATH, 'utf8');
    const cut = cutInvariantHeading(md);
    expect(cut).not.to.equal(md);
    const gen = generateConventionsHtml(cut);
    const problems = runChecks(gen.html, gen);
    expect(problems.some((p) => p.includes(INVARIANT_ANCHOR)), problems.join('; ')).to.equal(true);
  });

  it('the CLI exits 1 on drift and on a missing pinned anchor, writing nothing', () => {
    // the generator resolves its repo from its own path — clone the shape it
    // expects (scripts/gen-conventions-html.mjs + spec/conventions.md) into a fixture dir
    const fixture = mkdtempSync(join(tmpdir(), 'gen-conventions-'));
    try {
      mkdirSync(join(fixture, 'scripts'));
      mkdirSync(join(fixture, 'spec'));
      copyFileSync(GEN, join(fixture, 'scripts', 'gen-conventions-html.mjs'));
      const script = join(fixture, 'scripts', 'gen-conventions-html.mjs');

      // drift: --check against a stale (absent) page
      copyFileSync(MD_PATH, join(fixture, 'spec', 'conventions.md'));
      const stale = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
      expect(stale.status, stale.stderr).to.equal(1);
      expect(stale.stderr).to.match(/stale/);

      // pinned-anchor removal: exit 1, the anchor named on stderr, no page written
      writeFileSync(join(fixture, 'spec', 'conventions.md'), cutInvariantHeading(readFileSync(MD_PATH, 'utf8')));
      const missing = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
      expect(missing.status, missing.stderr).to.equal(1);
      expect(missing.stderr).to.contain(INVARIANT_ANCHOR);
      expect(spawnSync('test', ['-e', join(fixture, 'spec', 'conventions.html')]).status).to.equal(1);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
