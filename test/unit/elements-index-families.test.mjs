// Unit tests — elements.json family mapping (collectContractFiles).
//
// The generator derives each tag's family from WHERE its contract file
// lives: top-level spec/schema/*.md are `sem`; each contract dir
// (npl, semext, agent-kit) contributes its *.md minus TEMPLATE.md. These
// tests pin the mapping on a synthetic tree AND the real one (TEMPLATE.md
 // never becomes a tag record).

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectContractFiles } from '../../scripts/build-elements-index.mjs';

const repoSchemaDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'spec', 'schema');

/** A synthetic spec/schema tree: one top-level sem contract, npl with a
 *  TEMPLATE.md (must be skipped), semext with a contract, agent-kit with
 *  only a TEMPLATE.md (contributes nothing yet). */
function makeTree() {
  const dir = mkdtempSync(join(tmpdir(), 'semtext-families-'));
  const schemaDir = join(dir, 'spec', 'schema');
  const put = (rel, body) => {
    const f = join(schemaDir, rel);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, body);
  };
  put('sem-note.md', '# Schema — `sem-note`\n');
  put('npl/flag.md', '# Schema — `npl-flag`\n');
  put('npl/TEMPLATE.md', '# Schema — `npl-<name>`\n');
  put('semext/canvas.md', '# Schema — `semext-canvas`\n');
  put('semext/TEMPLATE.md', '# Schema — `semext-<name>`\n');
  put('agent-kit/TEMPLATE.md', '# Schema — `agent-kit-<name>`\n');
  return { dir, schemaDir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const familyOf = (files, path) => files.find((f) => f.path === path)?.family;

describe('collectContractFiles — family from file location', () => {
  it('maps every contract dir to its family and never emits TEMPLATE.md', () => {
    const t = makeTree();
    try {
      const files = collectContractFiles(t.schemaDir);
      const paths = files.map((f) => f.path);
      expect(familyOf(files, 'spec/schema/sem-note.md')).toBe('sem');
      expect(familyOf(files, 'spec/schema/npl/flag.md')).toBe('npl');
      expect(familyOf(files, 'spec/schema/semext/canvas.md')).toBe('semext');
      expect(paths).toContain('spec/schema/npl/flag.md');
      expect(paths.some((p) => p.endsWith('TEMPLATE.md'))).toBe(false);
      // agent-kit carries only its template: zero contract files, zero crash
      expect(paths.filter((p) => p.startsWith('spec/schema/agent-kit'))).toEqual([]);
    } finally {
      t.cleanup();
    }
  });

  it('survives a missing contract dir (namespace predates its contracts)', () => {
    const t = makeTree();
    try {
      rmSync(join(t.schemaDir, 'semext'), { recursive: true, force: true });
      const files = collectContractFiles(t.schemaDir);
      expect(files.some((f) => f.path.startsWith('spec/schema/semext'))).toBe(false);
    } finally {
      t.cleanup();
    }
  });

  it('the real spec tree: contract dirs map by name; no TEMPLATE records', () => {
    const files = collectContractFiles(repoSchemaDir);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(f.path.endsWith('TEMPLATE.md'), f.path).toBe(false);
      if (f.path.startsWith('spec/schema/npl/')) expect(f.family, f.path).toBe('npl');
      else if (f.path.startsWith('spec/schema/semext/')) expect(f.family, f.path).toBe('semext');
      else if (f.path.startsWith('spec/schema/agent-kit/')) expect(f.family, f.path).toBe('agent-kit');
      else expect(f.family, f.path).toBe('sem');
    }
  });
});
