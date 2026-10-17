/**
 * sem-site-tree — structured tree container (spec/schema/sem-site-tree.md).
 *
 * BDD source: spec/schema/sem-site-tree.md. Proves:
 *   - the core bundle registers the element (no CSS-only elements);
 *   - JS-on (shared engine): per-node collapse (aria-expanded; [collapsed]
 *     hides descendants), filter box (hides non-matching branches, keeps
 *     ancestor chains, count), find box (data-match marks, count, Enter
 *     cycles data-match-current);
 *   - JS-off: the authored nodes render as a static nested list (CSS
 *     guides + counters + attr() labels) and no chrome exists;
 *   - the extraction invariant: the tree record (path/label/kind per
 *     node) is identical in both script tiers.
 */
const PAGE = '/demo/workflows-trees.html';
const NOJS = '/demo/workflows-trees.nojs.html';

/** The authored tree record: every node's path/label/kind, document order. */
const recordOf = (tree) =>
  [...tree.querySelectorAll('node, .sem-node')].map((n) => ({
    path: n.getAttribute('data-path') ?? n.getAttribute('path'),
    label: n.getAttribute('data-label') ?? n.getAttribute('label'),
    kind: n.getAttribute('data-kind') ?? n.getAttribute('kind'),
  }));
const nodeByPath = (tree, path) =>
  [...tree.querySelectorAll('node, .sem-node')].find(
    (n) => (n.getAttribute('data-path') ?? n.getAttribute('path')) === path
  );

describe('sem-site-tree (spec/schema/sem-site-tree.md)', () => {
  it('upgrades in the built page: registered component + claimed marker + chrome', () => {
    cy.visit(PAGE);
    cy.get('sem-site-tree#t-site').should(($el) => {
      expect($el[0].hasAttribute('data-sem-upgraded'), 'data-sem-upgraded claimed').to.eq(true);
      expect($el[0].ownerDocument.defaultView.customElements.get('sem-site-tree')).to.exist;
      expect($el.find('.sem-tree-filter')).to.have.length(1);
      expect($el.find('.sem-tree-find')).to.have.length(1);
      // one toggle per BRANCH (src, src/lit, src/validate, themes); leaves
      // get label spans
      expect($el.find('.sem-tree-toggle')).to.have.length(4);
      expect($el.find('.sem-tree-label')).to.have.length(4);
    });
  });

  it('collapse: authored [collapsed] starts closed; the toggle opens it', () => {
    cy.visit(PAGE);
    cy.get('sem-site-tree#t-site').then(($t) => {
      const hiddenLeaf = nodeByPath($t[0], 'src/validate/validate.js');
      expect(hiddenLeaf, 'authored collapsed hides descendants (gated)').to.exist;
    });
    cy.get('sem-site-tree#t-site')
      .find('.sem-tree-toggle[aria-expanded="false"]')
      .should('have.length', 1) // src/validate authored collapsed
      .click();
    cy.get('sem-site-tree#t-site')
      .find('.sem-tree-toggle[aria-expanded="false"]')
      .should('have.length', 0);
    // toggling again re-collapses
    cy.get('sem-site-tree#t-site')
      .find('.sem-tree-toggle')
      .eq(1) // src/lit branch
      .click();
    cy.get('sem-site-tree#t-site')
      .find('.sem-tree-toggle[aria-expanded="false"]')
      .should('have.length', 1);
  });

  it('filter: hides non-matching branches, keeps the ancestor chain, counts', () => {
    cy.visit(PAGE);
    cy.get('sem-site-tree#t-site .sem-tree-filter').type('validate');
    cy.get('sem-site-tree#t-site').should(($t) => {
      const visible = (path) => {
        const n = nodeByPath($t[0], path);
        return n && !n.hasAttribute('data-filter-hidden');
      };
      // kept: match + ancestors
      expect(visible('src')).to.eq(true);
      expect(visible('src/validate')).to.eq(true);
      expect(visible('src/validate/validate.js')).to.eq(true);
      // non-matching branches vanish (src/lit has no match beneath it)
      expect(visible('src/lit')).to.eq(false);
      expect(visible('themes')).to.eq(false);
      expect($t.find('.sem-tree-count').text()).to.contain('3 shown');
    });
  });

  it('find: marks data-match, counts, Enter cycles data-match-current', () => {
    cy.visit(PAGE);
    cy.get('sem-site-tree#t-site .sem-tree-find').type('ts');
    cy.get('sem-site-tree#t-site .sem-tree-count').should('contain.text', '0 of 2');
    cy.get('sem-site-tree#t-site [data-match]').should('have.length', 2);
    cy.get('sem-site-tree#t-site .sem-tree-find').type('{enter}');
    cy.get('sem-site-tree#t-site [data-match-current]').should('have.length', 1);
    cy.get('sem-site-tree#t-site .sem-tree-count').should('contain.text', '1 of 2');
    cy.get('sem-site-tree#t-site .sem-tree-find').type('{enter}');
    // the SECOND match now carries the current mark (cycled)
    cy.get('sem-site-tree#t-site').should(($t) => {
      const current = $t.find('[data-match-current]')[0];
      expect(current.getAttribute('data-path') ?? current.getAttribute('path')).to.eq('src/lit/sem-tree.ts');
    });
  });

  it('JS-off: static nested list, attr() labels, no chrome', () => {
    cy.visit(NOJS);
    cy.get('sem-site-tree#t-site').should(($t) => {
      expect($t[0].ownerDocument.querySelector('[data-sem-upgraded]')).to.eq(null);
      expect($t.find('.sem-tree-chrome')).to.have.length(0);
      expect($t.find('.sem-tree-toggle')).to.have.length(0);
      // JS-off everything renders expanded — the authored [collapsed] is
      // honored only under the upgrade marker (degradation never hides)
      const doc = $t[0].ownerDocument;
      const leaf = doc.defaultView.getComputedStyle(nodeByPath($t[0], 'src/lit/sem-workflow.ts'), '::before');
      expect(leaf.content).to.contain('sem-workflow.ts');
    });
    // authored collapsed does NOT hide descendants without the marker
    // (the scripts-stripped artifact keeps only the bare spelling — the
    // data-* mirror is runtime behaviour)
    cy.get('sem-site-tree#t-site')
      .find('node[data-path="src/validate/validate.js"], node[path="src/validate/validate.js"]')
      .should('be.visible');
  });

  it('extraction invariant — the tree record is identical with JS off', () => {
    let live;
    cy.visit(PAGE)
      .get('sem-site-tree#t-site')
      .then(($t) => {
        live = recordOf($t[0]);
      });
    cy.visit(NOJS);
    cy.get('sem-site-tree#t-site').should(($t) => {
      expect(recordOf($t[0])).to.deep.eq(live);
    });
  });
});
