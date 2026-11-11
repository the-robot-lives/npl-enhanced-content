import { SemElement } from './base.js';
import { param } from '../shared/attr.js';

/**
 * sem-component — a component-inventory card (spec/schema/sem-component.md).
 *
 * One card per entry of a component registry (the `components/manifest.yaml`
 * vocabulary: tag, name, description, source, type, status, labels). The
 * authored children ARE the description — the JS-off record — and the
 * upgrade prepends a header chrome (tag, name, status) and appends a meta
 * footer (type, source, labels) WITHOUT moving the authored DOM (the
 * append-chrome-only rule). Headless: no colors, no inline styles — the
 * card shape is theme CSS over `.sem-component*` classes, every visual
 * knob a `--sem-component-*` variable with a default in the vocabulary.
 *
 * The card exposes its data for graders and visualizers: `tag`, `name`,
 * `type`, `status` stay readable as attributes, `data-sem-component-tag`
 * mirrors the tag for class-form parity, and `role="article"` +
 * `aria-label` name the card for AT. Extraction reads the authored text.
 */
export class SemComponent extends SemElement {
  #wired = false;

  updated(): void {
    if (this.#wired) return;
    this.#wired = true;
    this.afterParse('sem-component-render', () => this.#render());
  }

  #render(): void {
    if (this.classList.contains('sem-component')) return; // already rendered
    this.classList.add('sem-component');
    const tag = (param(this, 'tag') ?? '').trim();
    const name = (param(this, 'name') ?? '').trim();
    const status = (param(this, 'status') ?? '').trim();
    const type = (param(this, 'type') ?? '').trim();
    const source = (param(this, 'source') ?? '').trim();
    const labels = this.tokens('labels').filter((l) => l !== '');

    if (tag) this.setAttribute('data-sem-component-tag', tag);
    this.setAttribute('role', 'article');
    if (!this.hasAttribute('aria-label')) {
      this.setAttribute('aria-label', (name || tag ? (name || tag) + ' component card' : 'Component card'));
    }

    if (tag || name || status) {
      const head = document.createElement('div');
      head.className = 'sem-component-head';
      head.setAttribute('data-sem-chrome', '');
      if (tag) {
        const code = document.createElement('code');
        code.className = 'sem-component-tag';
        code.textContent = tag;
        head.appendChild(code);
      }
      if (name) {
        const n = document.createElement('span');
        n.className = 'sem-component-name';
        n.textContent = name;
        head.appendChild(n);
      }
      if (status) {
        const s = document.createElement('span');
        s.className = 'sem-component-status';
        s.setAttribute('data-status', status);
        s.textContent = status;
        head.appendChild(s);
      }
      this.insertBefore(head, this.firstChild);
    }

    if (type || source || labels.length > 0) {
      const meta = document.createElement('div');
      meta.className = 'sem-component-meta';
      meta.setAttribute('data-sem-chrome', '');
      if (type) {
        const t = document.createElement('span');
        t.className = 'sem-component-type';
        t.textContent = type;
        meta.appendChild(t);
      }
      if (source) {
        const c = document.createElement('code');
        c.className = 'sem-component-source';
        c.textContent = source;
        meta.appendChild(c);
      }
      if (labels.length > 0) {
        const ul = document.createElement('ul');
        ul.className = 'sem-component-labels';
        ul.setAttribute('aria-label', 'Labels');
        for (const l of labels) {
          const li = document.createElement('li');
          li.textContent = l;
          ul.appendChild(li);
        }
        meta.appendChild(ul);
      }
      this.appendChild(meta);
    }

    this.setAttribute('data-sem-upgraded', '');
  }
}

SemElement.register('sem-component', SemComponent);
