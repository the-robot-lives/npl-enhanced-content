/**
 * Family A containers, elements 9–15 (spec/schema/sem-{eval,philosophy,
 * summary,plan,tsgs,faqs,changelogs}.md).
 *
 * BDD sources: each element's contract file names this spec. Same
 * structural contract as spec A: registered stubs claiming
 * `data-sem-upgraded`, authored children as-is, labels/chips as CSS
 * chrome outside textContent, and the extraction invariant (JS-on text
 * === JS-off text) on the built page vs the .nojs artifact.
 *
 * Fixture: web/demo/containers.html (dist copy served by `npm run serve`).
 */
describe('family A containers b — eval, philosophy, summary, plan, tsgs, faqs, changelogs', () => {
  const PAGE = '/demo/containers.html';
  const NOJS = '/demo/containers.nojs.html';

  const cases = [
    { tag: 'sem-eval', id: 'ca-eval', label: 'evaluation' },
    { tag: 'sem-philosophy', id: 'ca-philosophy', label: 'philosophy' },
    { tag: 'sem-summary', id: 'ca-summary', label: 'summary' },
    { tag: 'sem-plan', id: 'ca-plan', label: 'plan' },
    { tag: 'sem-tsgs', id: 'ca-tsgs', label: 'troubleshooting' },
    { tag: 'sem-faqs', id: 'ca-faqs', label: 'FAQ' },
    { tag: 'sem-changelogs', id: 'ca-changelogs', label: 'changelog' },
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
    // the three pair entries register from their collection modules
    for (const entry of ['sem-tsg', 'sem-faq', 'sem-changelog']) {
      cy.get(entry).its('length').should('be.at.least', 1);
      cy.get(entry).first().should('have.attr', 'data-sem-upgraded');
    }
  });

  it('labels are CSS chrome — in ::before, never in textContent', () => {
    cy.visit(PAGE);
    for (const { tag, id, label } of cases) {
      cy.get(`${tag}#${id}`).should(($el) => {
        const before = $el[0].ownerDocument.defaultView.getComputedStyle($el[0], '::before');
        expect(before.content, `${tag} ::before draws`).to.contain(label);
        expect($el.text(), `${tag} label outside text`).to.not.contain(label);
      });
    }
  });

  it('FAQ is not a disclosure — every question and answer is visible text', () => {
    cy.visit(PAGE);
    cy.get('sem-faq#q-expiry').should(($el) => {
      expect($el.text()).to.contain('Do access tokens expire mid-session?');
      expect($el.text()).to.contain('fresh pair from the refresh grant');
    });
    // Q/A prefixes are chrome, the authored strings are not
    cy.get('sem-faq#q-expiry > question').should(($el) => {
      const before = $el[0].ownerDocument.defaultView.getComputedStyle($el[0], '::before');
      expect(before.content).to.contain('Q');
    });
  });

  it('entry children render authored structure (tsg when/tags, changelog heading)', () => {
    cy.visit(PAGE);
    cy.get('sem-tsg').first().should(($el) => {
      expect($el.text()).to.contain('stale-image');
      expect($el.text()).to.contain('right after a release merge');
      // "when · " prefix is chrome
      expect($el.text()).to.not.contain('when · ');
    });
    cy.get('sem-changelog[date="2026-10-18"]').should(($el) => {
      const before = $el[0].ownerDocument.defaultView.getComputedStyle($el[0], '::before');
      expect(before.content).to.contain('2026-10-18');
      expect(before.content).to.contain('Per-session JWT rotation');
      expect($el.text()).to.contain('release train');
      expect($el.text()).to.contain('auth, tokens');
      // date never enters the text — it is an attribute
      expect($el.text()).to.not.contain('2026-10-18');
    });
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
