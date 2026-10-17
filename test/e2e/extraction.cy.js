// BDD spec — extraction (DOM → records → annotated text) · source: spec/extraction.md
//
// Feature: extraction projects the AUTHORED document to an ordered record
//          array; generated chrome, runtime state, and presentation
//          attributes are invisible to it, so the output is identical with
//          JS on, with JS off, under any view-as, and after interaction
//   Scenario: one record per authored element, in document order
//   Scenario: field mapping — sem-agent metadata
//   Scenario: field mapping — sem-note variant and body
//   Scenario: field mapping — sem-fact statement/conclusion/incorrectStatements
//   Scenario: field mapping — sem-detail highlights (authored and occluded)
//   Scenario: field mapping — sem-step status and positional ordinal
//   Scenario: field mapping — sem-property data-key and value
//   Scenario: field mapping — sem-view name and index
//   Scenario: field mapping — sem-reveal authored vs derived summary
//   Scenario: field mapping — sem-progress clamped value and raw attribute
//   Scenario: minting test — plain HTML with sem global attributes
//   Scenario: purity — extraction does not mutate the DOM
//   Scenario: INVARIANT — JS-off extraction deep-equals JS-on extraction
//   Scenario: INVARIANT — extraction is identical under every view-as mode
//   Scenario: INVARIANT — interaction does not change extraction output
//   Scenario: annotated plain text renders from the same records

import { extractRecords, extractText } from '../../src/extract/records';

const clone = (v) => JSON.parse(JSON.stringify(v));
const extract = () => cy.document().then((doc) => clone(extractRecords(doc)));

// Dual spelling per entry (:is(tag, .class)): the demo authors most
// elements as classed divs, and the round-2 fixtures (r-component,
// d-note, a-token) use the custom-element spelling.
const RECORD_SELECTOR = [
  ':is(sem-agent, .sem-agent)',
  ':is(sem-note, .sem-note)',
  ':is(sem-facts, .sem-facts)',
  ':is(sem-fact, .sem-fact)',
  ':is(sem-details, .sem-details)',
  ':is(sem-detail, .sem-detail)',
  ':is(sem-procedure, .sem-procedure)',
  ':is(sem-step, .sem-step)',
  ':is(sem-properties, .sem-properties)',
  ':is(sem-property, .sem-property)',
  ':is(sem-views, .sem-views)',
  ':is(sem-view, .sem-view)',
  ':is(sem-reveal, .sem-reveal)',
  ':is(sem-progress, .sem-progress)',
  ':is(sem-tag-def, .sem-tag-def)',
  ':is(sem-api-call, .sem-api-call)'
].join(', ');

// Document order of web/demo/index.html, per spec/extraction.md §3.1.
const EXPECTED_TYPES = [
  'sem-agent',
  'sem-note',
  'sem-note',
  'sem-facts', 'sem-fact', 'sem-fact', 'sem-fact',
  'sem-facts', 'sem-fact', 'sem-fact',
  'sem-facts', 'sem-fact', 'sem-fact',
  'sem-details', 'sem-detail',
  'sem-details', 'sem-detail',
  'sem-procedure', 'sem-step', 'sem-step', 'sem-step', 'sem-step',
  'sem-properties', 'sem-property', 'sem-property', 'sem-property',
  'sem-properties', 'sem-property', 'sem-property',
  'sem-views', 'sem-view', 'sem-view',
  'sem-reveal', 'sem-reveal', 'sem-reveal',
  'sem-progress', 'sem-progress',
  // W0 fixtures (audience trio, margin note) — appended after the last
  // Tier-0 record so every index above stays valid.
  'sem-note', 'sem-note', 'sem-note',
  'sem-note',
  // reference-definition cards (round 2) — last on purpose: they mint
  // records, and every index above stays valid.
  'sem-tag-def', 'sem-tag-def',
  'sem-api-call'
];

// The built scripts-stripped artifact is the genuine JS-off surface; the
// former __semJsOff kill-switch hook is retired with the multi-bundle days.
const visitJsOff = () => cy.visit('/demo/index.nojs.html');

/**
 * Visit with the fallback active but every container's view-as rewritten
 * first. The listener registered in onBeforeLoad runs before the inline
 * fallback's own DOMContentLoaded listener, so the handler enhances the
 * document under the substituted modes.
 */
