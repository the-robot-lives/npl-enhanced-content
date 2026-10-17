/**
 * sem-workflow — ordered steps with gates, checks and an if-no branch
 * (spec/schema/sem-workflow.md).
 *
 * BDD source: spec/schema/sem-workflow.md. Proves:
 *   - the core bundle registers the element (no CSS-only elements);
 *   - JS-off: CSS-ordered list — ordinals are workflow-scoped counters
 *     and gate/check badges are ::before/::after attr() chrome (outside
 *     the record);
 *   - JS-on: steps carrying if-no grow a collapsible branch (button with
 *     aria-expanded/aria-controls; branch hidden + inert until expanded);
 *   - the extraction invariant: the authored RECORD (step attributes +
 *     authored inline text, generated chrome stripped) is identical in
 *     the built page and the scripts-stripped .nojs artifact.
 */
const PAGE = '/demo/workflows-trees.html';
const NOJS = '/demo/workflows-trees.nojs.html';

/** The authored record of one step: its attribute set + inline text with
 *  generated chrome (.sem-step-branch*) removed. */
const recordOf = (step) => {
  const clone = step.cloneNode(true);
  clone.querySelectorAll('.sem-step-branch, .sem-step-branch-toggle').forEach((n) => n.remove());
  const attrs = {};
  for (const a of step.attributes) {
    if (a.name === 'data-sem-upgraded') continue; // runtime state, not the record
    attrs[a.name] = a.value;
  }
  return { attrs, text: clone.textContent.replace(/\s+/g, ' ').trim() };
};

describe('sem-workflow (spec/schema/sem-workflow.md)', () => {
  it('upgrades in the built page: registered component + claimed marker', () => {
    cy.visit(PAGE);
    cy.get('sem-workflow#w-release').should(($el) => {
      expect($el[0].hasAttribute('data-sem-upgraded'), 'data-sem-upgraded claimed').to.eq(true);
      expect($el[0].ownerDocument.defaultView.customElements.get('sem-workflow')).to.exist;
    });
  });

  it('JS-on: if-no steps grow a collapsible branch; plain steps do not', () => {
    cy.visit(PAGE);
    cy.get('sem-step#ws-2').within(() => {
      cy.get('.sem-step-branch-toggle').should('have.attr', 'aria-expanded', 'false');
      cy.get('.sem-step-branch').should('have.attr', 'hidden'); // inert until expanded
      cy.get('.sem-step-branch').should('contain.text', 'fix CI, then re-run');
    });
    // expand
    cy.get('sem-step#ws-2 .sem-step-branch-toggle').click();
    cy.get('sem-step#ws-2 .sem-step-branch-toggle').should('have.attr', 'aria-expanded', 'true');
    cy.get('sem-step#ws-2 .sem-step-branch').should('be.visible');
    // the underscore twin wires too
    cy.get('sem-step#ws-3 .sem-step-branch-toggle').should('exist');
    // a step with no if-no gets no chrome
    cy.get('sem-step#ws-1 .sem-step-branch-toggle').should('not.exist');
    // the class-form lane (div.sem-workflow > div.sem-step) upgrades too
    cy.get('div.sem-workflow#w-class div.sem-step').first().find('.sem-step-branch-toggle').should('not.exist');
  });

  it('JS-off: CSS ordinals + gate badge, no branch chrome anywhere', () => {
    cy.visit(NOJS);
    cy.get('sem-workflow#w-release').should(($wf) => {
      const doc = $wf[0].ownerDocument;
      expect(doc.querySelector('[data-sem-upgraded]')).to.eq(null);
      expect($wf.find('.sem-step-branch-toggle')).to.have.length(0);
      expect($wf.find('.sem-step-branch')).to.have.length(0);
      const step1 = doc.getElementById('ws-1');
      const before = doc.defaultView.getComputedStyle(step1, '::before').content;
      // counters resolve at paint — the computed content keeps the
      // counter() form, so the assertable contract is the workflow-scoped
      // counter identity (NOT the procedure counter) plus the check badge
      expect(before).to.contain('counter(sem-wf-step)');
      expect(before).to.not.contain('counter(sem-step)'); // not the procedure counter
      expect(before).to.contain('gh run view');
      const after = doc.defaultView.getComputedStyle(step1, '::after').content;
      expect(after).to.contain('⛨');
      expect(after).to.contain('CI green');
    });
    // authored step text is the visible record
    cy.get('sem-step#ws-2').should('contain.text', 'merge to stage');
  });

  it('extraction invariant — the authored RECORD is identical with JS off', () => {
    let live;
    cy.visit(PAGE)
      .get('sem-workflow#w-release')
      .then(($wf) => {
        live = [...$wf[0].querySelectorAll('sem-step')].map(recordOf);
      });
    cy.visit(NOJS);
    cy.get('sem-workflow#w-release').should(($wf) => {
      const off = [...$wf[0].querySelectorAll('sem-step')].map(recordOf);
      expect(off).to.deep.eq(live);
    });
  });
});
