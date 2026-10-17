// BDD spec — sem-chronology / sem-event · source: spec/schema/sem-chronology.md
//
// Feature: an ordered, dated event list renders as a CSS-only timeline in
//          both authoring forms, with no script claim and no marker
//   Scenario: authored roles, DOM order, no upgrade marker (class form)
//   Scenario: date label — <time> child wins, else attr(data-when)
//   Scenario: status glyph beside colour
//   Scenario: view-as="list" drops the rail, keeps every event
//   Scenario: element form renders identically without a custom element
//   Scenario: JS-off — everything visible, no marker, same labels

const cs = (el, pseudo) => el.ownerDocument.defaultView.getComputedStyle(el, pseudo);

function assertChronology(root) {
  it('authored roles and DOM order, untouched by the runtime', () => {
    cy.get(root + '#history').should('have.attr', 'role', 'list');
    cy.get(root + '#history > *').should('have.length', 3).each(($e) => {
      cy.wrap($e).should('have.attr', 'role', 'listitem');
      cy.wrap($e).should('be.visible');
    });
    cy.get(root + '#history > *').first().should('have.id', 'e-v01');
  });

  it('date label: <time> child when authored, attr(data-when) otherwise', () => {
    cy.get('#e-v01 time').should('be.visible').and('contain', '2 Mar 2026');
    cy.get('#e-v01').then(($e) => {
      expect(cs($e[0], '::before').content).not.to.match(/2026-03-02|data-when/);
    });
    cy.get('#e-themes time').should('not.exist');
    cy.get('#e-themes').then(($e) => {
      expect(cs($e[0], '::before').content).to.match(/2026-Q4|attr\(/);
    });
  });

  it('status is conveyed by a glyph, not colour alone', () => {
    cy.get('#e-v01').then(($e) => expect(cs($e[0], '::after').content).to.contain('✓'));
    cy.get('#e-waves').then(($e) => expect(cs($e[0], '::after').content).to.contain('→'));
    cy.get('#e-themes').then(($e) => expect(cs($e[0], '::after').content).to.match(/none|""/));
  });

  it('view-as="list" keeps every event visible', () => {
    cy.get(root + '#milestones > *').should('have.length', 2).each(($e) => {
      cy.wrap($e).should('be.visible');
    });
    cy.get('#milestones').then(($c) => {
      // no rail in list mode
      expect(cs($c[0]).borderLeftWidth).to.equal('0px');
    });
    cy.get('#history').then(($c) => {
      expect(cs($c[0]).borderLeftWidth).not.to.equal('0px');
    });
  });
}

describe('sem-chronology', () => {
  describe('class form — /demo/reading.html', () => {
    beforeEach(() => cy.visit('/demo/reading.html'));
    assertChronology('.sem-chronology');
    it('class form is never claimed (custom elements upgrade tags only)', () => {
      cy.get('.sem-chronology#history').should('not.have.attr', 'data-sem-upgraded');
    });
  });

  describe('element form — /demo/reading-lit.html (CSS-only render, claim stub)', () => {
    beforeEach(() => cy.visit('/demo/reading-lit.html'));
    it('registers a claim stub — every element answers customElements.get', () => {
      cy.window().then((win) => {
        expect(win.customElements.get('sem-chronology')).to.be.a('function');
      });
    });
    assertChronology('sem-chronology');
    it('the claim stub marks the element (no render rewrite)', () => {
      cy.get('sem-chronology#history').should('have.attr', 'data-sem-upgraded');
    });
  });

  describe('JS-off — /demo/reading.nojs.html', () => {
    beforeEach(() => cy.visit('/demo/reading.nojs.html'));
    it('ships no script and renders every event with its label', () => {
      cy.request('/demo/reading.nojs.html').its('body').should('not.match', /<script/i);
      cy.get('.sem-event').should('have.length', 5).each(($e) => cy.wrap($e).should('be.visible'));
      cy.get('#e-themes').then(($e) => {
        expect(cs($e[0], '::before').content).to.match(/2026-Q4|attr\(/);
      });
    });
  });
});
