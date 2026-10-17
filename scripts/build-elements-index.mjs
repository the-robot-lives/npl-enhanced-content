#!/usr/bin/env node
/**
 * scripts/build-elements-index.mjs — generate elements.json from the spec schemas.
 *
 *   node scripts/build-elements-index.mjs
 *   npm run build:elements-index
 *
 * Parses every normative schema file (spec/schema/sem-*.md and the
 * spec/schema/{npl,semext,agent-kit}/*.md contract dirs — TEMPLATE.md
 * excluded) into one JSON record per tag:
 * name, family (sem|npl|semext|agent-kit), summary, description,
 * attributes, children and the authoring-form example. Only what the
 * schema files state is recorded: a field a file does not state stays
 * empty, and the tag is listed in `gaps` with the missing field names.
 *
 * Files whose H1 names several tags (`sem-facts` / `sem-fact`) share one
 * contract: every tag of the file carries the file's summary, description
 * and example; the attribute bullets belong to the file's primary
 * (container) tag and the child declarations to its first companion
 * (`sem-fact`), so a companion points at `optionsIn: "<primary>"` instead
 * of mis-listing the container's options as its own.
 *
 * Output: elements.json at the repo root. Generated — never hand-edit; fix
 * the schema file and re-run.
 */

import { realpathSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_DIR = join(root, 'spec', 'schema');
/** Contract subdirectories → family. TEMPLATE.md (scaffolding, not a
 *  contract) is excluded per dir. */
const CONTRACT_DIRS = [
  { dir: 'npl', family: 'npl' },
  { dir: 'semext', family: 'semext' },
  { dir: 'agent-kit', family: 'agent-kit' },
];
const OUT = join(root, 'elements.json');

const GLOBAL_ATTR_NAMES = ['id', 'kind', 'tags'];
const TAG_SHAPE = /^[a-z][a-z0-9-]*$/;
const TYPE_WORD = /^(string|boolean|integer|number)$/i;

/** A backticked token is a stated VALUE only if it is not the attribute's
 *  type word and not a `data-*` alias mirror (the alias spelling, not a
 *  value: `data-kind` names the mirror, `kind` the value it carries). */
const isValueToken = (t) => !/^data-/i.test(t) && !TYPE_WORD.test(t);

// ---------- helpers ----------

/** First backticked token of a string, or ''. */
function firstTick(s) {
  const m = s.match(/`([^`]+)`/);
  return m ? m[1] : '';
}

/** All backticked tokens matching a strict tag shape (lowercase, dash/word). */
function tagTokens(s) {
  return (s.match(/`([^`]+)`/g) || [])
    .map((t) => t.slice(1, -1))
    .filter((t) => TAG_SHAPE.test(t));
}

/**
 * Strict tokens from a children-declaring paragraph: drops `data-*` twins
 * and source-block mentions (`` `vos` blocks ``, `` `x` child tags ``) that
 * name where a part comes from rather than a part itself.
 */
function childTokens(s) {
  const out = [];
  const re = /`([a-z][a-z0-9-]*)`(?!\s*(?:blocks?|child tags))/g;
  let m;
  while ((m = re.exec(s))) {
    const t = m[1];
    if (!t.startsWith('data-')) out.push(t);
  }
  return out;
}

/** `<tag …>` angle tokens inside backtick spans of a string. */
function angleTokens(s) {
  return (s.match(/`<([a-z][a-z0-9-]*)[^`]*`/g) || []).map((t) => t.replace(/[`<>]/g, '').split(/[\s=]/)[0]);
}

/** First sentence of a prose block (up to the first '. ' or end). */
function firstSentence(s) {
  const flat = s.replace(/\s+/g, ' ').trim();
  const m = flat.match(/^(.{0,200}?\.)\s/);
  return m ? m[1] : flat.slice(0, 200);
}

// ---------- file parsing ----------

