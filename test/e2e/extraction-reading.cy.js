// BDD spec — extraction of the W1 prose elements · source: spec/extraction.md §3.1/§4/§5
//
// Feature: sem-chronology/sem-event, sem-code, sem-references/sem-reference
//          and glossary-mode sem-properties extract to stable records; the
//          reading bundle's chrome, popovers and runtime classes are
//          invisible; the central invariant holds across JS-off, view-as,
//          interaction, and BOTH authoring forms
//   Scenario: one record per authored element, in document order
//   Scenario: sem-event — when, until, status (only when authored), positional ordinal
//   Scenario: sem-code — lang, filename, expanded marks, verbatim source; normalised text
//   Scenario: sem-reference — href, cite, positional ordinal; citations mint nothing
//   Scenario: glossary properties extract exactly as plain properties
//   Scenario: chrome never leaks — backlinks, copy button, popover, status
//   Scenario: annotated text — source as an indented block; when/href lines
//   Scenario: purity
//   Scenario: INVARIANT — JS-off equals JS-on
//   Scenario: INVARIANT — identical under every view-as mode
//   Scenario: INVARIANT — copy, wrap, preview and backlink do not change output
//   Scenario: INVARIANT — element form equals class form
//   R/W2 additions (spec/schema/sem-reader.md, sem-table.md):
//   Scenario: sem-reader mints nothing — not the element, not its authored nav, not its chrome
//   Scenario: sem-table — caption, columns, rows in AUTHORED order; the inner <table kind> mints nothing
//   Scenario: annotated text — columns line and one line per row
//   Scenario: INVARIANT — sort, filter and every reader control leave output unchanged
//   Scenario: sem-source is transparent — same records in html and source mode; wrapper, chrome, fence, snapshot mint nothing
//   R/W2.2 additions (spec/schema/sem-md.md):
//   Scenario: sem-md — normalised Markdown source; normalised text; chrome, body and fence mint nothing
//   Scenario: annotated text — source as an indented block
//   Scenario: INVARIANT — rendered and raw views extract identically

import { extractRecords, extractText } from '../../src/extract/records';

const clone = (v) => JSON.parse(JSON.stringify(v));
const extract = () => cy.document().then((doc) => clone(extractRecords(doc)));
const byType = (records, type) => records.filter((r) => r.type === type);
const byId = (records, id) => records.find((r) => r.id === id);

const SOURCE =
  'export function rotate(pair: Pair): Pair {\n' +
  '  const next = mint();\n' +
  '  retire(pair.refresh);\n' +
  '  return next;\n' +
  '}';

// Document order of web/demo/reading.html (and reading-lit.html).
const EXPECTED_TYPES = [
  'sem-properties', 'sem-property', 'sem-property', 'sem-property',
  'sem-chronology', 'sem-event', 'sem-event', 'sem-event',
  'sem-chronology', 'sem-event', 'sem-event',
  'sem-note',
  'sem-code', 'sem-code',
  'sem-md', 'sem-md', 'sem-md', 'sem-md',
  'sem-references', 'sem-reference', 'sem-reference',
  'sem-properties', 'sem-property', 'sem-property',
  'sem-table', 'sem-table', 'sem-table',
  'sem-reveal', 'sem-views', 'sem-view', 'sem-view'
];

const MD_SOURCE =
  '#### Lifetimes\n' +
  '\n' +
  'Every *session* mints a **short-lived** token; see [RFC 6749](https://www.rfc-editor.org/rfc/rfc6749) and `rotate()`.\n' +
  '\n' +
  '| Token   | Lifetime | Rotates |\n' +
  '| :------ | -------: | :-----: |\n' +
  '| access  | 15 min   | no      |\n' +
  '| refresh | 30 days  | yes     |';

const ROWS = [
  ['access', '15 min', 'no'],
  ['refresh', '30 days', 'yes'],
  ['id', '1 hour', 'no'],
  ['session', '12 hours', 'yes']
];

