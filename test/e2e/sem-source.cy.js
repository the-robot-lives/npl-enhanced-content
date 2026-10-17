// BDD spec — sem-source · source: spec/schema/sem-source.md
//
// Feature: a transparent wrapper whose reader can flip a section between
//          its rendered form and the literal authored markup — one bundle,
//          identical over the class alias and the element form; JS-off it is
//          the rendered content and nothing else
//   Scenario: chrome is the first child — group, label, Rendered/Source with aria-pressed
//   Scenario: Source shows the authored markup (known substring) and no runtime chrome
//   Scenario: the fence is a sem-code with copy + wrap; copy writes the markup
//   Scenario: Rendered restores the content; the fence is built once
//   Scenario: an authored view-as="source" starts in source mode
//   Scenario: the snapshot script is inert text/plain
//   Scenario: element form — same behaviour, the component claims the marker
//   Scenario: focus stays on the activated button; print shows the rendered children
//   Scenario: audience `hidden`, nested wrappers, missing snapshot (warns), deep link into source mode
//   Scenario: JS-off — rendered content, no chrome, no fence, nothing hidden

const emulate = (params) =>
  cy.wrap(null, { log: false }).then(() =>
    Cypress.automation('remote:debugger:protocol', { command: 'Emulation.setEmulatedMedia', params })
  );

const visitWithClipboard = (url) =>
  cy.visit(url, {
    onBeforeLoad(win) {
      cy.stub(win.navigator.clipboard, 'writeText').as('write').resolves();
    }
  });

function assertSource(url, id, marker, authored) {
  beforeEach(() => visitWithClipboard(url));

  it('carries the upgrade marker for this page', () => {
    cy.get(id).should('have.attr', marker);
  });

  it('renders one chrome as the first child: a labelled group with Rendered | Source', () => {
    cy.get(`${id} > .sem-source-chrome`).should('have.length', 1);
    cy.get(`${id} > :first-child`).should('have.class', 'sem-source-chrome');
    cy.get(`${id} > .sem-source-chrome`).should('have.attr', 'role', 'group');
    cy.get(`${id} > .sem-source-chrome`).should('have.attr', 'aria-label', 'View as');
    cy.get(`${id} > .sem-source-chrome button`).then(($b) => {
      expect(Array.from($b, (b) => b.getAttribute('data-act'))).to.deep.equal(['html', 'source']);
      expect(Array.from($b, (b) => b.textContent)).to.deep.equal(['Rendered', 'Source']);
      $b.each((_, b) => expect(b.getAttribute('type')).to.equal('button'));
    });
    cy.get(`${id} [data-act="html"]`).should('have.attr', 'aria-pressed', 'true');
    cy.get(`${id} [data-act="source"]`).should('have.attr', 'aria-pressed', 'false');
    cy.get(`${id} .sem-source-fence`).should('not.exist');
  });

  it('Source shows the authored markup and hides the rendered children', () => {
    cy.get(`${id} [data-act="source"]`).click();
    cy.get(id).should('have.attr', 'data-view-as', 'source');
    cy.get(`${id} [data-act="source"]`).should('have.attr', 'aria-pressed', 'true');
    cy.get(`${id} [data-act="html"]`).should('have.attr', 'aria-pressed', 'false');
    cy.get(`${id} > .sem-source-fence`).should('be.visible');
    cy.get(`${id} > .sem-source-fence > .sem-code`)
      .should('have.attr', 'data-lang', 'html')
      .and('have.attr', 'data-sem-upgraded');
    cy.get(`${id} > .sem-source-fence code`).invoke('text').then((t) => {
      expect(t).to.contain(authored);
      // the markup is the document as written: no runtime chrome, no state
      expect(t).not.to.match(/sem-(facts|note|code|source)-chrome|sem-current|sem-source-raw|data-sem-(fallback|upgraded)/);
      // common indentation removed: the first line starts at column 0
      expect(t).to.match(/^\S/);
    });
    // every rendered child other than the chrome and fence is hidden
    cy.get(`${id} > :not(.sem-source-chrome, .sem-source-fence, script, template)`).each(($c) => {
      cy.wrap($c).should('not.be.visible');
    });
  });

  it('the fence is a sem-code with copy and wrap; copy writes the markup', () => {
    cy.get(`${id} [data-act="source"]`).click();
    cy.get(`${id} .sem-source-fence .sem-code-chrome button`).then(($b) => {
      expect(Array.from($b, (b) => b.getAttribute('data-act'))).to.deep.equal(['copy', 'wrap']);
    });
    cy.get(`${id} .sem-source-fence [data-act="copy"]`).click();
    cy.get('@write').should('have.been.calledOnce');
    cy.get('@write').then((w) => expect(w.firstCall.args[0]).to.contain(authored));
    cy.get(`${id} .sem-source-fence .sem-code-status`).should('have.text', 'Copied');
  });

  it('Rendered restores the content; the fence is built once and reused', () => {
    cy.get(`${id} [data-act="source"]`).click();
    cy.get(`${id} > .sem-source-fence`).should('be.visible');
    cy.get(`${id} [data-act="html"]`).click();
    cy.get(id).should('have.attr', 'data-view-as', 'html');
    cy.get(`${id} > .sem-source-fence`).should('not.be.visible');
    cy.get(`${id} > :not(.sem-source-chrome, .sem-source-fence, script, template)`).first().should('be.visible');
    cy.get(`${id} [data-act="source"]`).click();
    cy.get(`${id} > .sem-source-fence`).should('have.length', 1);
    cy.get(`${id} .sem-source-fence .sem-code`).should('have.length', 1);
  });

  it('keeps focus on the activated button and hides nothing from print', () => {
    cy.get(`${id} [data-act="source"]`).click();
    cy.focused().should('have.attr', 'data-act', 'source');
    cy.get(`${id} [data-act="html"]`).click();
    cy.focused().should('have.attr', 'data-act', 'html');
  });

  it('the snapshot is an inert template of cloned nodes, present once', () => {
    cy.get(`${id} > template.sem-source-raw`).should('have.length', 1);
    // template content is not in the document tree: serialise it to check.
    cy.get(`${id} > template.sem-source-raw`).then(($t) => {
      expect($t[0].innerHTML).to.contain(authored);
    });
  });
}

