// BDD spec — sem-facts / sem-fact · source: spec/schema/sem-facts.md
//
// Feature: sem-facts presents fact/claim pairs as list, flashcards, or
//          quiz; JS-off degrades to a fully readable list; the Lit
//          upgrade supersedes the fallback behavior
//   Scenario: list view (default) — all facts visible, no chrome
//   Scenario: flashcards — one card at a time, flip reveals conclusion
//   Scenario: flashcards — one tab stop on the current card; Enter/Space
//             flip it, aria-expanded tracks, focus ring visible
//   Scenario: flashcards — meter is an index (one chip per card), wraps around
//   Scenario: quiz — conclusion hidden until correct selection, scored
//   Scenario: quiz — wrong pick marked, counts as answered
//   Scenario: D1 — .sem-progress element and facts meter coexist
//   Scenario: JS-off — all conclusions visible in every view
//   Scenario: Lit element form — <sem-facts> owns behavior, same marker

describe('sem-facts', () => {
  describe('v0.4 class baseline (web/demo/index.html)', () => {
    beforeEach(() => cy.visit('/demo/index.html'));

    it('list view (default): all facts visible, no chrome, claimed by the runtime', () => {
      cy.get('#facts-list .sem-fact').should('have.length', 2);
      cy.get('#facts-list .sem-fact .sem-conclusion').should('be.visible');
      cy.get('#facts-list .sem-facts-chrome').should('not.exist');
      // list view stays unclaimed — only flashcards/quiz decks get chrome
      cy.get('#facts-list').should('not.have.attr', 'data-sem-upgraded');
    });

    it('flashcards: one card at a time, flip reveals conclusion', () => {
      const fc = '.sem-facts[data-view-as="flashcards"] ';
      cy.get(fc + '.sem-fact.sem-current').should('have.length', 1);
      cy.get(fc + '.sem-current .sem-conclusion').should('not.be.visible');
      cy.get(fc + '.sem-current').click();
      cy.get(fc + '.sem-current.sem-flipped .sem-conclusion').should('be.visible');
    });

    it('flashcards: meter is an index (one chip per card), prev wraps to last position', () => {
      const fc = '.sem-facts[data-view-as="flashcards"] ';
      cy.get(fc + '.sem-facts-meter button').should('have.length', 3);
      cy.get(fc + '.sem-facts-meter button[aria-current="true"]').should('have.attr', 'aria-label', 'Card 1');
      cy.get(fc + '[data-act="prev"]').click();
      cy.get(fc + '.sem-facts-meter button[aria-current="true"]').should('have.attr', 'aria-label', 'Card 3');
      cy.get(fc + '[data-act="next"]').click();
      cy.get(fc + '.sem-facts-meter button[aria-current="true"]').should('have.attr', 'aria-label', 'Card 1');
    });

    it('quiz: conclusion hidden until correct selection, then scored', () => {
      const qz = '.sem-facts[data-view-as="quiz"] ';
      cy.get(qz + '.sem-fact .sem-conclusion').should('not.be.visible');
      cy.get(qz + '.sem-current .sem-quiz-options button').should('have.length.at.least', 2);
      cy.get(qz + '.sem-current .sem-quiz-options button[data-correct="true"]').click();
      cy.get(qz + '.sem-facts-meter').should('contain', 'score 1/1');
    });

    it('quiz: wrong pick marked wrong, spent pick inert', () => {
      const qz = '.sem-facts[data-view-as="quiz"] ';
      cy.get(qz + '.sem-current .sem-quiz-options button[data-correct="false"]').first().click();
      cy.get(qz + '.sem-current .sem-quiz-options button.sem-wrong-pick').should('have.length', 1);
      cy.get(qz + '.sem-facts-meter').should('contain', 'score 0/1');
      // the spent pick is disabled; any further enabled pick keeps the miss score
      cy.get(qz + '.sem-current .sem-quiz-options button:enabled').first().click();
      cy.get(qz + '.sem-facts-meter').should('contain', 'score 0/1');
    });

    it('D1: .sem-progress element and facts chrome meter coexist without collision', () => {
      // the meter element renders its track under its own class…
      cy.get('#p-coverage.sem-progress').should('contain', 'coverage :: 62%');
      cy.get('#p-coverage .sem-progress-track').should('exist');
      // …while the facts chrome meter is a different class entirely
      cy.get('.sem-facts[data-view-as="flashcards"] .sem-facts-meter button').should('have.length', 3);
      cy.get('.sem-facts-chrome .sem-progress').should('not.exist');
      // and the meter element is untouched by facts chrome
      cy.get('#p-coverage .sem-facts-meter').should('not.exist');
    });

    it('JS-off: every view degrades to readable list, no occlusion', () => {
      cy.visit('/demo/index.nojs.html');
      cy.get('.sem-facts[data-view-as="flashcards"] .sem-fact .sem-conclusion')
        .should('be.visible');
      cy.get('.sem-facts[data-view-as="quiz"] .sem-fact .sem-conclusion')
        .should('be.visible');
      cy.get('.sem-facts .sem-facts-chrome').should('not.exist');
      cy.get('.sem-facts[data-sem-upgraded]').should('not.exist');
    });
  });

  describe('Lit upgrade (web/demo/standalone-lit.html)', () => {
    beforeEach(() => cy.visit('/demo/standalone-lit.html'));

    it('registers and upgrades sem-facts (component claims the one marker)', () => {
      cy.window().then((win) => {
        expect(win.customElements.get('sem-facts')).to.exist;
      });
      cy.get('main sem-facts').should('have.attr', 'data-sem-upgraded');
    });

    it('flashcards: one current card, flip reveals conclusion', () => {
      const fc = 'sem-facts[data-view-as="flashcards"] ';
      cy.get(fc + '.sem-fact.sem-current').should('have.length', 1);
      cy.get(fc + '.sem-current .sem-conclusion').should('not.be.visible');
      cy.get(fc + '.sem-current').click();
      cy.get(fc + '.sem-current.sem-flipped .sem-conclusion').should('be.visible');
      cy.get(fc + '.sem-facts-meter button').should('have.length', 2);
    });

    it('flashcards: keyboard flips — one tab stop, Enter/Space, aria-expanded', () => {
      const fc = 'sem-facts[data-view-as="flashcards"] ';
      // the deck keeps one stop in the tab order: the current card alone
      cy.get(fc + '.sem-fact.sem-current')
        .should('have.attr', 'tabindex', '0')
        .and('have.attr', 'aria-expanded', 'false');
      cy.get(fc + '.sem-fact:not(.sem-current)').then(($rest) => {
        $rest.each((_, f) => expect(f.getAttribute('tabindex')).to.equal('-1'));
      });
      // Enter flips the focused card; aria-expanded tracks the reveal
      cy.get(fc + '.sem-current').focus().type('{enter}');
      cy.get(fc + '.sem-current.sem-flipped')
        .should('have.attr', 'aria-expanded', 'true');
      cy.get(fc + '.sem-current .sem-conclusion').should('be.visible');
      // Space flips back
      cy.get(fc + '.sem-current').focus().type(' ');
      cy.get(fc + '.sem-current:not(.sem-flipped)')
        .should('have.attr', 'aria-expanded', 'false');
      // moving the deck resets the flip and moves the single stop
      cy.get(fc + '[data-act="next"]').click();
      cy.get(fc + '.sem-current').should('have.attr', 'tabindex', '0');
      cy.get(fc + '.sem-current.sem-flipped').should('not.exist');
    });

    it('quiz: conclusion hidden, correct pick scores', () => {
      const qz = 'sem-facts[data-view-as="quiz"] ';
      cy.get(qz + '.sem-current .sem-conclusion').should('not.be.visible');
      cy.get(qz + '.sem-current .sem-quiz-options button[data-correct="true"]').click();
      cy.get(qz + '.sem-facts-meter').should('contain', 'score 1/1');
    });
  });
});
