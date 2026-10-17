/**
 * Unit tests for the semtext-refresh adapters (src/tools/adapters.js).
 *
 * Every adapter runs against an injected ctx — fetch, env, execFile and
 * the styleguide resolver are stubs, so no test touches the network, the
 * PATH, or the real filesystem. Contract: lazy (no credentials read, no
 * fetch when no matching regions) and fail-soft (failures are per-region
 * SKIPs, never throws).
 */
import { describe, it, expect } from 'vitest';
import { ADAPTERS, pickAdapter, parseMediaPrompt, renderMediaPrompt } from '../../src/tools/adapters.js';

const NOW = '2026-10-18T00:00:00Z';

/** Minimal Response stand-in. */
const res = (status, json) => ({ ok: status >= 200 && status < 300, status, json: async () => json });

/** Route-stub fetch: maps "method url" to a response or a thrown error. */
function stubFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    const route = routes[`${(init.method || 'GET').toUpperCase()} ${url}`];
    if (route instanceof Error) throw route;
    if (!route) throw new Error(`unexpected fetch: ${init.method || 'GET'} ${url}`);
    return typeof route === 'function' ? route() : route;
  };
  fn.calls = calls;
  return fn;
}

const agentkitBody = (json) => JSON.parse(JSON.stringify(json)); // deep clone guard
const issueRegion = (over = {}) => ({
  tag: 'agent-kit-issue',
  key: 'AKIT-001',
  id: 'agent-kit-issue AKIT-001',
  body: `<agent-kit-issue key="AKIT-001" last-refreshed="2026-10-17T09:24:00Z">\n  <agent-kit-title>t</agent-kit-title>\n</agent-kit-issue>`,
  ...over,
});

describe('pickAdapter routing', () => {
  it('routes each family to its adapter', () => {
    const region = (over) => ({ tag: '', key: '', ...over });
    expect(pickAdapter('agentkit', region({ tag: 'agent-kit-board' })).label).toBe('agentkit');
    expect(pickAdapter('docptr', region({ tag: 'semext-docptr' })).label).toBe('docptr');
    expect(pickAdapter('styleguide', region({ tag: 'semext-styleguide-themes' })).label).toBe('styleguide');
    expect(pickAdapter('annotate', region({ tag: 'semext-annotate' })).label).toBe('annotate');
    expect(pickAdapter('media', region({ tag: 'sem-media-gallery', key: 'hero.media.prompt' })).label).toBe('media');
    expect(pickAdapter('agentkit', region({ tag: 'semext-annotate' }))).toBeNull();
    expect(pickAdapter('all', region({ tag: 'sem-note', key: 'k' }))).toBeNull();
  });

  it('`all` resolves each region shape to exactly the right adapter', () => {
    const cases = [
      [{ tag: 'agent-kit-persona', key: 'p1' }, 'agentkit'],
      [{ tag: 'semext-docptr', key: 'k' }, 'docptr'],
      [{ tag: 'semext-styleguide-themes', key: 'themes:index' }, 'styleguide'],
      [{ tag: 'semext-annotate', key: 'a1' }, 'annotate'],
      [{ tag: 'sem-media-gallery', key: 'hero.media.prompt' }, 'media'],
    ];
    for (const [shape, label] of cases) {
      expect(pickAdapter('all', { tag: shape.tag, key: shape.key, id: `${shape.tag} ${shape.key}` }).label).toBe(label);
    }
  });
});

