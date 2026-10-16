// @vitest-environment happy-dom
/**
 * data-tools-no-editor — reader-path regression (integrate 2026-10, Q2).
 *
 * The editor integration changed `wireDataTools` (src/reading/data-modal.ts):
 * the visualizer CONTAINER is authored content and must not carry
 * `data-sem-chrome` — only the generated Expand/Copy-link bar and its
 * buttons are runtime chrome (§2.4). With the mark on the container the
 * editor's positional mapping treated the whole visualizer as non-content
 * (no binding, no controller, sibling index drift).
 *
 * These tests pin the READER behaviour with NO editor loaded: same render,
 * same chrome placement, idempotent re-enhance, and no editor markers of
 * any kind on the authored tree.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { enhanceDataVisualizerElement } from '../../src/reading/data.js';
import { wireDataTools } from '../../src/reading/data-modal.js';

function visualizerDom(): HTMLElement {
  const el = document.createElement('sem-data-visualizer');
  el.id = 'dv';
  el.innerHTML = `
    <sem-data-source data-name="Rows" data-type="rows"
      data-columns="name:string, port:integer">
      | name | port |
      | :--- | ---: |
      | alpha | 8080 |
      | beta | 9090 |
    </sem-data-source>
    <sem-data-query data-name="Count">SELECT count(*) FROM rows</sem-data-query>`;
  document.body.appendChild(el);
  return el;
}

describe('visualizer with no editor loaded (reader path)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    // Guard the premise: nothing in this suite pulls editor code in, so the
    // global the bundle would define is absent — these tests run the exact
    // reader-only path a page without semtext-editor.js runs.
    expect((globalThis as { SemTextEditor?: unknown }).SemTextEditor).toBeUndefined();
  });

  it('renders sources and queries identically', () => {
    const dv = visualizerDom();
    enhanceDataVisualizerElement(dv);
    const rows = dv.querySelector('sem-data-source .sem-data-body table')!;
    expect(rows).not.toBeNull();
    expect(rows.querySelectorAll('tbody tr').length).toBe(2);
    expect(dv.querySelector('.sem-data-schema')).not.toBeNull();
    // The authored query keeps its statement and gains the upgraded mark.
    const q = dv.querySelector('sem-data-query')!;
    expect(q.textContent).toContain('SELECT count(*) FROM rows');
    expect(q.hasAttribute('data-sem-upgraded')).toBe(true);
  });

  it('never marks authored content as runtime chrome', () => {
    const dv = visualizerDom();
    enhanceDataVisualizerElement(dv);
    // The container and the authored tags THEMSELVES are content. (Sources
    // legitimately grow generated chrome INSIDE them — raw toggles — and
    // queries get wiring marks; the regression is only about the authored
    // ELEMENT carrying the chrome mark.)
    expect(dv.hasAttribute('data-sem-chrome')).toBe(false);
    for (const authored of [dv.querySelector('sem-data-source')!, dv.querySelector('sem-data-query')!]) {
      expect(authored.hasAttribute('data-sem-chrome')).toBe(false);
    }
  });

  it('marks only the generated tools bar and its buttons', () => {
    const dv = visualizerDom();
    enhanceDataVisualizerElement(dv);
    const bar = dv.querySelector('.sem-data-tools')!;
    expect(bar).not.toBeNull();
    expect(bar.hasAttribute('data-sem-chrome')).toBe(true);
    expect(dv.firstElementChild).toBe(bar); // generated chrome sits first
    const expand = bar.querySelector('.sem-data-expand')!;
    expect(expand.hasAttribute('data-sem-chrome')).toBe(true);
    expect(expand.getAttribute('aria-haspopup')).toBe('dialog');
    // The tools bar's own chrome marks never leak onto the container.
    expect(dv.hasAttribute('data-sem-chrome')).toBe(false);
  });

  it('is idempotent: re-enhance adds no second bar', () => {
    const dv = visualizerDom();
    enhanceDataVisualizerElement(dv);
    enhanceDataVisualizerElement(dv);
    expect(dv.querySelectorAll('.sem-data-tools').length).toBe(1);
    wireDataTools(dv); // direct double-wire is equally safe
    expect(dv.querySelectorAll('.sem-data-tools').length).toBe(1);
  });

  it('leaves no editor markers on the authored tree', () => {
    const dv = visualizerDom();
    enhanceDataVisualizerElement(dv);
    // Reader-only path: none of the editor's own markers appear anywhere.
    for (const mark of ['data-sem-edit-node', 'data-sem-editing', 'data-sem-inert', 'data-npl-generated']) {
      expect(dv.querySelector(`[${mark}]`)).toBeNull();
    }
  });
});
