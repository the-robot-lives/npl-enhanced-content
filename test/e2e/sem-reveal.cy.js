// BDD spec — sem-reveal · source: spec/schema/sem-reveal.md
//
// Feature: sem-reveal discloses body under a summary — hidden until the
//          reader acts; the tag form upgrades to the Lit component
//          (blur affordance, one-way reveal), the class form wraps in
//          native details closed by default; fully visible JS-off
//   Scenario: data-summary becomes the toggle label; body hidden until acted on
//   Scenario: clicking summary reveals body (class form)
//   Scenario: default is closed now — a reveal without collapsed starts hidden
//   Scenario: open starts revealed (class form)
//   Scenario: first-line summary derived when data-summary absent
//   Scenario: tag form — the component control hides the body; click reveals one-way
//   Scenario: JS-off — body visible regardless

describe('sem-reveal', () => {
  beforeEach(() => cy.visit('/demo/index.html'));

  it('data-summary becomes the toggle label; the body starts hidden', () => {
    cy.get('#r-storage details summary').should('contain', 'Why not localStorage?');
    cy.get('#r-storage details').should('not.have.attr', 'open');
    cy.get('#r-storage details .sem-reveal-body').should('not.be.visible');
  });

  it('clicking summary reveals body', () => {
    cy.get('#r-storage details summary').click();
    cy.get('#r-storage details .sem-reveal-body').should('be.visible');
  });

  it('default is closed — a reveal without collapsed starts hidden (r-derived)', () => {
    cy.get('#r-derived details').should('not.have.attr', 'open');
    cy.get('#r-derived details .sem-reveal-body').should('not.be.visible');
  });

  it('first-line summary derived when data-summary absent', () => {
    cy.get('#r-derived details summary')
      .should('contain', 'Refresh tokens rotate per use');
  });

  it('tag form: the component hides the body behind its control; click reveals one-way', () => {
    const control = '#r-component button.sem-reveal-control';
    cy.get(control).should('have.attr', 'aria-expanded', 'false');
    cy.get(control + ' .sem-reveal-label').should('have.text', 'Why session storage?');
    // hidden = inert + aria-hidden + the theme's blur clip (the box keeps
    // its layout, so Cypress visibility is the wrong assertion here)
    cy.get('#r-component .sem-reveal-body').should('have.attr', 'inert');
    cy.get('#r-component .sem-reveal-body').should('have.attr', 'aria-hidden', 'true');
    cy.get('#r-component').should('not.have.attr', 'data-revealed');
    cy.get(control).click();
    cy.get('#r-component').should('have.attr', 'data-revealed');
    cy.get('#r-component .sem-reveal-head').should('have.text', 'Why session storage?');
    cy.get('#r-component .sem-reveal-body').should('not.have.attr', 'inert');
    cy.get('#r-component .sem-reveal-body').should('not.have.attr', 'aria-hidden');
    cy.get('#r-component .sem-reveal-body').should('be.visible');
    cy.get(control).should('not.exist'); // one-way: the control retired
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
