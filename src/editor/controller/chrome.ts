/**
 * controller/chrome — editor chrome DOM: hover outline + label chip,
 * +/− item glyphs, link popover, aria-live region (EDITOR.md §4.3/4.6/§7).
 *
 * All chrome nodes carry `data-sem-chrome` (excluded from mapping and
 * serialization), live inside the host element, and are removed on detach.
 * Chip/glyph are real buttons with aria-labels; textContent only.
 */

import type { EditorContext, ElementBinding } from './types.js';
import { addItem, removeItem, setLink } from './actions.js';
import { itemListItems } from './map.js';

const CHROME = 'data-sem-chrome';

export function ensureInjected(doc: Document, css: string): void {
  if (doc.querySelector('style[data-sem-editor-css]')) return;
  const style = doc.createElement('style');
  style.setAttribute('data-sem-editor-css', '');
  style.textContent = css;
  doc.head.appendChild(style);
}

export function stampHost(binding: ElementBinding): void {
  binding.el.classList.add('sem-ed-host');
}

export function clearHost(binding: ElementBinding): void {
  binding.el.classList.remove('sem-ed-host');
}

/** Remove every chrome node under the host (detach path, §4.2). */
export function clearChrome(binding: ElementBinding): void {
  binding.el.querySelectorAll(`[${CHROME}]`).forEach((n) => n.remove());
  binding.el.classList.remove('sem-ed-item');
  hideOutline(binding);
}

// ── outline + chip (§4.3) ────────────────────────────────────────────────────

export function showOutline(binding: ElementBinding, target: Element): void {
  const controller = binding.controller;
  if (controller === null) return;
  const ctx = controller.ctx;
  hideOutline(binding);
  const hostRect = binding.el.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  const outline = binding.el.ownerDocument.createElement('div');
  outline.className = 'sem-ed-outline';
  outline.setAttribute(CHROME, '');
  outline.style.left = `${rect.left - hostRect.left}px`;
  outline.style.top = `${rect.top - hostRect.top}px`;
  outline.style.width = `${rect.width}px`;
  outline.style.height = `${rect.height}px`;
  const chip = binding.el.ownerDocument.createElement('button');
  chip.type = 'button';
  chip.className = 'sem-ed-chip';
  chip.setAttribute(CHROME, '');
  chip.style.left = '0px';
  chip.style.top = '-1.5em';
  chip.dataset.semEdChip = '1';
  const title = binding.descriptor?.title ?? target.tagName.toLowerCase();
  chip.setAttribute('aria-label', `Edit ${title} (${target.tagName.toLowerCase()})`);
  const name = binding.el.ownerDocument.createElement('span');
  name.textContent = title;
  const tag = binding.el.ownerDocument.createElement('span');
  tag.className = 'sem-ed-chip-tag';
  tag.textContent = target.tagName.toLowerCase();
  chip.append(name, tag);
  chip.addEventListener('click', () => {
  if (ctx.shell?.openProperties) ctx.shell.openProperties(binding);
  else ctx.announce('Properties unavailable (no shell)');
});
  outline.appendChild(chip);
  binding.el.appendChild(outline);
}

export function hideOutline(binding: ElementBinding): void {
  binding.el.querySelector('.sem-ed-outline')?.remove();
}

// ── +/− glyphs (§4.6) ────────────────────────────────────────────────────────

export function stampGlyphs(ctx: EditorContext, binding: ElementBinding): void {
  const list = binding.descriptor?.itemList;
  if (list === undefined) return;
  const items = itemListItems(ctx, binding);
  items.forEach((item, i) => {
    if (item.querySelector(`:scope > .sem-ed-glyph[data-glyph="minus"]`)) return;
    item.classList.add('sem-ed-item');
    const minus = binding.el.ownerDocument.createElement('button');
    minus.type = 'button';
    minus.className = 'sem-ed-glyph';
    minus.setAttribute(CHROME, '');
    minus.dataset.glyph = 'minus';
    minus.textContent = '−';
    minus.setAttribute('aria-label', `Remove ${list.label} ${i + 1} of ${items.length}`);
    minus.addEventListener('click', () => removeItem(ctx, binding, item));
    item.appendChild(minus);
  });
  if (items.length > 0 && (list.max === undefined || items.length < list.max)) {
    const parent = items[0].parentElement ?? binding.el;
    if (parent.querySelector(':scope > .sem-ed-glyph[data-glyph="plus"]')) return;
    const plus = binding.el.ownerDocument.createElement('button');
    plus.type = 'button';
    plus.className = 'sem-ed-glyph';
    plus.setAttribute(CHROME, '');
    plus.dataset.glyph = 'plus';
    plus.textContent = '+';
    plus.setAttribute('aria-label', `Add ${list.label}`);
    plus.addEventListener('click', () => addItem(ctx, binding));
    parent.appendChild(plus);
  }
}

// ── link popover (§3.4 linkFields) ───────────────────────────────────────────

export function openLinkPopover(
  ctx: EditorContext,
  binding: ElementBinding,
  field: { attr?: string; slotSelector?: string; label: string },
): void {
  closeLinkPopover(binding);
  const doc = binding.el.ownerDocument;
  const pop = doc.createElement('div');
  pop.className = 'sem-ed-popover';
  pop.setAttribute(CHROME, '');
  const label = doc.createElement('span');
  label.textContent = field.label;
  const input = doc.createElement('input');
  input.type = 'text';
  input.placeholder = 'https://…';
  const current =
    field.attr !== undefined
      ? binding.el.getAttribute(field.attr)
      : binding.el.querySelector(field.slotSelector ?? '')?.textContent ?? '';
  input.value = current ?? '';
  const err = doc.createElement('span');
  err.className = 'sem-ed-popover-err';
  const apply = doc.createElement('button');
  apply.type = 'button';
  apply.textContent = 'Apply';
  const remove = doc.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Remove link';
  const close = (): void => closeLinkPopover(binding);
  apply.addEventListener('click', () => {
    const r = setLink(ctx, binding, field, input.value);
    if (!r.ok) {
      input.setAttribute('aria-invalid', 'true');
      err.textContent = r.reason ?? 'invalid';
      return;
    }
    close();
  });
  remove.addEventListener('click', () => {
    setLink(ctx, binding, field, '');
    close();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') apply.click();
    if (e.key === 'Escape') close();
  });
  pop.append(label, input, err, apply, remove);
  binding.el.appendChild(pop);
  input.focus();
}

export function closeLinkPopover(binding: ElementBinding): void {
  binding.el.querySelector('.sem-ed-popover')?.remove();
}

// ── aria-live (§7) ───────────────────────────────────────────────────────────

export function createAnnouncer(doc: Document): (msg: string) => void {
  let region = doc.querySelector('.sem-ed-live');
  if (region === null) {
    region = doc.createElement('div');
    region.className = 'sem-ed-live';
    region.setAttribute('aria-live', 'polite');
    doc.body.appendChild(region);
  }
  return (msg: string) => {
    region!.textContent = '';
    queueMicrotask(() => {
      region!.textContent = msg;
    });
  };
}
