/**
 * semtext-validate — schema-driven validation of SemText documents.
 *
 * Normative contracts: spec/conventions.md (v0.5) + spec/schema/*.md.
 * Machine-readable contract: spec/schema/semtext.schema.json — every rule
 * below READS that file; nothing here hardcodes a parallel rule set. When
 * the prose contracts change, update the JSON schema and the validator
 * follows.
 *
 * Checks (severity from the schema's x-semtext block):
 *   - exactly one document root (`sem-enhanced-document` tag or class alias)
 *   - documented vocabulary elements only, all four families (`sem-`,
 *     `npl-`, `semext-`, `agent-kit-` — unknown element = error)
 *   - per-element attribute contracts: required / recommended attributes,
 *     enumerated token values, numeric ranges, flag lists
 *   - dual spelling (`x` + `data-x` on one element) = authoring error
 *     (conventions.md §2)
 *   - unknown attributes = warning; runtime tier markers and generated
 *     chrome in authored source = warning
 *   - orphan record parts (e.g. `<statement>` outside `sem-fact`) = warning
 *
 * Line numbers come from a source-side open-tag scan aligned against the
 * parsed tree by (tag name, attribute-name signature); they are exact for
 * attributed elements and best-effort for bare repeated standard tags.
 *
 * No runtime dependencies beyond happy-dom (the same parser the unit tests
 * use). Kept in plain ESM JavaScript so the bin can run it without a build
 * step — scripts/build.mjs is out of scope for this tool.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** happy-dom is an optional peer (install with the validator if you use
 *  it outside this repo); imported eagerly with an actionable error so a
 *  missing install fails with instructions, not a module-not-found stack. */
const { Window } = await (async () => {
  try {
    return await import('happy-dom');
  } catch {
    throw new Error('semtext-validate needs the "happy-dom" package — install it (npm i -D happy-dom)');
  }
})();

/* ------------------------------------------------------------------ *
 * Schema loading
 * ------------------------------------------------------------------ */

/**
 * Load and lightly validate the machine-readable contract. `$defs` whose
 * `extends` names a preset in `x-semtext.defPresets` get the preset's
 * attributes/children/childRules merged UNDER their own (local keys win;
 * arrays concatenate preset-first), so a contract's `$def` can be a few
 * lines. The input schema object is never mutated.
 *
 * @param {string} schemaPath path to semtext.schema.json
 */
export function loadSchema(schemaPath) {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  if (!schema['x-semtext'] || !schema.$defs) {
    throw new Error(`${schemaPath}: not a SemText schema (missing x-semtext / $defs)`);
  }
  const presets = schema['x-semtext'].defPresets || {};
  const missing = (name, from) =>
    new Error(`${schemaPath}: $def "${from}" extends unknown defPresets entry "${name}"`);
  for (const [name, def] of Object.entries(schema.$defs)) {
    if (!def.extends) continue;
    const names = Array.isArray(def.extends) ? def.extends : [def.extends];
    for (const presetName of names) {
      const preset = presets[presetName];
      if (!preset) throw missing(presetName, name);
      def.attributes = { ...(preset.attributes || {}), ...(def.attributes || {}) };
      if (preset.children || def.children) def.children = [...(preset.children || []), ...(def.children || [])];
      if (preset.childRules || def.childRules) def.childRules = [...(preset.childRules || []), ...(def.childRules || [])];
      if (def.record === undefined && preset.record !== undefined) def.record = preset.record;
    }
  }
  return schema;
}

/** Resolve the schema path that ships beside this module (platform-safe). */
export function defaultSchemaPath() {
  return fileURLToPath(new URL('../../spec/schema/semtext.schema.json', import.meta.url));
}

/* ------------------------------------------------------------------ *
 * Source-side open-tag scan (for file:line attribution)
 * ------------------------------------------------------------------ */

/**
 * Scrub comments and raw-text regions out of the source WITHOUT changing
 * offsets, then return every open tag in order: {name, attrs, offset}.
 * Attribute names are lowercased; values are not needed (signature is
 * names only).
 */
export function scanOpenTags(source) {
  let scrubbed = source;
  const blank = (re) => {
    scrubbed = scrubbed.replace(re, (m) => m.replace(/[^\n]/g, ' '));
  };
  // Comments, then script/style raw-text bodies (keep newlines for offsets).
  blank(/<!--[\s\S]*?-->/g);
  blank(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi);

  const tags = [];
  const re = /<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let m;
  while ((m = re.exec(scrubbed)) !== null) {
    const attrs = [];
    const are = /([^\s=/]+)\s*=/g;
    let am;
    while ((am = are.exec(m[2])) !== null) attrs.push(am[1].toLowerCase());
    tags.push({ name: m[1].toLowerCase(), attrs, offset: m.index });
  }
  return tags;
}

