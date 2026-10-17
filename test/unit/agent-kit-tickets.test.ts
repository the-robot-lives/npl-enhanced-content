// @vitest-environment happy-dom
// Unit spec — src/lit/agent-kit/ticket-shared.ts + the six ticket tags +
// agent-kit-ticket-ref · the family C ticket contract
//
// Feature: the agent-kit ticket tags render cached ticket records
//   Scenario: every ticket tag registers under the agent-kit namespace (defineAkit, idempotent)
//   Scenario: the key regex accepts prefix-dash-digits and rejects the rest
//   Scenario: the authored body IS the record — title/description/stamp children survive upgrade in document order
//   Scenario: chrome renders the meta row (type chip, key, state badge, label chips) inside one agent-kit-chrome container
//   Scenario: the share footer renders only when uuid + org are authored, linking /app/<org>/tickets/<uuid>
//   Scenario: a malformed key is warned once, and the card omits the key chip, anchor, and footer
//   Scenario: attribute state/labels win over the child spelling; the child spelling never renders a duplicate badge
//   Scenario: the key anchor publishes #akit-ticket-<KEY> before the authored children for refs and boards
//   Scenario: snapshot enrichment (inline JSON with updated_at) lands in the cached-embed chrome with status cached
//   Scenario: ticket-ref becomes a keyboard-reachable link that scrolls to the anchor and emits ticket-ref-follow

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TICKET_KEY_RE,
  isTicketKey,
  ticketAnchorId,
} from '../../src/lit/agent-kit/ticket-shared.js';
import '../../src/lit/agent-kit/index.js';
import { CachedEmbedElement } from '../../src/lit/shared/cached-embed.js';

const TICKET_TAGS = [
  'agent-kit-issue',
  'agent-kit-epic',
  'agent-kit-bug',
  'agent-kit-user-story',
  'agent-kit-task',
  'agent-kit-sub-task',
] as const;

