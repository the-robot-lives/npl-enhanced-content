/**
 * data/deeplink — phase 6 deep-link state (spec/data-visualizer.md §10).
 *
 * Pure string/table logic only; the DOM wiring lives in
 * src/reading/data-modal.ts. The hash composes as `&`-joined segments in the
 * src/shared/state.ts form, so a data-viz link coexists with any other
 * segment (the sem-views bare `id/view` link, `sem-audience=…`) untouched.
 * Four keys and one marker:
 *
 *   #view=<name>&bucket=<source-name>   one view of one source
 *   #dv=<visualizer-id>&view=<name>     container-scoped state
 *   #dv=<id>&q=<encoded>                the edited default query (DV-Q5)
 *   &modal=1                            minted from the modal — reopen it
 *   #ref=<see-also-id>                  open the sem-see-also modal named by
 *                                       the id (0.9.5, spec/schema/sem-see-also.md)
 */

import { visibleColumns, type ViewSpec } from './table.js';

export interface DataDeepLink {
  /** Container id, matched exactly — HTML ids are case-sensitive. */
  dv: string | null;
  /** Source bucket name; compared through the §5 normalized reference. */
  bucket: string | null;
  /** Declared view name, matched exactly. */
  view: string | null;
  /** Edited default query text, percent-encoded in the hash. */
  q: string | null;
  /** sem-see-also element id whose preview modal should open. */
  ref: string | null;
  /** Open the modal after applying the rest. */
  modal: boolean;
}

const KEYS = new Set(['dv', 'bucket', 'view', 'q', 'ref']);

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Parse the data-viz segments out of a hash. Null when none are present. */
export function parseDataDeepLink(hash: string): DataDeepLink | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const link: DataDeepLink = { dv: null, bucket: null, view: null, q: null, ref: null, modal: false };
  let any = false;
  for (const segment of raw.split('&')) {
    if (segment === '') continue;
    const eq = segment.indexOf('=');
    const name = eq < 0 ? segment : segment.slice(0, eq);
    if (name === 'modal') {
      const value = eq < 0 ? '1' : segment.slice(eq + 1);
      link.modal = value !== '' && value !== '0' && value !== 'false';
      any = true;
      continue;
    }
    if (eq < 0 || !KEYS.has(name)) continue;
    const value = decode(segment.slice(eq + 1));
    if (value === '') continue;
    link[name as 'dv' | 'bucket' | 'view' | 'q' | 'ref'] = value;
    any = true;
  }
  return any ? link : null;
}

/** Serialize to `&`-joined segments (the state.ts form); empty parts drop. */
export function serializeDataDeepLink(link: DataDeepLink): string {
  const segments: string[] = [];
  if (link.dv) segments.push('dv=' + encodeURIComponent(link.dv));
  if (link.bucket) segments.push('bucket=' + encodeURIComponent(link.bucket));
  if (link.view) segments.push('view=' + encodeURIComponent(link.view));
  if (link.q) segments.push('q=' + encodeURIComponent(link.q));
  if (link.ref) segments.push('ref=' + encodeURIComponent(link.ref));
  if (link.modal) segments.push('modal=1');
  return segments.join('&');
}

/**
 * Which declared view matches the currently visible columns, if any — the
 * inverse of visibleColumns, used when minting a link from a rendered table.
 */
export function activeViewName(views: ViewSpec[], columns: string[], shown: boolean[]): string | null {
  for (const view of views) {
    const candidate = visibleColumns(view, columns);
    if (candidate.length === shown.length && candidate.every((visible, i) => visible === shown[i])) {
      return view.name;
    }
  }
  return null;
}
