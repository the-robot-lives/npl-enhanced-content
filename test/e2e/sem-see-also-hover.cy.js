// BDD spec — sem-see-also hover preview · source: spec/schema/sem-see-also.md
//
// Feature: the hover/focus preview (shared popover, WCAG 2.2 SC 1.4.13)
//   Scenario: hovering the link opens a popover carrying the target's summary
//   Scenario: a component target previews the card's summary
//   Scenario: preview=file shows the authored text plus the path
//   Scenario: moving away dismisses the popover

describe('sem-see-also hover preview', () => {
  it('previews a section target with its sem-tldr', () => {
    cy.visit('/demo/component-cards.html');
    cy.get('#sa-inventory .sem-see-also-link').should('exist');
    cy.get('#sa-inventory .sem-see-also-link').trigger('mouseenter');
    cy.get('.sem-popover').should('be.visible');
    cy.get('.sem-popover').should('contain', 'Inventory');
    cy.get('#sa-inventory .sem-see-also-link').trigger('mouseleave');
    // hide() marks the shared box hidden (200ms grace) — the node persists
    cy.get('.sem-popover', { timeout: 6000 }).should('not.be.visible');
  });

  it('previews a component target with the card summary', () => {
    cy.visit('/demo/component-cards.html');
    cy.get('#sa-waitlist .sem-see-also-link').trigger('mouseenter');
    cy.get('.sem-popover').should('be.visible');
    cy.get('.sem-popover').should('contain', 'Waitlist');
    cy.get('#sa-waitlist .sem-see-also-link').trigger('mouseleave');
  });

  it('preview=file shows the authored label plus the path', () => {
    cy.visit('/demo/component-cards.html');
    cy.get('#sa-file .sem-see-also-link').trigger('mouseenter');
    cy.get('.sem-popover').should('be.visible');
    cy.get('.sem-popover').should('contain', 'src/reading/see-also.ts');
    cy.get('#sa-file .sem-see-also-link').trigger('mouseleave');
  });
});
