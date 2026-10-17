/**
 * semtext-refresh — CLI front end (authoring plan Phase 7).
 *
 * Usage:
 *   semtext-refresh <subcommand> [options] <file-or-glob>...
 *
 * Subcommands (the adapter to run; `all` = every adapter over its own
 * regions): agentkit | docptr | styleguide | annotate | media | all
 *
 * Options:
 *   --check    drift detection: run every adapter read-only, compare
 *              timestamp-normalized bodies, exit 1 on real drift, NEVER
 *              write
 *   --seed     author initial cache regions into files lacking markers
 *              (wraps authored elements in the subcommand's family; no
 *              adapter/network traffic runs)
 *   --json     machine output (one object on stdout)
 *   -h, --help
 *
 * Per-region status line (text mode):
 *   region <file>:<tag>:<key> → refreshed|unchanged|drift|skipped(<reason>)
 *
 * Exit codes: 0 clean / no drift · 1 drift, malformed markers, or a
 * domain error · 2 usage error (bad subcommand or flags, no paths,
 * unreadable schema).
 *
 * Cache-region contract: `src/tools/cache-splicer.js` (pure, tested).
 * Adapters: `src/tools/adapters.js` (lazy + fail-soft — a region without
 * credentials or with an unreachable service SKIPs, it never aborts the
 * file, and no secret value is ever read beyond the named env var).
 */

import { globSync, readFileSync, writeFileSync } from 'node:fs';
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadSchema, defaultSchemaPath } from '../validate/validate.js';
import {
  parseCacheRegions,
  applyCacheRegions,
  normalizeTimestamps,
  seedCacheRegions,
  findAuthoredElements,
} from './cache-splicer.js';
import { pickAdapter, ADAPTERS, ADAPTER_ORDER } from './adapters.js';

export const SUBCOMMANDS = ['agentkit', 'docptr', 'styleguide', 'annotate', 'media', 'all'];

export class UsageError extends Error {}

export function parseArgs(argv) {
  const opts = { sub: null, check: false, seed: false, json: false, help: false, paths: [] };
  let sawSub = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') opts.check = true;
    else if (a === '--seed') opts.seed = true;
    else if (a === '--json') opts.json = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a.startsWith('--')) throw new UsageError(`unknown option "${a}"`);
    else if (!sawSub) {
      if (!SUBCOMMANDS.includes(a)) throw new UsageError(`unknown subcommand "${a}" (want: ${SUBCOMMANDS.join(' | ')})`);
      opts.sub = a;
      sawSub = true;
    } else {
      opts.paths.push(a);
    }
  }
  if (!sawSub && !opts.help) throw new UsageError(`missing subcommand (want: ${SUBCOMMANDS.join(' | ')})`);
  return opts;
}

