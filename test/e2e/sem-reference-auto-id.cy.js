// BDD spec — sem-reference AUTO-ID + graduated renders · source: spec/schema/sem-references.md § Auto-id,
//            spec/schema/sem-procedure.md, sem-tldr.md, sem-summary.md
//
// Feature: id-less references get the derived id, number badge and tooltip;
//          popover + backlinks work for them; procedure / callouts render enhanced chrome
//   Scenario: derived ids are materialized and marked; an authored id wins
//   Scenario: data-ordinal badge + cite tooltip
//   Scenario: preview popover + backlinks work for an auto-id'd reference
//   Scenario: procedure progress line, blocked flag, step ordinals + aria-current
//   Scenario: tldr / summary are labelled notes
//   Scenario: JS-off — no derived ids, no chrome, authored text reads unchanged

const URL = '/demo/auto-id-renders.html';

describe('sem-reference auto-id', () => {
  beforeEach(() => cy.visit(URL));

  it('materializes derived ids (marked) and keeps the authored one', () => {
    cy.get('sem-reference').eq(0).should('have.attr', 'id', 'refs-rfc-6749').and('have.attr', 'data-sem-minted-id');
    cy.get('sem-reference').eq(1).should('have.attr', 'id', 'refs-projects-github-tools-docs-gh-wait-md');
    cy.get('sem-reference').eq(2).should('have.attr', 'id', 'r-pkce').and('not.have.attr', 'data-sem-minted-id');
  });

  it('numbers by position and titles from cite', () => {
    cy.get('sem-reference').each(($r, i) => cy.wrap($r).should('have.attr', 'data-ordinal', String(i + 1)));
    cy.get('#refs-rfc-6749').should('have.attr', 'title', 'RFC 6749');
  });

  it('previews and backlinks an auto-id reference', () => {
    cy.get('#refs-rfc-6749 .sem-references-backlinks a').should('have.length', 2);
    cy.get('#refs-rfc-6749 .sem-references-link').should('have.attr', 'href', 'https://www.rfc-editor.org/rfc/rfc6749');
    cy.get('#cite-auto-1').should('have.class', 'sem-references-ref').focus();
    cy.get('.sem-popover').should('be.visible').and('contain.text', 'OAuth 2.0');
    cy.get('body').type('{esc}');
    cy.get('.sem-popover').should('not.be.visible');
    cy.get('#cite-auto-1').click();
    cy.location('hash').should('equal', '#refs-rfc-6749');
  });
});

describe('graduated renders', () => {
  beforeEach(() => cy.visit(URL));

  it('procedure: progress line, blocked flag, ordinals, aria-current', () => {
    cy.get('#deploy > .sem-procedure-meta').should('have.length', 1).and('have.text', '1 of 4 done · 1 blocked');
    cy.get('#deploy').should('have.attr', 'data-blocked');
    cy.get('#deploy > sem-step').eq(1).should('have.attr', 'aria-current', 'step').and('have.attr', 'data-ordinal', '2');
    cy.window().then((win) => {
      const text = win.SemText.extractText(win.document);
      expect(text).not.to.contain('of 4 done');
    });
  });

  it('tldr / summary are labelled notes', () => {
    cy.get('#gist').should('have.attr', 'role', 'note').and('have.attr', 'aria-label', 'TL;DR');
    cy.get('#sum').should('have.attr', 'aria-label', 'Summary · executive');
  });
});

describe('JS-off', () => {
  it('no derived ids, no chrome; authored text unchanged', () => {
    cy.visit('/demo/auto-id-renders.nojs.html');
    cy.get('sem-reference[data-sem-minted-id], .sem-procedure-meta, .sem-references-backlinks').should('not.exist');
    cy.get('sem-reference').eq(0).should('contain.text', 'OAuth 2.0');
    cy.get('sem-reference').eq(0).should('not.have.attr', 'id');
    cy.get('#gist').should('not.have.attr', 'role');
    cy.get('#deploy > sem-step').should('have.length', 4);
  });
});
