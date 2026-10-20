// BDD spec — sem-component · source: spec/schema/sem-component.md
//
// Feature: the component-inventory card
//   Scenario: head chrome (tag, name, status) before the authored description
//   Scenario: meta chrome (type, source, labels) after it
//   Scenario: the card is named for AT (role=article + aria-label)
//   Scenario: extraction keeps the authored description (chrome outside textContent)

describe('sem-component', () => {
  it('renders head chrome before the authored description', () => {
    cy.visit('/demo/component-cards.html');
    cy.get('#c-waitlist .sem-component-head').should('exist');
    cy.get('#c-waitlist .sem-component-head').children().first().should('have.text', 'noizu-waitlist');
    cy.get('#c-waitlist .sem-component-status').should('have.text', 'live').and('have.attr', 'data-status', 'live');
    // authored children sit between head and meta, untouched
    cy.get('#c-waitlist .sem-component-head').next().should('contain', 'Lightweight waitlist form');
  });

  it('renders meta chrome with type, source and labels', () => {
    cy.visit('/demo/component-cards.html');
    cy.get('#c-waitlist .sem-component-meta .sem-component-type').should('have.text', 'web-component');
    cy.get('#c-waitlist .sem-component-meta .sem-component-source').should('have.text', 'src/components/waitlist/noizu-waitlist.ts');
    cy.get('#c-waitlist .sem-component-labels li').should('have.length', 2);
  });

  it('names the card for assistive tech', () => {
    cy.visit('/demo/component-cards.html');
    cy.get('#c-waitlist').should('have.attr', 'role', 'article');
    cy.get('#c-waitlist').should('have.attr', 'aria-label', 'Waitlist component card');
    cy.get('#c-waitlist').should('have.attr', 'data-sem-component-tag', 'noizu-waitlist');
  });

  it('leaves the authored description as the extracted record', () => {
    cy.visit('/demo/component-cards.html');
    cy.get('#c-waitlist .sem-component-head, #c-waitlist .sem-component-meta').invoke('text').then((chrome) => {
      cy.get('#c-waitlist').invoke('text').then((all) => {
        expect(all).to.contain('Lightweight waitlist form');
        // the chrome text is separate DOM, not interleaved into the record
        expect(all.indexOf('Lightweight waitlist form')).to.be.greaterThan(chrome.indexOf('noizu-waitlist'));
      });
    });
  });
});
