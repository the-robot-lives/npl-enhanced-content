import { SemElement } from '../base.js';
import { defineNpl, nplParam } from './shared.js';

/**
 * npl-vos — display-only bracket for an NPL vector-of-self block: the
 * psychodynamic state (id, ego, mood, super-ego, optional collective) an
 * NPL persona brackets each substantive response with. Source: NPL
 * `vos` blocks; `phase` marks which half of the bracket (`entry` or
 * `exit`). No events, no behaviour — rows only.
 *
 * Parts are authored as direct child elements carrying their part name
 * (`data-vos="<part>"`, bare `vos="<part>"` also read; `data-` wins, the
 * shared dual-form rule). The element renders a phase label then one
 * labelled row per part in the canonical order — authored order is not
 * relied on — moving each authored element whole into its row body, so
 * content stays light-DOM searchable and copyable.
 *
 * Phase follows the npl-mood pattern with one refinement: the EFFECTIVE
 * phase is resolved by #resolvePhase — data- wins, but the element's own
 * runtime mirror never outranks a fresher authored spelling — then
 * mirrored to `data-phase` through afterParse, deferred past parse so a
 * sem-source snapshot sees authored markup only. An absent phase mirrors
 * to NO data-phase at all: the class-form alias `[data-phase]` must never
 * match a phase-less vos. The label is kept in step with the same
 * resolved value in the same deferred write, so a later phase change
 * re-renders it — assembly runs once, the label sync runs every update.
 */
const VOS_PARTS = ['id', 'ego', 'mood', 'super-ego', 'collective'];

export class NplVos extends SemElement {
  static properties = {
    phase: { type: String, reflect: true },
  };

  declare phase: string;

  #awaitingParts = false;

  /** The phase value our mirror last wrote (null = we mirrored nothing).
   *  Provenance for #resolvePhase — see it. */
  #mirroredPhase: string | null = null;

  constructor() {
    super();
    this.phase = '';
  }

  /**
   * Resolve the effective phase. data- wins over bare (the dual-form
   * contract) EXCEPT when data- is our own runtime mirror: then the bare
   * spelling — authored or cleared since — is the fresher voice. A
   * data- value we did not mirror is author-authored and wins outright.
   */
  #resolvePhase(): string {
    const data = this.getAttribute('data-phase');
    const bare = this.getAttribute('phase');
    if (data != null && data !== this.#mirroredPhase) return data.trim();
    if (bare != null) return bare.trim();
    return (data ?? '').trim();
  }

  updated(): void {
    // dual-form contract: mirror the RESOLVED phase to data-phase so
    // CSS/extraction read one form, deferred past parse like sem-note.
    // Read through #resolvePhase, not the `phase` property: the property
    // tracks only the bare attribute, so data-phase authoring would be
    // ignored, and mirroring the bare constructor default would clobber
    // authored data-phase and false-match the class-form `[data-phase]`
    // alias on every phase-less vos. The guard leaves an already-correct
    // mirror untouched; an empty phase removes it.
    const phase = this.#resolvePhase();
    this.afterParse('phase', () => {
      if (phase) {
        if (this.getAttribute('data-phase') !== phase) this.setAttribute('data-phase', phase);
      } else {
        this.removeAttribute('data-phase');
      }
      this.#mirroredPhase = phase || null;
      this.#syncPhaseLabel(phase);
    });
    if (this.#parts().length > 0) {
      this.#assemble();
      return;
    }
    // element upgraded pre-parse: children aren't there yet at first update
    this.#awaitParts();
  }

  /** Authored part elements still unwrapped (direct children only). */
  #parts(): Element[] {
    return Array.from(this.querySelectorAll(':scope > :is([data-vos], [vos])'));
  }

  /**
   * Build the bracket: one labelled row per authored part, rows in the
   * canonical part order, phase label leading. Idempotent — wrapped parts
   * are not re-wrapped, rows are moved (appendChild), never rebuilt. The
   * phase label itself is maintained by #syncPhaseLabel (updated()), so a
   * phase authored or changed after assembly is still honoured.
   */
  #assemble(): void {
    for (const part of this.#parts()) {
      const name = nplParam(part, 'vos') ?? '';
      const row = document.createElement('div');
      row.className = 'npl-vos-row';
      row.setAttribute('data-vos-row', name);
      const label = document.createElement('span');
      label.className = 'npl-vos-row-label';
      label.textContent = name;
      const body = document.createElement('div');
      body.className = 'npl-vos-row-body';
      body.appendChild(part);
      row.append(label, body);
      this.appendChild(row);
    }
    for (const name of VOS_PARTS) {
      for (const row of this.#rowsNamed(name)) this.appendChild(row);
    }
    // parts outside the catalog still display — trailing the known five
    const known = new Set(VOS_PARTS);
    for (const row of this.querySelectorAll(':scope > .npl-vos-row')) {
      if (!known.has(row.getAttribute('data-vos-row') ?? '')) this.appendChild(row);
    }
  }

  /**
   * Phase label: a leading `.npl-vos-phase` carrying the resolved phase —
   * inserted before the rows (generated chrome leads the authored
   * children), removed entirely when no phase is authored. Idempotent.
   */
  #syncPhaseLabel(phase: string): void {
    const label = this.querySelector(':scope > .npl-vos-phase');
    if (!phase) {
      label?.remove();
      return;
    }
    const lead = label ?? document.createElement('div');
    lead.className = 'npl-vos-phase';
    lead.textContent = phase;
    if (label == null) this.insertBefore(lead, this.firstChild);
  }

  #rowsNamed(name: string): Element[] {
    return Array.from(
      this.querySelectorAll(`:scope > .npl-vos-row[data-vos-row="${name}"]`),
    );
  }

  #awaitParts(): void {
    if (this.#awaitingParts) return;
    this.#awaitingParts = true;
    void this.whenChildrenReady(':scope > :is([data-vos], [vos])').then(() => {
      this.#awaitingParts = false;
      this.requestUpdate();
    });
  }
}

defineNpl('npl-vos', NplVos);
