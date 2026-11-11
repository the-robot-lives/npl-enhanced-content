// Unit spec — bin/lib/focus · purpose-driven collapse (focus core)
//
// Feature: `focus()` runs the whole pipeline over injectable deps
//   Scenario: second run over the same doc/purpose makes zero classifier/summarizer calls (cache hit) and reuses the task
//   Scenario: exact normalized purpose reuses the task with no classifier call
//   Scenario: a near purpose matches via one batched :choice round (probability >= match-threshold)
//   Scenario: drifted section + boolean=no rebinds the prior summary (no summarizer call)
//   Scenario: drifted section + boolean=yes tweaks through the summarizer
//   Scenario: --track-refs invalidates the cache when a referenced file changes
//   Scenario: --no-llm falls back to first-90-chars and keeps relevance unknown sections
//   Scenario: pinned / --keep sections stay relevant regardless of score
//   Scenario: --notes writes a one-line task footnote via the summarizer
//   Scenario: --dry-run records planned calls, writes no cache entries
//   Scenario: unifiedDiff produces context/plus/minus hunks
//   Scenario: renderFocus md/html/text/json shapes
//   Scenario: writeBack is idempotent and refreshes changed summaries

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { focus, renderFocus, writeBack, unifiedDiff, first90, normalizePurpose } from '../../bin/lib/focus/focus.mjs';
import { makeCache } from '../../bin/lib/focus/cache.mjs';
import * as md from '../../src/agent/markdown-sections.ts';

let root;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'semtext-focus-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const DOC = () => ({
  path: join(root, 'doc.md'),
  sections: [
    { id: 'deploy', heading: 'Deployment', level: 2, pinned: false, text: '## Deployment\nRun the ship pipeline through CI.' },
    { id: 'notes', heading: 'Notes', level: 2, pinned: false, text: '## Notes\nMiscellaneous tail remarks.' }
  ]
});

const OPTS = (over = {}) => ({
  purpose: 'deploy the service',
  threshold: 0.5,
  matchThreshold: 0.8,
  keep: [],
  notes: false,
  trackRefs: false,
  noLlm: false,
  refresh: false,
  dryRun: false,
  verbose: false,
  model: 'qwen3.8-flash',
  classifierModel: 'decision-model-preview',
  fileLabel: 'doc.md',
  ...over
});

/** Recording fakes. `score` maps section id -> relevance score. */
function fakeDeps(cache, { choice, drift, score, generic } = {}) {
  const calls = { classifier: [], summarizer: [] };
  const deps = {
    classifier: async (input, questions) => {
      calls.classifier.push(questions.map((q) => q.id));
      const out = {};
      for (const q of questions) {
        if (q.id === 'task-match') out[q.id] = choice === undefined ? { value: 'none' } : { value: choice, probability: 0.9 };
        else if (q.id.startsWith('drift:')) out[q.id] = { value: drift === undefined ? true : drift };
        else if (q.id.startsWith('rel:')) out[q.id] = { value: score ? score(q.id.slice(4)) : 0.9 };
        else out[q.id] = { value: true };
      }
      return out;
    },
    summarizer: async (args) => {
      calls.summarizer.push(args.mode);
      return generic || `summary of ${args.heading}`;
    },
    cache,
    clock: () => 1731300000000,
    log: () => {}
  };
  return { deps, calls };
}

describe('task match + cache', () => {
  it('second identical run makes zero calls, reuses the task, hits the cache', async () => {
    const cache = makeCache(root);
    const a = fakeDeps(cache);
    const r1 = await focus(DOC(), OPTS(), a.deps);
    expect(r1.taskReused).toBe(false);
    expect(a.calls.classifier.length).toBe(1); // score round only — empty task list skips the choice round
    expect(r1.stats.cache_hits).toBe(0);

    const b = fakeDeps(cache);
    const r2 = await focus(DOC(), OPTS(), b.deps);
    expect(r2.taskReused).toBe(true);
    expect(r2.stats.classifier_calls).toBe(0);
    expect(r2.stats.summarizer_calls).toBe(0);
    expect(r2.stats.cache_hits).toBe(4); // 2 sections + 2 notes
    expect(r2.taskId).toBe(r1.taskId);
  });

  it('exact normalized purpose reuses without asking the classifier', async () => {
    const cache = makeCache(root);
    const a = fakeDeps(cache);
    await focus(DOC(), OPTS(), a.deps);
    const b = fakeDeps(cache);
    const r = await focus(DOC(), OPTS({ purpose: 'Deploy  the  SERVICE!' }), b.deps);
    expect(r.taskReused).toBe(true);
    expect(b.calls.classifier).toEqual([]); // normalized match short-circuits the choice round
    expect(normalizePurpose('Deploy  the  SERVICE!')).toBe(normalizePurpose('deploy the service'));
  });

  it('near purpose matches via one batched :choice round', async () => {
    const cache = makeCache(root);
    const a = fakeDeps(cache);
    const r1 = await focus(DOC(), OPTS(), a.deps);
    const b = fakeDeps(cache, { choice: r1.taskId });
    const r2 = await focus(DOC(), OPTS({ purpose: 'deploy service now' }), b.deps);
    expect(b.calls.classifier[0]).toContain('task-match');
    expect(r2.taskReused).toBe(true);
    expect(r2.taskId).toBe(r1.taskId);
  });

  it('a "none" choice answer mints a fresh task', async () => {
    const cache = makeCache(root);
    const a = fakeDeps(cache);
    const r1 = await focus(DOC(), OPTS(), a.deps);
    const b = fakeDeps(cache, { choice: 'none' });
    const r2 = await focus(DOC(), OPTS({ purpose: 'totally different planet' }), b.deps);
    expect(r2.taskReused).toBe(false);
    expect(r2.taskId).not.toBe(r1.taskId);
  });
});

