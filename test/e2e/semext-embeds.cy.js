// BDD spec — semext-* family B embeds · source: spec/schema/semext/*.md
//
// Feature: the nine semext-* service-backed embeds are SNAPSHOT-BACKED —
//          the authored content inside the element is the record, readable
//          JS-off; everything the components add renders as chrome inside
//          [data-sem-chrome], and the one live-reading element
//          (semext-annotate) fails soft to the authored view
//   Scenario: INVARIANT — extraction is identical with JS on and JS off (semext mints no records)
//   Scenario: authored records are visible in both states (JS-off is not a blank page)
//   Scenario: semext-docptr renders the pointer locator card
//   Scenario: semext-styleguide-theme renders swatches + the authored src preview link; the themes wrapper summarizes
//   Scenario: sig embeds render their deep links from authored parameters
//   Scenario: semext-media-prompt reports filled vs not-generated regions
//   Scenario: semext-annotate snapshot instance never fetches; live instance reads the mocked service; failing instance falls back

import { extractRecords } from '../../src/extract/records';

const ANNOTATE_V1 = 'https://annotate-srv.therobotlives.com/api/v1/threads*';
const ANNOTATE_V2 = 'https://annotate-srv.therobotlives.com/api/v2/threads*';

const LIVE_THREADS_BODY = {
  site: 'semtext-demo',
  page: '/demo/semext.html',
  threads: [
    {
      id: 't-live',
      status: 'open',
      title: 'Live from the (mocked) service',
      author: 'visitor',
      createdAt: '2026-10-18T00:00:00Z',
      anchor: { text: '§3 Cached content' },
      comments: [
        { id: 'c-live', author: 'visitor', body: 'Live bodies render as text only.', createdAt: '2026-10-18T00:00:00Z' },
      ],
    },
  ],
};

const clone = (v) => JSON.parse(JSON.stringify(v));
const extract = () => cy.document().then((doc) => clone(extractRecords(doc)));

beforeEach(() => {
  // The annotate service is mocked at the network layer — the browser never
  // leaves the test runner. v1 = healthy; v2 = the failing instance's base.
  cy.intercept('GET', ANNOTATE_V1, { statusCode: 200, body: LIVE_THREADS_BODY }).as('annotate-live');
  cy.intercept('GET', ANNOTATE_V2, { statusCode: 500, body: 'upstream exploded' }).as('annotate-fail');
});

describe('semext embeds — extraction invariant', () => {
  it('JS-off extraction deep-equals extraction on the enhanced page', () => {
    let jsOff;
    cy.visit('/demo/semext.nojs.html');
    extract().then((records) => {
      jsOff = records;
      // semext tags mint no records — nothing in the family enters extraction
      expect(jsOff.filter((r) => String(r.type || '').startsWith('semext'))).to.have.length(0);
    });
    cy.visit('/demo/semext.html');
    extract().then((jsOn) => {
      expect(jsOn).to.deep.equal(jsOff);
    });
  });

  it('every authored record reads in BOTH states; chrome exists only JS-on', () => {
    for (const jsOff of [false, true]) {
      cy.visit(jsOff ? '/demo/semext.nojs.html' : '/demo/semext.html');
      // authored records are plain content — readable regardless
      cy.contains('h2', 'Doc pointers').should('exist');
      cy.get('#media-filled pre code').should('contain', 'model: z-image-turbo');
      cy.get('#media-empty pre code').should('contain', 'aspect: 1:1');
      cy.get('#comments-snapshot article').should('contain', 'Anchor moved after the last push');
      cy.get('#comments-fallback article').should('contain', 'Snapshot fallback');
      if (jsOff) {
        // JS-off: no chrome anywhere; the nojs build strips scripts (the
        // JSON snapshots go with them — the authored prose is the record)
        cy.get('[data-sem-chrome]').should('not.exist');
        cy.get('#ptr-resolve').should('exist');
        cy.get('#media-filled ul li a').should('have.length', 2);
      } else {
        // JS-on: chrome appears under each snapshot-backed element
        cy.get('#ptr-resolve [data-sem-chrome]').should('exist');
        cy.get('#sig-latency [data-sem-chrome]').should('exist');
        cy.get('#media-filled [data-sem-chrome]').should('exist');
        cy.get('#comments-snapshot [data-sem-chrome]').should('exist');
      }
    }
  });
});

