/**
 * paste — the one paste/copy pipeline (CORE-V2 §7.4).
 *
 * Cooked mode inserts at the cursor; a multiline paste is bracketed: each
 * newline becomes a visible ⏎ token stored in the buffer, so a pasted blob
 * can never auto-execute and the user sees (and can delete) exactly what
 * arrived. Raw mode hands the text to the app verbatim as paste(text).
 *
 * Copy is the reverse: navigator.clipboard when it works, the hidden
 * input's select + execCommand('copy') as the file:// fallback — both feed
 * from extractText, so canvas selection and DOM mirror copy identical
 * text.
 */

export const PASTE_MARK = '⏎'; // ⏎ — the visible token for a pasted newline

/** True when the text would span more than one cooked line. */
export function isMultiline(text: string): boolean {
  return /[\n\r]/.test(text);
}

/** Every newline flavor (CRLF, LF, CR) becomes the visible ⏎ token. */
export function markPastedNewlines(text: string): string {
  return text.replace(/\r\n|\r|\n/g, PASTE_MARK);
}

/** The cooked-mode insert for a paste: verbatim when single-line, bracketed when not. */
export function pasteForCooked(text: string): { text: string; multiline: boolean } {
  const multiline = isMultiline(text);
  return { text: multiline ? markPastedNewlines(text) : text, multiline };
}

/** The copy transports, injectable for tests. */
export interface CopyTargets {
  /** navigator.clipboard.writeText when available. */
  writeText?(text: string): Promise<void>;
  /** The file:// fallback: select the hidden input + execCommand('copy'). */
  execCommandCopy?(): boolean;
}

/**
 * Copy `text`, best transport first. Resolves true when something
 * accepted it, false when every transport failed (callers then degrade to
 * "select on the mirror + Ctrl+C", which the platform still serves).
 */
export async function copyText(text: string, targets: CopyTargets = {}): Promise<boolean> {
  if (targets.writeText) {
    try {
      await targets.writeText(text);
      return true;
    } catch {
      // reject (permission denied, non-secure context) — try the fallback
    }
  }
  if (targets.execCommandCopy) return targets.execCommandCopy();
  return false;
}
