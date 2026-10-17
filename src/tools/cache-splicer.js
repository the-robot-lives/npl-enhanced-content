/**
 * cache-splicer — the pure cache-region splicer for the semtext-refresh CLI.
 *
 * A SemText document may delimit machine-refreshable regions with paired
 * HTML comments:
 *
 *   <!-- semtext:cache:start <tag> <key> -->
 *   ...region body (the authored snapshot the refresh tooling may rewrite)...
 *   <!-- semtext:cache:end -->
 *
 * Contract (each rule unit-tested in test/unit/refresh-splicer.test.mjs):
 *   - The splicer rewrites ONLY marked regions. Bytes outside the markers
 *     (authored prose, attributes, everything else) are preserved
 *     bit-identically — the splice is offset-based slicing, never a
 *     re-serialization of the document.
 *   - Region identity is the `<tag> <key>` pair; a duplicate pair in one
 *     file is a malformed-marker error.
 *   - Malformed markers (start without end, end without start, a start
 *     nested inside a region, an unknown tag, a duplicate key) are
 *     reported as errors; the CLI turns any error into exit 1 and never
 *     writes the file.
 *   - `normalizeTimestamps` blanks `last-refreshed="..."` values so an
 *     --check comparison is idempotent: a region whose only change is the
 *     refresh stamp is NOT drift.
 *   - `seedCacheRegions` wraps an authored element in a fresh marker pair:
 *     the start marker opens on the element's own line, the end marker
 *     lands directly after the element's authored snapshot content (its
 *     closing tag). Seeding a file that already marks the element is a
 *     no-op.
 *
 * No DOM, no I/O, no clock: every function here is pure over its string
 * inputs, which is what makes the idempotency and byte-fidelity tests
 * meaningful.
 */

/** Marker grammar. Keys and tags are non-space tokens; the start marker
 *  tolerates flexible inner whitespace, the end marker is bare. */
const START_RE = /<!--\s*semtext:cache:start\s+([^\s>]+)\s+([^\s>]+?)\s*-->/g;
const END_RE = /<!--\s*semtext:cache:end\s*-->/g;

/** Blank the `last-refreshed` attribute value (the only timestamp the
 *  vocabulary stamps) so timestamp-only rewrites compare equal. */
