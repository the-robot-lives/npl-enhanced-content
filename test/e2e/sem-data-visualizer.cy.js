// BDD spec — data visualizer showcase · source: spec/data-visualizer.md (phases 2–6)
//
// Feature: the demo page at demo/data-visualizer.html exercises every built
//          phase — inline payloads, file loads, a declarative join, a column
//          view, and the editable default query
//   Scenario: the inline markdown table renders with its inferred schema
//   Scenario: the inline CSV renders typed columns
//   Scenario: the yaml-schema envelope flattens dotted columns and required-ness
//   Scenario: the view group filters columns via aria-pressed buttons
//   Scenario: relative file loads fetch CSV and YAML from demo/data/ and fill buckets
//   Scenario: the declarative join composes both file buckets on the named key
//   Scenario: the default query renders results; editing it re-runs and changes the result
//   Scenario: the page runs clean — no console errors, no uncaught exceptions
//
// Visualizer order on the page: 0 Releases · 1 Pipelines · 2 Users ·
// 3 Fleet (views) · 4 combined files+join+query.

const at = (i) => cy.get('sem-data-visualizer').eq(i);
const schemaOf = (i) => at(i).find('.sem-data-schema')
  .then(($el) => JSON.parse($el[0].textContent));

describe('data visualizer showcase', () => {
  const PAGE = '/demo/data-visualizer.html';
  let errors = [];

  beforeEach(() => {
    errors = [];
    cy.visit(PAGE, {
      onBeforeLoad(win) {
        win.console.error = (...args) => { errors.push(args.map(String).join(' ')); };
        win.addEventListener('error', (e) => errors.push('uncaught: ' + e.message));
      },
    });
  });

  it('inline markdown table — rows and inferred schema', () => {
    at(0).find('tbody tr').should('have.length', 3);
    schemaOf(0).then((s) => {
      expect(s.name).to.eq('Releases');
      expect(s.format).to.eq('table');
      expect(s.columns.map((c) => c.name)).to.deep.eq(['version', 'date']);
      expect(s.columns[1].type).to.eq('date');
    });
  });

  it('inline CSV — typed columns', () => {
    at(1).find('tbody tr').should('have.length', 3);
    schemaOf(1).then((s) => {
      expect(s.name).to.eq('Pipelines');
      expect(s.format).to.eq('csv');
      expect(s.columns.map((c) => c.type)).to.deep.eq(['string', 'string', 'integer']);
    });
  });

  it('yaml-schema — dotted flatten, required-ness, nested object columns', () => {
    at(2).find('tbody tr').should('have.length', 2);
    schemaOf(2).then((s) => {
      expect(s.name).to.eq('Users');
      expect(s.type).to.eq('yaml-schema');
      expect(s.columns.map((c) => c.name)).to.deep.eq(['id', 'email', 'name', 'address.city', 'address.postcode']);
      const byName = Object.fromEntries(s.columns.map((c) => [c.name, c]));
      expect(byName['id'].type).to.eq('integer');
      expect(byName['id'].nullable).to.eq(false);    // required…
      expect(byName['email'].nullable).to.eq(false); // …and declared-over-inferred:
      // nullable = not required AND inferred-nullable — every record has a
      // name, so it is not nullable even though it was not required
      expect(byName['name'].nullable).to.eq(false);
      expect(byName['address.city'].type).to.eq('string');
    });
    at(2).find('tbody tr').first().find('td')
      .should('contain', 'ada@example.com').and('contain', 'London');
  });

  it('view group — two views, switching hides columns in place', () => {
    at(3).find('.sem-data-views button').should('have.length', 2);
    at(3).find('.sem-data-views button').eq(0).should('have.attr', 'aria-pressed', 'true');
    const visibleCols = () => at(3).find('thead th:visible').then(($th) => [...$th].map((th) => th.textContent));
    visibleCols().then((heads) => expect(heads).to.deep.eq(['name', 'region', 'port', 'replicas']));
    at(3).find('.sem-data-views button').eq(1).click();
    at(3).find('.sem-data-views button').eq(1).should('have.attr', 'aria-pressed', 'true');
    visibleCols().then((heads) => expect(heads).to.deep.eq(['name', 'replicas']));
    // hidden columns stay in the DOM (extraction never loses them)
    at(3).find('thead th').should('have.length', 4);
  });

  it('relative file loads — CSV and YAML buckets arrive async', () => {
    at(4).find('sem-data-source').eq(0).find('tbody tr').should('have.length', 4);
    at(4).find('sem-data-source').eq(1).find('tbody tr').should('have.length', 3);
    at(4).find('sem-data-source .sem-data-error, sem-data-source .sem-data-pending').should('not.exist');
    at(4).find('sem-data-source').eq(0).find('tbody tr').first().find('td').first().should('have.text', 'auth');
    at(4).find('sem-data-source').eq(1).find('tbody tr').first().find('td').last().should('have.text', '24');
  });

  it('declarative join — the query reads the joined bucket, ordered by the right side', () => {
    at(4).find('.sem-data-error').should('not.exist');
    at(4).find('.sem-data-query-input').should('have.value',
      'SELECT name, port, zone, latency_ms FROM service-regions ORDER BY latency_ms DESC');
    // 4 services, all with a known region → 4 joined rows (inner, none dropped),
    // ordered by the joined-in latency: ap 132, us 81, then the eu pair (stable).
    at(4).find('.sem-data-query-results tbody tr').should('have.length', 4);
    at(4).find('.sem-data-query-results thead th').then(($th) => {
      expect([...$th].map((th) => th.textContent)).to.deep.eq(['name', 'port', 'zone', 'latency_ms']);
    });
    at(4).find('.sem-data-query-results tbody tr').first().find('td').then(($td) => {
      expect([...$td].map((td) => td.textContent)).to.deep.eq(['pages', '3000', 'ap-south-1', '132']);
    });
    at(4).find('.sem-data-query-results tbody tr').eq(3).find('td').then(($td) => {
      expect([...$td].map((td) => td.textContent)).to.deep.eq(['search', '9200', 'eu-west-1', '24']);
    });
    at(4).find('.sem-data-query-status').should('have.text', '4 rows.');
  });

  it('default query — editing re-runs, result changes; a broken statement alerts', () => {
    // edit → debounced re-run → different result, back on the raw buckets
    at(4).find('.sem-data-query-input').clear().type('SELECT name FROM services WHERE replicas >= 5');
    at(4).find('.sem-data-query-results tbody tr').should('have.length', 1);
    at(4).find('.sem-data-query-results tbody tr').first().find('td').first().should('have.text', 'search');
    // a broken statement renders an alert, never a blank
    at(4).find('.sem-data-query-input').clear().type('SELECT * FROM services JOIN nothing');
    at(4).find('.sem-data-query-error').should('have.attr', 'role', 'alert')
      .and('contain.text', 'out of scope');
  });

  it('page runs clean — no console errors or uncaught exceptions', () => {
    at(4).find('.sem-data-query-results tbody tr').should('have.length', 4);
    cy.wait(500); // let any late async complaint surface
    cy.wrap(null).then(() => expect(errors, 'console errors').to.deep.eq([]));
  });
});

