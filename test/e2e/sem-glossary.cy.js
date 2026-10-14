// BDD spec — sem-properties view-as="glossary" · source: spec/schema/sem-properties.md
//
// Feature: a properties block in glossary mode gives term anchors a
//          definition preview; the block is still a definition list and
//          extraction is unchanged; JS-off nothing is added or hidden
//   Scenario: glossary anchors get the runtime class; other anchors do not
//   Scenario: preview shows key and value on focus/hover, closes on Esc
//   Scenario: <dfn> renders as a term
//   Scenario: upgrade marker on the glossary block only
//   Scenario: element form — same behaviour, claimed by the component
//   Scenario: JS-off — definition list, no preview, keys via CSS

const cs = (el, pseudo) => el.ownerDocument.defaultView.getComputedStyle(el, pseudo);

function assertGlossary(url, marker) {
  beforeEach(() => cy.visit(url));

  it('marks the glossary block; the plain properties block gets no glossary treatment', () => {
    cy.get('#glossary').should('have.attr', marker);
    cy.get('#config a.sem-properties-ref').should('not.exist');
  });

  it('stamps anchors that target a glossary term; leaves other anchors alone', () => {
    cy.get('a[href="#g-jwt"]').should('have.class', 'sem-properties-ref');
    cy.get('a[href="#g-pkce"]').should('have.class', 'sem-properties-ref');
    cy.get('a[href="#p-ttl"]').should('not.have.class', 'sem-properties-ref');
    cy.get('a[href="#r-rfc"]').should('not.have.class', 'sem-properties-ref');
  });

  it('previews key and value on focus; Esc closes and clears aria-describedby', () => {
    cy.get('#term-jwt').focus();
    cy.get('.sem-popover').should('be.visible').and('contain.text', 'JWT').and('contain.text', 'self-describing');
    cy.get('.sem-popover').should('have.attr', 'role', 'tooltip');
    cy.get('.sem-popover').then(($p) => {
      cy.get('#term-jwt').should('have.attr', 'aria-describedby', $p[0].id);
    });
    cy.get('body').type('{esc}');
    cy.get('.sem-popover').should('not.be.visible');
    cy.get('#term-jwt').should('not.have.attr', 'aria-describedby');
  });

  it('previews on hover; a plain-block anchor shows nothing', () => {
    cy.get('a[href="#g-pkce"]').trigger('mouseenter');
    cy.get('.sem-popover').should('be.visible').and('contain.text', 'Proof Key');
    cy.get('a[href="#g-pkce"]').trigger('mouseleave');
    cy.get('a[href="#p-ttl"]').trigger('mouseenter');
    cy.get('.sem-popover').should('not.be.visible');
  });

  it('renders <dfn> as an upright term and the anchor still navigates', () => {
    cy.get('dfn').then(($d) => expect(cs($d[0]).fontStyle).to.equal('normal'));
    cy.get('a[href="#g-pkce"]').click();
    cy.location('hash').should('equal', '#g-pkce');
  });
}

describe('sem-properties view-as="glossary"', () => {
  describe('class form — /demo/reading.html', () => {
    assertGlossary('/demo/reading.html', 'data-sem-upgraded');
  });

  describe('element form — /demo/reading-lit.html', () => {
    it('registers the custom element', () => {
      cy.visit('/demo/reading-lit.html');
      cy.window().then((win) => expect(win.customElements.get('sem-properties')).to.exist);
    });
    assertGlossary('/demo/reading-lit.html', 'data-sem-upgraded');
  });

  describe('JS-off', () => {
    ['/demo/reading.nojs.html', '/demo/reading-lit.nojs.html'].forEach((url) => {
      it(url + ' — definition list, no preview, key via CSS', () => {
        cy.visit(url);
        cy.get('.sem-popover, .sem-properties-ref').should('not.exist');
        cy.get('#g-jwt').should('be.visible').and('contain.text', 'self-describing');
        cy.get('#g-jwt').then(($p) => expect(cs($p[0], '::before').content).to.match(/JWT|attr\(/));
      });
    });
  });
});
