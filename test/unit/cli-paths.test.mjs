// Unit spec — bin/semtext-agent.mjs · the workspace path guard.
//
// Feature: the agent CLI may only touch paths inside the working directory
//   Scenario: an --out / --in-place target outside the working directory is refused (exit 1)
//   Scenario: a symlink whose real target sits inside is followed and allowed
//   Scenario: a symlink pointing outside is refused — the real target is checked
//   Scenario: edit --content-file cannot read outside the working directory
//   Scenario: xslt --out writes the result to the given path (it used to be ignored)
//   Scenario: write no longer advertises --in-place (it never worked there) and rejects it

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, guardWorkspacePath, realpathAllowMissing } from '../../bin/semtext-agent.mjs';

const DIST = new URL('../../dist/semtext-agent.js', import.meta.url);

let workspace = null;   // the CLI working directory for the current test
let workspaceReal = null; // its realpath (tmp dirs are symlinked on macOS)
let outside = null;     // a directory outside it

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'semtext-cli-'));
  workspace = mkdtempSync(join(base, 'work-'));
  workspaceReal = realpathSync(workspace);
  outside = mkdtempSync(join(base, 'outside-'));
  process.chdir(workspace);
});

afterEach(() => {
  const base = join(workspace, '..');
  process.chdir(tmpdir());
  rmSync(base, { recursive: true, force: true });
  workspace = null;
  outside = null;
});

