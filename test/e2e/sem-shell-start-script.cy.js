// start-script site-path fetch — the r2.1 fix end to end, against the
// BUILT pages in dist/demo/ (vite preview). The build emits
// /demo/start-script.html and its .nojs.html twin.
describe('start-script from a site path (the landing contract)', () => {
  it('fetches the file below the fold, plays its body in view, Escape releases', () => {
    cy.visit('/demo/start-script.html');

    // Booted, but not yet looked at: the prompt is free and nothing fetched
    // has played (the boot transcript is static plugin lines only).
    cy.get('.sem-shell-input')
      .should('have.prop', 'readOnly', false)
      .scrollIntoView();

    // In view: fetch, the grace beat, then the demo takes the keyboard.
    cy.get('.sem-shell-input', { timeout: 15000 }).should('have.prop', 'readOnly', true);

    // It fetched the FILE and parsed its demo-format body: the heading
    // comment landed and the echo ran. An r2-style inline parse of the
    // path string would have produced none of this.
    cy.contains('.sem-shell-line', 'Fetched demo', { timeout: 20000 }).should('exist');
    cy.contains('.sem-shell-line', 'start-script-fetched', { timeout: 20000 }).should('exist');

    // Escape hands the terminal back mid-demo (or after it).
    cy.get('.sem-shell-input').then(($input) => {
      $input[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    cy.get('.sem-shell-input').should('have.prop', 'readOnly', false);
  });

  it('the zero-JS build ships the static transcript only', () => {
    cy.visit('/demo/start-script.nojs.html');
    cy.get('.sem-shell-transcript').should('exist');
    cy.get('.sem-shell-transcript').contains('start-script-fetched');
    cy.get('.sem-shell-input').should('not.exist');
  });

  it('the canvas paint fits its frame (the r2 row-0 overprint geometry)', () => {
    cy.visit('/demo/start-script.html');
    cy.get('.sem-shell-input').scrollIntoView();
    // Default paint is canvas unless the renderer was refused; whichever
    // paints, the surface must sit INSIDE the frame — a canvas taller than
    // the frame scrolls it under the titlebar (the r2 overprint).
    cy.get('sem-shell').should(($el) => {
      const paint = $el[0].getAttribute('data-paint');
      expect(['canvas', 'dom']).to.include(paint);
      if (paint !== 'canvas') return;
      const frame = $el[0].querySelector('.sem-shell-frame').getBoundingClientRect();
      const canvas = $el[0].querySelector('canvas.sem-term-canvas').getBoundingClientRect();
      expect(canvas.top).to.be.at.least(frame.top - 1);
      expect(canvas.bottom).to.be.at.most(frame.bottom + 1);
      expect(canvas.height).to.be.at.most(frame.height + 1);
    });
  });
});
