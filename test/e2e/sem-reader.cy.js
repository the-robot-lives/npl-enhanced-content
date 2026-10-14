// BDD spec — sem-reader · source: spec/schema/sem-reader.md
//
// Feature: one reading-chrome host per document — outline, progress,
//          focus, type, colour, print and audience controls — one bundle,
//          identical over the class alias and the element form; JS-off it is
//          the authored contents nav or nothing
//   Scenario: chrome is the first child, a labelled region, controls in canonical order
//   Scenario: generated outline — one link per h2/h3, runtime ids, closed until toggled
//   Scenario: authored <nav aria-label="Contents"> is used verbatim
//   Scenario: Escape closes the outline and returns focus; a link closes it
//   Scenario: aria-current="location" follows the scroll position
//   Scenario: progress bar is aria-hidden and fills with the scroll
//   Scenario: focus mode toggles html[data-sem-mode] and persists across reload
//   Scenario: type size steps s/m/l with the ends disabled; serif toggles
//   Scenario: colour select drives html[data-color-mode]; dark tokens apply
//   Scenario: print calls window.print()
//   Scenario: audience select lists declared profiles and writes the hash
//   Scenario: no global single-key shortcuts
//   Scenario: JS-off — no chrome; authored nav renders as a plain list

const cs = (el) => el.ownerDocument.defaultView.getComputedStyle(el);

const CANONICAL = ['toggle', 'progress', 'focus', 'type-down', 'type-up', 'font', 'color', 'print', 'audience'];

function controlKeys($chrome) {
  return Array.from($chrome[0].children, (c) => {
    if (c.classList.contains('sem-reader-toggle')) return 'toggle';
    if (c.classList.contains('sem-reader-progress')) return 'progress';
    if (c.classList.contains('sem-reader-color')) return 'color';
    if (c.classList.contains('sem-reader-audience')) return 'audience';
    return c.getAttribute('data-act');
  });
}

