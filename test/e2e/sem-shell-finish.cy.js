// sem-shell finish-line end to end — the headline paths added in the
// 2026-11-11 wave, against the BUILT pages in dist/demo/. Rides the nightly
// full Cypress run (specPattern test/e2e/**/*.cy.js); not a per-PR gate.
//
// Feature: lazy packages on first use
//   Scenario: a cold `echo … | jq` loads its chunk and runs in one line
// Feature: full-screen apps
//   Scenario: nano owns the screen; F6 hands the prompt back
// Feature: tabs
//   Scenario: tab new / tab close drive the tab strip

describe('sem-shell finish-line', () => {
  const prompt = '.sem-shell-input'; // per-instance ids now; select by class
  const log = '[role="log"]';

  const takeOver = () => {
    cy.get(prompt, { timeout: 15000 }).should('have.attr', 'readonly');
    cy.get(prompt).then(($input) => {
      $input[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    cy.get(prompt).should('not.have.attr', 'readonly');
  };
  const run = (command) => cy.get(prompt).type(`${command}{enter}`);

  beforeEach(() => {
    cy.visit('/demo/shell.html');
    takeOver();
  });

  it('a cold package command loads its chunk on first use and runs', () => {
    run(`echo '{"a":1}' | jq .a`);
    cy.get(log, { timeout: 20000 }).should('contain.text', '1');
  });

  it('nano owns the screen and F6 hands the prompt back', () => {
    run('nano demo/welcome.html');
    cy.get(prompt).should('not.exist'); // the app owns the screen, prompt hidden
    cy.get('.sem-shell-hidden-input').then(($input) => {
      $input[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'F6', bubbles: true }));
    });
    cy.get(prompt, { timeout: 10000 }).should('exist');
  });

  it('tab new / tab close drive the tab strip', () => {
    run('tab new');
    cy.get('[role="tab"]').should('have.length', 2);
    run('tab close');
    cy.get('[role="tab"]').should('have.length.below', 2);
  });
});
