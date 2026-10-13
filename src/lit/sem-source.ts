import { SemElement } from './base.js';
import { enhanceSourceElement } from '../reading/source.js';
import { snapshotSourceElement } from '../fallback/source.js';

/**
 * sem-source — thin Lit wrapper over src/reading/source.ts.
 *
 * The snapshot is taken in connectedCallback — synchronously, before
 * Lit's first render touches the light DOM (the component renders into
 * light DOM, and Lit's `<!---->` markers must not appear in the fence):
 * the element's children are fully parsed at upgrade time because the
 * defining chunk is a deferred/module script. While the document is
 * still loading, the snapshot waits for DOMContentLoaded (children must
 * be parsed first) — the same moment the core pass runs, so ordering
 * decides, and the pass is idempotent either way. `updated()` then
 * builds the chrome and re-runs the snapshot only as an idempotent
 * safety net; chrome present means nothing is added.
 */
export class SemSource extends SemElement {
  #snapshotted = false;
  #wired = false;

  connectedCallback(): void {
    super.connectedCallback();
    if (this.#snapshotted) return;
    this.#snapshotted = true;
    const take = (): void => { this.#snapshot(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', take, { once: true });
    else take();
  }

  updated(): void {
    if (this.#wired) return;
    this.#wired = true;
    const go = (): void => {
      this.#snapshot();
      enhanceSourceElement(this);
      this.setAttribute('data-sem-upgraded', '');
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
    else go();
  }

  /**
   * Snapshot + sanitise. Whichever pass wins the race (this one, or the
   * core scan), the tree it captures may already carry Lit's render
   * markers — this component renders into light DOM, so the first render
   * drops empty `<!---->` comments among the children. They are runtime
   * artefacts, never authored content, and the fence's promise is the
   * markup as written: the snapshot strips empty comment nodes from the
   * captured clone (recursively; real comments with text stay).
   */
  #snapshot(): void {
    snapshotSourceElement(this);
    const tpl = this.querySelector(':scope > template.sem-source-raw');
    if (!tpl) return;
    const strip = (parent: Node): void => {
      for (const n of [...parent.childNodes]) {
        if (n.nodeType === Node.COMMENT_NODE) {
          if (!(n.textContent || '').trim()) n.remove();
          continue;
        }
        strip(n);
      }
    };
    strip(tpl.content);
  }
}

SemElement.register('sem-source', SemSource);
