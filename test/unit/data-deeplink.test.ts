// @vitest-environment happy-dom
// Unit spec — phase 6: the modal viewer and the deep links
// (spec/data-visualizer.md §10)
//
// Feature: the hash grammar (§10, the shared/state.ts form)
//   Scenario: dv/bucket/view/q/modal parse; foreign segments pass through untouched
//   Scenario: no data-viz segments parses to null; modal honours 1/bare/false/0
//   Scenario: broken percent-encoding reads literally; empty values drop
//   Scenario: serialize round-trips and encodes; empty parts drop
// Feature: minting from a rendered table
//   Scenario: activeViewName names the declared view matching the shown columns
// Feature: the enhance applies link state
//   Scenario: #dv=<id>&view=<name> flips the container's sources to that view
//   Scenario: #view=<name>&bucket=<source> scopes to the named source
//   Scenario: #dv=<id>&q=<encoded> sets the query chrome and re-runs it
//   Scenario: a link naming another container does nothing
// Feature: the modal viewer
//   Scenario: modal=1 opens a role=dialog panel holding the container's children
//   Scenario: Esc closes; the children return in order; the enhance re-runs safely
// Feature: the late path
//   Scenario: a bucket link applies when its source renders after the enhance

import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseDataDeepLink,
  serializeDataDeepLink,
  activeViewName,
} from '../../src/data/deeplink.js';
import { buildTable } from '../../src/reading/data-tableview.js';
import {
  applyDeepLinkToSource,
  closeDataModal,
  modalOpenFor,
  resetDeepLinkLatch,
} from '../../src/reading/data-modal.js';
import { enhanceDataVisualizerElement } from '../../src/reading/data.js';

const FLEET = `| name   | region | port |
| ------ | ------ | ---- |
| alpha  | eu     | 80   |
| beta   | us     | 443  |`;

function container(id: string, extra = ''): HTMLElement {
  const el = document.createElement('sem-data-visualizer');
  if (id) el.id = id;
  el.innerHTML =
    '<sem-data-source data-name="fleet" data-views="all=*; ops=name" data-view="all">\n' +
    FLEET +
    '\n</sem-data-source>' +
    extra;
  document.body.appendChild(el);
  return el;
}

function heads(src: Element): string[] {
  return Array.from(src.querySelectorAll('thead th')).map((th) => ({
    name: (th.textContent ?? '').trim(),
    hidden: th.hasAttribute('hidden'),
  })).filter((h) => !h.hidden).map((h) => h.name);
}

beforeEach(() => {
  document.body.innerHTML = '';
  location.hash = '';
  resetDeepLinkLatch();
});

describe('parseDataDeepLink', () => {
  it('parses the full form and leaves foreign segments alone', () => {
    const link = parseDataDeepLink('#deploy/argocd&sem-audience=operator&dv=ops&view=ops&q=SELECT%20x&modal=1');
    expect(link).toEqual({ dv: 'ops', bucket: null, view: 'ops', q: 'SELECT x', modal: true, ref: null });
  });

  it('parses the source-scoped form', () => {
    const link = parseDataDeepLink('#view=ops&bucket=Fleet%20status');
    expect(link).toEqual({ dv: null, bucket: 'Fleet status', view: 'ops', q: null, modal: false, ref: null });
  });

  it('parses ref alongside the dv segments (see-also deep link, 0.9.5)', () => {
    const link = parseDataDeepLink('#dv=store&ref=sa-1');
    expect(link).not.toBeNull();
    expect(link!.dv).toBe('store');
    expect(link!.ref).toBe('sa-1');
  });

  it('is null without any data-viz segment', () => {
    expect(parseDataDeepLink('')).toBe(null);
    expect(parseDataDeepLink('#deploy/argocd&sem-audience=operator')).toBe(null);
  });

  it('reads modal as 1/bare true, 0/false/empty false', () => {
    expect(parseDataDeepLink('#dv=x&modal')!.modal).toBe(true);
    expect(parseDataDeepLink('#dv=x&modal=1')!.modal).toBe(true);
    expect(parseDataDeepLink('#dv=x&modal=0')!.modal).toBe(false);
    expect(parseDataDeepLink('#dv=x&modal=false')!.modal).toBe(false);
    expect(parseDataDeepLink('#dv=x&modal=')!.modal).toBe(false);
  });

  it('reads broken percent-encoding literally and drops empty values', () => {
    const link = parseDataDeepLink('#dv=x&q=%zz&view=');
    expect(link).toEqual({ dv: 'x', bucket: null, view: null, q: '%zz', modal: false, ref: null });
  });
});

describe('serializeDataDeepLink', () => {
  it('round-trips and encodes', () => {
    const link = { dv: 'ops', bucket: null, view: 'ops', q: 'SELECT name FROM "x"', modal: true, ref: null };
    expect(serializeDataDeepLink(link)).toBe('dv=ops&view=ops&q=SELECT%20name%20FROM%20%22x%22&modal=1');
    expect(parseDataDeepLink(serializeDataDeepLink(link))).toEqual(link);
  });

  it('round-trips ref', () => {
    const out = serializeDataDeepLink({ dv: null, bucket: null, view: null, q: null, modal: null, ref: 'sa-2' });
    expect(out).toBe('ref=sa-2'); // the '#' belongs to the location hash, not the grammar
  });

  it('drops empty parts', () => {
    expect(serializeDataDeepLink({ dv: null, bucket: 'f', view: null, q: null, modal: false, ref: null })).toBe('bucket=f');
  });
});

