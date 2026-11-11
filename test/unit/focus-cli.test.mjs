// Contract tests — `focus` + markdown sections through both CLIs.
//
// Each case spawns the real CLI as a child process (pipe: bin/semtext.mjs,
// agent: bin/semtext-agent.mjs) with a SANITISED env — no provider keys,
// XDG dirs pointed at a per-test tmp root — and checks exit codes, stdout
// bytes and the JSON contract shapes. Exit contracts: pipe 0/1/2, agent
// 0/1/2 (usage=2, domain=1).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const HERE = dirname(fileURLToPath(new URL(import.meta.url)));
const PIPE = join(HERE, '../../bin/semtext.mjs');
const AGENT = join(HERE, '../../bin/semtext-agent.mjs');

let root;

/** Env with provider keys stripped and XDG dirs inside the test root. */
function cleanEnv(over = {}) {
  const env = {};
  for (const k of ['PATH', 'HOME', 'TMPDIR', 'LANG']) if (process.env[k]) env[k] = process.env[k];
  mkdirSync(join(root, 'config'), { recursive: true });
  env.XDG_CONFIG_HOME = join(root, 'config');
  env.XDG_CACHE_HOME = join(root, 'cache');
  env.SEMTEXT_CACHE_DIR = join(root, 'cache');
  return { ...env, ...over };
}

function run(bin, args, { env = {}, cwd, stdin = '' } = {}) {
  let stdout = '';
  let stderr = '';
  let code = 0;
  try {
    stdout = execFileSync(process.execPath, [bin, ...args], {
      encoding: 'utf8',
      input: stdin,
      cwd: cwd || HERE,
      env: cleanEnv(env)
    });
  } catch (e) {
    code = e.status ?? 1;
    stdout = e.stdout ?? '';
    stderr = e.stderr ?? '';
  }
  return { code, stdout, stderr };
}

