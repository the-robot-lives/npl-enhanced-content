/**
 * Unit tests for the semtext-refresh CLI front end (src/tools/refresh-cli.js).
 *
 * Runs main() with injected output streams and a stub ctx over REAL temp
 * copies of the fixtures, asserting the exit-code contract, the per-region
 * status lines, the --check no-write guarantee, --seed idempotency, the
 * --json shape, and malformed-marker handling.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, main, UsageError } from '../../src/tools/refresh-cli.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const NOW = '2026-10-18T00:00:00Z';
const AKIT_FIXTURE = join(FIXTURES, 'refresh-doc-agent-kit.html');
const SEMEXT_FIXTURE = join(FIXTURES, 'refresh-doc-semext-annotate.html');

/** [state, writer] pairs — assert on `state.text`, pass `writer` to main. */
const collector = () => {
  const state = { text: '' };
  return [state, { write: (s) => (state.text += s) }];
};

/** A temp copy of a fixture; returns the copy's path. */
const scratch = (fixture) => {
  const dir = mkdtempSync(join(tmpdir(), 'semtext-refresh-'));
  const path = join(dir, fixture.split('/').pop());
  copyFileSync(fixture, path);
  return path;
};

const agentkitCtx = (snapshotFor, env = { AGENTONI_MCP_API_KEY: 'sk-test' }) => ({
  fetch: async (url) => {
    if (/\/oauth\/token$/.test(url)) return { ok: true, status: 200, json: async () => ({ access_token: 't' }) };
    const key = decodeURIComponent(url.match(/key=([^&]+)/)[1]);
    const result = snapshotFor(key);
    // a Response-like ({ok,status,...}) passes through; a plain object is the snapshot body
    return result && typeof result.ok === 'boolean' ? result : { ok: true, status: 200, json: async () => result };
  },
  env,
  now: () => NOW,
  execFile: async () => {
    throw new Error('ENOENT');
  },
  resolveStyleguide: () => null,
});

describe('parseArgs', () => {
  it('accepts subcommand, flags and paths', () => {
    expect(parseArgs(['all', '--check', '--json', 'web/**/*.html'])).toEqual({
      sub: 'all',
      check: true,
      seed: false,
      json: true,
      help: false,
      paths: ['web/**/*.html'],
    });
  });

  it('rejects unknown subcommands, unknown flags and an absent subcommand', () => {
    expect(() => parseArgs(['bogus', 'x.html'])).toThrow(UsageError);
    expect(() => parseArgs(['x.html'])).toThrow(/unknown subcommand "x\.html"/); // paths come after the subcommand
    expect(() => parseArgs([])).toThrow(/missing subcommand/);
    expect(() => parseArgs(['all', '--nope'])).toThrow(/unknown option/);
  });
});

