/**
 * sem-file-tree — text-mode tree container (spec/schema/sem-file-tree.md).
 *
 * BDD source: spec/schema/sem-file-tree.md. Proves:
 *   - the core bundle registers the element (no CSS-only elements);
 *   - JS-off: the authored <pre> renders VERBATIM — the record is the
 *     record, nothing fabricated, no chrome;
 *   - JS-on (shared engine): the indentation parses to the same model the
 *     structured form uses; generated view rows support collapse
 *     (data-branch-hidden), filter and find; the authored pre stays in
 *     the DOM (hidden only under [data-sem-upgraded]);
 *   - the extraction invariant: the pre text is identical in both tiers.
 */
const PAGE = '/demo/workflows-trees.html';
const NOJS = '/demo/workflows-trees.nojs.html';
const BOX_PRE = /assets\/\n├── icons\/\n│   └── logo\.svg\n├── main\.css\n└── app\.js/;

describe('sem-file-tree (spec/schema/sem-file-tree.md)', () => {
  it('upgrades in the built page: registered component + generated view rows', () => {
    cy.visit(PAGE);
    cy.get('sem-file-tree#t-files').should(($el) => {
      expect($el[0].hasAttribute('data-sem-upgraded'), 'data-sem-upgraded claimed').to.eq(true);
      expect($el[0].ownerDocument.defaultView.customElements.get('sem-file-tree')).to.exist;
      // one row per parsed line, depth-annotated; the pre is still in the DOM
      expect($el.find('.sem-file-tree-view .sem-tree-view-row')).to.have.length(5);
      expect($el.find('.sem-file-tree-view .sem-tree-view-row[data-depth="2"]')).to.have.length(1);
      expect($el.find('> pre')).to.have.length(1);
      expect($el.find('.sem-tree-filter, .sem-tree-find')).to.have.length(2);
    });
    // the authored pre is hidden only under the upgrade marker
    cy.get('sem-file-tree#t-files > pre').should('not.be.visible');
    cy.get('sem-file-tree#t-files .sem-file-tree-view .sem-tree-toggle').should('have.length', 2); // assets, icons
  });

  it('the parsed model matches the authored pre line-for-line (one engine)', () => {
    cy.visit(PAGE);
    cy.get('sem-file-tree#t-files .sem-file-tree-view .sem-tree-view-row').should(($rows) => {
      // row label text (toggle or span) mirrors the pre's entry order
      const names = [...$rows].map((r) => r.textContent.trim());
      expect(names).to.eql(['assets', 'icons', 'logo.svg', 'main.css', 'app.js']);
      // a trailing slash parsed as a directory…
      const depths = [...$rows].map((r) => Number(r.getAttribute('data-depth')));
      expect(depths).to.eql([0, 1, 2, 1, 1]);
    });
  });

  it('collapse on generated rows hides descendant rows', () => {
    cy.visit(PAGE);
    // assets branch starts open; icons has a child (logo.svg)
    cy.get('sem-file-tree#t-files .sem-tree-toggle').eq(1).click(); // icons
    cy.get('sem-file-tree#t-files .sem-file-tree-view .sem-tree-view-row').should(($rows) => {
      const hidden = [...$rows].filter((r) => r.hasAttribute('data-branch-hidden'));
      expect(hidden).to.have.length(1);
      expect(hidden[0].textContent).to.contain('logo.svg');
    });
    cy.get('sem-file-tree#t-files .sem-tree-toggle').eq(1).click(); // reopen
    cy.get('sem-file-tree#t-files [data-branch-hidden]').should('have.length', 0);
  });

  it('filter + find work over the generated rows', () => {
    cy.visit(PAGE);
    cy.get('sem-file-tree#t-files .sem-tree-filter').type('main');
    cy.get('sem-file-tree#t-files').should(($el) => {
      const visible = [...$el[0].querySelectorAll('.sem-tree-view-row')].filter(
        (r) => !r.hasAttribute('data-filter-hidden')
      );
      expect(visible.map((r) => r.textContent.trim())).to.eql(['assets', 'main.css']);
    });
    cy.get('sem-file-tree#t-files .sem-tree-find').type('svg').type('{enter}');
    cy.get('sem-file-tree#t-files [data-match-current]').should('have.length', 1);
    // the current mark rides the logo.svg ROW, not a sibling (identity mapping)
    cy.get('sem-file-tree#t-files [data-match-current]').should(
      'contain.text',
      'logo.svg'
    );
    cy.get('sem-file-tree#t-files .sem-tree-count').should('contain.text', '1 of 1');
  });

  it('JS-off: the authored pre is verbatim and nothing is fabricated', () => {
    cy.visit(NOJS);
    cy.get('sem-file-tree#t-files').should(($el) => {
      expect($el[0].ownerDocument.querySelector('[data-sem-upgraded]')).to.eq(null);
      expect($el.find('.sem-file-tree-view')).to.have.length(0);
      expect($el.find('.sem-tree-chrome')).to.have.length(0);
      expect($el.find('> pre').text()).to.match(BOX_PRE);
    });
    cy.get('sem-file-tree#t-files > pre').should('be.visible');
  });

  it('extraction invariant — the authored pre is byte-identical across tiers', () => {
    let live;
    cy.visit(PAGE)
      .get('sem-file-tree#t-files > pre')
      .then(($pre) => {
        live = $pre[0].textContent;
      });
    cy.visit(NOJS);
    cy.get('sem-file-tree#t-files > pre').should(($pre) => {
      expect($pre[0].textContent).to.eq(live);
    });
  });
});