export function normalizeTimestamps(text) {
  return text.replace(/(\blast-refreshed\s*=\s*")([^"]*)(")/g, '$1<timestamp>$3');
}

/**
 * Parse every cache region out of a document.
 *
 * @param {string} source the full document text
 * @param {Set<string>|null} [knownTags] accepted tag names ($defs keys +
 *   tag aliases). Null disables the vocabulary check (raw parsing).
 * @returns {{regions: Array, errors: Array}} regions in document order —
 *   each `{ tag, key, id, body, startMarker, endMarker, startOffset,
 *   bodyStart, bodyEnd, endOffset }` — plus one `{ message, offset }` per
 *   malformed marker.
 */
export function parseCacheRegions(source, knownTags = null) {
  const markers = [];
  START_RE.lastIndex = 0;
  for (let m; (m = START_RE.exec(source)); ) {
    markers.push({ kind: 'start', index: m.index, end: m.index + m[0].length, tag: m[1], key: m[2], text: m[0] });
  }
  END_RE.lastIndex = 0;
  for (let m; (m = END_RE.exec(source)); ) {
    markers.push({ kind: 'end', index: m.index, end: m.index + m[0].length, text: m[0] });
  }
  markers.sort((a, b) => a.index - b.index || (a.kind === 'start' ? -1 : 1));

  const regions = [];
  const errors = [];
  let open = null;
  for (const marker of markers) {
    if (marker.kind === 'start') {
      if (open) {
        errors.push({ message: `nested cache start "${marker.tag} ${marker.key}" inside region "${open.tag} ${open.key}"`, offset: marker.index });
        continue;
      }
      open = marker;
      continue;
    }
    if (!open) {
      errors.push({ message: 'cache:end without a matching cache:start', offset: marker.index });
      continue;
    }
    const region = {
      tag: open.tag,
      key: open.key,
      id: `${open.tag} ${open.key}`,
      body: source.slice(open.end, marker.index),
      startMarker: open.text,
      endMarker: marker.text,
      startOffset: open.index,
      bodyStart: open.end,
      bodyEnd: marker.index,
      endOffset: marker.end,
    };
    if (knownTags && !knownTags.has(open.tag)) {
      errors.push({ message: `unknown vocabulary tag "${open.tag}" in cache region`, offset: open.index });
      open = null;
      continue;
    }
    if (regions.some((r) => r.id === region.id)) {
      errors.push({ message: `duplicate cache region "${region.id}"`, offset: open.index });
      open = null;
      continue;
    }
    regions.push(region);
    open = null;
  }
  if (open) {
    errors.push({ message: `cache:start "${open.tag} ${open.key}" has no matching cache:end`, offset: open.index });
  }
  return { regions, errors };
}

/**
 * Rebuild the document with new region bodies. Pure: the input string is
 * never aliased or mutated, and every byte outside a rewritten region —
 * including the original marker comments themselves — is copied through
 * verbatim.
 *
 * @param {string} source full document text
 * @param {Map<string,string>|function(region):?string} updates region id
 *   (`"<tag> <key>"`) to the new body, or a callback returning the new
 *   body (null/undefined keeps the current one).
 * @returns {string} the spliced document
 */
export function applyCacheRegions(source, updates) {
  const { regions } = parseCacheRegions(source);
  let out = '';
  let cursor = 0;
  for (const region of regions) {
    const next = typeof updates === 'function' ? updates(region) : updates.get(region.id);
    if (typeof next !== 'string') continue;
    out += source.slice(cursor, region.startOffset) + region.startMarker + next + region.endMarker;
    cursor = region.endOffset;
  }
  return out + source.slice(cursor);
}

/** The element open tag at the head of a region body, for attribute reads. */
const OPEN_TAG_RE = /^<([a-zA-Z][\w-]*)((?:\s+[\w:.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*>/;
const ATTR_RE = /([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/**
 * Attributes of the first open tag in `text` (region bodies begin with
 * their element). Lowercased names; unquoted values allowed.
 *
 * @param {string} text region body (or any text starting with a tag)
 * @returns {Object<string,string>} attribute map
 */
export function parseOpenTagAttrs(text) {
  const m = OPEN_TAG_RE.exec(text);
  return m ? parseAttrString(m[2]) : {};
}

/** Parse an attribute-string (the tail of an open tag, `>` stripped). */
export function parseAttrString(s) {
  const attrs = {};
  ATTR_RE.lastIndex = 0;
  for (let a; (a = ATTR_RE.exec(s)); ) {
    attrs[a[1].toLowerCase()] = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : '';
  }
  return attrs;
}

/**
 * Refresh a snapshot body in place: update `last-refreshed` on the open
 * tag and swap the `<script type="application/json">` child for the fresh
 * JSON (inserting one before the closing tag when absent). Everything
 * else in the body — authored title/description children, whitespace
 * shape — is preserved verbatim.
 *
 * @param {string} body current region body (element markup)
 * @param {*} json fresh snapshot value (JSON.stringify'd, 2-space)
 * @param {string} nowIso refresh stamp
 * @returns {string} the refreshed body
 */
export function applySnapshot(body, json, nowIso) {
  let out = stampLastRefreshed(body, nowIso);
  const payload = `<script type="application/json">\n${JSON.stringify(json, null, 2)}\n    </script>`;
  const scriptRe = /<script\s+type="application\/json">[\s\S]*?<\/script>/;
  if (scriptRe.test(out)) {
    out = out.replace(scriptRe, () => payload);
  } else {
    const close = out.lastIndexOf('</');
    if (close === -1) return out;
    out = out.slice(0, close) + '  ' + payload + '\n' + out.slice(close);
  }
  return out;
}

/** Set or insert `last-refreshed="<iso>"` on the body's first open tag. */
function stampLastRefreshed(body, nowIso) {
  const open = OPEN_TAG_RE.exec(body);
  if (!open) return body;
  const head = body.slice(0, open[0].length);
  if (/\slast-refreshed\s*=/.test(head)) {
    return head.replace(/(\slast-refreshed\s*=\s*)"[^"]*"/, `$1"${nowIso}"`) + body.slice(open[0].length);
  }
  const injected = head.replace(/\s*>$/, ` last-refreshed="${nowIso}">`);
  return injected + body.slice(open[0].length);
}

/**
 * Wrap authored elements in cache-region markers (the --seed pass).
 *
 * For each `{tag, key}` seed the first authored `<tag>` whose `key` (or
 * `id`) attribute matches is wrapped: the start marker opens on the
 * element's own line (sharing its indent), the end marker lands directly
 * after the element's authored snapshot content — its closing tag — so
 * the region body IS the snapshot. Elements already inside a region are
 * left alone, which makes seeding idempotent.
 *
 * @param {string} source full document text
 * @param {Array<{tag: string, key: string}>} seeds
 * @param {Set<string>|null} [knownTags] vocabulary check on seed tags
 * @returns {{text: string, errors: Array<{seed: string, message: string}>}}
 */
export function seedCacheRegions(source, seeds, knownTags = null) {
  let text = source;
  const errors = [];
  let regions = parseCacheRegions(text).regions;
  for (const seed of seeds) {
    const id = `${seed.tag} ${seed.key}`;
    if (knownTags && !knownTags.has(seed.tag)) {
      errors.push({ seed: id, message: `unknown vocabulary tag "${seed.tag}"` });
      continue;
    }
    const el = findAuthoredElement(text, seed.tag, seed.key);
    if (!el) {
      errors.push({ seed: id, message: `no authored <${seed.tag}> with key/id "${seed.key}"` });
      continue;
    }
    if (regions.some((r) => el.openIndex >= r.startOffset && el.closeEnd <= r.endOffset)) {
      continue; // already marked — seed is a no-op
    }
    const lineStart = text.lastIndexOf('\n', el.openIndex) + 1;
    const indent = /^\s*/.exec(text.slice(lineStart, el.openIndex))[0];
    text =
      text.slice(0, lineStart) +
      `${indent}<!-- semtext:cache:start ${seed.tag} ${seed.key} -->\n` +
      text.slice(lineStart, el.closeEnd) +
      `\n${indent}<!-- semtext:cache:end -->` +
      text.slice(el.closeEnd);
    // Offsets shifted — re-parse so later seeds test against live regions.
    regions = parseCacheRegions(text).regions;
  }
  return { text, errors };
}

/**
 * Every authored element of one tag, in document order, with same-name
 * nesting honoured (depth-paired opens/closes; self-closing tags count
 * as complete elements). Used by the CLI's --seed pass to find wrap
 * candidates; `key`/`id` attribute values ride along for region keys.
 *
 * @returns {Array<{openIndex: number, closeEnd: number, attrs: Object}>}
 */
export function findAuthoredElements(source, tag) {
  const tagRe = new RegExp(`<(/?)${tag}((?:\\s[^>]*)?)(/?)>`, 'gi');
  const out = [];
  const openStack = [];
  for (let m; (m = tagRe.exec(source)); ) {
    const closing = m[1] === '/';
    // `[^>]*` in the attr group greedily eats a trailing `/`, so detect
    // self-closing from the whole match, not the group.
    const selfClose = !closing && /\/>$/.test(m[0]);
    if (!closing && !selfClose) {
      openStack.push({ openIndex: m.index, attrs: parseAttrString(m[2]) });
    } else if (closing) {
      const open = openStack.pop();
      if (open) out.push({ ...open, closeEnd: m.index + m[0].length });
    } else {
      out.push({ openIndex: m.index, closeEnd: m.index + m[0].length, attrs: parseAttrString(m[2]) });
    }
  }
  return out;
}

/**
 * Locate an authored element by tag plus key/id attribute, honouring
 * same-name nesting (depth counting, so a nested `<tag>` child cannot
 * swallow the closing offset).
 *
 * @returns {{openIndex: number, closeEnd: number}|null}
 */
export function findAuthoredElement(source, tag, key) {
  const openRe = new RegExp(`<${tag}(\\s[^>]*)?>`, 'gi');
  const want = `="${key}"`;
  for (let m; (m = openRe.exec(source)); ) {
    const attrs = ` ${m[1] || ''} `;
    if (!attrs.includes(` key${want}`) && !attrs.includes(` id${want}`)) continue;
    const openIndex = m.index;
    const tagRe = new RegExp(`</?${tag}(\\s[^>]*)?/?>`, 'gi');
    tagRe.lastIndex = openRe.lastIndex;
    let depth = 1;
    for (let t; (t = tagRe.exec(source)); ) {
      if (/\/>$/.test(t[0])) continue; // self-closing: depth-neutral
      depth += t[0].startsWith('</') ? -1 : 1;
      if (depth === 0) return { openIndex, closeEnd: t.index + t[0].length };
    }
    return { openIndex, closeEnd: source.length }; // unclosed element: region runs to EOF
  }
  return null;
}
