/**
 * inspector — the docked right-hand Properties panel (§5.4, Instrument
 * shell).
 *
 * Live-apply alternative to the property modal: each widget writes its op to
 * the model immediately (one `setAttr`/`removeAttr` per change = one undo
 * entry), so tweaking `variant` in the rail updates the canvas as you go.
 * Widget mapping matches `property-modal.ts` exactly — allowedValues →
 * select (+ custom), boolean → bare-attr checkbox, integer/number → number
 * input, else text; unknown attributes land under an "Advanced" disclosure
 * with remove buttons; item lists and JSON payloads stay in the modal ("All
 * properties…", which opens `openPropertiesModal` for the same node).
 *
 * Safety note: every value flows into model ops, never into innerHTML —
 * the model escapes on emit.
 */

import type { ElementNode } from '../model/types.js';
import { type AttrSpec, type EditorContext } from './context.js';

const CUSTOM = '__sem-ed-custom__';

const RUNTIME_ATTRS = new Set([
  'data-sem-upgraded',
  'data-sem-edit-node',
  'data-sem-editing',
  'data-sem-chrome',
  'data-sem-inert',
  'data-npl-generated',
]);

export interface InspectorHooks {
  /** "All properties…" — open the full modal for this node. */
  onAllProperties(id: string): void;
}

export class InspectorPanel {
  readonly root: HTMLElement;
  #ctx: EditorContext | null = null;
  #hooks: InspectorHooks;
  #body: HTMLElement;

  constructor(hooks: InspectorHooks) {
    this.#hooks = hooks;
    this.root = document.createElement('aside');
    this.root.className = 'sem-ed-inspector';
    this.root.setAttribute('aria-label', 'Properties inspector');

    const head = document.createElement('div');
    head.className = 'sem-ed-inspector-head';
    const title = document.createElement('h2');
    title.className = 'sem-ed-inspector-title';
    title.textContent = 'Properties';
    head.appendChild(title);
    this.root.appendChild(head);

    this.#body = document.createElement('div');
    this.#body.className = 'sem-ed-inspector-body';
    this.root.appendChild(this.#body);
    this.#showEmpty();
  }

  setContext(ctx: EditorContext): void {
    this.#ctx = ctx;
  }

  /** Rebuild the panel for the current selection (no-op pre-open). */
  refresh(): void {
    const ctx = this.#ctx;
    if (ctx === null) return;
    const selected = ctx.selectedId;
    const node = selected === null || selected === undefined ? undefined : ctx.doc.node(selected);
    if (node === undefined || node.kind !== 'element') {
      this.#showEmpty();
      return;
    }
    this.#render(ctx, node as ElementNode);
  }

  #showEmpty(): void {
    this.#body.textContent = '';
    const p = document.createElement('p');
    p.className = 'sem-ed-inspector-empty';
    p.textContent = 'Select an element to inspect its properties.';
    this.#body.appendChild(p);
  }

  #render(ctx: EditorContext, host: ElementNode): void {
    const doc = this.root.ownerDocument;
    if (doc === null) return;
    this.#body.textContent = '';

    const tag = host.name.toLowerCase();
    const title = ctx.descriptorView?.descriptorFor(tag)?.title ?? tag;

    const heading = document.createElement('p');
    heading.className = 'sem-ed-inspector-target';
    const strong = doc.createElement('strong');
    strong.textContent = title;
    heading.appendChild(strong);
    const chip = doc.createElement('code');
    chip.textContent = tag;
    heading.appendChild(chip);
    this.#body.appendChild(heading);

    const schema = ctx.schema?.schemaFor(tag) ?? null;
    const specs: readonly AttrSpec[] = schema?.attrs ?? [];
    const known = new Set(specs.map((s) => s.name.toLowerCase()));
    const valueOf = (name: string): string | null => {
      const a = host.attrs.find((x) => x.name.toLowerCase() === name);
      return a === undefined ? null : a.value;
    };

    for (const spec of specs) this.#buildField(ctx, host, spec, valueOf(spec.name.toLowerCase()));