describe('main — refresh pass', () => {
  it('refreshes stale regions, writes the file, prints status lines, exits 0', async () => {
    const path = scratch(AKIT_FIXTURE);
    const [outC, out] = collector();
    // AKIT-001 gets fresh content; persona-7 has no JSON child yet, so its
    // snapshot INSERTS one — both regions are genuinely refreshed.
    const code = await main(
      ['agentkit', path],
      out,
      { write: () => {} },
      agentkitCtx((key) => (key === 'AKIT-001' ? { state: 'closed', labels: [] } : { voice: 'reviewer' })),
    );
    expect(code).toBe(0);
    const updated = readFileSync(path, 'utf8');
    expect(updated).toContain('"state": "closed"'); // AKIT-001 got the fresh snapshot
    expect(updated).toContain('"voice": "reviewer"'); // persona got its first JSON child
    expect(outC.text).toContain(`region ${path}:agent-kit-issue:AKIT-001 → refreshed`);
    expect(outC.text).toContain(`region ${path}:agent-kit-user-persona:persona-7 → refreshed`);
    expect(outC.text).toMatch(/1 file, 2 refreshed, 0 unchanged, 0 skipped, 0 errors/);
  });

  it('an identical snapshot leaves a region unchanged (exit 0, no rewrite)', async () => {
    const path = scratch(SEMEXT_FIXTURE); // media region is already canonical
    const before = readFileSync(path, 'utf8');
    const [outC, out] = collector();
    const code = await main(['media', path], out, { write: () => {} }, agentkitCtx(() => ({})));
    expect(code).toBe(0);
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(outC.text).toContain('semext-media-prompt:hero.media.prompt → unchanged');
    // the other two regions belong to other adapters under `media`
    expect(outC.text).toContain('semext-annotate:annotate-demo → skipped(no-adapter)');
    expect(outC.text).toMatch(/1 file, 0 refreshed, 1 unchanged, 2 skipped, 0 errors/);
  });

  it('no credentials ⇒ every region skipped("no-credentials"), no write, exit 0', async () => {
    const path = scratch(AKIT_FIXTURE);
    const before = readFileSync(path, 'utf8');
    const [outC, out] = collector();
    const code = await main(['agentkit', path], out, { write: () => {} }, agentkitCtx(() => ({}), {}));
    expect(code).toBe(0);
    expect(readFileSync(path, 'utf8')).toBe(before); // byte-identical
    expect(outC.text).toContain('agent-kit-issue:AKIT-001 → skipped(no-credentials)');
    expect(outC.text).toContain('agent-kit-user-persona:persona-7 → skipped(no-credentials)');
  });

  it('a non-matching subcommand skips regions with "no-adapter"', async () => {
    const path = scratch(AKIT_FIXTURE);
    const [outC, out] = collector();
    const code = await main(['media', path], out, { write: () => {} }, agentkitCtx(() => ({})));
    expect(code).toBe(0);
    expect(outC.text).toContain('agent-kit-issue:AKIT-001 → skipped(no-adapter)');
  });

  it('malformed markers ⇒ exit 1 with a line+message on stderr, and no write', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'semtext-refresh-'));
    const path = join(dir, 'broken.html');
    writeFileSync(path, '<p>x</p>\n<!-- semtext:cache:end -->\n');
    const [errC, err] = collector();
    const code = await main(['all', path], { write: () => {} }, err, agentkitCtx(() => ({})));
    expect(code).toBe(1);
    expect(errC.text).toMatch(/line 2: error — cache:end without a matching cache:start/);
    expect(readFileSync(path, 'utf8')).toContain('<!-- semtext:cache:end -->'); // untouched
  });

  it('an unreadable file is a per-file error, exit 1', async () => {
    const code = await main(['all', join(tmpdir(), 'definitely-missing-9182.html')], { write: () => {} }, { write: () => {} }, agentkitCtx(() => ({})));
    expect(code).toBe(1);
  });
});