describe('agentkit adapter', () => {
  const TOKEN_URL = 'https://mcp.agentoni.com/oauth/token';
  const SNAP_URL = 'https://mcp.agentoni.com/snapshots?type=ticket&key=AKIT-001';

  it('no AGENTONI_MCP_API_KEY ⇒ SKIP "no-credentials" and ZERO fetches (lazy)', async () => {
    const fetch = stubFetch({});
    const result = await ADAPTERS.agentkit.refresh(issueRegion(), { fetch, env: {}, now: () => NOW });
    expect(result).toEqual({ status: 'skipped', reason: 'no-credentials' });
    expect(fetch.calls).toHaveLength(0);
  });

  it('token exchange + snapshot 200 ⇒ refreshed body with fresh JSON and stamp', async () => {
    const fetch = stubFetch({
      [`POST ${TOKEN_URL}`]: res(200, agentkitBody({ access_token: 'tok-1' })),
      [`GET ${SNAP_URL}`]: res(200, agentkitBody({ state: 'closed', labels: ['done'] })),
    });
    const result = await ADAPTERS.agentkit.refresh(issueRegion(), { fetch, env: { AGENTONI_MCP_API_KEY: 'sk-test' }, now: () => NOW });
    expect(result.status).toBe('refreshed');
    expect(result.body).toContain('"state": "closed"');
    expect(result.body).toContain(`last-refreshed="${NOW}"`);
    expect(result.body).toContain('<agent-kit-title>t</agent-kit-title>');
    // the snapshot GET carries the exchanged bearer token, never the raw key
    expect(fetch.calls[1].init.headers.authorization).toBe('Bearer tok-1');
    expect(fetch.calls[1].url).not.toContain('sk-test');
  });

  it('token exchange 401 ⇒ SKIP "token-exchange-401"', async () => {
    const fetch = stubFetch({ [`POST ${TOKEN_URL}`]: res(401, {}) });
    const result = await ADAPTERS.agentkit.refresh(issueRegion(), { fetch, env: { AGENTONI_MCP_API_KEY: 'sk-test' }, now: () => NOW });
    expect(result).toEqual({ status: 'skipped', reason: 'token-exchange-401' });
  });

  it('snapshot 500 ⇒ SKIP "agentkit-500" (fail-soft, file continues)', async () => {
    const fetch = stubFetch({ [`POST ${TOKEN_URL}`]: res(200, { access_token: 't' }), [`GET ${SNAP_URL}`]: res(500, {}) });
    const result = await ADAPTERS.agentkit.refresh(issueRegion(), { fetch, env: { AGENTONI_MCP_API_KEY: 'sk-test' }, now: () => NOW });
    expect(result).toEqual({ status: 'skipped', reason: 'agentkit-500' });
  });

  it('network error ⇒ SKIP, not a throw', async () => {
    const fetch = stubFetch({ [`POST ${TOKEN_URL}`]: new Error('reset') });
    const result = await ADAPTERS.agentkit.refresh(issueRegion(), { fetch, env: { AGENTONI_MCP_API_KEY: 'sk-test' }, now: () => NOW });
    expect(result).toEqual({ status: 'skipped', reason: 'token-exchange-error' });
  });

  it('maps tags to snapshot kinds (issue→ticket, persona→persona, board→board)', async () => {
    const urls = [];
    const fetch = async (url, init = {}) => {
      if (/\/oauth\/token$/.test(url)) return res(200, { access_token: 't' });
      urls.push(url);
      return res(200, {});
    };
    for (const tag of ['agent-kit-issue', 'agent-kit-persona', 'agent-kit-board']) {
      await ADAPTERS.agentkit.refresh(issueRegion({ tag, key: 'k' }), {
        fetch,
        env: { AGENTONI_MCP_API_KEY: 'k' },
        now: () => NOW,
      });
    }
    expect(urls.map((u) => u.match(/type=(\w+)/)[1])).toEqual(['ticket', 'persona', 'board']);
  });
});

describe('docptr adapter', () => {
  const region = issueRegion({ tag: 'semext-docptr', key: 'repo:src/data/load.ts#resolveSource' });

  /** execFile stub that answers `which` like a machine with the CLI. */
  const execFileWith = (docPointerImpl) => async (cmd, args) => {
    if (cmd === 'which') return { stdout: '/usr/local/bin/doc-pointer\n' };
    return docPointerImpl(args);
  };

  it('CLI not on PATH ⇒ SKIP "docptr-cli-not-found"', async () => {
    const execFile = async () => {
      throw new Error('ENOENT');
    };
    const result = await ADAPTERS.docptr.refresh(region, { execFile, now: () => NOW });
    expect(result).toEqual({ status: 'skipped', reason: 'docptr-cli-not-found' });
  });

  it('empty `which` output ⇒ SKIP "docptr-cli-not-found"', async () => {
    const result = await ADAPTERS.docptr.refresh(region, { execFile: async () => ({ stdout: '' }), now: () => NOW });
    expect(result).toEqual({ status: 'skipped', reason: 'docptr-cli-not-found' });
  });

  it('lookup JSON ⇒ refreshed; key splits into --file/--function', async () => {
    const seen = [];
    const execFile = execFileWith(async (args) => {
      seen.push(['doc-pointer', ...args]);
      return { stdout: JSON.stringify({ line: 42, marker: 'x' }) };
    });
    const result = await ADAPTERS.docptr.refresh(region, { execFile, now: () => NOW });
    expect(result.status).toBe('refreshed');
    expect(result.body).toContain('"line": 42');
    expect(seen[0].slice(0, 5)).toEqual(['doc-pointer', 'lookup', '--file', 'src/data/load.ts', '--function']);
  });

  it('lookup failure ⇒ SKIP "docptr-lookup-failed"; bad JSON ⇒ SKIP "docptr-bad-json"', async () => {
    const failing = await ADAPTERS.docptr.refresh(region, {
      execFile: execFileWith(async () => {
        throw new Error('exit 1');
      }),
      now: () => NOW,
    });
    expect(failing.reason).toBe('docptr-lookup-failed');
    const bad = await ADAPTERS.docptr.refresh(region, { execFile: execFileWith(async () => ({ stdout: '<html>nope</html>' })), now: () => NOW });
    expect(bad.reason).toBe('docptr-bad-json');
  });
});