function assertReader(url, marker) {
  beforeEach(() => cy.visit(url, { onBeforeLoad(win) { cy.stub(win, 'print').as('print'); } }));

  it('carries the upgrade marker for this page', () => {
    cy.get('#rd').should('have.attr', marker);
  });

  it('renders one chrome region as the first child, controls in canonical order', () => {
    cy.get('#rd > .sem-reader-chrome').should('have.length', 1);
    cy.get('#rd > :first-child').should('have.class', 'sem-reader-chrome');
    cy.get('#rd > .sem-reader-chrome').should('have.attr', 'role', 'region');
    cy.get('#rd > .sem-reader-chrome').should('have.attr', 'aria-label', 'Reading controls');
    cy.get('#rd > .sem-reader-chrome').then(($c) => {
      expect(controlKeys($c)).to.deep.equal(CANONICAL);
      $c.find('button').each((_, b) => expect(b.getAttribute('type')).to.equal('button'));
    });
  });

  it('the outline panel starts closed and the toggle opens it', () => {
    cy.get('#rd .sem-reader-toggle').should('have.attr', 'aria-expanded', 'false');
    cy.get('#rd .sem-reader-toggle').should('have.attr', 'aria-controls');
    cy.get('#rd nav[aria-label="Contents"]').should('not.be.visible');
    cy.get('#rd .sem-reader-toggle').click();
    cy.get('#rd .sem-reader-toggle').should('have.attr', 'aria-expanded', 'true');
    cy.get('#rd nav[aria-label="Contents"]').should('be.visible');
    cy.get('#rd .sem-reader-toggle').then(($t) => {
      cy.get('#' + $t.attr('aria-controls')).should('have.attr', 'aria-label', 'Contents');
    });
  });

  it('Escape inside the reader closes the outline and returns focus to the toggle', () => {
    cy.get('#rd .sem-reader-toggle').click();
    cy.get('#rd nav[aria-label="Contents"] a').first().focus().type('{esc}');
    cy.get('#rd nav[aria-label="Contents"]').should('not.be.visible');
    cy.get('#rd .sem-reader-toggle').should('have.attr', 'aria-expanded', 'false');
    cy.focused().should('have.class', 'sem-reader-toggle');
  });

  it('activating an outline link navigates and closes the panel', () => {
    cy.get('#rd .sem-reader-toggle').click();
    cy.get('#rd nav[aria-label="Contents"] a').last().then(($a) => {
      const href = $a.attr('href');
      cy.wrap($a).click();
      cy.location('hash').should('equal', href);
      cy.get(href).should('exist');
    });
    cy.get('#rd nav[aria-label="Contents"]').should('not.be.visible');
  });

  it('the progress bar is aria-hidden and fills as the document scrolls', () => {
    cy.get('#rd .sem-reader-progress').should('have.attr', 'aria-hidden', 'true');
    cy.get('#rd .sem-reader-progress-fill').then(($f) => expect($f[0].getBoundingClientRect().width).to.be.lessThan(2));
    cy.scrollTo('bottom');
    cy.get('#rd .sem-reader-progress-fill').should(($f) => {
      const bar = $f[0].parentElement.getBoundingClientRect().width;
      expect($f[0].getBoundingClientRect().width).to.be.greaterThan(bar * 0.9);
    });
  });

  it('focus mode toggles html[data-sem-mode="focus"] and survives a reload', () => {
    cy.get('#rd [data-act="focus"]').should('have.attr', 'aria-pressed', 'false').click();
    cy.get('html').should('have.attr', 'data-sem-mode', 'focus');
    cy.get('#rd [data-act="focus"]').should('have.attr', 'aria-pressed', 'true');
    cy.reload();
    cy.get('html').should('have.attr', 'data-sem-mode', 'focus');
    cy.get('#rd [data-act="focus"]').should('have.attr', 'aria-pressed', 'true').click();
    cy.get('html').should('not.have.attr', 'data-sem-mode');
  });

  it('type size steps s → m → l with the ends disabled; serif toggles the face', () => {
    cy.get('#rd [data-act="type-up"]').click();
    cy.get('html').should('have.attr', 'data-sem-type', 'l');
    cy.get('#rd [data-act="type-up"]').should('be.disabled');
    cy.get('#rd [data-act="type-down"]').click();
    cy.get('html').should('have.attr', 'data-sem-type', 'm');
    cy.get('#rd [data-act="type-down"]').click();
    cy.get('html').should('have.attr', 'data-sem-type', 's');
    cy.get('#rd [data-act="type-down"]').should('be.disabled');
    cy.get('.sem-enhanced-document, sem-enhanced-document').then(($d) => {
      expect(parseFloat(cs($d[0]).fontSize)).to.be.lessThan(16);
    });
    cy.get('#rd [data-act="font"]').should('have.attr', 'aria-pressed', 'false').click();
    cy.get('html').should('have.attr', 'data-sem-font', 'serif');
    cy.get('#rd [data-act="font"]').should('have.attr', 'aria-pressed', 'true');
    cy.reload();
    cy.get('html').should('have.attr', 'data-sem-type', 's');
    cy.get('html').should('have.attr', 'data-sem-font', 'serif');
  });

  it('the colour select drives html[data-color-mode] and the dark tokens apply', () => {
    // minimal-tech-light tokens: --sem-bg #fafafa (light) / #0f172a (dark).
    // Exact values, so the assertion holds whatever the runner's own scheme is.
    const LIGHT = 'rgb(250, 250, 250)';
    const DARK = 'rgb(15, 23, 42)';
    cy.get('#rd .sem-reader-color').should('have.attr', 'aria-label', 'Colour scheme');
    cy.get('#rd .sem-reader-color option').then(($o) => {
      expect(Array.from($o, (o) => o.value)).to.deep.equal(['auto', 'light', 'dark']);
    });
    cy.get('#rd .sem-reader-color').select('dark');
    cy.get('html').should('have.attr', 'data-color-mode', 'dark');
    cy.get('body').should(($b) => expect(cs($b[0]).backgroundColor).to.equal(DARK));
    cy.get('html').should(($h) => expect(cs($h[0]).colorScheme).to.equal('dark'));
    cy.get('#rd .sem-reader-color').select('light');
    cy.get('html').should('have.attr', 'data-color-mode', 'light');
    cy.get('body').should(($b) => expect(cs($b[0]).backgroundColor).to.equal(LIGHT));
    cy.get('html').should(($h) => expect(cs($h[0]).colorScheme).to.equal('light'));
    cy.get('#rd .sem-reader-color').select('auto');
    cy.get('html').should('not.have.attr', 'data-color-mode');
  });

  it('print calls window.print()', () => {
    cy.get('#rd [data-act="print"]').click();
    cy.get('@print').should('have.been.calledOnce');
  });

  it('the audience select lists the declared profiles and writes the hash', () => {
    cy.get('#rd .sem-reader-audience').should('have.attr', 'aria-label', 'Audience');
    cy.get('#rd .sem-reader-audience option').then(($o) => {
      expect(Array.from($o, (o) => o.value)).to.deep.equal(['', 'dev', 'ops']);
      expect(Array.from($o, (o) => o.textContent)).to.deep.equal(['Everyone', 'Developer', 'Operator']);
    });
    cy.get('#ops-only').should('not.be.visible');
    cy.get('#rd .sem-reader-audience').select('ops');
    cy.location('hash').should('contain', 'sem-audience=ops');
    cy.get('#ops-only').should('be.visible');
    cy.get('#rd .sem-reader-audience').select('');
    cy.location('hash').should('not.contain', 'sem-audience');
    cy.get('#ops-only').should('not.be.visible');
    // the select reflects a hash written elsewhere (a shared link)
    cy.window().then((win) => { win.location.hash = '#sem-audience=dev'; });
    cy.get('#rd .sem-reader-audience').should('have.value', 'dev');
  });

  it('an outline link into a closed reveal or an inactive view opens it (deep-link resolver)', () => {
    cy.get('#rv-keys details').should('not.have.attr', 'open');
    cy.get('#rd .sem-reader-toggle').click();
    cy.get('#rd nav[aria-label="Contents"] a[href="#rv-h"]').click();
    cy.get('#rv-keys details').should('have.attr', 'open');
    cy.get('#rv-h').should('be.visible');
    cy.get('#rd .sem-reader-toggle').click();
    cy.get('#rd nav[aria-label="Contents"] a[href="#vw-h"]').click();
    cy.get('#clients .sem-view[data-name="Native"]').should('have.attr', 'data-active');
    cy.get('#vw-h').should('be.visible');
  });

  it('persisted preferences apply only for the controls this reader offers', () => {
    cy.visit(url, {
      onBeforeLoad(win) {
        win.localStorage.setItem('sem-reader:type', 'l');
        win.localStorage.setItem('sem-reader:mode', 'focus');
        win.localStorage.setItem('sem-reader:color', 'dark');
        // window capture runs before the bundle's document-level DOMContentLoaded listener
        win.addEventListener('DOMContentLoaded', () => {
          win.document.getElementById('rd').setAttribute('data-controls', 'outline,progress,color');
        }, true);
      }
    });
    cy.get('#rd .sem-reader-color').should('have.value', 'dark');
    cy.get('html').should('have.attr', 'data-color-mode', 'dark');
    cy.get('html').should('not.have.attr', 'data-sem-type');
    cy.get('html').should('not.have.attr', 'data-sem-mode');
    cy.get('#rd [data-act="focus"], #rd [data-act="type-up"]').should('not.exist');
  });

  it('publishes the bar height as --sem-reader-offset so targets and sticky headers clear it', () => {
    cy.get('html').then(($h) => {
      const v = parseFloat($h[0].style.getPropertyValue('--sem-reader-offset'));
      const bar = $h[0].querySelector('#rd .sem-reader-chrome').getBoundingClientRect().height;
      expect(v).to.be.greaterThan(bar);
    });
  });

  it('binds no global single-key shortcut', () => {
    cy.get('body').type('f');
    cy.get('html').should('not.have.attr', 'data-sem-mode');
    cy.get('body').type('{esc}');
    cy.get('#rd .sem-reader-toggle').should('have.attr', 'aria-expanded', 'false');
  });
}

