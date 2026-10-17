// BDD spec — sem-tag-def · source: spec/schema/sem-tag-def.md
//
// Feature: a markup-tag definition renders as a labelled card — header
//          row, description, a native attribute table, children chips —
//          and keeps the authored rows in the DOM (hidden) so extraction
//          is identical JS-on and JS-off; the class form keeps the
//          authored definition look
//   Scenario: tag form upgrades to the card — head, description, one table row per attribute
//   Scenario: the table renders name, type, requiredness, default and allowed values
//   Scenario: declared children render as chips
//   Scenario: authored rows stay in the DOM hidden with the chrome class
//   Scenario: class form keeps the authored markup (no upgrade)
//   Scenario: JS-off — the authored definition reads without the component

describe('sem-tag-def', () => {
  beforeEach(() => cy.visit('/demo/index.html'));

  it('tag form upgrades to the card — head, description, one table row per attribute', () => {
    cy.get('#d-note').should('have.attr', 'data-sem-upgraded');
    cy.get('#d-note .sem-tagdef-head .sem-tagdef-tag').should('have.text', 'sem-note');
    cy.get('#d-note .sem-tagdef-head .sem-tagdef-name').should('have.text', 'Note');
    cy.get('#d-note .sem-tagdef-head .sem-tagdef-group').should('have.text', 'annotation');
    cy.get('#d-note .sem-tagdef-desc').should('contain', 'inline annotation');
    cy.get('#d-note .sem-tagdef-table tbody tr').should('have.length', 2);
  });

  it('the table renders name, type, requiredness, default and allowed values', () => {
    const row = () => cy.get('#d-note .sem-tagdef-table tbody tr').first();
    row().find('.sem-tagdef-cell-name').should('have.text', 'variant');
    row().find('.sem-tagdef-cell-type').should('have.text', 'string');
    row().find('.sem-tagdef-cell-required').should('have.text', 'optional');
    row().find('.sem-tagdef-cell-default').should('have.text', 'tip');
    row().find('.sem-tagdef-cell-allowed').should('have.text', 'tip, warning, danger');
    row().find('.sem-tagdef-cell-desc').should('contain', 'Display variant.');
    cy.get('#d-note .sem-tagdef-table tbody tr').last()
      .find('.sem-tagdef-cell-required').should('have.text', 'required');
  });

  it('declared children render as chips', () => {
    cy.get('#d-note .sem-tagdef-child').should('have.length', 1)
      .and('have.text', 'sem-note-summary');
  });

  it('authored rows stay in the DOM hidden with the chrome class', () => {
    cy.get('#d-note sem-tag-attr').should('have.length', 2)
      .and('have.attr', 'hidden');
    cy.get('#d-note sem-tag-attr.sem-tagdef-source').should('have.length', 2);
  });

  it('class form keeps the authored markup (no upgrade)', () => {
    cy.get('#d-attr-class').should('not.have.attr', 'data-sem-upgraded');
    cy.get('#d-attr-class .sem-tag-attr').should('have.length', 2);
    cy.get('#d-attr-class').should('contain', 'Name of the attribute.');
  });

  it('JS-off — the authored definition reads without the component', () => {
    cy.visit('/demo/index.nojs.html');
    cy.get('#d-note').should('not.have.attr', 'data-sem-upgraded');
    cy.get('#d-note sem-tag-attr').should('have.length', 2).and('not.have.attr', 'hidden');
    cy.get('#d-note').should('contain', 'An inline annotation with an optional variant');
    cy.get('#d-note').should('contain', 'Display variant.');
    // the tag name itself is the CSS attr() heading
    cy.get('#d-note').invoke('attr', 'tag').should('eq', 'sem-note');
  });
});
