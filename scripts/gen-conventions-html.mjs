#!/usr/bin/env node
/**
 * scripts/gen-conventions-html.mjs — generate spec/conventions.html from
 * spec/conventions.md.
 *
 *   node scripts/gen-conventions-html.mjs            # regenerate + write
 *   node scripts/gen-conventions-html.mjs --check    # exit 1 on drift, no write
 *   npm run gen:conventions / gen:conventions:check
 *
 * WHY: spec/conventions.html used to be hand-maintained alongside
 * spec/conventions.md and drifted. This script regenerates the page from
 * the normative .md so the two cannot drift silently.
 *
 * HOW: the page is a SemText re-authoring of the .md, not a mechanical
 * Markdown render. The generator is a config-driven assembly:
 *
 *   1. Parse the .md into blocks (headings, paragraphs, lists, GFM tables,
 *      fences) with a strict block splitter; every block must be consumed.
 *   2. Render block streams mechanically (md wins wherever the old hand
 *      page reworded it): tables → sem-md, §2 rule paragraphs →
 *      sem-properties, §4 → sem-procedure, §7 → sem-properties + a danger
 *      sem-note, §5 `**name** -- rest` paragraphs → h4#e-* + p + sem-code
 *      listing per ENTRY below.
 *   3. Splice the ORNAMENTS: verbatim segments of the v0.7 hand page that
 *      have no .md counterpart (the live sem-source examples, the consumers
 *      views, the dogfood/folder notes, the tier-status procedure, the
 *      references block, head/foot). They are data, kept verbatim so the
 *      generated page stays the page the tests and the build know.
 *
 * SAFETY: every anchor id asserted elsewhere — the build-standalone llms.txt
 * invariant anchor, the cypress spec-page pins, the old hand page's ids — is
 * pinned in ENTRY / REFS / the *-IDS tables below. Generation FAILS (exit 1)
 * if any pinned id would go missing, if an internal link does not resolve,
 * if a GFM table is dropped or reworded, if a listing is dropped, or if any
 * .md block goes unconsumed. Output is deterministic: no timestamps, no
 * environment reads; the same .md yields byte-identical output.
 *
 * House rules honoured: no new dependencies; `class="sem-` appears only
 * inside sem-code/sem-md listings; no data-<param> attributes on sem-*
 * elements.
 */

import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MD_PATH = join(root, 'spec', 'conventions.md');
const OUT_PATH = join(root, 'spec', 'conventions.html');

/** The anchor llms.txt (scripts/build-standalone.mjs) hard-asserts. */
const INVARIANT_ANCHOR = '8-machine-readability-contract';

// ---------- pinned anchors ----------
//
// ALIASES: markdown-derived slug (or a legacy link target as written in
// the .md) → the id the output MUST carry. Identity slugs need no entry;
// only where the pinned id differs from the slugger's output — or the .md
// links a mis-slugged target — is there a row.
const ALIASES = {
  // conventions.md's own outline links Appendix A with a 2-dash slug; the
  // heading slugs (GitHub + the cypress test) carry the em-dash "--" as
  // four hyphens. Pin the link target to the real heading id.
  'appendix-a--class-form-alias-v04-compatibility': 'appendix-a----class-form-alias-v04-compatibility',
};

// §5 element entries: the h4 id each entry is pinned to (the old page's
// ids; test/e2e/spec-pages.cy.js asserts the outline reaches #e-source).
// `rest` is the exact .md text after "name -- " that stays in the h4; the
// remainder becomes the entry paragraph, verified by subtraction.
const ENTRIES = [
  { name: 'sem-enhanced-document', id: 'e-enhanced-document', rest: 'the required root wrapper' },
  { name: 'sem-reader', id: 'e-reader', rest: 'reading chrome: outline, progress, focus, type, colour, print, audience' },
  { name: 'sem-audiences / sem-profile', id: 'e-audiences', rest: 'reader profiles; metadata, mints nothing', live: 's_audiences' },
  { name: 'agent', id: 'e-agent', rest: 'document-level metadata (bare semantic tag, no `sem-` prefix)' },
  { name: 'sem-md', id: 'e-md', rest: 'a Markdown block, rendered in the browser', live: 's_md' },
  { name: 'sem-note', id: 'e-note', rest: 'callout', live: 's_note' },
  { name: 'sem-code', id: 'e-code', rest: 'verbatim listing with provenance and copy / wrap', live: 's_code' },
  { name: 'sem-browser', id: 'e-browser', rest: 'chrome-like document window' },
  { name: 'sem-detail / sem-details', id: 'e-details', rest: 'prose with occludable content', live: 's_details' },
  { name: 'sem-tag-def / sem-api-call', id: 'e-tag-def', rest: 'reference-definition cards' },
  { name: 'sem-reveal', id: 'e-reveal', rest: 'Q-A disclosure, hidden until the reader acts', live: 's_reveal' },
  { name: 'sem-source', id: 'e-source', rest: 'a section that flips between rendered and authored markup' },
  { name: 'sem-views / sem-view', id: 'e-views', rest: 'same content, switchable perspectives', live: 's_views' },
  { name: 'sem-facts', id: 'e-facts', rest: 'collection; the flagship surface', live: 's_facts' },
  { name: 'sem-fact', id: 'e-fact', rest: 'the atomic unit; assertable Q/A pair' },
  { name: 'sem-question / sem-option', id: 'e-question', rest: 'quiz question types (Tier 1 -- flagship buildout)' },
  { name: 'sem-table', id: 'e-table', rest: 'sortable, filterable authored table', live: 's_table' },
  { name: 'sem-data-source, sem-data-query, sem-data-join, sem-data-visualizer', id: 'e-data', rest: 'data connector elements' },
  { name: 'sem-chronology / sem-event', id: 'e-chronology', rest: 'dated, ordered events; CSS-only timeline', live: 's_chronology' },
  { name: 'sem-procedure / sem-step', id: 'e-procedure', rest: 'ordered, status-annotated procedure', live: 's_procedure' },
  { name: 'sem-progress', id: 'e-progress', rest: 'completion meter', live: 's_progress' },
  { name: 'sem-workflow / sem-step', id: 'e-workflow', rest: 'ordered steps carrying operational metadata', live: 's_workflow' },
  { name: 'sem-site-tree / node', id: 'e-site-tree', rest: 'a tree authored as nested bare `<node path label kind collapsed>` children', live: 's_site_tree' },
  { name: 'sem-file-tree', id: 'e-file-tree', rest: 'the same tree model authored as text', live: 's_file_tree' },
  { name: 'Tickets', id: 'e-agent-kit-issue', rest: '`agent-kit-issue` / `-epic` / `-bug` / `-user-story` / `-task` / `-sub-task` share one part set', live: 's_agent_kit_issue' },
  { name: 'Personas / criteria / board / chatroom', id: 'e-agent-kit-personas', rest: '`agent-kit-user-persona` / `-agent-persona`' },
  { name: 'Media', id: 'e-agent-kit-media', rest: '`agent-kit-asset[src mime]`' },
  { name: 'Testing', id: 'e-agent-kit-testing', rest: '`agent-kit-test-suite` > `-branch[passed failed]` rows' },
  { name: 'sem-properties / sem-property', id: 'e-properties', rest: 'definition/properties block', live: 's_properties' },
  { name: 'sem-references / sem-reference', id: 'e-references', rest: 'numbered citable entries' },
];
// Entries carrying a sem-code listing → the listing id (the old page's
// c-* ids). c-skeleton (§1) and c-alias (Appendix A) are rendered directly
// by their section handlers; every other fence lands on its entry here.
const FENCE_OF = {
  'e-reader': 'c-reader',
  'e-audiences': 'c-audiences',
  'e-md': 'c-md',
  'e-note': 'c-note',
  'e-code': 'c-code',
  'e-browser': 'c-browser',
  'e-details': 'c-details',
  'e-reveal': 'c-reveal',
  'e-source': 'c-source',
  'e-views': 'c-views',
  'e-facts': 'c-facts',
  'e-fact': 'c-fact',
  'e-question': 'c-question',
  'e-table': 'c-table',
  'e-chronology': 'c-chronology',
  'e-procedure': 'c-procedure',
  'e-progress': 'c-progress',
  'e-workflow': 'c-workflow',
  'e-site-tree': 'c-site-tree',
  'e-file-tree': 'c-file-tree',
  'e-agent-kit-issue': 'c-agent-kit-issue',
  'e-properties': 'c-properties',
  'e-references': 'c-references',
};
// Listing attrs beyond lang="html", per id. (c-alias is a verbatim ornament;
// the .md appendix carries no fence.)
const FENCE_ATTRS = {
  'c-skeleton': ' filename="doc.html" controls="copy,wrap"',
};

