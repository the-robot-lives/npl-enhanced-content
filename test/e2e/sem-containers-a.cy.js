/**
 * Family A containers, elements 1–8 (spec/schema/sem-{kb,runbook,howto,
 * requirement,threat-model,guard-rails,mockup,rubric}.md).
 *
 * BDD sources: each element's contract file names this spec. The
 * components are no-logic display stubs (no CSS-only elements — each
 * registers a Lit component that claims `data-sem-upgraded`); the
 * contract each must prove is structural:
 *
 *   - the core bundle registers every element and claims its marker;
 *   - authored children render as-is, labels/chips are CSS chrome
 *     (::before/::after — outside textContent);
 *   - the extraction invariant: textContent is IDENTICAL in the built
 *     page and the scripts-stripped .nojs artifact.
 *
 * Fixture: web/demo/containers.html (dist copy served by `npm run serve`).
 */
describe('family A containers a — kb, runbook, howto, requirement, threat-model, guard-rails, mockup, rubric', () => {
  const PAGE = '/demo/containers.html';
  const NOJS = '/demo/containers.nojs.html';

  // The eight single/pair tags of this group, with their fixture ids.
  const cases = [
    { tag: 'sem-kb', id: 'ca-kb', label: 'knowledge base' },
    { tag: 'sem-runbook', id: 'ca-runbook', label: 'runbook' },
    { tag: 'sem-howto', id: 'ca-howto', label: 'how-to' },
    { tag: 'sem-requirement', id: 'ca-req', label: 'requirement' },
    { tag: 'sem-threat-model', id: 'ca-tm', label: 'threat model' },
    { tag: 'sem-guard-rails', id: 'ca-gr', label: 'guard rails' },
    { tag: 'sem-mockup', id: 'ca-mockup', label: 'mockup' },
    { tag: 'sem-rubric', id: 'ca-rubric', label: 'rubric' },
  ];

  it('every element registers a component and claims its marker', () => {
    cy.visit(PAGE);
    for (const { tag, id } of cases) {
      cy.get(`${tag}#${id}`).should(($el) => {
        expect($el[0].hasAttribute('data-sem-upgraded'), `${tag} claimed`).to.eq(true);
        expect($el[0].ownerDocument.defaultView.customElements.get(tag)).to.exist;
        expect($el[0].shadowRoot).to.eq(null);
      });
    }
    // the pair entry registers from the same module as its collection
    cy.get('sem-guard-rail').its('length').should('be.at.least', 2);
    cy.get('sem-guard-rail').first().should('have.attr', 'data-sem-upgraded');
  });

  it('labels are CSS chrome — in ::before, never in textContent', () => {
    cy.visit(PAGE);
    for (const { tag, id, label } of cases) {
      cy.get(`${tag}#${id}`).should(($el) => {
        const win = $el[0].ownerDocument.defaultView;
        const before = win.getComputedStyle($el[0], '::before');
        expect(before.content, `${tag} ::before draws`).to.contain(label);
        expect($el.text(), `${tag} label outside text`).to.not.contain(label);
      });
    }
  });

  it('attribute sugar draws chips without entering the text', () => {
    cy.visit(PAGE);
    // requirement: status chip in ::after
    cy.get('sem-requirement#ca-req').should(($el) => {
      const after = $el[0].ownerDocument.defaultView.getComputedStyle($el[0], '::after');
      expect(after.content).to.contain('draft');
      expect($el.text()).to.not.contain('draft');
    });
    // rubric: max-score chip in ::after
    cy.get('sem-rubric#ca-rubric').should(($el) => {
      const after = $el[0].ownerDocument.defaultView.getComputedStyle($el[0], '::after');
      expect(after.content).to.contain('10');
      expect($el.text()).to.not.contain('max 10');
    });
    // guard-rail: severity rails + severity label in ::before, rule text intact
    cy.get('sem-guard-rail[severity="block"]').should(($el) => {
      const before = $el[0].ownerDocument.defaultView.getComputedStyle($el[0], '::before');
      expect(before.content).to.contain('block');
      expect($el.text()).to.contain('error envelope');
    });
    // mockup text mode: authored ASCII frame survives verbatim
    cy.get('sem-mockup#ca-mockup').should(($el) =>
      expect($el.text()).to.contain('[ call to action ]'));
  });

  it('extraction invariant — identical text with JS off (.nojs artifact)', () => {
    let live = {};
    cy.visit(PAGE);
    for (const { tag, id } of cases) {
      cy.get(`${tag}#${id}`).then(($el) => {
        live[`${tag}#${id}`] = $el.text().replace(/\s+/g, ' ').trim();
      });
    }
    cy.visit(NOJS);
    expect(document.querySelector('[data-sem-upgraded]')).to.eq(null);
    for (const { tag, id, label } of cases) {
      cy.get(`${tag}#${id}`).should(($el) => {
        expect($el.text().replace(/\s+/g, ' ').trim(), `${tag} js-off text`)
          .to.eq(live[`${tag}#${id}`]);
        const before = $el[0].ownerDocument.defaultView.getComputedStyle($el[0], '::before');
        expect(before.content, `${tag} label draws js-off`).to.contain(label);
      });
    }
  });

});
