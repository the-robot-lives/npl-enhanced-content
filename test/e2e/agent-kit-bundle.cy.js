// BDD spec — the agent-kit bundle (family C) · source: spec/schema/agent-kit/*.md
//
// Feature: the agent-kit-* components are cached embeds whose authored
//          inner content IS the record; the chrome they fabricate under
//          the upgrade claim is extraction-invisible, so JS-off
//          extraction deep-equals JS-on extraction
//   Scenario: INVARIANT — JS-off extraction deep-equals JS-on extraction (sub-batch: tickets)
//   Scenario: tickets mint one plain record each, in document order
//   Scenario: ticket record text is the authored record — no chrome text leaks
//   Scenario: chrome (meta row, share footer, key anchor) exists JS-on and not JS-off
//   Scenario: ticket-ref is an inert prose chip JS-off and a keyboard link JS-on

import { extractRecords } from '../../src/extract/records';

const clone = (v) => JSON.parse(JSON.stringify(v));
const extract = () => cy.document().then((doc) => clone(extractRecords(doc)));

// Document order of the tickets section in web/demo/agent-kit.html.
const TICKET_TYPES = [
  'agent-kit-issue',
  'agent-kit-bug',
  'agent-kit-task',
  'agent-kit-epic',
  'agent-kit-user-story',
];

// Document order of the personas section (below the tickets).
const PERSONA_TYPES = [
  'agent-kit-user-persona',
  'agent-kit-agent-persona',
  'agent-kit-agent-persona',
];

// Document order of the structured-lists section (below the personas).
const LIST_TYPES = ['agent-kit-acceptance-criteria', 'agent-kit-custom-assert'];

// The board + reference + media + testing sections (last) — the
// refs/columns never mint.
const BOARD_TYPES = ['agent-kit-board'];
const REFERENCE_TYPES = ['agent-kit-organization', 'agent-kit-project', 'agent-kit-chatroom'];
const MEDIA_TYPES = ['agent-kit-asset', 'agent-kit-artifact', 'agent-kit-review'];
const TESTING_TYPES = [
  'agent-kit-test-suite',
  'agent-kit-test-case',
  'agent-kit-cypress',
  'agent-kit-cucumber',
];

const ALL_TYPES = [
  ...TICKET_TYPES,
  ...PERSONA_TYPES,
  ...LIST_TYPES,
  ...BOARD_TYPES,
  ...REFERENCE_TYPES,
  ...MEDIA_TYPES,
  ...TESTING_TYPES,
];

