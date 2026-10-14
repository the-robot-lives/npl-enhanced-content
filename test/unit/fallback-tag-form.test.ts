// @vitest-environment happy-dom
// Unit spec — the vanilla fallback core on the canonical tag form
//
// Feature: every core handler wires a document authored as custom elements
//          with bare attributes (spec/conventions.md §1, §5), exactly as it
//          wires the class-form alias (Appendix A)
//   Scenario: bare parameters are mirrored to their data-* twin, data-* wins
//   Scenario: sem-facts quiz on <sem-fact><statement>/<conclusion>/<incorrect-statement>
//   Scenario: sem-details quiz occludes <highlight>
//   Scenario: sem-note[collapsed] wraps its bare content and adds a summary
//   Scenario: sem-views builds a tab bar from <sem-view name>
//   Scenario: sem-reveal wraps in <details> with the authored summary
//   Scenario: sem-progress renders the meter from value/label
//   Scenario: a Lit-upgraded element is left to the Lit tier

import { describe, it, expect, beforeEach } from 'vitest';
import { enhance } from '../../src/fallback/index.js';

const DOC = `
<sem-enhanced-document>
  <sem-note id="n" variant="tip" collapsed>Shuffle <strong>before</strong> each review.</sem-note>
  <sem-facts id="deck" view-as="quiz" data-sem-seed="7">
    <sem-fact id="f1"><statement>A</statement><conclusion>a</conclusion><incorrect-statement>x</incorrect-statement></sem-fact>
    <sem-fact id="f2"><statement>B</statement><conclusion>b</conclusion></sem-fact>
  </sem-facts>
  <sem-details id="dt" view-as="quiz"><sem-detail>The <highlight>token</highlight> rotates.</sem-detail></sem-details>
  <sem-views id="deploy">
    <sem-view name="Helm">h</sem-view>
    <sem-view name="ArgoCD" active>a</sem-view>
  </sem-views>
  <sem-reveal id="rv" summary="Why?" collapsed>Because.</sem-reveal>
  <sem-progress id="pg" value="0.7" label="coverage"></sem-progress>
  <sem-facts id="lit" view-as="quiz" data-sem-upgraded><sem-fact><statement>L</statement><conclusion>l</conclusion></sem-fact></sem-facts>
  <sem-note id="both" variant="info" data-variant="warning"></sem-note>
</sem-enhanced-document>`;

describe('fallback core on the tag form', () => {
  beforeEach(() => {
    document.body.innerHTML = DOC;
    enhance(document);
  });

  it('mirrors bare parameters to data-*; an authored data-* wins', () => {
    expect(document.getElementById('deck')!.getAttribute('data-view-as')).toBe('quiz');
    expect(document.querySelector('sem-view[name="Helm"]')!.getAttribute('data-name')).toBe('Helm');
    expect(document.getElementById('both')!.getAttribute('data-variant')).toBe('warning');
  });

  it('wires a quiz deck: chrome, options from conclusions and incorrect statements', () => {
    const deck = document.getElementById('deck')!;
    expect(deck.hasAttribute('data-sem-upgraded')).toBe(true);
    expect(deck.querySelector(':scope > .sem-facts-chrome')).not.toBeNull();
    const f1 = document.getElementById('f1')!;
    expect(f1.classList.contains('sem-current')).toBe(true);
    const texts = Array.from(f1.querySelectorAll('.sem-quiz-options button')).map((b) => b.textContent);
    expect(texts.sort()).toEqual(['a', 'b', 'x']);
  });

  it('occludes <highlight> in a quiz details block', () => {
    const occ = document.querySelector('#dt .sem-occluded')!;
    expect(occ).not.toBeNull();
    expect(occ.textContent).toBe('token');
    expect(document.querySelector('#dt highlight')).toBeNull();
  });

  it('wraps a collapsed note body and adds the summary teaser', () => {
    const n = document.getElementById('n')!;
    expect(n.hasAttribute('data-sem-upgraded')).toBe(true);
    expect(n.querySelector(':scope > .sem-note-body strong')!.textContent).toBe('before');
    expect(n.querySelector(':scope > .sem-note-summary')!.textContent).toMatch(/^Shuffle before each review\./);
  });

  it('builds a tab bar from <sem-view name>, honouring `active`', () => {
    const tabs = Array.from(document.querySelectorAll('#deploy .sem-views-tabs [role="tab"]'));
    expect(tabs.map((t) => t.textContent)).toEqual(['Helm', 'ArgoCD']);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('sem-view[name="ArgoCD"]')!.hasAttribute('data-active')).toBe(true);
  });

  it('wraps a reveal in <details> with the authored summary', () => {
    const d = document.querySelector('#rv > details')!;
    expect(d).not.toBeNull();
    expect(d.hasAttribute('open')).toBe(false);
    expect(d.querySelector('summary')!.textContent).toBe('Why?');
    expect(d.querySelector('.sem-reveal-body')!.textContent!.trim()).toBe('Because.');
  });

  it('renders the progress meter from value and label', () => {
    const p = document.getElementById('pg')!;
    expect(p.textContent).toContain('coverage :: 70%');
    expect(p.querySelector('.sem-progress-track > .sem-progress-fill')).not.toBeNull();
  });

  it('leaves a Lit-upgraded element to the Lit tier', () => {
    const lit = document.getElementById('lit')!;
    expect(lit.querySelector('.sem-facts-chrome')).toBeNull();
    expect(lit.hasAttribute('data-sem-upgraded')).toBe(true); // claimed, untouched by the core scan
  });
});