describe('drift: rebind vs tweak', () => {
  const EDITED = () => ({
    path: DOC().path,
    sections: [
      DOC().sections[0],
      { id: 'notes', heading: 'Notes', level: 2, pinned: false, text: '## Notes\nCompletely new tail remarks plus steps.' }
    ]
  });

  it('boolean=no rebinds the prior summary without a summarizer call', async () => {
    const cache = makeCache(root);
    const a = fakeDeps(cache);
    const r1 = await focus(DOC(), OPTS(), a.deps);
    const tldr1 = r1.sections.find((s) => s.id === 'notes').tldr;

    const b = fakeDeps(cache, { drift: false });
    const r2 = await focus(EDITED(), OPTS(), b.deps);
    const notes = r2.sections.find((s) => s.id === 'notes');
    expect(notes.source).toBe('rebind');
    expect(notes.tldr).toBe(tldr1);
    expect(b.calls.summarizer).not.toContain('tweak');
    expect(b.calls.summarizer).not.toContain('generic');

    // The rebind is cached under the NEW content sha — third run is a clean hit.
    const c = fakeDeps(cache);
    const r3 = await focus(EDITED(), OPTS(), c.deps);
    expect(c.calls.summarizer).toEqual([]);
    expect(r3.sections.find((s) => s.id === 'notes').tldr).toBe(tldr1);
  });

  it('boolean=yes tweaks the summary through the summarizer', async () => {
    const cache = makeCache(root);
    const a = fakeDeps(cache);
    await focus(DOC(), OPTS(), a.deps);
    const b = fakeDeps(cache, { drift: true });
    const r2 = await focus(EDITED(), OPTS(), b.deps);
    const notes = r2.sections.find((s) => s.id === 'notes');
    expect(notes.source).toBe('tweak');
    expect(b.calls.summarizer).toContain('tweak');
    expect(notes.tldr).toContain('summary of Notes');
  });
});

describe('--track-refs', () => {
  it('a changed referenced file counts as drift', async () => {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    const ref = join(root, 'scripts/run.sh');
    writeFileSync(ref, 'echo v1\n');
    const doc = {
      path: DOC().path,
      sections: [{ id: 'runner', heading: 'Runner', level: 2, pinned: false, text: '## Runner\nUse `scripts/run.sh` from the repo root.' }]
    };
    const cache = makeCache(root);
    const a = fakeDeps(cache);
    await focus(doc, OPTS({ trackRefs: true, cwd: root, exists: (p) => p === ref, readFile: (p) => readFileSync(p.startsWith('/') ? p : join(root, p), 'utf8') }), a.deps);

    writeFileSync(ref, 'echo v2\n');
    const b = fakeDeps(cache, { drift: true });
    const r2 = await focus(doc, OPTS({ trackRefs: true, cwd: root, exists: (p) => p === ref, readFile: (p) => readFileSync(p.startsWith('/') ? p : join(root, p), 'utf8') }), b.deps);
    expect(r2.sections[0].source).toBe('tweak');
    expect(b.calls.classifier.flat()).toContain('drift:runner');
  });

  it('unchanged refs stay a cache hit', async () => {
    const doc = {
      path: DOC().path,
      sections: [{ id: 'runner', heading: 'Runner', level: 2, pinned: false, text: '## Runner\nUse `scripts/stable.sh`.' }]
    };
    const cache = makeCache(root);
    const a = fakeDeps(cache);
    await focus(doc, OPTS({ trackRefs: true, cwd: root, exists: () => true, readFile: () => 'echo stable\n' }), a.deps);
    const b = fakeDeps(cache);
    const r2 = await focus(doc, OPTS({ trackRefs: true, cwd: root, exists: () => true, readFile: () => 'echo stable\n' }), b.deps);
    expect(r2.sections[0].source).toBe('cache');
    expect(b.calls.summarizer).toEqual([]);
  });
});

