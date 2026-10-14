// BDD spec — sem-reveal · source: spec/schema/sem-reveal.md
//
// Feature: sem-reveal discloses body under a summary, native details
//          semantics once the runtime wraps it, fully visible JS-off
//   Scenario: data-summary becomes the toggle label; body hidden when collapsed
//   Scenario: clicking summary reveals body
//   Scenario: first-line summary derived when data-summary absent
//   Scenario: JS-off — body visible regardless of collapsed

describe('sem-reveal', () => {
  beforeEach(() => cy.visit('/demo/index.html'));

  it('data-summary becomes the toggle label; collapsed hides body', () => {
    cy.get('#r-storage details summary').should('contain', 'Why not localStorage?');
    cy.get('#r-storage details').should('not.have.attr', 'open');
    cy.get('#r-storage details .sem-reveal-body').should('not.be.visible');
  });

  it('clicking summary reveals body', () => {
    cy.get('#r-storage details summary').click();
    cy.get('#r-storage details .sem-reveal-body').should('be.visible');
  });

  it('first-line summary derived when data-summary absent', () => {
    cy.get('#r-derived details summary')
      .should('contain', 'Refresh tokens rotate per use');
  });

  // Marker gating — once the runtime built the <details>, its <summary>
  // carries the data-summary string; the JS-off ::before caption is
  // suppressed so the label does not read twice.
  it('JS-off ::before caption is suppressed once the details are built', () => {
    cy.get('#r-storage').should(($r) => {
      expect($r[0]).to.have.attr('data-sem-upgraded');
      const before = $r[0].ownerDocument.defaultView.getComputedStyle($r[0], '::before');
      expect(before.content).to.equal('none');
    });
  });
});
