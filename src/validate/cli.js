/**
 * semtext-validate — CLI front end (US-301/US-302).
 *
 * Usage:
 *   semtext-validate [options] <file-or-glob>...
 *
 * Options:
 *   --format text|json   output format (default text)
 *   --schema <path>      schema file (default: spec/schema/semtext.schema.json)
 *   --max-warnings <n>   fail when warnings exceed n (default: unlimited)
 *   -h, --help
 *
 * Exit codes: 0 clean (or warnings only, under --max-warnings) ·
 * 1 validation errors, warning budget exceeded, or an unreadable input
 * file (all reported per file) · 2 usage error (bad flags, no paths,
 * unreadable schema).
 */

import { globSync } from 'node:fs';
import { loadSchema, validateFile, defaultSchemaPath } from './validate.js';

export function parseArgs(argv) {
  const opts = { format: 'text', schema: null, maxWarnings: Infinity, paths: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--format') {
      opts.format = argv[++i];
      if (opts.format !== 'text' && opts.format !== 'json') throw new UsageError(`--format must be "text" or "json", got "${opts.format}"`);
    } else if (a === '--schema') {
      opts.schema = argv[++i];
    } else if (a === '--max-warnings') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 0) throw new UsageError('--max-warnings expects a non-negative integer');
      opts.maxWarnings = n;
    } else if (a === '-h' || a === '--help') {
      opts.help = true;
    } else if (a.startsWith('--')) {
      throw new UsageError(`unknown option "${a}"`);
    } else {
      opts.paths.push(a);
    }
  }
  return opts;
}

export class UsageError extends Error {}

export function main(argv = process.argv.slice(2), out = process.stdout, err = process.stderr) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    err.write(`semtext-validate: ${e.message}\n`);
    return 2;
  }
  if (opts.help) {
    out.write(HELP);
    return 0;
  }
  if (opts.paths.length === 0) {
    err.write('semtext-validate: no files given — pass file paths or globs\n');
    return 2;
  }

  // Expand globs relative to cwd; plain paths pass through (missing files
  // surface as read errors per file).
  const files = new Set();
  for (const p of opts.paths) {
    const matches = globSync(p);
    if (matches.length > 0) for (const m of matches) files.add(m);
    else files.add(p);
  }

  let schema;
  try {
    schema = loadSchema(opts.schema || defaultSchemaPath());
  } catch (e) {
    err.write(`semtext-validate: cannot load schema — ${e.message}\n`);
    return 2;
  }

  const results = [...files].sort().map((f) => validateFile(f, schema));
  let errors = 0;
  let warnings = 0;
  for (const r of results) {
    if (r.readError) {
      errors++;
      if (opts.format === 'json') continue;
      err.write(`${r.file}: read error — ${r.readError}\n`);
      continue;
    }
    for (const d of r.diagnostics) {
      if (d.severity === 'error') errors++;
      else if (d.severity !== 'info') warnings++;
    }
  }

  if (opts.format === 'json') {
    out.write(JSON.stringify({
      files: results.map((r) => ({ file: r.file, readError: r.readError, diagnostics: r.diagnostics })),
      totals: { errors, warnings }
    }, null, 2) + '\n');
  } else {
    for (const r of results) {
      for (const d of r.diagnostics) {
        out.write(`${r.file}:${d.line}: ${d.severity} ${d.rule} — ${d.message}\n`);
      }
    }
    const nFiles = results.length;
    const readFails = results.filter((r) => r.readError).length;
    out.write(`\n${nFiles} file${nFiles === 1 ? '' : 's'} checked, ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}${readFails ? `, ${readFails} unreadable` : ''}\n`);
  }

  if (errors > 0) return 1;
  if (warnings > opts.maxWarnings) return 1;
  return 0;
}

const HELP = `semtext-validate — validate SemText documents against spec/schema

Usage: semtext-validate [options] <file-or-glob>...

Options:
  --format text|json   output format (default: text)
  --schema <path>      schema file (default: spec/schema/semtext.schema.json)
  --max-warnings <n>   exit 1 when warnings exceed n
  -h, --help           this help

Exit codes: 0 clean · 1 errors (incl. unreadable files) · 2 usage error
`;

export { loadSchema, validateFile };
