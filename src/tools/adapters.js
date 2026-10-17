/**
 * adapters — the per-service refresh adapters behind bin/semtext-refresh.
 *
 * Each adapter owns one family of cache regions and is a thin module:
 * match the region, fetch/derive fresh content, return a status. Every
 * adapter is fail-soft — a failure is a per-region SKIP with a reason,
 * never a thrown error and never an aborted file — and every network /
 * subprocess / package access flows through the injected `ctx`, so unit
 * tests stub behaviour without touching globals:
 *
 *   ctx = {
 *     fetch,             // (url, init) => Promise<Response>
 *     env,               // process.env-shaped object
 *     now,               // () => ISO-8601 string
 *     execFile,          // (cmd, args) => Promise<{stdout, stderr}>
 *     resolveStyleguide, // () => styleguide package dir | null
 *   }
 *
 * Adapters are LAZY: the CLI invokes one only when the targeted files
 * actually contain a matching region, so a document with no agent-kit
 * regions never reads AGENTONI_MCP_API_KEY (by name only — the value
 * itself never appears in logs or output).
 */

import { applySnapshot, parseOpenTagAttrs } from './cache-splicer.js';

/** Adapter order for `all` — specific tag matches before the agent-kit
 *  prefix, so no matcher can shadow another. */
export const ADAPTER_ORDER = ['docptr', 'styleguide', 'annotate', 'media', 'agentkit'];

export const ADAPTERS = {
  agentkit: {
    label: 'agentkit',
    match: (r) => r.tag.startsWith('agent-kit-'),
    refresh: refreshAgentKit,
  },
  docptr: {
    label: 'docptr',
    match: (r) => r.tag === 'semext-docptr',
    refresh: refreshDocptr,
  },
  styleguide: {
    label: 'styleguide',
    match: (r) => r.tag === 'semext-styleguide-themes',
    refresh: refreshStyleguide,
  },
  annotate: {
    label: 'annotate',
    match: (r) => r.tag === 'semext-annotate',
    refresh: refreshAnnotate,
  },
  media: {
    label: 'media',
    match: (r) => /\.media\.prompt$/.test(r.key),
    refresh: refreshMedia,
  },
};

/** The adapter for a subcommand + region, or null when nothing applies. */
export function pickAdapter(subcommand, region) {
  if (subcommand !== 'all') {
    const a = ADAPTERS[subcommand];
    return a && a.match(region) ? a : null;
  }
  for (const name of ADAPTER_ORDER) {
    if (ADAPTERS[name].match(region)) return ADAPTERS[name];
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * agentkit — AgentOni MCP snapshots (tickets / personas / boards)
 * ------------------------------------------------------------------ */

/**
 * Env AGENTONI_MCP_API_KEY set → in-memory key-for-token exchange, then
 * one snapshot GET per region. Unset ⇒ SKIP "no-credentials" (never a
 * crash). Any non-2xx ⇒ SKIP with the short reason; the key value itself
 * is never logged or echoed.
 */
async function refreshAgentKit(region, ctx) {
  const apiKey = ctx.env.AGENTONI_MCP_API_KEY;
  if (!apiKey) return { status: 'skipped', reason: 'no-credentials' };
  const base = (ctx.env.AGENTONI_MCP_URL || 'https://mcp.agentoni.com').replace(/\/$/, '');
  let token;
  try {
    const res = await ctx.fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'api_key', api_key: apiKey }),
    });
    if (!res.ok) return { status: 'skipped', reason: `token-exchange-${res.status}` };
    token = (await res.json()).access_token;
  } catch (e) {
    return { status: 'skipped', reason: `token-exchange-error` };
  }
  if (!token) return { status: 'skipped', reason: 'token-exchange-empty' };
  const kind = agentKitKind(region.tag);
  let res;
  try {
    res = await ctx.fetch(`${base}/snapshots?type=${kind}&key=${encodeURIComponent(region.key)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (e) {
    return { status: 'skipped', reason: 'agentkit-network-error' };
  }
  if (!res.ok) return { status: 'skipped', reason: `agentkit-${res.status}` };
  const json = await res.json();
  return { status: 'refreshed', body: applySnapshot(region.body, json, ctx.now()) };
}

/** agent-kit-<token> → the AgentOni snapshot type the token mirrors. */
function agentKitKind(tag) {
  if (/-issue(-|$)/.test(tag)) return 'ticket';
  if (/-persona(-|$)/.test(tag)) return 'persona';
  if (/-board(-|$)/.test(tag)) return 'board';
  return 'snapshot';
}

/* ------------------------------------------------------------------ *
 * docptr — doc-pointer CLI lookup
 * ------------------------------------------------------------------ */

/**
 * Shell out to the local `doc-pointer` CLI when it is on PATH; missing
 * CLI ⇒ SKIP "docptr-cli-not-found". The region key's
 * `family:repo:path#symbol` shape maps to `--file`/`--function` lookup
 * flags; anything else is passed as `--key`.
 */
async function refreshDocptr(region, ctx) {
  let cliPath;
  try {
    const which = await ctx.execFile('which', ['doc-pointer']);
    cliPath = (which.stdout || '').trim().split('\n')[0];
  } catch (e) {
    return { status: 'skipped', reason: 'docptr-cli-not-found' };
  }
  if (!cliPath) return { status: 'skipped', reason: 'docptr-cli-not-found' };
  const args = docptrLookupArgs(region.key);
  let stdout;
  try {
    const run = await ctx.execFile(cliPath, [...args, '--json']);
    stdout = run.stdout;
  } catch (e) {
    return { status: 'skipped', reason: 'docptr-lookup-failed' };
  }
  let json;
  try {
    json = JSON.parse(stdout);
  } catch (e) {
    return { status: 'skipped', reason: 'docptr-bad-json' };
  }
  return { status: 'refreshed', body: applySnapshot(region.body, json, ctx.now()) };
}

function docptrLookupArgs(key) {
  const hash = key.lastIndexOf('#');
  const path = hash === -1 ? '' : key.slice(key.lastIndexOf(':', hash - 1) + 1, hash);
  if (hash !== -1 && path) {
    return ['lookup', '--file', path, '--function', key.slice(hash + 1)];
  }
  return ['lookup', '--key', key];
}

/* ------------------------------------------------------------------ *
 * styleguide — @noizu/styleguide theme tokens
 * ------------------------------------------------------------------ */

/**
 * Read the @noizu/styleguide token file when the package is resolvable
 * from this checkout (it is NOT a dependency — unresolvable ⇒ SKIP
 * "styleguide-unavailable").
 */
async function refreshStyleguide(region, ctx) {
  const dir = ctx.resolveStyleguide();
  if (!dir) return { status: 'skipped', reason: 'styleguide-unavailable' };
  const { readFileSync } = await import('node:fs');
  for (const rel of ['themes/tokens.json', 'tokens.json']) {
    try {
      const json = JSON.parse(readFileSync(`${dir}/${rel}`, 'utf8'));
      return { status: 'refreshed', body: applySnapshot(region.body, json, ctx.now()) };
    } catch (e) {
      /* try the next layout */
    }
  }
  return { status: 'skipped', reason: 'styleguide-tokens-not-found' };
}

/* ------------------------------------------------------------------ *
 * annotate — public comment threads
 * ------------------------------------------------------------------ */

/**
 * GET the public threads endpoint for the region's site/page attributes.
 * Endpoint base overridable via SEMTEXT_ANNOTATE_ENDPOINT; any non-2xx
 * or missing attributes ⇒ SKIP.
 */
async function refreshAnnotate(region, ctx) {
  const attrs = parseOpenTagAttrs(region.body);
  if (!attrs.site || !attrs.page) return { status: 'skipped', reason: 'missing-site-or-page' };
  const base = (ctx.env.SEMTEXT_ANNOTATE_ENDPOINT || 'https://annotate.noizu.com/api/v1').replace(/\/$/, '');
  let res;
  try {
    res = await ctx.fetch(`${base}/sites/${encodeURIComponent(attrs.site)}/pages/${encodeURIComponent(attrs.page)}/threads`);
  } catch (e) {
    return { status: 'skipped', reason: 'annotate-network-error' };
  }
  if (!res.ok) return { status: 'skipped', reason: `annotate-${res.status}` };
  const json = await res.json();
  return { status: 'refreshed', body: applySnapshot(region.body, json, ctx.now()) };
}

/* ------------------------------------------------------------------ *
 * media — validate + normalize `.media.prompt` YAML regions (no network)
 * ------------------------------------------------------------------ */

const MEDIA_KEYS = ['prompt', 'negative', 'aspect', 'seed'];
const MEDIA_ASPECTS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '21:9']);

