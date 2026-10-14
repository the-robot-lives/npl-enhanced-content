// BDD spec — sem-table · source: spec/schema/sem-table.md
//
// Feature: an authored <table> a reader can sort and filter — one bundle,
//          identical over the class alias and the element form; JS-off it is
//          a plain table whose sticky header and column are CSS
//   Scenario: chrome first, status region, rows stamped with the source index once
//   Scenario: sort — header buttons, aria-sort cycle, numeric via data-value, stable
//   Scenario: filter — hidden on non-matching rows, "n of m rows" announced, clear restores
//   Scenario: default controls = sort only
//   Scenario: sticky header and comparison first column are CSS
//   Scenario: sort + filter never change extraction (spec/extraction.md §5 exception)
//   Scenario: element form — one chrome, same behaviour, claimed marker
//   Scenario: JS-off — no chrome, no buttons, no stamps, sticky still holds

import { extractRecords } from '../../src/extract/records';

const cs = (el) => el.ownerDocument.defaultView.getComputedStyle(el);
const clone = (v) => JSON.parse(JSON.stringify(v));
const extract = () => cy.document().then((doc) => clone(extractRecords(doc)));

const firstCells = ($rows) => Array.from($rows, (r) => r.cells[0].textContent.trim());

function assertTable(url, marker) {
  // The shipped theme scrolls smoothly under prefers-reduced-motion: no-preference;
  // cypress's actionability sampling races that animation on deep controls, so the
  // spec pins instant scrolling for its visits (product behavior is untouched).
  beforeEach(() => cy.visit(url, { onBeforeLoad(win) { win.document.documentElement.style.scrollBehavior = 'auto'; } }));

  it('carries the upgrade marker for this page', () => {
    cy.get('#t-tokens').should('have.attr', marker);
  });

  it('renders one chrome before the table with a status region; rows stamped once', () => {
    cy.get('#t-tokens > .sem-table-chrome').should('have.length', 1);
    cy.get('#t-tokens > :first-child').should('have.class', 'sem-table-chrome');
    cy.get('#t-tokens .sem-table-status').should('have.attr', 'role', 'status');
    cy.get('#t-tokens caption').should('have.text', 'Token lifetimes');
    cy.get('#t-tokens tbody tr').then(($r) => {
      expect(Array.from($r, (r) => r.getAttribute('data-sem-source-index'))).to.deep.equal(['0', '1', '2', '3']);
    });
  });

  it('headers become buttons with aria-sort; a numeric column sorts by data-value', () => {
    cy.get('#t-tokens th').should('have.length', 3);
    cy.get('#t-tokens th').each(($th) => {
      cy.wrap($th).should('have.attr', 'aria-sort', 'none');
      cy.wrap($th).find('button.sem-table-sort[type="button"]').should('have.length', 1);
    });
    cy.get('#t-tokens th').eq(1).find('button').click();
    cy.get('#t-tokens th').eq(1).should('have.attr', 'aria-sort', 'ascending');
    cy.get('#t-tokens tbody tr').then(($r) => {
      expect(firstCells($r)).to.deep.equal(['access', 'id', 'session', 'refresh']);
      // the stamp travels with the row, not with the position
      expect($r[3].getAttribute('data-sem-source-index')).to.equal('1');
    });
    cy.get('#t-tokens .sem-table-status').should('have.text', 'Sorted by Lifetime, ascending');
    cy.get('#t-tokens th').eq(1).find('button').click();
    cy.get('#t-tokens th').eq(1).should('have.attr', 'aria-sort', 'descending');
    cy.get('#t-tokens tbody tr').then(($r) => {
      expect(firstCells($r)).to.deep.equal(['refresh', 'session', 'id', 'access']);
    });
    cy.get('#t-tokens .sem-table-status').should('have.text', 'Sorted by Lifetime, descending');
  });

  it('a text column sorts locale-aware, only one header is ever active, ties keep AUTHORED order after a prior sort', () => {
    cy.get('#t-tokens th').eq(1).find('button').click();
    cy.get('#t-tokens th').eq(1).find('button').click();
    cy.get('#t-tokens th').eq(1).should('have.attr', 'aria-sort', 'descending');
    cy.get('#t-tokens th').eq(0).find('button').click();
    cy.get('#t-tokens th').eq(0).should('have.attr', 'aria-sort', 'ascending');
    cy.get('#t-tokens th').eq(1).should('have.attr', 'aria-sort', 'none');
    cy.get('#t-tokens tbody tr').then(($r) => {
      expect(firstCells($r)).to.deep.equal(['access', 'id', 'refresh', 'session']);
    });
    // Rotates has two "no" and two "yes": ties keep authored order (access, id · refresh, session)
    // even though the DOM currently holds Token order — the tie-break is the stamp, not the DOM.
    cy.get('#t-tokens th').eq(1).find('button').click();
    cy.get('#t-tokens th').eq(1).find('button').click();
    cy.get('#t-tokens tbody tr').then(($r) => expect(firstCells($r)).to.deep.equal(['refresh', 'session', 'id', 'access']));
    cy.get('#t-tokens th').eq(2).find('button').click();
    cy.get('#t-tokens tbody tr').then(($r) => {
      expect(firstCells($r)).to.deep.equal(['access', 'id', 'refresh', 'session']);
    });
  });

  it('a third activation returns to aria-sort="none" and the authored order', () => {
    cy.get('#t-tokens th').eq(1).find('button').click();
    cy.get('#t-tokens th').eq(1).find('button').click();
    cy.get('#t-tokens th').eq(1).find('button').click();
    cy.get('#t-tokens th').eq(1).should('have.attr', 'aria-sort', 'none');
    cy.get('#t-tokens tbody tr').then(($r) => expect(firstCells($r)).to.deep.equal(['access', 'refresh', 'id', 'session']));
    cy.get('#t-tokens .sem-table-status').should('have.text', '');
  });

  it('a multi-<tbody> table sorts within each body and never re-parents a row', () => {
    cy.get('#t-groups tbody').should('have.length', 2);
    cy.get('#t-groups th').eq(1).find('button').click();
    cy.get('#t-groups tbody').eq(0).find('tr').then(($r) => expect(firstCells($r)).to.deep.equal(['device', 'code']));
    cy.get('#t-groups tbody').eq(1).find('tr').then(($r) => expect(firstCells($r)).to.deep.equal(['client credentials', 'refresh']));
    cy.get('#t-groups tbody tr').then(($r) => {
      expect(Array.from($r, (r) => r.getAttribute('data-sem-source-index'))).to.deep.equal(['1', '0', '3', '2']);
    });
  });

  it('the status region composes filter and sort, without aria-live', () => {
    cy.get('#t-tokens .sem-table-status').should('not.have.attr', 'aria-live');
    cy.get('#t-tokens .sem-table-filter').type('yes');
    cy.get('#t-tokens th').eq(1).find('button').click();
    cy.get('#t-tokens .sem-table-status').should('have.text', '2 of 4 rows, sorted by Lifetime, ascending');
    cy.get('#t-tokens .sem-table-filter').clear();
    cy.get('#t-tokens .sem-table-status').should('have.text', '4 rows, sorted by Lifetime, ascending');
  });

  it('the print stylesheet shows filtered-out rows', () => {
    cy.document().then((doc) => {
      const rules = [];
      Array.from(doc.styleSheets).forEach((sheet) => {
        Array.from(sheet.cssRules).forEach((r) => {
          if (r.media && /print/.test(r.media.mediaText)) Array.from(r.cssRules).forEach((x) => rules.push(x.cssText));
        });
      });
      expect(rules.some((t) => /tr\[hidden\]/.test(t) && /table-row/.test(t))).to.equal(true);
    });
  });

  it('filter hides non-matching rows with the native attribute and announces the count', () => {
    cy.get('#t-tokens .sem-table-filter').should('have.attr', 'aria-label', 'Filter rows');
    cy.get('#t-tokens .sem-table-filter').should('have.attr', 'type', 'search');
    // The pinned sem-reader bar overlays the top of the viewport and cypress's
    // actionability check misjudges the sticky chrome as covered by it; drive
    // the filter through its real 'input' handler instead of typed keystrokes.
    cy.get('#t-tokens .sem-table-filter').invoke('val', 'YES').trigger('input');
    cy.get('#t-tokens tbody tr[hidden]').should('have.length', 2);
    cy.get('#t-tokens tbody tr:not([hidden])').then(($r) => {
      expect(firstCells($r)).to.deep.equal(['refresh', 'session']);
    });
    cy.get('#t-tokens .sem-table-status').should('have.text', '2 of 4 rows');
    cy.get('#t-tokens .sem-table-filter').invoke('val', '').trigger('input');
    cy.get('#t-tokens tbody tr[hidden]').should('have.length', 0);
    cy.get('#t-tokens .sem-table-status').should('have.text', '4 rows');
  });

  it('default controls render sort only', () => {
    cy.get('#t-compare .sem-table-filter').should('not.exist');
    cy.get('#t-compare th button.sem-table-sort').should('have.length', 3);
    cy.get('#t-compare .sem-table-status').should('exist');
  });

  it('sticky header and the comparison first column are CSS', () => {
    cy.get('#t-compare thead th').first().then(($th) => expect(cs($th[0]).position).to.equal('sticky'));
    cy.get('#t-compare tbody td').first().then(($td) => expect(cs($td[0]).position).to.equal('sticky'));
    cy.get('#t-tokens thead th').first().then(($th) => expect(cs($th[0]).position).not.to.equal('sticky'));
  });

  it('sort and filter never change extraction (§5 recorded exception)', () => {
    let before;
    extract().then((records) => { before = records; });
    cy.get('#t-tokens th').eq(1).find('button').click();
    cy.get('#t-tokens th').eq(1).find('button').click();
    cy.get('#t-tokens .sem-table-filter').type('no');
    cy.get('#t-tokens tbody tr[hidden]').should('have.length', 2);
    cy.get('#t-compare th').eq(2).find('button').click();
    extract().then((after) => {
      expect(after).to.deep.equal(before);
      const t = after.find((r) => r.id === 't-tokens');
      expect(t.fields.rows.map((row) => row[0])).to.deep.equal(['access', 'refresh', 'id', 'session']);
    });
  });
}

