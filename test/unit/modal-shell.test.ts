// @vitest-environment happy-dom
// Unit spec — the shared modal shell (src/shared/modal.ts), factored out
// of the data-visualizer modal in 0.9.5 (spec/schema/sem-see-also.md).
//
// Feature: the shell
//   Scenario: open teleports the container's children into the panel
//   Scenario: the flag attribute marks the container while open
//   Scenario: Esc closes; the children return in order; focus returns
//   Scenario: a second open closes the first (one shell at a time)
//   Scenario: closeModalShell with a foreign flagAttr leaves the open shell alone
//   Scenario: modalShellOpenFor answers the container only

import { describe, it, expect, beforeEach } from 'vitest';
import {
  openModalShell,
  closeModalShell,
  modalShellOpenFor,
  currentModalShell,
} from '../../src/shared/modal.js';

function mount(): { container: HTMLElement; a: Element; b: Element } {
  document.body.innerHTML = '<div id="box"><p id="one">one</p><p id="two">two</p></div>';
  const container = document.getElementById('box')!;
  return { container, a: container.children[0], b: container.children[1] };
}

describe('openModalShell', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    closeModalShell();
  });

  it('teleports the container children into the panel', () => {
    const { container } = mount();
    openModalShell(container, { label: 'Box' });
    const content = document.querySelector('.sem-modal-content')!;
    expect(content.querySelector('#one')).not.toBeNull();
    expect(content.querySelector('#two')).not.toBeNull();
    expect(container.querySelector('#one')).toBeNull();
  });

  it('stamps the flag attribute while open and clears it on close', () => {
    const { container } = mount();
    openModalShell(container, { label: 'Box', flagAttr: 'data-sem-ref-open' });
    expect(container.hasAttribute('data-sem-ref-open')).toBe(true);
    expect(modalShellOpenFor(container, 'data-sem-ref-open')).toBe(true);
    closeModalShell({ flagAttr: 'data-sem-ref-open' });
    expect(container.hasAttribute('data-sem-ref-open')).toBe(false);
    expect(modalShellOpenFor(container, 'data-sem-ref-open')).toBe(false);
  });

  it('names the dialog and focuses the close button', () => {
    const { container } = mount();
    openModalShell(container, { label: 'Read me' });
    const panel = document.querySelector('.sem-modal-panel') as HTMLElement;
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.getAttribute('aria-label')).toBe('Read me');
    expect(document.activeElement?.classList.contains('sem-modal-close')).toBe(true);
  });

  it('Esc closes and the children return in order', () => {
    const { container, a, b } = mount();
    openModalShell(container, { label: 'Box' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(container.contains(a)).toBe(true);
    expect(container.contains(b)).toBe(true);
    expect(container.children[0]).toBe(a);
    expect(document.querySelector('.sem-modal')).toBeNull();
    expect(currentModalShell()).toBeNull();
  });

  it('a second open closes the first shell first', () => {
    const one = mount();
    const two = mount();
    openModalShell(one.container, { label: 'One' });
    openModalShell(two.container, { label: 'Two' });
    expect(document.querySelectorAll('.sem-modal').length).toBe(1);
    // the first shell's children went home on close
    expect(one.container.contains(one.a)).toBe(true);
    expect(two.container.contains(two.a)).toBe(false);
  });

  it('a foreign flagAttr close leaves another shell open', () => {
    const one = mount();
    openModalShell(one.container, { label: 'One', flagAttr: 'data-a-open' });
    closeModalShell({ flagAttr: 'data-b-open' });
    expect(currentModalShell()).not.toBeNull();
    closeModalShell({ flagAttr: 'data-a-open' });
    expect(currentModalShell()).toBeNull();
  });
});
