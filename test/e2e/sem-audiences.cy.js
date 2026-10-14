// BDD spec — sem-audiences / audience qualifier · source: spec/schema/sem-audiences.md
//
// Feature: a document declares reader profiles; content carries an audience
//          spec; the fallback hides what is not for the active profile via
//          the native `hidden` attribute; JS-off shows everything; extraction
//          carries the spec verbatim and never suppresses a record
//   Scenario: no active profile — positive spec hidden, negated spec visible
//   Scenario: hash parameter selects the profile and reflects onto <html>
//   Scenario: implied profiles satisfy the spec
//   Scenario: hashchange re-applies without a reload
//   Scenario: coexists with the sem-views deep link in one hash
//   Scenario: profile block renders as readable metadata
//   Scenario: JS-off — every audience-qualified element visible
//   Scenario: extraction — audience verbatim, declarations mint nothing
//   Scenario: INVARIANT — extraction identical with and without a profile

import { extractRecords } from '../../src/extract/records';

const clone = (v) => JSON.parse(JSON.stringify(v));

describe('sem-audiences', () => {
  describe('class baseline (web/demo/index.html)', () => {
    it('no active profile: positive spec hidden, negated spec visible', () => {
      cy.visit('/demo/index.html');
      cy.get('#n-op').should('not.be.visible').and('have.attr', 'hidden');
      cy.get('#n-reader').should('have.attr', 'hidden');
      cy.get('#n-public').should('be.visible').and('not.have.attr', 'hidden');
      cy.get('html').should('not.have.attr', 'data-audience');
    });

    it('hash parameter selects the profile and reflects it onto <html>', () => {
      cy.visit('/demo/index.html#sem-audience=operator');
      cy.get('html').should('have.attr', 'data-audience', 'operator');
      cy.get('#n-op').should('be.visible').and('not.have.attr', 'hidden');
      cy.get('#n-public').should('have.attr', 'hidden');
    });

    it('implied profiles satisfy the spec (operator implies reader)', () => {
      cy.visit('/demo/index.html#sem-audience=operator');
      cy.get('#n-reader').should('be.visible');
      cy.visit('/demo/index.html#sem-audience=reader');
      cy.get('#n-reader').should('be.visible');
      cy.get('#n-op').should('have.attr', 'hidden');
      cy.get('#n-public').should('be.visible');
    });

    it('re-applies on hashchange without a reload', () => {
      cy.visit('/demo/index.html');
      cy.get('#n-op').should('have.attr', 'hidden');
      cy.window().then((win) => { win.location.hash = '#sem-audience=operator'; });
      cy.get('#n-op').should('not.have.attr', 'hidden');
      cy.get('html').should('have.attr', 'data-audience', 'operator');
      cy.window().then((win) => { win.location.hash = '#'; });
      cy.get('#n-op').should('have.attr', 'hidden');
      cy.get('html').should('not.have.attr', 'data-audience');
    });

    it('coexists with the sem-views deep link in one hash', () => {
      cy.visit('/demo/index.html#deploy/argocd&sem-audience=operator');
      cy.get('#deploy .sem-view[data-name="ArgoCD"]').should('be.visible');
      cy.get('#n-op').should('be.visible');
      // Switching tabs rewrites only the views segment.
      cy.get('#deploy .sem-views-tabs button').contains('Helm').click();
      cy.location('hash').should('eq', '#deploy/helm&sem-audience=operator');
      cy.get('#n-op').should('be.visible');
    });

    it('renders the profile block as readable metadata', () => {
      cy.visit('/demo/index.html');
      cy.get('.sem-audiences .sem-profile').should('have.length', 2).each(($p) => {
        cy.wrap($p).should('be.visible');
      });
    });
  });

  describe('JS-off (dist/demo/index.nojs.html)', () => {
    it('shows every audience-qualified element, whatever the hash says', () => {
      cy.visit('/demo/index.nojs.html#sem-audience=operator');
      cy.get('#n-op, #n-public, #n-reader').should('have.length', 3).each(($n) => {
        cy.wrap($n).should('be.visible').and('not.have.attr', 'hidden');
      });
      cy.get('html').should('not.have.attr', 'data-audience');
    });
  });

  describe('extraction (spec/extraction.md §7)', () => {
    it('carries audience verbatim; declarations mint nothing; hidden never suppresses', () => {
      cy.visit('/demo/index.html');
      cy.get('#n-op').should('have.attr', 'hidden');
      cy.document().then((doc) => {
        const records = clone(extractRecords(doc));
        const byId = (id) => records.find((r) => r.id === id);
        expect(byId('n-op').audience).to.equal('operator');
        expect(byId('n-public').audience).to.equal('!operator');
        expect(byId('n-reader').audience).to.equal('reader');
        expect(byId('f-jwt').audience).to.equal(null);
        expect(records.some((r) => r.type === 'sem-audiences' || r.type === 'sem-profile'))
          .to.equal(false);
      });
    });

    it('is identical with the profile selected and unselected', () => {
      let baseline;
      cy.visit('/demo/index.html');
      cy.document().then((doc) => { baseline = clone(extractRecords(doc)); });
      cy.visit('/demo/index.html#sem-audience=operator');
      cy.get('#n-op').should('be.visible');
      cy.document().then((doc) => {
        expect(clone(extractRecords(doc))).to.deep.equal(baseline);
      });
    });
  });
});