const visitWithViews = (factsMode, detailsMode) =>
  cy.visit('/demo/index.html', {
    onBeforeLoad(win) {
      win.document.addEventListener('DOMContentLoaded', () => {
        win.document.querySelectorAll('.sem-facts').forEach((el) => {
          el.setAttribute('data-view-as', factsMode);
        });
        win.document.querySelectorAll('.sem-details').forEach((el) => {
          el.setAttribute('data-view-as', detailsMode);
        });
      });
    }
  });

const byType = (records, type) => records.filter((r) => r.type === type);
const byId = (records, id) => records.find((r) => r.id === id);

describe('extraction', () => {
  describe('record emission (web/demo/index.html)', () => {
    beforeEach(() => cy.visit('/demo/index.html'));

    it('emits one record per authored element, in document order', () => {
      extract().then((records) => {
        expect(records.map((r) => r.type)).to.deep.equal(EXPECTED_TYPES);
        records.forEach((r, i) => expect(r.sourceOrder).to.equal(i));
      });
    });

    it('record count matches the authored vocabulary elements in the DOM', () => {
      // Counted JS-off so no generated chrome can be mistaken for content.
      visitJsOff();
      cy.get(RECORD_SELECTOR).then(($els) => {
        extract().then((records) => {
          expect(records).to.have.length($els.length);
        });
      });
    });

    it('containment: facts point at their enclosing sem-facts container', () => {
      extract().then((records) => {
        const fact = byId(records, 'f-rotate');
        const container = records[fact.parent];
        expect(container.type).to.equal('sem-facts');
        expect(container.id).to.equal('facts-list');
        // Citation token composes from the containment tree.
        expect('#' + container.id + '/' + fact.id).to.equal('#facts-list/f-rotate');
      });
    });
  });

  describe('field mapping — the nine element families', () => {
    beforeEach(() => cy.visit('/demo/index.html'));

    it('sem-agent: name, bio, instructions', () => {
      extract().then((records) => {
        const agent = byType(records, 'sem-agent')[0];
        expect(agent.fields.name).to.equal('Auth Guide');
        expect(agent.fields.bio).to.contain('sample auth facts');
        expect(agent.fields.instructions).to.contain('Cite sem-fact ids');
        expect(agent.text).to.equal('Auth Guide');
      });
    });

    it('sem-note: variant plus body text, collapsed chrome excluded', () => {
      extract().then((records) => {
        const notes = byType(records, 'sem-note');
        expect(notes[0].fields.variant).to.equal('warning');
        expect(notes[0].text).to.equal(
          'JWTs must rotate per session, not per request.'
        );
        expect(notes[1].fields.variant).to.equal('tip');
        expect(notes[1].text).to.equal(
          'Shuffle flashcards before each review session for better recall.'
        );
        // The fallback's generated .sem-note-summary never reaches the record.
        expect(notes[1].text).not.to.contain('…');
      });
    });

    it('sem-fact: statement, conclusion, incorrectStatements kept out of the claim', () => {
      extract().then((records) => {
        const jwt = byId(records, 'f-jwt');
        expect(jwt.fields.statement).to.equal('JWTs rotate per session');
        expect(jwt.fields.conclusion).to.equal(
          'Short-lived access tokens; the refresh grant issues a new pair.'
        );
        expect(jwt.fields.incorrectStatements).to.deep.equal([]);
        expect(jwt.text).to.equal(
          'JWTs rotate per session :: Short-lived access tokens; ' +
            'the refresh grant issues a new pair.'
        );

        const oidc = byId(records, 'f-oidc');
        expect(oidc.fields.conclusion).to.equal('Authorization');
        expect(oidc.fields.incorrectStatements).to.deep.equal(['Cookie', 'X-Auth-Token']);
        // Incorrect statements are non-assertive: never in text, never a conclusion.
        expect(oidc.text).not.to.contain('Cookie');
      });
    });

    it('sem-facts / sem-details: containers carry id, kind, tags — not view-as', () => {
      extract().then((records) => {
        const container = byId(records, 'facts-list');
        expect(container.type).to.equal('sem-facts');
        expect(container.fields).to.deep.equal({});
        expect(container.text).to.equal('');
        expect(container).not.to.have.property('view');

        const details = byType(records, 'sem-details');
        expect(details).to.have.length(2);
        details.forEach((d) => expect(d.fields).to.deep.equal({}));
      });
    });

    it('sem-detail: highlights extracted whether authored or occluded', () => {
      extract().then((records) => {
        const passages = byType(records, 'sem-detail');
        // Quiz-view passage: the fallback has replaced .sem-highlight with
        // .sem-occluded; extraction reads through the mask.
        expect(passages[0].fields.highlights).to.deep.equal([
          'Authorization',
          'browser'
        ]);
        expect(passages[0].text).to.contain('Authorization');
        // Plain-view passage: highlight still authored.
        expect(passages[1].fields.highlights).to.deep.equal([
          'data-view-as="quiz"'
        ]);
      });
    });

    it('sem-step: status defaults to todo, ordinal is positional', () => {
      extract().then((records) => {
        const steps = byType(records, 'sem-step');
        expect(steps.map((s) => s.fields.status)).to.deep.equal([
          'done',
          'current',
          'todo',
          'blocked'
        ]);
        expect(steps.map((s) => s.fields.ordinal)).to.deep.equal([1, 2, 3, 4]);
        expect(steps[2].text).to.equal('run migrations');
      });
    });

    it('sem-property: data-key is the term, element text the value', () => {
      extract().then((records) => {
        const props = byType(records, 'sem-property');
        expect(props[0].fields).to.deep.equal({ key: 'token ttl', value: '15m' });
        expect(props[0].text).to.equal('token ttl :: 15m');
        expect(props[2].fields.key).to.equal('storage');
        expect(props[2].fields.value).to.equal('httpOnly cookie');
        // Duplicate keys are reported faithfully, not deduplicated.
        expect(props[3].fields.key).to.equal('token ttl');
        expect(props[4].fields.key).to.equal('token ttl');
        expect(props[4].fields.value).to.equal('14m');
      });
    });

    it('sem-view: name and index; the tab bar is not content', () => {
      extract().then((records) => {
        const views = byType(records, 'sem-view');
        expect(views.map((v) => v.fields.name)).to.deep.equal(['Helm', 'ArgoCD']);
        expect(views.map((v) => v.fields.index)).to.deep.equal([0, 1]);
        expect(views[0].text).to.contain('noizu-infra');
        // data-active is runtime state, not a record field (spec §5c).
        views.forEach((v) => expect(v.fields).not.to.have.property('active'));
        const container = records[views[0].parent];
        expect(container.id).to.equal('deploy');
      });
    });

    it('sem-reveal: authored summary wins, otherwise derived from the body', () => {
      extract().then((records) => {
        const authored = byId(records, 'r-storage');
        expect(authored.fields.summary).to.equal('Why not localStorage?');
        expect(authored.fields.summarySource).to.equal('authored');
        expect(authored.text).to.contain('readable by any script');
        // The fallback's generated <summary> is not part of the body text.
        expect(authored.text).not.to.contain('Why not localStorage?');

        const derived = byId(records, 'r-derived');
        expect(derived.fields.summarySource).to.equal('derived');
        expect(derived.fields.summary.length).to.be.at.most(60);
        expect(derived.text).to.contain('retires the presented token');

        // The tag form upgrades to the Lit component; extraction reads the
        // same .sem-reveal-body the component builds.
        const component = byId(records, 'r-component');
        expect(component.fields.summarySource).to.equal('authored');
        expect(component.fields.summary).to.equal('Why session storage?');
        expect(component.text).to.contain('dies with the tab');
      });
    });

    it('sem-progress: clamped value plus the untouched authored attribute', () => {
      extract().then((records) => {
        const cov = byId(records, 'p-coverage');
        expect(cov.fields.value).to.equal(0.62);
        expect(cov.fields.rawValue).to.equal('0.62');
        expect(cov.fields.label).to.equal('coverage');
        expect(cov.text).to.equal('coverage :: 62%');

        const clamp = byId(records, 'p-clamp');
        expect(clamp.fields.value).to.equal(1);
        // Render clamps; the attribute stays as written (schema sem-progress).
        expect(clamp.fields.rawValue).to.equal('1.4');
      });
    });
  });

  describe('minting test — plain HTML carrying sem global attributes', () => {
    beforeEach(() => cy.visit('/demo/index.html'));

    it('extracts plain semantic HTML as records; id alone does not mint', () => {
      cy.document().then((doc) => {
        const root = doc.createElement('div');
        root.innerHTML =
          '<figure data-kind="diagram" data-tags="auth, flow">' +
          '<figcaption>Token exchange</figcaption></figure>' +
          '<blockquote kind="quote" id="q1">Rotate, do not extend.</blockquote>' +
          '<table data-kind="matrix"><tr><td>a</td></tr></table>' +
          '<p id="plain-anchor">no qualifier, no record</p>';
        const records = extractRecords(root);
        expect(records.map((r) => r.type)).to.deep.equal([
          'figure',
          'blockquote',
          'table'
        ]);
        expect(records[0].kind).to.equal('diagram');
        expect(records[0].tags).to.deep.equal(['auth', 'flow']);
        expect(records[0].text).to.equal('Token exchange');
        // v0.3 bare-attribute form reads the same as the data-* form.
        expect(records[1].kind).to.equal('quote');
        expect(records[1].id).to.equal('q1');
        expect(records[2].text).to.equal('a');
      });
    });

    it('accepts the v0.3 custom-element authoring form', () => {
      cy.document().then((doc) => {
        const root = doc.createElement('div');
        root.innerHTML =
          '<sem-facts id="v3" view-as="quiz">' +
          '<sem-fact id="v3-f" kind="concept">' +
          '<statement>JWTs rotate per session</statement>' +
          '<conclusion>Short-lived access.</conclusion>' +
          '<incorrect-statement>localStorage.</incorrect-statement>' +
          '</sem-fact></sem-facts>' +
          '<sem-progress value="0.5" label="done"></sem-progress>';
        const records = extractRecords(root);
        expect(records.map((r) => r.type)).to.deep.equal([
          'sem-facts',
          'sem-fact',
          'sem-progress'
        ]);
        expect(records[1].kind).to.equal('concept');
        expect(records[1].fields.statement).to.equal('JWTs rotate per session');
        expect(records[1].fields.conclusion).to.equal('Short-lived access.');
        expect(records[1].fields.incorrectStatements).to.deep.equal(['localStorage.']);
        expect(records[2].fields.value).to.equal(0.5);
        expect(records[2].text).to.equal('done :: 50%');
      });
    });

    it('parses the compact :: form for facts and properties', () => {
      cy.document().then((doc) => {
        const root = doc.createElement('div');
        root.innerHTML =
          '<div class="sem-fact">JWT rotation :: short-lived access</div>' +
          '<div class="sem-property">token ttl :: 15m</div>';
        const records = extractRecords(root);
        expect(records[0].fields.statement).to.equal('JWT rotation');
        expect(records[0].fields.conclusion).to.equal('short-lived access');
        expect(records[1].fields).to.deep.equal({
          key: 'token ttl',
          value: '15m'
        });
      });
    });
  });

  describe('purity', () => {
    it('extraction does not mutate the DOM', () => {
      cy.visit('/demo/index.html');
      cy.document().then((doc) => {
        const before = doc.body.innerHTML;
        extractRecords(doc);
        extractText(doc);
        expect(doc.body.innerHTML).to.equal(before);
      });
    });
  });

  describe('THE CENTRAL INVARIANT (spec/extraction.md §5)', () => {
    it('JS-off extraction deep-equals extraction on the enhanced page', () => {
      let jsOff;
      visitJsOff();
      extract().then((records) => {
        jsOff = records;
        expect(jsOff).to.have.length(EXPECTED_TYPES.length);
      });
      cy.visit('/demo/index.html');
      extract().then((jsOn) => {
        expect(jsOn).to.deep.equal(jsOff);
      });
    });

    it('extraction is identical under every view-as mode', () => {
      let baseline;
      visitJsOff();
      extract().then((records) => {
        baseline = records;
      });

      const modes = [
        ['list', 'plain'],
        ['list', 'quiz'],
        ['flashcards', 'plain'],
        ['flashcards', 'quiz'],
        ['quiz', 'plain'],
        ['quiz', 'quiz']
      ];
      modes.forEach(([facts, details]) => {
        visitWithViews(facts, details);
        // The substitution really did take effect on the enhanced page.
        cy.get('.sem-facts').first().should('have.attr', 'data-view-as', facts);
        extract().then((records) => {
          expect(records, 'view-as=' + facts + '/' + details).to.deep.equal(
            baseline
          );
        });
      });
    });

    it('interacting with the page does not change extraction output', () => {
      let before;
      cy.visit('/demo/index.html');
      extract().then((records) => {
        before = records;
      });

      // Flip a flashcard.
      cy.get('.sem-facts[data-view-as="flashcards"] .sem-fact.sem-current').click();
      // Advance the deck.
      cy.get('.sem-facts[data-view-as="flashcards"] [data-act="next"]').click();
      // Answer a quiz option.
      cy.get('.sem-facts[data-view-as="quiz"] .sem-current .sem-quiz-options button')
        .first()
        .click();
      // Switch a view (moves data-active).
      cy.get('#deploy .sem-views-tabs [role="tab"]').eq(1).click();
      // Reveal an occluded highlight.
      cy.get('.sem-details[data-view-as="quiz"] .sem-occluded').first().click();
      // Expand the collapsed note (removes the `collapsed` attribute).
      cy.get('.sem-note[data-variant="tip"] .sem-note-summary').click();

      extract().then((after) => {
        expect(after).to.deep.equal(before);
      });
    });
  });

  describe('reference definitions (round 2)', () => {
    beforeEach(() => cy.visit('/demo/index.html'));

    it('a tag definition extracts as one structured record', () => {
      extract().then((records) => {
        const d = byId(records, 'd-note');
        expect(d.type).to.equal('sem-tag-def');
        expect(d.fields.tag).to.equal('sem-note');
        expect(d.fields.name).to.equal('Note');
        expect(d.fields.group).to.equal('annotation');
        expect(d.fields.children).to.deep.equal(['sem-note-summary']);
        const attrs = d.fields.attributes;
        expect(attrs).to.have.length(2);
        expect(attrs[0]).to.include({
          name: 'variant', type: 'string', required: false, default: 'tip',
        });
        expect(attrs[0].allowed).to.deep.equal(['tip', 'warning', 'danger']);
        expect(attrs[1]).to.include({ name: 'collapsed', required: true });
        expect(d.text).to.equal(
          'sem-note (Note) — An inline annotation with an optional variant and a collapsible body.'
        );
      });
    });

    it('an API call extracts with the method uppercased and ordered params', () => {
      extract().then((records) => {
        const a = byId(records, 'a-token');
        expect(a.type).to.equal('sem-api-call');
        expect(a.fields).to.include({
          name: 'Create token', method: 'POST', endpoint: '/oauth/token', status: '200',
        });
        const params = a.fields.params;
        expect(params).to.have.length(3);
        expect(params[0]).to.include({
          name: 'grant_type', in: 'body', type: 'string', required: true,
        });
        expect(params[0].allowed).to.deep.equal(['authorization_code', 'refresh_token']);
        expect(params[2]).to.include({ name: 'ttl', in: 'response', type: 'integer', required: false });
      });
    });

    it('the class-form tag definition extracts identically to the tag form', () => {
      extract().then((records) => {
        const d = byId(records, 'd-attr-class');
        expect(d.type).to.equal('sem-tag-def');
        expect(d.fields.tag).to.equal('sem-tag-attr');
        expect(d.fields.attributes.map((a) => a.name)).to.deep.equal(['name', 'type']);
        expect(d.fields.attributes[0].required).to.equal(true);
      });
    });
  });

  describe('annotated plain text (conventions.md §8)', () => {
    beforeEach(() => cy.visit('/demo/index.html'));

    it('renders indented, annotated lines from the same records', () => {
      cy.document().then((doc) => {
        const text = extractText(doc);
        expect(text).to.contain('sem-agent: Auth Guide');
        expect(text).to.contain('sem-facts (#facts-list)');
        expect(text).to.contain(
          '  sem-fact (#f-jwt): JWTs rotate per session :: Short-lived access'
        );
        expect(text).to.contain('sem-procedure (kind=runbook)');
        expect(text).to.contain('    status: blocked');
        expect(text).to.contain('sem-progress (#p-clamp): out-of-range fixture :: 100%');
        expect(text).to.contain('  rawValue: 1.4');
        // No generated chrome leaks into the text rendering.
        expect(text).not.to.contain('score');
        expect(text).not.to.contain('1/3');
      });
    });

    it('plain text is identical with JS off', () => {
      let jsOn;
      cy.document().then((doc) => {
        jsOn = extractText(doc);
      });
      visitJsOff();
      cy.document().then((doc) => {
        expect(extractText(doc)).to.equal(jsOn);
      });
    });
  });
});
