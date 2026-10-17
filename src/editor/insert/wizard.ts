/**
 * insert/wizard — the generic stepped insert modal (EDITOR.md §5.5 road 4).
 *
 * Descriptors with a `wizard` run this stepper instead of dropping a
 * template: steps render their `WizardField`s; Back/Next preserve entries
 * in one shared draft; Finish compiles the FINAL step's template with every
 * field's value interpolated (named-stop binding, compile.ts) and inserts
 * it in ONE op. Validation is schema-shaped, never blocking for content:
 * required fields must be filled, url fields pass the §8 safety rule,
 * numbers parse, select values stay in their options. The preview pane
 * shows the interpolated source through the real parser (best effort).
 *
 * A11y (§7): focus lands on the first field per step; Enter in a single-
 * line field advances; Esc cancels and restores focus; progress is
 * announced through the context's live region.
 */

import type { EditorContext } from '../controller/types.js';
import type { WizardField, WizardStep } from '../schema/types.js';
import { isSafeUrl } from '../safety/url.js';
import { INSERT_CSS } from './insert-css.js';
import {
  applyBooleanFields,
  compileRendered,
  interpolateTemplate,
  serializePreview,
} from './compile.js';
import { canInsertTagAt } from './placement.js';
import { documentMovedSince } from './apply.js';
import type { InsertEntry, InsertOpenOptions, InsertTarget } from './types.js';

export interface WizardOptions extends InsertOpenOptions {}

const NUMERIC = /^-?\d+(\.\d+)?$/;

function injectCss(doc: Document): void {
  if (doc.querySelector(`style[data-sem-editor-css][data-sem-ed-block="insert"]`) !== null) return;
  const style = doc.createElement('style');
  style.setAttribute('data-sem-editor-css', '');
  style.setAttribute('data-sem-ed-block', 'insert');
  style.textContent = INSERT_CSS;
  doc.head?.appendChild(style) ?? doc.appendChild(style);
}

/**
 * Open the wizard for `entry` at `target`. Returns the dialog, or null when
 * the entry has no wizard (caller should drop the plain template instead).
 */