describe('--no-llm', () => {
  it('falls back to first-90 and keeps unknown-relevance sections', async () => {
    const cache = makeCache(root);
    const boom = () => {
      throw new Error('no network under --no-llm');
    };
    const doc = DOC();
    const r = await focus(doc, OPTS({ noLlm: true }), {
      classifier: boom,
      summarizer: boom,
      cache,
      clock: () => 0
    });
    for (const s of r.sections) {
      const text = doc.sections.find((x) => x.id === s.id).text;
      expect(s.tldr).toBe(first90(text));
      expect(s.source).toBe('fallback');
      expect(s.relevant).toBe(true);
    }
    expect(r.stats.classifier_calls).toBe(0);
    expect(r.stats.summarizer_calls).toBe(0);
  });
});

describe('relevance', () => {
  it('pinned and --keep sections stay relevant regardless of score', async () => {
    const cache = makeCache(root);
    const { deps } = fakeDeps(cache, { score: () => 0.0 });
    const doc = {
      path: DOC().path,
      sections: [
        { id: 'law', heading: 'Hard rule', level: 2, pinned: true, text: '## Hard rule\nNever drop the audit log.' },
        DOC().sections[1]
      ]
    };
    const r = await focus(doc, OPTS({ keep: ['notes'], threshold: 0.5 }), deps);
    const law = r.sections.find((s) => s.id === 'law');
    const notes = r.sections.find((s) => s.id === 'notes');
    expect(law.relevant).toBe(true);
    expect(notes.relevant).toBe(true); // kept
    // Fresh task (unrelated purpose) so run 1's keep-influenced notes don't answer run 2.
    const b = fakeDeps(cache, { choice: 'none', score: () => 0.0 });
    const r2 = await focus(doc, OPTS({ purpose: 'another thing entirely', threshold: 0.5 }), b.deps);
    expect(r2.sections.find((s) => s.id === 'law').relevant).toBe(true);
    expect(r2.sections.find((s) => s.id === 'notes').relevant).toBe(false); // score 0 < 0.5 and not kept this time
  });

  it('score >= threshold is relevant and the note round is ONE batched call', async () => {
    const cache = makeCache(root);
    const { deps, calls } = fakeDeps(cache, { score: (id) => (id === 'deploy' ? 0.9 : 0.2) });
    const r = await focus(DOC(), OPTS(), deps);
    expect(r.sections.find((s) => s.id === 'deploy').relevant).toBe(true);
    expect(r.sections.find((s) => s.id === 'notes').relevant).toBe(false);
    expect(r.sections.find((s) => s.id === 'notes').collapsed).toBe(true);
    const relRounds = calls.classifier.filter((ids) => ids.some((x) => x.startsWith('rel:')));
    expect(relRounds.length).toBe(1);
    expect(relRounds[0]).toEqual(['rel:deploy', 'rel:notes']);
  });

  it('--notes adds a task footnote for relevant sections', async () => {
    const cache = makeCache(root);
    const { deps, calls } = fakeDeps(cache, { score: () => 0.9 });
    const r = await focus(DOC(), OPTS({ notes: true }), deps);
    expect(calls.summarizer).toContain('note');
    expect(r.sections.every((s) => typeof s.note === 'string' && s.note.length)).toBe(true);
  });
});

describe('--dry-run', () => {
  it('records planned calls and writes nothing', async () => {
    const cache = makeCache(root);
    const { deps } = fakeDeps(cache);
    const r = await focus(DOC(), OPTS({ dryRun: true }), deps);
    expect(Array.isArray(r.planned)).toBe(true);
    expect(r.planned.length).toBeGreaterThanOrEqual(2); // score round + generic summaries
    expect(r.planned.every((p) => p.kind === 'classifier' || p.kind === 'summarizer')).toBe(true);
    // nothing landed in the cache: a real run afterwards still plans everything
    const { deps: d2 } = fakeDeps(cache);
    const r2 = await focus(DOC(), OPTS(), d2);
    expect(r2.taskReused).toBe(false);
    expect(r2.stats.cache_hits).toBe(0);
  });
});

