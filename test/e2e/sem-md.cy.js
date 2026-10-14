// BDD spec — sem-md · source: spec/schema/sem-md.md
//
// Feature: a Markdown block rendered in the browser — fallback (Markdown
//          bundle) and Lit tiers behave identically; JS-off the raw
//          Markdown reads as preformatted text
//   Scenario: chrome is the first child — label, toggle (aria-pressed), copy, status
//   Scenario: a GFM table renders as thead/th[scope=col]/tbody with the alignment row honoured
//   Scenario: headings, emphasis, links (rel=noopener) and code spans render
//   Scenario: lists nest, block quotes, thematic breaks and fenced code render
//   Scenario: toggle shows the authored Markdown in a sem-code fence and back
//   Scenario: copy writes the normalised Markdown and announces "Copied"
//   Scenario: view-as="raw" is honoured as the initial mode
//   Scenario: default controls = toggle + copy
//   Scenario: script-injection Markdown renders as text; scheme bypasses (tab / control / newline /
//             uppercase / data: / angle-bracket form) lose their href in link AND image position;
//             a legitimate image, relative link, fragment and autolink render
//   Scenario: edge cases — setext heading, deep tight list, ol start, `* * *` rule, hard break,
//             intraword underscore, reference link stays literal, escaped pipe, pipe in code span,
//             ragged rows, backticks inside a ~~~ fence
//   Scenario: print — rendered body only, whatever the view
//   Scenario: alone (md bundle only) — element marked, root not; fence gains chrome on re-entry;
//             pathological input (10k `*`, 5000 `>`, 40-deep list) renders in bounded time
//   Scenario: element form — one chrome, same behaviour, handoff markers
//   Scenario: JS-off — no chrome, the raw Markdown visible as pre-wrapped text

const TABLE_SOURCE =
  '#### Lifetimes\n' +
  '\n' +
  'Every *session* mints a **short-lived** token; see [RFC 6749](https://www.rfc-editor.org/rfc/rfc6749) and `rotate()`.\n' +
  '\n' +
  '| Token   | Lifetime | Rotates |\n' +
  '| :------ | -------: | :-----: |\n' +
  '| access  | 15 min   | no      |\n' +
  '| refresh | 30 days  | yes     |';

const cs = (el, pseudo) => el.ownerDocument.defaultView.getComputedStyle(el, pseudo);

const visitWithClipboard = (url) =>
  cy.visit(url, {
    onBeforeLoad(win) {
      cy.stub(win.navigator.clipboard, 'writeText').as('write').resolves();
    }
  });