describe('sem-source', () => {
  describe('class form — /demo/index.html', () => {
    assertSource('/demo/index.html', '#s-flash',
      'data-sem-upgraded',
      '<div class="sem-facts" data-view-as="flashcards">');

    it('an authored data-view-as="source" starts in source mode', () => {
      cy.visit('/demo/index.html');
      cy.get('#s-initial').should('have.attr', 'data-view-as', 'source');
      cy.get('#s-initial > .sem-source-fence').should('be.visible');
      cy.get('#s-initial [data-act="source"]').should('have.attr', 'aria-pressed', 'true');
      cy.get('#s-initial .sem-source-fence code').invoke('text').should('contain', '<p id="s-initial-p">Plain prose');
      cy.get('#s-initial > p').should('not.be.visible');
      cy.get('#s-initial [data-act="html"]').click();
      cy.get('#s-initial > p').should('be.visible');
    });

    it('print media shows the rendered children even in source mode', () => {
      cy.visit('/demo/index.html');
      cy.get('#s-flash [data-act="source"]').click();
      cy.get('#s-flash > .sem-source-fence').should('be.visible');
      emulate({ media: 'print' });
      cy.get('#s-flash > .sem-source-fence').should('not.be.visible');
      cy.get('#s-flash > .sem-source-chrome').should('not.be.visible');
      cy.get('#s-flash .sem-fact').first().should('be.visible');
      emulate({ media: '', features: [] });
    });

    it('a child the audience fallback hid carries no `hidden` in the fence', () => {
      cy.visit('/demo/index.html');
      cy.get('#n-op').should('have.attr', 'hidden');
      cy.get('#s-audiences [data-act="source"]').click();
      cy.get('#s-audiences .sem-source-fence code').invoke('text').then((t) => {
        expect(t).to.contain('id="n-op"');
        expect(t).not.to.match(/\shidden(=""|\s|>)/);
      });
    });

    it('a deep link into a wrapper in source mode switches it back to rendered', () => {
      cy.visit('/demo/index.html#s-initial-p');
      cy.get('#s-initial').should('have.attr', 'data-view-as', 'html');
      cy.get('#s-initial-p').should('be.visible').and('have.class', 'sem-target');
      cy.get('#s-initial [data-act="html"]').should('have.attr', 'aria-pressed', 'true');
    });

    it('a nested wrapper is skipped with a warning; only the outer one snapshots', () => {
      cy.visit('/demo/index.html', {
        onBeforeLoad(win) {
          cy.stub(win.console, 'warn').as('warn');
          win.addEventListener('DOMContentLoaded', () => {
            const host = win.document.querySelector('.sem-enhanced-document');
            const outer = win.document.createElement('div');
            outer.className = 'sem-source'; outer.id = 's-outer';
            outer.innerHTML = '<p>outer</p><div class="sem-source" id="s-inner"><p>inner</p></div>';
            host.appendChild(outer);
          }, true);
        }
      });
      cy.get('#s-outer > template.sem-source-raw').should('have.length', 1);
      cy.get('#s-inner > template.sem-source-raw').should('not.exist');
      cy.get('@warn').should('have.been.calledWithMatch', /sem-source: nested/);
      cy.get('#s-inner > .sem-source-chrome').should('not.exist');
      cy.get('#s-outer > .sem-source-chrome [data-act="source"]').click();
      cy.get('#s-outer .sem-source-fence code').invoke('text').should('contain', 'id="s-inner"');
    });

    it('without a core snapshot the fence falls back to the live DOM and warns', () => {
      cy.visit('/demo/index.html', { onBeforeLoad(win) { cy.stub(win.console, 'warn').as('warn'); } });
      cy.window().then((win) => {
        const el = win.document.createElement('div');
        el.className = 'sem-source';
        el.id = 's-nosnap';
        el.innerHTML = '<p>late</p>';
        win.document.querySelector('.sem-enhanced-document').appendChild(el);
        win.SemText.enhanceSourceElement(el);
      });
      cy.get('@warn').should('have.been.calledWithMatch', /sem-source: no core snapshot/);
      cy.get('#s-nosnap [data-act="source"]').click();
      cy.get('#s-nosnap .sem-source-fence code').should('have.text', '<p>late</p>');
    });

    describe('fidelity (watcher notes on #17)', () => {
      const fence = () => {
        cy.visit('/demo/index.html');
        cy.get('#s-fidelity > .sem-source-chrome [data-act="source"]').click();
        return cy.get('#s-fidelity .sem-source-fence code').invoke('text');
      };

      it('prose that looks like the upgrade marker is left alone', () => {
        fence().then((t) => {
          expect(t).to.contain('text data-sem-upgraded="" is prose');
          expect(t).to.contain('<p id="s-fid-text">');
        });
      });

      it('dedent never touches lines inside a preformatted block', () => {
        fence().then((t) => {
          expect(t).to.contain('<pre id="s-fid-pre"><code>top\n      keep six\n  keep two</code></pre>');
          // negative case: every non-preformatted line lost the section indent
          expect(t).to.match(/^<p id="s-fid-text">/);
          expect(t).to.contain('\n<pre id="s-fid-pre">');
          expect(t).to.contain('\n<script type="text/plain" id="s-fid-raw">');
          expect(t).not.to.match(/\n[ \t]+</);
        });
      });

      it('an authored `<\\/script` sequence and a real end tag both round-trip', () => {
        fence().then((t) => {
          expect(t).to.contain('before <\\/script after</script>');
        });
      });

      it('a deep link to a DESCENDANT of a source-mode wrapper resolves with the core alone (no chrome)', () => {
        // #s-initial-p is a <p> inside #s-initial: the resolver's ancestor
        // chain, not the target itself, is what matches the wrapper.
        cy.visit('/demo/index.html');
        cy.get('#s-initial').should('have.attr', 'data-view-as', 'source');
        cy.get('#s-initial > .sem-source-chrome').then(($c) => $c.remove());
        cy.window().then((win) => { win.location.hash = '#s-initial-p'; });
        cy.get('#s-initial').should('have.attr', 'data-view-as', 'html');
        cy.get('#s-initial-p').should('be.visible');
      });
    });

    it('a rendered child keeps its own behaviour before and after a round trip', () => {
      cy.visit('/demo/index.html');
      cy.get('#s-flash .sem-fact.sem-current').should('be.visible');
      cy.get('#s-flash [data-act="source"]').click();
      cy.get('#s-flash [data-act="html"]').click();
      cy.get('#s-flash .sem-facts-chrome').should('be.visible');
      cy.get('#s-flash .sem-fact.sem-current').should('be.visible');
    });
  });

  describe('element form — /demo/reading-lit.html', () => {
    it('registers the custom element', () => {
      cy.visit('/demo/reading-lit.html');
      cy.window().then((win) => expect(win.customElements.get('sem-source')).to.exist);
    });
    assertSource('/demo/reading-lit.html', '#s-lit',
      'data-sem-upgraded',
      '<sem-code');

    it('the fence shows a Lit-upgraded note as authored: no role, no data-variant, no reflected default', () => {
      cy.visit('/demo/reading-lit.html');
      cy.get('#s-lit-note').should('have.attr', 'role', 'note').and('have.attr', 'data-variant', 'tip');
      cy.get('#s-lit [data-act="source"]').click();
      cy.get('#s-lit .sem-source-fence code').invoke('text').then((t) => {
        expect(t).to.contain('<sem-note id="s-lit-note" variant="tip">');
        expect(t).not.to.match(/role=|data-variant=|variant="info"|data-sem-upgraded/);
      });
    });
  });

  describe('JS-off', () => {
    it('/demo/index.nojs.html — rendered content, no chrome, no fence, nothing hidden', () => {
      cy.visit('/demo/index.nojs.html');
      cy.get('.sem-source-chrome, .sem-source-fence, .sem-source-raw').should('not.exist');
      cy.get('#s-flash .sem-fact').each(($f) => cy.wrap($f).should('be.visible'));
      // an authored source mode still reads as HTML when nothing can build a fence
      cy.get('#s-initial').should('have.attr', 'data-view-as', 'source');
      cy.get('#s-initial > p').should('be.visible');
    });

    it('/demo/reading-lit.nojs.html — the same for the element form', () => {
      cy.visit('/demo/reading-lit.nojs.html');
      cy.get('.sem-source-chrome, .sem-source-fence, .sem-source-raw').should('not.exist');
      cy.get('#s-lit > :not(script)').each(($c) => cy.wrap($c).should('be.visible'));
    });
  });
});