describe('agent-kit bundle — tickets (sub-batch 1)', () => {
  it('INVARIANT: JS-off extraction deep-equals JS-on extraction', () => {
    let jsOff;
    cy.visit('/demo/agent-kit.nojs.html');
    extract().then((records) => {
      jsOff = records;
      // the authored tickets really do mint records JS-off
      expect(records.map((r) => r.type)).to.deep.equal(ALL_TYPES);
    });
    cy.visit('/demo/agent-kit.html');
    extract().then((jsOn) => {
      expect(jsOn).to.deep.equal(jsOff);
    });
  });

  describe('JS-on records', () => {
    beforeEach(() => cy.visit('/demo/agent-kit.html'));

    it('tickets mint one plain record each, carrying the global qualifiers', () => {
      extract().then((records) => {
        expect(records.map((r) => r.type)).to.deep.equal(ALL_TYPES);
        const issue = records[0];
        expect(issue.id).to.equal('ticket-akit-001');
        expect(issue.kind).to.equal('ticket');
        expect(issue.tags).to.deep.equal(['extract', 'chrome']);
      });
    });

    it('ticket record text is the authored record — chrome text never leaks', () => {
      extract().then((records) => {
        const issue = records[0];
        expect(issue.text).to.contain('Extractor drops class-form parts');
        expect(issue.text).to.contain('wrapper element');
        // chrome strings: the type chip, key chip, badge, labels, footer
        expect(issue.text).not.to.contain('Issue');
        expect(issue.text).not.to.contain('AKIT-001');
        expect(issue.text).not.to.contain('in-progress');
        expect(issue.text).not.to.contain('Open in agent-kit');
        // child-spelling state/labels ARE authored visible content (bug card)
        const bug = records[1];
        expect(bug.text).to.contain('review');
        expect(bug.text).to.contain('css');
      });
    });
  });

  describe('chrome under the upgrade claim', () => {
    it('meta row, share footer, and key anchor exist JS-on', () => {
      cy.visit('/demo/agent-kit.html');
      cy.get('agent-kit-issue .agent-kit-ticket-chrome[data-sem-chrome]').should('exist');
      cy.get('agent-kit-issue .agent-kit-ticket-type').should('have.text', 'Issue');
      cy.get('agent-kit-issue .agent-kit-ticket-key').should('have.text', 'AKIT-001');
      cy.get('agent-kit-issue .agent-kit-ticket-state').should('have.attr', 'data-state', 'in-progress');
      cy.get('agent-kit-issue .agent-kit-ticket-label').should('have.length', 2);
      cy.get('agent-kit-issue a.agent-kit-ticket-open')
        .should('have.attr', 'href', '/app/acme/tickets/3f1c9a2e-8b74-4f6a-9d21-7ae5c0b4d101');
      // the anchor sits BEFORE the authored children (refs land at card top)
      cy.get('#akit-ticket-AKIT-001').then(($a) => {
        expect($a[0].nextElementSibling.tagName.toLowerCase()).to.equal('agent-kit-title');
      });
      // the bug card (no uuid) has no share footer; the task's snapshot stamp renders
      cy.get('agent-kit-bug a.agent-kit-ticket-open').should('not.exist');
      cy.get('agent-kit-task .agent-kit-ticket-snapshot').should('contain', '2026-10-14');
    });

    it('nothing is fabricated JS-off — the authored record stands alone', () => {
      cy.visit('/demo/agent-kit.nojs.html');
      cy.get('[data-sem-chrome]').should('not.exist');
      cy.get('.agent-kit-ticket-meta').should('not.exist');
      cy.get('#akit-ticket-AKIT-001').should('not.exist');
      cy.get('agent-kit-issue agent-kit-title').should(
        'have.text',
        'Extractor drops class-form parts',
      );
    });
  });

  describe('agent-kit-ticket-ref', () => {
    it('is a keyboard-reachable link JS-on', () => {
      cy.visit('/demo/agent-kit.html');
      cy.get('agent-kit-ticket-ref[key="AKIT-001"]')
        .should('have.attr', 'role', 'link')
        .and('have.attr', 'tabindex', '0')
        .and('have.attr', 'aria-label', 'Go to ticket AKIT-001: the extractor issue');
    });

    it('is inert prose JS-off', () => {
      cy.visit('/demo/agent-kit.nojs.html');
      cy.get('agent-kit-ticket-ref[key="AKIT-001"]').should(($el) => {
        expect($el[0].hasAttribute('role')).to.equal(false);
        expect($el[0].hasAttribute('tabindex')).to.equal(false);
        expect($el[0].textContent.trim()).to.equal('the extractor issue');
      });
    });
  });
});

describe('agent-kit bundle — personas (sub-batch 2)', () => {
  describe('JS-on records', () => {
    beforeEach(() => cy.visit('/demo/agent-kit.html'));

    it('personas mint plain records after the tickets, in document order', () => {
      extract().then((records) => {
        expect(records.map((r) => r.type)).to.deep.equal(ALL_TYPES);
        const ada = records[TICKET_TYPES.length];
        expect(ada.kind).to.equal('persona');
        expect(ada.tags).to.deep.equal(['authoring']);
        expect(ada.text).to.contain('Ada Lovelace');
        expect(ada.text).to.contain('Product manager');
        // chrome never leaks: the kind chip and the avatar URL
        expect(ada.text).not.to.contain('User persona');
        expect(ada.text).not.to.contain('picsum');
      });
    });
  });

  describe('chrome under the upgrade claim', () => {
    it('avatar img + kind chip render from the cached URL and the tag', () => {
      cy.visit('/demo/agent-kit.html');
      cy.get('agent-kit-user-persona img.agent-kit-persona-avatar')
        .should('have.attr', 'src', 'https://picsum.photos/seed/ada-persona/96/96')
        .and('have.attr', 'alt', 'Ada Lovelace avatar');
      cy.get('agent-kit-user-persona .agent-kit-persona-kind').should('have.text', 'User persona');
      cy.get('agent-kit-agent-persona[key="persona-loom"] .agent-kit-persona-kind')
        .should('have.attr', 'data-persona-kind', 'agent')
        .and('have.text', 'Agent persona');
      // the Loom snapshot's metadata object renders as chips
      cy.get('agent-kit-agent-persona[key="persona-loom"] .agent-kit-persona-meta-item')
        .should('have.length', 2)
        .first()
        .should('contain', 'orchestrator');
      // the avatarless persona renders no image at all
      cy.get('agent-kit-agent-persona[key="persona-scribe"] img').should('not.exist');
    });

    it('nothing is fabricated JS-off — no image, no chips', () => {
      cy.visit('/demo/agent-kit.nojs.html');
      cy.get('agent-kit-user-persona img').should('not.exist');
      cy.get('.agent-kit-persona-kind').should('not.exist');
      cy.get('.agent-kit-persona-meta').should('not.exist');
      cy.get('agent-kit-user-persona agent-kit-persona-name').should('have.text', 'Ada Lovelace');
    });
  });
});