export function openWizard(
  ctx: EditorContext,
  entry: InsertEntry,
  target: InsertTarget,
  options: WizardOptions = {},
): HTMLDialogElement | null {
  const wizard = entry.wizard;
  if (wizard === null || wizard.steps.length === 0) return null;
  const steps: readonly WizardStep[] = wizard.steps;
  const doc = ctx.doc;
  const openedAtVersion = doc.version;

  injectCss(document);

  /** One shared draft across steps — Back never loses an entry. */
  const draft: Record<string, string> = {};
  let stepIndex = 0;

  const dialog = document.createElement('dialog');
  dialog.className = 'sem-ed-modal sem-ed-ins-wizard';

  const heading = document.createElement('h2');
  heading.id = 'sem-ed-wizard-title';
  heading.textContent = `Add ${entry.title}`;
  dialog.appendChild(heading);

  const stepsLine = document.createElement('p');
  stepsLine.className = 'sem-ed-ins-steps';
  dialog.appendChild(stepsLine);

  const body = document.createElement('div');
  body.className = 'sem-ed-modal-body';
  dialog.appendChild(body);

  const status = document.createElement('p');
  status.className = 'sem-ed-modal-summary';
  status.setAttribute('role', 'status');
  dialog.appendChild(status);

  const previewLabel = document.createElement('p');
  previewLabel.className = 'sem-ed-ins-preview-label';
  previewLabel.textContent = 'Preview';
  const preview = document.createElement('pre');
  preview.className = 'sem-ed-ins-preview';
  dialog.append(previewLabel, preview);

  const actions = document.createElement('div');
  actions.className = 'sem-ed-modal-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'sem-ed-btn';
  cancelBtn.textContent = 'Cancel';
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'sem-ed-btn';
  backBtn.textContent = 'Back';
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'sem-ed-btn sem-ed-btn-primary';
  nextBtn.textContent = 'Next';
  actions.append(cancelBtn, backBtn, nextBtn);
  dialog.appendChild(actions);

  const fieldRef = (field: WizardField): string => `sem-ed-w-${field.name}`;

  const buildField = (field: WizardField): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.className = 'sem-ed-field';
    const label = document.createElement('label');
    label.className = 'sem-ed-field-label';
    label.textContent = field.label + (field.required === true ? ' *' : '');
    label.htmlFor = fieldRef(field);
    wrap.appendChild(label);

    const value = draft[field.name] ?? '';
    if (field.type === 'select') {
      const select = document.createElement('select');
      select.id = fieldRef(field);
      select.className = 'sem-ed-input';
      const unset = document.createElement('option');
      unset.value = '';
      unset.textContent = '(not set)';
      select.appendChild(unset);
      for (const option of field.options ?? []) {
        const opt = document.createElement('option');
        opt.value = option;
        opt.textContent = option;
        select.appendChild(opt);
      }
      select.value = value;
      select.addEventListener('change', () => {
        draft[field.name] = select.value;
        refreshPreview();
      });
      wrap.appendChild(select);
    } else if (field.type === 'boolean') {
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.id = fieldRef(field);
      check.className = 'sem-ed-input sem-ed-check';
      check.checked = value === 'true';
      check.addEventListener('change', () => {
        draft[field.name] = check.checked ? 'true' : '';
        refreshPreview();
      });
      wrap.appendChild(check);
    } else if (field.type === 'textarea') {
      const area = document.createElement('textarea');
      area.id = fieldRef(field);
      area.className = 'sem-ed-input';
      area.rows = 3;
      area.value = value;
      area.addEventListener('input', () => {
        draft[field.name] = area.value;
        refreshPreview();
      });
      wrap.appendChild(area);
    } else {
      const input = document.createElement('input');
      input.id = fieldRef(field);
      input.className = 'sem-ed-input';
      input.type = field.type === 'number' ? 'number' : 'text';
      input.value = value;
      if (field.placeholder) input.placeholder = field.placeholder;
      input.addEventListener('input', () => {
        draft[field.name] = input.value;
        refreshPreview();
      });
      wrap.appendChild(input);
    }

    if (field.placeholder && field.type !== 'text') {
      const hint = document.createElement('p');
      hint.className = 'sem-ed-field-hint';
      hint.textContent = field.placeholder;
      wrap.appendChild(hint);
    }
    return wrap;
  };

  const readFieldsIntoDraft = (step: WizardStep): void => {
    for (const field of step.fields) {
      const el = dialog.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        `#${CSS.escape(fieldRef(field))}`,
      );
      if (el === null) continue;
      if (el instanceof HTMLInputElement && el.type === 'checkbox') {
        draft[field.name] = el.checked ? 'true' : '';
      } else {
        draft[field.name] = el.value;
      }
    }
  };

  const booleanNames = (): string[] => {
    const names: string[] = [];
    for (const step of steps) for (const f of step.fields) if (f.type === 'boolean') names.push(f.name);
    return names;
  };

  const renderedSource = (): string => {
    const final = steps[steps.length - 1];
    // positional binding: all fields across steps, in order, ↔ the final
    // template's stops (compile.ts header documents the convention)
    const allFields = steps.flatMap((s) => s.fields);
    const interpolated = interpolateTemplate(final.template.xml, allFields, draft);
    return applyBooleanFields(interpolated, draft, booleanNames());
  };

  const refreshPreview = (): void => {
    try {
      preview.textContent = serializePreview(renderedSource()) || '(empty)';
    } catch {
      preview.textContent = '(preview unavailable)';
    }
  };

  /** Schema-shaped validation for one step; empty list = step is valid. */
  const validateStep = (step: WizardStep): string[] => {
    const problems: string[] = [];
    for (const field of step.fields) {
      const value = draft[field.name] ?? '';
      if (field.required === true && value.trim() === '') {
        problems.push(`${field.label} is required.`);
        continue;
      }
      if (value === '') continue;
      if (field.type === 'url') {
        const check = isSafeUrl(value, { attr: field.name });
        if (!check.ok) problems.push(`${field.label}: ${check.reason ?? 'not a safe URL'}.`);
      } else if (field.type === 'number' && !NUMERIC.test(value.trim())) {
        problems.push(`${field.label} must be a number.`);
      } else if (field.type === 'select' && field.options !== undefined && field.options.length > 0 && !field.options.includes(value)) {
        problems.push(`${field.label} must be one of: ${field.options.join(', ')}.`);
      }
    }
    return problems;
  };

  const showProblems = (problems: string[]): void => {
    status.textContent = problems.join(' ');
    ctx.announce(problems[0] ?? '');
  };

  const syncChrome = (): void => {
    const step = steps[stepIndex];
    stepsLine.textContent = `Step ${stepIndex + 1} of ${steps.length} — ${step.title}`;
    backBtn.disabled = stepIndex === 0;
    nextBtn.textContent = stepIndex === steps.length - 1 ? `Insert ${entry.title}` : 'Next';
    backBtn.tabIndex = 0;
  };

  const renderStep = (): void => {
    readFieldsIntoDraft(steps[stepIndex]);
    body.textContent = '';
    status.textContent = '';
    const step = steps[stepIndex];
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'sem-ed-fieldset';
    const legend = document.createElement('legend');
    legend.textContent = step.title;
    fieldset.appendChild(legend);
    for (const field of step.fields) fieldset.appendChild(buildField(field));
    body.appendChild(fieldset);
    syncChrome();
    refreshPreview();
    const first = body.querySelector<HTMLElement>('input, select, textarea');
    first?.focus();
  };

  const advance = (): void => {
    const step = steps[stepIndex];
    readFieldsIntoDraft(step);
    const problems = validateStep(step);
    if (problems.length > 0) {
      showProblems(problems);
      return;
    }
    status.textContent = '';
    if (stepIndex < steps.length - 1) {
      stepIndex += 1;
      renderStep();
      return;
    }
    finish();
  };

  const finish = (): void => {
    for (let i = 0; i < steps.length; i++) {
      const problems = validateStep(steps[i]);
      if (problems.length > 0) {
        stepIndex = i;
        renderStep();
        showProblems(problems);
        return;
      }
    }
    if (documentMovedSince(ctx, openedAtVersion)) {
      status.textContent = 'The document changed while this wizard was open — try again.';
      return;
    }
    if (!canInsertTagAt(doc, target, entry.tag)) {
      status.textContent = `A ${entry.title} cannot go there (schema placement).`;
      return;
    }
    const node = compileRendered(renderedSource(), doc);
    if (node === null) {
      status.textContent = 'The wizard result could not be built — check the fields.';
      return;
    }
    const index = Math.max(0, Math.min(target.index, doc.childrenOf(target.parentId).length));
    const op = { type: 'insertNode', parent: target.parentId, index, node } as const;
    if (!doc.canApply(op).ok) {
      status.textContent = `Insert refused: ${entry.title} cannot go at that position.`;
      return;
    }
    doc.apply(op);
    ctx.announce(`Inserted ${entry.title} via wizard.`);
    dialog.dataset.semEdResult = 'insert'; // happy-dom has no returnValue
    dialog.close();
    options.onInsert?.(entry, target);
  };

  backBtn.addEventListener('click', () => {
    if (stepIndex === 0) return;
    readFieldsIntoDraft(steps[stepIndex]); // draft survives Back (§5.5)
    stepIndex -= 1;
    renderStep();
  });
  nextBtn.addEventListener('click', advance);
  cancelBtn.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', () => {
    /* Esc closes without ops. */
  });
  dialog.addEventListener('keydown', (e) => {
    // Enter in a single-line field advances (textarea keeps its newline)
    if (e.key !== 'Enter') return;
    const t = e.target as HTMLElement;
    if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t instanceof HTMLButtonElement) return;
    e.preventDefault();
    advance();
  });

  const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialog.addEventListener('close', () => {
    const inserted = dialog.dataset.semEdResult === 'insert'; // happy-dom-safe
    // leave the top layer before restoring focus (inert-background no-op)
    dialog.remove();
    if (priorFocus?.isConnected) priorFocus.focus();
    if (!inserted) options.onCancel?.();
  });

  document.body.appendChild(dialog);
  renderStep();
  dialog.showModal();
  return dialog;
}