describe('sem-reader', () => {
  describe('class form — /demo/reading.html (generated outline)', () => {
    assertReader('/demo/reading.html', 'data-sem-upgraded');

    it('generates one link per h2/h3 in the wrapper, assigning runtime ids', () => {
      cy.get('#rd nav.sem-reader-outline[aria-label="Contents"]').should('have.length', 1);
      // headings rendered inside a sem-md body are that record's content, not outline entries
      cy.get('.sem-enhanced-document :is(h2, h3):not(.sem-md-body *)').then(($h) => {
        cy.get('#rd nav.sem-reader-outline a').should('have.length', $h.length);
        // authored ids (rv-h, vw-h) are kept; the rest get runtime ids
        $h.each((_, h) => expect(h.id).to.match(/^(sem-h-\d+|rv-h|vw-h)$/));
      });
      cy.get('#rd nav.sem-reader-outline a').each(($a) => {
        cy.get($a.attr('href')).should('exist');
      });
      cy.get('#rd nav.sem-reader-outline a').first().should('have.text', 'Glossary');
      // sibling h2s stay flat; the two h3s under "Disclosures" nest in one sub-list
      cy.get('.sem-enhanced-document h2:not(.sem-md-body *)').then(($h2) => {
        cy.get('#rd nav.sem-reader-outline > ol > li > a').should('have.length', $h2.length);
      });
      cy.get('#rd nav.sem-reader-outline ol ol').should('have.length', 1);
      cy.get('#rd nav.sem-reader-outline ol ol a').should('have.length', 2);
    });

    it('aria-current="location" follows the scroll position, one link at a time', () => {
      cy.get('#rd .sem-reader-toggle').click();
      cy.get('#rd nav.sem-reader-outline a').contains('Tables').then(($a) => {
        cy.get($a.attr('href')).scrollIntoView();
      });
      cy.get('#rd nav.sem-reader-outline a[aria-current="location"]').should('have.length', 1);
      cy.get('#rd nav.sem-reader-outline a[aria-current="location"]').should('have.text', 'Tables');
      cy.scrollTo('top');
      cy.get('#rd nav.sem-reader-outline a[aria-current="location"]').should('have.length', 1);
      cy.get('#rd nav.sem-reader-outline a[aria-current="location"]').should('have.text', 'Glossary');
    });
  });

  describe('element form — /demo/reading-lit.html (authored nav)', () => {
    it('registers the custom element', () => {
      cy.visit('/demo/reading-lit.html');
      cy.window().then((win) => expect(win.customElements.get('sem-reader')).to.exist);
    });
    assertReader('/demo/reading-lit.html', 'data-sem-upgraded');

    it('uses the authored <nav aria-label="Contents"> verbatim', () => {
      cy.get('#rd > nav#toc').should('exist');
      cy.get('#rd .sem-reader-outline').should('not.exist');
      cy.get('#rd .sem-reader-toggle').should('have.attr', 'aria-controls', 'toc');
      cy.get('#toc a').should('have.length', 5);
      cy.get('#toc a').first().should('have.attr', 'href', '#glossary-h');
      // no runtime ids were minted on headings the nav did not name
      cy.get('sem-enhanced-document h2:not([id])').should('have.length.greaterThan', 0);
      cy.get('[id^="sem-h-"]').should('not.exist');
    });

    it('releases its listeners and observers when the element is removed', () => {
      cy.window().then((win) => {
        const fill = win.document.querySelector('#rd .sem-reader-progress-fill');
        win.document.getElementById('rd').remove();
        expect(win.document.documentElement.style.getPropertyValue('--sem-reader-offset')).to.equal('');
        win.scrollTo(0, win.document.documentElement.scrollHeight);
        return cy.wrap(fill);
      }).then(($fill) => {
        cy.wait(100);
        cy.wrap($fill).should(($f) => expect($f[0].style.width).to.equal('0%'));
      });
    });
  });

  describe('JS-off', () => {
    it('/demo/reading.nojs.html — the reader is empty and takes no space', () => {
      cy.visit('/demo/reading.nojs.html');
      cy.get('.sem-reader-chrome, .sem-reader-progress, .sem-reader-outline').should('not.exist');
      cy.get('#rd').then(($r) => expect($r[0].getBoundingClientRect().height).to.equal(0));
      cy.get('html').should('not.have.attr', 'data-sem-mode');
    });

    it('/demo/reading-lit.nojs.html — the authored nav renders as a plain list of links', () => {
      cy.visit('/demo/reading-lit.nojs.html');
      cy.get('.sem-reader-chrome, .sem-reader-toggle').should('not.exist');
      cy.get('#toc').should('be.visible');
      cy.get('#toc a').should('have.length', 5);
      cy.get('#toc a').first().click();
      cy.location('hash').should('equal', '#glossary-h');
    });

    it('/demo/reading-lit.nojs.html — the reader is not sticky (no chrome to stay pinned above)', () => {
      cy.visit('/demo/reading-lit.nojs.html');
      cy.get('#rd').should(($r) => expect(cs($r[0]).position).to.equal('static'));
    });

    it('/demo/reading-lit.nojs.html — no overlap regression: the authored nav never covers the first heading after scrolling', () => {
      // Guards the static-position assertion above: position:static alone
      // doesn't prove the nav stays out of the reading flow's way. Scroll
      // past it and check the authored nav's box and the first content
      // heading's box don't intersect — a future regression to overlapping
      // content without sticky would fail here even if `position` still
      // read `static` for some other reason.
      cy.visit('/demo/reading-lit.nojs.html');
      cy.scrollTo(0, 400);
      cy.get('#toc').then(($nav) => {
        const navBox = $nav[0].getBoundingClientRect();
        cy.get('h1').first().then(($h1) => {
          const headingBox = $h1[0].getBoundingClientRect();
          const intersects = navBox.left < headingBox.right
            && navBox.right > headingBox.left
            && navBox.top < headingBox.bottom
            && navBox.bottom > headingBox.top;
          expect(intersects, 'authored nav bounding box does not intersect the first heading').to.be.false;
        });
      });
    });

    it('/demo/reading-lit.html — the upgraded reader is sticky', () => {
      cy.visit('/demo/reading-lit.html');
      cy.get('#rd').should(($r) => expect(cs($r[0]).position).to.equal('sticky'));
    });
  });
});
