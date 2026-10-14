// Pipe-command contract tests for bin/semtext.mjs.
//
// Each case runs the real CLI as a child process over the committed
// fixture (test/unit/fixtures/pipe-doc.html) and checks stdout bytes and
// the exit code: 0 ok · 1 usage or parse error · 2 no matches. Errors
// must stay on stderr — a pipe command that writes anything but data to
// stdout breaks every downstream consumer.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const BIN = fileURLToPath(new URL('../../bin/semtext.mjs', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/pipe-doc.html', import.meta.url));

function run(args, opts = {}) {
  let stdout = '';
  let stderr = '';
  let code = 0;
  try {
    stdout = execFileSync(process.execPath, [BIN, ...args], {
      encoding: 'utf8',
      input: opts.stdin ?? '',
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (e) {
    code = e.status ?? 1;
    stdout = e.stdout ?? '';
    stderr = e.stderr ?? '';
  }
  return { code, stdout, stderr };
}

const ok = (args, opts) => ({ ...run(args, opts), code: 0 });

describe('semtext pipe commands — exit code contract', () => {
  it('outline succeeds on the fixture', () => {
    const r = ok(['outline', FIXTURE]);
    expect(r.stdout).toContain('- [h-getting-started] section');
    expect(r.stdout).toContain('- [h-details] section');
  });

  it('outline --json emits parseable nodes', () => {
    const r = ok(['outline', FIXTURE, '--json']);
    const nodes = JSON.parse(r.stdout);
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes[0]).toHaveProperty('id');
    expect(nodes[0]).toHaveProperty('children');
  });

  it('filter --type sem-fact matches both facts', () => {
    const r = ok(['filter', FIXTURE, '--type', 'sem-fact']);
    expect(r.stdout).toContain('SemText is XHTML-first');
    expect(r.stdout).toContain('Pipelines stay plain');
    expect(r.stdout).not.toContain('npm install');
  });

  it('filter --type sem-facts matches the container', () => {
    const r = ok(['filter', FIXTURE, '--type', 'sem-facts']);
    expect(r.stdout).toContain('f-markup');
  });

  it('filter --attr matches on attribute presence and value', () => {
    const r = ok(['filter', FIXTURE, '--attr', 'data-variant=warning']);
    expect(r.stdout).toContain('n-warning');
    expect(r.stdout).not.toContain('n-install');
  });

  it('filter --text does a case-insensitive substring match', () => {
    const r = ok(['filter', FIXTURE, '--text', 'pipelines stay plain']);
    expect(r.stdout).toContain('f-pipes');
    expect(r.stdout).not.toContain('f-markup');
  });

  it('filter --json emits id/type/record entries', () => {
    const r = ok(['filter', FIXTURE, '--type', 'sem-note', '--json']);
    const rows = JSON.parse(r.stdout);
    expect(rows.map((x) => x.id).sort()).toEqual(['n-install', 'n-warning']);
    expect(rows[0]).toHaveProperty('record');
  });

  it('filter with no matches exits 2, empty stdout, note on stderr', () => {
    const r = run(['filter', FIXTURE, '--type', 'sem-table']);
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/no records match/i);
  });

  it('format defaults to normalised markup', () => {
    const r = ok(['format', FIXTURE]);
    expect(r.stdout).toContain('<div class="sem-fact" id="f-markup">');
    expect(r.stdout).not.toContain('<!doctype');
  });

  it('format --text renders plain text without markup', () => {
    const r = ok(['format', FIXTURE, '--text']);
    expect(r.stdout).toContain('sem-fact');
    expect(r.stdout).toContain('SemText is XHTML-first');
    expect(r.stdout).not.toContain('<div');
  });

  it('format --json carries both forms', () => {
    const r = ok(['format', FIXTURE, '--json']);
    const j = JSON.parse(r.stdout);
    expect(j.xhtml).toContain('sem-facts');
    expect(j.text).toContain('XHTML-first');
  });

  it('view is format --text', () => {
    const r = ok(['view', FIXTURE]);
    expect(r.stdout).toContain('SemText is XHTML-first');
    expect(r.stdout).not.toContain('<div');
  });

  it('expand prints one block in full', () => {
    const r = ok(['expand', FIXTURE, 'f-markup']);
    expect(r.stdout).toContain('SemText is XHTML-first');
    expect(r.stdout).toContain('One file reads as a page');
  });

  it('expand with an unknown id exits 2', () => {
    const r = run(['expand', FIXTURE, 'no-such-block']);
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).not.toBe('');
  });
});

describe('semtext pipe commands — stdin', () => {
  it('filter reads a document from stdin with "-"', () => {
    const src = execFileSync('cat', [FIXTURE], { encoding: 'utf8' });
    const r = ok(['filter', '-', '--type', 'sem-fact'], { stdin: src });
    expect(r.stdout).toContain('f-markup');
  });

  it('format reads normalised markup back down a pipe', () => {
    const markup = run(['filter', FIXTURE, '--type', 'sem-fact']).stdout;
    expect(markup).toContain('sem-fact');
    const r = ok(['format', '-', '--text'], { stdin: markup });
    expect(r.stdout).toContain('Pipelines stay plain');
    expect(r.stdout).not.toContain('<div');
  });

  it('empty stdin is a usage/parse error (exit 1)', () => {
    const r = run(['format', '-'], { stdin: '' });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/empty input/i);
  });
});

describe('semtext pipe commands — usage errors (exit 1)', () => {
  it('unknown option', () => {
    const r = run(['format', FIXTURE, '--nope']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/unknown option/);
    expect(r.stdout).toBe('');
  });

  it('unknown command', () => {
    const r = run(['frobnicate', FIXTURE]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/unknown command/);
  });

  it('unreadable file', () => {
    const r = run(['format', '/nonexistent/semtext-doc.html']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/cannot read/);
  });

  it('filter --text without a value is rejected', () => {
    const r = run(['filter', FIXTURE, '--text']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/--text expects a value/);
  });

  it('bad --depth is rejected', () => {
    const r = run(['outline', FIXTURE, '--depth', 'zero']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/--depth/);
  });

  it('tui without a terminal exits 1 with a stderr note', () => {
    const r = run(['tui', FIXTURE]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/interactive terminal/i);
    expect(r.stdout).toBe('');
  });
});
