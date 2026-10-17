// BDD spec — the agent-kit bundle (family C) · source: spec/schema/agent-kit/*.md
//
// Feature: the agent-kit-* components are cached embeds whose authored
//          inner content IS the record; the chrome they fabricate under
//          the upgrade claim is extraction-invisible, so JS-off
//          extraction deep-equals JS-on extraction
//   Scenario: INVARIANT — JS-off extraction deep-equals JS-on extraction (sub-batch: tickets)
//   Scenario: tickets mint one plain record each, in document order
//   Scenario: ticket record text is the authored record — no chrome text leaks
//   Scenario: chrome (meta row, share footer, key anchor) exists JS-on and not JS-off
//   Scenario: ticket-ref is an inert prose chip JS-off and a keyboard link JS-on

import { extractRecords } from '../../src/extract/records';

const clone = (v) => JSON.parse(JSON.stringify(v));
const extract = () => cy.document().then((doc) => clone(extractRecords(doc)));

// Document order of the tickets section in web/demo/agent-kit.html.
const TICKET_TYPES = [
  'agent-kit-issue',
  'agent-kit-bug',
  'agent-kit-task',
  'agent-kit-epic',
  'agent-kit-user-story',
];

describe('agent-kit bundle — tickets (sub-batch 1)', () => {
  it('INVARIANT: JS-off extraction deep-equals JS-on extraction', () => {
    let jsOff;
    cy.visit('/demo/agent-kit.nojs.html');
    extract().then((records) => {
      jsOff = records;
      // the authored tickets really do mint records JS-off
      expect(records.map((r) => r.type)).to.deep.equal(TICKET_TYPES);
    });
    cy.visit('/demo/agent-kit.html');
    extract().then((jsOn) => {
      expect(jsOn).to.deep.equal(jsOff);
    });
  });

  describe('JS-on records', () => {
    beforeEach(() => cy.visit('/demo/agent-kit.html'));

    it('tickets mint one plain record each, carrying the global qualifiers', () => {
      extract().then((records) => {
        expect(records.map((r) => r.type)).to.deep.equal(TICKET_TYPES);
        const issue = records[0];
        expect(issue.id).to.equal('ticket-akit-001');
        expect(issue.kind).to.equal('ticket');
        expect(issue.tags).to.deep.equal(['extract', 'chrome']);
      });
    });

    it('ticket record text is the authored record — chrome text never leaks', () => {
      extract().then((records) => {
        const issue = records[0];
        expect(issue.text).to.contain('Extractor drops class-form parts');
        expect(issue.text).to.contain('wrapper element');
        // chrome strings: the type chip, key chip, badge, labels, footer
        expect(issue.text).not.to.contain('Issue');
        expect(issue.text).not.to.contain('AKIT-001');
        expect(issue.text).not.to.contain('in-progress');
        expect(issue.text).not.to.contain('Open in agent-kit');
        // child-spelling state/labels ARE authored visible content (bug card)
        const bug = records[1];
        expect(bug.text).to.contain('review');
        expect(bug.text).to.contain('css');
      });
    });
  });

  describe('chrome under the upgrade claim', () => {
    it('meta row, share footer, and key anchor exist JS-on', () => {
      cy.visit('/demo/agent-kit.html');
      cy.get('agent-kit-issue .agent-kit-ticket-chrome[data-sem-chrome]').should('exist');
      cy.get('agent-kit-issue .agent-kit-ticket-type').should('have.text', 'Issue');
      cy.get('agent-kit-issue .agent-kit-ticket-key').should('have.text', 'AKIT-001');
      cy.get('agent-kit-issue .agent-kit-ticket-state').should('have.attr', 'data-state', 'in-progress');
      cy.get('agent-kit-issue .agent-kit-ticket-label').should('have.length', 2);
      cy.get('agent-kit-issue a.agent-kit-ticket-open')
        .should('have.attr', 'href', '/app/acme/tickets/3f1c9a2e-8b74-4f6a-9d21-7ae5c0b4d101');
      // the anchor sits BEFORE the authored children (refs land at card top)
      cy.get('#akit-ticket-AKIT-001').then(($a) => {
        expect($a[0].nextElementSibling.tagName.toLowerCase()).to.equal('agent-kit-title');
      });
      // the bug card (no uuid) has no share footer; the task's snapshot stamp renders
      cy.get('agent-kit-bug a.agent-kit-ticket-open').should('not.exist');
      cy.get('agent-kit-task .agent-kit-ticket-snapshot').should('contain', '2026-10-14');
    });

    it('nothing is fabricated JS-off — the authored record stands alone', () => {
      cy.visit('/demo/agent-kit.nojs.html');
      cy.get('[data-sem-chrome]').should('not.exist');
      cy.get('.agent-kit-ticket-meta').should('not.exist');
      cy.get('#akit-ticket-AKIT-001').should('not.exist');
      cy.get('agent-kit-issue agent-kit-title').should(
        'have.text',
        'Extractor drops class-form parts',
      );
    });
  });

  describe('agent-kit-ticket-ref', () => {
    it('is a keyboard-reachable link JS-on', () => {
      cy.visit('/demo/agent-kit.html');
      cy.get('agent-kit-ticket-ref[key="AKIT-001"]')
        .should('have.attr', 'role', 'link')
        .and('have.attr', 'tabindex', '0')
        .and('have.attr', 'aria-label', 'Go to ticket AKIT-001: the extractor issue');
    });

    it('is inert prose JS-off', () => {
      cy.visit('/demo/agent-kit.nojs.html');
      cy.get('agent-kit-ticket-ref[key="AKIT-001"]').should(($el) => {
        expect($el[0].hasAttribute('role')).to.equal(false);
        expect($el[0].hasAttribute('tabindex')).to.equal(false);
        expect($el[0].textContent.trim()).to.equal('the extractor issue');
      });
    });
  });
});
