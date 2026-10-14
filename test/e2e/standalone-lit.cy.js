// Standalone Lit page — proves the one-bundle handoff end to end:
// one self-contained file, the inlined IIFE, the component upgrades and
// owns the collapsed/expanded behavior. Targets the runtime contract:
// data-sem-upgraded set by the component, role="note", and the vanilla
// handlers add nothing the component already built.

describe('standalone Lit page', () => {
  beforeEach(() => {
    cy.visit('/demo/standalone-lit.html');
  });

  it('registers and upgrades sem-note (Lit ran)', () => {
    cy.window().then((win) => {
      expect(win.customElements.get('sem-note')).to.exist;
    });
    cy.get('main sem-note').should('have.attr', 'data-sem-upgraded');
  });

  it('sets role="note" and reflects variant', () => {
    cy.get('main sem-note[data-variant="warning"]').should('have.attr', 'role', 'note');
    cy.get('main sem-note[data-variant="tip"]').should('have.attr', 'data-variant', 'tip');
  });

  it('the vanilla pass adds no duplicate summary to a claimed note', () => {
    // the component claims the one marker; the core handlers skip it
    cy.get('main sem-note .sem-note-summary').should('have.length', 1);
  });

  it('collapsed note renders a summary and hides its body', () => {
    cy.get('main sem-note[data-variant="tip"] > .sem-note-summary')
      .should('exist')
      .and('contain.text', '…');
    cy.get('main sem-note[data-variant="tip"] > .sem-note-summary')
      .invoke('text')
      .should('have.length.gt', 4);
  });

  it('expands the collapsed note when the summary is clicked', () => {
    const tip = 'main sem-note[data-variant="tip"] ';
    cy.get(tip + '.sem-note-summary').click();
    cy.get(tip).should('not.have.attr', 'collapsed');
    cy.get(tip + '.sem-note-body').should('be.visible');
    cy.get(tip + '.sem-note-summary').should('not.exist');
  });
});