const TYPE_LABELS: Record<string, string> = {
  'agent-kit-issue': 'Issue',
  'agent-kit-epic': 'Epic',
  'agent-kit-bug': 'Bug',
  'agent-kit-user-story': 'User story',
  'agent-kit-task': 'Task',
  'agent-kit-sub-task': 'Sub-task',
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function settle(el: HTMLElement): Promise<void> {
  await tick();
  if ('updateComplete' in el) await (el as { updateComplete: Promise<boolean> }).updateComplete;
  await tick();
  if ('updateComplete' in el) await (el as { updateComplete: Promise<boolean> }).updateComplete;
}

async function mount(tag: string, attrs: Record<string, string>, html?: string): Promise<HTMLElement> {
  const el = document.createElement(tag) as HTMLElement;
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  if (html) el.innerHTML = html;
  document.body.appendChild(el);
  customElements.upgrade(el);
  await settle(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('ticket key shape', () => {
  it('accepts a ≤6-char prefix, a dash, and ≥3 digits', () => {
    expect(TICKET_KEY_RE.source).toBe('^[A-Z0-9]{1,6}-\\d{3,}$');
    for (const key of ['AKIT-001', 'R2D2-0417', 'A-000', 'ZZZZZZ-99999999']) {
      expect(isTicketKey(key), key).toBe(true);
    }
  });

  it('rejects short digit runs, bad prefixes, whitespace, and empty', () => {
    for (const key of ['AKIT-01', 'AKIT-1', 'akit-001', 'AKIT_001', 'TOOLONGP-001', '-001', '', ' AKIT-001']) {
      expect(isTicketKey(key), JSON.stringify(key)).toBe(false);
    }
    expect(isTicketKey(null)).toBe(false);
    expect(isTicketKey(undefined)).toBe(false);
  });
});

describe('ticket registration', () => {
  it('all six ticket tags plus the ref register under the agent-kit namespace', () => {
    for (const tag of [...TICKET_TAGS, 'agent-kit-ticket-ref']) {
      const ctor = customElements.get(tag);
      expect(ctor, tag).toBeTruthy();
      expect(new ctor(), tag).toBeInstanceOf(CachedEmbedElement);
    }
  });
});

describe('the authored body is the record', () => {
  it('title/description/last-updated children survive upgrade in document order', async () => {
    const el = await mount(
      'agent-kit-issue',
      { org: 'acme', project: 'semtext', key: 'AKIT-001' },
      `<agent-kit-last-updated>2026-10-17T09:24:00Z</agent-kit-last-updated>
       <agent-kit-title>Extractor drops class-form parts</agent-kit-title>
       <agent-kit-description>extractRecords misses the alias form.</agent-kit-description>`,
    );
    const parts = el.querySelectorAll('agent-kit-title, agent-kit-description, agent-kit-last-updated');
    expect(Array.from(parts).map((p) => p.tagName.toLowerCase())).toEqual([
      'agent-kit-last-updated',
      'agent-kit-title',
      'agent-kit-description',
    ]);
    expect(el.querySelector('agent-kit-title')?.textContent).toBe('Extractor drops class-form parts');
    // nothing was adopted into chrome or rewritten
    expect(el.querySelector('.agent-kit-ticket-meta')?.contains(el.querySelector('agent-kit-title'))).toBe(false);
  });
});

describe('authored-derived chrome', () => {
  it('renders the meta row inside ONE agent-kit-chrome container, appended after the record', async () => {
    const el = await mount(
      'agent-kit-bug',
      { org: 'acme', project: 'semtext', key: 'AKIT-003', state: 'review', labels: 'css,build' },
      '<agent-kit-title>Vocabulary display line collides</agent-kit-title>',
    );
    const chromes = el.querySelectorAll('.agent-kit-chrome');
    expect(chromes.length).toBe(2); // the anchor span + the meta container
    const meta = el.querySelector('.agent-kit-ticket-chrome') as HTMLElement;
    expect(meta).toBeTruthy();
    expect(meta.getAttribute('data-sem-chrome')).toBe('');
    expect(el.lastElementChild).toBe(meta); // chrome is appended, never spliced between children

    expect(meta.querySelector('.agent-kit-ticket-type')?.textContent?.trim()).toBe('Bug');
    expect(meta.querySelector('.agent-kit-ticket-type')?.getAttribute('data-ticket-type')).toBe('bug');
    expect(meta.querySelector('.agent-kit-ticket-key')?.textContent?.trim()).toBe('AKIT-003');
    expect(meta.querySelector('.agent-kit-ticket-state')?.getAttribute('data-state')).toBe('review');
    const labels = Array.from(meta.querySelectorAll('.agent-kit-ticket-label')).map((n) => n.textContent?.trim());
    expect(labels).toEqual(['css', 'build']);
  });

  it('each of the six tags chips its own type label from the tag name', async () => {
    for (const tag of TICKET_TAGS) {
      const el = await mount(tag, { org: 'acme', key: 'AKIT-001' }, '<agent-kit-title>t</agent-kit-title>');
      const chip = el.querySelector('.agent-kit-ticket-type');
      expect(chip?.textContent?.trim(), tag).toBe(TYPE_LABELS[tag]);
      expect(chip?.getAttribute('data-ticket-type'), tag).toBe(tag.replace('agent-kit-', ''));
    }
  });

  it('the share footer renders only with uuid + org, linking /app/<org>/tickets/<uuid>', async () => {
    const full = await mount(
      'agent-kit-issue',
      { org: 'acme', key: 'AKIT-001', uuid: '3f1c9a2e-8b74-4f6a-9d21-7ae5c0b4d101' },
      '<agent-kit-title>t</agent-kit-title>',
    );
    const link = full.querySelector('a.agent-kit-ticket-open') as HTMLAnchorElement;
    expect(link?.getAttribute('href')).toBe('/app/acme/tickets/3f1c9a2e-8b74-4f6a-9d21-7ae5c0b4d101');
    expect(link?.textContent?.trim()).toBe('Open in agent-kit');

    const noOrg = await mount(
      'agent-kit-issue',
      { key: 'AKIT-001', uuid: '3f1c9a2e' },
      '<agent-kit-title>t</agent-kit-title>',
    );
    expect(noOrg.querySelector('a.agent-kit-ticket-open')).toBeNull();
  });

  it('a malformed key is warned once and drops the key chip and anchor — the uuid share link is independent', async () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(' '));
    try {
      const el = await mount(
        'agent-kit-task',
        { org: 'acme', key: 'akit-01', uuid: 'abc' },
        '<agent-kit-title>t</agent-kit-title>',
      );
      await settle(el); // a second pass must not re-warn
      expect(el.querySelector('.agent-kit-ticket-key')).toBeNull();
      expect(el.querySelector('.agent-kit-ticket-anchor')).toBeNull();
      // the share link keys on uuid + org, not on the local key shape
      expect(el.querySelector('a.agent-kit-ticket-open')).toBeTruthy();
      expect(warnings.filter((w) => w.includes('akit-01')).length).toBe(1);
    } finally {
      console.warn = origWarn;
    }
  });

  it('publishes the key anchor before the authored children for refs and boards', async () => {
    const el = await mount(
      'agent-kit-epic',
      { org: 'acme', key: 'AKIT-002' },
      '<agent-kit-title>The authoring v2 epic</agent-kit-title>',
    );
    const anchor = el.querySelector('#' + ticketAnchorId('AKIT-002')) as HTMLElement;
    expect(anchor?.classList.contains('agent-kit-ticket-anchor')).toBe(true);
    expect(anchor?.hasAttribute('data-sem-chrome')).toBe(true);
    expect(anchor.nextElementSibling?.tagName.toLowerCase()).toBe('agent-kit-title');
  });
});

describe('state/labels dual authoring', () => {
  it('the attribute spelling renders the badge; the child spelling never duplicates it', async () => {
    const byAttr = await mount(
      'agent-kit-user-story',
      { org: 'acme', key: 'AKIT-004', state: 'open' },
      '<agent-kit-title>t</agent-kit-title><agent-kit-state>done</agent-kit-state>',
    );
    expect(byAttr.querySelector('.agent-kit-ticket-state')?.getAttribute('data-state')).toBe('open');

    const byChild = await mount(
      'agent-kit-user-story',
      { org: 'acme', key: 'AKIT-004' },
      '<agent-kit-title>t</agent-kit-title><agent-kit-state>in-progress</agent-kit-state>',
    );
    expect(byChild.querySelector('.agent-kit-ticket-state')).toBeNull(); // visible authored child is the record
    expect(byChild.querySelector('agent-kit-state')?.textContent).toBe('in-progress');
  });
});

describe('snapshot enrichment', () => {
  it('an inline JSON snapshot with updated_at lands in the cached-embed chrome with status cached', async () => {
    const el = await mount(
      'agent-kit-task',
      { org: 'acme', key: 'AKIT-005' },
      `<agent-kit-title>t</agent-kit-title>
       <script type="application/json">${JSON.stringify({ key: 'AKIT-005', state: 'done', updated_at: '2026-10-14T17:55:00Z' })}</script>`,
    );
    expect(el.getAttribute('status')).toBe('cached');
    const stamp = el.querySelector('.agent-kit-ticket-snapshot') as HTMLElement;
    expect(stamp?.textContent).toContain('2026-10-14');
    expect(stamp?.closest('[data-sem-chrome]')).toBeTruthy();
  });

  it('a snapshot without a recognizable stamp enriches nothing', async () => {
    const el = await mount(
      'agent-kit-task',
      { org: 'acme', key: 'AKIT-005' },
      `<agent-kit-title>t</agent-kit-title>
       <script type="application/json">${JSON.stringify({ key: 'AKIT-005' })}</script>`,
    );
    expect(el.querySelector('.agent-kit-ticket-snapshot')).toBeNull();
  });
});

describe('agent-kit-ticket-ref', () => {
  it('becomes a keyboard-reachable link carrying an aria-label', async () => {
    const el = await mount('agent-kit-ticket-ref', { key: 'AKIT-001' }, 'Extractor drops class-form parts');
    expect(el.getAttribute('role')).toBe('link');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('aria-label')).toBe('Go to ticket AKIT-001: Extractor drops class-form parts');
  });

  it('activating it scrolls the ticket anchor into view and emits ticket-ref-follow', async () => {
    await mount(
      'agent-kit-issue',
      { org: 'acme', key: 'AKIT-001' },
      '<agent-kit-title>t</agent-kit-title>',
    );
    const scrolled: string[] = [];
    const orig = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolled.push(this.id);
    };
    try {
      const ref = await mount('agent-kit-ticket-ref', { key: 'AKIT-001' }, 'the issue');
      const events: string[] = [];
      ref.addEventListener('agent-kit:ticket-ref-follow', (e) => {
        events.push((e as CustomEvent).detail.key);
      });
      ref.click();
      ref.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      expect(scrolled).toEqual([ticketAnchorId('AKIT-001'), ticketAnchorId('AKIT-001')]);
      expect(events).toEqual(['AKIT-001', 'AKIT-001']);
    } finally {
      HTMLElement.prototype.scrollIntoView = orig;
    }
  });

  it('a malformed key leaves the ref inert prose', async () => {
    const el = await mount('agent-kit-ticket-ref', { key: 'nope-9' }, 'dangling reference');
    expect(el.getAttribute('role')).toBeNull();
    expect(el.getAttribute('tabindex')).toBeNull();
    expect(el.textContent?.trim()).toBe('dangling reference');
  });

  it('a key with no card in the document warns instead of throwing', async () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(' '));
    try {
      const ref = await mount('agent-kit-ticket-ref', { key: 'AKIT-999' }, 'missing card');
      expect(() => ref.click()).not.toThrow();
      expect(warnings.some((w) => w.includes('AKIT-999'))).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });
});
