/**
 * stamp-version — the versioned snapshot must carry the WHOLE artifact set
 * (shell-v3 integration TODO 13).
 *
 * Readers get semtext.js; the shell/editor/agent opt-ins, every
 * semtext-pkg-*.js package chunk and every worker-*.js module worker must
 * land in dist/v<version>/ too — a versioned URL that 404s on
 * semtext-pkg-jq.js is a broken shell, not a smaller one.
 *
 * The script runs for real (execFile) against a sandbox dist via --root.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

vi.setConfig({ testTimeout: 5_000 });

const scriptPath = resolve(fileURLToPath(import.meta.url), '../../../scripts/stamp-version.mjs');
const sandbox = mkdtempSync(join(tmpdir(), 'stamp-version-test-'));
const version = '9.9.9-test.1';

// Sandbox: package.json + a dist with one artifact per family.
mkdirSync(join(sandbox, 'dist'), { recursive: true });
writeFileSync(join(sandbox, 'package.json'), JSON.stringify({ version, specVersion: '1.0.0' }));
for (const f of [
  'semtext.js',
  'semtext-editor.js',
  'semtext-agent.js',
  'semtext-pkg-awk.js',
  'semtext-pkg-jq.js',
  'semtext-pkg-text.js',
  'worker-wasm.js',
  'worker-parse.js',
  'semext.js',
  'semext-lazy.js',
  'semext-manifest.json',
  'agent-kit.js',
  'agent-kit-lazy.js',
  'agent-kit-manifest.json',
  'semtext-not-stamped.txt', // not a bundle family: must NOT be copied
]) {
  writeFileSync(join(sandbox, 'dist', f), `// ${f}\n`);
}
for (const d of ['chunks', 'npl-chunks', 'semext-chunks', 'agent-kit-chunks', 'themes']) {
  mkdirSync(join(sandbox, 'dist', d), { recursive: true });
  writeFileSync(join(sandbox, 'dist', d, 'keep.js'), `// ${d}/keep.js\n`);
}

const ran = execFileSync(process.execPath, [scriptPath, '--root', sandbox], { encoding: 'utf8' });

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('stamp-version', () => {
  const vDir = join(sandbox, `dist/v${version}`);

  it('exits reporting the stamp', () => {
    expect(ran).toContain(`dist/v${version}/`);
  });

  it('stamps the reader bundle, editor and agent opt-ins', () => {
    for (const f of ['semtext.js', 'semtext-editor.js', 'semtext-agent.js']) {
      expect(existsSync(join(vDir, f)), f).toBe(true);
    }
  });

  it('stamps every semtext-pkg-*.js package chunk', () => {
    for (const f of ['semtext-pkg-awk.js', 'semtext-pkg-jq.js', 'semtext-pkg-text.js']) {
      expect(existsSync(join(vDir, f)), f).toBe(true);
    }
  });

  it('stamps every worker-*.js module worker', () => {
    for (const f of ['worker-wasm.js', 'worker-parse.js']) {
      expect(existsSync(join(vDir, f)), f).toBe(true);
    }
  });

  it('stamps the Phase-7 extension families (semext, agent-kit)', () => {
    for (const f of [
      'semext.js',
      'semext-lazy.js',
      'semext-manifest.json',
      'agent-kit.js',
      'agent-kit-lazy.js',
      'agent-kit-manifest.json',
    ]) {
      expect(existsSync(join(vDir, f)), f).toBe(true);
    }
    for (const d of ['semext-chunks', 'agent-kit-chunks']) {
      expect(existsSync(join(vDir, d, 'keep.js')), d).toBe(true);
    }
  });

  it('copies bytes verbatim and leaves non-bundle files alone', () => {
    expect(readFileSync(join(vDir, 'semtext-pkg-jq.js'), 'utf8')).toBe('// semtext-pkg-jq.js\n');
    expect(existsSync(join(vDir, 'semtext-not-stamped.txt'))).toBe(false);
  });

  it('records the stamped set in version.json', () => {
    const manifest = JSON.parse(readFileSync(join(sandbox, 'dist', 'version.json'), 'utf8'));
    expect(manifest.version).toBe(version);
    for (const f of ['semtext-editor.js', 'semtext-pkg-awk.js', 'worker-wasm.js']) {
      expect(manifest.files, f).toContain(f);
    }
  });
});
