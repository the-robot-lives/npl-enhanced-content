// start-script e2e — the demo waits for a reader, plays into the real DOM,
// and releases the terminal on Escape. Served from the built dist/ (vite
// preview); the build emits /demo/script.html and /demo/script.nojs.html.
describe('start-script (the demo that waits)', () => {
  it('does not start below the fold, starts in view, Escape releases', () => {
    cy.visit('/demo/script.html');

    // Booted, but not yet looked at: the prompt is free and the page's
    // demo script has produced nothing of its own.
    cy.get('.sem-shell-input')
      .should('have.prop', 'readOnly', false)
      .scrollIntoView();

    // Half in view: the grace beat, then the demo takes the keyboard.
    cy.get('.sem-shell-input', { timeout: 15000 }).should('have.prop', 'readOnly', true);

    // It plays into the terminal itself: the outline of the deck's notes.
    cy.contains('.sem-shell-line', 'Auth notes', { timeout: 20000 }).should('exist');

    // Escape hands the terminal back mid-demo (or after it). Dispatch the
    // keydown directly: cy.type() refuses readonly inputs, and the escape
    // must bubble to the shell frame exactly like a real keypress would.
    cy.get('.sem-shell-input').then(($input) => {
      $input[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    cy.get('.sem-shell-input').should('have.prop', 'readOnly', false);
  });

  it('the zero-JS build ships the static transcript only', () => {
    cy.visit('/demo/script.nojs.html');
    cy.get('.sem-shell-transcript').should('exist');
    cy.get('.sem-shell-transcript').contains('h1 Auth notes');
    cy.get('.sem-shell-input').should('not.exist');
  });
});