function lineOf(source, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * Align parsed elements (document order) with scanned open tags.
 * Returns a Map from element to line number. Elements the parser implied
 * (html/head/body/tbody) and any drift leftovers get the last aligned line.
 */
function alignLines(doc, source) {
  const lines = new Map();
  const byTag = new Map();
  for (const t of scanOpenTags(source)) {
    if (!byTag.has(t.name)) byTag.set(t.name, []);
    byTag.get(t.name).push(t);
  }
  const cursor = new Map(); // per-tag index into byTag
  let lastLine = 1;
  const els = doc.querySelectorAll('*');
  for (const el of els) {
    const name = el.tagName.toLowerCase();
    const list = byTag.get(name) || [];
    const i = cursor.get(name) || 0;
    let matched = -1;
    // Signature = sorted attribute names; search a small window forward to
    // resync past false matches in text content (e.g. `Pair<T>` in a code
    // listing).
    const sig = attrNames(el);
    for (let k = i; k < Math.min(list.length, i + 4); k++) {
      if (JSON.stringify(list[k].attrs) === JSON.stringify(sig)) { matched = k; break; }
    }
    if (matched === -1 && i < list.length) matched = i; // best effort
    if (matched >= 0 && matched < list.length) {
      lastLine = lineOf(source, list[matched].offset);
      cursor.set(name, matched + 1);
    }
    lines.set(el, lastLine);
  }
  return lines;
}

function attrNames(el) {
  const names = [];
  for (const a of el.attributes) names.push(a.name);
  names.sort();
  return names;
}

/* ------------------------------------------------------------------ *
 * Element identity (tag form + v0.4 class-form alias, Appendix A)
 * ------------------------------------------------------------------ */

/** Every vocabulary namespace prefix the spec knows. Order matters only
 *  for the class-alias walk below (longest-first would also do); the
 *  hyphen-anchored `startsWith(prefix + '-')` checks cannot cross-match
 *  (`semext-note` does not start with `sem-` followed by a token boundary
 *  — the hyphen IS the boundary). */
export const FAMILY_PREFIXES = ['sem', 'npl', 'semext', 'agent-kit'];

/** True when `name` is any family's `<prefix>-<token>` name. */
function isFamilyName(name) {
  return FAMILY_PREFIXES.some((p) => name.startsWith(p + '-'));
}

function defNameFor(el, defs) {
  const tag = el.tagName.toLowerCase();
  if (defs[tag]) return tag;
  // Tag aliases (e.g. <agent> for sem-agent).
  for (const [defName, def] of Object.entries(defs)) {
    if (def.tagAliases && def.tagAliases.includes(tag)) return defName;
  }
  // Class-form alias: div/span with class `<prefix>-<token>` (Appendix A,
  // every family). The token maps to a def name either directly
  // (`sem-agent`) or with the family prefix re-attached (`sem-fact` ->
  // def `sem-fact`); tag aliases count too. Hyphenated prefixes
  // (`agent-kit-issue` -> token `issue`) slice on the full prefix, so the
  // derived identifiers never break mid-prefix.
  for (const cls of el.classList) {
    for (const prefix of FAMILY_PREFIXES) {
      if (!cls.startsWith(prefix + '-')) continue;
      const token = cls.slice(prefix.length + 1);
      if (defs[token]) return token;
      const familyTag = prefix + '-' + token;
      if (defs[familyTag]) return familyTag;
      for (const [defName, def] of Object.entries(defs)) {
        if (def.tagAliases && (def.tagAliases.includes(token) || def.tagAliases.includes(familyTag))) return defName;
      }
      break; // first matching prefix owns this class token
    }
  }
  return null;
}

function matchesIdentity(el, name) {
  if (el.tagName.toLowerCase() === name) return true;
  for (const cls of el.classList) {
    if (cls === name) return true;
    // A bare part name (child-rule selectors: `statement`, `conclusion`)
    // matches its family-prefixed class alias (`sem-statement`); an
    // already-prefixed name matches only itself, so double prefixes
    // (`sem-sem-fact`) never sneak through.
    if (!isFamilyName(name)) {
      for (const prefix of FAMILY_PREFIXES) {
        if (cls === prefix + '-' + name) return true;
      }
    }
  }
  return false;
}

function childMatches(parent, name) {
  for (const child of parent.children) {
    if (matchesIdentity(child, name)) return true;
  }
  return false;
}

function countChildMatches(parent, name) {
  let n = 0;
  for (const child of parent.children) if (matchesIdentity(child, name)) n++;
  return n;
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

function valueCheck(contract, value, attr) {
  const problems = [];
  if (!contract) return problems;
  const t = contract.type;
  if (t === 'flag') {
    if (value !== '') problems.push(`boolean attribute "${attr}" carries a value ("${value}"); author it bare`);
  } else if (t === 'number') {
    const n = Number(value);
    if (value.trim() === '' || Number.isNaN(n)) {
      problems.push(`attribute "${attr}" must be a number, got "${value}"`);
    } else {
      if (contract.min !== undefined && n < contract.min) problems.push(`attribute "${attr}" is ${n}; minimum is ${contract.min}`);
      if (contract.max !== undefined && n > contract.max) problems.push(`attribute "${attr}" is ${n}; maximum is ${contract.max}`);
    }
  } else if (t === 'flaglist') {
    // Comma flag list: each flag checked against the documented set.
    if (contract.values) {
      for (const flag of value.split(',').map((f) => f.trim()).filter(Boolean)) {
        if (!contract.values.includes(flag)) {
          problems.push(`attribute "${attr}" has unknown flag "${flag}" (documented: ${contract.values.join(', ')})`);
        }
      }
    }
  } else if (contract.values && !contract.values.includes(value.trim())) {
    problems.push(`attribute "${attr}" has unknown token value "${value}" (documented: ${contract.values.join(', ')})`);
  }
  return problems;
}

/**
 * Validate one SemText document.
 * @returns {{ diagnostics: Array<{severity:string,line:number,rule:string,message:string}> }}
 */
export function validateSource(source, schema, { filename = '<input>' } = {}) {
  const x = schema['x-semtext'];
  const defs = schema.$defs;
  const diagnostics = [];
  const push = (severity, rule, message, line) =>
    diagnostics.push({ severity, rule, message, line: line || 1, file: filename });

  const window = new Window({ settings: { disableCSSFileLoading: true } });
  const doc = new window.DOMParser().parseFromString(source, 'text/html');
  const lines = alignLines(doc, source);

  // -- document root ------------------------------------------------
  const rootCfg = x.document.root;
  const usesVocabulary = [...doc.querySelectorAll('*')].some(
    (el) => defNameFor(el, defs) !== null || isFamilyName(el.tagName.toLowerCase())
  );
  const roots = [];
  for (const el of doc.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();
    const isTagRoot = tag === rootCfg.tag;
    const isClassRoot = rootCfg.classAliases.some((alias) => {
      const [t, cls] = alias.split('.');
      return tag === t && el.classList.contains(cls);
    });
    if (isTagRoot || isClassRoot) roots.push(el);
  }
  if (roots.length === 0 && (!rootCfg.requiredWhenVocabularyPresent || usesVocabulary)) {
    push('error', 'missing-root', `no <${rootCfg.tag}> (or class alias) found — SemText requires exactly one document root`);
  }
  if (roots.length > 1) {
    for (const el of roots.slice(1)) {
      push('error', 'multiple-roots', `extra document root <${el.tagName.toLowerCase()}>; a document has exactly one`, lines.get(el));
    }
  }

  // -- tier markers + generated chrome in authored source ------------
  for (const marker of x.document.tierMarkers.attributes) {
    for (const el of doc.querySelectorAll(`[${marker}]`)) {
      push(x.document.tierMarkers.severity, 'tier-marker', `${marker} is written by the runtime tiers, not authored — found in source`, lines.get(el));
    }
  }
  for (const chrome of x.document.generatedChrome.elements) {
    for (const el of doc.getElementsByTagName(chrome)) {
      push(x.document.generatedChrome.severity, 'generated-chrome', `<${chrome}> is generated by the tiers at runtime; it must not appear in authored source`, lines.get(el));
    }
  }

  // -- per-element checks --------------------------------------------
  const seenReaders = new Set();
  for (const el of doc.querySelectorAll('*')) {
    const line = lines.get(el) || 1;
    const tag = el.tagName.toLowerCase();
    const chromeIdx = x.document.generatedChrome.elements.indexOf(tag);
    if (chromeIdx !== -1) continue; // already reported
    if (tag === rootCfg.tag) continue;

    // document-level child rules (sem-reader at most once per document)
    if (matchesIdentity(el, 'sem-reader')) {
      if (seenReaders.has('sem-reader')) {
        push('warning', 'multiple-readers', 'more than one sem-reader in the document (one per document; conventions.md §5)', line);
      }
      seenReaders.add('sem-reader');
    }

    const defName = defNameFor(el, defs);
    if (!defName) {
      if (isFamilyName(tag)) {
        push(x.unknownElementSeverity, 'unknown-element', `unknown SemText element <${tag}> — not in spec/schema (see spec/conventions.md)`, line);
      }
      continue; // ordinary semantic HTML is always valid content
    }
    const def = defs[defName];

    // Attribute contracts. Known set = global catalog + element def +
    // standard HTML/ARIA. data-* is the alias spelling of every parameter.
    const known = new Set([...Object.keys(x.globalAttributes), ...Object.keys(def.attributes || {}), ...x.standardAttributes]);
    const hasBare = (n) => el.hasAttribute(n);
    for (const a of Array.from(el.attributes)) {
      const aname = a.name.toLowerCase();
      const value = a.value;
      if (aname.startsWith('data-')) {
        const base = aname.slice(5);
        const contract = (def.attributes || {})[base] || x.globalAttributes[base];
        if (contract !== undefined && hasBare(base)) {
          push(x.spelling.dualSpellingSeverity, 'dual-spelling', `both "${base}" and "${aname}" present — writing both spellings is an authoring error (conventions.md §2; data- wins)`, line);
        }
        for (const p of valueCheck(contract, value, base)) {
          push((contract && contract.severityOnUnknown) || 'error', 'attribute-value', p, line);
        }
        continue;
      }
      if (known.has(aname)) {
        const contract = (def.attributes || {})[aname] || x.globalAttributes[aname];
        const severity = (contract && contract.severityOnUnknown) || 'error';
        for (const p of valueCheck(contract, value, aname)) push(severity, 'attribute-value', p, line);
        if (contract && contract.forbidden) {
          push(contract.severity || 'error', 'forbidden-attribute', `attribute "${aname}" is not valid on this element${contract.note ? ' — ' + contract.note : ''}`, line);
        }
        continue;
      }
      push(x.unknownAttributeSeverity, 'unknown-attribute', `unknown attribute "${aname}" on <${defName === tag ? tag : tag + ' [sem-' + defName + ']'}>`, line);
    }

    // required / recommended
    for (const [attr, contract] of Object.entries(def.attributes || {})) {
      if (contract.forbidden) continue;
      const present = el.hasAttribute(attr) || el.hasAttribute('data-' + attr);
      if (!present && contract.required) {
        push('error', 'missing-attribute', `missing required attribute "${attr}" on ${describe(el, defName)}`, line);
      } else if (!present && contract.recommended) {
        push('warning', 'missing-attribute', `missing recommended attribute "${attr}" on ${describe(el, defName)}`, line);
      }
    }

    // child rules (direct children only; both spellings match)
    for (const cr of def.childRules || []) {
      const n = countChildMatches(el, cr.selector);
      if (cr.rule === 'exactlyOne' && n !== 1) {
        push(cr.severity || 'error', 'child-structure', `${describe(el, defName)} must have exactly one <${cr.selector}> child, found ${n}`, line);
      } else if (cr.rule === 'atMostOne' && n > 1) {
        push(cr.severity || 'warning', 'child-structure', `${describe(el, defName)} allows at most one <${cr.selector}> child, found ${n}`, line);
      }
    }

    // declared children must be their declared parts (orphan detection)
    if (def.partOf) {
      const parent = el.parentElement;
      const parentDef = parent ? defNameFor(parent, defs) : null;
      if (!parentDef || !def.partOf.includes(parentDef)) {
        push('warning', 'orphan-part', `<${tag}> is a record part of ${def.partOf.join('/')} but its parent is ${parent ? '<' + parent.tagName.toLowerCase() + '>' : 'the document root'}`, line);
      }
    }
  }

  // document-level child rules from the schema (root scope)
  for (const cr of x.document.childRules || []) {
    const n = roots.length === 1 ? countChildMatches(roots[0], cr.selector) : 0;
    if (cr.rule === 'atMostOne' && n > 1) {
      push(cr.severity || 'warning', 'child-structure', `document allows at most one <${cr.selector}> under the root, found ${n}`);
    }
  }

  return { diagnostics: diagnostics.sort((a, b) => a.line - b.line) };
}

function describe(el, defName) {
  const tag = el.tagName.toLowerCase();
  if (tag === defName) return `<${tag}>`;
  // Class form: show the class actually present (sem-fact), not the
  // double-prefixed spelling — the def name plus any family prefix.
  for (const cls of el.classList) {
    if (cls === defName) return `<${tag} class="${cls}">`;
    if (!isFamilyName(defName)) {
      for (const prefix of FAMILY_PREFIXES) {
        if (cls === prefix + '-' + defName) return `<${tag} class="${cls}">`;
      }
    }
  }
  return `<${tag}>`;
}

/* ------------------------------------------------------------------ *
 * File-level API
 * ------------------------------------------------------------------ */

/**
 * Validate one file's contents.
 * @returns {{ file: string, diagnostics: Array, readError?: string }}
 */
export function validateFile(path, schema) {
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch (err) {
    return { file: path, diagnostics: [], readError: err.message };
  }
  const { diagnostics } = validateSource(source, schema, { filename: path });
  return { file: path, diagnostics };
}