function assertMd(url, marker) {
  beforeEach(() => visitWithClipboard(url));

  it('carries the upgrade marker for this page', () => {
    cy.get('#m-table').should('have.attr', marker);
  });

  it('renders exactly one chrome as the first child: label, toggle, copy, status', () => {
    cy.get('#m-table > .sem-md-chrome').should('have.length', 1);
    cy.get('#m-table > :first-child').should('have.class', 'sem-md-chrome');
    cy.get('#m-table .sem-md-label').should('have.text', 'Token lifetimes');
    cy.get('#m-table .sem-md-chrome button').then(($b) => {
      expect(Array.from($b, (b) => b.getAttribute('data-act'))).to.deep.equal(['toggle', 'copy']);
      $b.each((_, b) => expect(b.getAttribute('type')).to.equal('button'));
    });
    cy.get('#m-table [data-act="toggle"]').should('have.attr', 'aria-pressed', 'false');
    cy.get('#m-table [data-act="copy"]').should('have.attr', 'aria-label', 'Copy Markdown');
    cy.get('#m-table .sem-md-status').should('have.attr', 'role', 'status');
    cy.get('#m-table > .sem-md-body').should('have.length', 1);
    cy.get('#m-table > .sem-md-raw').should('have.length', 1);
    cy.get('#m-table').should('have.attr', 'data-view-as', 'rendered');
  });

  it('renders the GFM table with native semantics and the alignment row', () => {
    cy.get('#m-table .sem-md-body table').should('have.length', 1);
    cy.get('#m-table .sem-md-body thead th').then(($th) => {
      expect($th).to.have.length(3);
      $th.each((_, th) => expect(th.getAttribute('scope')).to.equal('col'));
      expect(Array.from($th, (th) => th.textContent)).to.deep.equal(['Token', 'Lifetime', 'Rotates']);
      expect($th[0].style.textAlign).to.equal('left');
      expect($th[1].style.textAlign).to.equal('right');
      expect($th[2].style.textAlign).to.equal('center');
    });
    cy.get('#m-table .sem-md-body tbody tr').should('have.length', 2);
    cy.get('#m-table .sem-md-body tbody tr').first().find('td').then(($td) => {
      expect(Array.from($td, (td) => td.textContent)).to.deep.equal(['access', '15 min', 'no']);
      expect($td[1].style.textAlign).to.equal('right');
    });
  });

  it('renders headings, emphasis, links and code spans', () => {
    cy.get('#m-table .sem-md-body h4').should('have.text', 'Lifetimes');
    cy.get('#m-table .sem-md-body p em').should('have.text', 'session');
    cy.get('#m-table .sem-md-body p strong').should('have.text', 'short-lived');
    cy.get('#m-table .sem-md-body p a')
      .should('have.text', 'RFC 6749')
      .should('have.attr', 'href', 'https://www.rfc-editor.org/rfc/rfc6749')
      .should('have.attr', 'rel', 'noopener noreferrer');
    cy.get('#m-table .sem-md-body p code').should('have.text', 'rotate()');
  });

  it('renders nested lists, a block quote, a rule and fenced code', () => {
    cy.get('#m-raw .sem-md-body > ul > li').should('have.length', 2);
    cy.get('#m-raw .sem-md-body > ul > li').eq(1).find('ul > li').should('have.text', 'nested item');
    cy.get('#m-raw .sem-md-body > ol > li').should('have.length', 2);
    cy.get('#m-raw .sem-md-body blockquote p').should('have.text', 'A quoted line.');
    cy.get('#m-raw .sem-md-body hr').should('have.length', 1);
    cy.get('#m-raw .sem-md-body pre > code').should('have.class', 'language-sh')
      .and('have.text', 'curl -sS "$TOKEN_ENDPOINT"');
  });

  it('toggle shows the authored Markdown in a sem-code fence, and back', () => {
    cy.get('#m-table .sem-md-body').should('be.visible');
    cy.get('#m-table .sem-md-raw').should('not.be.visible');
    cy.get('#m-table [data-act="toggle"]').click();
    cy.get('#m-table').should('have.attr', 'data-view-as', 'raw');
    cy.get('#m-table [data-act="toggle"]').should('have.attr', 'aria-pressed', 'true');
    cy.get('#m-table .sem-md-body').should('not.be.visible');
    cy.get('#m-table .sem-md-raw').should('be.visible');
    cy.get('#m-table .sem-md-raw .sem-code').should('have.attr', 'data-lang', 'markdown');
    cy.get('#m-table .sem-md-raw .sem-code > .sem-code-chrome').should('have.length', 1);
    cy.get('#m-table .sem-md-raw .sem-code-chrome button').should('have.length', 2);
    cy.get('#m-table .sem-md-raw code').then(($c) => expect($c[0].textContent).to.equal(TABLE_SOURCE));
    cy.get('#m-table [data-act="toggle"]').click();
    cy.get('#m-table').should('have.attr', 'data-view-as', 'rendered');
    cy.get('#m-table [data-act="toggle"]').should('have.attr', 'aria-pressed', 'false');
    cy.get('#m-table .sem-md-body').should('be.visible');
  });

  it('copy writes the normalised Markdown and announces "Copied"', () => {
    cy.get('#m-table > .sem-md-chrome [data-act="copy"]').click();
    cy.get('@write').should('have.been.calledWith', TABLE_SOURCE);
    cy.get('#m-table .sem-md-status').should('have.text', 'Copied');
  });

  it('view-as="raw" is honoured as the initial mode', () => {
    cy.get('#m-raw').should('have.attr', 'data-view-as', 'raw');
    cy.get('#m-raw [data-act="toggle"]').should('have.attr', 'aria-pressed', 'true');
    cy.get('#m-raw .sem-md-raw').should('be.visible');
    cy.get('#m-raw .sem-md-body').should('not.be.visible');
  });

  it('default controls render toggle and copy; controls="copy" renders copy only', () => {
    cy.get('#m-raw .sem-md-chrome button').should('have.length', 2);
    cy.get('#m-inject .sem-md-chrome button').should('have.length', 1);
    cy.get('#m-inject .sem-md-chrome button').should('have.attr', 'data-act', 'copy');
    cy.get('#m-inject .sem-md-label').should('not.exist');
  });

  it('script-injection Markdown renders as text; unsafe schemes lose their href, safe ones keep it', () => {
    cy.get('#m-inject .sem-md-body script').should('not.exist');
    cy.get('#m-inject .sem-md-body p').first().invoke('text').then((t) => {
      expect(t).to.contain('<script>alert(1)</script>');
      expect(t).to.contain('<img src=x onerror=alert(1)>');
      expect(t).to.contain('click');
    });
    cy.get('#m-inject .sem-md-body a').then(($a) => {
      // hrefs are absolute: the parsed URL's href is what is written
      const abs = (u) => new URL(u, $a[0].ownerDocument.baseURI).href;
      const hrefs = Array.from($a, (a) => a.getAttribute('href'));
      expect(hrefs).to.deep.equal(['docs/x.html', '#m-table', 'https://example.com/a?b=1'].map(abs));
      $a.each((_, a) => expect(a.getAttribute('rel')).to.equal('noopener noreferrer'));
    });
    // the bypass attempts are still readable as their link text
    cy.get('#m-inject .sem-md-body').invoke('text').then((t) => {
      ['click', 'tab', 'ctl', 'up', 'data', 'vb', 'tabimg', 'dataimg'].forEach((w) => expect(t).to.contain(w));
      expect(t).not.to.contain('[rel]');
    });
    cy.get('#m-inject .sem-md-body img').should('have.length', 1).then(($i) => {
      expect($i[0].getAttribute('src')).to.equal(new URL('/img/ok.png', $i[0].ownerDocument.baseURI).href);
    });
    cy.get('#m-inject .sem-md-body a').last().should('have.text', 'https://example.com/a?b=1');
  });

  it('edge cases: setext, nesting, start, rule vs list, hard break, underscores, pipes, fences', () => {
    cy.get('#m-edge .sem-md-body > h2').first().should('have.text', 'Setext');
    cy.get('#m-edge .sem-md-body > ul > li').should('have.length', 2);
    cy.get('#m-edge .sem-md-body > ul > li > ul > li > ul > li').should('have.text', 'four');
    cy.get('#m-edge .sem-md-body > ol').should('have.attr', 'start', '3').find('> li').should('have.length', 2);
    cy.get('#m-edge .sem-md-body > ol > li > p').should('not.exist');
    cy.get('#m-edge .sem-md-body > hr').should('have.length', 1);
    cy.get('#m-edge .sem-md-body p br').should('have.length', 1);
    cy.get('#m-edge .sem-md-body p em').first().should('have.text', 'emph');
    cy.get('#m-edge .sem-md-body').invoke('text').then((t) => {
      expect(t).to.contain('snake_case_name');
      expect(t).to.contain('foo_bar_baz');
      expect(t).to.contain('[ref][x]');
    });
    cy.get('#m-edge .sem-md-body tbody tr').should('have.length', 3);
    cy.get('#m-edge .sem-md-body tbody tr').eq(0).find('td').then(($td) => {
      expect($td[0].textContent).to.equal('a | b');
      expect($td[1].querySelector('code').textContent).to.equal('x | y');
    });
    cy.get('#m-edge .sem-md-body tbody tr').eq(1).find('td').should('have.length', 2).last().should('have.text', '');
    cy.get('#m-edge .sem-md-body tbody tr').eq(2).find('td').should('have.length', 2);
    cy.get('#m-edge .sem-md-body pre > code').should('have.class', 'language-md')
      .and('have.text', '```js\ninner\n```');
    // adversarial: unmatched openers stay literal, the real ones still parse
    cy.get('#m-edge .sem-md-body p em').should('have.length', 2).last().should('have.text', 'real');
    cy.get('#m-edge .sem-md-body a').should('have.length', 5);
    cy.get('#m-edge .sem-md-body a').first().should('have.text', 'linked').then(($a) => {
      expect($a[0].getAttribute('href')).to.match(/#m-table$/);
    });
    cy.get('#m-edge .sem-md-body').invoke('text').then((t) => {
      expect(t).to.contain('*unclosed emphasis and real');
      expect(t).to.contain('[unclosed link and linked');
    });
    // the closing backtick run must match the opener's length
    cy.get('#m-edge .sem-md-body p code').last().should('have.text', 'a` b');
    // a space inside an angle-bracket destination is kept (percent-encoded), not stripped
    cy.get('#m-edge .sem-md-body a').then(($a) => {
      const abs = (u) => new URL(u, $a[0].ownerDocument.baseURI).href;
      const hrefs = Array.from($a, (a) => a.getAttribute('href'));
      expect(hrefs[hrefs.length - 1]).to.equal(abs('my file.html'));
      expect(hrefs[hrefs.length - 1]).to.match(/my%20file\.html$/);
      // authored escapes survive untouched (no double-encoding, no decoding)
      expect(hrefs).to.include(abs('docs/a%20b%23c.html'));
      expect(hrefs.some((h) => h.endsWith('/docs/a%20b%23c.html'))).to.equal(true);
      // an authored escape next to a character the URL parser leaves alone
      expect(hrefs).to.include(abs('docs/a%20b|c.html'));
      // a literal %25 followed by hex digits is NOT collapsed to %41
      expect(hrefs.some((h) => h.endsWith('/docs/%2541.html'))).to.equal(true);
    });
    // a bare --- under a paragraph line is a setext heading even when the line has a pipe;
    // a table needs a delimiter row with pipes
    cy.get('#m-edge .sem-md-body > h2').should('have.length', 2).last().should('have.text', 'a | b');
    cy.get('#m-edge .sem-md-body table').should('have.length', 1);
  });
}

const emulate = (params) =>
  cy.wrap(null, { log: false }).then(() =>
    Cypress.automation('remote:debugger:protocol', { command: 'Emulation.setEmulatedMedia', params }));

describe('sem-md', () => {
  describe('class form — /demo/reading.html', () => {
    assertMd('/demo/reading.html', 'data-sem-upgraded');
  });

  describe('element form — /demo/reading-lit.html', () => {
    it('registers the custom element', () => {
      cy.visit('/demo/reading-lit.html');
      cy.window().then((win) => expect(win.customElements.get('sem-md')).to.exist);
    });
    assertMd('/demo/reading-lit.html', 'data-sem-upgraded');
  });

  describe('print', () => {
    afterEach(() => emulate({ media: '', features: [] }));
    it('shows the rendered body only, in both views', () => {
      cy.visit('/demo/reading.html');
      cy.get('#m-raw').should('have.attr', 'data-view-as', 'raw');
      emulate({ media: 'print' });
      ['#m-table', '#m-raw'].forEach((id) => {
        cy.get(id + ' .sem-md-body').should('be.visible');
        cy.get(id + ' .sem-md-chrome').should('not.be.visible');
        cy.get(id + ' .sem-md-raw').should('not.be.visible');
      });
    });
  });

  describe('everywhere — /demo/md-only.html (the one bundle carries md into every document)', () => {
    beforeEach(() => cy.visit('/demo/md-only.html'));

    it('marks the element and the root; the raw fence ships with its chrome', () => {
      cy.get('#mo-table').should('have.attr', 'data-sem-upgraded');
      cy.get('html').should('have.attr', 'data-sem-upgraded');
      // the deck is a plain list — no handler claims it — but the root marker
      // is document-wide, so the quiz decoy hides all the same (D12)
      cy.get('#decoy').should('not.be.visible');
      cy.get('#mo-table .sem-md-body tbody td').first().should('have.text', '1');
      cy.get('#mo-table .sem-md-raw .sem-code[data-lang="markdown"]').should('exist');
      cy.get('#mo-table .sem-md-raw .sem-code > .sem-code-chrome').should('have.length', 1);
      cy.get('#mo-table > .sem-md-chrome').should('have.length', 1);
      // a host re-run is idempotent: no duplicate chrome appears
      cy.window().then((win) => win.SemText.enhanceMdDocument(win.document));
      cy.get('#mo-table .sem-md-raw .sem-code > .sem-code-chrome').should('have.length', 1);
      cy.get('#mo-table > .sem-md-chrome').should('have.length', 1);
    });

    it('renders pathological input in bounded time without losing content', () => {
      cy.window().then((win) => {
        const make = (id, text) => {
          const d = win.document.createElement('div');
          d.className = 'sem-md';
          d.id = id;
          d.textContent = text;
          win.document.querySelector('.sem-enhanced-document').appendChild(d);
          return d;
        };
        make('p-stars', '*'.repeat(10000) + ' end');
        make('p-quotes', '>'.repeat(5000) + ' deep');
        make('p-list', Array.from({ length: 40 }, (_, k) => '  '.repeat(k) + '- L' + k).join('\n'));
        make('p-nl', '[nl](<java\nscript:alert(1)>) ![nlimg](<java\nscript:alert(1)>)');
        make('p-surrogate', '[lone](docs/\ud800.html) after');
        const t0 = win.performance.now();
        win.SemText.enhanceMdDocument(win.document);
        expect(win.performance.now() - t0).to.be.lessThan(2000);
      });
      cy.get('#p-stars .sem-md-body').invoke('text').then((t) => expect(t).to.contain('*'.repeat(10000) + ' end'));
      cy.get('#p-quotes .sem-md-body blockquote').should('have.length.greaterThan', 10);
      cy.get('#p-quotes .sem-md-body').invoke('text').then((t) => expect(t).to.contain('deep'));
      cy.get('#p-list .sem-md-body').invoke('text').then((t) => { expect(t).to.contain('L0'); expect(t).to.contain('L39'); });
      cy.get('#p-list .sem-md-body ul').should('have.length.greaterThan', 10);
      cy.get('#p-nl .sem-md-body a, #p-nl .sem-md-body img').should('not.exist');
      cy.get('#p-nl .sem-md-body').should('contain.text', 'nl');
      // a lone surrogate is replaced by the URL parser (U+FFFD, percent-encoded); nothing throws
      cy.get('#p-surrogate .sem-md-body a').should('have.length', 1).then(($a) => {
        expect($a[0].getAttribute('href')).to.match(/%EF%BF%BD\.html$/);
      });
      cy.get('#p-surrogate .sem-md-body').should('contain.text', 'lone').and('contain.text', 'after');
      cy.get('#p-surrogate > .sem-md-chrome').should('exist');
      cy.get('#p-stars, #p-quotes, #p-list').each(($e) => cy.wrap($e).should('have.attr', 'data-sem-upgraded'));
    });
  });

  describe('JS-off', () => {
    ['/demo/reading.nojs.html', '/demo/reading-lit.nojs.html'].forEach((url) => {
      it(url + ' — no chrome, the raw Markdown visible as pre-wrapped text', () => {
        cy.visit(url);
        cy.get('.sem-md-chrome, .sem-md-body, .sem-md-raw').should('not.exist');
        cy.get('#m-table').should('be.visible');
        cy.get('#m-table').invoke('text').then((t) => {
          expect(t).to.contain('| :------ | -------: | :-----: |');
        });
        cy.get('#m-table').then(($m) => expect(cs($m[0]).whiteSpace).to.match(/pre-wrap|break-spaces/));
        cy.get('#m-table table').should('not.exist');
      });
    });
  });
});