describe('semext embeds — per-element chrome', () => {
  beforeEach(() => cy.visit('/demo/semext.html'));

  it('docptr renders the pointer locator card', () => {
    cy.get('#ptr-resolve [data-sem-chrome] .semext-docptr-locator').should('have.text', 'src/data/load.ts:42');
    cy.get('#ptr-resolve [data-sem-chrome] .semext-docptr-kind').should('have.text', 'function');
    cy.get('#ptr-resolve [data-sem-chrome] .semext-docptr-snippet').should('contain', 'resolveSource');
  });

  it('styleguide theme cards render swatches + preview; the wrapper summarizes', () => {
    cy.get('#theme-mtl [data-sem-chrome] .semext-styleguide-theme-name').should('have.text', 'Minimal Tech Light');
    cy.get('#theme-mtl [data-sem-chrome] .semext-styleguide-theme-dot').should('have.length', 3);
    cy.get('#theme-mtl [data-sem-chrome] .semext-styleguide-theme-dot').first().should('have.attr', 'style', 'background: #2563eb');
    cy.get('#theme-mtl [data-sem-chrome] .semext-styleguide-theme-preview')
      .should('have.attr', 'href', 'themes/minimal-tech-light.css');
    // paper-ink has no src authored → no preview link
    cy.get('#theme-pi [data-sem-chrome] .semext-styleguide-theme-preview').should('not.exist');
    cy.get('#themes-index [data-sem-chrome] .semext-styleguide-themes-summary').should('contain', '3 themes');
  });

  it('sig embeds render their deep links from authored parameters', () => {
    cy.get('#sig-latency [data-sem-chrome] .semext-sig-link')
      .should('have.attr', 'href', 'https://apm.noizu.com/?query=service%3Dannotate-srv&range=1h&env=prod');
    cy.get('#sig-latency [data-sem-chrome] .semext-sig-table tbody tr').should('have.length', 2);
    cy.get('#sig-traces [data-sem-chrome] .semext-sig-trace[data-error="true"]').should('have.length', 1);
    cy.get('#sig-logs [data-sem-chrome] .semext-sig-logline[data-severity="error"]').should('have.length', 1);
    cy.get('#sig-probe [data-sem-chrome] .semext-sig-link')
      .should('have.attr', 'href', 'https://apm.noizu.com/?monitor=annotate-srv-threads&env=prod');
    cy.get('#sig-probe [data-sem-chrome] .semext-sig-monitor-asserts li').should('have.length', 2);
  });

  it('media-prompt reports filled vs not-generated regions', () => {
    cy.get('#media-filled').should('have.attr', 'data-semext-cache-region', 'filled');
    cy.get('#media-filled [data-sem-chrome] .semext-media-prompt-state').should('contain', '2 authored assets');
    cy.get('#media-filled ul li a').should('have.length', 2); // authored region untouched
    cy.get('#media-empty').should('have.attr', 'data-semext-cache-region', 'empty');
    cy.get('#media-empty [data-sem-chrome] .semext-media-prompt-empty').should('contain', 'Output not generated yet');
  });
});

describe('semext-annotate — snapshot, live, and fail-soft', () => {
  beforeEach(() => cy.visit('/demo/semext.html'));

  it('the snapshot instance never fetches and renders the authored threads as chrome', () => {
    cy.get('#comments-snapshot [data-sem-chrome] .semext-annotate-thread').should('have.length', 1);
    cy.get('#comments-snapshot [data-sem-chrome]').should('contain', 'Anchor moved after the last push');
    cy.get('@annotate-live.all').should('have.length', 0);
    cy.get('@annotate-fail.all').should('have.length', 0);
  });

  it('the live instance fetches the resolved threads URL once and renders the reply as chrome', () => {
    cy.get('#comments-live [data-sem-chrome]').should('contain', 'Live from the (mocked) service');
    cy.get('#comments-live').should('have.attr', 'status', 'live');
    cy.get('@annotate-live.all').should('have.length', 1);
    // untrusted live bodies render as TEXT — no markup, no links from thread data
    cy.get('#comments-live [data-sem-chrome] script').should('not.exist');
    cy.get('#comments-live [data-sem-chrome] img').should('not.exist');
    // the authored record stands untouched beside the chrome
    cy.get('#comments-live > article').should('contain', 'Authored record stands even when live succeeds');
  });

  it('the failing instance falls back to the authored view (status error, no throw)', () => {
    cy.get('#comments-fallback').should('have.attr', 'status', 'error');
    cy.get('#comments-fallback [data-sem-chrome]').should('not.exist');
    cy.get('#comments-fallback > article').should('contain', 'Snapshot fallback');
    cy.get('@annotate-fail.all').should('have.length', 1);
  });
});
