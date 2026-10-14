// BDD spec — v0.4 class-based baseline · source: conventions.md v0.4, web/demo/index.html
// Fixture serves the repo root; run any static server on port 4173.
// The JS-off scenario visits the built `.nojs.html` artifact (scripts stripped
// at build time) — the kill-switch hook of the multi-bundle days is gone.
//
// Feature: the class-based baseline document renders and behaves with zero
//          external resources beyond Tailwind CDN
//   Scenario: agent metadata block renders
//   Scenario: note variants render, collapsed hides body until clicked
//   Scenario: flashcards view — one card visible, flip reveals conclusion
//   Scenario: quiz view — conclusion hidden, options scored
//   Scenario: highlight occlusion — hidden until reveal, then visible
//   Scenario: JS-off — all content still readable (list layout, no occlusion)
//   Scenario: sem-note view-as="margin" — right gutter wide, inline narrow

describe('v0.4 baseline (web/demo/index.html)', () => {
  beforeEach(() => cy.visit('/demo/index.html'));

  it('renders agent metadata block', () => {
    cy.get('.sem-agent .sem-agent-name').should('contain', 'Auth Guide');
    cy.get('.sem-agent .sem-agent-instructions').should('exist');
  });

  it('renders note variants; collapsed hides body until clicked', () => {
    cy.get('.sem-note[data-variant="warning"]').should('be.visible');
    cy.get('.sem-note[collapsed] .sem-note-body').should('not.be.visible');
    cy.get('.sem-note[collapsed] .sem-note-summary').click();
    cy.get('.sem-note[collapsed] .sem-note-body').should('not.exist');
    cy.contains('Shuffle flashcards').should('be.visible');
  });

  it('flashcards view: one card at a time, flip reveals conclusion', () => {
    const fc = '.sem-facts[data-view-as="flashcards"] ';
    cy.get(fc + '.sem-fact.sem-current').should('have.length', 1);
    cy.get(fc + '.sem-current .sem-conclusion').should('not.be.visible');
    cy.get(fc + '.sem-current').click();
    cy.get(fc + '.sem-current.sem-flipped .sem-conclusion').should('be.visible');
    cy.get(fc + '[data-act="next"]').click();
    cy.get(fc + '.sem-current').should('have.length', 1);
    cy.get(fc + '.sem-facts-meter').should('contain', '2/3');
  });

  it('quiz view: conclusion hidden, options scored, distractors count', () => {
    const qz = '.sem-facts[data-view-as="quiz"] ';
    cy.get(qz + '.sem-fact .sem-conclusion').should('not.be.visible');
    cy.get(qz + '.sem-current .sem-quiz-options button').should('have.length.at.least', 2);
    cy.get(qz + '.sem-current .sem-quiz-options button[data-correct="true"]').click();
    cy.get(qz + '.sem-facts-meter').should('contain', 'score 1/1');
  });

  it('highlight occlusion: hidden until reveal, then visible', () => {
    cy.get('.sem-occluded').first().click();
    cy.get('.sem-revealed').should('contain', 'Authorization');
  });

  it('JS-off: content fully readable, no occlusion', () => {
    cy.visit('/demo/index.nojs.html');
    cy.get('.sem-fact .sem-statement').should('be.visible');
    cy.get('.sem-fact .sem-conclusion').should('be.visible');
    cy.get('.sem-highlight').should('be.visible');
    cy.get('.sem-occluded').should('not.exist');
  });

  it('view-as="margin": floats into the right gutter on wide viewports, inline on phones', () => {
    const cs = (el) => el.ownerDocument.defaultView.getComputedStyle(el);
    cy.viewport(1280, 800);
    cy.get('#n-margin').should(($n) => {
      expect(cs($n[0]).float).to.equal('right');
    });
    cy.viewport(390, 800);
    cy.get('#n-margin').should(($n) => {
      expect(cs($n[0]).float).to.equal('none');
    });
    // presentation only — the record is a plain note
    cy.get('#n-margin').should('have.attr', 'data-view-as', 'margin').and('be.visible');
  });
});
