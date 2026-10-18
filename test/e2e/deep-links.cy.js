// BDD spec — deep links · source: spec/conventions.md §4 (cross-cutting), src/fallback/target.ts
//
// Feature: a `#id` or `#container/child` hash reaches its target even when
//          the target is inside a closed reveal, a collapsed note, an
//          inactive view or a non-current flashcard; the enclosing element
//          opens, the target scrolls into view and carries a transient
//          `.sem-target` marker; JS-off the content is simply visible
//   Scenario: opens a collapsed reveal
//   Scenario: expands a collapsed note
//   Scenario: selects the flashcard containing the target
//   Scenario: activates the view enclosing a descendant id, hash untouched
//   Scenario: container/child form resolves to the named view
//   Scenario: hashchange after load
//   Scenario: unknown and parameter segments are ignored
//   Scenario: reduced motion — scroll without smooth behavior
//   Scenario: JS-off — target content visible, no resolver marker

const cs = (el) => el.ownerDocument.defaultView.getComputedStyle(el);

describe('deep links', () => {
  it('opens a collapsed reveal whose id is the hash and marks it transiently', () => {
    cy.visit('/demo/index.html#r-storage');
    cy.get('#r-storage details').should('have.attr', 'open');
    cy.get('#r-storage .sem-reveal-body').should('be.visible');
    cy.get('#r-storage').should('have.class', 'sem-target');
    cy.get('#r-storage', { timeout: 6000 }).should('not.have.class', 'sem-target');
  });

  it('expands a collapsed note', () => {
    cy.visit('/demo/index.html#n-tip');
    cy.get('#n-tip').should('not.have.attr', 'collapsed');
    cy.get('#n-tip .sem-note-body').should('be.visible');
    cy.get('#n-tip .sem-note-summary').should('not.exist');
  });

  it('selects the flashcard that contains the target', () => {
    cy.visit('/demo/index.html#f-device');
    cy.get('#f-device').should('have.class', 'sem-current').and('be.visible');
    // the meter is a chip index — position shows as the aria-current chip.
    // The demo deck is unseeded (randomFor falls back to Date.now()), so the
    // deep-linked card's position varies per load; assert the index tracks
    // it rather than pinning a slot.
    cy.get('.sem-facts[data-view-as="flashcards"] .sem-facts-meter button[aria-current="true"]')
      .should('have.attr', 'aria-label').and('match', /^Card [0-9]+$/);
  });

  it('activates the view enclosing a descendant id and keeps the hash', () => {
    cy.visit('/demo/index.html#argocd-tag');
    cy.get('#deploy .sem-view[data-name="ArgoCD"]')
      .should('be.visible')
      .and('have.attr', 'data-active');
    cy.get('#deploy .sem-views-tabs button[aria-selected="true"]').should('contain', 'ArgoCD');
    cy.get('#argocd-tag').should('have.class', 'sem-target');
    cy.location('hash').should('eq', '#argocd-tag');
  });

  it('resolves the container/child form to the named view', () => {
    cy.visit('/demo/index.html#deploy/argocd');
    cy.get('#deploy .sem-view[data-name="ArgoCD"]')
      .should('be.visible')
      .and('have.class', 'sem-target');
  });

  it('responds to hashchange after load', () => {
    cy.visit('/demo/index.html');
    cy.get('#r-storage details').should('not.have.attr', 'open');
    cy.window().then((win) => { win.location.hash = '#r-storage'; });
    cy.get('#r-storage details').should('have.attr', 'open');
  });

  it('ignores unknown ids and name=value segments', () => {
    cy.visit('/demo/index.html#nope&sem-audience=operator');
    cy.get('.sem-fact').should('have.length.greaterThan', 0);
    cy.get('.sem-target').should('not.exist');
  });

  it('styles the target marker from the accent token', () => {
    cy.visit('/demo/index.html#r-storage');
    cy.get('#r-storage.sem-target').should(($r) => {
      expect(cs($r[0]).outlineStyle).to.equal('solid');
    });
  });

  it('scrolls without smooth behavior under prefers-reduced-motion', () => {
    cy.visit('/demo/index.html#r-storage', {
      onBeforeLoad(win) {
        const calls = [];
        win.__scrollCalls = calls;
        win.Element.prototype.scrollIntoView = function (opts) { calls.push(opts); };
        const real = win.matchMedia.bind(win);
        win.matchMedia = (q) =>
          q.indexOf('reduced-motion') >= 0
            ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} }
            : real(q);
      }
    });
    cy.window().its('__scrollCalls').should((calls) => {
      expect(calls.length).to.be.greaterThan(0);
      expect(calls[calls.length - 1].behavior).to.equal('auto');
    });
  });

  describe('JS-off (dist/demo/index.nojs.html)', () => {
    it('target content is visible without any resolver', () => {
      cy.visit('/demo/index.nojs.html#r-storage');
      cy.get('#r-storage').should('be.visible').and('contain.text', 'localStorage');
      cy.get('.sem-target').should('not.exist');
    });
  });
});
