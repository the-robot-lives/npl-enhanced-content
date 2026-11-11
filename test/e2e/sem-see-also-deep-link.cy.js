// BDD spec — sem-see-also deep link · source: spec/schema/sem-see-also.md
//
// Feature: `#ref=<see-also-id>` opens the named see-also's modal on load
//   Scenario: the modal opens without a click
//   Scenario: the same hash on a fresh load re-opens it (once per page load)
//   Scenario: a ref naming a non-see-also id opens nothing

describe('sem-see-also deep link (#ref=)', () => {
  it('opens the named see-also modal on load', () => {
    cy.visit('/demo/component-cards.html#ref=sa-waitlist');
    cy.get('.sem-see-also-modal-panel').should('have.attr', 'role', 'dialog');
    cy.get('.sem-see-also-modal-content').should('contain', 'Lightweight waitlist form');
  });

  it('a fresh load re-opens from the same hash', () => {
    cy.visit('/demo/component-cards.html#ref=sa-waitlist');
    cy.get('.sem-see-also-modal-panel').should('exist');
    cy.get('.sem-see-also-modal-close').click();
    cy.get('.sem-see-also-modal-backdrop').should('not.exist');
    // same-document revisit of the hash does NOT re-open (once-per-load latch)
    cy.window().then((w) => { w.location.hash = '#ref=sa-waitlist'; });
    cy.get('.sem-see-also-modal-backdrop').should('not.exist');
  });

  it('ignores a ref that names a non-see-also element', () => {
    cy.visit('/demo/component-cards.html#ref=inventory');
    cy.get('.sem-see-also-modal-backdrop').should('not.exist');
  });
});
