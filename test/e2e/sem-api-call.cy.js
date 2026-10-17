// BDD spec — sem-api-call · source: spec/schema/sem-api-call.md
//
// Feature: an API-call definition renders as a labelled card — a
//          `METHOD endpoint` header, the description, and one native
//          table per non-empty `in` group in query, header, body,
//          response order — while the authored param rows stay in the
//          DOM (hidden) for extraction parity; the class form keeps the
//          authored definition look
//   Scenario: tag form upgrades to the card — method chip, endpoint, name, status
//   Scenario: parameters group by in in query, header, body, response order
//   Scenario: table rows carry name, type, requiredness, default and allowed values
//   Scenario: authored rows stay in the DOM hidden with the chrome class
//   Scenario: JS-off — the authored definition reads without the component

describe('sem-api-call', () => {
  beforeEach(() => cy.visit('/demo/index.html'));

  it('tag form upgrades to the card — method chip, endpoint, name, status', () => {
    cy.get('#a-token').should('have.attr', 'data-sem-upgraded');
    cy.get('#a-token .sem-apicall-head .sem-apicall-method').should('have.text', 'POST');
    cy.get('#a-token .sem-apicall-head .sem-apicall-endpoint').should('have.text', '/oauth/token');
    cy.get('#a-token .sem-apicall-head .sem-apicall-name').should('have.text', 'Create token');
    cy.get('#a-token .sem-apicall-head .sem-apicall-status').should('have.text', '200');
    cy.get('#a-token .sem-apicall-desc').should('contain', 'Exchanges a grant for a token pair.');
  });

  it('parameters group by in in query, header, body, response order', () => {
    // the fixture carries body and response rows only — body tables before response
    const labels = [];
    cy.get('#a-token .sem-apicall-group-label').each(($l) => labels.push($l.text()))
      .then(() => expect(labels).to.deep.equal(['body', 'response']));
    cy.get('#a-token .sem-apicall-group-body tbody tr').should('have.length', 2);
    cy.get('#a-token .sem-apicall-group-response tbody tr').should('have.length', 1);
  });

  it('table rows carry name, type, requiredness, default and allowed values', () => {
    const row = () => cy.get('#a-token .sem-apicall-group-body tbody tr').first();
    row().find('.sem-apicall-cell-name').should('have.text', 'grant_type');
    row().find('.sem-apicall-cell-type').should('have.text', 'string');
    row().find('.sem-apicall-cell-required').should('have.text', 'required');
    row().find('.sem-apicall-cell-allowed').should('have.text', 'authorization_code, refresh_token');
    row().find('.sem-apicall-cell-desc').should('contain', 'The grant to exchange.');
  });

  it('authored rows stay in the DOM hidden with the chrome class', () => {
    cy.get('#a-token sem-api-param').should('have.length', 3).and('have.attr', 'hidden');
    cy.get('#a-token sem-api-param.sem-apicall-source').should('have.length', 3);
  });

  it('JS-off — the authored definition reads without the component', () => {
    cy.visit('/demo/index.nojs.html');
    cy.get('#a-token').should('not.have.attr', 'data-sem-upgraded');
    cy.get('#a-token sem-api-param').should('have.length', 3).and('not.have.attr', 'hidden');
    cy.get('#a-token').should('contain', 'Exchanges a grant for a token pair.');
    cy.get('#a-token').should('contain', 'The grant to exchange.');
    // method + endpoint ride the container attributes for the attr() heading
    cy.get('#a-token').invoke('attr', 'method').should('eq', 'POST');
    cy.get('#a-token').invoke('attr', 'endpoint').should('eq', '/oauth/token');
  });
});