describe('agent-kit bundle — structured lists (sub-batch 3)', () => {
  it('criteria and asserts mint plain records after the personas', () => {
    cy.visit('/demo/agent-kit.html');
    extract().then((records) => {
      expect(records.map((r) => r.type)).to.deep.equal(ALL_TYPES);
      const criteria = records[TICKET_TYPES.length + PERSONA_TYPES.length];
      expect(criteria.kind).to.equal('criteria');
      // the Given/When/Then labels are CSS ::before content — presentational,
      // never part of the extracted record
      expect(criteria.text).to.contain('a hand-authored XHTML document');
      expect(criteria.text).to.contain('the two record sets deep-equal');
      const asserts = records[TICKET_TYPES.length + PERSONA_TYPES.length + 1];
      expect(asserts.kind).to.equal('asserts');
      expect(asserts.text).to.contain('extractRecords(doc)');
      expect(asserts.text).to.contain('deep-equals the JS-off record set');
      // chrome text never leaks: the count chips
      expect(criteria.text).not.to.contain('Acceptance criteria');
      expect(criteria.text).not.to.contain('· 2');
      expect(asserts.text).not.to.contain('Custom asserts');
    });
  });

  it('count chip renders under the upgrade claim, absent JS-off', () => {
    cy.visit('/demo/agent-kit.html');
    cy.get('agent-kit-acceptance-criteria .agent-kit-acceptance-chip')
      .should('have.attr', 'data-criteria-count', '2')
      .and('contain', 'Acceptance criteria');
    cy.get('agent-kit-custom-assert .agent-kit-assert-chip')
      .should('have.attr', 'data-assert-count', '2')
      .and('contain', 'Custom asserts');
    cy.get('agent-kit-acceptance-criteria agent-kit-criterion').should('have.length', 2);
    cy.visit('/demo/agent-kit.nojs.html');
    cy.get('.agent-kit-acceptance-chip').should('not.exist');
    cy.get('.agent-kit-assert-chip').should('not.exist');
    cy.get('agent-kit-acceptance-criteria agent-kit-then').should('have.length', 2);
  });
});

describe('agent-kit bundle — board (sub-batch 4)', () => {
  it('the board mints one record; refs and columns stay extraction-invisible', () => {
    cy.visit('/demo/agent-kit.html');
    extract().then((records) => {
      expect(records.map((r) => r.type)).to.deep.equal(ALL_TYPES);
      const board = records[TICKET_TYPES.length + PERSONA_TYPES.length + LIST_TYPES.length];
      expect(board.kind).to.equal('board');
      expect(board.text).to.contain('the extractor issue');
      expect(board.text).to.contain('the lazy manifest');
      // heading attrs ride CSS ::before, never the record
      expect(board.text).not.to.contain('In progress');
      expect(board.text).not.to.contain('Board ·');
    });
  });

  it('count chip + snapshot stamp render JS-on; columns and labels stand alone JS-off', () => {
    cy.visit('/demo/agent-kit.html');
    cy.get('agent-kit-board .agent-kit-board-chip')
      .should('have.attr', 'data-column-count', '3')
      .and('contain', 'Board · 3 columns · 3 refs');
    cy.get('agent-kit-board .agent-kit-board-snapshot time')
      .should('have.attr', 'datetime', '2026-10-17T12:00:00Z');
    cy.get('agent-kit-board agent-kit-column').should('have.length', 3);
    cy.get('agent-kit-board agent-kit-ticket-ref[key="AKIT-001"]').should('have.attr', 'role', 'link');
    cy.visit('/demo/agent-kit.nojs.html');
    cy.get('.agent-kit-board-chip').should('not.exist');
    cy.get('.agent-kit-board-snapshot').should('not.exist');
    cy.get('agent-kit-board agent-kit-column').should('have.length', 3);
    cy.get('agent-kit-board agent-kit-column').first().then(($c) => {
      // the heading label renders through CSS ::before even JS-off
      const before = window.getComputedStyle($c[0], '::before').content;
      expect(before).to.equal('"In progress"');
    });
  });
});