describe('styleguide adapter', () => {
  const region = issueRegion({ tag: 'semext-styleguide-themes', key: 'themes:index' });

  it('package unresolvable ⇒ SKIP "styleguide-unavailable"', async () => {
    const result = await ADAPTERS.styleguide.refresh(region, { resolveStyleguide: () => null, now: () => NOW });
    expect(result).toEqual({ status: 'skipped', reason: 'styleguide-unavailable' });
  });

  it('resolvable package with themes/tokens.json ⇒ refreshed snapshot', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'styleguide-'));
    mkdirSync(join(dir, 'themes'));
    writeFileSync(join(dir, 'themes', 'tokens.json'), JSON.stringify({ themes: ['midnight-console'] }));
    const result = await ADAPTERS.styleguide.refresh(region, { resolveStyleguide: () => dir, now: () => NOW });
    expect(result.status).toBe('refreshed');
    expect(result.body).toContain('"midnight-console"');
  });

  it('resolvable package with no token file ⇒ SKIP (fail-soft over fs errors)', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'styleguide-empty-'));
    const result = await ADAPTERS.styleguide.refresh(region, { resolveStyleguide: () => dir, now: () => NOW });
    expect(result).toEqual({ status: 'skipped', reason: 'styleguide-tokens-not-found' });
  });
});

describe('annotate adapter', () => {
  const URL = 'https://annotate.example/api/v1/sites/noizu/pages/%2Fdocs%2Fsemtext/threads';
  const region = issueRegion({ tag: 'semext-annotate', key: 'ann-1', body: '<semext-annotate site="noizu" page="/docs/semtext" last-refreshed="2026-10-17T09:14:00Z"></semext-annotate>' });

  it('threads 200 ⇒ refreshed snapshot', async () => {
    const fetch = stubFetch({ [`GET ${URL}`]: res(200, { threads: [{ id: 't9' }] }) });
    const result = await ADAPTERS.annotate.refresh(region, { fetch, env: { SEMTEXT_ANNOTATE_ENDPOINT: 'https://annotate.example/api/v1' }, now: () => NOW });
    expect(result.status).toBe('refreshed');
    expect(result.body).toContain('"t9"');
  });

  it('500 ⇒ SKIP "annotate-500"; network error ⇒ SKIP; missing attrs ⇒ SKIP', async () => {
    const e500 = await ADAPTERS.annotate.refresh(region, { fetch: stubFetch({ [`GET ${URL}`]: res(500, {}) }), env: { SEMTEXT_ANNOTATE_ENDPOINT: 'https://annotate.example/api/v1' }, now: () => NOW });
    expect(e500).toEqual({ status: 'skipped', reason: 'annotate-500' });
    const eNet = await ADAPTERS.annotate.refresh(region, { fetch: stubFetch({ [`GET ${URL}`]: new Error('boom') }), env: { SEMTEXT_ANNOTATE_ENDPOINT: 'https://annotate.example/api/v1' }, now: () => NOW });
    expect(eNet.reason).toBe('annotate-network-error');
    const noAttrs = await ADAPTERS.annotate.refresh(issueRegion({ tag: 'semext-annotate', body: '<semext-annotate key="k"></semext-annotate>' }), { fetch: stubFetch({}), env: {}, now: () => NOW });
    expect(noAttrs).toEqual({ status: 'skipped', reason: 'missing-site-or-page' });
  });
});

describe('media adapter (no network)', () => {
  const region = (body) => issueRegion({ tag: 'sem-media-gallery', key: 'hero.media.prompt', body });

  it('already-canonical body ⇒ unchanged', async () => {
    const result = await ADAPTERS.media.refresh(region('prompt: p\naspect: 16:9\n'), { now: () => NOW });
    expect(result).toEqual({ status: 'unchanged' });
  });

  it('reorders + trims to canonical form ⇒ refreshed (newline skeleton kept)', async () => {
    const result = await ADAPTERS.media.refresh(region('aspect:   16:9\n\n# a comment\nprompt: p\n'), { now: () => NOW });
    expect(result.status).toBe('refreshed');
    expect(result.body).toBe('prompt: p\naspect: 16:9\n');
  });

  it('unknown key, missing prompt, bad aspect, non-integer seed ⇒ SKIP', async () => {
    const run = (body) => ADAPTERS.media.refresh(region(body), { now: () => NOW });
    expect((await run('tone: warm\nprompt: p\n')).reason).toMatch(/unknown key "tone"/);
    expect((await run('aspect: 16:9\n')).reason).toMatch(/missing prompt/);
    expect((await run('prompt: p\naspect: 7:3\n')).reason).toMatch(/unknown aspect/);
    expect((await run('prompt: p\nseed: abc\n')).reason).toMatch(/seed must be an integer/);
  });

  it('parse/render round-trips standalone', () => {
    expect(renderMediaPrompt(parseMediaPrompt('seed: 7\nprompt: p\nnegative: blurry\n').fields)).toBe(
      'prompt: p\nnegative: blurry\nseed: 7\n',
    );
    expect(parseMediaPrompt('no-colon-line').error).toMatch(/not key: value/);
  });
});
