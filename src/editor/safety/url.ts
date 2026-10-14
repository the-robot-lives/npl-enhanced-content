/**
 * safety/url — the one URL rule (EDITOR.md §8).
 *
 * Every URL-ish edit (link popover, wizard `url` fields, attribute inputs on
 * href/src/endpoint/fixtures) passes here BEFORE an op is written. Allowed:
 * empty, same-document (`#…`), `http(s):`, `mailto:`, and scheme-less
 * (relative) references — which includes scheme-relative `//host/x`.
 * Everything else is rejected: `javascript:`, `vbscript:`, and `data:` —
 * except `data:image/*`, which a `src`-shaped attribute may carry (tiny
 * inline images are authored content; every other data: payload is an
 * attack surface).
 */

export interface UrlCheck {
  ok: boolean;
  reason?: string;
}

const NAMED_SCHEMES = /^(?:https?|mailto):/i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** `src`-shaped attributes may carry `data:image/*` (never other data:). */
function srcShaped(attr: string | undefined): boolean {
  return attr === 'src' || attr === 'poster' || attr === 'fixtures';
}

export function isSafeUrl(value: string | null | undefined, opts?: { attr?: string }): UrlCheck {
  const v = (value ?? '').trim();
  if (v === '') return { ok: true };
  if (v.startsWith('#')) return { ok: true }; // same-document
  if (NAMED_SCHEMES.test(v)) return { ok: true };
  // Any other named scheme (javascript:, vbscript:, file:, data:, …) is
  // rejected except the one safe carve-out.
  if (ANY_SCHEME.test(v)) {
    if (srcShaped(opts?.attr) && /^data:image\/(png|jpeg|gif|webp|svg\+xml);/i.test(v)) {
      return { ok: true };
    }
    return { ok: false, reason: `${v.split(':', 1)[0]}: URLs are not allowed here` };
  }
  return { ok: true }; // relative (path- or scheme-relative)
}

/** Convenience for op paths: throw-ready boolean. */
export function safeUrlOr(value: string | null | undefined, attr?: string): string | null {
  return isSafeUrl(value, { attr }).ok ? (value ?? '').trim() : null;
}