const MD_DOC = [
  '# Guide',
  '',
  '## Deploy',
  'Run the ship pipeline through CI only.',
  '',
  '### Rollback',
  'Roll back to the previous chart tag.',
  '',
  '## Tail',
  'Miscellaneous tail remarks.'
].join('\n');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'semtext-focus-cli-'));
  writeFileSync(join(root, 'doc.md'), MD_DOC);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('markdown sections through the pipe CLI', () => {
  it('outline lists minted + authored section ids', () => {
    const r = run(PIPE, ['outline', join(root, 'doc.md')]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('[x-sec-deploy]');
    expect(r.stdout).toContain('[x-sec-rollback]');
    expect(r.stdout).toContain('[x-sec-tail]');
  });

  it('outline --json parses and nests children', () => {
    const r = run(PIPE, ['outline', join(root, 'doc.md'), '--json']);
    expect(r.code).toBe(0);
    const nodes = JSON.parse(r.stdout);
    expect(nodes[0].id).toBe('x-sec-guide');
    const deploy = nodes[0].children[0];
    expect(deploy.id).toBe('x-sec-deploy');
    expect(deploy.children.map((c) => c.id)).toEqual(['x-sec-rollback']);
  });

  it('expand returns the annotated section body', () => {
    const r = run(PIPE, ['expand', join(root, 'doc.md'), 'x-sec-deploy']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('[x-sec-deploy] section');
    expect(r.stdout).toContain('### Rollback');
    expect(r.stdout).not.toContain('tail remarks');
  });

  it('filter selects markdown sections (raw slices; ids via --json)', () => {
    const r = run(PIPE, ['filter', join(root, 'doc.md'), '--text', 'chart tag']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Roll back to the previous chart tag.');
    const j = run(PIPE, ['filter', join(root, 'doc.md'), '--text', 'chart tag', '--json']);
    const ids = JSON.parse(j.stdout).map((h) => h.id);
    // deploy's span includes nested Rollback, so parent and child both match
    expect(ids).toContain('x-sec-rollback');
    expect(ids).toContain('x-sec-deploy');
    expect(ids).not.toContain('x-sec-tail');
  });
});

describe('markdown sections through the agent CLI', () => {
  it('outline --json carries the section contract', () => {
    const r = run(AGENT, ['outline', join(root, 'doc.md'), '--json']);
    expect(r.code).toBe(0);
    const nodes = JSON.parse(r.stdout);
    expect(nodes[0].id).toBe('x-sec-guide');
    expect(nodes[0].type).toBe('section');
    expect(nodes[0].children.map((c) => c.id)).toEqual(['x-sec-deploy', 'x-sec-tail']);
  });

  it('expand returns the raw slice for --format xhtml', () => {
    const r = run(AGENT, ['expand', join(root, 'doc.md'), 'x-sec-deploy', '--format', 'xhtml']);
    expect(r.code).toBe(0);
    expect(r.stdout.startsWith('## Deploy')).toBe(true);
  });
});

describe('focus — no-llm + dry-run (no credentials needed)', () => {
  it('--no-llm falls back to first-90 and writes the task ledger', () => {
    const r = run(PIPE, ['focus', join(root, 'doc.md'), '--purpose', 'ship the service', '--no-llm']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Roll back to the previous chart tag.');
    expect(existsSync(join(root, 'cache', 'tasks.jsonl'))).toBe(true);
  });

  it('--no-llm --format json reports zero calls', () => {
    const r = run(PIPE, ['focus', join(root, 'doc.md'), '--purpose', 'ship the service', '--no-llm', '--format', 'json']);
    expect(r.code).toBe(0);
    const payload = JSON.parse(r.stdout);
    expect(payload.stats.classifier_calls).toBe(0);
    expect(payload.stats.summarizer_calls).toBe(0);
    expect(payload.sections.length).toBe(4);
    for (const s of payload.sections) expect(s.relevant).toBe(true);
  });

  it('--dry-run prints planned calls and touches no cache', () => {
    const r = run(PIPE, ['focus', join(root, 'doc.md'), '--purpose', 'ship the service', '--dry-run']);
    expect(r.code).toBe(0);
    const payload = JSON.parse(r.stdout);
    expect(Array.isArray(payload.planned_calls)).toBe(true);
    expect(payload.planned_calls.length).toBeGreaterThanOrEqual(2);
    const kinds = new Set(payload.planned_calls.map((p) => p.kind));
    expect(kinds.has('classifier')).toBe(true);
    expect(kinds.has('summarizer')).toBe(true);
    expect(existsSync(join(root, 'cache'))).toBe(false); // dry-run writes nothing
  });

  it('second --no-llm run reuses the task (json task_reused=true)', () => {
    run(PIPE, ['focus', join(root, 'doc.md'), '--purpose', 'ship the service', '--no-llm']);
    const r = run(PIPE, ['focus', join(root, 'doc.md'), '--purpose', 'ship the service', '--no-llm', '--format', 'json']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).task_reused).toBe(true);
  });
});

describe('focus — credentials (env var NAMES in errors, never values)', () => {
  it('missing alibaba creds error names the env vars and suggests --no-llm', () => {
    const r = run(PIPE, ['focus', join(root, 'doc.md'), '--purpose', 'ship it']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('QWEN_DECISION_BASE_URL');
    expect(r.stderr).toContain('QWEN_API_KEY');
    expect(r.stderr).toContain('--no-llm');
    expect(r.stdout).toBe('');
  });

  it('--classifier jev switches the named env vars', () => {
    const r = run(PIPE, ['focus', join(root, 'doc.md'), '--purpose', 'ship it', '--classifier', 'jev']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('JEV_API_KEY or TYPESAFE_API_KEY');
  });

  it('config file classifier beats the default; the flag beats the config', () => {
    writeFileSync(join(root, 'config.yaml'), 'classifier: jev\n');
    const cfg = { SEMTEXT_CONFIG: join(root, 'config.yaml') };
    const viaConfig = run(PIPE, ['focus', join(root, 'doc.md'), '--purpose', 'ship it'], { env: cfg });
    expect(viaConfig.stderr).toContain('JEV_API_KEY');
    const viaFlag = run(PIPE, ['focus', join(root, 'doc.md'), '--purpose', 'ship it', '--classifier', 'alibaba'], { env: cfg });
    expect(viaFlag.stderr).toContain('QWEN_DECISION_BASE_URL');
  });

  it('missing --purpose is a usage error on both exit contracts', () => {
    const pipe = run(PIPE, ['focus', join(root, 'doc.md')]);
    expect(pipe.code).toBe(1);
    expect(pipe.stderr).toContain('--purpose');
    const agent = run(AGENT, ['focus', join(root, 'doc.md')]);
    expect(agent.code).toBe(2);
    expect(agent.stderr).toContain('--purpose');
  });
});

describe('focus — write-back (pipe CLI)', () => {
  it('inserts data-auto tldrs and is byte-idempotent on rerun', () => {
    const file = join(root, 'doc.md');
    const args = ['focus', 'doc.md', '--purpose', 'ship the service', '--no-llm', '--write-back'];
    const r1 = run(PIPE, args, { cwd: root });
    expect(r1.code).toBe(0);
    const after1 = readFileSync(file, 'utf8');
    expect(after1).toContain('<sem-tldr data-auto data-digest="');
    expect(after1).toContain('>Run the ship pipeline through CI only.</sem-tldr>');
    const r2 = run(PIPE, args, { cwd: root });
    expect(r2.code).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(after1);
  });

  it('refuses to write outside the working directory (agent CLI guard)', () => {
    const outside = mkdtempSync(join(tmpdir(), 'semtext-outside-'));
    try {
      const file = join(outside, 'doc.md');
      writeFileSync(file, MD_DOC);
      const r = run(AGENT, ['focus', file, '--purpose', 'ship it', '--no-llm', '--write-back'], { cwd: root });
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('outside the working directory');
      expect(readFileSync(file, 'utf8')).toBe(MD_DOC); // untouched
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('agent CLI focus defaults to JSON', () => {
  it('--no-llm emits the contract payload without --format', () => {
    const r = run(AGENT, ['focus', join(root, 'doc.md'), '--purpose', 'ship the service', '--no-llm']);
    expect(r.code).toBe(0);
    const payload = JSON.parse(r.stdout);
    expect(payload).toHaveProperty('task_id');
    expect(payload).toHaveProperty('task_reused');
    expect(payload.sections[0]).toHaveProperty('id');
    expect(payload.sections[0]).toHaveProperty('relevant');
    expect(payload.sections[0]).toHaveProperty('tldr');
    expect(payload.stats).toHaveProperty('cache_hits');
  });
});

describe('write-notes block', () => {
  it('--no-llm --write-notes appends a footnote block (no notes under no-llm)', () => {
    const file = join(root, 'doc.md');
    const r = run(PIPE, ['focus', 'doc.md', '--purpose', 'ship the service', '--no-llm', '--write-notes'], { cwd: root });
    expect(r.code).toBe(0);
    // --no-llm generates no notes, so the file only carries the write-back tldrs
    expect(readFileSync(file, 'utf8')).toContain('data-auto');
    expect(readFileSync(file, 'utf8')).not.toContain('semtext:focus footnotes');
  });
});
