// BDD spec — sem-see-also click modal · source: spec/schema/sem-see-also.md
//
// Feature: click opens the shared modal shell with a clone
//   Scenario: the dialog holds a clone of the target; the document never moves
//   Scenario: the clone carries no ids (duplicated-subtree safety)
//   Scenario: Esc closes; the backdrop goes away
//   Scenario: View all opens the target in a new tab

describe('sem-see-also modal', () => {
  it('opens a dialog with a clone of the target section', () => {
    cy.visit('/demo/component-cards.html');
    cy.get('#sa-inventory .sem-see-also-link').click();
    cy.get('.sem-see-also-modal').should('have.descendants', '.sem-see-also-modal-panel');
    cy.get('.sem-see-also-modal-panel').should('have.attr', 'role', 'dialog');
    cy.get('.sem-see-also-modal-panel').should('have.attr', 'aria-modal', 'true');
    cy.get('.sem-see-also-modal-content h2#inventory').should('not.exist'); // ids stripped
    cy.get('.sem-see-also-modal-content').should('contain', 'Inventory');
    // the original document is untouched
    cy.get('#inventory').should('exist');
    cy.get('body').type('{esc}');
    cy.get('.sem-see-also-modal').should('not.exist');
  });

  it('Escape closes and focus returns to the link', () => {
    cy.visit('/demo/component-cards.html');
    cy.get('#sa-waitlist .sem-see-also-link').click();
    cy.get('.sem-see-also-modal-panel').should('exist');
    cy.get('body').type('{esc}');
    cy.get('.sem-see-also-modal').should('not.exist');
    cy.focused().should('have.class', 'sem-see-also-link');
  });

  it('the View-all affordance targets a new tab', () => {
    cy.visit('/demo/component-cards.html');
    cy.get('#sa-waitlist .sem-see-also-view').should('have.attr', 'target', '_blank')
      .and('have.attr', 'rel', 'noopener');
    cy.get('#sa-waitlist .sem-see-also-view').should('have.attr', 'href', '#c-waitlist');
  });
});
