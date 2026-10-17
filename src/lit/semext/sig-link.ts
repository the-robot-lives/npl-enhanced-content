/**
 * semext/sig-link — the SigNoz deep-link builder shared by the sig-*
 * embed family (metrics, traces, logs, synthetic monitor).
 *
 * Deliberately PLAIN: the link is the SigNoz base URL plus the authored
 * attributes as query parameters — no SigNoz route path is invented here,
 * because no documented URL scheme for apm.noizu.com exists in this repo's
 * docs (checked 2026-10-18). A later lane that owns the service surface
 * can retarget `sigLink()` alone; every contract points at this builder.
 *
 * The chrome never carries credentials: the link is an ordinary anchor the
 * signed-in operator clicks; `livePolicy` stays 'never' on every sig-*
 * element — nothing here fetches.
 */

/** The observation cluster's base URL (authored docs: fleet SigNoz). */
export const SIGNOZ_BASE = 'https://apm.noizu.com/';

/** Query parameters the builder may carry; every value is authored. */
export interface SigLinkParams {
  query?: string | null;
  range?: string | null;
  env?: string | null;
  monitor?: string | null;
}

/** Build the deep link. Empty values are dropped; an all-empty parameter
 *  set yields the bare base URL. Always http(s) — the base is constant. */
export function sigLink(params: SigLinkParams = {}): string {
  const qs = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    const v = (value ?? '').trim();
    if (v) qs.set(name, v);
  }
  const q = qs.toString();
  return q ? `${SIGNOZ_BASE}?${q}` : SIGNOZ_BASE;
}
