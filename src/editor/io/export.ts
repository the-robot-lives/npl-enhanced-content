/**
 * editor/io/export — full-document serialization + download (§12).
 *
 * `exportDocument` is the ONE bytes-out path: `doc.serialize()` — untouched
 * nodes byte-identical to the authored source, edited nodes re-emitted from
 * the model (never the DOM, never the preview projection). The optional
 * `fragmentRoot` marker supports the shell-less claim mode, where the edited
 * element's subtree is the whole document: one comment names the root so a
 * re-import can find the splice point. The marker round-trips (comments are
 * preserved trivia), so export → import → export stays stable.
 *
 * `downloadSource` is a plain Blob + anchor download: the browser UTF-8
 * encodes the exact string we hand it — no DOM re-serialization anywhere,
 * which is what keeps export byte-exact.
 */

import type { EditorDocument } from '../model/types.js';
import { documentTitle } from '../shell/context.js';

/** Options for `exportDocument` (io/types re-exports the store shapes). */
export interface ExportOptions {
  /** Shell-less fragment export: prefix `<!-- semtext-editor:fragment <root> -->`
   *  naming the fragment root element. Default off. */
  fragmentRoot?: string;
}

/** Marker prefix for fragment exports (one line, own newline). */
export function fragmentMarker(fragmentRoot: string): string {
  return `<!-- semtext-editor:fragment ${fragmentRoot} -->\n`;
}

/** The export string: the model's exact bytes (optionally fragment-marked). */
export function exportDocument(doc: EditorDocument, opts?: ExportOptions): string {
  const source = doc.serialize();
  const root = opts?.fragmentRoot;
  return root ? fragmentMarker(root) + source : source;
}

/** Extension every editor export carries. */
export const SEM_HTML_EXT = '.sem.html';

/** Slug a document title into a safe filename stem. */
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'untitled' : slug.slice(0, 80);
}

/** `<title>` (else "Untitled") → `my-document.sem.html`. */
export function exportFilename(doc: EditorDocument): string {
  return slugify(documentTitle(doc)) + SEM_HTML_EXT;
}

/** True when a stored/open filename looks like an editor document. */
export function isSemHtmlFilename(name: string): boolean {
  return name.toLowerCase().endsWith(SEM_HTML_EXT) || name.toLowerCase().endsWith('.xhtml') ||
    name.toLowerCase().endsWith('.html');
}

/**
 * Download `source` as `filename`. Blob + object URL + programmatic click —
 * the same altitude as the terminal's file outputs. Safe to call from tests
 * with `URL.createObjectURL` stubbed.
 */
export function downloadSource(source: string, filename: string): void {
  if (typeof URL.createObjectURL !== 'function') {
    throw new Error('io: downloads unavailable (no URL.createObjectURL)');
  }
  const blob = new Blob([source], { type: 'application/xhtml+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Reclaim on the next turn; keep the URL alive through the click handler.
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