// GFM tables → sem-md, identified by header row (the two alias tables
// share a header; they are taken in file order).
const TABLES = [
  { header: '| Bucket | Elements | What it covers |', id: 'md-buckets', attrs: ' id="md-buckets" kind="bucket-overview" label="Element buckets" controls="toggle,copy"' },
  { header: '| Attribute | Values | Machine meaning |', id: 'md-attributes', attrs: ' id="md-attributes" kind="attribute-catalog" label="Global attributes" controls="toggle,copy"' },
  { header: '| Notation | Meaning | Where |', id: 'md-notation', attrs: ' id="md-notation" kind="notation" label="Compact notation" controls="toggle,copy"' },
  { header: '| # | Question | My lean |', id: 'md-questions', attrs: ' id="md-questions" kind="open-questions" label="Open questions and leans" controls="toggle,copy"' },
  { header: '| Canonical tag form | Class-form alias |', id: 'md-alias', attrs: ' id="md-alias" kind="mapping" label="Canonical tag form &rarr; class-form alias" controls="toggle,copy"', nth: 1 },
  { header: '| Canonical tag form | Class-form alias |', id: 'md-alias-npl', attrs: ' id="md-alias-npl" kind="mapping" label="Canonical tag form &rarr; class-form alias (NPL)" controls="toggle,copy"', nth: 2 },
];

// Normative schema paths → reference ids. `pin` = the old page's r-* id
// where it is irregular (test-suite → suite); every other id is
// r-<basename>. Paths without a pin row use the default id.
const REFS = {
  'spec/conventions.md': 'r-conventions-md',
  'spec/extraction.md': 'r-extraction',
  'spec/schema/agent-kit/test-suite.md': 'r-agent-kit-suite',
};
const REF_BASE = 'https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/';
// Reference entries with hand-written one-line content (the v0.7 page's
// entries, kept verbatim); every NEW entry (a Normative path the old page
// never carried) gets "Schema -- <path>." in the same shape.
const REF_TEXT = {
  'r-conventions-md': 'The normative Markdown source of this page.',
  'r-extraction': 'Extraction -- the record model and the invariant behind it.',
  'r-sem-md': 'Schema -- sem-md.',
  'r-sem-tag-def': 'Schemas -- sem-tag-def and sem-api-call.',
  'r-agent-kit-issue': 'Schemas -- agent-kit tickets and ticket-ref.',
  'r-agent-kit-review': 'Schema -- agent-kit review.',
  'r-agent-kit-suite': 'Schemas -- agent-kit test suites, cases and script cards.',
};

// §2 bold-lead rule paragraphs → sem-properties#p-catalog-rules.
const CATALOG_RULES = {
  container: 'p-catalog-rules',
  leads: { 'Alias spelling': 'p-alias-spelling', 'Runtime state': 'p-runtime-state', 'Hash state': 'p-hash-state', 'Class namespace': 'p-class-namespace' },
};
// §7 ordered list → sem-properties#p-distribution + the danger note.
const DISTRIBUTION = {
  container: 'p-distribution',
  items: { 1: ['p-folder', 'Folder'], 2: ['p-single-file', 'Single-file'], 3: ['p-mhtml', 'MHTML'], 5: ['p-hosted-lazy', 'Hosted lazy'] },
  note: { item: 4, id: 'n-hard-rules', variant: 'danger' },
};