describe('agent-kit bundle — reference cards + chatroom (sub-batch 5)', () => {
  it('cards and chatroom mint plain records; chrome and labels stay out', () => {
    cy.visit('/demo/agent-kit.html');
    extract().then((records) => {
      expect(records.map((r) => r.type)).to.deep.equal(ALL_TYPES);
      // the testing quartet tails the page; the chatroom rides before media
      const room = records[records.length - 8];
      expect(room.kind).to.equal('chatroom');
      expect(room.text).to.contain("Board's wired");
      expect(room.text).to.contain('Authoring stand-up');
      expect(room.text).not.to.contain('Ada:');
      expect(room.text).not.to.contain('Chatroom ·');
      const org = records[records.length - 10];
      expect(org.text).to.contain('Acme Corporation');
      expect(org.text).not.to.contain('Open in agent-kit');
    });
  });

  it('kind chips, footer links and the transcript render JS-on; prose stands alone JS-off', () => {
    cy.visit('/demo/agent-kit.html');
    cy.get('agent-kit-organization .agent-kit-reference-kind').should('have.text', 'Organization');
    cy.get('agent-kit-organization a.agent-kit-reference-open')
      .should('have.attr', 'href', '/app/acme');
    cy.get('agent-kit-project a.agent-kit-reference-open')
      .should('have.attr', 'href', '/app/acme/projects/semtext');
    cy.get('agent-kit-chatroom .agent-kit-chatroom-chip')
      .should('have.attr', 'data-message-count', '3')
      .and('contain', 'Chatroom · 3 messages');
    cy.get('agent-kit-chatroom agent-kit-chat-msg').should('have.length', 3);
    // author labels ride ::before even JS-off
    cy.get('agent-kit-chatroom agent-kit-chat-msg')
      .first()
      .then(($m) => {
        const before = window.getComputedStyle($m[0], '::before').content;
        expect(before).to.equal('"Ada: "');
      });
    cy.visit('/demo/agent-kit.nojs.html');
    cy.get('.agent-kit-reference-kind').should('not.exist');
    cy.get('a.agent-kit-reference-open').should('not.exist');
    cy.get('.agent-kit-chatroom-chip').should('not.exist');
    cy.get('agent-kit-chatroom agent-kit-chat-msg').should('have.length', 3);
    cy.get('agent-kit-organization agent-kit-name').should('have.text', 'Acme Corporation');
  });
});

