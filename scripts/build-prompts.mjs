#!/usr/bin/env node
/**
 * build-prompts — generate the agent-facing SemText prompt pages from
 * elements.json (which scripts/build-elements-index.mjs generates from the
 * spec schemas — fix the schema, re-run that, then re-run this).
 *
 * Output (dist/prompts/):
 *   semtext-prompt.sem.html          core prompt — the conventions, plus one
 *                                    link per per-tag prompt page, nothing else
 *   semtext-prompt.<tag>.sem.html    one short page per element: purpose,
 *                                    options (required/default/values),
 *                                    children, one example
 *
 * Deterministic: same elements.json in, byte-identical files out — no
 * timestamps, elements.json order everywhere. The prompt pages are plain,
 * script-free SemText documents: valid HTML5, one <sem-enhanced-document>
 * root, ordinary HTML for the rest, so they read correctly with no bundle
 * and no stylesheets.
 *
 * Usage: node scripts/build-prompts.mjs  (or npm run build:prompts)
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const elementsPath = join(root, 'elements.json');
const outDir = join(root, 'dist', 'prompts');

/** CDN surface the prompts advertise. The core prompt sits at the root;
 *  per-tag pages live under /prompts/. */
const CORE_URL = 'https://cdn.semtext.dev/semtext-prompt.sem.html';
const PROMPTS_BASE = 'https://cdn.semtext.dev/prompts/';

/** The head comment that tells an agent to read the core prompt first.
 *  Documented once in docs/authoring-guide.md; carried by the sample
 *  document in spec/conventions.md §1. */
const HEAD_COMMENT =
  'Agents: if you have not read this SemText prompt in this session, read it first.';

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Escape prose, then lift the schemas' inline `backtick` spans to
 *  <code> — the descriptions are Markdown and a prompt page should read
 *  as HTML. Deterministic single-pass pair replacement. */
