/**
 * sem-tldr — the namespace walking skeleton (spec/schema/sem-tldr.md).
 *
 * BDD source: spec/schema/sem-tldr.md. The component is a no-logic
 * display stub; the contract it must prove is structural:
 *
 *   - the core bundle registers the element and claims its marker
 *     (no CSS-only elements — the Lit component exists);
 *   - authored children render as-is, and the "TL;DR" label is CSS
 *     chrome (::before — outside textContent);
 *   - the extraction invariant: the element's textContent is IDENTICAL
 *     in the built page and the scripts-stripped .nojs artifact.
 */
describe('sem-tldr (spec/schema/sem-tldr.md)', () => {
  // Authored content, straight from the demo source — asserted byte-for-
  // byte (modulo whitespace) against both tiers below.
  const authored = /Rotate JWTs\s+per session\s*; keep refresh tokens server-side\./s;

  it('upgrades in the built page: registered component + claimed marker', () => {
    cy.visit('/demo/index.html');
    cy.get('sem-tldr#t-auth').should(($el) => {
      expect($el[0].localName).to.eq('sem-tldr');
      expect($el[0].hasAttribute('data-sem-upgraded'), 'data-sem-upgraded claimed').to.eq(true);
      // the component's definition is live, not a dangling unknown element
      expect($el[0].ownerDocument.defaultView.customElements.get('sem-tldr')).to.exist;
    });
  });

  it('renders authored children as-is and the label as CSS chrome', () => {
    cy.visit('/demo/index.html');
    cy.get('sem-tldr#t-auth')
      .should('be.visible')
      .and(($el) => {
        expect($el.text()).to.match(authored);
        // no component-GENERATED children: the only element child is the
        // authored <strong>; the stub renders nothing of its own
        expect($el.children()).to.have.length(1);
        expect($el.children()[0].localName).to.eq('strong');
        expect($el[0].shadowRoot).to.eq(null);
        // the label lives in ::before, so it is NOT in textContent
        const before = $el[0].ownerDocument.defaultView.getComputedStyle($el[0], '::before');
        expect(before.content).to.contain('TL;DR');
        expect($el.text()).to.not.contain('TL;DR');
      });
  });

  it('extraction invariant — identical content with JS off (.nojs artifact)', () => {
    let liveText;
    cy.visit('/demo/index.html')
      .get('sem-tldr#t-auth')
      .then(($live) => {
        liveText = $live.text().replace(/\s+/g, ' ').trim();
      });
    cy.visit('/demo/index.nojs.html');
    cy.get('sem-tldr#t-auth')
      .should('be.visible')
      .and(($off) => {
        // no script ran: no upgrade marker anywhere in the artifact
        expect(document.querySelector('[data-sem-upgraded]')).to.eq(null);
        // the authored content survives byte-for-byte (whitespace-folded)
        expect($off.text().replace(/\s+/g, ' ').trim()).to.eq(liveText);
        expect($off.text()).to.match(authored);
        // the CSS label still draws with no script in the page
        const before = $off[0].ownerDocument.defaultView.getComputedStyle($off[0], '::before');
        expect(before.content).to.contain('TL;DR');
      });
  });
});
