/**
 * property-modal — the schema-driven Properties dialog (EDITOR.md §5.4).
 *
 * Built from three injected views on the context — `ctx.schema` (attribute
 * specs per tag), `ctx.descriptorView` (item lists / JSON payload) and the doc —
 * so it runs today against test doubles and unchanged when the schema lane's
 * loader lands.
 *
 * Contract pinned by §5.4:
 *  - widgets by attribute shape: allowedValues → select (plus "(custom)" so a
 *    hand-authored value is visible, not destroyed), boolean → checkbox,
 *    integer/number → number input, else text; required fields are marked and
 *    warned inline, never blocked;
 *  - attributes the schema does not know land in an "Advanced" section with
 *    remove buttons;
 *  - the sub-item list editor reorders / adds / removes descriptor items;
 *  - the dialog applies ONE transaction on Save; Cancel/Esc applies nothing;
 *  - JSON payload items validate live (message under the field) and save as
 *    one setText on the payload's raw text node — the only script node the
 *    editor authors (§8).
 *
 * Safety note: every value here flows into model ops (`setAttr`/`setText`),
 * never into innerHTML — the model escapes on emit.
 */

import type { ElementNode, TextNode } from '../model/types.js';
import { getTemplateCompiler, type AttrSpec, type EditorContext } from './context.js';
import { matchChildren, selectorSupports } from './selector.js';

/** Select sentinel for "a hand-authored value outside the enum". */
const CUSTOM = '__sem-ed-custom__';
const NUMERIC = /^-?\d+(\.\d+)?$/;

type PendingAttr = { op: 'set'; value: string | null } | { op: 'remove' };

/** One row of the item-list editor. `xml` set ⇒ inserted this session
 *  (nodeId is a modal-local placeholder, materialised at save). */
interface ItemRow {
  nodeId: string;
  xml?: string;
  removed: boolean;
}

export interface PropertyModalOptions {
  /** Called once, after the dialog closes; `saved` = Save (vs cancel/Esc). */
  onClose?: (saved: boolean) => void;
}

/**
 * Open the Properties dialog for `ctx.selectedId`. Returns the dialog, or
 * null when the selection is not an element node. All changes stay pending
 * until Save; the element refreshes from the doc's change event.
 */
