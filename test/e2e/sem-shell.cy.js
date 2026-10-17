// sem-shell end to end — the terminal, completion, storage, and the
// the no-JS document, against the BUILT pages in dist/demo/.
//
// Feature: the prompt
//   Scenario: Escape hands the terminal back from a scripted demo
//   Scenario: ls / cd / cat navigate the demo tree through the form
//   Scenario: pipes (ls | grep) and redirects (echo > file; cat file)
//   Scenario: mkdir -p / touch / ls -R / rm -r / cp over the real UI
//   Scenario: an unknown command reports status 127
// Feature: Tab completion
//   Scenario: a single candidate extends with a trailing space
//   Scenario: several candidates list as one comment line
// Feature: history
//   Scenario: ArrowUp recalls the previous line
// Feature: durable storage (local-storage attribute)
//   Scenario: edits survive cy.reload(); storage reset restores the factory
// Feature: no-JS contract
//   Scenario: shell-storage.nojs.html renders the static transcript
// Feature: s3 mounts
//   Scenario: public mount hydrates over an intercepted REST endpoint
// Feature: the context menu
//   Scenario: right-click and Shift+F10 open it; Copy and Select all act;
//     the view switches to text and back; Escape closes

describe('sem-shell', () => {
  const prompt = '#sem-shell-input';
  const log = '[role="log"]';

  const run = (command) => {
    cy.get(prompt).type(`${command}{enter}`);
    return cy.get(prompt);
  };
  const lastLine = () => cy.get(`${log} > :last-child`);
  // take the keyboard back from the page's autostart demo (no-op when it
  // has already finished); the tests then drive the prompt deterministically
  const takeOver = () => {
    // the autostart demo owns the keyboard from ~400ms in and plays for
    // several seconds: wait for it to actually start, then Escape it — an
    // Escape sent before the boot would be a no-op
    cy.get(prompt, { timeout: 15000 }).should('have.attr', 'readonly');
    cy.get(prompt).then(($input) => {
      $input[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    cy.get(prompt).should('not.have.attr', 'readonly');
  };

  const pressTab = () =>
    cy.get(prompt).then(($input) => {
      $input[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });

  describe('the prompt', () => {
    beforeEach(() => {
      cy.visit('/demo/shell.html');
      takeOver();
    });

    it('Escape hands the terminal back from a scripted demo', () => {
      // beforeEach's takeOver already stopped the boot demo: restart it,
      // wait for it to own the keyboard mid-flight, then Escape out
      cy.get('sem-shell').find('.sem-shell-replay').click();
      cy.get(prompt, { timeout: 15000 }).should('have.attr', 'readonly');
      cy.get(prompt).then(($input) => {
        $input[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      cy.get(prompt).should('not.have.attr', 'readonly'); // ours again
      cy.get(log).should('contain.text', 'playback stopped');
    });

    it('ls, cd, and cat navigate the demo tree', () => {
      run('ls').then(() => cy.get(log).should('contain.text', 'demo/'));
      run('cd demo');
      cy.get('.sem-shell-ps1').should('contain.text', '/demo');
      run('ls');
      cy.get(log).should('contain.text', 'welcome.html');
      run('cat welcome.html');
      cy.get(log).should('contain.text', 'SemText is');
    });

    it('pipes and redirects work end to end', () => {
      run('ls | grep demo');
      cy.get(log).should('contain.text', 'demo/');
      run('echo remembered > /notes.txt');
      run('cat /notes.txt');
      cy.get(log).should('contain.text', 'remembered');
    });

    it('mkdir -p, touch, ls -R, rm -r, and cp work through the UI', () => {
      run('mkdir -p /tmp-site/a/b');
      run('touch /tmp-site/a/b/leaf.txt');
      run('cp /tmp-site/a/b/leaf.txt /tmp-site/copy.txt');
      run('ls /tmp-site');
      cy.get(log).should('contain.text', 'copy.txt');
      run('rm -r /tmp-site/a');
      run('cat /tmp-site/copy.txt');
      cy.get(log).should('contain.text', 'leaf.txt'); // empty file; cat prints nothing
      cy.get(log).should('not.contain.text', 'No such file');
    });

    it('an unknown command reports exit status 127', () => {
      run('definitely-not-a-command');
      cy.get(log).should('contain.text', 'command not found');
      run('echo $?');
      cy.get(log).should('contain.text', '127');
    });
  });

  describe('Tab completion', () => {
    beforeEach(() => {
      cy.visit('/demo/shell.html');
      takeOver();
    });

    it('a single candidate extends quietly', () => {
      cy.get(prompt).type('cat demo/wel');
      pressTab();
      cy.get(prompt).should('have.value', 'cat demo/welcome.html ');
    });

    it('several candidates list as one comment line', () => {
      cy.get(prompt).type('cat demo/');
      pressTab();
      lastLine().should('contain.text', 'token-rotation.html').and('contain.text', 'render-demo.card');
    });
  });

  describe('history', () => {
    beforeEach(() => {
      cy.visit('/demo/shell.html');
      takeOver();
    });

    it('ArrowUp recalls the previous line', () => {
      run('echo first-mark');
      run('echo second-mark');
      cy.get(prompt).type('{upArrow}');
      cy.get(prompt).should('have.value', 'echo second-mark');
      cy.get(prompt).type('{enter}');
      cy.get(log).should('contain.text', 'second-mark');
    });
  });

  describe('durable storage', () => {
    beforeEach(() => {
      cy.visit('/demo/shell-storage.html');
      cy.clearLocalStorage(/^semtext:shell:v1:/).should((ls) => {
        expect(ls.getItem('semtext:shell:v1:shell-storage-demo')).to.be.null;
      });
      cy.reload();
    });

    it('edits survive a reload; storage reset restores the factory tree', () => {
      run('echo reload-proof > /reload.txt');
      cy.reload();
      run('cat /reload.txt');
      cy.get(log).should('contain.text', 'reload-proof');

      run('storage reset');
      cy.get(log).should('contain.text', 'factory content restored');
      run('cat /reload.txt');
      cy.get(log).should('contain.text', 'No such file'); // the factory tree is back
    });
  });

  describe('the no-JS document', () => {
    it('renders the static transcript with no bundle', () => {
      cy.visit('/demo/shell-storage.nojs.html');
      cy.get(log).should('contain.text', 'mkdir -p notes');
      cy.get(log).should('contain.text', 'echo remember-me > notes/todo.txt');
      cy.get('sem-shell').find('form').should('not.exist');
    });
  });

  describe('s3 mounts', () => {
    beforeEach(() => {
      cy.visit('/demo/shell.html');
      takeOver();
    });

    it('a public mount hydrates over an intercepted endpoint', () => {
      cy.intercept('GET', 'https://s3.test.invalid/bucket/?list-type=*', {
        statusCode: 200,
        body:
          '<?xml version="1.0"?><ListBucketResult><Contents><Key>docs/readme.txt</Key><Size>21</Size></Contents></ListBucketResult>',
      }).as('list');
      cy.intercept('GET', 'https://s3.test.invalid/bucket/docs/readme.txt', {
        statusCode: 200,
        body: 'served from the intercept\n',
      }).as('object');

      run('mount s3 https://s3.test.invalid/bucket/ /s3');
      cy.get(log).should('contain.text', 'hydrated');
      run('cat /s3/docs/readme.txt'); // list keys are base-relative
      cy.get(log).should('contain.text', 'served from the intercept');
    });
  });

  describe('the context menu', () => {
    beforeEach(() => {
      cy.visit('/demo/shell.html');
      takeOver();
    });

    it('right-click and Shift+F10 open it; Copy and Select all act; the view switches to text and back; Escape closes', () => {
      const menu = () => cy.get('[role="menu"][aria-label="Terminal menu"]');
      const surface = () => cy.get('sem-shell').find('.sem-term-surface');
      // sem-shell extends sem-terminal — the paint attribute is on the shell
      const paint = () => cy.get('sem-shell');

      // the menu rides the paint surface (inputModel.attach) — wait for the
      // canvas path so the contextmenu listener is live, as for a user
      paint().should('have.attr', 'data-paint', 'canvas');

      // right-click opens, focus lands on the first enabled item, and Copy
      // (no selection yet — a silent no-op) activates and closes the menu
      surface().rightclick();
      menu().should('exist');
      cy.focused().should('have.attr', 'role', 'menuitem');
      cy.get('[data-menu-id="copy"]').click();
      cy.get('[role="menu"]').should('not.exist');

      // Shift+F10 on the terminal's key surface opens it again; Select all
      // takes the whole transcript and closes
      cy.get('.sem-shell-hidden-input').then(($el) => {
        $el[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }));
      });
      menu().should('exist');
      cy.get('[data-menu-id="select-all"]').click();
      cy.get('[role="menu"]').should('not.exist');

      // switch to the DOM (text) view and back; the label answers the
      // current view each time the menu is built
      surface().rightclick();
      menu().should('exist');
      cy.get('[data-menu-id="switch-view"]')
        .should('contain.text', 'Switch to text view')
        .click();
      paint().should('have.attr', 'data-paint', 'dom');
      cy.get('[role="menu"]').should('not.exist');

      surface().rightclick();
      menu().should('exist');
      cy.get('[data-menu-id="switch-view"]')
        .should('contain.text', 'Switch to canvas view')
        .click();
      paint().should('have.attr', 'data-paint', 'canvas');

      // Escape closes the menu without falling through to the terminal's
      // own Escape ladder (the menu swallows it) — and the shell lives on
      surface().rightclick();
      menu().should('exist');
      cy.focused().type('{esc}');
      cy.get('[role="menu"]').should('not.exist');
      run('echo alive-after-esc');
      cy.get(log).should('contain.text', 'alive-after-esc');
    });
  });
});