/** Run main() capturing stdout/stderr; returns { code, out, err }. */
async function runCli(args) {
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  let out = '';
  let err = '';
  process.stdout.write = (s) => { out += s; return true; };
  process.stderr.write = (s) => { err += s; return true; };
  try {
    const code = await main(args);
    return { code, out, err };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

const DOC = '<html><body><sem-enhanced-document>' +
  '<h2 id="a">Alpha</h2><p>Some prose.</p>' +
  '</sem-enhanced-document></body></html>';
const MD = '# Greeting\n\nHello there, hardening test.\n';
const XSL = '<?xml version="1.0"?>\n' +
  '<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0">' +
  '<xsl:template match="/"><result><xsl:value-of select="//p"/></result></xsl:template>' +
  '</xsl:stylesheet>';

describe('guardWorkspacePath (the workspace rule)', () => {
  it('allows a relative path inside the working directory and returns its real path', () => {
    mkdirSync(join(workspace, 'out'));
    const real = guardWorkspacePath(join('out', 'x.html'), '--out');
    expect(real).toBe(join(workspaceReal, 'out', 'x.html'));
  });

  it('refuses an absolute path outside the working directory', () => {
    const victim = join(outside, 'escape.html');
    expect(() => guardWorkspacePath(victim, '--out'))
      .toThrow(/outside the working directory/);
    expect(existsSync(victim)).toBe(false);
  });

  it('refuses a ../ traversal out of the working directory', () => {
    expect(() => guardWorkspacePath('../escape.html', '--out'))
      .toThrow(/outside the working directory/);
  });

  it('allows a symlink whose target sits inside and resolves to it', () => {
    writeFileSync(join(workspace, 'real.html'), DOC);
    symlinkSync(join(workspace, 'real.html'), join(workspace, 'link.html'));
    expect(guardWorkspacePath('link.html', '--in-place target'))
      .toBe(join(workspaceReal, 'real.html'));
  });

  it('refuses a symlink that points outside — the real target is checked', () => {
    const victim = join(outside, 'hosts-like.txt');
    writeFileSync(victim, 'x');
    symlinkSync(victim, join(workspace, 'evil.html'));
    expect(() => guardWorkspacePath('evil.html', '--in-place target'))
      .toThrow(/outside the working directory/);
    expect(readFileSync(victim, 'utf8')).toBe('x'); // untouched
  });

  it('refuses a symlinked parent directory that points outside', () => {
    symlinkSync(outside, join(workspace, 'out-dir'));
    expect(() => guardWorkspacePath(join('out-dir', 'x.html'), '--out'))
      .toThrow(/outside the working directory/);
  });

  it('allows a dangling symlink aimed at a not-yet-existing path inside', () => {
    symlinkSync(join(workspace, 'out', 'fresh.html'), join(workspace, 'link.html'));
    expect(guardWorkspacePath('link.html', '--out'))
      .toBe(join(workspaceReal, 'out', 'fresh.html'));
  });

  it('refuses a dangling symlink aimed at a missing path outside', () => {
    symlinkSync(join(outside, 'nope.html'), join(workspace, 'link.html'));
    expect(() => guardWorkspacePath('link.html', '--out'))
      .toThrow(/outside the working directory/);
  });

  it('realpathAllowMissing anchors a missing leaf on its nearest real ancestor', () => {
    mkdirSync(join(workspace, 'out'));
    const abs = join(workspaceReal, 'out', 'deep', 'x.html');
    expect(realpathAllowMissing(abs)).toBe(abs);
  });
});

describe.runIf(existsSync(DIST))('CLI: write', () => {
  it('writes --out inside the working directory', async () => {
    writeFileSync(join(workspace, 'inbox.md'), MD);
    mkdirSync(join(workspace, 'out'));
    const { code, err } = await runCli(['write', 'inbox.md', '--out', 'out/written.html']);
    expect(code).toBe(0);
    expect(readFileSync(join(workspace, 'out', 'written.html'), 'utf8')).toMatch(/sem-md/);
    expect(err).toMatch(/wrote out\/written\.html/);
  });

  it('refuses an --out outside the working directory with exit code 1', async () => {
    writeFileSync(join(workspace, 'inbox.md'), MD);
    const { code, err } = await runCli(['write', 'inbox.md', '--out', join(outside, 'x.html')]);
    expect(code).toBe(1);
    expect(err).toMatch(/outside the working directory/);
    expect(existsSync(join(outside, 'x.html'))).toBe(false);
  });

  it('rejects --in-place with a usage error (it never worked for write)', async () => {
    writeFileSync(join(workspace, 'inbox.md'), MD);
    const { code, err } = await runCli(['write', 'inbox.md', '--in-place']);
    expect(code).toBe(2);
    expect(err).toMatch(/write does not support --in-place/);
  });

  it('no longer advertises --in-place for write in the help', async () => {
    const { code, out } = await runCli(['-h']);
    expect(code).toBe(0);
    expect(out).not.toMatch(/\[--in-place \| --out FILE\]\n \* +\[infile\|-\]/);
    expect(out).toMatch(/edit --in-place \| --out FILE/);
    expect(out).toMatch(/--content-file must resolve inside the working directory/);
  });
});

describe.runIf(existsSync(DIST))('CLI: edit', () => {
  it('applies the same rule to --content-file: reading outside is refused', async () => {
    writeFileSync(join(workspace, 'doc.html'), DOC);
    writeFileSync(join(outside, 'secret.txt'), 'replacement prose');
    const { code, err } = await runCli([
      'edit', 'doc.html', '--id', 'a', '--mode', 'inner',
      '--content-file', join(outside, 'secret.txt'), '--out', 'out/copy.html'
    ]);
    expect(code).toBe(1);
    expect(err).toMatch(/--content-file .*outside the working directory/);
    expect(existsSync(join(workspace, 'out', 'copy.html'))).toBe(false);
  });

  it('refuses edit --in-place through a symlink pointing outside', async () => {
    const victim = join(outside, 'doc.html');
    writeFileSync(victim, DOC);
    symlinkSync(victim, join(workspace, 'doc.html'));
    const { code, err } = await runCli([
      'edit', 'doc.html', '--id', 'a', '--mode', 'inner', '--content', 'x', '--in-place'
    ]);
    expect(code).toBe(1);
    expect(err).toMatch(/--in-place target .*outside the working directory/);
    expect(readFileSync(victim, 'utf8')).toBe(DOC); // untouched
  });

  it('edit --in-place works inside the working directory', async () => {
    writeFileSync(join(workspace, 'doc.html'), DOC);
    const { code } = await runCli([
      'edit', 'doc.html', '--id', 'a', '--mode', 'inner', '--content', 'Renamed heading.', '--in-place'
    ]);
    expect(code).toBe(0);
    expect(readFileSync(join(workspace, 'doc.html'), 'utf8')).toMatch(/Renamed heading\./);
  });
});

describe.runIf(existsSync(DIST))('CLI: xslt', () => {
  it('refuses an --out outside the working directory', async () => {
    writeFileSync(join(workspace, 'doc.html'), DOC);
    writeFileSync(join(workspace, 'style.xsl'), XSL);
    const { code, err } = await runCli([
      'xslt', 'doc.html', 'style.xsl', '--out', join(outside, 'r.xml')
    ]);
    expect(code).toBe(1);
    expect(err).toMatch(/outside the working directory/);
    expect(existsSync(join(outside, 'r.xml'))).toBe(false);
  });

  it('writes the result to the given --out path (the flag used to be ignored)', async () => {
    writeFileSync(join(workspace, 'doc.html'), DOC);
    writeFileSync(join(workspace, 'style.xsl'), XSL);
    mkdirSync(join(workspace, 'out'));
    const { code, out } = await runCli(['xslt', 'doc.html', 'style.xsl', '--out', 'out/r.xml']);
    expect(code).toBe(0);
    expect(out).not.toMatch(/<result>/); // content goes to the file, not stdout
    expect(readFileSync(join(workspace, 'out', 'r.xml'), 'utf8')).toMatch(/<result>Some prose\.<\/result>/);
  });

  it('follows a symlink whose target sits inside and writes to the real file', async () => {
    writeFileSync(join(workspace, 'doc.html'), DOC);
    writeFileSync(join(workspace, 'style.xsl'), XSL);
    mkdirSync(join(workspace, 'out'));
    symlinkSync(join(workspace, 'out', 'r.xml'), join(workspace, 'link.xml')); // dangling, inside
    const { code } = await runCli(['xslt', 'doc.html', 'style.xsl', '--out', 'link.xml']);
    expect(code).toBe(0);
    expect(readFileSync(join(workspace, 'out', 'r.xml'), 'utf8')).toMatch(/Some prose\./);
  });

  it('refuses an --out symlink that points outside', async () => {
    writeFileSync(join(workspace, 'doc.html'), DOC);
    writeFileSync(join(workspace, 'style.xsl'), XSL);
    symlinkSync(join(outside, 'r.xml'), join(workspace, 'link.xml'));
    const { code, err } = await runCli(['xslt', 'doc.html', 'style.xsl', '--out', 'link.xml']);
    expect(code).toBe(1);
    expect(err).toMatch(/outside the working directory/);
    expect(existsSync(join(outside, 'r.xml'))).toBe(false);
  });
});
