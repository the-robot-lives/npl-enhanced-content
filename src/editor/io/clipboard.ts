/**
 * editor/io/clipboard — copy the document source (§12).
 *
 * The §12 ladder: async Clipboard API first; on denial (or on file:// where
 * it is unavailable) a hidden textarea + `execCommand('copy')`. Same shape
 * as `src/shared/clipboard.ts`, but io needs the SUCCESS BOOLEAN for the
 * aria-live announcement ("Copied document source" / "Copy failed"), which
 * the shared helper (status-region style) does not return — hence a local
 * ladder rather than a signature change in shared code.
 */

/** Hidden-textarea fallback; true when the browser reports the copy. */
function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('aria-hidden', 'true');
  ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/** Copy `text`; resolves false when every rung of the ladder fails. */
export async function copySource(text: string): Promise<boolean> {
  const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (clip && typeof clip.writeText === 'function') {
    try {
      await clip.writeText(text);
      return true;
    } catch {
      // denied/blocked — fall through to the legacy rung
    }
  }
  return legacyCopy(text);
}
