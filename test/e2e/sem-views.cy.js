// BDD spec — sem-views / sem-view · source: spec/schema/sem-views.md
//
// Feature: sem-views shows one named perspective at a time, switches by
//          click/keyboard/hash, degrades to stacked readable views JS-off
//   Scenario: first view active by default, others hidden
//   Scenario: tab click switches active view
//   Scenario: arrow keys move active view
//   Scenario: deep-link hash #id/name activates that view
//   Scenario: sem-navigate event fires with name and index
//   Scenario: container is a region; tabs are wired to their panels
//   Scenario: roving tabindex — the active tab is the only tab stop
//   Scenario: Home/End jump to the first/last view
//   Scenario: switching never moves or rewrites view content

describe('sem-views', () => {
  beforeEach(() => cy.visit('/demo/index.html'));

  it('first view active by default, others hidden', () => {
    cy.get('#deploy .sem-view[data-name="Helm"]').should('be.visible');
    cy.get('#deploy .sem-view[data-name="ArgoCD"]').should('not.be.visible');
    cy.get('#deploy .sem-view[data-active]').should('have.length', 1);
  });

  it('tab click switches active view', () => {
    cy.get('#deploy .sem-views-tabs button').contains('ArgoCD').click();
    cy.get('#deploy .sem-view[data-name="ArgoCD"]').should('be.visible');
    cy.get('#deploy .sem-view[data-name="Helm"]').should('not.be.visible');
  });

  it('arrow keys move active view', () => {
    cy.get('#deploy .sem-views-tabs button').first().focus().type('{rightarrow}');
    cy.get('#deploy .sem-view[data-name="ArgoCD"]').should('be.visible');
  });

  it('deep-link hash activates that view', () => {
    cy.visit('/demo/index.html#deploy/argocd');
    cy.get('#deploy .sem-view[data-name="ArgoCD"]').should('be.visible');
    cy.get('#deploy .sem-view[data-name="Helm"]').should('not.be.visible');
  });

  it('sem-navigate event fires with name and index', () => {
    cy.window().then((win) => {
      const seen = [];
      win.document.getElementById('deploy')
        .addEventListener('sem-navigate', (e) => seen.push(e.detail));
      cy.get('#deploy .sem-views-tabs button').contains('ArgoCD').click();
      cy.wrap(seen).should((s) => {
        expect(s[0]).to.include({ name: 'ArgoCD', index: 1 });
      });
    });
  });

  it('container is a region; tabs are wired to their panels', () => {
    cy.get('#deploy').should('have.attr', 'role', 'region').and('have.attr', 'aria-label');
    cy.get('#deploy .sem-views-tabs').should('have.attr', 'role', 'tablist');
    cy.get('#deploy .sem-views-tabs button').first().should('have.attr', 'aria-selected', 'true');
    cy.get('#deploy .sem-view[data-name="Helm"]')
      .should('have.attr', 'role', 'tabpanel')
      .and('have.attr', 'aria-labelledby');
  });

  it('roving tabindex — the active tab is the only tab stop', () => {
    cy.get('#deploy .sem-views-tabs button').then(($tabs) => {
      const stops = $tabs.filter((i, t) => t.tabIndex === 0);
      expect(stops).to.have.length(1);
      expect(stops).to.have.attr('aria-selected', 'true');
    });
  });

  it('Home/End jump to the first/last view', () => {
    cy.get('#deploy .sem-views-tabs button').contains('ArgoCD').focus().type('{home}');
    cy.get('#deploy .sem-view[data-name="Helm"]').should('be.visible');
    cy.get('#deploy .sem-views-tabs button').contains('ArgoCD').focus().type('{end}');
    cy.get('#deploy .sem-views-tabs button').last().should('have.attr', 'aria-selected', 'true');
  });

  it('switching never moves or rewrites view content', () => {
    cy.get('#deploy .sem-view[data-name="Helm"] > *').then(($before) => {
      const sig = [...$before].map((el) => el.outerHTML);
      cy.get('#deploy .sem-views-tabs button').contains('ArgoCD').click();
      cy.get('#deploy .sem-view[data-name="Helm"] > *').then(($after) => {
        expect([...$after].map((el) => el.outerHTML)).to.deep.equal(sig);
      });
      // The views themselves keep their DOM position.
      cy.get('#deploy .sem-view').first().should('have.attr', 'data-name', 'Helm');
    });
  });
});
