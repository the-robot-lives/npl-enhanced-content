import { SemElement } from './base.js';
import { DATA_SOURCE, enhanceDataVisualizerElement } from '../reading/data.js';

/**
 * sem-data-visualizer — thin Lit wrapper over src/reading/data.ts.
 * Lifecycle only: waits for its sem-data-source children, then runs the same
 * idempotent enhance the bundle uses (native table, schema JSON, views,
 * per-column sort). Spec: spec/data-visualizer.md.
 */
export class SemDataVisualizer extends SemElement {
  #wired = false;

  updated(): void {
    if (this.#wired) return;
    this.#wired = true;
    void this.whenChildrenReady(DATA_SOURCE).then(() => {
      enhanceDataVisualizerElement(this);
      this.setAttribute('data-sem-upgraded', '');
      this.removeAttribute('data-sem-fallback');
    });
  }
}

SemElement.register('sem-data-visualizer', SemDataVisualizer);
