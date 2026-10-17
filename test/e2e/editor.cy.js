/// <reference types="cypress" />
// E2E — the semtext-editor bundle over web/demo/editor.html (EDITOR.md §9).
// Cypress runs against the BUILT tree (repo rule: build before test); this
// spec drives the real bundle at /demo/editor.html — shell, controllers,
// insert roads, keyboard moves, drag & drop, the code pane and the model
// round-trip.
//
// a11y note: cypress-axe is not a dependency of this repo; the accessibility
// pass is the keyboard-only walkthrough (no pointer events) plus the
// aria-live / aria-invalid / dialog-role assertions inline below.
//
// Model ids are GENERATED (n2, n17…); authored `id` attributes survive as
// attributes only — the specs below map authored ids back to model ids via
// nodeIdFor() before touching ctx.doc.

const ROOT_KIDS = 6; // heading, paragraph, note, facts, data-visualizer, loose data-source

const Demo = {
  fixture: [
    '<sem-heading id="top-h" level="2">Three records</sem-heading>',
    '<sem-paragraph id="top-p">Double-click any text to edit it; press',
    ' <strong>Escape</strong> to commit.</sem-paragraph>',
    '<sem-note id="top-note" variant="tip">',
    '<sem-paragraph id="note-p">The descriptor registry resolves titles and hints.</sem-paragraph>',
    '</sem-note>',
    '<sem-facts id="top-facts" kind="glossary">',
    '<sem-fact id="fact-1"><term>packet</term>',
    '<definition>A self-describing record.</definition></sem-fact>',
    '<sem-fact id="fact-2"><term>record</term>',
    '<definition>The serialized form of a packet.</definition></sem-fact>',
    '</sem-facts>',
  ].join('\n'),
};

function ctxOf(win) {
  return win.document.querySelector('sem-editor#demo-editor').ctx;
}

/** Authored `id` attribute → generated model node id. Traverses from
 * `doc.root` (kind 'document' — NOT in the nodes map, `doc.node('doc')` is
 * undefined, so the walk must start from the root object itself). */
function nodeIdFor(ctx, authoredId, startId) {
  const doc = ctx.doc;
  const startIdFinal = startId ?? doc.root.id;
  const visit = (node, id) => {
    if (node === undefined) return null;
    if (node.kind === 'element') {
      if (node.attrs.some((a) => a.name === 'id' && a.value === authoredId) && (id === startIdFinal || doc.contains(startIdFinal, id))) return id;
    }
    for (const c of doc.childrenOf(id)) {
      const hit = visit(doc.node(c.id), c.id);
      if (hit !== null) return hit;
    }
    return null;
  };
  const startNode = startId === undefined ? doc.root : doc.node(startIdFinal);
  return visit(startNode, startIdFinal);
}

function elementKids(ctx, containerId) {
  return ctx.doc.childrenOf(containerId).filter((n) => n.kind === 'element');
}