describe('main — --check', () => {
  it('timestamp-only difference is NOT drift: exit 0, no write', async () => {
    const path = scratch(AKIT_FIXTURE);
    const before = readFileSync(path, 'utf8');
    // AKIT-001's snapshot content is identical (only the stamp moves);
    // persona-7 404s, which is a SKIP — skips are never drift.
    const [outC, out] = collector();
    const code = await main(
      ['agentkit', '--check', path],
      out,
      { write: () => {} },
      agentkitCtx((key) => (key === 'AKIT-001' ? { state: 'in-progress', labels: ['extract', 'chrome'] } : { ok: false, status: 404, json: async () => ({}) })),
    );
    expect(code).toBe(0);
    expect(outC.text).toMatch(/no drift \(\d+ region\(s\) checked\)/);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('real drift ⇒ exit 1 with the one-line region list, still no write', async () => {
    const path = scratch(AKIT_FIXTURE);
    const before = readFileSync(path, 'utf8');
    const [outC, out] = collector();
    const code = await main(
      ['agentkit', '--check', path],
      out,
      { write: () => {} },
      agentkitCtx((key) => (key === 'AKIT-001' ? { state: 'closed' } : { ok: false, status: 404, json: async () => ({}) })),
    );
    expect(code).toBe(1);
    expect(outC.text).toMatch(new RegExp(`^semtext-refresh: drift in 1 region\\(s\\): ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:agent-kit-issue:AKIT-001$`, 'm'));
    expect(readFileSync(path, 'utf8')).toBe(before);
  });
});

describe('main — --seed', () => {
  const unmarked = () => {
    const dir = mkdtempSync(join(tmpdir(), 'semtext-refresh-'));
    const path = join(dir, 'unmarked.html');
    writeFileSync(
      path,
      `<body>
  <agent-kit-issue key="AKIT-77">
    <agent-kit-title>fresh</agent-kit-title>
  </agent-kit-issue>
</body>`,
    );
    return path;
  };

  it('wraps the authored element once; re-running reports already-marked', async () => {
    const path = unmarked();
    const [outC, out] = collector();
    let code = await main(['agentkit', '--seed', path], out, { write: () => {} }, agentkitCtx(() => ({})));
    expect(code).toBe(0);
    expect(outC.text).toContain('agent-kit-issue:AKIT-77 → seeded');
    const seededText = readFileSync(path, 'utf8');
    expect(seededText).toContain('<!-- semtext:cache:start agent-kit-issue AKIT-77 -->');
    expect(seededText).toContain('<!-- semtext:cache:end -->');

    const [out2C, out2] = collector();
    code = await main(['agentkit', '--seed', path], out2, { write: () => {} }, agentkitCtx(() => ({})));
    expect(code).toBe(0);
    expect(out2C.text).toContain('agent-kit-issue:AKIT-77 → already-marked');
    expect(readFileSync(path, 'utf8')).toBe(seededText); // idempotent on disk
  });

  it('--seed never talks to the network', async () => {
    const path = unmarked();
    let fetches = 0;
    const ctx = agentkitCtx(() => ({}));
    ctx.fetch = async () => {
      fetches++;
    };
    await main(['agentkit', '--seed', path], { write: () => {} }, { write: () => {} }, ctx);
    expect(fetches).toBe(0);
  });
});

describe('main — --json', () => {
  it('emits the machine shape: command, files, regions with reasons, totals', async () => {
    const path = scratch(AKIT_FIXTURE);
    const [outC, out] = collector();
    const code = await main(['agentkit', '--json', path], out, { write: () => {} }, agentkitCtx(() => ({}), {}));
    expect(code).toBe(0);
    const parsed = JSON.parse(outC.text);
    expect(parsed.command).toBe('agentkit');
    expect(parsed.check).toBe(false);
    expect(parsed.ok).toBe(true);
    expect(parsed.files).toHaveLength(1);
    const regions = parsed.files[0].regions;
    expect(regions).toHaveLength(2);
    expect(regions.map((r) => r.status)).toEqual(['skipped', 'skipped']);
    expect(regions[0].reason).toBe('no-credentials');
    expect(parsed.totals).toEqual({ refreshed: 0, unchanged: 0, skipped: 2, drift: 0, errors: 0 });
  });

  it('--check drift shows in json totals and ok:false', async () => {
    const path = scratch(AKIT_FIXTURE);
    const [outC, out] = collector();
    const code = await main(
      ['agentkit', '--check', '--json', path],
      out,
      { write: () => {} },
      agentkitCtx((key) => (key === 'AKIT-001' ? { state: 'closed' } : { ok: false, status: 404, json: async () => ({}) })),
    );
    expect(code).toBe(1);
    const parsed = JSON.parse(outC.text);
    expect(parsed.ok).toBe(false);
    expect(parsed.totals.drift).toBe(1);
  });
});

describe('main — usage', () => {
  it('--help exits 0 with the help text', async () => {
    const [outC, out] = collector();
    expect(await main(['--help'], out, { write: () => {} })).toBe(0);
    expect(outC.text).toContain('Usage: semtext-refresh');
  });

  it('no paths is a usage error (exit 2)', async () => {
    const [errC, err] = collector();
    expect(await main(['all'], { write: () => {} }, err)).toBe(2);
    expect(errC.text).toMatch(/no files given/);
  });

  it('globs expand (media over the semext fixture finds the .media.prompt region)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'semtext-refresh-'));
    copyFileSync(SEMEXT_FIXTURE, join(dir, 'doc.html'));
    const [outC, out] = collector();
    const code = await main(['media', `${join(dir, '*.html')}`], out, { write: () => {} }, agentkitCtx(() => ({})));
    expect(code).toBe(0);
    expect(outC.text).toContain('semext-media-prompt:hero.media.prompt → unchanged');
  });
});
