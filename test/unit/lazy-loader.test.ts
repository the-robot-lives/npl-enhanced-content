// @vitest-environment happy-dom
// Unit spec — the lazy loader's DOM logic (src/lazy/scan.ts + src/lazy/loader.ts)
//
// Feature: <sem-text> pages load only the component chunks they use
//   Scenario: the tag scan finds sem-* / npl-* elements under a root, root included
//   Scenario: tags outside the vocabulary are ignored
//   Scenario: the manifest maps known tags to their chunk and answers null otherwise
//   Scenario: a tag used many times downloads its chunk exactly once, across racing scans
//   Scenario: a chunk that fails leaves a role="alert" note on its elements only
//   Scenario: a failing chunk does not stop the other chunks from loading
//   Scenario: elements inserted after boot hydrate through the MutationObserver path
//   Scenario: an inserted <sem-text> becomes a tracked root of its own
//   Scenario: a failed chunk stays failed — later elements get the note without a second download attempt

import { describe, it, expect, vi } from 'vitest';
import { isVocabularyTag, collectTags, collectVocabularyElements } from '../../src/lazy/scan.js';
import { chunkFor, createLoader, reportFailure, type Manifest } from '../../src/lazy/loader.js';

describe('scan — the vocabulary tag scan', () => {
  it('scans the whole document — the sem-text wrapper is optional', () => {
    document.body.innerHTML =
      '<sem-note>loose</sem-note><section><npl-card>card</npl-card><em>not vocabulary</em></section>';
    expect(collectTags(document.body)).toEqual(new Set(['sem-note', 'npl-card']));
  });

  it('narrows to one namespace when given a prefix pattern', () => {
    document.body.innerHTML = '<sem-note>s</sem-note><npl-card>n</npl-card>';
    expect(collectTags(document.body, /^npl-/)).toEqual(new Set(['npl-card']));
    expect(collectTags(document.body, /^sem-/)).toEqual(new Set(['sem-note']));
  });

  it('finds sem-* and npl-* elements under a root, root included', () => {
    document.body.innerHTML = `
      <sem-text>
        <sem-note>hi</sem-note>
        <npl-card>future vocabulary</npl-card>
        <section><sem-facts><sem-fact><statement>s</statement></sem-fact></sem-facts></section>
      </sem-text>`;
    const root = document.querySelector('sem-text')!;
    expect([...collectTags(root)].sort()).toEqual(['npl-card', 'sem-fact', 'sem-facts', 'sem-note', 'sem-text']);
    expect(collectVocabularyElements(root).length).toBe(5);
  });

  it('ignores tags outside the vocabulary, including prefix look-alikes', () => {
    expect(isVocabularyTag('sem-note')).toBe(true);
    expect(isVocabularyTag('npl-card')).toBe(true);
    expect(isVocabularyTag('div')).toBe(false);
    expect(isVocabularyTag('semantic')).toBe(false);
    expect(isVocabularyTag('sem-')).toBe(false);
    // HTML documents lowercase tag names; the scan must not depend on casing
    document.body.innerHTML = '<sem-text><DIV>x</DIV></sem-text>';
    expect(collectTags(document.querySelector('sem-text')!)).toEqual(new Set(['sem-text']));
  });
});

describe('manifest mapping', () => {
  const manifest: Manifest = { 'sem-note': 'chunks/sem-note.js', 'sem-facts': 'chunks/sem-facts.js' };

  it('maps known tags to their chunk', () => {
    expect(chunkFor('sem-note', manifest)).toBe('chunks/sem-note.js');
  });

  it('answers null for unknown tags — and never via the prototype', () => {
    expect(chunkFor('sem-unknown', manifest)).toBeNull();
    expect(chunkFor('constructor', manifest)).toBeNull();
    expect(chunkFor('toString', manifest)).toBeNull();
  });
});

describe('loader — chunk de-duplication', () => {
  it('imports a chunk once for many elements and across racing scans', async () => {
    document.body.innerHTML = '<sem-text><sem-note>a</sem-note><sem-note>b</sem-note></sem-text>';
    const importer = vi.fn(() => Promise.resolve({ defined: true }));
    const loader = createLoader({ 'sem-note': 'chunks/sem-note.js' }, importer);
    const root = document.querySelector('sem-text')!;
    await Promise.all([loader.hydrate(root), loader.hydrate(root)]);
    expect(importer).toHaveBeenCalledTimes(1);
    expect(importer).toHaveBeenCalledWith('chunks/sem-note.js');
  });

  it('a prefix-narrowed loader ignores the other namespace entirely', async () => {
    document.body.innerHTML = '<sem-note>s</sem-note><npl-flag>n</npl-flag>';
    const importer = vi.fn(() => Promise.resolve({}));
    await createLoader({ 'npl-flag': 'npl-chunks/npl-flag.js' }, importer, /^npl-/).hydrate(document.body);
    expect(importer).toHaveBeenCalledTimes(1);
    expect(importer).toHaveBeenCalledWith('npl-chunks/npl-flag.js');
    expect(document.querySelector('sem-note')!.hasAttribute('data-sem-lazy-error')).toBe(false);
  });
});