describe('unifiedDiff', () => {
  it('produces context/minus/plus hunks with hunk headers', () => {
    const a = ['one', 'two', 'three'].join('\n');
    const b = ['one', 'TWO-and-a-half', 'three'].join('\n');
    const d = unifiedDiff(a, b);
    expect(d).toMatch(/^@@ -1,3 \+1,3 @@$/m);
    expect(d).toMatch(/^-two$/m);
    expect(d).toMatch(/^\+TWO-and-a-half$/m);
    expect(d).toMatch(/^ one$/m);
  });

  it('returns an empty diff for identical input', () => {
    expect(unifiedDiff('same\nlines', 'same\nlines')).toBe('');
  });
});

describe('renderFocus', () => {
  const result = {
    taskId: 't-abc',
    taskReused: false,
    sections: [
      { id: 'deploy', heading: 'Deployment', level: 2, relevant: true, score: 0.9, tldr: 'Ship it.', collapsed: false, note: 'check the pipeline' },
      { id: 'notes', heading: 'Notes', level: 2, relevant: false, score: 0.1, tldr: 'Tail.', collapsed: true }
    ],
    stats: { classifier_calls: 1, summarizer_calls: 1, cache_hits: 0 }
  };

  it('md: relevant sections keep raw text; collapsed get a TL;DR reveal', () => {
    const doc = { sections: [{ id: 'deploy', text: '## Deployment\nbody', raw: '## Deployment\nbody' }, { id: 'notes' }] };
    const { text } = renderFocus(result, doc, { format: 'md', fileLabel: 'doc.md' });
    expect(text).toContain('## Deployment');
    expect(text).toMatch(/^## Notes\n> TL;DR: Tail\.  \(collapsed — semtext expand doc\.md notes\)$/m);
    expect(text).toContain('[^fn-deploy]: check the pipeline');
  });

  it('html: collapsed sections become sem-reveal', () => {
    const doc = { sections: [{ id: 'deploy', text: 'body' }, { id: 'notes' }] };
    const { text } = renderFocus(result, doc, { format: 'html', fileLabel: 'd.md' });
    expect(text).toContain('<sem-reveal summary="Tail." collapsed>');
    expect(text).toContain('<sem-references kind="footnotes">');
  });

  it('text: plain fallback lines', () => {
    const doc = { sections: [{ id: 'notes' }] };
    const { text } = renderFocus(result, doc, { format: 'text', fileLabel: 'd.md' });
    expect(text).toContain('## Notes\n  TL;DR: Tail.');
  });

  it('json: contract shape', () => {
    const { json } = renderFocus(result, {}, { format: 'json' });
    expect(json.task_id).toBe('t-abc');
    expect(json.sections[0]).toEqual({
      id: 'deploy', heading: 'Deployment', relevant: true, score: 0.9, tldr: 'Ship it.', note: 'check the pipeline'
    });
    expect(json.sections[1].score).toBe(0.1);
    expect(json.stats).toEqual(result.stats);
  });
});

describe('writeBack', () => {
  const SRC = [
    '## Alpha',
    '<sem-tldr data-auto data-digest="000000000000">old alpha</sem-tldr>',
    'alpha body',
    '',
    '## Beta',
    'beta body',
    ''
  ].join('\n');

  it('inserts data-auto blocks under headings lacking one and is idempotent', () => {
    const first = writeBack(SRC, [{ id: 'x-sec-alpha', tldr: 'old alpha' }, { id: 'x-sec-beta', tldr: 'beta summary' }], md);
    expect(first.changed).toBe(true);
    expect(first.source).toContain('<sem-tldr data-auto data-digest="');
    expect(first.source).toContain('>beta summary</sem-tldr>');
    // identical digest on alpha -> untouched; running again changes nothing
    const again = writeBack(first.source, [{ id: 'x-sec-alpha', tldr: 'old alpha' }, { id: 'x-sec-beta', tldr: 'beta summary' }], md);
    expect(again.changed).toBe(false);
    expect(again.source).toBe(first.source);
  });

  it('refreshes a stale auto block in place and never touches authored tldrs', () => {
    const first = writeBack(SRC, [{ id: 'x-sec-alpha', tldr: 'old alpha' }, { id: 'x-sec-beta', tldr: 'beta summary' }], md);
    const refreshed = writeBack(first.source, [{ id: 'x-sec-alpha', tldr: 'NEW alpha wording' }], md);
    expect(refreshed.changed).toBe(true);
    expect(refreshed.source).toContain('>NEW alpha wording</sem-tldr>');
    expect(refreshed.source).not.toContain('old alpha');

    const authored = '## A\n<sem-tldr>authored</sem-tldr>\nbody\n';
    const untouched = writeBack(authored, [{ id: 'x-sec-a', tldr: 'whatever' }], md);
    expect(untouched.changed).toBe(false);
    expect(untouched.source).toBe(authored);
  });
});
