/**
 * templates/stops — the ONE template-stop grammar (EDITOR.md §3.3 snippets;
 * owner: insert lane, shared with the controller by coordinator decision
 * 2026-10-14 — the two competing choice-stop forms are unified here).
 *
 * Snippet-standard TextMate-style stops in authoring-form XHTML:
 *   `${1:placeholder}`   named text stop
 *   `${2|a,b,c|}`        choice stop (comma-separated options)
 *   `${3}`               bare stop
 * Choice options are literal strings split on `,` (no escaping, no trim —
 * descriptors author them without inner spaces). There is deliberately NO
 * `${n|first|rest|}` form: the two-grammar split (insert's `${n|a,b|}` vs
 * the controller's legacy `${n|first|rest|}` regex) was resolved in favour
 * of the snippet standard; every shipped `*.edit.ts` already uses it.
 *
 * Consumers: the controller's `stripTemplateStops` becomes `stripStops`;
 * the insert lane's wizard interpolation scans with `STOP_SCAN` (single
 * pass, so substituted values are never re-parsed as grammar).
 */

export type StopKind = 'named' | 'choice' | 'bare';

export interface Stop {
  kind: StopKind;
  /** The template stop's ordinal (display only — binding is positional). */
  index: number;
  /** named stops: the placeholder text. */
  text?: string;
  /** choice stops: the comma-split options, verbatim. */
  options?: string[];
  /** The full matched source text. */
  raw: string;
}

/** One combined scan so substituted values are never re-parsed as stops. */
export const STOP_SCAN =
  /\$\{(?<n>\d+):(?<text>[^}]*)\}|\$\{(?<c>\d+)\|(?<options>[^}]*)\|\}|\$\{(?<b>\d+)\}/g;

/** All stops in `xml`, in source order. */
export function scanStops(xml: string): Stop[] {
  const stops: Stop[] = [];
  for (const m of xml.matchAll(STOP_SCAN)) {
    const g = m.groups ?? {};
    if (g.n !== undefined) {
      stops.push({ kind: 'named', index: Number(g.n), text: g.text ?? '', raw: m[0] });
    } else if (g.c !== undefined) {
      stops.push({
        kind: 'choice',
        index: Number(g.c),
        options: (g.options ?? '').split(','),
        raw: m[0],
      });
    } else {
      stops.push({ kind: 'bare', index: Number(g.b), raw: m[0] });
    }
  }
  return stops;
}

/** A choice stop's fallback option (the snippet-standard first option). */
export function firstChoice(stop: Stop): string {
  return stop.options?.[0] ?? '';
}

/**
 * Strip every stop for plain (non-wizard) insertion: named → placeholder
 * text, choice → first option, bare → removed. Single pass. This is the
 * replacement for the controller's `stripTemplateStops`, whose legacy
 * choice regex (`[^|,}]*` + free tail) mangled option lists.
 */
export function stripStops(xml: string): string {
  return xml.replace(STOP_SCAN, (whole: string, ...rest: unknown[]) => {
    const groups = (rest[rest.length - 1] ?? {}) as Record<string, string | undefined>;
    if (groups.n !== undefined) return groups.text ?? '';
    if (groups.c !== undefined) return (groups.options ?? '').split(',')[0] ?? '';
    return '';
  });
}
