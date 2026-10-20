// @vitest-environment happy-dom
// Unit spec — sem-see-also, the related-reference affordance
// (spec/schema/sem-see-also.md). Behaviour lives in
// src/reading/see-also.ts (the Lit wrapper is lifecycle-only).
//
// Feature: link mode
//   Scenario: the authored label becomes the link; chrome is minted after it
//   Scenario: a section target resolves by id (leading # optional)
//   Scenario: a component target resolves by sem-component[tag], View-all hrefs the card id
//   Scenario: a file target uses the path as href; preview=file shows the path
//   Scenario: hover preview clones the target's sem-tldr
//   Scenario: click opens the shared modal with a clone; ids stripped; close returns children
//   Scenario: insert-as=inline embeds a clone instead of link chrome
// Feature: deep link
//   Scenario: #ref=<id> opens the named see-also's modal once
//   Scenario: resetSeeAlsoLatch re-arms (test hook)
// Feature: idempotence
//   Scenario: re-enhance mints no second chrome

import { describe, it, expect, beforeEach } from 'vitest';
import {
  enhanceSeeAlsoElement,
  applySeeAlsoDeepLink,
  resetSeeAlsoLatch,
} from '../../src/reading/see-also.js';
import { currentModalShell, closeModalShell } from '../../src/shared/modal.js';

function doc(): void {
  document.body.innerHTML = `
    <section id="bands"><h3>Bands</h3><sem-tldr>90+ is an A.</sem-tldr><p>Detail.</p></section>
    <sem-component id="c-waitlist" tag="noizu-waitlist" name="Waitlist" status="live">card body</sem-component>
    <sem-see-also id="sa-section" reference="section" target="#bands">the bands table</sem-see-also>
    <sem-see-also id="sa-component" reference="component" target="noizu-waitlist">waitlist intake</sem-see-also>
    <sem-see-also id="sa-file" reference="file" target="src/reading/see-also.ts" preview="file">wiring</sem-see-also>
    <sem-see-also id="sa-inline" reference="section" target="#bands" insert-as="inline">inline bands</sem-see-also>`;
}

const sa = (id: string) => document.getElementById(id)!;

describe('sem-see-also link mode', () => {
  beforeEach(() => {
    doc();
    closeModalShell();
    resetSeeAlsoLatch();
  });

  it('mints link chrome around the authored label', () => {
    enhanceSeeAlsoElement(sa('sa-section'));
    const link = sa('sa-section').querySelector('.sem-see-also-link')!;
    expect(link.getAttribute('href')).toBe('#bands');
    expect(link.getAttribute('aria-haspopup')).toBe('dialog');
    expect(link.querySelector('.sem-see-also-label')!.textContent).toContain('the bands table');
    expect(sa('sa-section').querySelector('.sem-see-also-view')!.getAttribute('target')).toBe('_blank');
  });

  it('resolves a component target by tag and hrefs the card id', () => {
    enhanceSeeAlsoElement(sa('sa-component'));
    const a = sa('sa-component').querySelector('.sem-see-also-link') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('#c-waitlist');
    // the link label is the authored text; the resolved card name feeds the
    // preview/dialog title instead
    expect(a.querySelector('.sem-see-also-label')!.textContent).toContain('waitlist intake');
  });

  it('a file target uses the path as href', () => {
    enhanceSeeAlsoElement(sa('sa-file'));
    expect(sa('sa-file').querySelector('.sem-see-also-link')!.getAttribute('href')).toBe('src/reading/see-also.ts');
  });

  it('click opens the shared modal; close returns the cloned tree, ids stripped', () => {
    enhanceSeeAlsoElement(sa('sa-section'));
    (sa('sa-section').querySelector('.sem-see-also-link') as HTMLAnchorElement).click();
    expect(currentModalShell()).not.toBeNull();
    expect(document.querySelector('.sem-see-also-modal-panel')!.getAttribute('role')).toBe('dialog');
    // clone: the bands content is there; the section's own id is NOT
    const content = document.querySelector('.sem-see-also-modal-content')!;
    expect(content.querySelector('h3')!.textContent).toBe('Bands');
    expect(content.querySelector('#bands')).toBeNull();
    // document untouched
    expect(document.getElementById('bands')).not.toBeNull();
    closeModalShell({ flagAttr: 'data-sem-ref-open' });
    expect(document.querySelector('.sem-see-also-modal')).toBeNull();
  });

  it('insert-as=inline embeds a clone, no link chrome', () => {
    enhanceSeeAlsoElement(sa('sa-inline'));
    expect(sa('sa-inline').querySelector('.sem-see-also-inline')).not.toBeNull();
    expect(sa('sa-inline').querySelector('.sem-see-also-link')).toBeNull();
    expect(sa('sa-inline').querySelector('.sem-see-also-inline h3')!.textContent).toBe('Bands');
  });
});

describe('sem-see-also deep link', () => {
  beforeEach(() => {
    doc();
    closeModalShell();
    resetSeeAlsoLatch();
  });

  it('#ref=<id> opens the named see-also modal once', () => {
    enhanceSeeAlsoElement(sa('sa-section'));
    location.hash = '#ref=sa-section';
    applySeeAlsoDeepLink();
    expect(document.querySelector('.sem-see-also-modal-panel')).not.toBeNull();
    location.hash = '';
  });

  it('the latch blocks a second application until reset', () => {
    enhanceSeeAlsoElement(sa('sa-section'));
    location.hash = '#ref=sa-section';
    applySeeAlsoDeepLink();
    closeModalShell({ flagAttr: 'data-sem-ref-open' });
    applySeeAlsoDeepLink();
    expect(document.querySelector('.sem-see-also-modal-panel')).toBeNull();
    resetSeeAlsoLatch();
    applySeeAlsoDeepLink();
    expect(document.querySelector('.sem-see-also-modal-panel')).not.toBeNull();
    location.hash = '';
  });
});

describe('idempotence', () => {
  beforeEach(() => {
    doc();
    closeModalShell();
    resetSeeAlsoLatch();
  });

  it('re-enhance mints no second chrome', () => {
    enhanceSeeAlsoElement(sa('sa-section'));
    const count = sa('sa-section').querySelectorAll('[data-sem-chrome]').length;
    enhanceSeeAlsoElement(sa('sa-section'));
    expect(sa('sa-section').querySelectorAll('[data-sem-chrome]').length).toBe(count);
    expect(sa('sa-section').querySelectorAll('.sem-see-also-link').length).toBe(1);
  });
});