export function main(argv = process.argv.slice(2), out = process.stdout, err = process.stderr, ctx = defaultCtx()) {
  return (async () => {
    let opts;
    try {
      opts = parseArgs(argv);
    } catch (e) {
      err.write(`semtext-refresh: ${e.message}\n`);
      return 2;
    }
    if (opts.help) {
      out.write(HELP);
      return 0;
    }
    if (opts.paths.length === 0) {
      err.write('semtext-refresh: no files given — pass file paths or globs\n');
      return 2;
    }

    let knownTags;
    let cachedRoots;
    try {
      const schema = loadSchema(defaultSchemaPath());
      knownTags = new Set(Object.keys(schema.$defs));
      for (const def of Object.values(schema.$defs)) {
        for (const alias of def.tagAliases || []) knownTags.add(alias);
      }
      // Snapshot-ROOT elements (the ones a region wraps) are exactly the
      // cachedEmbed-backed defs — child parts (titles, criteria, states)
      // are never seed candidates.
      cachedRoots = new Set(
        Object.entries(schema.$defs)
          .filter(([, d]) => [].concat(d.extends || []).includes('cachedEmbed'))
          .map(([name]) => name),
      );
    } catch (e) {
      err.write(`semtext-refresh: cannot load schema — ${e.message}\n`);
      return 2;
    }

    // Expand globs relative to cwd; plain paths pass through (missing
    // files surface as read errors per file).
    const files = new Set();
    for (const p of opts.paths) {
      const matches = globSync(p);
      if (matches.length > 0) for (const m of matches) files.add(m);
      else files.add(p);
    }

    const fileReports = [];
    const totals = { refreshed: 0, unchanged: 0, skipped: 0, drift: 0, errors: 0 };
    for (const file of [...files].sort()) fileReports.push(await processFile(file, opts, knownTags, cachedRoots, ctx, totals));

    const exit = totals.errors > 0 || (opts.check && totals.drift > 0) ? 1 : 0;

    if (opts.json) {
      out.write(JSON.stringify({ command: opts.sub, check: opts.check, seed: opts.seed, ok: exit === 0, files: fileReports, totals }, null, 2) + '\n');
      return exit;
    }

    if (opts.check) {
      // One-line contract: drift names the regions; clean says so.
      const drifted = fileReports.flatMap((f) => f.regions.filter((r) => r.status === 'drift').map((r) => `${f.file}:${r.tag}:${r.key}`));
      out.write(
        drifted.length === 0
          ? `semtext-refresh: no drift (${totals.refreshed + totals.unchanged + totals.drift + totals.skipped} region(s) checked)\n`
          : `semtext-refresh: drift in ${drifted.length} region(s): ${drifted.slice(0, 5).join(', ')}${drifted.length > 5 ? `, +${drifted.length - 5} more` : ''}\n`,
      );
      return exit;
    }

    for (const f of fileReports) {
      for (const e of f.errors) err.write(`${f.file}: ${e}\n`);
      for (const r of f.regions) {
        const head = opts.seed ? 'seed' : 'region';
        const tail = r.reason ? `(${r.reason})` : '';
        out.write(`${head} ${f.file}:${r.tag}:${r.key} → ${r.status}${tail}\n`);
      }
    }
    const nFiles = fileReports.length;
    out.write(
      `\n${nFiles} file${nFiles === 1 ? '' : 's'}, ${totals.refreshed} refreshed, ${totals.unchanged} unchanged, ${totals.skipped} skipped, ${totals.errors} error${totals.errors === 1 ? '' : 's'}\n`,
    );
    return exit;
  })();
}

/** One file: parse regions, run the pass, write when allowed. */
async function processFile(file, opts, knownTags, cachedRoots, ctx, totals) {
  const report = { file, readError: null, errors: [], written: false, regions: [] };
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch (e) {
    report.readError = e.message;
    totals.errors++;
    return report;
  }

  const parsed = parseCacheRegions(source, knownTags);
  if (parsed.errors.length > 0) {
    for (const e of parsed.errors) {
      report.errors.push(`line ${lineOf(source, e.offset)}: error — ${e.message}`);
      totals.errors++;
    }
    return report;
  }

  if (opts.seed) return seedPass(file, source, opts, knownTags, cachedRoots, parsed, report, totals);

  const updates = new Map();
  for (const region of parsed.regions) {
    const adapter = pickAdapter(opts.sub, region);
    if (!adapter) {
      report.regions.push({ tag: region.tag, key: region.key, status: 'skipped', reason: 'no-adapter' });
      totals.skipped++;
      continue;
    }
    let result;
    try {
      result = await adapter.refresh(region, ctx);
    } catch (e) {
      result = { status: 'skipped', reason: 'adapter-error' };
    }
    if (result.status === 'refreshed') {
      if (opts.check) {
        const drifted = normalizeTimestamps(result.body) !== normalizeTimestamps(region.body);
        report.regions.push({ tag: region.tag, key: region.key, status: drifted ? 'drift' : 'unchanged' });
        if (drifted) totals.drift++;
        else totals.unchanged++;
      } else if (result.body !== region.body) {
        updates.set(region.id, result.body);
        report.regions.push({ tag: region.tag, key: region.key, status: 'refreshed' });
        totals.refreshed++;
      } else {
        report.regions.push({ tag: region.tag, key: region.key, status: 'unchanged' });
        totals.unchanged++;
      }
    } else if (result.status === 'unchanged') {
      report.regions.push({ tag: region.tag, key: region.key, status: 'unchanged' });
      totals.unchanged++;
    } else {
      report.regions.push({ tag: region.tag, key: region.key, ...result });
      totals.skipped++;
    }
  }

  if (!opts.check && updates.size > 0) {
    writeFileSync(file, applyCacheRegions(source, updates));
    report.written = true;
  }
  return report;
}