describe('agent-kit bundle — media cards (sub-batch 6)', () => {
  it('asset, artifact and review mint plain records; chrome, versions and labels stay out', () => {
    cy.visit('/demo/agent-kit.html');
    extract().then((records) => {
      expect(records.map((r) => r.type)).to.deep.equal(ALL_TYPES);
      // the testing quartet tails the page; media sits right before it
      const last3 = records.slice(-7, -4);
      expect(last3.map((r) => r.type)).to.deep.equal(MEDIA_TYPES);
      expect(last3[0].text).to.contain('The board cover');
      expect(last3[0].text).not.to.contain('image/svg+xml');
      expect(last3[1].text).to.contain('authored body');
      expect(last3[1].text).not.to.contain('v1 — draft');
      expect(last3[2].text).to.contain('shipping it');
      expect(last3[2].text).not.to.contain('Ada:');
    });
  });

  it('image, chips, version list and verdict render JS-on; prose stands alone JS-off', () => {
    cy.visit('/demo/agent-kit.html');
    cy.get('agent-kit-asset img.agent-kit-asset-image').should('exist');
    cy.get('agent-kit-asset .agent-kit-asset-mime').should('have.text', 'image/svg+xml');
    cy.get('agent-kit-artifact .agent-kit-artifact-type').should('have.text', 'markdown');
    cy.get('agent-kit-artifact .agent-kit-artifact-version').should('have.length', 2);
    cy.get('agent-kit-review .agent-kit-review-verdict')
      .should('have.attr', 'data-verdict', 'approve')
      .and('have.text', 'Approved');
    cy.get('agent-kit-review agent-kit-comment').should('have.length', 2);
    // reviewer labels ride ::before even JS-off
    cy.get('agent-kit-review agent-kit-comment')
      .first()
      .then(($c) => {
        const before = window.getComputedStyle($c[0], '::before').content;
        expect(before).to.equal('"Ada: "');
      });
    cy.visit('/demo/agent-kit.nojs.html');
    cy.get('agent-kit-asset img').should('not.exist');
    cy.get('.agent-kit-artifact-type').should('not.exist');
    cy.get('.agent-kit-artifact-version').should('not.exist');
    cy.get('.agent-kit-review-verdict').should('not.exist');
    cy.get('agent-kit-artifact agent-kit-artifact-content').should('contain.text', 'authored body');
    cy.get('agent-kit-review agent-kit-comment').should('have.length', 2);
    cy.get('agent-kit-asset agent-kit-caption').should('contain.text', 'The board cover');
  });
});

describe('agent-kit bundle — testing quartet (sub-batch 7)', () => {
  it('suite, case and script cards mint plain records; totals and payloads stay out', () => {
    cy.visit('/demo/agent-kit.html');
    extract().then((records) => {
      expect(records.map((r) => r.type)).to.deep.equal(ALL_TYPES);
      const last4 = records.slice(-4);
      expect(last4.map((r) => r.type)).to.deep.equal(TESTING_TYPES);
      expect(last4[0].text).to.contain('main');
      expect(last4[0].text).not.to.contain('35 passed');
      expect(last4[1].text).to.contain('Both passes agree');
      expect(last4[2].text).not.to.contain('describe(');
      expect(last4[3].text).not.to.contain('Feature:');
    });
  });

  it('totals chips, step ordinals and the script panel render; nothing hides JS-off', () => {
    cy.visit('/demo/agent-kit.html');
    cy.get('agent-kit-test-suite .agent-kit-suite-totals')
      .should('have.attr', 'data-passed-total', '35')
      .and('contain', '2 branches · 35 passed · 1 failed');
    cy.get('agent-kit-test-case .agent-kit-case-count').should('contain', 'Test case · 3 steps');
    cy.get('agent-kit-cypress .agent-kit-script-kind').should('have.text', 'Cypress spec');
    cy.get('agent-kit-cypress .agent-kit-script-file').should('contain', 'test/e2e/agent-kit-bundle.cy.js');
    cy.get('agent-kit-cypress a[href]').should('not.exist'); // no dead Run affordance, no link
    cy.get('agent-kit-cypress script[data-agent-kit-script]').then(($s) => {
      const shown = window.getComputedStyle($s[0]).display;
      expect(shown).to.not.equal('none'); // the CSS promotion
    });
    cy.visit('/demo/agent-kit.nojs.html');
    cy.get('.agent-kit-suite-totals').should('not.exist');
    cy.get('.agent-kit-case-count').should('not.exist');
    cy.get('.agent-kit-script-kind').should('not.exist');
    cy.get('agent-kit-test-suite agent-kit-branch').should('have.length', 2);
    cy.get('agent-kit-test-case agent-kit-step').should('have.length', 3);
    // the .nojs BUILD strips every <script> (hard build invariant), so the
    // panel is absent here — real JS-off browsing keeps it via the CSS
    // promotion asserted above
    cy.get('agent-kit-cypress script[data-agent-kit-script]').should('not.exist');
    cy.get('agent-kit-test-case agent-kit-expected').should('contain.text', 'Both passes agree');
  });
});
