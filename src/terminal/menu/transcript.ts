/**
 * menu/transcript — *Open plain transcript* (CORE-V2 §8.5).
 *
 * Serialises ring + primary through the ONE extractText into a text/plain
 * Blob URL opened in a new browsing context. Works on file:// — no fetch,
 * no network, the same data-only pattern as the element's `window` action
 * (blob + `noopener,noreferrer`, revoke timer).
 *
 * The view is injected (tests pass stubs); production passes the
 * ownerDocument's defaultView.
 */

export interface TranscriptView {
  URL: {
    createObjectURL(blob: Blob): string;
    revokeObjectURL(url: string): void;
  };
  Blob: typeof Blob;
  open(url: string, target: string, features?: string): unknown;
  setTimeout(fn: () => void, ms: number): unknown;
}

const REVOKE_AFTER_MS = 60_000;

/**
 * Open `text` as a plain-text document. Returns false when the browser
 * blocked the pop-up (the caller prints the refusal — the menu itself
 * never writes to the transcript).
 */
export function openPlainTranscript(text: string, view: TranscriptView, filename = 'transcript.txt'): boolean {
  const blob = new view.Blob([text], { type: 'text/plain' });
  const url = view.URL.createObjectURL(blob);
  const win = view.open(url, '_blank', 'noopener,noreferrer');
  view.setTimeout(() => view.URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  void filename; // browsers name blob documents by URL; kept for future a[download] use
  return win !== null && win !== undefined;
}
