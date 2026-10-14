// BDD spec — sem-references / sem-reference · source: spec/schema/sem-references.md
//
// Feature: a numbered reference list; plain-anchor citations get previews
//          and backlinks whenever the bundle runs; JS-off it is a numbered list
//   Scenario: CSS numbering, authored roles, upgrade marker
//   Scenario: citing anchors get the runtime class; anchors keep navigating
//   Scenario: backlinks — one per citation, labelled, targeting the citation
//   Scenario: external link rendered for href-bearing references only
//   Scenario: preview popover on focus and hover; Esc closes; aria-describedby
//   Scenario: element form — one backlinks block, same behaviour
//   Scenario: JS-off — numbered list, no chrome, no popover

const cs = (el, pseudo) => el.ownerDocument.defaultView.getComputedStyle(el, pseudo);
const RFC = 'https://www.rfc-editor.org/rfc/rfc6749';

function assertReferences(url, marker) {
  beforeEach(() => cy.visit(url));

  it('numbers entries by CSS counter, keeps authored roles, carries the upgrade marker', () => {
    cy.get('#refs').should('have.attr', 'role', 'list');
    cy.get('#refs').should('have.attr', marker);
    cy.get('#r-rfc').should('have.attr', 'role', 'listitem');
    cy.get('#r-rfc').then(($r) => expect(cs($r[0], '::before').content).to.match(/counter\(/));
  });

  it('stamps citing anchors and leaves navigation alone', () => {
    cy.get('a[href="#r-rfc"]').should('have.length', 2).each(($a) => {
      cy.wrap($a).should('have.class', 'sem-references-ref');
    });
    cy.get('#cite-rfc-1').click();
    cy.location('hash').should('equal', '#r-rfc');
  });

  it('appends one labelled backlink per citation', () => {
    cy.get('#r-rfc > .sem-references-backlinks').should('have.length', 1);
    cy.get('#r-rfc .sem-references-backlinks a').should('have.length', 2).then(($a) => {
      expect($a[0].getAttribute('aria-label')).to.equal('Back to citation 1');
      expect($a[1].getAttribute('aria-label')).to.equal('Back to citation 2');
      expect($a[0].getAttribute('href')).to.equal('#cite-rfc-1');
      // The second citation had no authored id; the bundle gave it one.
      const target = $a[1].getAttribute('href').slice(1);
      expect(target).to.have.length.greaterThan(0);
      cy.get('#' + target).should('have.attr', 'href', '#r-rfc');
    });
    cy.get('#r-note .sem-references-backlinks a').should('have.length', 1);
  });

  it('renders an external link only for references with an href', () => {
    cy.get('#r-rfc .sem-references-link').should('have.attr', 'href', RFC);
    cy.get('#r-note .sem-references-link').should('not.exist');
  });

  it('previews the reference on focus, describes the anchor, closes on Esc', () => {
    cy.get('#cite-rfc-1').focus();
    cy.get('.sem-popover').should('be.visible').and('contain.text', 'OAuth 2.0');
    cy.get('.sem-popover').should('have.attr', 'role', 'tooltip');
    cy.get('.sem-popover').then(($p) => {
      cy.get('#cite-rfc-1').should('have.attr', 'aria-describedby', $p[0].id);
    });
    cy.get('body').type('{esc}');
    cy.get('.sem-popover').should('not.be.visible');
    cy.get('#cite-rfc-1').should('not.have.attr', 'aria-describedby');
  });

  it('previews on hover and hides on leave', () => {
    cy.get('a[href="#r-note"]').trigger('mouseenter');
    cy.get('.sem-popover').should('be.visible').and('contain.text', 'footnote');
    cy.get('a[href="#r-note"]').trigger('mouseleave');
    cy.get('.sem-popover').should('not.be.visible');
  });

  it('the preview follows its anchor through a scroll and stays in the viewport', () => {
    // Regression: focus() scrolls the anchor into view; under smooth
    // scrolling the focus event fires before the scroll lands, so a
    // one-shot placement parked the preview off-screen (CI, site.cy.js).
    cy.scrollTo('top');
    cy.get('#cite-rfc-1').focus();
    cy.get('.sem-popover').should('be.visible');
    cy.scrollTo(0, 120);
    // Retried: the scroll event that re-places the box is dispatched at the
    // next rendering opportunity, after scrollTo has already moved the rect.
    cy.get('.sem-popover').should(($p) => {
      const win = $p[0].ownerDocument.defaultView;
      const a = win.document.getElementById('cite-rfc-1').getBoundingClientRect();
      const p = $p[0].getBoundingClientRect();
      // Attached to the anchor: below it, or above it when the viewport has
      // no room below (font metrics and viewport height decide which — CI
      // renders the anchor lower than a local run does).
      const below = Math.abs(p.top - (a.bottom + 6)) <= 2;
      const above = Math.abs(p.bottom - (a.top - 6)) <= 2;
      expect(below || above, 'popover is attached to its anchor after a scroll').to.equal(true);
      // …and never under a pinned reader bar
      const bar = parseFloat(win.getComputedStyle(win.document.documentElement).getPropertyValue('--sem-reader-offset')) || 0;
      expect(p.top).to.be.at.least(bar);
      expect(p.bottom).to.be.at.most(win.innerHeight);
    });
    cy.get('.sem-popover').should('be.visible');
  });

  it('the preview never carries backlink chrome or duplicate ids', () => {
    cy.get('#cite-rfc-1').focus();
    cy.get('.sem-popover .sem-references-backlinks').should('not.exist');
    cy.get('.sem-popover [id]').should('not.exist');
  });
}

describe('sem-references', () => {
  describe('class form — /demo/reading.html', () => {
    assertReferences('/demo/reading.html', 'data-sem-upgraded');
  });

  describe('element form — /demo/reading-lit.html', () => {
    it('registers the custom element', () => {
      cy.visit('/demo/reading-lit.html');
      cy.window().then((win) => expect(win.customElements.get('sem-references')).to.exist);
    });
    assertReferences('/demo/reading-lit.html', 'data-sem-upgraded');
  });

  describe('JS-off', () => {
    ['/demo/reading.nojs.html', '/demo/reading-lit.nojs.html'].forEach((url) => {
      it(url + ' — numbered list, no chrome, target highlight still works', () => {
        cy.visit(url + '#r-rfc');
        cy.get('.sem-references-backlinks, .sem-references-link, .sem-popover, .sem-references-ref')
          .should('not.exist');
        cy.get('#r-rfc').should('be.visible').and('contain.text', 'OAuth 2.0');
        cy.get('#r-rfc').then(($r) => expect(cs($r[0], '::before').content).to.match(/counter\(/));
      });
    });
  });
});
