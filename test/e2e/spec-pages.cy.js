// BDD spec — the HTML spec pages under spec/ · source: spec/*.html, built to dist/spec/
//
// Feature: every HTML spec document is itself a SemText document — it
//          carries no inline CSS or JS, links the shipped theme + vocabulary
//          and loads the shipped bundles by <script src>; it is written in
//          the canonical tag form (custom elements, bare attributes; the
//          class-form alias appears only inside listings); the vocabulary it
//          uses mounts under the one bundle; the scripts-stripped artifact
//          reads whole; and extraction is identical JS-off and JS-on
//   Scenario: the source carries no inline <style> and no inline <script> body
//   Scenario: the body is pure tag form — no class="sem-… outside sem-code / sem-md listings
//   Scenario: every linked stylesheet and script resolves (200)
//   Scenario: the reader and every used element mount under the one bundle
//   Scenario: the .nojs artifact ships no script and hides nothing
//   Scenario: INVARIANT — records are identical JS-off and JS-on, before and after interaction
//   Scenario: the page renders at 1280 and 390 without horizontal overflow (screenshots)

// The build's own helper (loops to a fixed point; throws on an unclosed
// opener), imported rather than re-implemented so the two cannot drift.
import { stripComments } from '../../scripts/standalone-lib.mjs';

const clone = (v) => JSON.parse(JSON.stringify(v));
// Records come from the SHIPPED bundle (dist/semtext.js), which the spec
// page loads itself. The .nojs artifact carries no script, so the same
// bundle is fetched and evaluated after load there — extraction never
// writes, and the upgrade marker is set by the page's own runtime, not by
// this injected copy on the nojs side.
const loadBundle = () =>
  cy.window().then((win) => {
    if (win.SemText) return;
    return cy.request({ url: '/semtext.js', encoding: 'binary' }).then((res) => {
      win.eval(res.body);
    });
  });
const records = () => loadBundle().then(() => cy.window().then((win) => clone(win.SemText.extractRecords(win.document))));