const mdInline = (s) => escapeHtml(s).replace(/`([^`]*)`/g, '<code>$1</code>');

/** The schema files prefix attribute descriptions of global-attribute rows
 *  with "(unset)." when no element-specific default exists — noise on a
 *  prompt page. Strip it, keep everything else verbatim. */
const cleanDescription = (s) => String(s).replace(/^(?:\(unset\)\.?\s*)+/, '');

/** Purpose one-liners for the tags whose elements.json description is
 *  empty (the Tier-0 schemas state their purpose in prose the index
 *  generator does not lift). Parsed mechanically from the normative spec,
 *  never hand-written here:
 *  - conventions.md §5 bold entries: `**sem-note** — callout.`, including
 *    compound entries (`**sem-detail / sem-details** — …`, both names kept);
 *  - conventions.md §3 notation rows: `` | `<highlight>` | recall target… ``
 *    for record parts with no §5 entry. */
function purposeFallbacks(conventionsPath) {
  const purposes = new Map();
  const lines = readFileSync(conventionsPath, 'utf8').split('\n');
  for (const line of lines) {
    let m = line.match(/^\*\*([a-z<>][a-z<> /-]*)\*\* — (.+)$/);
    if (m) {
      for (const raw of m[1].split('/')) {
        const name = raw.trim().replace(/^<|>$/g, '');
        if (name && !purposes.has(name)) purposes.set(name, m[2].trim());
      }
      continue;
    }
    m = line.match(/^\| `<([a-z-]+)>` \| ([^|]+) \|/);
    if (m && !purposes.has(m[1])) purposes.set(m[1], m[2].trim());
  }
  return purposes;
}

function page(title, body) {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    '</head>',
    '<body>',
    '<sem-enhanced-document>',
    '',
    body.trimEnd(),
    '',
    '</sem-enhanced-document>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/* ------------------------------------------------------------------ *
 * Per-tag prompt page
 * ------------------------------------------------------------------ */

function optionsRows(tag) {
  const attrs = tag.attributes || [];
  if (attrs.length === 0) {
    return [
      '<p>No element-specific options. The global attribute catalog applies',
      '(<code>id</code>, <code>kind</code>, <code>tags</code>, <code>audience</code>,',
      '<code>view-as</code>, <code>status</code> — conventions.md §2).</p>',
    ].join('\n');
  }
  const rows = attrs.map((a) => {
    const name = `<code>${escapeHtml(a.name)}</code>`;
    const required = a.required ? 'yes' : '—';
    const hasDefault = a.default !== null && a.default !== '';
    const def = hasDefault ? `<code>${escapeHtml(a.default)}</code>` : '—';
    const values =
      Array.isArray(a.allowedValues) && a.allowedValues.length > 0
        ? a.allowedValues.map((v) => `<code>${escapeHtml(v)}</code>`).join(', ')
        : '—';
    const desc = mdInline(cleanDescription(a.description || ''));
    return `<tr><td>${name}</td><td>${required}</td><td>${def}</td><td>${values}</td><td>${desc}</td></tr>`;
  });
  return [
    '<table>',
    '<tr><th>attribute</th><th>required</th><th>default</th><th>values</th><th>description</th></tr>',
    ...rows,
    '</table>',
  ].join('\n');
}

function childrenSection(tag) {
  const children = tag.children || [];
  if (children.length === 0) {
    return '<p>Children: none — the element\'s own text content is the payload.</p>';
  }
  const items = children.map((c) => {
    const note = c.note ? ` — ${mdInline(c.note)}` : '';
    return `<li><code>${escapeHtml(c.name)}</code>${note}</li>`;
  });
  return ['<p>Children:</p>', '<ul>', ...items, '</ul>'].join('\n');
}

function tagPage(tag, purposes) {
  const purposeSource = tag.description || tag.summary || purposes.get(tag.name) || '';
  const purpose = mdInline(purposeSource);
  const source = escapeHtml(tag.source || '');
  const example = escapeHtml(tag.example || '').trimEnd();
  const purposePara = purpose ? `<p>${purpose}</p>\n` : '';
  const body = `
<h1><code>${escapeHtml(tag.name)}</code></h1>

${purposePara}<p>${escapeHtml(tag.family)} family · schema: <code>${source}</code></p>

<h2>Options</h2>
${optionsRows(tag)}

<h2>Children</h2>
${childrenSection(tag)}

<h2>Example</h2>
<pre><code>${example}</code></pre>

<p>Conventions: <a href="${CORE_URL}">core prompt</a></p>
`;
  return page(`SemText prompt — ${tag.name}`, body);
}

/* ------------------------------------------------------------------ *
 * Core prompt page
 * ------------------------------------------------------------------ */

function tagIndex(tagNames) {
  const items = tagNames.map((name) => {
    const href = `${PROMPTS_BASE}semtext-prompt.${name}.sem.html`;
    return `<li><a href="${href}">semtext-prompt.${name}.sem.html</a></li>`;
  });
  return ['<ul>', ...items, '</ul>'].join('\n');
}

function corePage(tagNames) {
  const body = `
<h1>SemText — agent prompt</h1>

<p>SemText is valid HTML5 whose custom elements carry meaning, not
presentation. One file serves three consumers: a browser (styled,
interactive), an LLM (the same markup read structurally — every datum
qualified by an attribute), and a terminal (DOM text extraction). Read
this page once per session; before you emit a tag for the first time,
read that tag's prompt page from the index at the end of this file.</p>

