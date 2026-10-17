// BDD spec — print stylesheet & prefers-reduced-motion · source: themes/_vocabulary.css
//
// Media features are emulated through the DevTools protocol (Chromium-family
// browsers, Electron included). A `window.matchMedia` stub cannot do this:
// the CSS engine evaluates `@media` natively and never consults the stub.
//
// Feature: printed documents show everything a reader could open and no
//          chrome; reduced-motion readers get no transitions and no smooth
//          scrolling
//   Scenario: print hides generated chrome
//   Scenario: print stacks every view, headed by its name
//   Scenario: print shows collapsed note bodies and hidden conclusions
//   Scenario: beforeprint opens reveal disclosures; afterprint restores them
//   Scenario: print reads occluded highlights as text
//   Scenario: print keeps cards and steps unbroken
//   Scenario: reduced motion removes the occlusion transition and smooth scroll
//   Scenario: no preference keeps them

const cs = (el, pseudo) => el.ownerDocument.defaultView.getComputedStyle(el, pseudo || null);

const emulate = (params) =>
  cy.wrap(null, { log: false }).then(() =>
    Cypress.automation('remote:debugger:protocol', {
      command: 'Emulation.setEmulatedMedia',
      params
    })
  );

describe('print & reduced motion', () => {
  afterEach(() => emulate({ media: '', features: [] }));

  describe('print stylesheet', () => {
    beforeEach(() => {
      cy.visit('/demo/index.html');
      cy.get('.sem-views-tabs').should('exist');
      emulate({ media: 'print' });
    });

    it('hides generated chrome', () => {
      cy.get('.sem-views-tabs').should('not.be.visible');
      cy.get('.sem-facts-chrome').each(($c) => cy.wrap($c).should('not.be.visible'));
      cy.get('.sem-quiz-options').each(($q) => cy.wrap($q).should('not.be.visible'));
      cy.get('.sem-note-summary').should('not.be.visible');
    });

    it('stacks every view, headed by its name', () => {
      cy.get('#deploy .sem-view').should('have.length', 2).each(($v) => {
        cy.wrap($v).should('be.visible');
        expect(cs($v[0], '::before').content).to.match(/attr\(data-name\)|ArgoCD|Helm/);
      });
    });

    it('shows collapsed note bodies and every conclusion', () => {
      cy.get('#n-tip .sem-note-body').should('be.visible');
      cy.get('.sem-facts[data-view-as="quiz"] .sem-fact .sem-conclusion').each(($c) => {
        cy.wrap($c).should('be.visible');
      });
      cy.get('.sem-facts[data-view-as="flashcards"] .sem-fact').each(($f) => {
        cy.wrap($f).should('be.visible');
        cy.wrap($f).find('.sem-conclusion').should('be.visible');
      });
    });

    it('opens reveal disclosures for printing and restores them after', () => {
      // round 2: every reveal starts closed (`open` opts in) — print opens
      // them all, afterprint closes exactly the ones print opened.
      cy.get('#r-storage details').should('not.have.attr', 'open');
      cy.get('#r-derived details').should('not.have.attr', 'open');
      cy.window().then((win) => win.dispatchEvent(new win.Event('beforeprint')));
      cy.get('#r-storage details').should('have.attr', 'open');
      cy.get('#r-derived details').should('have.attr', 'open');
      cy.window().then((win) => win.dispatchEvent(new win.Event('afterprint')));
      cy.get('#r-storage details').should('not.have.attr', 'open');
      cy.get('#r-derived details').should('not.have.attr', 'open');
    });

    it('reads occluded highlights as text', () => {
      cy.get('.sem-occluded').first().should(($o) => {
        expect(cs($o[0]).color).not.to.equal('rgba(0, 0, 0, 0)');
      });
    });

    it('keeps fact cards and steps unbroken across pages', () => {
      cy.get('.sem-fact').first().should(($f) => {
        expect(cs($f[0]).breakInside).to.equal('avoid');
      });
      cy.get('.sem-step').first().should(($s) => {
        expect(cs($s[0]).breakInside).to.equal('avoid');
      });
    });

    it('drops the margin note back inline', () => {
      cy.viewport(1280, 800);
      cy.get('#n-margin').should(($n) => {
        expect(cs($n[0]).float).to.equal('none');
      });
    });
  });

  describe('prefers-reduced-motion', () => {
    it('removes the occlusion transition and smooth scrolling', () => {
      cy.visit('/demo/index.html');
      cy.get('.sem-occluded').should('exist');
      emulate({ media: '', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      cy.get('.sem-occluded').first().should(($o) => {
        expect(cs($o[0]).transitionDuration).to.equal('0s');
      });
      cy.document().should((doc) => {
        expect(cs(doc.documentElement).scrollBehavior).to.equal('auto');
      });
    });

    it('keeps them with no preference', () => {
      cy.visit('/demo/index.html');
      cy.get('.sem-occluded').should('exist');
      emulate({ media: '', features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
      cy.get('.sem-occluded').first().should(($o) => {
        expect(cs($o[0]).transitionDuration).to.equal('0.15s');
      });
      cy.document().should((doc) => {
        expect(cs(doc.documentElement).scrollBehavior).to.equal('smooth');
      });
    });
  });
});