// JS-off = the built scripts-stripped artifact (the __semJsOff kill-switch
// hook is retired with the multi-bundle days).
const visitJsOff = (url = '/demo/reading.html') =>
  cy.visit(url.replace(/\.html$/, '.nojs.html'));

const visitWithViews = (chronologyMode, propertiesMode) =>
  cy.visit('/demo/reading.html', {
    onBeforeLoad(win) {
      win.document.addEventListener('DOMContentLoaded', () => {
        win.document.querySelectorAll('.sem-chronology').forEach((el) => {
          el.setAttribute('data-view-as', chronologyMode);
        });
        win.document.querySelectorAll('.sem-properties').forEach((el) => {
          if (propertiesMode) el.setAttribute('data-view-as', propertiesMode);
          else el.removeAttribute('data-view-as');
        });
      });
    }
  });

describe('extraction — reading elements', () => {
  describe('record emission', () => {
    beforeEach(() => cy.visit('/demo/reading.html'));

    it('emits one record per authored element, in document order', () => {
      extract().then((records) => {
        expect(records.map((r) => r.type)).to.deep.equal(EXPECTED_TYPES);
        records.forEach((r, i) => expect(r.sourceOrder).to.equal(i));
      });
    });

    it('inline citations and glossary anchors mint nothing', () => {
      extract().then((records) => {
        expect(records.some((r) => r.type === 'a')).to.equal(false);
      });
    });
  });

  describe('field mapping', () => {
    beforeEach(() => cy.visit('/demo/reading.html'));

    it('sem-event: when, until, ordinal; status only when authored', () => {
      extract().then((records) => {
        const events = byType(records, 'sem-event').slice(0, 3);
        expect(events.map((e) => e.fields.when)).to.deep.equal(['2026-03-02', '2026-06', '2026-Q4']);
        expect(events.map((e) => e.fields.until)).to.deep.equal(['', '2026-08', '']);
        expect(events.map((e) => e.fields.ordinal)).to.deep.equal([1, 2, 3]);
        expect(events[0].fields.status).to.equal('done');
        expect(events[1].fields.status).to.equal('current');
        expect(events[2].fields).not.to.have.property('status');
        expect(events[0].text).to.equal('2 Mar 2026 v0.1 tagged — fallback tier ships.');
        expect(records[events[0].parent].type).to.equal('sem-chronology');
        expect(records[events[0].parent].kind).to.equal('release-history');
      });
    });

    it('sem-code: lang, filename, expanded marks, verbatim source, normalised text', () => {
      extract().then((records) => {
        const code = byId(records, 'c-rotate');
        expect(code.fields.lang).to.equal('ts');
        expect(code.fields.filename).to.equal('src/rotate.ts');
        expect(code.fields.marks).to.deep.equal([2, 4, 5]);
        expect(code.fields.source).to.equal(SOURCE);
        expect(code.text).to.equal(SOURCE.replace(/\s+/g, ' ').trim());
        const long = byId(records, 'c-long');
        expect(long.fields.filename).to.equal('');
        expect(long.fields.marks).to.deep.equal([]);
      });
    });

    it('sem-md: normalised source, normalised text; chrome, body and fence mint nothing', () => {
      extract().then((records) => {
        const md = byId(records, 'm-table');
        expect(md.type).to.equal('sem-md');
        expect(md.fields).to.deep.equal({ source: MD_SOURCE });
        expect(md.text).to.equal(MD_SOURCE.replace(/\s+/g, ' ').trim());
        const raw = byId(records, 'm-raw');
        expect(raw.fields.source).to.match(/^- first item\n- second item\n  - nested item\n/);
        expect(raw.fields.source).to.match(/```sh\ncurl -sS "\$TOKEN_ENDPOINT"\n```$/);
        const inject = byId(records, 'm-inject');
        expect(inject.fields.source).to.match(/^<script>alert\(1\)<\/script> and \[click\]\(javascript:alert\(1\)\) and <img src=x onerror=alert\(1\)>\n\n\[tab\]\(<java\tscript:alert\(1\)>\) \[ctl\]\(<\u0001javascript/);
        expect(byId(records, 'm-edge').fields.source).to.match(/^Setext\n------\n\n- one\n/);
        expect(byId(records, 'm-edge').fields.source).to.match(/\n\na \| b\n---$/);
        // the rendered table, the fence's sem-code and the chrome are all invisible
        expect(records.filter((r) => r.parent === md.sourceOrder)).to.have.length(0);
        expect(records.filter((r) => r.type === 'sem-code')).to.have.length(2);
        expect(records.some((r) => r.type === 'table' || r.type === 'h4')).to.equal(false);
      });
    });

    it('sem-reference: href, cite, ordinal; the container is a container', () => {
      extract().then((records) => {
        const refs = byType(records, 'sem-reference');
        expect(refs[0].fields).to.deep.equal({
          href: 'https://www.rfc-editor.org/rfc/rfc6749', cite: 'RFC 6749', ordinal: 1
        });
        expect(refs[0].text).to.equal('The OAuth 2.0 Authorization Framework, §10.4.');
        expect(refs[1].fields).to.deep.equal({ href: '', cite: '', ordinal: 2 });
        const container = records[refs[0].parent];
        expect(container.type).to.equal('sem-references');
        expect(container.kind).to.equal('bibliography');
        expect(container.fields).to.deep.equal({});
      });
    });

    it('glossary properties extract as plain properties', () => {
      extract().then((records) => {
        const jwt = byId(records, 'g-jwt');
        expect(jwt.type).to.equal('sem-property');
        expect(jwt.fields.key).to.equal('JWT');
        expect(jwt.fields.value).to.contain('self-describing');
        expect(records[jwt.parent].fields).to.deep.equal({});
        expect(records[jwt.parent]).not.to.have.property('view');
      });
    });

    it('sem-reader mints nothing: no record for the element, its nav, or its chrome', () => {
      extract().then((records) => {
        expect(records.some((r) => r.type === 'sem-reader' || r.type === 'nav' || r.type === 'button')).to.equal(false);
        expect(JSON.stringify(records)).not.to.match(/Reading controls|Contents|Everyone/);
      });
    });

    it('sem-table: caption, columns, rows in authored order; kind from the wrapper only', () => {
      extract().then((records) => {
        const t = byId(records, 't-tokens');
        expect(t.type).to.equal('sem-table');
        expect(t.kind).to.equal('lifetimes');
        expect(t.fields).to.deep.equal({ caption: 'Token lifetimes', columns: ['Token', 'Lifetime', 'Rotates'], rows: ROWS });
        expect(t.text).to.equal('Token lifetimes');
        const c = byId(records, 't-compare');
        expect(c.fields.caption).to.equal('');
        expect(c.fields.columns).to.deep.equal(['Concern', 'Rotation', 'Static refresh token']);
        expect(c.fields.rows).to.have.length(3);
        expect(c.text).to.equal('');
        // multi-<tbody>: rows in authored order across bodies; only the first header row names columns
        const g = byId(records, 't-groups');
        expect(g.fields.columns).to.deep.equal(['Grant', 'Lifetime']);
        expect(g.fields.rows.map((row) => row[0])).to.deep.equal(['code', 'device', 'refresh', 'client credentials']);
        // the inner <table data-kind="comparison"> is the wrapper's contract, not a second record
        expect(records.some((r) => r.type === 'table')).to.equal(false);
        expect(records.filter((r) => r.parent === t.sourceOrder)).to.have.length(0);
      });
    });

    it('chrome never leaks into a record', () => {
      // Trigger every piece of chrome first.
      cy.get('#cite-rfc-1').focus();
      cy.get('#c-rotate [data-act="copy"]').click();
      extract().then((records) => {
        const rfc = byId(records, 'r-rfc');
        expect(rfc.text).not.to.match(/Back to citation|↩|↗/);
        const code = byId(records, 'c-rotate');
        expect(code.text).not.to.match(/Copy|Wrap|Copied/);
        expect(code.fields.source).to.equal(SOURCE);
      });
    });
  });

  describe('annotated plain text', () => {
    beforeEach(() => cy.visit('/demo/reading.html'));

    it('renders source as an indented block and the reading fields as lines', () => {
      cy.document().then((doc) => {
        const text = extractText(doc);
        expect(text).to.contain('sem-code (#c-rotate)');
        expect(text).to.contain('  lang: ts');
        expect(text).to.contain('  filename: src/rotate.ts');
        expect(text).to.contain('    export function rotate(pair: Pair): Pair {');
        expect(text).to.contain('      const next = mint();');
        expect(text).to.contain('  sem-reference (#r-rfc): The OAuth 2.0');
        expect(text).to.contain('    href: https://www.rfc-editor.org/rfc/rfc6749');
        expect(text).to.contain('    cite: RFC 6749');
        expect(text).to.contain('    when: 2026-03-02');
        expect(text).to.contain('    status: current');
        expect(text).not.to.contain('Copied');
        expect(text).to.contain('sem-table (#t-tokens kind=lifetimes): Token lifetimes');
        expect(text).to.contain('  columns: Token | Lifetime | Rotates');
        expect(text).to.contain('    access | 15 min | no');
        expect(text).to.contain('    session | 12 hours | yes');
        expect(text).not.to.match(/Sorted by|Filter rows|Reading controls/);
        expect(text).to.contain('sem-md (#m-table)\n  source:\n    #### Lifetimes');
        expect(text).to.contain('    | :------ | -------: | :-----: |');
        expect(text).not.to.match(/sem-md \(#m-table\): /);
        expect(text).not.to.contain('Copy Markdown');
      });
    });
  });

  describe('purity', () => {
    it('extraction does not mutate the DOM', () => {
      cy.visit('/demo/reading.html');
      cy.document().then((doc) => {
        const before = doc.body.innerHTML;
        extractRecords(doc);
        extractText(doc);
        expect(doc.body.innerHTML).to.equal(before);
      });
    });
  });

  describe('THE CENTRAL INVARIANT (spec/extraction.md §5)', () => {
    it('JS-off extraction deep-equals extraction on the enhanced page', () => {
      let jsOff;
      visitJsOff();
      cy.get('.sem-code-chrome').should('not.exist');
      extract().then((records) => {
        jsOff = records;
        expect(jsOff).to.have.length(EXPECTED_TYPES.length);
      });
      cy.visit('/demo/reading.html');
      cy.get('.sem-code-chrome').should('exist');
      extract().then((jsOn) => expect(jsOn).to.deep.equal(jsOff));
    });

    it('extraction is identical under every view-as mode', () => {
      let baseline;
      visitJsOff();
      extract().then((records) => { baseline = records; });
      [['timeline', 'glossary'], ['list', 'glossary'], ['timeline', null], ['list', null]].forEach(
        ([chron, props]) => {
          visitWithViews(chron, props);
          cy.get('.sem-chronology').first().should('have.attr', 'data-view-as', chron);
          extract().then((records) => {
            expect(records, 'view-as=' + chron + '/' + props).to.deep.equal(baseline);
          });
        }
      );
    });

    it('copy, wrap, preview and backlink navigation do not change output', () => {
      let before;
      cy.visit('/demo/reading.html', {
        onBeforeLoad(win) { cy.stub(win.navigator.clipboard, 'writeText').resolves(); }
      });
      extract().then((records) => { before = records; });
      cy.get('#c-rotate [data-act="copy"]').click();
      cy.get('#c-rotate .sem-code-status').should('have.text', 'Copied');
      cy.get('#c-rotate [data-act="wrap"]').click();
      cy.get('#cite-rfc-1').focus();
      cy.get('.sem-popover').should('be.visible');
      cy.get('#term-jwt').focus();
      cy.get('#cite-rfc-1').click();
      cy.get('#r-rfc .sem-references-backlinks a').first().click();
      extract().then((after) => expect(after).to.deep.equal(before));
    });

    it('sem-source is transparent: identical records in html and source mode, nothing minted', () => {
      let before;
      cy.visit('/demo/reading.html');
      extract().then((r) => { before = r; });
      cy.get('#s-code > template.sem-source-raw').should('exist');
      cy.get('#s-code [data-act="source"]').click();
      cy.get('#s-code .sem-source-fence .sem-code').should('exist');
      extract().then((after) => {
        expect(after).to.deep.equal(before);
        expect(after.some((r) => r.type === 'sem-source' || r.type === 'div' || r.type === 'script')).to.equal(false);
        // exactly the two authored listings — the fence's sem-code is not a third
        expect(after.filter((r) => r.type === 'sem-code')).to.have.length(2);
      });
      cy.get('#s-code [data-act="html"]').click();
      extract().then((back) => expect(back).to.deep.equal(before));
    });

    it('sem-md extracts identically in rendered and raw view, JS-off and JS-on', () => {
      let jsOff;
      let jsOffSource;
      visitJsOff();
      cy.get('.sem-md-chrome').should('not.exist');
      extract().then((r) => { jsOff = r; jsOffSource = byId(r, 'm-edge').fields.source; });
      cy.visit('/demo/reading.html', {
        onBeforeLoad(win) { cy.stub(win.navigator.clipboard, 'writeText').resolves(); }
      });
      cy.get('#m-table > .sem-md-chrome').should('exist');
      extract().then((rendered) => {
        expect(rendered).to.deep.equal(jsOff);
        // the same document, the same string: read from the fence now, from the text before
        expect(byId(rendered, 'm-edge').fields.source).to.equal(jsOffSource);
      });
      cy.get('#m-table [data-act="toggle"]').click();
      cy.get('#m-table').should('have.attr', 'data-view-as', 'raw');
      cy.get('#m-table .sem-md-raw .sem-code-line').should('exist');
      cy.get('#m-table > .sem-md-chrome [data-act="copy"]').click();
      cy.get('#m-table .sem-md-status').should('have.text', 'Copied');
      cy.get('#m-raw [data-act="toggle"]').click();
      extract().then((raw) => expect(raw).to.deep.equal(jsOff));
    });

    it('table sort + filter and every reader control leave output unchanged', () => {
      let before;
      cy.visit('/demo/reading.html', { onBeforeLoad(win) { cy.stub(win, 'print'); } });
      extract().then((records) => { before = records; });
      cy.get('#t-tokens th').eq(1).find('button').click();
      cy.get('#t-tokens th').eq(0).find('button').click();
      cy.get('#t-tokens th').eq(0).find('button').click();
      cy.get('#t-tokens th').eq(0).should('have.attr', 'aria-sort', 'descending');
      cy.get('#t-tokens .sem-table-filter').type('yes');
      cy.get('#t-tokens tbody tr[hidden]').should('have.length', 2);
      cy.get('#rd .sem-reader-toggle').click();
      cy.get('#rd [data-act="focus"]').click();
      cy.get('#rd [data-act="type-up"]').click();
      cy.get('#rd [data-act="font"]').click();
      cy.get('#rd .sem-reader-color').select('dark');
      cy.get('#rd .sem-reader-audience').select('ops');
      cy.get('#ops-only').should('be.visible');
      cy.get('#rd [data-act="print"]').click();
      cy.get('html').should('have.attr', 'data-sem-mode', 'focus');
      extract().then((after) => expect(after).to.deep.equal(before));
      // the DOM really was reordered (Token descending) — extraction restored the authored order
      cy.get('#t-tokens tbody tr').first().then(($r) => expect($r[0].cells[0].textContent).to.equal('session'));
    });

    it('element form extracts identically to class form', () => {
      let classForm;
      cy.visit('/demo/reading.html');
      extract().then((records) => { classForm = records; });
      cy.visit('/demo/reading-lit.html');
      cy.get('sem-code[data-sem-upgraded]').should('exist');
      extract().then((elementForm) => expect(elementForm).to.deep.equal(classForm));
      let jsOn;
      cy.document().then((doc) => { jsOn = extractText(doc); });
      visitJsOff('/demo/reading-lit.html');
      cy.document().then((doc) => expect(extractText(doc)).to.equal(jsOn));
    });
  });
});