// ---------- slugger ----------
// Mirrors test/e2e/spec-pages.cy.js slug() (which mirrors GitHub): the .md
// outline anchors and the emitted ids must agree mechanically.
function slug(heading) {
  return heading.toLowerCase().replace(/[`*]/g, '').replace(/[^\p{L}\p{N} -]/gu, '').trim().replace(/ /g, '-');
}
// ORNAMENTS — verbatim segments of the v0.7 hand-maintained spec/conventions.html
// (epic.semext-components @ 54134d0), extracted by scripts/gen-conventions-html.mjs
// provenance. Live sem-source examples, notes, the consumers block, the tier
// status procedure, the references block and the document head/foot exist only
// here — conventions.md has no counterpart for them.
const ORNAMENTS = {
  head: `
<!doctype html>
<!--
  spec/conventions.html -- the format spec, written in the format it specifies.

  Normative source: spec/conventions.md. This page carries the same rules,
  section for section, authored as a SemText document in the canonical
  tag form: custom elements with bare attributes, no sem-* classes. The
  attribute catalogs are sem-properties / sem-table, the ordered rules are
  sem-procedure, the open questions are sem-note, each element entry shows
  its markup in a sem-code listing and runs a live example inside a
  sem-source so the reader can flip between what renders and what was
  written. The class-form alias appears only inside listings, in
  Appendix A. Where the two files diverge, the .md wins.

  No inline CSS, no inline JS: the theme and vocabulary stylesheets are
  linked, spec.css carries the document layout, and the one script is
  loaded from dist/ by src attribute. Served from the repo root the
  ../ paths reach themes/ and dist/; scripts/build-standalone.mjs copies
  this page to dist/spec/ with the paths rewritten, plus a .nojs.html
  variant with every script element removed.
-->
<html lang="en" data-sem-theme="minimal-tech-light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SemText -- Format Spec &amp; Conventions v0.7</title>
<meta name="description" content="SemText format specification and conventions, draft v0.7: the custom-element vocabulary, document skeleton, attribute catalog, notation, the script and degradation rules, element entries by bucket, themes, distribution forms, the machine-readability contract and the class-form compatibility alias. v0.7 renames the fact child sem-distractor to incorrect-statement (breaking, no alias).">

<link rel="stylesheet" href="../themes/minimal-tech-light.css">
<link rel="stylesheet" href="../themes/_vocabulary.css">
<link rel="stylesheet" href="spec.css">

<script defer src="../dist/semtext.js"></script>
</head>

<body>
<sem-enhanced-document id="doc" role="main">

  <sem-reader id="rd" controls="outline,progress,focus,type,color,print,audience" outline-depth="4"></sem-reader>`,
  nDogfood: `
<sem-note id="n-dogfood" variant="tip">Every vocabulary element on this page is live and written as a tag. Each entry in <a href="#5-element-entries">&sect;5</a> sits inside a <code>sem-source</code> wrapper: press <em>Source</em> to see the markup exactly as it was written here -- bare attributes, no <code>data-*</code>, no classes.</sem-note>`,
  nFolderForm: `
<sem-note id="n-folder-form" variant="info">This page ships the <strong>folder</strong> form: two theme stylesheets, the vocabulary stylesheet, one layout stylesheet and the one bundle linked from <code>&lt;head&gt;</code>, no inline CSS or JS. Its scripts-stripped twin, <code>conventions.nojs.html</code>, is the JS-off proof.</sem-note>`,
  consumers: `
  <sem-views id="consumers" role="region" aria-label="The three consumers of a SemText document">
    <sem-view name="Human / browser" active role="tabpanel">
      <p>Double-click, styled, interactive. The theme CSS renders the vocabulary; the script adds the behaviour.</p>
    </sem-view>
    <sem-view name="LLM / non-visual" role="tabpanel">
      <p>The same XHTML read structurally; attributes qualify every datum; the same XML vocabulary NPL's MCP server already speaks.</p>
    </sem-view>
    <sem-view name="Terminal" role="tabpanel">
      <p>Browser render or DOM-text extraction; the content is complete without JS.</p>
    </sem-view>
  </sem-views>`,
  s_audiences: `
  <sem-source id="s-audiences" label="Live: sem-audiences">
    <sem-audiences id="x-audiences">
      <sem-profile id="reader" label="Reader"></sem-profile>
      <sem-profile id="operator" label="Operator" implies="reader"></sem-profile>
    </sem-audiences>
    <sem-note id="x-audience-note" audience="operator" variant="info">Operators only: an operator implies reader. Pick a profile from the reading bar's <em>Audience</em> select, or open <a href="#sem-audience=operator">#sem-audience=operator</a>.</sem-note>
  </sem-source>`,
  s_md: `
  <sem-source id="s-md" label="Live: sem-md">
    <sem-md id="x-md" kind="lifetimes" label="Token lifetimes" controls="toggle,copy">
      | Token   | Lifetime | Rotates |
      | :------ | -------: | :-----: |
      | access  | 15 min   | no      |
      | refresh | 30 days  | yes     |
    </sem-md>
  </sem-source>`,
  s_note: `
  <sem-source id="s-note" label="Live: sem-note">
    <sem-note id="x-note" variant="warning">Rotation is <strong>per session</strong>.</sem-note>
    <sem-note id="x-note-collapsed" variant="tip" collapsed>Shuffle flashcards before each review session for better recall; the deck remembers nothing between sessions.</sem-note>
  </sem-source>`,
  s_code: `
  <sem-source id="s-code" label="Live: sem-code">
    <sem-code id="x-code" lang="ts" filename="src/rotate.ts" mark="2,4-5" controls="copy,wrap">
<pre><code>export function rotate(pair: Pair): Pair {
  const next = mint();
  retire(pair.refresh);
  return next;
}</code></pre>
    </sem-code>
  </sem-source>`,
  s_details: `
  <sem-source id="s-details" label="Live: sem-details, quiz">
    <sem-details id="x-details" view-as="quiz">
      <sem-detail id="x-d1">The OIDC token travels in the <highlight>Authorization</highlight> header; refresh tokens <highlight>never reach the browser</highlight>.</sem-detail>
    </sem-details>
  </sem-source>`,
  s_reveal: `
  <sem-source id="s-reveal" label="Live: sem-reveal">
    <sem-reveal id="x-reveal" summary="Why a separate element from sem-note[collapsed]?">
      A note is an annotation (variant tone); a reveal is exposition (Q&rarr;A). Same mechanism, different semantics -- machines distinguish them.
    </sem-reveal>
  </sem-source>`,
  s_views: `
  <sem-source id="s-views" label="Live: sem-views">
    <sem-views id="x-deploy">
      <sem-view id="x-helm" name="Helm" active role="tabpanel">Helm renders the chart; the image tag is bumped by CI.</sem-view>
      <sem-view id="x-argocd" name="ArgoCD" role="tabpanel">ArgoCD auto-syncs from the chart repo's <code>main</code>. Deep link: <a href="#x-deploy/argocd">#x-deploy/argocd</a>.</sem-view>
    </sem-views>
  </sem-source>`,
  s_facts: `
  <sem-source id="s-facts" label="Live: sem-facts, flashcards">
    <sem-facts id="x-facts" view-as="flashcards" kind="spec">
      <sem-fact id="x-f1" kind="rule">
        <statement>Semantic identity, parameterized presentation</statement>
        <conclusion><code>sem-fact</code> is a fact in list, flashcard and quiz views -- <code>view-as</code> only changes rendering.</conclusion>
      </sem-fact>
      <sem-fact id="x-f2" kind="rule">
        <statement>What guarantees interactivity?</statement>
        <conclusion>The one <code>semtext.js</code> script.</conclusion>
        <incorrect-statement>The Tailwind CDN script.</incorrect-statement>
      </sem-fact>
    </sem-facts>
  </sem-source>`,
  s_table: `
  <sem-source id="s-table" label="Live: sem-table">
    <sem-table id="x-table" kind="lifetimes" controls="sort,filter" sticky>
      <table>
        <caption>Token lifetimes</caption>
        <thead><tr><th scope="col">Token</th><th scope="col">Lifetime</th><th scope="col">Rotates</th></tr></thead>
        <tbody>
          <tr><td>access</td><td data-value="900">15 min</td><td>no</td></tr>
          <tr><td>refresh</td><td data-value="2592000">30 days</td><td>yes</td></tr>
          <tr><td>id</td><td data-value="3600">1 hour</td><td>no</td></tr>
        </tbody>
      </table>
    </sem-table>
  </sem-source>`,
  s_chronology: `
  <sem-source id="s-chronology" label="Live: sem-chronology">
    <sem-chronology id="x-chronology" kind="release-history" view-as="timeline" role="list">
      <sem-event id="x-e1" role="listitem" when="2026-03-02" status="done"><time datetime="2026-03-02">2 Mar 2026</time> v0.1 tagged -- Lit bundle ships.</sem-event>
      <sem-event id="x-e2" role="listitem" when="2026-09" status="current"><time datetime="2026-09">Sep 2026</time> Reading-experience waves land one PR at a time; the tag form becomes canonical.</sem-event>
    </sem-chronology>
  </sem-source>`,
  s_procedure: `
  <sem-source id="s-procedure" label="Live: sem-procedure">
    <sem-procedure id="x-procedure" kind="runbook" role="list">
      <sem-step role="listitem" status="done">provision Infisical path</sem-step>
      <sem-step role="listitem" status="current">port-forward MinIO</sem-step>
      <sem-step role="listitem">run migrations</sem-step>
      <sem-step role="listitem" status="blocked">cut release</sem-step>
    </sem-procedure>
  </sem-source>`,
  s_progress: `
  <sem-source id="s-progress" label="Live: sem-progress">
    <sem-progress id="x-progress" value="0.7" label="Tier-0 spec coverage" role="meter" aria-valuemin="0" aria-valuemax="1" aria-valuenow="0.7"></sem-progress>
  </sem-source>`,
  s_workflow: `
  <sem-source id="s-workflow" label="Live: sem-workflow">
    <sem-workflow id="x-workflow" kind="release" duration="45m" role="list">
      <sem-step id="x-wf-1" role="listitem" action="Build images" gate="CI green" check="gh run view" if-no="fix CI, then re-run" status="done">push the tag</sem-step>
      <sem-step id="x-wf-2" role="listitem" action="Deploy stage" if-no="stop and page the release captain">merge to stage</sem-step>
    </sem-workflow>
  </sem-source>`,
  s_site_tree: `
  <sem-source id="s-site-tree" label="Live: sem-site-tree">
    <sem-site-tree id="x-site-tree" label="Spec layout" role="tree">
      <node path="spec" label="Specs" kind="dir" role="treeitem">
        <node path="spec/schema" kind="dir" role="group">
          <node path="spec/schema/sem-workflow.md" kind="file" role="treeitem"></node>
          <node path="spec/schema/sem-site-tree.md" kind="file" role="treeitem"></node>
        </node>
      </node>
    </sem-site-tree>
  </sem-source>`,
  s_file_tree: `
  <sem-source id="s-file-tree" label="Live: sem-file-tree">
    <sem-file-tree id="x-file-tree" mode="text" label="Themes" role="tree"><pre>
themes/
&#x251c;&#x2500;&#x2500; _vocabulary.css
&#x2514;&#x2500;&#x2500; _print.css
</pre></sem-file-tree>
  </sem-source>`,
  s_agent_kit_issue: `
  <sem-source id="s-agent-kit-issue" label="Live: agent-kit-issue">
    <agent-kit-issue id="x-agent-kit-issue" uuid="AK-142" state="in-progress">
      <agent-kit-title>Bundle merge drift</agent-kit-title>
      <agent-kit-description>Epic catch-up re-spliced the schema seam.</agent-kit-description>
    </agent-kit-issue>
  </sem-source>`,
  s_properties: `
  <sem-source id="s-properties" label="Live: sem-properties">
    <sem-properties id="x-properties" kind="config">
      <sem-property id="x-p-ttl" key="token ttl" role="definition" aria-label="token ttl">15m</sem-property>
      <sem-property id="x-p-store" key="storage" role="definition" aria-label="storage">httpOnly cookie</sem-property>
    </sem-properties>
  </sem-source>`,
  roughMarker: `
  <a id="5-element-entries-rough"></a>`,
  cAlias: `
<sem-code id="c-alias" lang="html" filename="alias.html" controls="copy,wrap"><pre><code>&lt;!-- canonical --&gt;
&lt;sem-note variant="warning"&gt;Rotation is &lt;strong&gt;per session&lt;/strong&gt;.&lt;/sem-note&gt;

&lt;!-- class-form alias: same note, same record --&gt;
&lt;div class="sem-note" data-variant="warning"&gt;
  &lt;div class="sem-note-body"&gt;Rotation is &lt;strong&gt;per session&lt;/strong&gt;.&lt;/div&gt;
&lt;/div&gt;</code></pre></sem-code>`,
  nBudget: `
<sem-note id="n-budget" variant="info" collapsed>Why the budgets are stated raw: a portable single-file document inlines its scripts, and nothing gzips an inlined <code>&lt;script&gt;</code>. The build prints every artifact against its budget; <code>npm run build:strict</code> fails on an overrun, so a budget is raised deliberately in <code>scripts/build.mjs</code> and recorded in the roadmap, never silently.</sem-note>`,
  nHardRules: `
<sem-note id="n-hard-rules" variant="danger">Hard rules: no ES-module scripts; no runtime fetch in portable docs; <code>semtext.js</code> is linked (or inlined) in full in every portable form regardless of which of (1)-(3) it takes -- there is no smaller script to fall back to. Form (5), hosted lazy, is the served-pages exception: it swaps the full bundle for on-demand chunks and cannot survive offline.</sem-note>`,
  nplCatalog: `
  <sem-properties id="p-npl-elements" kind="npl-catalog">
    <sem-property id="p-npl-agent" key="npl-agent" role="definition" aria-label="npl-agent">Agent definition: name, bio, instructions, model settings.</sem-property>
    <sem-property id="p-npl-directive" key="npl-directive" role="definition" aria-label="npl-directive">An instruction the agent must follow.</sem-property>
    <sem-property id="p-npl-section" key="npl-section" role="definition" aria-label="npl-section">Section marker for prompt structure.</sem-property>
    <sem-property id="p-npl-rubric" key="npl-rubric" role="definition" aria-label="npl-rubric">Scoring guide or evaluation criteria.</sem-property>
    <sem-property id="p-npl-critique" key="npl-critique" role="definition" aria-label="npl-critique">Evaluation of output against a rubric.</sem-property>
    <sem-property id="p-npl-declaration" key="npl-declaration" role="definition" aria-label="npl-declaration">Statement of intent or principle.</sem-property>
    <sem-property id="p-npl-example" key="npl-example" role="definition" aria-label="npl-example">Worked example (few-shot).</sem-property>
    <sem-property id="p-npl-flag" key="npl-flag / npl-flags" role="definition" aria-label="npl-flag">Warning, note, or status flag.</sem-property>
    <sem-property id="p-npl-mindread" key="npl-mindread" role="definition" aria-label="npl-mindread">Intent or subtext analysis.</sem-property>
    <sem-property id="p-npl-thought" key="npl-thought" role="definition" aria-label="npl-thought">Reasoning trace or chain-of-thought output.</sem-property>
    <sem-property id="p-npl-poa" key="npl-poa" role="definition" aria-label="npl-poa">Plan of action.</sem-property>
    <sem-property id="p-npl-ref" key="npl-ref" role="definition" aria-label="npl-ref">Post-hoc reflection over a finished turn (assessment, improvements, validation, eval, fine-tune).</sem-property>
    <sem-property id="p-npl-vos" key="npl-vos" role="definition" aria-label="npl-vos">Voice or style specification.</sem-property>
    <sem-property id="p-npl-artifact" key="npl-artifact" role="definition" aria-label="npl-artifact">Output artifact marker.</sem-property>
    <sem-property id="p-npl-mode" key="npl-mode" role="definition" aria-label="npl-mode">Operating mode (e.g. planning, executing, reviewing).</sem-property>
    <sem-property id="p-npl-mood" key="npl-mood" role="definition" aria-label="npl-mood">Tone or emotional register.</sem-property>
    <sem-property id="p-npl-hormones" key="npl-hormones" role="definition" aria-label="npl-hormones">Drive or motivation settings.</sem-property>
    <sem-property id="p-npl-cot" key="npl-cot" role="definition" aria-label="npl-cot">Chain-of-thought prompting.</sem-property>
    <sem-property id="p-npl-intent" key="npl-intent" role="definition" aria-label="npl-intent">Intent declaration for a section or response.</sem-property>
  </sem-properties>`,
  tierStatus: `
  <h3 id="tier-status">Tier status -- what shipped when</h3>
  <sem-procedure id="tier-2-status" kind="roadmap" role="list" aria-label="Tier 2 items and their status">
    <sem-step role="listitem" status="done"><code>sem-chronology</code> / <code>sem-event when</code> -- shipped (R/W1, Tier 0).</sem-step>
    <sem-step role="listitem" status="done"><code>sem-table</code> -- shipped (R/W2, Tier 0); <code>sem-query</code> deferred.</sem-step>
    <sem-step role="listitem"><code>sem-themes controls="picker"</code> -- subsumed by <code>sem-reader</code>'s <code>theme</code> control (R/W3, after Track T).</sem-step>
    <sem-step role="listitem" status="done"><code>sem-md</code> -- shipped (R/W2.2, Tier 0): Markdown <em>inside</em> a SemText document. A whole-document md&rarr;SemText authoring aid remains optional and never required.</sem-step>
  </sem-procedure>`,
  references: `
  <h2 id="references">References</h2>
  <sem-references id="refs" kind="bibliography" role="list">
    <sem-reference id="r-conventions-md" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/conventions.md" cite="spec/conventions.md">The normative Markdown source of this page.</sem-reference>
    <sem-reference id="r-extraction" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/extraction.md" cite="spec/extraction.md">Extraction contract: record shape, emission rules, the central invariant, annotated plain text.</sem-reference>
    <sem-reference id="r-sem-note" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/schema/sem-note.md" cite="spec/schema/sem-note.md">Schema -- sem-note.</sem-reference>
    <sem-reference id="r-sem-audiences" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/schema/sem-audiences.md" cite="spec/schema/sem-audiences.md">Schema -- sem-audiences / sem-profile.</sem-reference>
    <sem-reference id="r-sem-facts" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/schema/sem-facts.md" cite="spec/schema/sem-facts.md">Schema -- sem-facts / sem-fact.</sem-reference>
    <sem-reference id="r-sem-details" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/schema/sem-details.md" cite="spec/schema/sem-details.md">Schema -- sem-details / sem-detail.</sem-reference>
    <sem-reference id="r-sem-procedure" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/schema/sem-procedure.md" cite="spec/schema/sem-procedure.md">Schema -- sem-procedure / sem-step.</sem-reference>
    <sem-reference id="r-sem-properties" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/schema/sem-properties.md" cite="spec/schema/sem-properties.md">Schema -- sem-properties / sem-property.</sem-reference>
    <sem-reference id="r-sem-views" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/schema/sem-views.md" cite="spec/schema/sem-views.md">Schema -- sem-views / sem-view.</sem-reference>
    <sem-reference id="r-sem-tag-def" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/schema/sem-tag-def.md" cite="spec/schema/sem-tag-def.md">Schema -- sem-tag-def / sem-tag-attr.</sem-reference>
    <sem-reference id="r-sem-api-call" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/schema/sem-api-call.md" cite="spec/schema/sem-api-call.md">Schema -- sem-api-call / sem-api-param.</sem-reference>
    <sem-reference id="r-sem-reveal" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/schema/sem-reveal.md" cite="spec/schema/sem-reveal.md">Schema -- sem-reveal.</sem-reference>
    <sem-reference id="r-sem-chronology" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/schema/sem-chronology.md" cite="spec/schema/sem-chronology.md">Schema -- sem-chronology / sem-event.</sem-reference>
    <sem-reference id="r-sem-code" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/schema/sem-code.md" cite="spec/schema/sem-code.md">Schema -- sem-code.</sem-reference>
    <sem-reference id="r-sem-browser" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/schema/sem-browser.md" cite="spec/schema/sem-browser.md">Schema -- sem-browser.</sem-reference>
    <sem-reference id="r-sem-source" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/schema/sem-source.md" cite="spec/schema/sem-source.md">Schema -- sem-source.</sem-reference>
    <sem-reference id="r-sem-md" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/schema/sem-md.md" cite="spec/schema/sem-md.md">Schema -- sem-md.</sem-reference>
    <sem-reference id="r-sem-references" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/schema/sem-references.md" cite="spec/schema/sem-references.md">Schema -- sem-references / sem-reference.</sem-reference>
    <sem-reference id="r-sem-reader" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/schema/sem-reader.md" cite="spec/schema/sem-reader.md">Schema -- sem-reader.</sem-reference>
    <sem-reference id="r-sem-table" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/schema/sem-table.md" cite="spec/schema/sem-table.md">Schema -- sem-table.</sem-reference>
    <sem-reference id="r-sem-progress" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/schema/sem-progress.md" cite="spec/schema/sem-progress.md">Schema -- sem-progress.</sem-reference>
    <sem-reference id="r-sem-workflow" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/schema/sem-workflow.md" cite="spec/schema/sem-workflow.md">Schema -- sem-workflow / sem-step.</sem-reference>
    <sem-reference id="r-sem-site-tree" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/schema/sem-site-tree.md" cite="spec/schema/sem-site-tree.md">Schema -- sem-site-tree / node.</sem-reference>
    <sem-reference id="r-sem-file-tree" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/schema/sem-file-tree.md" cite="spec/schema/sem-file-tree.md">Schema -- sem-file-tree.</sem-reference>
    <sem-reference id="r-agent-kit-tickets" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/schema/agent-kit/tickets.md" cite="spec/schema/agent-kit/tickets.md">Schema -- agent-kit tickets and parts.</sem-reference>
    <sem-reference id="r-agent-kit-review" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/schema/agent-kit/review.md" cite="spec/schema/agent-kit/review.md">Schema -- agent-kit media and review records.</sem-reference>
    <sem-reference id="r-agent-kit-suite" role="listitem" href="https://github.com/noizu-labs-ml/npl-enhanced-content/blob/develop/spec/schema/agent-kit/test-suite.md" cite="spec/schema/agent-kit/test-suite.md">Schema -- agent-kit testing records.</sem-reference>
  </sem-references>`,
  foot: `
</sem-enhanced-document>
</body>
</html>`,
};

// ---------- tiny helpers ----------
// fail() throws; main() turns a throw into the CLI's exit 1 (tests call
// generate()/runChecks() directly and see the error).
const fail = (msg) => { throw new Error(msg); };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const renderFence = (b, id) =>
  `<sem-code id="${id}" lang="html"${FENCE_ATTRS[id] || ''}><pre><code>${esc(b.code)}</code></pre></sem-code>`;

// ---------- .md block parser ----------
// Splits conventions.md into an ordered block stream. Deliberately narrow:
// the file uses exactly these shapes, and the consumption checks fail the
// build on anything unexpected.
function parseMd(md) {
  const lines = md.split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line === '' || line === '---') { i++; continue; }
    if (/^```/.test(line)) {
      const info = line.slice(3).trim();
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      if (i >= lines.length) fail('unterminated fence in conventions.md');
      i++;
      blocks.push({ t: 'fence', info, code: body.join('\n') });
      continue;
    }
    const h = line.match(/^(#{1,3}) (.+)$/);
    if (h) { blocks.push({ t: `h${h[1].length}`, text: h[2].trim() }); i++; continue; }
    if (/^\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i].trim())) { rows.push(lines[i].trim()); i++; }
      blocks.push({ t: 'table', header: rows[0], rows });
      continue;
    }
    if (/^- /.test(line)) {
      const items = [];
      while (i < lines.length && /^- /.test(lines[i])) {
        let text = lines[i].slice(2);
        i++;
        while (i < lines.length && lines[i] !== '' && lines[i] !== '---' && !/^(#{1,3} |```|\| |- |\d+\. )/.test(lines[i])) { text += ' ' + lines[i].trim(); i++; }
        items.push(text);
      }
      blocks.push({ t: 'ul', items });
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        let text = lines[i].replace(/^\d+\. /, '');
        i++;
        while (i < lines.length && /^\s{3}\S/.test(lines[i])) { text += ' ' + lines[i].trim(); i++; }
        items.push(text);
      }
      blocks.push({ t: 'ol', items });
      continue;
    }
    let text = line;
    i++;
    while (i < lines.length && lines[i] !== '' && lines[i] !== '---' && !/^(#{1,3} |```|\| |- |\d+\. )/.test(lines[i])) { text += ' ' + lines[i].trim(); i++; }
    blocks.push({ t: 'p', text });
  }
  return blocks;
}

// ---------- inline renderer ----------
// Code spans protected, then escape, then structure. Only the forms
// conventions.md actually uses are handled; everything else stays literal
// text (md wins; the old hand page's entity prettification -- &rarr;,
// typographic dashes -- is deliberately not reproduced).
function renderInline(text, ctx) {
  const codes = [];
  // spec/extraction.md SS<n> mentions point at extraction's own sections:
  // plain code span + plain §, never a conventions link (hand page parity).
  let s = text.replace(/`spec\/extraction\.md`(\s+)SS(\d[\d.]*)/g, (_, sp, n) => {
    codes.push('spec/extraction.md');
    return `\u0000${codes.length - 1}\u0000${sp}&sect;${n}`;
  });
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  // quotes too: an inline code span may document `class="sem-note"` — the
  // page must never carry that literal outside a listing (tag-form test)
  s = esc(s).replace(/"/g, '&quot;');
  // a link whose label opens with an SS/§ token renders the token as &sect;
  // (single anchor, no nesting)
  s = s.replace(/\[(?:SS|§)(\d+)([^\]]*)\]\(#([^)]+)\)/g, (all, n, rest, target) =>
    `<a href="#${ctx.resolveAnchor(target)}">&sect;${n}${rest}</a>`);
  s = s.replace(/\[([^\]]+)\]\(#([^)]+)\)/g, (all, label, target) =>
    `<a href="#${ctx.resolveAnchor(target)}">${renderInline(label, ctx)}</a>`);
  // SS<n> -> linked §n, except extraction-scoped mentions ("extraction SS3.6",
  // "recorded SS5") — the hand page leaves those plain; so do we
  s = s.replace(/(^|[^A-Za-z0-9])([A-Za-z]+ )?SS(\d+(?:\.\d+)?)/g, (all, pre, word, n) => {
    if (word && /^(extraction|recorded) $/.test(word)) return `${pre}${word}&sect;${n}`;
    const target = ctx.sectionTarget(n);
    if (!target) fail(`SS${n} has no matching numbered heading in conventions.md`);
    return `${pre}<a href="#${target}">&sect;${n}</a>`;
  });
  // prose "Appendix A" mentions link to the appendix heading (an md link
  // around it, if any, already won above)
  s = s.replace(/Appendix A(?!([^<]*<\/a>))/g, '<a href="#appendix-a----class-form-alias-v04-compatibility">Appendix A</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, k) => `<code>${esc(codes[+k]).replace(/"/g, '&quot;')}</code>`);
  return s;
}

const isNormative = (text) => /^\*\*Normative: .+\*\*$/.test(text);

// A **Normative:** line: every schema path becomes a reference link.
// Continuation paths ("acceptance-criteria.md") resolve against the first
// path's directory; the link text is always the full resolved path.
function renderNormative(text, ctx) {
  const inner = text.replace(/^\*\*Normative: /, '').replace(/\.\*\*$/, '');
  const parts = inner.split(',').map((p) => p.trim().replace(/`/g, ''));
  let dir = '';
  const links = parts.map((raw) => {
    const path = raw.includes('/') ? raw : dir + raw;
    dir = dir || path.slice(0, path.lastIndexOf('/') + 1);
    return `<a href="#${ctx.refId(path)}">${esc(path)}</a>`;
  });
  return `<p><strong>Normative: ${links.join(', ')}.</strong></p>`;
}

// ---------- the generator ----------
// mdOverride lets tests feed a modified conventions.md without touching the
// repo (undefined = read spec/conventions.md).
function generate(mdOverride) {
  const md = mdOverride ?? readFileSync(MD_PATH, 'utf8');
  const version = (md.match(/\*\*DRAFT v([\d.]+)/) || [])[1];
  if (!version) fail('cannot read the DRAFT vN version from conventions.md');

  const blocks = parseMd(md);
  const headings = blocks.filter((b) => /^h[23]$/.test(b.t));
  const sectionTarget = (n) => {
    const h = headings.find((x) => new RegExp(`^${n}\\. `).test(x.text));
    return h ? slug(h.text) : '';
  };
  const headingIds = new Set(headings.filter((h) => h.text !== 'Outline').map((h) => slug(h.text)));
  const pinnedIds = new Set([
    INVARIANT_ANCHOR, ...Object.values(ALIASES), ...ENTRIES.map((e) => e.id),
    ...Object.values(FENCE_OF), 'c-skeleton', 'c-alias',
    ...TABLES.map((t) => t.id), ...Object.values(CATALOG_RULES.leads), CATALOG_RULES.container,
    DISTRIBUTION.container, ...Object.values(DISTRIBUTION.items).map((v) => v[0]), DISTRIBUTION.note.id,
    ...[1, 2, 3, 4, 5, 6].map((k) => `rule-4-${k}`),
    'n-dogfood', 'n-folder-form', 'n-budget', 'n-hard-rules', 'tier-status', 'tier-2-status',
    'consumers', 'references', 'refs', '5-element-entries-rough', 'doc', 'rd', 'p-npl-elements',
    'npl-namespace-npl-',
  ]);
  const refIds = new Set();
  const refId = (path) => {
    const id = REFS[path] || `r-${path.replace(/^spec\/schema\//, '').replace(/\.md$/, '').replace(/\//g, '-')}`;
    refIds.add(id);
    return id;
  };
  const resolveAnchor = (target) => {
    if (ALIASES[target]) return ALIASES[target];
    if (headingIds.has(target) || pinnedIds.has(target)) return target;
    fail(`internal link #${target} does not resolve to any heading or pinned id`);
  };
  const ctx = { resolveAnchor, sectionTarget, refId };

  const out = [];
  const w = (s = '') => out.push(s);
  const used = new Set();
  const use = (name) => used.add(name);

  let i = 0;
  const peek = () => blocks[i];
  const next = () => blocks[i++];

  // walk state
  let section = '';          // 'intro' | 'outline' | '1'..'10' | 'appendix' | misc
  let s5 = false;            // inside "## 5. Element entries"
  let introPs = 0;           // paragraphs of the unnumbered intro
  let appendixPs = 0;        // paragraphs of Appendix A (the c-alias ornament follows the first)
  let tableQueue = [...TABLES];
  let entryQueue = [...ENTRIES];
  let lastEntry = null;      // the §5 entry a following fence belongs to
  let pendingLive = null;    // ornament key to flush before the next heading/entry
  let pendingCatalog = [];   // §2 bold-lead rule paragraphs
  let catalogOpen = false;

  const emitHeading = (b) => {
    lastEntry = null; // fences attach to the entry they immediately follow
    if (b.text === 'Element buckets' && introPs !== 3) fail(`expected 3 intro paragraphs, saw ${introPs}`);
    // the previous entry's live example flushes before any new heading
    if (pendingLive) { w(ORNAMENTS[pendingLive].trim()); use(`live:${pendingLive}`); pendingLive = null; }
    // the live-example note, the NPL catalog and the tier status close §5
    if (b.t === 'h2' && b.text.startsWith('6. ')) {
      if (entryQueue.length) fail(`${entryQueue.length} §5 entries never matched: ${entryQueue.map((e) => e.name).join(', ')}`);
      w(`  <p>Each entry that carries a live example wraps it in <code>sem-source</code>: press <em>Source</em> to see the markup of this page exactly as written. The example is the spec executing itself.</p>`);
      w('');
      w(ORNAMENTS.nplCatalog.trim()); use('ornament:p-npl-elements');
      w('');
      w(ORNAMENTS.tierStatus.trim()); use('ornament:tier-status');
      w('');
      s5 = false;
    }
    // the consumers views close §0
    if (b.t === 'h2' && b.text.startsWith('1. ')) {
      w(ORNAMENTS.consumers.trim()); use('ornament:consumers');
      w('');
    }
    // leaving §2 flushes the collected rule paragraphs
    if (b.t === 'h2' && catalogOpen) {
      w(`  <sem-properties id="${CATALOG_RULES.container}" kind="rules">`);
      w(pendingCatalog.join('\n'));
      w(`  </sem-properties>`);
      w('');
      use('rule-container:p-catalog-rules');
      pendingCatalog = []; catalogOpen = false;
    }
    const id = (b.t === 'h2' || b.t === 'h3') && b.text !== 'Outline' ? ` id="${slug(b.text)}"` : '';
    if (slug(b.text) === INVARIANT_ANCHOR) use('invariant-heading');
    w('');
    w(`  <${b.t}${id}>${esc(b.text)}</${b.t}>`);
  };

  while (i < blocks.length) {
    const b = next();

    if (/^h[123]$/.test(b.t)) {
      if (b.text === 'Outline') { section = 'outline'; continue; }
      if (b.t === 'h3') { emitHeading(b); continue; } // bucket headings keep the section
      const m = b.text.match(/^(\d+)\. /);
      section = m ? m[1] : b.text.startsWith('Appendix') ? 'appendix' : b.t === 'h1' ? 'title' : section === 'title' ? 'intro' : 'misc';
      if (m && m[1] === '5') s5 = true;
      emitHeading(b);
      if (m && m[1] === '5') { // the hand page's rough marker opens the entries region
        w(`  ${ORNAMENTS.roughMarker.trim()}`); use('ornament:rough');
        w('');
      }
      continue;
    }

    if (b.t === 'table') {
      if (!tableQueue.length || tableQueue[0].header !== b.header) {
        fail(`GFM table "${b.header}" is out of order or has no TABLES config (a dropped/reworded table is exactly the drift this generator exists to catch)`);
      }
      const cfg = tableQueue.shift();
      use(`table:${cfg.id}`);
      // rows verbatim — the GFM source text, escaped only; the e2e table
      // test compares these rows to the .md's (escapes and all)
      const body = b.rows.map((r) => esc(r)).join('\n');
      w(`  <sem-md${cfg.attrs}>`);
      w(body);
      w(`  </sem-md>`);
      w('');
      continue;
    }

    if (b.t === 'fence') {
      if (section === '1') {
        w(`  ${renderFence(b, 'c-skeleton')}`); use('fence:c-skeleton');
        w('');
        continue;
      }
      if (section === 'appendix') fail('the .md appendix carries no fences; the c-alias listing is an ornament');
      if (section === '8' && b.info === '') { // the bare invariant fence
        w(`  <p><code>${esc(b.code.trim())}</code></p>`);
        w('');
        continue;
      }
      if (section === '5') {
        if (!lastEntry) fail('a §5 fence appeared with no preceding entry');
        const fid = FENCE_OF[lastEntry.id];
        if (!fid) fail(`entry ${lastEntry.name} carries a fence but has no FENCE_OF row`);
        w(`  ${renderFence(b, fid)}`);
        use(`fence:${fid}`);
        lastEntry = null;
        continue;
      }
      fail(`unexpected fence in section ${section}`);
    }

    if (b.t === 'ul') {
      w('  <ul>');
      for (const item of b.items) w(`    <li>${renderInline(item, ctx)}</li>`);
      w('  </ul>');
      w('');
      continue;
    }

    if (b.t === 'ol') {
      if (section === 'outline') { // the reader builds the outline; verify the targets
        for (const item of b.items) for (const m of item.matchAll(/\]\(#([^)]+)\)/g)) ctx.resolveAnchor(m[1]);
        continue;
      }
      if (section === '4') {
        w(`  <sem-procedure id="degradation-rules" kind="rules" role="list" aria-label="The script and degradation rules">`);
        b.items.forEach((item, k) => w(`    <sem-step id="rule-4-${k + 1}" role="listitem">${renderInline(item, ctx)}</sem-step>`));
        w('  </sem-procedure>');
        b.items.forEach((_, k) => use(`rule-4-${k + 1}`));
        w(`  ${ORNAMENTS.nBudget.trim()}`); use('ornament:n-budget');
        w('');
        continue;
      }
      if (section === '7') {
        w(`  <sem-properties id="${DISTRIBUTION.container}" kind="distribution-forms">`);
        b.items.forEach((item, k) => {
          const n = k + 1;
          if (DISTRIBUTION.note.item === n) {
            // the note stays INSIDE the container: closing here (the #66 bug)
            // left item 5 orphaned and emitted a stray second close — the
            // committed page was malformed HTML and the editor round-trip
            // test could not parse it back to the same tree.
            w(`  <sem-note id="${DISTRIBUTION.note.id}" variant="${DISTRIBUTION.note.variant}">${renderInline(item, ctx)}</sem-note>`);
            use(`dist:${DISTRIBUTION.note.id}`);
            return;
          }
          const [id, key] = DISTRIBUTION.items[n];
          const body = item.replace(/^\*\*(.+?)\*\* -- /, '');
          w(`    <sem-property id="${id}" key="${n}. ${key}" role="definition" aria-label="${key}">${renderInline(body, ctx)}</sem-property>`);
          use(`dist:${id}`);
        });
        w('  </sem-properties>');
        w('');
        continue;
      }
      fail(`unexpected ordered list in section ${section}`);
    }

    if (b.t !== 'p') fail(`unhandled block type ${b.t}`);

    // -- paragraphs --
    if (section === 'intro' || section === 'title') { // the four intro paragraphs, with their notes
      introPs++;
      w(`  <p>${renderInline(b.text, ctx)}</p>`);
      if (introPs === 2) { w(`  ${ORNAMENTS.nDogfood.trim()}`); use('ornament:n-dogfood'); }
      if (introPs === 3) { w(`  ${ORNAMENTS.nFolderForm.trim()}`); use('ornament:n-folder-form'); }
      w('');
      continue;
    }

    if (isNormative(b.text)) {
      w(`  ${renderNormative(b.text, ctx)}`);
      w('');
      continue;
    }

    if (s5) {
      const m = b.text.match(/^\*\*(.+?)\*\* -- (.*)$/s);
      const e = m && ENTRIES.find((x) => x.name === m[1]);
      if (e) {
        if (pendingLive) { w(ORNAMENTS[pendingLive].trim()); use(`live:${pendingLive}`); pendingLive = null; }
        if (!m[2].startsWith(e.rest)) fail(`entry ${e.name}: configured h4 text is not a prefix of the .md entry text`);
        entryQueue.splice(entryQueue.indexOf(e), 1);
        use(`entry:${e.id}`);
        lastEntry = e;
        let tail = m[2].slice(e.rest.length).replace(/^\s*[;:,.]\s*/, '');
        if (/^[a-z]/.test(tail)) tail = tail[0].toUpperCase() + tail.slice(1);
        // a trailing **Normative: …** sentence becomes its own ref-linked <p>
        let normPart = null;
        const nIdx = tail.indexOf('**Normative: ');
        if (nIdx >= 0) {
          const after = tail.slice(nIdx).replace(/^\*\*Normative: (.+?)\.\*\*\s*$/s, '');
          if (after === '') { normPart = tail.slice(nIdx); tail = tail.slice(0, nIdx); }
        }
        w('');
        w(`  <h4 id="${e.id}">${esc(e.name)} -- ${renderInline(e.rest, ctx)}</h4>`);
        if (tail.trim()) w(`  <p>${renderInline(tail.trim(), ctx)}</p>`);
        if (normPart) w(`  ${renderNormative(normPart.trim(), ctx)}`);
        pendingLive = e.live || null;
        continue;
      }
    }

    if (section === '2') {
      const lead = Object.keys(CATALOG_RULES.leads).find((k) =>
        b.text.startsWith(`**${k}.**`) || b.text.startsWith(`**${k}**`));
      if (lead) {
        const prefix = b.text.startsWith(`**${lead}.**`) ? `**${lead}.**` : `**${lead}**`;
        const body = b.text.slice(prefix.length).replace(/^\s*/, '');
        pendingCatalog.push(`    <sem-property id="${CATALOG_RULES.leads[lead]}" key="${lead}" role="definition" aria-label="${lead}">${renderInline(body, ctx)}</sem-property>`);
        use(`rule:${CATALOG_RULES.leads[lead]}`);
        catalogOpen = true;
        continue;
      }
    }

    if (section === 'appendix') {
      appendixPs++;
      w(`  <p>${renderInline(b.text, ctx)}</p>`);
      if (appendixPs === 1) { w(`  ${ORNAMENTS.cAlias.trim()}`); use('ornament:c-alias'); }
      w('');
      continue;
    }

    w(`  <p>${renderInline(b.text, ctx)}</p>`);
    w('');
  }

  // ---- epilogue ----
  if (entryQueue.length) fail(`unmatched §5 entries: ${entryQueue.map((e) => e.name).join(', ')}`);
  if (tableQueue.length) fail(`unconsumed TABLES configs: ${tableQueue.map((t) => t.id).join(', ')}`);
  if (pendingCatalog.length || catalogOpen) fail('§2 rule container never flushed');
  if (pendingLive) { w(ORNAMENTS[pendingLive].trim()); use(`live:${pendingLive}`); }

  // references block: the verbatim v0.7 segment plus new entries for
  // Normative paths the old page never carried
  const missing = [...refIds].filter((id) => !ORNAMENTS.references.includes(`id="${id}"`));
  const newRefs = missing.map((id) => {
    const path = Object.keys(REFS).find((p) => REFS[p] === id) || guessRefPath(id);
    return `    <sem-reference id="${id}" role="listitem" href="${REF_BASE}${path}" cite="${path}">Schema -- ${path}.</sem-reference>`;
  });
  const refsBlock = ORNAMENTS.references.replace(/\n  <\/sem-references>/, `\n${newRefs.join('\n')}\n  </sem-references>`);
  w('');
  w(refsBlock.trimEnd()); use('ornament:references');
  w('');
  w(ORNAMENTS.foot.trim()); use('ornament:foot');
  w('');

  // ---- assemble ----
  const head = ORNAMENTS.head
    .trimStart()
    .replace(/^<!doctype html>\s*<!--[\s\S]*?-->/, `<!doctype html>\n${HEAD_COMMENT}`)
    .replace(/v0\.7/g, `v${version}`)
    .trimEnd();
  let html = head + '\n' + out.join('\n');
  html = html.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '');
  if (!html.endsWith('\n')) html += '\n';
  return { html, used, headingIds, pinnedIds, refIds, ctx, version };
}

function guessRefPath(id) {
  const base = id.replace(/^r-/, '');
  return base.startsWith('agent-kit-')
    ? `spec/schema/agent-kit/${base.replace(/^agent-kit-/, '')}.md`
    : `spec/schema/${base}.md`;
}

// The generated page's head comment (replaces the hand page's).
const HEAD_COMMENT = `<!--
  spec/conventions.html -- GENERATED from spec/conventions.md by
  scripts/gen-conventions-html.mjs. Do not hand-edit.

  Edit spec/conventions.md, run \`npm run gen:conventions\`, and commit both
  files together; \`npm run gen:conventions:check\` (CI, unit job) fails when
  this file is stale relative to the .md.

  The page carries the same rules as the .md, section for section, authored
  as a SemText document in the canonical tag form: custom elements with
  bare attributes, no sem-* classes. The attribute catalogs are sem-md
  blocks and sem-properties, the ordered rules are a sem-procedure, each
  element entry shows its markup in a sem-code listing, and several run a
  live example inside a sem-source so the reader can flip between what
  renders and what was written. The class-form alias appears only inside
  listings, in Appendix A. Where this page and the .md ever disagree, the
  .md wins -- fix the generator, not this file.

  No inline CSS, no inline JS: the theme and vocabulary stylesheets are
  linked, spec.css carries the document layout, and the one script is
  loaded from dist/ by src attribute. Served from the repo root the
  ../ paths reach themes/ and dist/; scripts/build-standalone.mjs copies
  this page to dist/spec/ with the paths rewritten, plus a .nojs.html
  variant with every script element removed.
-->`;

// ---------- post-generation checks (every failure is a drift guard) ----------
function runChecks(html, gen) {
  const problems = [];
  const noCode = html.replace(/<sem-code\b[\s\S]*?<\/sem-code>/gi, '');
  const noListings = noCode.replace(/<sem-md\b[\s\S]*?<\/sem-md>/gi, '');
  const noLive = noListings.replace(/<sem-source\b[\s\S]*?<\/sem-source>/gi, '');
  const validIds = new Set([...gen.pinnedIds, ...gen.headingIds, ...gen.refIds, ...Object.values(ALIASES)]);
  // live examples demonstrate deep links that are not page anchors
  const demoHrefs = new Set(['#sem-audience=operator', '#x-deploy/argocd']);

  if (!html.includes(`id="${INVARIANT_ANCHOR}"`)) problems.push(`the llms.txt invariant anchor ${INVARIANT_ANCHOR} is missing`);
  for (const id of gen.pinnedIds) if (!html.includes(`id="${id}"`)) problems.push(`pinned id "${id}" would go missing`);
  for (const id of gen.headingIds) if (!html.includes(`id="${id}"`)) problems.push(`markdown heading id "${id}" missing`);
  for (const m of noListings.matchAll(/href="#([^"]+)"/g)) {
    if (!demoHrefs.has(`#${m[1]}`) && !validIds.has(m[1])) problems.push(`internal link #${m[1]} does not resolve`);
  }
  // exactly one authored <table> outside the listings: the live sem-table
  // example (the tag-form test counts the same thing)
  const authoredTables = (noListings.match(/<table\b/gi) || []).length;
  if (authoredTables !== 1) problems.push(`expected exactly 1 authored <table> outside listings and live examples, found ${authoredTables}`);
  if (/class="sem-/.test(noListings)) problems.push('class="sem-… outside sem-code/sem-md listings');
  if (/<sem-[a-z-]+[^>]*\sdata-(?!sem-)/.test(noListings)) problems.push('data-<parameter> spelled on a sem-* element in the page body');
  if (/id="outline"/.test(html)) problems.push('the md outline leaked into the page (the reader builds one)');
  if (!html.includes(`Conventions v${gen.version}</title>`)) problems.push('title version mismatch');
  for (const name of [
    'ornament:n-dogfood', 'ornament:n-folder-form', 'ornament:consumers', 'ornament:n-budget',
    'ornament:rough', 'ornament:c-alias', 'ornament:p-npl-elements', 'ornament:tier-status',
    'ornament:references', 'ornament:foot',
    'invariant-heading', 'fence:c-skeleton', 'rule-container:p-catalog-rules',
    ...ENTRIES.filter((e) => e.live).map((e) => `live:${e.live}`),
    ...Object.values(CATALOG_RULES.leads).map((id) => `rule:${id}`),
    ...Object.values(DISTRIBUTION.items).map((v) => `dist:${v[0]}`), `dist:${DISTRIBUTION.note.id}`,
  ]) {
    if (!gen.used.has(name)) problems.push(`expected step never ran: ${name}`);
  }
  return problems;
}

// ---------- main ----------
function main() {
  const check = process.argv.includes('--check');
  const readIfExists = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
  let gen;
  let problems;
  try {
    gen = generate();
    problems = runChecks(gen.html, gen);
    if (!problems.length && check) {
      const disk = readIfExists(OUT_PATH);
      if (disk !== gen.html) problems = ['spec/conventions.html is stale — run `npm run gen:conventions` and commit both files'];
    }
  } catch (e) {
    console.error(`gen-conventions: ${e.message}`);
    process.exit(1);
  }
  if (problems.length) {
    for (const p of problems) console.error(`gen-conventions: ${p}`);
    process.exit(1);
  }
  if (check) {
    console.log('gen-conventions: spec/conventions.html is in sync with spec/conventions.md');
    return;
  }
  const prior = readIfExists(OUT_PATH);
  writeFileSync(OUT_PATH, gen.html);
  console.log(`gen-conventions: wrote spec/conventions.html (${gen.html.split('\n').length} lines${prior && prior !== gen.html ? ', changed' : ', unchanged'})`);
}

export { generate as generateConventionsHtml, runChecks, parseMd, renderInline, ALIASES, ENTRIES, TABLES, REFS, INVARIANT_ANCHOR, slug };
// main guard, realpathed: on macOS the ESM loader resolves import.meta.url
// through /var/folders → /private/var/folders; process.argv[1] is not resolved.
const invoked = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : '';
if (invoked && import.meta.url === invoked) main();