    // Advanced: attributes the schema does not know (runtime markers are
    // chrome, never authored data).
    const unknown = host.attrs.filter(
      (a) => !known.has(a.name.toLowerCase()) && !RUNTIME_ATTRS.has(a.name.toLowerCase()),
    );
    if (unknown.length > 0) {
      const details = doc.createElement('details');
      details.className = 'sem-ed-advanced';
      const sum = doc.createElement('summary');
      sum.textContent = `Advanced (${unknown.length})`;
      details.appendChild(sum);
      for (const attr of unknown) {
        const wrap = doc.createElement('div');
        wrap.className = 'sem-ed-field sem-ed-field-advanced';
        const label = doc.createElement('label');
        label.textContent = attr.name;
        label.htmlFor = `sem-ed-ins-adv-${attr.name.toLowerCase()}`;
        wrap.appendChild(label);
        const input = doc.createElement('input');
        input.type = 'text';
        input.id = label.htmlFor;
        input.className = 'sem-ed-input';
        input.value = attr.value ?? '';
        input.addEventListener('change', () => {
          this.#apply(ctx, host, attr.name.toLowerCase(), input.value === '' ? null : input.value);
        });
        wrap.appendChild(input);
        const remove = doc.createElement('button');
        remove.type = 'button';
        remove.className = 'sem-ed-btn sem-ed-btn-danger';
        remove.textContent = 'Remove';
        remove.setAttribute('aria-label', `Remove attribute ${attr.name}`);
        remove.addEventListener('click', () => this.#apply(ctx, host, attr.name.toLowerCase(), null));
        wrap.appendChild(remove);
        details.appendChild(wrap);
      }
      this.#body.appendChild(details);
    }

    const all = doc.createElement('button');
    all.type = 'button';
    all.className = 'sem-ed-btn sem-ed-btn-add';
    all.textContent = 'All properties…';
    all.addEventListener('click', () => this.#hooks.onAllProperties(host.id));
    this.#body.appendChild(all);
  }

  /** One schema-driven, live-applying field. */
  #buildField(ctx: EditorContext, host: ElementNode, spec: AttrSpec, current: string | null): void {
    const doc = this.root.ownerDocument;
    if (doc === null) return;
    const name = spec.name.toLowerCase();
    const had = host.attrs.some((a) => a.name.toLowerCase() === name);

    const wrap = doc.createElement('div');
    wrap.className = 'sem-ed-field';
    const label = doc.createElement('label');
    label.className = 'sem-ed-field-label';
    label.textContent = spec.name + (spec.required === true ? ' *' : '');
    label.htmlFor = `sem-ed-ins-f-${name}`;
    wrap.appendChild(label);

    const apply = (value: string | null, bare = false): void => this.#apply(ctx, host, name, value, bare);

    const allowed = spec.allowedValues ?? [];
    if (allowed.length > 0) {
      const select = doc.createElement('select');
      select.id = label.htmlFor;
      select.className = 'sem-ed-input';
      const unset = doc.createElement('option');
      unset.value = '';
      unset.textContent = '(not set)';
      select.appendChild(unset);
      for (const v of allowed) {
        const opt = doc.createElement('option');
        opt.value = v;
        opt.textContent = v;
        select.appendChild(opt);
      }
      const hadValue = had && current !== null;
      if (hadValue && !allowed.includes(current)) {
        const opt = doc.createElement('option');
        opt.value = current;
        opt.textContent = `${current} (custom)`;
        select.appendChild(opt);
      }
      const custom = doc.createElement('option');
      custom.value = CUSTOM;
      custom.textContent = 'custom…';
      select.appendChild(custom);
      select.value = hadValue ? current : '';
      select.addEventListener('change', () => {
        if (select.value === CUSTOM) {
          customBox.hidden = false;
          customBox.focus();
          return;
        }
        customBox.hidden = true;
        apply(select.value === '' ? null : select.value);
      });
      wrap.appendChild(select);
      const customBox = doc.createElement('input');
      customBox.type = 'text';
      customBox.className = 'sem-ed-input';
      customBox.hidden = true;
      customBox.placeholder = 'custom value';
      customBox.addEventListener('change', () => apply(customBox.value === '' ? null : customBox.value));
      wrap.appendChild(customBox);
    } else if (spec.type === 'boolean') {
      const check = doc.createElement('input');
      check.type = 'checkbox';
      check.id = label.htmlFor;
      check.className = 'sem-ed-input sem-ed-check';
      check.checked = had && (current === null || current === '' || current === 'true');
      check.addEventListener('change', () => {
        // boolean attrs are bare (`collapsed`): present = true, absent = false
        apply(check.checked ? '' : null, true);
      });
      wrap.appendChild(check);
    } else {
      const numeric = spec.type === 'integer' || spec.type === 'number';
      const input = doc.createElement('input');
      input.type = numeric ? 'number' : 'text';
      input.id = label.htmlFor;
      input.className = 'sem-ed-input';
      if (had && current !== null) input.value = current;
      if (spec.default) input.placeholder = spec.default;
      input.addEventListener('change', () => apply(input.value === '' ? null : input.value));
      wrap.appendChild(input);
    }

    if (spec.description) {
      const hint = doc.createElement('p');
      hint.className = 'sem-ed-field-hint';
      hint.textContent = spec.description;
      wrap.appendChild(hint);
    }
    this.#body.appendChild(wrap);
  }

  /** Apply one attribute op (its own transaction → one undo entry).
   *  `value: null` removes; `bare` writes the attribute with no value. */
  #apply(ctx: EditorContext, host: ElementNode, name: string, value: string | null, bare = false): void {
    const current = host.attrs.find((a) => a.name.toLowerCase() === name);
    const op =
      value === null
        ? { type: 'removeAttr' as const, node: host.id, name }
        : { type: 'setAttr' as const, node: host.id, name, value: bare ? null : value };
    const check = ctx.doc.canApply(op);
    if (!check.ok) {
      ctx.announce(`Cannot set ${name}: ${check.reason ?? 'rejected'}`);
      return;
    }
    if (op.type === 'removeAttr' && current === undefined) return;
    if (op.type === 'setAttr' && current !== undefined && current.value === op.value) return;
    ctx.doc.apply(op);
    ctx.announce(
      value === null ? `Removed ${name}.` : `${name} set to ${op.value === null ? '(bare)' : op.value}.`,
    );
  }
}