describe('semtext-editor bundle (§9)', () => {
  beforeEach(() => {
    cy.visit('/demo/editor.html');
    cy.get('sem-editor#demo-editor .sem-ed-canvas', { timeout: 15000 }).should('exist');
    cy.get('.sem-ed-canvas sem-paragraph#top-p').should('have.attr', 'data-sem-edit-node');
  });

  const editorEl = () => cy.get('sem-editor#demo-editor');
  const canvasEl = () => cy.get('sem-editor#demo-editor .sem-ed-canvas');

  it('opens the authored document; top-level hosts carry stamps and bindings', () => {
    editorEl().should('have.attr', 'edit-mode');
    canvasEl().find('sem-paragraph#top-p').then(($p) => {
      expect($p[0].getAttribute('data-sem-edit-node')).to.match(/^n\d+$/);
    });
    canvasEl().find('sem-note#top-note').should('have.attr', 'data-sem-editing');
    canvasEl().find('sem-facts#top-facts').should('have.attr', 'data-sem-editing');
    // the slotted code pane survived the authored capture (not model content)
    editorEl().find('sem-editor-code').should('have.attr', 'slot', 'code-view');
    cy.window().then((win) => {
      expect(ctxOf(win).doc.serialize()).to.contain('id="top-facts"');
    });
  });

  it('model round-trip is byte-identical through the public API', () => {
    cy.window().then((win) => {
      const api = win.SemTextEditor;
      const doc = api.createDocument(Demo.fixture);
      expect(doc.serialize()).to.eq(Demo.fixture);
      expect(api.tryParse('<sem-note><p>').ok).to.eq(false);
      expect(api.tryParse(Demo.fixture).ok).to.eq(true);
    });
  });

  it('double-click edits a text slot; Escape commits to the model', () => {
    // slot editing is descriptor-driven: sem-note has hand textSlots
    // (`:scope > .sem-note-body`); plain prose tags (sem-heading,
    // sem-paragraph) carry only the attributes-only fallback and do not
    // slot-edit.
    canvasEl().find('sem-note#top-note').dblclick();
    cy.get('.sem-ed-canvas sem-note#top-note [contenteditable]').should('exist')
      .type('{selectall}Replaced prose{esc}');
    cy.window().then((win) => {
      const src = ctxOf(win).doc.serialize();
      expect(src).to.contain('Replaced prose');
      expect(src).to.not.contain('descriptor registry');
    });
    canvasEl().find('sem-note#top-note').should('contain.text', 'Replaced prose');
  });

  it('plus zone opens the panel; picking an entry inserts a sibling', () => {
    canvasEl().find('button[aria-label="Add block at the end"]').click();
    cy.get('dialog.sem-ed-ins-panel').should('be.visible');
    cy.get('dialog.sem-ed-ins-panel button')
      .contains('.sem-ed-ins-tile-title', /^[^…]+$/)
      .closest('button')
      .first()
      .then(($tile) => {
        cy.log('inserting tile: ' + $tile.find('.sem-ed-ins-tile-title').text());
        cy.wrap($tile).click();
      });
    // direct-insert entries close the panel on pick (wizard-backed tiles —
    // '…' title suffix — are excluded by the filter above).
    cy.get('dialog.sem-ed-ins-panel').should('not.exist');
    cy.window().then((win) => {
      const ctx = ctxOf(win);
      expect(elementKids(ctx, ctx.doc.root.id).length).to.eq(ROOT_KIDS + 1);
    });
  });

  it('context menu opens Properties; Cancel closes without changes', () => {
    canvasEl().find('sem-paragraph#top-p').rightclick();
    cy.get('[role="menuitem"]').contains('Properties…').click();
    cy.get('dialog.sem-ed-modal').should('be.visible')
      .find('h2, h3, [id$="title"]').contains('Properties');
    cy.get('dialog.sem-ed-modal button').contains('Cancel').click();
    cy.get('dialog.sem-ed-modal').should('not.exist');
    // nothing changed
    cy.window().then((win) => {
      expect(ctxOf(win).doc.serialize()).to.contain('Double-click any text');
    });
  });

  it('properties item list removes a fact (the +/- item road)', () => {
    canvasEl().find('sem-facts#top-facts').rightclick();
    cy.get('[role="menuitem"]').contains('Properties…').click();
    cy.get('dialog.sem-ed-modal button[aria-label^="Remove fact"]').last().click();
    cy.get('dialog.sem-ed-modal button').contains('Save').click();
    cy.window().then((win) => {
      const ctx = ctxOf(win);
      const factsId = nodeIdFor(ctx, 'top-facts');
      expect(elementKids(ctx, factsId).length).to.eq(1);
      const src = ctx.doc.serialize();
      expect(src).to.contain('fact-1');
      expect(src).to.not.contain('fact-2');
    });
    canvasEl().find('sem-facts#top-facts sem-fact').should('have.length', 1);
  });

  it('Alt+Shift+Arrow promotes a nested element (keyboard-only move)', () => {
    // keyboard-only pass: no pointer events in this test
    //
    // The schema guards the move: sem-paragraph is not a schema tag, so
    // promoting note-p to root is REFUSED (announced, model untouched) —
    // assert that guard first.
    cy.get('.sem-ed-canvas sem-note#top-note sem-paragraph#note-p').then(($p) => {
      const ev = new KeyboardEvent('keydown', {
        key: 'ArrowLeft', altKey: true, shiftKey: true, bubbles: true, cancelable: true,
      });
      $p[0].dispatchEvent(ev);
      expect(ev.defaultPrevented, 'chord claimed by the dnd listener').to.eq(true);
      cy.wait(80);
      cy.document().then((doc) => {
        const live = doc.querySelector('.sem-ed-live');
        expect(live.textContent, 'refusal announced').to.contain('Cannot nest sem-paragraph');
        const ctx = doc.querySelector('sem-editor#demo-editor').ctx;
        const noteId = nodeIdFor(ctx, 'top-note');
        const notePId = nodeIdFor(ctx, 'note-p');
        expect(ctx.doc.contains(noteId, notePId), 'refused move left the model intact').to.eq(true);
      });
    });
    // The working promote: sem-md IS schema-root-allowed, so the same
    // chord moves it out of the note to top level. (The data-visualizer's
    // parked-box wrappers are not regions-mapped yet — its nested source
    // does not resolve; noted in the lane report.)
    cy.get('.sem-ed-canvas sem-note#top-note sem-md#note-md').then(($md) => {
      const ev = new KeyboardEvent('keydown', {
        key: 'ArrowLeft', altKey: true, shiftKey: true, bubbles: true, cancelable: true,
      });
      $md[0].dispatchEvent(ev);
      expect(ev.defaultPrevented, 'chord claimed').to.eq(true);
      cy.wait(80);
      cy.window().then((win) => {
        const ctx = ctxOf(win);
        const noteId = nodeIdFor(ctx, 'top-note');
        const mdId = nodeIdFor(ctx, 'note-md');
        expect(ctx.doc.contains(noteId, mdId), 'promoted out of the note').to.eq(false);
        const kids = elementKids(ctx, ctx.doc.root.id);
        const mdAt = kids.findIndex((n) => n.id === mdId);
        const noteAt = kids.findIndex((n) => n.id === noteId);
        expect(mdAt, 'promoted right after its former parent').to.eq(noteAt + 1);
      });
      canvasEl().children('sem-md#note-md').should('exist');
    });
  });

  it('synthetic HTML5 drag moves the loose data-source into the visualizer', () => {
    // Chip drags resolve to the CHIP'S BINDING ROOT (draggedElementFor
    // walks the chain up to the bound host — nested per-item chips are a
    // dnd v1 gap, lane report). So the drag subject is a top-level host:
    // loose-src (schema-root-allowed) dropped onto the visualizer, which
    // accepts sem-data-source children. Drop placement resolves through
    // the point under the cursor (elementFromPoint), not the event target.
    canvasEl().find('sem-data-source#loose-src').should('exist');
    // one async block on purpose (see the code-pane test): the drag
    // sequence, its geometry and its assertion share no cypress command
    // boundaries, so a chain rewind cannot replay the drag mid-flight
    cy.window().then(async (win) => {
      const doc = win.document;
      const src = doc.querySelector('.sem-ed-canvas sem-data-source#loose-src');
      const viz = doc.querySelector('.sem-ed-canvas sem-data-visualizer#top-viz');
      src.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
      const chip = src.querySelector('.sem-ed-chip');
      expect(chip, 'chip rendered for the drag source').to.not.eq(null);
      // the vocabulary theme sets html { scroll-behavior: smooth } — both
      // scrollIntoView and scrollBy animate, so a rect read right after a
      // scroll is the PRE-scroll position and the visualizer can sit fully
      // below the fold, where elementFromPoint (drop placement) answers
      // null and resolve() bails as 'outside'. Force instant scrolling and
      // bring the visualizer's BOTTOM edge above the fold instead.
      doc.documentElement.style.scrollBehavior = 'auto';
      viz.scrollIntoView({ block: 'center' });
      let rect = viz.getBoundingClientRect();
      if (rect.bottom > win.innerHeight) {
        win.scrollBy(0, rect.bottom - win.innerHeight + 24);
        await new Promise((r) => setTimeout(r, 50));
        rect = viz.getBoundingClientRect();
      }
      const vh = win.innerHeight;
      const top = Math.max(rect.top, 0);
      const bottom = Math.min(rect.bottom, vh);
      const x = rect.left + rect.width / 2;
      // Aim at the visualizer's TOOLS BAR (generated chrome at the top of
      // the host): resolve() treats chrome hover as ON-HOST = "append into
      // the visualizer". The viz's inner parked content does NOT resolve
      // positionally (parked wrappers are a documented dnd v1 gap) — a drop
      // there falls through to the binding root and reorders the ROOT.
      const y = Math.min(top + 12, (top + bottom) / 2);
      const dt = new DataTransfer();
      chip.dispatchEvent(new MouseEvent('mousedown', { which: 1, bubbles: true }));
      chip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      viz.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
      viz.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
      chip.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
      await new Promise((r) => setTimeout(r, 120));
      const ctx = ctxOf(win);
      const vizId = nodeIdFor(ctx, 'top-viz');
      const srcId = nodeIdFor(ctx, 'loose-src');
      expect(ctx.doc.contains(vizId, srcId), 'loose-src dragged into the visualizer').to.eq(true);
      expect(elementKids(ctx, ctx.doc.root.id).length).to.eq(ROOT_KIDS - 1);
    });
    canvasEl().find('sem-data-visualizer#top-viz sem-data-source#loose-src').should('exist');
  });

  it('code pane flags invalid XHTML with aria-invalid and recovers byte-identically', () => {
    editorEl().find('button').contains('Code').click();
    editorEl().should('have.attr', 'data-mode', 'code');
    // one async block on purpose: cypress command boundaries between the
    // feeds and their debounced parses let chain rewind replay earlier
    // steps, so every interaction below runs inside a single then
    cy.window().then(async (win) => {
      const ta = win.document.querySelector('textarea[aria-label="XHTML source"]');
      const good = ta.value;
      expect(good).to.contain('top-note');
      // the pane's wire pushes the model source back on every doc change
      // unless the pane is "driving" (focused + recent input) — focus so
      // the synthetic feed counts as in-flight typing (§2.6)
      const feed = (el, text) => {
        el.focus();
        el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const settle = (ms) => new Promise((r) => setTimeout(r, ms));
      // unterminated comment = severity error: ok:false, last good tree kept
      feed(ta, good + '\n<!-- unterminated');
      await settle(500);
      expect(ta.getAttribute('aria-invalid')).to.eq('true');
      feed(ta, good + '\n');
      await settle(500);
      expect(ta.hasAttribute('aria-invalid')).to.eq(false);
      expect(win.SemTextEditor.createDocument(ta.value).serialize()).to.eq(ta.value);
    });
    editorEl().find('button').contains('Visual').click();
    editorEl().should('have.attr', 'data-mode', 'wysiwyg');
    canvasEl().find('sem-note#top-note').should('exist');
  });

  it('undo reverts a committed slot edit; redo re-applies it', () => {
    canvasEl().find('sem-note#top-note').dblclick();
    cy.get('.sem-ed-canvas sem-note#top-note [contenteditable]').should('exist')
      .type('{selectall}Undo me{esc}');
    cy.window().then((win) => {
      expect(ctxOf(win).doc.serialize()).to.contain('Undo me');
    });
    editorEl().find('button').contains('Undo').click();
    cy.window().then((win) => {
      expect(ctxOf(win).doc.serialize()).to.not.contain('Undo me');
    });
    editorEl().find('button').contains('Redo').click();
    cy.window().then((win) => {
      expect(ctxOf(win).doc.serialize()).to.contain('Undo me');
    });
  });

  it('keyboard-only walkthrough: live region, toolbar, plus zone, dialog escape', () => {
    // a11y pass (no cypress-axe in this repo — structural + keyboard checks)
    editorEl().find('.sem-ed-live[role="status"][aria-live="polite"]').should('exist');
    editorEl().find('[role="toolbar"] button').its('length').should('be.gte', 3);
    // tab order reaches the plus zones (tabIndex=0 keyboard parity, §7)
    canvasEl().find('button.sem-ed-ins-plus').first().focus().type('{enter}');
    cy.get('dialog.sem-ed-ins-panel').should('be.visible');
    // keyboard continuity: the panel focuses its filter input (roving
    // focus, §7); Esc-cancel is the browser's NATIVE dialog behavior —
    // a synthetic keydown cannot produce the trusted cancel event, so the
    // close goes through the dialog API (the same close handler Esc runs).
    cy.get('dialog.sem-ed-ins-panel input[aria-label="Filter blocks"]').should('be.focused');
    cy.get('dialog.sem-ed-ins-panel').then(($d) => {
      $d[0].close(); // fires 'close' → onCancel → dialog.remove()
    });
    cy.get('dialog.sem-ed-ins-panel').should('not.exist');
    // focus restored to the zone button (the panel's priorFocus contract)
    cy.get('button.sem-ed-ins-plus').first().should('be.focused');
  });
});