export function openPropertiesModal(ctx: EditorContext, options: PropertyModalOptions = {}): HTMLDialogElement | null {
  const selected = ctx.selectedId;
  const doc = ctx.doc;
  const node = selected === null ? undefined : doc.node(selected);
  if (node === undefined || node.kind !== 'element') return null;
  const host: ElementNode = node;
  const tag = host.name.toLowerCase();

  const descriptor = ctx.descriptorView?.descriptorFor(tag) ?? null;
  const schema = ctx.schema?.schemaFor(tag) ?? null;
  const specs: readonly AttrSpec[] = schema === null ? [] : schema.attrs;

  const openedAtVersion = doc.version;
  /** Attr changes by lowercase attribute name — applied only at save. */
  const pending = new Map<string, PendingAttr>();
  const valueOf = (name: string): string | null => {
    const p = pending.get(name);
    if (p !== undefined) return p.op === 'set' ? p.value : null;
    const attr = host.attrs.find((a) => a.name.toLowerCase() === name);
    return attr === undefined ? null : attr.value;
  };

  // ── item rows ────────────────────────────────────────────────────────────
  const itemList = descriptor === null ? null : descriptor.itemList ?? null;
  const itemsOK = itemList !== null && selectorSupports(itemList.childSelector);
  const items: ItemRow[] = [];
  const loadItems = (): void => {
    items.length = 0;
    if (!itemsOK) return;
    for (const child of matchChildren(doc.childrenOf(host.id), itemList.childSelector)) {
      items.push({ nodeId: child.id, removed: false });
    }
  };
  loadItems();

  // ── JSON payload (descriptor.jsonItems) ──────────────────────────────────
  const jsonSpec = descriptor === null ? null : descriptor.jsonItems ?? null;
  const jsonOK = jsonSpec !== null && selectorSupports(jsonSpec.selector);
  let payload: ElementNode | null = null;
  let payloadText: TextNode | null = null;
  if (jsonOK && jsonSpec !== null) {
    const found = matchChildren(doc.childrenOf(host.id), jsonSpec.selector);
    payload = found.length > 0 ? found[0] : null;
    if (payload !== null) {
      for (const child of doc.childrenOf(payload.id)) {
        if (child.kind === 'text') {
          payloadText = child;
          break;
        }
      }
    }
  }
  let jsonDraft: string | null = null; // null = untouched

  // ── DOM ──────────────────────────────────────────────────────────────────
  const dialog = document.createElement('dialog');
  dialog.className = 'sem-ed-modal';

  const heading = document.createElement('h2');
  heading.id = 'sem-ed-modal-title';
  heading.textContent = `Properties — ${descriptor?.title ?? schema?.title ?? tag}`;
  dialog.appendChild(heading);

  const body = document.createElement('div');
  body.className = 'sem-ed-modal-body';
  dialog.appendChild(body);

  const summary = document.createElement('p');
  summary.className = 'sem-ed-modal-summary';
  summary.setAttribute('role', 'status');
  dialog.appendChild(summary);

  const actions = document.createElement('div');
  actions.className = 'sem-ed-modal-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'sem-ed-btn';
  cancelBtn.textContent = 'Cancel';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'sem-ed-btn sem-ed-btn-primary';
  saveBtn.textContent = 'Save';
  actions.append(cancelBtn, saveBtn);
  dialog.appendChild(actions);

  // ── attribute fields ─────────────────────────────────────────────────────
  const knownNames = new Set(specs.map((s) => s.name.toLowerCase()));
  const attrBox = document.createElement('fieldset');
  attrBox.className = 'sem-ed-fieldset';
  const attrBoxLegend = document.createElement('legend');
  attrBoxLegend.textContent = 'Attributes';
  attrBox.appendChild(attrBoxLegend);
  body.appendChild(attrBox);

  const requiredWarn = (): HTMLElement => {
    const w = document.createElement('p');
    w.className = 'sem-ed-field-warn';
    w.hidden = true;
    return w;
  };

  const buildAttrField = (spec: AttrSpec): void => {
    const name = spec.name.toLowerCase();
    const wrap = document.createElement('div');
    wrap.className = 'sem-ed-field';

    const label = document.createElement('label');
    label.className = 'sem-ed-field-label';
    label.textContent = spec.name + (spec.required === true ? ' *' : '');
    label.htmlFor = `sem-ed-f-${name}`;
    wrap.appendChild(label);

    const current = valueOf(name);
    const allowed = spec.allowedValues ?? [];
    const had = host.attrs.some((a) => a.name.toLowerCase() === name);

    if (allowed.length > 0) {
      const select = document.createElement('select');
      select.id = label.htmlFor;
      select.className = 'sem-ed-input';
      const unset = document.createElement('option');
      unset.value = '';
      unset.textContent = '(not set)';
      select.appendChild(unset);
      for (const v of allowed) {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        select.appendChild(opt);
      }
      if (had && current !== null && !allowed.includes(current)) {
        const opt = document.createElement('option');
        opt.value = current;
        opt.textContent = `${current} (custom)`;
        select.appendChild(opt);
      }
      const custom = document.createElement('option');
      custom.value = CUSTOM;
      custom.textContent = 'custom…';
      select.appendChild(custom);
      select.value = had && current !== null ? current : '';
      select.addEventListener('change', () => {
        if (select.value === CUSTOM) {
          customBox.hidden = false;
          customBox.focus();
          return;
        }
        customBox.hidden = true;
        if (select.value === '') pending.set(name, { op: 'remove' });
        else pending.set(name, { op: 'set', value: select.value });
        refreshWarns();
      });
      wrap.appendChild(select);

      const customBox = document.createElement('input');
      customBox.type = 'text';
      customBox.className = 'sem-ed-input';
      customBox.hidden = true;
      customBox.placeholder = 'custom value';
      customBox.addEventListener('input', () => {
        pending.set(name, customBox.value === '' ? { op: 'remove' } : { op: 'set', value: customBox.value });
        refreshWarns();
      });
      wrap.appendChild(customBox);
    } else if (spec.type === 'boolean') {
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.id = label.htmlFor;
      check.className = 'sem-ed-input sem-ed-check';
      check.checked = had && (current === null || current === '' || current === 'true');
      check.addEventListener('change', () => {
        // boolean attrs are bare (`collapsed`): present = true, absent = false
        pending.set(name, check.checked ? { op: 'set', value: null } : { op: 'remove' });
        refreshWarns();
      });
      wrap.appendChild(check);
    } else {
      const numeric = spec.type === 'integer' || spec.type === 'number';
      const input = document.createElement('input');
      input.type = numeric ? 'number' : 'text';
      input.id = label.htmlFor;
      input.className = 'sem-ed-input';
      if (had && current !== null) input.value = current;
      if (spec.default) input.placeholder = spec.default;
      input.addEventListener('input', () => {
        pending.set(name, input.value === '' ? { op: 'remove' } : { op: 'set', value: input.value });
        refreshWarns();
      });
      wrap.appendChild(input);
    }

    const fieldWarn = requiredWarn();
    fieldWarn.textContent = `${spec.name} is required.`;
    wrap.appendChild(fieldWarn);
    if (spec.description) {
      const hint = document.createElement('p');
      hint.className = 'sem-ed-field-hint';
      hint.textContent = spec.description;
      wrap.appendChild(hint);
    }
    attrBox.appendChild(wrap);
  };
  for (const spec of specs) buildAttrField(spec);

  const refreshWarns = (): void => {
    for (const spec of specs) {
      if (spec.required !== true) continue;
      const wrap = attrBox.querySelector<HTMLElement>(`label[for="sem-ed-f-${spec.name.toLowerCase()}"]`)?.parentElement;
      const warnEl = wrap?.querySelector<HTMLElement>('.sem-ed-field-warn');
      if (warnEl === null || warnEl === undefined) continue;
      const v = valueOf(spec.name.toLowerCase());
      warnEl.hidden = v !== null && v !== '';
    }
  };
  refreshWarns();

  // ── advanced (attributes the schema does not know) ───────────────────────
  // Runtime markers the editor/core itself stamps are chrome, never
  // authored data — never surface them as editable properties
  // (integrate 2026-10: data-sem-upgraded leaked into the Advanced list).
  const RUNTIME_ATTRS = new Set([
    'data-sem-upgraded', 'data-sem-edit-node', 'data-sem-editing',
    'data-sem-chrome', 'data-sem-inert', 'data-npl-generated',
  ]);
  const unknownAttrs = host.attrs.filter((a) =>
    !knownNames.has(a.name.toLowerCase()) && !RUNTIME_ATTRS.has(a.name.toLowerCase()),
  );
  if (unknownAttrs.length > 0) {
    const advanced = document.createElement('details');
    advanced.className = 'sem-ed-advanced';
    const sum = document.createElement('summary');
    sum.textContent = 'Advanced';
    advanced.appendChild(sum);
    for (const attr of unknownAttrs) {
      const name = attr.name.toLowerCase();
      const wrap = document.createElement('div');
      wrap.className = 'sem-ed-field sem-ed-field-advanced';
      const label = document.createElement('label');
      label.textContent = attr.name;
      label.htmlFor = `sem-ed-adv-${name}`;
      wrap.appendChild(label);
      const input = document.createElement('input');
      input.type = 'text';
      input.id = label.htmlFor;
      input.className = 'sem-ed-input';
      input.value = attr.value ?? '';
      input.addEventListener('input', () => {
        pending.set(name, input.value === '' ? { op: 'remove' } : { op: 'set', value: input.value });
      });
      wrap.appendChild(input);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'sem-ed-btn sem-ed-btn-danger';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove attribute ${attr.name}`);
      remove.addEventListener('click', () => {
        pending.set(name, { op: 'remove' });
        wrap.hidden = true;
      });
      wrap.appendChild(remove);
      advanced.appendChild(wrap);
    }
    body.appendChild(advanced);
  }

  // ── item list editor ─────────────────────────────────────────────────────
  const itemsBox = document.createElement('fieldset');
  itemsBox.className = 'sem-ed-fieldset';
  const itemsBoxLegend = document.createElement('legend');
  itemsBoxLegend.textContent = itemList !== null ? `Items — ${itemList.label}` : 'Items';
  itemsBox.appendChild(itemsBoxLegend);
  const rowsHost = document.createElement('div');
  rowsHost.className = 'sem-ed-items';
  itemsBox.appendChild(rowsHost);

  const visibleRows = (): ItemRow[] => items.filter((r) => !r.removed);
  const previewOf = (row: ItemRow): string => {
    if (row.xml !== undefined) return '(new)';
    const text = doc.textOf(row.nodeId).trim();
    return text === '' ? row.nodeId : text.length > 40 ? text.slice(0, 39) + '…' : text;
  };

  const renderItems = (): void => {
    rowsHost.textContent = '';
    if (!itemsOK) {
      const note = document.createElement('p');
      note.className = 'sem-ed-field-hint';
      note.textContent = 'This element declares no editable item list.';
      rowsHost.appendChild(note);
      return;
    }
    const visible = visibleRows();
    for (let i = 0; i < visible.length; i++) {
      const row = visible[i];
      const line = document.createElement('div');
      line.className = 'sem-ed-item-row';

      const label = document.createElement('span');
      label.className = 'sem-ed-item-label';
      label.textContent = `${itemList.label} ${i + 1} — ${previewOf(row)}`;
      line.appendChild(label);

      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'sem-ed-btn';
      up.textContent = '↑';
      up.setAttribute('aria-label', `Move ${itemList.label} ${i + 1} up`);
      up.disabled = i === 0;
      up.addEventListener('click', () => swapRows(row, visible[i - 1]));
      line.appendChild(up);

      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'sem-ed-btn';
      down.textContent = '↓';
      down.setAttribute('aria-label', `Move ${itemList.label} ${i + 1} down`);
      down.disabled = i === visible.length - 1;
      down.addEventListener('click', () => swapRows(row, visible[i + 1]));
      line.appendChild(down);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'sem-ed-btn sem-ed-btn-danger';
      remove.textContent = '−';
      remove.setAttribute('aria-label', `Remove ${itemList.label} ${i + 1}`);
      remove.addEventListener('click', () => {
        row.removed = true;
        renderItems();
      });
      line.appendChild(remove);
      rowsHost.appendChild(line);
    }
    if (visible.length < (itemList.max ?? Infinity)) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'sem-ed-btn sem-ed-btn-add';
      add.textContent = `+ Add ${itemList.label}`;
      if (getTemplateCompiler() === null) {
        add.disabled = true;
        add.title = 'No template compiler wired';
      }
      add.addEventListener('click', () => {
        items.push({ nodeId: `~ed-item-${items.length}-${Date.now()}`, xml: itemList.template.xml, removed: false });
        renderItems();
      });
      rowsHost.appendChild(add);
    }
  };
  const swapRows = (a: ItemRow, b: ItemRow | undefined): void => {
    if (b === undefined) return;
    const ia = items.indexOf(a);
    const ib = items.indexOf(b);
    if (ia < 0 || ib < 0) return;
    items[ia] = b;
    items[ib] = a;
    renderItems();
  };
  renderItems();
  if (itemList !== null) body.appendChild(itemsBox);

  // ── JSON payload editor ──────────────────────────────────────────────────
  if (jsonOK && jsonSpec !== null) {
    const jsonBox = document.createElement('fieldset');
    jsonBox.className = 'sem-ed-fieldset';
    const jsonLegend = document.createElement('legend');
    jsonLegend.textContent = `JSON — ${jsonSpec.label}`;
    jsonBox.appendChild(jsonLegend);
    const area = document.createElement('textarea');
    area.className = 'sem-ed-input sem-ed-json';
    area.spellcheck = false;
    area.rows = 8;
    area.value = payloadText !== null ? doc.textOf(payloadText.id) : '';
    area.setAttribute('aria-label', jsonSpec.label);
    const jsonErr = document.createElement('p');
    jsonErr.className = 'sem-ed-field-warn';
    jsonErr.setAttribute('role', 'status');
    jsonErr.hidden = true;
    area.addEventListener('input', () => {
      jsonDraft = area.value;
      if (jsonDraft.trim() === '') {
        jsonErr.hidden = false;
        jsonErr.textContent = 'The JSON payload is empty — Save would remove it.';
        return;
      }
      try {
        JSON.parse(jsonDraft);
        jsonErr.hidden = true;
        jsonErr.textContent = '';
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        jsonErr.hidden = false;
        jsonErr.textContent = `Invalid JSON: ${message}`;
      }
    });
    jsonBox.append(area, jsonErr);
    if (jsonSpec.schemaHint) {
      const hint = document.createElement('p');
      hint.className = 'sem-ed-field-hint';
      hint.textContent = jsonSpec.schemaHint;
      jsonBox.appendChild(hint);
    }
    body.appendChild(jsonBox);
  }

  // ── save ─────────────────────────────────────────────────────────────────
  const save = (): void => {
    if (doc.version !== openedAtVersion) {
      summary.textContent = 'The document changed while this dialog was open — review and try again.';
      return;
    }
    const problems: string[] = [];
    try {
      doc.transaction(
        'properties',
        (tx) => {
          // 1. attribute sets / removes
          for (const [name, p] of pending) {
            if (p.op === 'remove') tx.push({ type: 'removeAttr', node: host.id, name });
            else tx.push({ type: 'setAttr', node: host.id, name, value: p.value });
          }
          // 2. item removals first …
          for (const row of items) {
            if (row.removed && row.xml === undefined) {
              tx.push({ type: 'removeNode', node: row.nodeId });
            }
          }
          // … then the surviving block, in modal order
          const surviving = visibleRows();
          const startIndex = surviving
            .map((r) => doc.indexOf(r.nodeId))
            .filter((i) => i >= 0)
            .sort((a, b) => a - b)[0];
          const base = startIndex ?? 0;
          const placedNew = new Set<string>();
          for (let i = 0; i < surviving.length; i++) {
            const row = surviving[i];
            if (row.xml === undefined) continue;
            const compiler = getTemplateCompiler();
            const built = compiler === null ? null : compiler(row.xml, doc);
            if (built === null) {
              problems.push('a new item could not be built from its template');
              continue;
            }
            tx.push({ type: 'insertNode', parent: host.id, index: base + i, node: built });
            placedNew.add(row.nodeId);
          }
          for (let i = 0; i < surviving.length; i++) {
            const row = surviving[i];
            if (row.xml !== undefined) continue; // freshly inserted: already placed
            const currentIndex = doc.indexOf(row.nodeId);
            if (currentIndex >= 0 && currentIndex !== base + i) {
              tx.push({ type: 'moveNode', node: row.nodeId, parent: host.id, index: base + i });
            }
          }
          void placedNew;
          // 3. JSON payload
          if (jsonDraft !== null && jsonSpec !== null) {
            const draft = jsonDraft;
            if (draft.trim() === '' || !isValidJson(draft)) {
              problems.push('the JSON payload was left unchanged (invalid)');
            } else if (payloadText !== null) {
              tx.push({ type: 'setText', node: payloadText.id, value: draft });
            } else {
              const created = doc.createElement({
                tag: 'script',
                attrs: [{ name: 'type', value: 'application/json' }],
                children: [doc.createText(draft, 'raw')],
              });
              tx.push({
                type: 'insertNode',
                parent: host.id,
                index: doc.childrenOf(host.id).length,
                node: created,
              });
            }
          }
        },
      );
    } catch (err) {
      // the model rolled the transaction back — nothing was applied
      summary.textContent = `Save failed and was rolled back: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }
    for (const spec of specs) {
      if (spec.required !== true) continue;
      const v = valueOf(spec.name.toLowerCase());
      if (v === null || v === '') problems.push(`${spec.name} is still required`);
    }
    ctx.announce(
      problems.length > 0
        ? `Saved with warnings on ${tag}: ${problems.join('; ')}.`
        : `Updated ${tag} properties.`,
    );
    dialog.returnValue = 'save';
    dialog.close();
  };
  saveBtn.addEventListener('click', save);
  cancelBtn.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', () => {
    /* Esc closes without ops — the close handler does the bookkeeping. */
  });
  dialog.addEventListener('keydown', (e) => {
    // Enter in a field moves through fields, never submits (§5.4)
    if (e.key !== 'Enter') return;
    const target = e.target as HTMLElement;
    if (
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLButtonElement
    ) {
      return;
    }
    e.preventDefault();
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>('input, select, textarea, button'),
    ).filter((el) => !el.hidden && (el as HTMLButtonElement).disabled !== true);
    const at = focusables.indexOf(target);
    (focusables[at + 1] ?? focusables[0])?.focus();
  });

  const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialog.addEventListener('close', () => {
    const saved = dialog.returnValue === 'save';
    priorFocus?.focus();
    dialog.remove();
    options.onClose?.(saved);
  });

  document.body.appendChild(dialog);
  dialog.showModal();
  dialog.querySelector<HTMLElement>('input, select, textarea')?.focus();
  return dialog;
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