describe('sem-table', () => {
  describe('class form — /demo/reading.html', () => {
    assertTable('/demo/reading.html', 'data-sem-upgraded');
  });

  describe('element form — /demo/reading-lit.html', () => {
    it('registers the custom element', () => {
      cy.visit('/demo/reading-lit.html');
      cy.window().then((win) => expect(win.customElements.get('sem-table')).to.exist);
    });
    assertTable('/demo/reading-lit.html', 'data-sem-upgraded');
  });

  describe('JS-off', () => {
    ['/demo/reading.nojs.html', '/demo/reading-lit.nojs.html'].forEach((url) => {
      it(url + ' — plain table, nothing generated, sticky still holds', () => {
        cy.visit(url);
        cy.get('.sem-table-chrome, .sem-table-sort, .sem-table-status, [data-sem-source-index]').should('not.exist');
        cy.get('#t-tokens th').should('not.have.attr', 'aria-sort');
        cy.get('#t-tokens tbody tr').should('have.length', 4);
        cy.get('#t-tokens tbody tr').each(($r) => cy.wrap($r).should('be.visible'));
        cy.get('#t-compare thead th').first().then(($th) => expect(cs($th[0]).position).to.equal('sticky'));
        cy.get('#t-compare tbody td').first().then(($td) => expect(cs($td[0]).position).to.equal('sticky'));
      });
    });
  });
});
