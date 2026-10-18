/**
 * sem-workflow — ordered steps with gates, checks and an if-no branch
 * (spec/schema/sem-workflow.md).
 *
 * Authored form: `<sem-workflow kind duration>` containing bare
 * `<sem-step id action description gate? check? if-no? output?>` children
 * (the same `sem-step` element sem-procedure uses — its workflow-context
 * parameters live in the schema's per-parent childForm, so procedure
 * steps stay untouched). JS-off: a CSS-ordered list; the ordinals and the
 * gate/check badges are ::before/::after attr() chrome outside the
 * record. JS-on: a step's `if-no` branch (what to do when the check
 * fails) becomes a collapsible section, gated on `[data-sem-upgraded]`;
 * the authored DOM is the record — generated classes
 * (`.sem-step-branch-toggle`, `.sem-step-branch`) carry no record text.
 *
 * `parseStepModels` is the pure record model, exported for the unit tier
 * and any extraction consumer.
 *
 * Bindable: `sem-bind="<url | agent-kit/{org}/proj/{project}/workflow/{id}>"`
 * or a direct `payload` property hydrates `{plan, status}` — definition
 * markup becomes the body and the status dictionary lands on the
 * `sem-step` children (see bind.ts). Fetches once on connect; no polling.
 */

import type { PropertyValues } from 'lit';
import { SemElement } from './base.js';
import { BindableElement } from './bind.js';

/** One authored step, read off the DOM. Attr spelling is dual: the
 *  component reads `data-x` first, then the bare `x` (conventions.md §2).
 *  `ifNo` additionally accepts the underscore spelling `if_no`. */
export interface StepModel {
  ordinal: number;
  id: string | null;
  action: string;
  description: string | null;
  gate: string | null;
  check: string | null;
  ifNo: string | null;
  output: string | null;
  status: string | null;
  /** Authored inline content (the record text), whitespace-folded. */
  text: string;
}

const attr = (el: Element, name: string): string | null =>
  el.getAttribute(`data-${name}`) ?? el.getAttribute(name);

const attrLoose = (el: Element, name: string): string | null =>
  el.getAttribute(`data-${name}`) ??
  el.getAttribute(name) ??
  el.getAttribute(`data-${name.replace(/-/g, '_')}`) ??
  el.getAttribute(name.replace(/-/g, '_'));

/** The workflow's steps, document order: direct `sem-step` children (or
 *  `.sem-step` classed divs). Pure DOM read — no chrome is consulted, so
 *  the model is identical in both script tiers. */
export function parseStepModels(workflow: ParentNode): StepModel[] {
  const steps = Array.from(workflow.children).filter(
    (el) => el.localName === 'sem-step' || el.classList.contains('sem-step')
  );
  return steps.map((el, i) => ({
    ordinal: i + 1,
    id: attr(el, 'id'),
    action: attr(el, 'action') ?? '',
    description: attr(el, 'description'),
    gate: attr(el, 'gate'),
    check: attr(el, 'check'),
    ifNo: attrLoose(el, 'if-no'),
    output: attr(el, 'output'),
    status: attr(el, 'status'),
    text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
  }));
}

export class SemWorkflow extends BindableElement {
  #wired = false;

  updated(changed: PropertyValues): void {
    super.updated(changed); // BindableElement: payload intake + sem-bind attach
    if (this.#wired) return;
    this.afterParse('sem-workflow', () => {
      if (!this.#wired && this.isConnected) {
        this.#wired = true;
        this.#build();
      }
    });
  }

  #build(): void {
    let seq = 0;
    for (const step of this.children) {
      if (step.localName !== 'sem-step' && !step.classList.contains('sem-step')) continue;
      const ifNo = attrLoose(step, 'if-no');
      if (!ifNo) continue;
      const branchId = `sem-step-branch-${++seq}`;
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'sem-step-branch-toggle';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-controls', branchId);
      toggle.setAttribute('aria-label', 'If the check fails');
      const branch = document.createElement('div');
      branch.className = 'sem-step-branch';
      branch.id = branchId;
      branch.hidden = true;
      branch.inert = true;
      const label = document.createElement('span');
      label.className = 'sem-step-branch-label';
      label.textContent = 'if the check fails';
      const body = document.createElement('span');
      body.className = 'sem-step-branch-body';
      body.textContent = ifNo;
      branch.appendChild(label);
      branch.appendChild(body);
      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') === 'false';
        toggle.setAttribute('aria-expanded', String(open));
        branch.hidden = !open;
        branch.inert = !open;
      });
      step.appendChild(toggle);
      step.appendChild(branch);
    }
  }
}

SemElement.register('sem-workflow', SemWorkflow); // literal: the build's scanner keys on the string