function parseSchemaFile(file) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');

  // H1 → tag names: split on '/', take the first strict-shaped backticked
  // token of each segment (`sem-audiences` / `sem-profile` and the `audience`
  // qualifier → sem-audiences, sem-profile).
  const h1 = lines.find((l) => l.startsWith('# ')) || '';
  const tags = h1
    .replace(/^#\s*Schema\s*—\s*/, '')
    .split('/')
    .map((seg) => firstTick(seg))
    .filter((t) => TAG_SHAPE.test(t));

  // Sections: `## Name` → body lines.
  const sections = {};
  let current = '_intro';
  for (const line of lines.slice(lines.indexOf(h1) + 1)) {
    if (line.startsWith('# ')) break;
    if (line.startsWith('## ')) {
      current = line.replace(/^##\s*/, '').trim();
      sections[current] = [];
    } else {
      (sections[current] = sections[current] || []).push(line);
    }
  }
  const sectionKey = (name) => Object.keys(sections).find((k) => k.toLowerCase() === name.toLowerCase());
  const sectionBody = (name) => {
    const k = sectionKey(name);
    return k ? sections[k].join('\n') : '';
  };

  // Description: intro prose minus the file boilerplate (contract/BDD
  // sentences, which wrap across lines) and the TEMPLATE instructions
  // blockquote. Other blockquotes carry real content (npl-mode) — keep them.
  const description = sections._intro
    .join('\n')
    .split('\n')
    .filter((l) => !/^>\s*TEMPLATE/.test(l))
    .map((l) => l.replace(/^>\s?/, ''))
    .join(' ')
    .split(/(?<=\.)\s+/)
    .filter((s) => !/^(Contract per conventions|BDD source|Changes here precede)/.test(s.trim()))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const authoring = sectionBody('Authoring form');

  // Example: first ```html fenced block in the Authoring form.
  const ex = authoring.match(/```html\n([\s\S]*?)```/);
  const example = ex ? ex[1].trimEnd() : '';

  // Paragraphs of a section: prose blocks (used for children declared in
  // prose — "Children: `title` and `content` …").
  const paragraphsOf = (body) =>
    body
      .split('\n\n')
      .map((p) => p.split('\n').join(' ').trim())
      .filter((p) => p && !p.startsWith('- ') && !p.startsWith('```'));

  const attributes = [];
  const children = [];
  const childSeen = new Set();
  const attrNames = new Set();

  const addChild = (name, note) => {
    if (!name || !TAG_SHAPE.test(name) || childSeen.has(name)) return false;
    if (GLOBAL_ATTR_NAMES.includes(name) || attrNames.has(name)) return false;
    childSeen.add(name);
    children.push({ name, note: (note || '').trim() });
    return true;
  };

  const appendChildNote = (note) => {
    if (children.length) {
      const c = children[children.length - 1];
      c.note = (c.note ? c.note + ' ' : '') + note.trim();
    }
  };

  const parseAttr = (b, tagNames) => {
    const nm = b.match(/^`([a-z][a-z0-9-]*)(?:="([^`]*)")?`/);
    if (!nm) return false;
    const name = nm[1];
    if (attrNames.has(name)) return true; // duplicate statement — first wins
    // A bullet naming one of the file's own tags describes that element's
    // slot (e.g. `- `sem-detail`: one prose passage …`) — the tag has its
    // own record; never an attribute, never a child of itself.
    if (tags.includes(name)) return true;
    let rest = b.slice(nm[0].length).replace(/^\s*[:—-]\s*/, '');

    const attr = {
      name,
      required: null,
      type: '',
      allowedValues: [],
      default: null,
      description: rest.trim()
    };
    if (nm[2] !== undefined) attr.allowedValues = [nm[2]];

    const tm = rest.match(/(?:^|[\s(,])`?(string|boolean|integer|number)`?\b/i);
    if (tm) attr.type = tm[1].toLowerCase();
    if (/\brequired\b/i.test(rest)) attr.required = true;
    else if (/\boptional\b/i.test(rest)) attr.required = false;

    const dm = rest.match(/default `([^`]*)`/);
    const dmNone = rest.match(/default none/i);
    if (dm) attr.default = dm[1];
    else if (dmNone) attr.default = '';
    const dm2 = attr.default === null ? rest.match(/`([^`]+)`\s*\(default\)/) : null;
    if (dm2) attr.default = dm2[1];

    if (attr.allowedValues.length) {
      // `view-as="margin"` — the single stated mode.
    } else if (/\(default\)\s*\|/.test(rest) || /^\s*`[^`]+`\s*\(/.test(rest)) {
      attr.allowedValues = [...new Set((rest.match(/`([^`]+)`/g) || []).map((t) => t.slice(1, -1)).filter((t) => t !== 'default' && isValueToken(t)))];
    } else if (/\bone of\b/i.test(rest)) {
      attr.allowedValues = [...new Set(tagTokens(rest).filter(isValueToken))];
    }

    // The description keeps the bullet's prose; drop the fragments already
    // captured as type/default. The type word may be backticked
    // (`\`string\` — required`); a default clause may be followed by a
    // separator (`; `, `. `, `, `) or an em-dash lead-in.
    attr.description = rest
      .replace(/^\s*`?(string|boolean|integer|number)`?\s*[—-]\s*/i, '')
      .replace(/\bdefault `[^`]*`[.:;,]?\s*(?:[—-]\s*)?/gi, '')
      .replace(/\bdefault none[.:;,]?\s*(?:[—-]\s*)?/gi, '')
      .replace(/^[;,.:\s]+/, '')
      .trim();

    attributes.push(attr);
    attrNames.add(name);
    return true;
  };

  // Attributes an intro scopes to children ("typed children are `npl-thought`
  // tags carrying a `type` attribute") — never parent attributes.
  const childScopedAttrs = [];
  for (const p of paragraphsOf(sections._intro.join('\n'))) {
    const m = p.match(/\bchild(?:ren)?\b[^.]*?carrying a `([a-z][a-z0-9-]*)` attribute/i);
    if (m) childScopedAttrs.push(m[1]);
  }

  // Ordered walk of the Authoring form: bullets and prose paragraphs
  // (wrapped lines merged).
  const items = [];
  for (const line of authoring.split('\n')) {
    if (/^- /.test(line)) items.push({ kind: 'bullet', text: line.replace(/^- /, '') });
    else if (items.length && /^\s{2,}\S/.test(line) && line.trim() && items[items.length - 1].kind === 'bullet')
      items[items.length - 1].text += ' ' + line.trim();
    else if (line.trim() && !line.startsWith('```') && !line.startsWith('#')) {
      const last = items[items.length - 1];
      if (last && last.kind === 'para') last.text += ' ' + line.trim();
      else items.push({ kind: 'para', text: line.trim() });
    }
  }

  let inChildRegion = false; // a "Children …:" paragraph — bullets serve the children
  const regionNotes = []; // region bullets seen before the children are mined
  for (const item of items) {
    if (item.kind === 'para') {
      inChildRegion =
        /:\s*$/.test(item.text) &&
        (/\bchild(?:ren)?\b/i.test(item.text) || /\beach (carrying|with)\b/i.test(item.text));
      continue;
    }
    const b = item.text;

    // Global catalog line: `- `id`, `kind`, `tags` per the global (attribute)
    // catalog` — or the short form `- `id`, `kind`, `tags` global.`
    const gm = b.match(/^((?:`[a-z][a-z0-9-]*`[,\s]*)+)(?:per (?:the )?global (?:attribute )?catalog|global\s*[.;])/i);
    if (gm) {
      for (const n of tagTokens(gm[1])) {
        attributes.push({
          name: n,
          required: null,
          type: '',
          allowedValues: [],
          default: null,
          description: 'per the global attribute catalog (conventions.md §2)'
        });
        attrNames.add(n);
      }
      inChildRegion = false;
      continue;
    }

    // Angle-tag child bullet: `- `<statement>` + `<conclusion>`: required per fact.`
    if (/^`</.test(b)) {
      for (const t of angleTokens(b)) addChild(t, b);
      continue;
    }
    // Class-part child bullet: `- `.npl-mood-tone` — how the affect colors delivery.`
    const cm = b.match(/^`\.([a-z][a-z0-9-]*)`\s*[—-]/);
    if (cm) {
      addChild(cm[1], b.replace(cm[0], ''));
      continue;
    }
    // Bare-name child bullet: `- `subject` — the thing under critique …`
    const bm = b.match(/^`([a-z][a-z0-9-]*)`\s+—/);
    if (bm && addChild(bm[1], b.replace(bm[0], ''))) continue;
    // "Child:" / "Children:" bullet naming backticked angle tags:
    // `- Child: **exactly one `<pre>`** …`
    if (/\bchild(?:ren)?\b/i.test(b)) {
      const toks = angleTokens(b);
      if (toks.length) {
        for (const t of toks) addChild(t, b);
        continue;
      }
    }
    if (inChildRegion) {
      if (children.length) appendChildNote(b);
      else regionNotes.push(b);
      continue;
    }
    parseAttr(b, tags);
  }

  // Children declared in prose of the intro and the Authoring form. Run
  // after the bullets so attribute names are known. An explicit enumeration
  // ("Parts mirror the NPL `vos` child tags: `id`, `ego` …") may name parts
  // that collide with global attribute names — those are forced through.
  // When the paragraph OPENS with the declaration sentence, mine that
  // sentence only: follow-on sentences describe rendered chrome (CSS
  // classes, warning channels) that must not become children.
  for (const p of [...paragraphsOf(sections._intro.join('\n')), ...paragraphsOf(authoring)]) {
    if (!/\bchild(?:ren)?\b/i.test(p)) continue;
    if (/^Class-form alias/i.test(p)) continue;
    const first = p.search(/(?<=\.)\s/);
    const open = first >= 0 ? p.slice(0, first + 1) : p;
    const declareFirst = /\bchild(?:ren)?\b|\bparts? mirror\b/i.test(open);
    const mine = declareFirst ? open : p;
    const force = /child tags|parts? mirror/i.test(mine);
    for (const t of childTokens(mine)) {
      if (force) {
        if (!t || childSeen.has(t)) continue;
        childSeen.add(t);
        children.push({ name: t, note: '' });
      } else {
        addChild(t, '');
      }
    }
  }

  // Flush child-region bullets that arrived before the children were mined,
  // then demote attributes an intro scoped to children.
  while (regionNotes.length) appendChildNote(regionNotes.shift());
  for (const name of childScopedAttrs) {
    const i = attributes.findIndex((a) => a.name === name);
    if (i >= 0) {
      const [attr] = attributes.splice(i, 1);
      appendChildNote(`${attr.name}: ${attr.description}`);
    }
  }

  return { tags, description, example, attributes, children, paramFree: /no (component-specific|own) parameters/i.test(authoring), scope: sectionBody('Scope semantics') };
}

// ---------- main ----------

export { parseSchemaFile };

/** Every contract file → {path (repo-relative), family}: top-level
 *  spec/schema/*.md are the `sem` family; each contract dir of
 *  CONTRACT_DIRS contributes its *.md minus TEMPLATE.md. Exported for
 *  the unit tier — main() consumes it verbatim. */
export function collectContractFiles(schemaDir = SCHEMA_DIR) {
  const files = [];
  for (const f of readdirSync(schemaDir).filter((f) => f.endsWith('.md')).sort()) {
    files.push({ path: join('spec/schema', f), family: 'sem' });
  }
  for (const { dir, family } of CONTRACT_DIRS) {
    const abs = join(schemaDir, dir);
    if (!existsSync(abs)) continue; // a namespace may predate its contracts
    for (const f of readdirSync(abs).filter((f) => f.endsWith('.md') && f !== 'TEMPLATE.md').sort()) {
      files.push({ path: join(`spec/schema/${dir}`, f), family });
    }
  }
  return files;
}

async function main() {

const files = collectContractFiles();

const specVersion = (() => {
  const schemaJson = join(SCHEMA_DIR, 'semtext.schema.json');
  if (!existsSync(schemaJson)) return '';
  try {
    return JSON.parse(readFileSync(schemaJson, 'utf8'))?.['x-semtext']?.specVersion || '';
  } catch {
    return '';
  }
})();

const tags = [];
const gaps = [];

for (const { path, family } of files) {
  const parsed = parseSchemaFile(join(root, path));
  const { tags: names } = parsed;
  if (!names.length) {
    gaps.push({ tag: `(file ${path})`, missing: ['tag-name'] });
    continue;
  }
  // A file whose intro is pure boilerplate may still state its contract in
  // a `## Scope semantics` section — same schema file, honest fallback.
  const description =
    parsed.description ||
    (parsed.scope || '')
      .split('\n\n')
      .map((p) => p.split('\n').join(' ').trim())
      .find((p) => p && !p.startsWith('- ') && !p.startsWith('```')) ||
    '';
  const summary = firstSentence(description);
  // Multi-tag files: attribute bullets belong to the primary (container)
  // tag; child declarations to its first companion (`sem-fact`).
  const attrsTarget = names[0];
  const childrenTarget = names[1] || names[0];

  names.forEach((name, i) => {
    const rec = {
      name,
      family,
      source: path,
      summary,
      description,
      attributes: name === attrsTarget ? parsed.attributes : [],
      children: name === childrenTarget ? parsed.children : [],
      example: parsed.example
    };
    if (name !== attrsTarget) rec.optionsIn = attrsTarget;
    const missing = [];
    if (!rec.summary) missing.push('summary');
    if (!rec.description) missing.push('description');
    if (!parsed.attributes.length && !parsed.paramFree) missing.push('attributes');
    if (!rec.example) missing.push('example');
    if (missing.length) gaps.push({ tag: name, missing });
    tags.push(rec);
  });
}

tags.sort((a, b) => (a.family === b.family ? a.name.localeCompare(b.name) : a.family.localeCompare(b.family)));

const out = {
  $comment:
    'Generated by scripts/build-elements-index.mjs from spec/schema/*.md and spec/schema/{npl,semext,agent-kit}/*.md — do not edit by hand; fix the schema and re-run.',
  specVersion,
  generatedFrom: files.map((f) => f.path),
  tagCount: tags.length,
  tags,
  gaps
};

writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`elements.json: ${tags.length} tags from ${files.length} schema files, ${gaps.length} gap entries`);
}

// Run only when invoked as the entry script — importing the module
// (tests) parses schemas on demand without writing anything. Both sides
// are realpathed: on macOS /tmp is a symlink to /private/tmp.
const entryArg = process.argv[1] ? resolve(process.argv[1]) : '';
const entry = entryArg && pathToFileURL(realpathSync(entryArg)).href;
if (entry && entry === pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href) main();
