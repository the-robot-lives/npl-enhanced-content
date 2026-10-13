/**
 * audience — profile declarations and visibility matching.
 *
 * Contract: spec/schema/sem-audiences.md. Pure functions only: nothing here
 * touches the DOM beyond reading it. Callers (fallback/audience, lit/base)
 * decide what to do with a `false`.
 *
 * Failure policy is fail-OPEN throughout. A document is a readable artifact
 * first; an authoring typo must never make content unreachable, so an
 * unrecognized audience token warns and shows the content.
 *
 * Written tight on purpose: this ships inside the fallback bundle, whose raw
 * size is what a file:// document carries.
 */

import { parseTokens } from './tokens.js';

export interface Profile {
  id: string;
  label: string | null;
  implies: string[];
}

/** id → every id it satisfies, transitively, including itself. */
export type AudienceClosure = Map<string, Set<string>>;

/** Warning channel — same voice as the fallback's duplicate-`data-key` check. */
export function warn(message: string): void {
  if (typeof console !== 'undefined') console.warn('semtext: ' + message);
}

function attr(el: Element, name: string): string | null {
  // conventions.md §2: `data-<name>` wins when both spellings are present —
  // read it first. (fallback/attrs mirrors bare→data-* only when absent, so
  // a both-spelled element must not resolve to the bare value here.)
  return el.getAttribute('data-' + name) ?? el.getAttribute(name);
}

type ProfileRoot = Document | DocumentFragment | Element;

/**
 * Read every `.sem-profile` / `<sem-profile>` inside a `.sem-audiences` /
 * `<sem-audiences>` block. Both attribute spellings are accepted. A profile
 * without an id, or with a repeated id, is warned about and dropped.
 */
export function parseProfiles(root: ProfileRoot): Profile[] {
  const out: Profile[] = [];
  const seen = new Set<string>();
  if (!root || typeof root.querySelectorAll !== 'function') return out;
  root
    .querySelectorAll(':is(.sem-audiences, sem-audiences) :is(.sem-profile, sem-profile)')
    .forEach((node) => {
      const id = (attr(node, 'id') || '').trim();
      if (!id || seen.has(id)) return warn('sem-audiences: profile ignored (missing or duplicate id "' + id + '")');
      seen.add(id);
      out.push({ id, label: attr(node, 'label'), implies: parseTokens(attr(node, 'implies')) });
    });
  return out;
}

/**
 * Transitive closure of `implies`. A cycle simply terminates (an id is
 * visited once); an unknown target is warned about and honored anyway.
 */
export function buildClosure(profiles: readonly Profile[]): AudienceClosure {
  const by = new Map(profiles.map((p) => [p.id, p]));
  const closure: AudienceClosure = new Map();
  for (const p of profiles) {
    const reached = new Set<string>([p.id]);
    // Depth-first, carrying the current path: a `reached` hit alone also
    // fires on diamonds (two roads to one profile), which is not a cycle —
    // only a target already on the path is. A cycle breaks the walk and is
    // warned once per occurrence along it.
    const walk = (id: string, path: readonly string[]): void => {
      const q = by.get(id);
      if (!q) {
        reached.add(id);
        warn('sem-audiences: "' + p.id + '" implies unknown profile "' + id + '"');
        return;
      }
      for (const t of q.implies) {
        if (path.indexOf(t) >= 0) {
          warn('sem-audiences: "' + p.id + '" implies a cycle through "' + t + '"');
          continue;
        }
        if (reached.has(t)) continue;
        reached.add(t);
        walk(t, [...path, t]);
      }
    };
    walk(p.id, [p.id]);
    closure.set(p.id, reached);
  }
  return closure;
}

/**
 * Visibility test for an audience spec.
 *
 *   null / ""      → universal, always visible
 *   "a,b"          → visible when the active profile is (or implies) a or b
 *   "!a"           → visible unless the active profile is (or implies) a
 *   "a,!b"         → authoring error; warn and honor the positive terms only
 *   unknown token  → authoring error; warn and return TRUE (fail-open)
 *
 * With no profiles declared anywhere the closure is empty, every token is
 * unknown, and every element is therefore visible.
 */
export function matches(
  spec: string | null | undefined,
  active: string | null,
  closure: AudienceClosure,
): boolean {
  const pos: string[] = [];
  const neg: string[] = [];
  for (const term of parseTokens(spec)) {
    const name = term.replace(/^!/, '');
    if (!name) continue;
    let known = closure.has(name);
    closure.forEach((set) => { if (set.has(name)) known = true; });
    if (!known) {
      warn('audience: unknown profile "' + name + '" in "' + spec + '" — showing content');
      return true;
    }
    (term[0] === '!' ? neg : pos).push(name);
  }
  if (pos.length && neg.length) warn('audience: "' + spec + '" mixes ! and plain terms — using plain');
  const sat = (t: string): boolean =>
    active !== null && (active === t || closure.get(active)?.has(t) === true);
  if (pos.length) return pos.some(sat);
  if (neg.length) return !neg.some(sat);
  return true;
}

/** Convenience: parse + close over a root in one call. */
export function closureFor(root: ProfileRoot): AudienceClosure {
  return buildClosure(parseProfiles(root));
}