describe('activeViewName', () => {
  it('names the declared view matching the shown columns', () => {
    const views = [
      { name: 'all', columns: '*' as const },
      { name: 'ops', columns: ['name'] },
    ];
    const columns = ['name', 'region', 'port'];
    expect(activeViewName(views, columns, [true, false, false])).toBe('ops');
    expect(activeViewName(views, columns, [true, true, true])).toBe('all');
    expect(activeViewName(views, columns, [false, true, false])).toBe(null);
  });
});

describe('the enhance applies link state', () => {
  it('dv + view flips the container sources to that view', () => {
    location.hash = '#dv=ops&view=ops';
    const el = container('ops');
    enhanceDataVisualizerElement(el);
    const src = el.querySelector('sem-data-source')!;
    expect(heads(src)).toEqual(['name']);
    expect(src.querySelector('.sem-data-view[aria-pressed="true"]')?.textContent).toBe('ops');
  });

  it('view + bucket scopes to the named source only', () => {
    location.hash = '#view=ops&bucket=fleet';
    const el = container('');
    const other = document.createElement('sem-data-source');
    other.setAttribute('data-name', 'other');
    other.textContent = '| a |\n| - |\n| 1 |';
    el.appendChild(other);
    enhanceDataVisualizerElement(el);
    expect(heads(el.querySelector('[data-name="fleet"]')!)).toEqual(['name']);
    expect(heads(el.querySelector('[data-name="other"]')!)).toEqual(['a']);
  });

  it('dv + q sets the query chrome and re-runs it', () => {
    location.hash = '#dv=ops&q=SELECT%20port%20FROM%20fleet%20ORDER%20BY%20port%20DESC';
    const el = container('ops', '<sem-data-query>SELECT name FROM fleet</sem-data-query>');
    enhanceDataVisualizerElement(el);
    const chrome = el.querySelector('.sem-data-query-chrome')!;
    expect((chrome.querySelector('.sem-data-query-input') as HTMLTextAreaElement).value)
      .toBe('SELECT port FROM fleet ORDER BY port DESC');
    expect(chrome.querySelector('.sem-data-query-status')?.textContent).toBe('2 rows.');
    expect(Array.from(chrome.querySelectorAll('.sem-data-query-results thead th')).map((th) => th.textContent))
      .toEqual(['port']);
  });

  it('a link naming another container does nothing here', () => {
    location.hash = '#dv=somewhere-else&view=ops';
    const el = container('ops');
    enhanceDataVisualizerElement(el);
    expect(heads(el.querySelector('sem-data-source')!)).toEqual(['name', 'region', 'port']);
  });
});

describe('the modal viewer', () => {
  it('modal=1 opens a dialog panel holding the container children', () => {
    location.hash = '#dv=ops&view=ops&modal=1';
    const el = container('ops');
    enhanceDataVisualizerElement(el);
    const panel = document.querySelector('.sem-data-modal-panel')!;
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.querySelector('table')).not.toBe(null);
    expect(el.querySelector('table')).toBe(null); // children are teleported
    expect(modalOpenFor(el)).toBe(true);
  });

  it('Esc closes; children return in order; re-enhance stays idempotent', () => {
    location.hash = '#dv=ops&modal=1';
    const el = container('ops');
    enhanceDataVisualizerElement(el);
    expect(document.querySelector('.sem-data-modal')).not.toBe(null);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.sem-data-modal')).toBe(null);
    expect(modalOpenFor(el)).toBe(false);
    const kids = Array.from(el.children).map((c) => c.className || c.tagName.toLowerCase());
    expect(kids[0]).toBe('sem-data-tools');
    expect(el.querySelectorAll('table')).toHaveLength(1);
    expect(el.querySelector('.sem-data-query-status') ?? el.querySelector('table')).not.toBe(null);

    enhanceDataVisualizerElement(el); // re-run must not duplicate anything
    expect(el.querySelectorAll('table')).toHaveLength(1);
    expect(el.querySelectorAll('.sem-data-tools')).toHaveLength(1);
  });

  it('the link latch opens the modal at most once', () => {
    location.hash = '#view=ops&bucket=fleet&modal=1';
    const el = container('');
    enhanceDataVisualizerElement(el);
    expect(document.querySelector('.sem-data-modal-panel')).not.toBe(null);
    closeDataModal();
    enhanceDataVisualizerElement(el);
    expect(document.querySelector('.sem-data-modal-panel')).toBe(null);
  });
});

describe('the late path (async sources)', () => {
  it('a bucket link applies when its source renders after the enhance', () => {
    location.hash = '#view=ops&bucket=fleet';
    const src = document.createElement('sem-data-source');
    src.setAttribute('data-name', 'fleet');
    src.setAttribute('data-views', 'all=*; ops=name');
    src.setAttribute('data-view', 'all');
    const body = document.createElement('div');
    body.className = 'sem-data-body';
    const table = buildTable(
      { columns: ['name', 'region', 'port'], rows: [['a', 'eu', '80']] },
      [
        { name: 'name', type: 'string', nullable: false },
        { name: 'region', type: 'string', nullable: false },
        { name: 'port', type: 'integer', nullable: false },
      ],
      [true, true, true],
      'fleet',
    );
    body.appendChild(table);
    src.appendChild(body);
    document.body.appendChild(src);

    applyDeepLinkToSource(src);
    expect(heads(src)).toEqual(['name']);
  });
});
