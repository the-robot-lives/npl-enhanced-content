// BDD spec — sem-code · source: spec/schema/sem-code.md
//
// Feature: a verbatim listing with provenance chrome, marked lines, copy
//          and wrap controls — the one bundle behaves identically over the
//          class alias and the element form; JS-off it is a plain <pre>
//   Scenario: chrome is the first child — filename, lang badge, controls in order
//   Scenario: lines wrapped, marked lines are <mark>, text byte-identical
//   Scenario: copy writes the listing and announces via the status region
//   Scenario: wrap toggles data-wrap and reflects aria-pressed
//   Scenario: an overflowing <pre> is focusable and labelled
//   Scenario: default controls = copy only
//   Scenario: element form — one chrome, same behaviour, claimed marker
//   Scenario: JS-off — no chrome, no line spans, caption via CSS

const SOURCE =
  'export function rotate(pair: Pair): Pair {\n' +
  '  const next = mint();\n' +
  '  retire(pair.refresh);\n' +
  '  return next;\n' +
  '}';

const cs = (el, pseudo) => el.ownerDocument.defaultView.getComputedStyle(el, pseudo);

const visitWithClipboard = (url) =>
  cy.visit(url, {
    onBeforeLoad(win) {
      // Deterministic: headless Electron may deny the real clipboard.
      cy.stub(win.navigator.clipboard, 'writeText').as('write').resolves();
    }
  });

function assertCode(url, marker) {
  beforeEach(() => visitWithClipboard(url));

  it('carries the upgrade marker for this page', () => {
    cy.get('#c-rotate').should('have.attr', marker.present);
    if (marker.absent) cy.get('#c-rotate').should('not.have.attr', marker.absent);
  });

  it('renders exactly one chrome as the first child, in controls order', () => {
    cy.get('#c-rotate > .sem-code-chrome').should('have.length', 1);
    cy.get('#c-rotate > :first-child').should('have.class', 'sem-code-chrome');
    cy.get('#c-rotate .sem-code-filename').should('have.text', 'src/rotate.ts');
    cy.get('#c-rotate .sem-code-lang').should('have.text', 'ts');
    cy.get('#c-rotate .sem-code-chrome button').then(($b) => {
      expect(Array.from($b, (b) => b.getAttribute('data-act'))).to.deep.equal(['copy', 'wrap']);
      $b.each((_, b) => expect(b.getAttribute('type')).to.equal('button'));
    });
    cy.get('#c-rotate .sem-code-status').should('have.attr', 'role', 'status');
  });

  it('wraps lines, marks 2,4-5 with <mark>, and keeps the text byte-identical', () => {
    cy.get('#c-rotate code .sem-code-line').should('have.length', 5);
    cy.get('#c-rotate code mark.sem-code-line').then(($m) => {
      expect($m).to.have.length(3);
      expect($m[0].textContent).to.equal('  const next = mint();');
    });
    cy.get('#c-rotate code').then(($c) => expect($c[0].textContent).to.equal(SOURCE));
  });

  it('copy writes the verbatim listing and announces "Copied"', () => {
    cy.get('#c-rotate [data-act="copy"]').click();
    cy.get('@write').should('have.been.calledWith', SOURCE);
    cy.get('#c-rotate .sem-code-status').should('have.text', 'Copied');
  });

  it('wrap toggles data-wrap on the element and aria-pressed on the button', () => {
    cy.get('#c-rotate [data-act="wrap"]').should('have.attr', 'aria-pressed', 'false').click();
    cy.get('#c-rotate').should('have.attr', 'data-wrap');
    cy.get('#c-rotate [data-act="wrap"]').should('have.attr', 'aria-pressed', 'true');
    cy.get('#c-rotate pre').then(($p) => expect(cs($p[0]).whiteSpace).to.match(/pre-wrap|break-spaces/));
    cy.get('#c-rotate [data-act="wrap"]').click();
    cy.get('#c-rotate').should('not.have.attr', 'data-wrap');
  });

  it('an overflowing <pre> is keyboard-reachable and labelled', () => {
    cy.get('#c-long pre').should('have.attr', 'tabindex', '0');
    cy.get('#c-long pre').should('have.attr', 'aria-label');
    cy.get('#c-rotate pre').should('not.have.attr', 'tabindex');
  });

  it('default controls render copy only', () => {
    cy.get('#c-long .sem-code-chrome button').should('have.length', 1);
    cy.get('#c-long .sem-code-chrome button').should('have.attr', 'data-act', 'copy');
    cy.get('#c-long .sem-code-filename').should('not.exist');
  });
}

describe('sem-code', () => {
  describe('class form — /demo/reading.html', () => {
    assertCode('/demo/reading.html', { present: 'data-sem-upgraded', absent: null });
  });

  describe('element form — /demo/reading-lit.html', () => {
    it('registers the custom element', () => {
      cy.visit('/demo/reading-lit.html');
      cy.window().then((win) => expect(win.customElements.get('sem-code')).to.exist);
    });
    assertCode('/demo/reading-lit.html', { present: 'data-sem-upgraded', absent: null });
  });

  describe('JS-off', () => {
    ['/demo/reading.nojs.html', '/demo/reading-lit.nojs.html'].forEach((url) => {
      it(url + ' — plain <pre>, caption from CSS, nothing generated', () => {
        cy.visit(url);
        cy.get('.sem-code-chrome, .sem-code-line, .sem-code-status').should('not.exist');
        cy.get('#c-rotate pre').should('be.visible');
        cy.get('#c-rotate code').then(($c) => expect($c[0].textContent).to.equal(SOURCE));
        cy.get('#c-rotate').then(($c) => {
          expect(cs($c[0], '::before').content).to.match(/src\/rotate\.ts|attr\(/);
        });
      });
    });
  });
});
