// BDD spec — sem-progress · source: spec/schema/sem-progress.md
//
// Feature: sem-progress renders a meter from data-value (0..1) with an
//          accessible text alternative, pre-set roles JS-off
//   Scenario: fill width and percentage text follow data-value
//   Scenario: label renders with the percentage
//   Scenario: out-of-range value clamps in render, raw attr untouched
//   Scenario: meter roles authored for AT without JS

describe('sem-progress', () => {
  beforeEach(() => cy.visit('/demo/index.html'));

  it('fill width and percentage text follow data-value', () => {
    cy.get('#p-coverage .sem-progress-fill').should(($el) => {
      const w = parseFloat($el.css('width'));
      expect(w).to.be.greaterThan(0);
    });
    cy.get('#p-coverage').should('contain', '62%');
  });

  it('label renders with the percentage', () => {
    cy.get('#p-coverage').should('contain', 'coverage');
  });

  it('out-of-range value clamps in render, raw attr untouched', () => {
    cy.get('#p-clamp').should('have.attr', 'data-value', '1.4');
    cy.get('#p-clamp .sem-progress-fill')
      .invoke('css', 'width').then((w) => {
        const track = Cypress.$('#p-clamp .sem-progress-track')[0];
        expect(parseFloat(w)).to.be.at.most(track.getBoundingClientRect().width + 0.5);
      });
    cy.get('#p-clamp').should('contain', '100%');
  });

  it('meter roles authored for AT without JS', () => {
    cy.get('#p-coverage')
      .should('have.attr', 'role', 'meter')
      .and('have.attr', 'aria-valuenow', '0.62')
      .and('have.attr', 'aria-valuemax', '1');
  });

  // US-601 gating — the JS-off attr() caption must not stack on top of the
  // rendered text once the runtime drives the element (no duplicate text).
  it('JS-off attr() caption is suppressed when the runtime drives', () => {
    cy.get('#p-coverage').should(($p) => {
      expect($p[0]).to.have.attr('data-sem-upgraded');
      const before = $p[0].ownerDocument.defaultView.getComputedStyle($p[0], '::before');
      expect(before.content).to.equal('none');
    });
  });
});