// GitHub-style slug of a Markdown heading, so the .md outline anchors and the
// HTML ids can be compared mechanically.
const slug = (h) => h.toLowerCase().replace(/[`*]/g, '').replace(/[^\p{L}\p{N} -]/gu, '').trim().replace(/ /g, '-');

const PAGES = [
  {
    url: '/spec/conventions.html',
    nojs: '/spec/conventions.nojs.html',
    name: 'conventions',
    // element → the chrome / marker that proves the runtime mounted it
    mounts: [
      ['#rd', '#rd > .sem-reader-chrome[role="region"]'],
      ['sem-source', 'sem-source > .sem-source-chrome[role="group"]'],
      ['sem-facts', 'sem-facts > .sem-facts-chrome'],
      ['sem-details[view-as="quiz"]', 'sem-details .sem-occluded'],
      ['sem-views', 'sem-views > .sem-views-tabs[role="tablist"]'],
      ['sem-reveal', 'sem-reveal > .sem-reveal-control'],
      ['sem-progress', 'sem-progress > .sem-progress-track'],
      ['sem-code', 'sem-code > .sem-code-chrome'],
      ['sem-table[controls]', 'sem-table th .sem-table-sort'],
      ['sem-references', 'sem-references .sem-references-backlinks'],
      ['sem-md', 'sem-md[data-sem-upgraded]'],
      ['sem-md#md-attributes', 'sem-md#md-attributes > .sem-md-body > table th[scope="col"]'],
      ['sem-note[collapsed]', 'sem-note[collapsed] > .sem-note-summary'],
    ],
    // zero-JS elements: present and visible in every tier
    present: ['sem-note', 'sem-audiences sem-profile', 'sem-procedure sem-step', 'sem-properties sem-property', 'sem-chronology sem-event'],
  },
];

// A <style> element or a style= attribute on a real tag both count.
const inlineStyles = (html) => {
  const h = stripComments(html);
  return (h.match(/<style[\s>]/gi) || []).length + (h.match(/<[a-z][^>]*\sstyle\s*=/gi) || []).length;
};
const inlineScripts = (html) =>
  (stripComments(html).match(/<script\b[^>]*>/gi) || []).filter((tag) => !/\bsrc\s*=/.test(tag) && !/application\/ld\+json/.test(tag)).length;
const assetUrls = (html, pageUrl) => {
  const base = new URL(pageUrl, 'http://x');
  const out = [];
  for (const m of html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi)) out.push(m[1]);
  for (const m of html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)) out.push(m[1]);
  return out.map((u) => new URL(u, base).pathname);
};

PAGES.forEach((page) => {
  describe(`spec page — ${page.name}`, () => {
    it('carries no inline <style> and no inline <script> body', () => {
      cy.request(page.url).its('body').then((html) => {
        expect(inlineStyles(html), 'inline <style> elements').to.equal(0);
        expect(inlineScripts(html), 'inline <script> bodies').to.equal(0);
        expect(html).to.match(/<link[^>]+\/semtext\.css/);
        expect(html).to.match(/<link[^>]+minimal-tech-light\.css/);
      });
    });

    it('is written in the tag form: no class="sem-… outside sem-code / sem-md listings', () => {
      cy.request(page.url).its('body').then((html) => {
        const body = stripComments(html).replace(/^[\s\S]*<body[^>]*>/i, '');
        // listings document the alias; everything else on the page is a tag
        const prose = body.replace(/<sem-code\b[\s\S]*?<\/sem-code>/gi, '').replace(/<sem-md\b[\s\S]*?<\/sem-md>/gi, '');
        expect(prose, 'class="sem-… in the page body').not.to.match(/class="sem-/);
        expect(prose, 'data-<parameter> on a vocabulary element').not.to.match(/<sem-[a-z-]+[^>]*\sdata-(?!sem-)/);
        expect(body).to.match(/<sem-enhanced-document\b/);
        expect(body).to.match(/<sem-facts id="x-facts" view-as="flashcards"/);
      });
    });

    it('authors every table as sem-md with rows identical to the normative Markdown', () => {
      cy.readFile('spec/conventions.md').then((md) => {
        cy.request(page.url).its('body').then((html) => {
          const body = stripComments(html).replace(/^[\s\S]*<body[^>]*>/i, '');
          // no hand-written <table> outside the one live sem-table example
          const tables = (body.match(/<table\b/gi) || []).length;
          expect(tables, 'authored <table> elements').to.equal(1);
          const unescape = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
          // the live §5 example inside a sem-source is a demo, not a spec table
          const spec = body.replace(/<sem-source\b[\s\S]*?<\/sem-source>/gi, '');
          const tableRows = (text) => text.split('\n').map((l) => l.trim()).filter((l) => /^\|/.test(l));
          // A Markdown table is a run of consecutive `|` lines; it is identified by
          // its header row (the first line), not by its position in the file.
          const tablesIn = (text) => {
            const out = [];
            let cur = null;
            text.split('\n').forEach((raw) => {
              const l = raw.trim();
              if (/^\|/.test(l)) { (cur = cur || []).push(l); }
              else if (cur) { out.push(cur); cur = null; }
            });
            if (cur) out.push(cur);
            return out;
          };
          // fenced listings in the .md (the sem-md example in §5) are not spec tables.
          // Arrays, in order of appearance: two tables sharing a header line stay
          // distinct, and a dropped table changes the count.
          const mdTables = tablesIn(md.replace(/```[\s\S]*?```/g, ''));
          const pageTables = [...spec.matchAll(/<sem-md\b[^>]*>([\s\S]*?)<\/sem-md>/gi)].map((m) => tableRows(unescape(m[1])));
          expect(pageTables.length, 'sem-md tables on the page = GFM tables in the .md').to.equal(mdTables.length);
          pageTables.forEach((rows, i) => {
            const want = mdTables[i];
            expect(rows[0], `table ${i + 1} header row`).to.equal(want[0]);
            // sorted ARRAYS: multiplicity preserved, order-insensitive, both directions
            expect([...rows].sort(), `rows under ${rows[0]}`).to.deep.equal([...want].sort());
          });
        });
      });
    });

    it('inlineStyles() counts a style attribute as inline CSS', () => {
      expect(inlineStyles('<p style="color:red">x</p>')).to.equal(1);
      expect(inlineStyles('<!-- <style> --><p>x</p>')).to.equal(0);
    });

    it('carries an id for every heading of the normative Markdown', () => {
      cy.readFile('spec/conventions.md').then((md) => {
        const headings = [...md.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1]).filter((h) => h !== 'Outline');
        expect(headings.length, 'markdown headings').to.be.greaterThan(12);
        cy.request(page.url).its('body').then((html) => {
          headings.forEach((h) => {
            expect(html, `heading "${h}"`).to.contain(`id="${slug(h)}"`);
          });
        });
      });
    });

    it('is shipped to dist/spec/ with rewritten asset paths and a themes copy', () => {
      cy.request(page.url).its('body').then((html) => {
        expect(html).not.to.contain('../dist/');
        expect(html).to.match(/<script[^>]* src="\.\.\/semtext\.js">/);
        expect(html).to.match(/<link rel="stylesheet" href="\.\.\/semtext\.css">/);
        expect(html).to.match(/<link rel="stylesheet" href="\.\.\/themes\/semtext-theme-minimal-tech-light\.css">/);
        // escaped examples are text, not tags: the rewrite must not touch them
        expect(html).to.contain('href="semtext/themes/semtext-theme-minimal-tech-light.css"');
      });
      cy.request('/semtext.css').its('status').should('eq', 200);
      cy.request('/themes/semtext-theme-minimal-tech-light.css').its('status').should('eq', 200);
      cy.request('/spec/spec.css').its('status').should('eq', 200);
    });

    it('every linked stylesheet and script resolves', () => {
      cy.request(page.url).its('body').then((html) => {
        const urls = assetUrls(html, page.url);
        expect(urls.length, 'linked assets').to.be.greaterThan(3);
        urls.forEach((u) => cy.request(u).its('status').should('eq', 200));
      });
    });

    it('is a SemText document whose reader and every used element mount under the one bundle', () => {
      cy.visit(page.url);
      cy.get('sem-enhanced-document[role="main"]').should('have.length', 1);
      cy.get('sem-enhanced-document > :first-child').should('match', 'sem-reader');
      cy.get('html').should('have.attr', 'data-sem-upgraded');
      page.mounts.forEach(([element, proof]) => {
        cy.get(element).should('have.length.greaterThan', 0);
        cy.get(proof).should('have.length.greaterThan', 0);
      });
      page.present.forEach((sel) => cy.get(sel).should('have.length.greaterThan', 0).and('be.visible'));
      // the outline is generated from the document headings and reaches each numbered section
      cy.get('#rd .sem-reader-toggle').click();
      cy.get('#rd nav[aria-label="Contents"] a[href="#0-model"]').should('exist');
      cy.get('#rd nav[aria-label="Contents"] a[href="#10-open-questions"]').should('exist');
      // depth 4: the element entries are in the outline
      cy.get('#rd nav[aria-label="Contents"] a[href="#e-source"]').should('exist');
    });

    it('sem-source shows the markup as written, for the example it wraps', () => {
      cy.visit(page.url);
      cy.get('#s-facts [data-act="source"]').click();
      cy.get('#s-facts > .sem-source-fence code').invoke('text').then((t) => {
        expect(t).to.contain('<sem-facts id="x-facts" view-as="flashcards"');
        expect(t).to.contain('<statement>');
        // as authored: no mirrored data-* twin, no chrome, no runtime state
        expect(t).not.to.match(/sem-facts-chrome|sem-current|data-sem-upgraded|data-view-as/);
      });
      cy.get('#s-facts [data-act="html"]').click();
      cy.get('#s-facts > .sem-source-fence').should('not.be.visible');
    });

    describe('the scripts-stripped artifact', () => {
      it('ships no script element at all', () => {
        cy.request(page.nojs).its('body').should('not.match', /<script/i);
      });

      it('hides nothing — no upgrade marker, every body, conclusion, incorrect statement, view and highlight visible', () => {
        cy.visit(page.nojs);
        cy.get('[data-sem-upgraded]').should('not.exist');
        cy.get('.sem-reader-chrome, .sem-source-chrome, .sem-source-fence, .sem-facts-chrome, .sem-views-tabs, .sem-code-chrome, .sem-table-chrome, .sem-occluded').should('not.exist');
        ['sem-note[collapsed]', 'sem-fact conclusion', 'incorrect-statement', 'sem-view', 'sem-reveal', 'highlight', 'sem-step', 'sem-property', 'sem-event', 'sem-code pre', 'sem-table table', 'sem-reference', '[audience]', 'sem-md']
          .forEach((sel) => cy.get(sel).should('have.length.greaterThan', 0).each(($el) => cy.wrap($el).should('be.visible')));
        // the source wrapper is transparent: its rendered children are in flow
        cy.get('sem-source > :not(.sem-source-chrome, .sem-source-fence, script)').each(($el) => cy.wrap($el).should('be.visible'));
        // no script mirrored anything: the bare spelling alone renders the JS-off captions
        cy.get('sem-view[name]:not([data-name])').should('have.length.greaterThan', 0);
        cy.get('sem-reveal[summary]:not([data-summary])').should('have.length.greaterThan', 0);
        cy.get('sem-note[variant="warning"]:not([data-variant])').should('have.length.greaterThan', 0);
        // data-* wins over the bare spelling when both are present, in every bare-spelling caption
        cy.get('sem-profile[label]:not([data-label])').should('have.length.greaterThan', 0);
        cy.document().then((doc) => {
          const p = doc.createElement('sem-profile');
          p.setAttribute('label', 'Bare');
          p.setAttribute('data-label', 'Data');
          doc.querySelector('sem-audiences').appendChild(p);
          expect(doc.defaultView.getComputedStyle(p, '::before').content).to.equal('"Data"');
          p.remove();
        });
      });
    });

    it('INVARIANT — extraction is identical JS-off and JS-on, before and after interaction', () => {
      let off;
      cy.visit(page.nojs);
      records().then((r) => { off = r; expect(r.length, 'records').to.be.greaterThan(20); });
      cy.visit(page.url);
      records().then((r) => expect(r, 'enhanced page').to.deep.equal(off));
      // interact: flip an example to source, switch a tab, open a reveal, sort the table
      cy.get('#s-facts [data-act="source"]').click();
      cy.get('#x-deploy .sem-views-tabs button').last().click();
      cy.get('#x-reveal .sem-reveal-control').click();
      cy.get('#x-table th .sem-table-sort').first().click();
      records().then((r) => expect(r, 'after interaction').to.deep.equal(off));
    });

    [[1280, 900, 'desktop'], [390, 844, 'phone']].forEach(([w, h, label]) => {
      it(`renders at ${w}px with no horizontal overflow (${label})`, () => {
        cy.viewport(w, h);
        cy.visit(page.url);
        cy.document().then((doc) => {
          expect(doc.documentElement.scrollWidth, 'scrollWidth').to.be.at.most(doc.documentElement.clientWidth + 1);
        });
        cy.get('#rd .sem-reader-chrome').should('be.visible');
        cy.screenshot(`spec-${page.name}-${w}`, { capture: 'fullPage' });
      });
    });
  });
});