<h2>What a document is</h2>
<ul>
<li>Valid HTML5 with exactly one <code>&lt;sem-enhanced-document&gt;</code>
root inside <code>&lt;body&gt;</code>. <code>&lt;sem-reader&gt;</code>, when
used, is its first child.</li>
<li>Ordinary semantic HTML is always valid content; <code>sem-*</code>
enhances where interactivity pays.</li>
<li>Attributes are attributes, never <code>data-*</code>: write them bare on
custom elements — <code>variant="tip"</code>, <code>view-as="quiz"</code>,
<code>status="done"</code>, plus the global qualifiers <code>id</code>,
<code>kind</code>, <code>tags</code>, <code>audience</code>. On a standard
HTML element a qualifier keeps the <code>data-*</code> spelling
(<code>&lt;h2 data-kind="section"&gt;</code>). Never write both spellings on
one element.</li>
<li>Never author runtime markers (<code>data-sem-upgraded</code>,
<code>data-active</code>, <code>data-view-as</code>) — the script owns them.</li>
</ul>

<h2>Element families</h2>
<ul>
<li><code>sem-*</code> — the content vocabulary: notes, facts, details,
procedures, properties, code, tables, views, reveals, chronology,
audiences, references, reader chrome, source listings.</li>
<li><code>npl-*</code> — the NPL reasoning vocabulary: thoughts, intent,
mood, mode, critique, directives, declarations, examples, artifacts.</li>
<li>Record parts are bare semantic children
(<code>&lt;statement&gt;</code>, <code>&lt;conclusion&gt;</code>,
<code>&lt;highlight&gt;</code>), and document metadata is bare tags too
(<code>&lt;agent&gt;</code> with <code>&lt;name&gt;</code>,
<code>&lt;bio&gt;</code>, <code>&lt;instructions&gt;</code>).</li>
</ul>

<h2>Script surface</h2>
<ul>
<li><code>semtext.js</code> — the one script a document loads (single IIFE,
global <code>SemText</code>), with <code>defer</code>.</li>
<li><code>semtext.css</code> — the vocabulary base stylesheet; every
<code>sem-*</code> element gets its box from it even with no script.</li>
<li>an optional theme stylesheet, selected by
<code>data-sem-theme="&lt;slug&gt;"</code> on <code>&lt;html&gt;</code>.</li>
</ul>
<p>Documents served from the CDN may use the hosted lazy form instead of the
full bundle: <code>semtext-lazy.js</code> defines the <code>sem-*</code>
family, <code>npl-lazy.js</code> defines the <code>npl-*</code> family — load
only the family the document uses. Hard rules in every form: no ES-module
scripts, no runtime fetch in portable docs, no other script. With no script a
document shows its authored text — nothing hidden, nothing generated, the
record still extractable.</p>

<h2>Prompts never go in the body</h2>
<p>Agent-facing prompts are never document content. The body carries the
document itself; the only prompt reference lives in the head — a
<code>link</code> element with <code>rel="semtext-prompt"</code> pointing at
this file, directly preceded by an HTML comment instructing agents to read it
first (see the authoring guide for the exact snippet). Embedding instruction
prose for agents inside the body is an authoring error.</p>

<h2>Per-tag prompts</h2>
<p>One page per element, same CDN base. It lists the tag's options, defaults,
children and one example.</p>
${tagIndex(tagNames)}
`;
  return page('SemText — agent prompt', body);
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

const index = JSON.parse(readFileSync(elementsPath, 'utf8'));
if (!Array.isArray(index.tags) || index.tags.length === 0) {
  console.error(`build-prompts: ${elementsPath} has no tags — run build:elements-index first`);
  process.exit(1);
}

const purposes = purposeFallbacks(join(root, 'spec', 'conventions.md'));

const tagNames = index.tags.map((t) => t.name);
const unique = new Set(tagNames);
if (unique.size !== tagNames.length) {
  console.error('build-prompts: duplicate tag names in elements.json');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
for (const tag of index.tags) {
  writeFileSync(join(outDir, `semtext-prompt.${tag.name}.sem.html`), tagPage(tag, purposes));
}
writeFileSync(join(outDir, 'semtext-prompt.sem.html'), corePage(tagNames));

console.log(
  `build-prompts: wrote ${tagNames.length} per-tag pages + core prompt to ${outDir}`,
);