/** --seed: wrap authored family elements that lack markers. No network. */
function seedPass(file, source, opts, knownTags, cachedRoots, parsed, report, totals) {
  const wanted = seedTags(opts.sub, cachedRoots);
  const candidates = new Map();
  for (const tag of wanted) {
    for (const el of findAuthoredElements(source, tag)) {
      const key = el.attrs.key || el.attrs.id;
      const id = `${tag} ${key}`;
      if (!key) {
        report.regions.push({ tag, key: '-', status: 'skipped', reason: 'no-key' });
        totals.skipped++;
        continue;
      }
      if (candidates.has(id)) {
        report.regions.push({ tag, key, status: 'skipped', reason: 'duplicate-key' });
        totals.skipped++;
        continue;
      }
      const inside = parsed.regions.some((r) => el.openIndex >= r.startOffset && el.closeEnd <= r.endOffset);
      if (inside) {
        report.regions.push({ tag, key, status: 'already-marked' });
        totals.unchanged++;
        continue;
      }
      candidates.set(id, { tag, key });
    }
  }

  const seeded = seedCacheRegions(source, [...candidates.values()], knownTags);
  for (const e of seeded.errors) {
    report.errors.push(`error — seed ${e.seed}: ${e.message}`);
    totals.errors++;
  }
  const marked = candidates.size - seeded.errors.length;
  if (seeded.text !== source) {
    if (!opts.check) {
      writeFileSync(file, seeded.text);
      report.written = true;
    }
    totals.drift += opts.check ? marked : 0;
    totals.refreshed += opts.check ? 0 : marked;
    for (const c of candidates.values()) {
      const failed = seeded.errors.some((e) => e.seed === `${c.tag} ${c.key}`);
      if (!failed) report.regions.push({ tag: c.tag, key: c.key, status: opts.check ? 'drift' : 'seeded' });
    }
  }
  return report;
}

/** Tags the subcommand's seed pass looks for: only snapshot ROOTS (the
 *  cachedEmbed-backed defs) — child parts (titles, criteria, states) are
 *  never region candidates. `media` is element-less — its regions are
 *  YAML bodies, nothing to wrap — so it seeds nothing. */
function seedTags(sub, cachedRoots) {
  if (sub === 'media') return [];
  if (sub === 'agentkit') return [...cachedRoots].filter((t) => t.startsWith('agent-kit-')).sort();
  if (sub === 'all') {
    const tags = [...cachedRoots].filter((t) => t.startsWith('agent-kit-'));
    tags.push('semext-docptr', 'semext-styleguide-themes', 'semext-annotate');
    return tags.sort();
  }
  return [{ docptr: 'semext-docptr', styleguide: 'semext-styleguide-themes', annotate: 'semext-annotate' }[sub]].filter(Boolean);
}

function lineOf(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

/** Real-I/O context; tests inject a stub. `resolveStyleguide` returns the
 *  @noizu/styleguide package DIR when resolvable (it is not a dependency
 *  of this package), else null. */
export function defaultCtx() {
  const execFile = promisify(nodeExecFile);
  return {
    fetch: (...args) => fetch(...args),
    env: process.env,
    now: () => new Date().toISOString(),
    execFile,
    resolveStyleguide: () => {
      try {
        return fileURLToPath(new URL('./', import.meta.resolve('@noizu/styleguide')));
      } catch (e) {
        return null;
      }
    },
  };
}

const HELP = `semtext-refresh — refresh cache regions in SemText documents

Usage: semtext-refresh <subcommand> [options] <file-or-glob>...

Subcommands:
  agentkit    AgentOni MCP snapshots (tickets / personas / boards)
  docptr      doc-pointer CLI lookups (semext-docptr regions)
  styleguide  @noizu/styleguide theme tokens (semext-styleguide-themes)
  annotate    public comment threads (semext-annotate regions)
  media       validate + normalize .media.prompt YAML regions (no network)
  all         every adapter over its own regions

Options:
  --check     drift detection — read-only, timestamp-normalized compare,
              exit 1 on real drift, never writes
  --seed      author initial cache regions around authored elements
              lacking markers (no adapter traffic)
  --json      machine output (single JSON object on stdout)
  -h, --help  this help

Cache regions are delimited by
  <!-- semtext:cache:start <tag> <key> --> ... <!-- semtext:cache:end -->
and ONLY their bodies are rewritten; authored prose outside markers is
never touched. Malformed markers (start without end, orphan end, nested
start, unknown tag, duplicate key) exit 1 without writing.

Exit codes: 0 clean / no drift · 1 drift or errors · 2 usage error
`;