/**
 * The media adapter never touches the network (Asset generation is out
 * of scope): it validates the region's `.media.prompt` key/value YAML
 * and re-renders it in canonical key order with trimmed values. The
 * body's leading-newline skeleton is preserved so the splice never glues
 * the end marker to the content. Already-canonical bodies are
 * `unchanged`; unknown keys, an empty prompt, a non-integer seed or an
 * unknown aspect ⇒ SKIP "invalid-media-prompt".
 */
async function refreshMedia(region, ctx) {
  const parsed = parseMediaPrompt(region.body);
  if (parsed.error) return { status: 'skipped', reason: `invalid-media-prompt: ${parsed.error}` };
  // The whitespace skeleton (leading newline, trailing indent before the
  // end marker) belongs to the document — canonicalize only the content.
  const lead = /^[ \t]*\n/.exec(region.body)?.[0] ?? '';
  const tail = /\n[ \t]*$/.exec(region.body)?.[0];
  const canonical = renderMediaPrompt(parsed.fields);
  const normalized = lead + canonical.replace(/\n$/, '') + (tail ?? (canonical.endsWith('\n') ? '\n' : ''));
  if (normalized === region.body) return { status: 'unchanged' };
  return { status: 'refreshed', body: normalized };
}

/** Parse `key: value` lines; `#` comments and blank lines ignored. */
export function parseMediaPrompt(text) {
  const fields = {};
  for (const [i, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) return { error: `line ${i + 1}: not key: value — "${line}"` };
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (!MEDIA_KEYS.includes(key)) return { error: `line ${i + 1}: unknown key "${key}"` };
    if (key in fields) return { error: `line ${i + 1}: duplicate key "${key}"` };
    if (!value) return { error: `line ${i + 1}: empty value for "${key}"` };
    fields[key] = value;
  }
  if (!fields.prompt) return { error: 'missing prompt' };
  if (fields.aspect && !MEDIA_ASPECTS.has(fields.aspect)) return { error: `unknown aspect "${fields.aspect}"` };
  if (fields.seed && !/^\d+$/.test(fields.seed)) return { error: `seed must be an integer, got "${fields.seed}"` };
  return { fields };
}

/** Canonical render: prompt, negative, aspect, seed; trailing newline. */
export function renderMediaPrompt(fields) {
  return MEDIA_KEYS.filter((k) => fields[k] !== undefined)
    .map((k) => `${k}: ${fields[k]}`)
    .join('\n') + '\n';
}