// Phase 6 — modal viewer + deep links (spec/data-visualizer.md §10).
// fleet-views is visualizer 3; ops-combined is visualizer 4.
describe('data visualizer phase 6 — modal + deep links', () => {
  const PAGE = '/demo/data-visualizer.html';

  it('the chrome renders — Expand everywhere, Copy link where a target exists', () => {
    cy.visit(PAGE);
    cy.get('sem-data-visualizer .sem-data-expand').should('have.length', 5);
    cy.get('#fleet-views .sem-data-copy').should('exist');
    cy.get('#ops-combined .sem-data-copy').should('exist');
  });

  it('Expand opens a live dialog; Esc closes and restores the children', () => {
    cy.visit(PAGE);
    at(3).find('.sem-data-expand').click();
    // (no stored chains — reusing a cy.get variable continues from the last
    // subject; re-query the panel, whose contents just moved)
    cy.get('.sem-data-modal-panel').should('have.attr', 'role', 'dialog')
      .and('have.attr', 'aria-modal', 'true');
    cy.get('.sem-data-modal-panel').find('table tbody tr').should('have.length', 4);
    // the modal is live: switch the view inside it
    cy.get('.sem-data-modal-panel').find('.sem-data-views button').eq(1).click();
    cy.get('.sem-data-modal-panel').find('thead th:visible').then(($th) => expect([...$th].map((th) => th.textContent)).to.deep.eq(['name', 'replicas']));
    cy.get('body').type('{esc}');
    cy.get('.sem-data-modal').should('not.exist');
    // the container got its children back — and kept the switched view
    at(3).find('table').should('exist');
    at(3).find('thead th:visible').then(($th) => expect([...$th].map((th) => th.textContent)).to.deep.eq(['name', 'replicas']));
    at(3).find('.sem-data-expand').should('have.attr', 'aria-expanded', 'false');
  });

  it('Copy link mints the container-scoped link for the active view', () => {
    cy.visit(PAGE);
    cy.window().then((win) => cy.stub(win.navigator.clipboard, 'writeText').resolves());
    at(3).find('.sem-data-views button').eq(1).click();
    at(3).find('.sem-data-copy').click();
    at(3).find('.sem-data-copy-status').should('have.text', 'Copied');
    cy.window().then((win) => {
      expect(win.location.hash).to.eq('#dv=fleet-views&view=operators');
      expect(win.navigator.clipboard.writeText).to.have.been.calledWithMatch(/#dv=fleet-views&view=operators$/);
    });
  });

  it('a deep link restores the view on load', () => {
    cy.visit(PAGE + '#dv=fleet-views&view=operators');
    at(3).find('.sem-data-views button').eq(1).should('have.attr', 'aria-pressed', 'true');
    at(3).find('thead th:visible').then(($th) => expect([...$th].map((th) => th.textContent)).to.deep.eq(['name', 'replicas']));
  });

  it('a deep link with q= sets the query chrome and re-runs it', () => {
    const q = encodeURIComponent('SELECT name FROM services WHERE replicas >= 5');
    cy.visit(PAGE + '#dv=ops-combined&q=' + q);
    at(4).find('.sem-data-query-input').should('have.value', 'SELECT name FROM services WHERE replicas >= 5');
    at(4).find('.sem-data-query-results tbody tr').should('have.length', 1);
    at(4).find('.sem-data-query-results tbody tr').first().find('td').first().should('have.text', 'search');
    at(4).find('.sem-data-query-status').should('have.text', '1 row.');
  });

  it('a source-scoped link with modal=1 reopens the modal', () => {
    cy.visit(PAGE + '#view=operators&bucket=fleet&modal=1');
    cy.get('.sem-data-modal-panel').should('have.attr', 'role', 'dialog');
    cy.get('.sem-data-modal-panel thead th:visible').then(($th) => {
      expect([...$th].map((th) => th.textContent)).to.deep.eq(['name', 'replicas']);
    });
  });

  it('a source-scoped link applies without the modal when modal is absent', () => {
    cy.visit(PAGE + '#view=operators&bucket=Fleet');
    cy.get('.sem-data-modal-panel').should('not.exist');
    at(3).find('thead th:visible').then(($th) => expect([...$th].map((th) => th.textContent)).to.deep.eq(['name', 'replicas']));
  });
});