describe('loader — failures', () => {
  const manifest: Manifest = { 'sem-note': 'chunks/sem-note.js', 'sem-facts': 'chunks/sem-facts.js' };

  function loaderWith(fail: (chunkPath: string) => boolean) {
    const resolved: string[] = [];
    const importer = vi.fn(
      (chunkPath: string) =>
        new Promise((resolve, reject) => {
          setTimeout(() => {
            if (fail(chunkPath)) reject(new Error('offline'));
            else {
              resolved.push(chunkPath);
              resolve({});
            }
          }, 0);
        }),
    );
    return { importer, resolved };
  }

  it('reports a failed chunk with a role="alert" note on its elements only', async () => {
    document.body.innerHTML =
      '<sem-text><sem-note>n</sem-note><sem-facts><sem-fact><statement>s</statement></sem-fact></sem-facts></sem-text>';
    const { importer } = loaderWith((p) => p === 'chunks/sem-note.js');
    await createLoader(manifest, importer).hydrate(document.querySelector('sem-text')!);
    for (const note of document.querySelectorAll('sem-note')) {
      expect(note.querySelector('[role="alert"]')).toBeTruthy();
      expect(note.getAttribute('data-sem-lazy-error')).toBe('sem-note');
    }
    expect(document.querySelector('sem-facts [role="alert"]')).toBeNull();
  });

  it('a failing chunk does not stop the other chunks from loading', async () => {
    document.body.innerHTML = '<sem-text><sem-note>n</sem-note><sem-facts>f</sem-facts></sem-text>';
    const { importer, resolved } = loaderWith((p) => p === 'chunks/sem-note.js');
    await createLoader(manifest, importer).hydrate(document.querySelector('sem-text')!);
    expect(resolved).toContain('chunks/sem-facts.js');
    expect(resolved).not.toContain('chunks/sem-note.js');
  });

  it('a failed chunk stays failed: later elements get the note without a second download attempt', async () => {
    document.body.innerHTML = '<sem-text></sem-text>';
    const root = document.querySelector('sem-text')!;
    const { importer } = loaderWith(() => true);
    const loader = createLoader(manifest, importer);
    await loader.hydrate(root);
    root.insertAdjacentHTML('beforeend', '<sem-note>late</sem-note>');
    await loader.hydrate(document.querySelector('sem-note')!);
    expect(importer).toHaveBeenCalledTimes(1); // the cached rejection answers
    expect(document.querySelector('sem-note [role="alert"]')).toBeTruthy();
  });

  it('reportFailure is idempotent', () => {
    document.body.innerHTML = '<sem-note>n</sem-note>';
    const el = document.querySelector('sem-note')!;
    reportFailure(el, 'sem-note');
    reportFailure(el, 'sem-note');
    expect(el.querySelectorAll('[role="alert"]').length).toBe(1);
  });
});

describe('loader — the MutationObserver path (document-wide)', () => {
  /** Mirrors src/lazy/index.ts's watcher: one document-level observer, and
   *  every added element hydrates (itself plus its subtree). */
  function watch(loader: ReturnType<typeof createLoader>): void {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) void loader.hydrate(node);
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  const manifest: Manifest = { 'sem-note': 'chunks/sem-note.js', 'sem-facts': 'chunks/sem-facts.js' };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('hydrates an element inserted anywhere — no sem-text wrapper required', async () => {
    document.body.innerHTML = '<div id="host"></div>';
    const importer = vi.fn(() => Promise.resolve({}));
    watch(createLoader(manifest, importer));
    document.getElementById('host')!.insertAdjacentHTML('beforeend', '<sem-note>loose</sem-note>');
    await tick();
    expect(importer).toHaveBeenCalledWith('chunks/sem-note.js');
  });

  it('hydrates the vocabulary inside a non-vocabulary wrapper added later', async () => {
    document.body.innerHTML = '<div id="host"></div>';
    const importer = vi.fn(() => Promise.resolve({}));
    watch(createLoader(manifest, importer));
    document.body.insertAdjacentHTML(
      'beforeend',
      '<section><sem-facts><sem-fact><statement>s</statement></sem-fact></sem-facts></section>',
    );
    await tick();
    expect(importer).toHaveBeenCalledWith('chunks/sem-facts.js');
  });

  it('still adopts an inserted <sem-text> subtree — the wrapper stays optional, not forbidden', async () => {
    document.body.innerHTML = '<div id="host"></div>';
    const importer = vi.fn(() => Promise.resolve({}));
    watch(createLoader(manifest, importer));
    document.getElementById('host')!.insertAdjacentHTML('beforeend', '<sem-text><sem-note>kept</sem-note></sem-text>');
    await tick();
    expect(importer).toHaveBeenCalledWith('chunks/sem-note.js');
  });
});
