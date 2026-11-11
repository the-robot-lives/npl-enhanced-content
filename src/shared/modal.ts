/**
 * shared/modal — the one full-page modal shell (factored 0.9.5).
 *
 * Formerly private state of src/reading/data-modal.ts (the data-visualizer
 * Expand viewer); sem-see-also needed the same dialog semantics — backdrop,
 * role="dialog" panel, a Close button, Escape, the Tab focus trap, focus
 * restore and the "children teleported into the panel, returned on close"
 * contract — so the shell lives here and every caller names its own classes
 * and flag attribute. Exactly one shell may be open at a time per document;
 * opening a second closes the first (the pre-factor behavior).
 *
 * Callers own their vocabulary: `backdropClass`/`panelClass`/`closeClass`/
 * `contentClass` default to the shared `sem-modal*` names but the data
 * visualizer passes its historical `sem-data-modal*` names so the shipped
 * theme CSS keeps applying, and the close hook lets a caller reset its own
 * chrome (the Expand button's aria-expanded) without the shell knowing
 * about buttons it did not mint.
 *
 * The content teleport is the whole point (spec/data-visualizer.md §10):
 * the caller moves LIVE nodes in — listeners survive the move — and finds
 * them back in `container` in document order after close. `onClose` runs
 * after the children are home and the backdrop is removed.
 */

export interface ModalShell {
  container: Element;
  backdrop: HTMLElement;
  panel: HTMLElement;
  content: HTMLElement;
}

export interface ModalShellOptions {
  /** Accessible name for the dialog panel. */
  label: string;
  backdropClass?: string;
  panelClass?: string;
  closeClass?: string;
  contentClass?: string;
  /** The marker stamped on the container while its children are away. */
  flagAttr?: string;
  closeLabel?: string;
  /** Runs after the children are teleported into the panel. */
  onOpen?: (shell: ModalShell) => void;
  /** Runs after the children are home, the flag cleared, backdrop gone. */
  onClose?: (container: Element) => void;
}

interface ShellState extends ModalShell {
  opts: Required<Pick<ModalShellOptions, 'flagAttr'>> & ModalShellOptions;
  restoreFocus: HTMLElement | null;
  onKey: (e: KeyboardEvent) => void;
}

const MODAL_FLAG_DEFAULT = 'data-sem-modal-open';

let openState: ShellState | null = null;

/** True when `container`'s children are currently teleported into a shell. */
export function modalShellOpenFor(container: Element, flagAttr?: string): boolean {
  if (openState) return openState.container === container && (flagAttr === undefined || openState.opts.flagAttr === flagAttr);
  return container.hasAttribute(flagAttr ?? MODAL_FLAG_DEFAULT);
}

function focusables(panel: HTMLElement): HTMLElement[] {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], textarea, input, select, [tabindex]:not([tabindex="-1"])',
    ),
  );
}

/**
 * Open the shell over `container`: teleport its children into the panel,
 * stamp the flag, trap focus, focus the Close button. Closes any shell
 * already open first — one modal at a time.
 */
export function openModalShell(container: Element, options: ModalShellOptions): ModalShell {
  if (openState) closeModalShell();
  const opts = { flagAttr: MODAL_FLAG_DEFAULT, ...options };
  const backdrop = document.createElement('div');
  backdrop.className = opts.backdropClass ?? 'sem-modal';
  const panel = document.createElement('div');
  panel.className = opts.panelClass ?? 'sem-modal-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', opts.label);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = opts.closeClass ?? 'sem-modal-close';
  close.textContent = opts.closeLabel ?? 'Close';
  panel.appendChild(close);
  const content = document.createElement('div');
  content.className = opts.contentClass ?? 'sem-modal-content';
  panel.appendChild(content);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  const restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  Array.from(container.childNodes).forEach((node) => content.appendChild(node));
  container.setAttribute(opts.flagAttr, '');

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModalShell();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusables(panel);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !panel.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', onKey, true);
  close.addEventListener('click', () => closeModalShell());
  close.focus();

  const shell: ModalShell = { container, backdrop, panel, content };
  openState = { ...shell, opts, restoreFocus, onKey };
  opts.onOpen?.(shell);
  return shell;
}

/**
 * Close the open shell: children home in order, flag cleared, `onClose`
 * hook, focus restored. `flagAttr` narrows the close to the shell carrying
 * that flag — a caller's close for its own modal never closes another
 * caller's (the pre-factor isolation: each module's state was private).
 * No-op when nothing (or nothing matching) is open.
 */
export function closeModalShell(options?: { flagAttr?: string }): void {
  if (!openState) return;
  if (options?.flagAttr !== undefined && openState.opts.flagAttr !== options.flagAttr) return;
  const { container, backdrop, content, restoreFocus, onKey, opts } = openState;
  openState = null;
  document.removeEventListener('keydown', onKey, true);
  if (content) Array.from(content.childNodes).forEach((node) => container.appendChild(node));
  container.removeAttribute(opts.flagAttr);
  backdrop.remove();
  opts.onClose?.(container);
  restoreFocus?.focus();
}

/** The open shell, if any — lets a caller mint deep-link state from it. */
export function currentModalShell(): ModalShell | null {
  return openState ? { container: openState.container, backdrop: openState.backdrop, panel: openState.panel, content: openState.content } : null;
}
