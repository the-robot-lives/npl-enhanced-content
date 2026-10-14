// @vitest-environment happy-dom
// Unit spec — src/lit/sem-chat.ts · the endpoint-driven chat element
//
// Feature: sem-chat turns composer input into a POST and streams the reply
//          into a role="log" transcript
//   Scenario: a send POSTs { model?, messages: [{role, content}, …] } as JSON
//   Scenario: an authored model is passed through; an absent model sends no key
//   Scenario: the completed user and assistant messages each dispatch
//             sem-chat-message (bubbles, composed, {role, content})
//   Scenario: a streamed non-JSON body appends chunks as they arrive
//   Scenario: a JSON { content } reply is the fallback path
//   Scenario: a non-2xx reply shows an inline role="alert" and re-enables input
//   Scenario: a network failure shows the same inline alert
//   Scenario: a send without an endpoint shows the alert and never fetches
//   Scenario: bare Enter sends; Shift+Enter inserts a newline
//   Scenario: the transcript is a labelled live log; the input is labelled

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// the named import evaluates the module, which registers <sem-chat>
import { SemChat, consumeReply } from '../../src/lit/sem-chat.js';

const ENC = new TextEncoder();

/** The shipped agent-kit chat fixture, read from disk (no bundling). */
const FIXTURE = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src/lit/fixtures/agent-kit/chat.json'), 'utf8'),
) as { rooms: Array<{ id: string; name: string }>; messages: Array<Record<string, unknown>> };

/** A fetch-Response quack with a stubbed header map (no env-specific Headers). */
function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    body: null,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

function streamResponse(chunks: string[], contentType = 'text/plain'): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(ENC.encode(chunk));
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    headers: { get: () => contentType },
    body: stream,
  } as unknown as Response;
}

async function mount(attrs: Record<string, string> = {}): Promise<SemChat> {
  const el = document.createElement('sem-chat');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function composer(el: SemChat): { textarea: HTMLTextAreaElement; form: HTMLFormElement; button: HTMLButtonElement } {
  const textarea = el.querySelector('.sem-chat-input') as HTMLTextAreaElement;
  const form = el.querySelector('.sem-chat-composer') as HTMLFormElement;
  const button = el.querySelector('.sem-chat-send') as HTMLButtonElement;
  return { textarea, form, button };
}

/** Fill the textarea and submit the composer the way Enter would. */
async function send(el: SemChat, text: string): Promise<void> {
  const { textarea, form } = composer(el);
  textarea.value = text;
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => { expect(composer(el).button.disabled).toBe(false); });
  await el.updateComplete;
}

describe('sem-chat', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('POSTs { model, messages } as JSON with Content-Type application/json', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ content: 'hello back' }));
    const el = await mount({ endpoint: '/api/chat', model: 'glm-5.3' });

    await send(el, 'hello world');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/chat');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      model: 'glm-5.3',
      messages: [{ role: 'user', content: 'hello world' }],
    });
  });

  it('passes an authored model through and omits the key when there is none', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ content: 'ok' }));
    const withModel = await mount({ endpoint: '/api/chat', model: 'glm-5.3' });
    await send(withModel, 'one');
    expect('model' in JSON.parse(fetchMock.mock.calls[0][1].body)).toBe(true);

    const withoutModel = await mount({ endpoint: '/api/chat' });
    await send(withoutModel, 'two');
    expect('model' in JSON.parse(fetchMock.mock.calls[1][1].body)).toBe(false);
  });

  it('sends the whole transcript as message context on later turns', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: 'first reply' }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: 'second reply' }));
    const el = await mount({ endpoint: '/api/chat' });

    await send(el, 'q1');
    await send(el, 'q2');

    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second.messages).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'first reply' },
      { role: 'user', content: 'q2' },
    ]);
  });

  it('dispatches sem-chat-message for each completed message, bubbles + composed', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ content: 'the reply' }));
    const el = await mount({ endpoint: '/api/chat' });
    const events: Array<{ role: string; content: string }> = [];
    el.addEventListener('sem-chat-message', (e) => {
      events.push((e as CustomEvent<{ role: string; content: string }>).detail);
    });

    await send(el, 'a question');

    expect(events).toEqual([
      { role: 'user', content: 'a question' },
      { role: 'assistant', content: 'the reply' },
    ]);
    // bubbled past the element and composed through any shadow boundary
    const fromOutside: Array<CustomEvent> = [];
    document.body.addEventListener('sem-chat-message', (e) => fromOutside.push(e as CustomEvent));
    await send(el, 'again');
    expect(fromOutside.length).toBe(2);
  });

  it('appends streamed chunks to the transcript as they arrive', async () => {
    fetchMock.mockResolvedValue(streamResponse(['Hel', 'lo', ' there']));
    const el = await mount({ endpoint: '/api/chat' });
    const events: Array<{ role: string; content: string }> = [];
    el.addEventListener('sem-chat-message', (e) =>
      events.push((e as CustomEvent<{ role: string; content: string }>).detail),
    );

    await send(el, 'stream me');

    const reply = el.querySelector('.sem-chat-msg[data-role="assistant"] .sem-chat-content')!;
    expect(reply.textContent).toBe('Hello there');
    expect(events).toEqual([
      { role: 'user', content: 'stream me' },
      { role: 'assistant', content: 'Hello there' },
    ]);
  });

  it('falls back to a plain JSON { content } reply when the body is not a stream', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ content: 'plain reply' }));
    const el = await mount({ endpoint: '/api/chat' });

    await send(el, 'json me');

    const reply = el.querySelector('.sem-chat-msg[data-role="assistant"] .sem-chat-content')!;
    expect(reply.textContent).toBe('plain reply');
  });

  it('shows a non-2xx reply inline as role="alert" and re-enables the input', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => '' },
      body: null,
      text: async () => 'boom',
    } as unknown as Response);
    const el = await mount({ endpoint: '/api/chat' });

    await send(el, 'will fail');

    const alert = el.querySelector('.sem-chat-error')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.hidden).toBe(false);
    expect(alert.textContent).toContain('500');
    const { textarea, button } = composer(el);
    expect(textarea.disabled).toBe(false);
    expect(button.disabled).toBe(false);
    // a failed reply is not a completed assistant message
    expect(el.querySelector('.sem-chat-msg[data-role="assistant"]')).toBeNull();
  });

  it('shows a network failure inline and re-enables the input', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'));
    const el = await mount({ endpoint: '/api/chat' });

    await send(el, 'offline');

    const alert = el.querySelector('.sem-chat-error')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('network down');
    expect(composer(el).textarea.disabled).toBe(false);
  });

  it('never fetches without an endpoint — the alert says so instead', async () => {
    const el = await mount({ model: 'glm-5.3' });

    await send(el, 'nowhere to go');

    expect(fetchMock).not.toHaveBeenCalled();
    const alert = el.querySelector('.sem-chat-error')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('endpoint');
    expect(composer(el).textarea.disabled).toBe(false);
  });

  it('bare Enter sends; Shift+Enter leaves the newline to the browser', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ content: 'ok' }));
    const el = await mount({ endpoint: '/api/chat' });
    const { textarea } = composer(el);

    textarea.value = 'press enter';
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    textarea.value = 'line one';
    const shifted = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(shifted);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no second send
    expect(shifted.defaultPrevented).toBe(false); // the newline goes through
  });

  it('renders a labelled live log and a labelled input', async () => {
    const el = await mount({ endpoint: '/api/chat', placeholder: 'Say something…' });
    const log = el.querySelector('.sem-chat-log')!;
    expect(log.getAttribute('role')).toBe('log');
    expect(log.getAttribute('aria-live')).toBe('polite');
    const { textarea } = composer(el);
    expect(textarea.getAttribute('aria-label')).toBeTruthy();
    expect(textarea.getAttribute('placeholder')).toBe('Say something…');
  });

  it('ignores an empty composer', async () => {
    const el = await mount({ endpoint: '/api/chat' });
    await send(el, '   ');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(el.querySelector('.sem-chat-msg')).toBeNull();
  });
});

describe('consumeReply', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('emits each decoded chunk as it arrives and returns the full text', async () => {
    const deltas: string[] = [];
    const full = await consumeReply(streamResponse(['Hel', 'lo']), (d) => deltas.push(d));
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(full).toBe('Hello');
  });

  it('reads a JSON body as { content } and never streams it', async () => {
    const deltas: string[] = [];
    const full = await consumeReply(
      {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        body: null,
        json: async () => ({ content: 'one shot' }),
      } as unknown as Response,
      (d) => deltas.push(d),
    );
    expect(deltas).toEqual(['one shot']);
    expect(full).toBe('one shot');
  });
});

// Feature: the agent-kit demo stub — rooms, threads, reactions and a fixtures
//          source, all local, zero network.
//   Scenario: a fixtures child supplies rooms + messages and no fetch is made
//   Scenario: a fixtures path is fetched once and never the endpoint
//   Scenario: the room list toggles which thread is shown
//   Scenario: clicking a reaction pill toggles the count locally
//   Scenario: replies nest under their parent up to thread-depth
//   Scenario: the shipped fixture parses and is shaped like the chat API
//   Scenario: authored markup is the zero-JS transcript (nodes survive upgrade)
describe('sem-chat fixtures', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  /** Mount sem-chat with an inline `application/json` fixtures child. */
  async function mountFixture(
    payload: unknown,
    attrs: Record<string, string> = {},
  ): Promise<SemChat> {
    const el = document.createElement('sem-chat');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    const script = document.createElement('script');
    script.type = 'application/json';
    script.textContent = JSON.stringify(payload);
    el.append(script);
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  /** Mount with an inline transcript (the zero-JS authoring). */
  async function mountAuthored(
    markup: string,
    attrs: Record<string, string> = {},
  ): Promise<SemChat> {
    const el = document.createElement('sem-chat');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.innerHTML = markup;
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  const PAYLOAD = {
    rooms: [
      { id: 'r1', name: 'General' },
      { id: 'r2', name: 'Ops' },
    ],
    messages: [
      { id: 'm1', room_id: 'r1', content: 'root one', sender: 'agent', parent_message_id: null, reactions: [{ emoji: '👍', count: 1, me: false }] },
      { id: 'm2', room_id: 'r1', content: 'reply one', sender: 'user', parent_message_id: 'm1', reactions: [] },
      { id: 'm3', room_id: 'r1', content: 'deep one', sender: 'agent', parent_message_id: 'm2', reactions: [] },
      { id: 'm4', room_id: 'r2', content: 'ops only', sender: 'agent', parent_message_id: null, reactions: [] },
    ],
  };

  function depth(el: SemChat, id: string): string | null {
    return el.querySelector(`.sem-chat-msg[data-id="${id}"]`)?.getAttribute('data-depth') ?? null;
  }

  it('reads rooms + messages from a fixtures child and never fetches', async () => {
    const el = await mountFixture(PAYLOAD);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(el.querySelectorAll('.sem-chat-room').length).toBe(2);
    expect(el.querySelector('.sem-chat-log')!.textContent).toContain('root one');
    expect(el.querySelector('.sem-chat-log')!.textContent).not.toContain('ops only');

    await send(el, 'a local message');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(el.querySelector('.sem-chat-msg[data-role="user"]')).toBeTruthy();
  });

  it('fetches a fixtures path exactly once and never the endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse(PAYLOAD));
    const el = document.createElement('sem-chat');
    el.setAttribute('fixtures', '/fixtures/agent-kit/chat.json');
    document.body.appendChild(el);

    await vi.waitFor(() => expect(el.querySelector('.sem-chat-msg')).toBeTruthy());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/fixtures/agent-kit/chat.json');
    await send(el, 'still local');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows one room list and swaps the thread when a room is clicked', async () => {
    const el = await mountFixture(PAYLOAD);
    const log = el.querySelector('.sem-chat-log')!;

    expect(log.textContent).toContain('root one');
    expect(log.textContent).not.toContain('ops only');
    expect(el.querySelector('.sem-chat-room[data-room-id="r1"]')!.getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('.sem-chat-room[data-room-id="r2"]')!.getAttribute('aria-selected')).toBe('false');

    (el.querySelector('.sem-chat-room[data-room-id="r2"]') as HTMLButtonElement).click();
    await el.updateComplete;

    expect(el.getAttribute('active-room')).toBe('r2');
    expect(log.textContent).toContain('ops only');
    expect(log.textContent).not.toContain('root one');
    expect(el.querySelector('.sem-chat-room[data-room-id="r2"]')!.getAttribute('aria-selected')).toBe('true');
  });

  it('toggles a reaction pill locally, moving count and aria-pressed', async () => {
    const el = await mountFixture(PAYLOAD);
    const pill = () => el.querySelector('.sem-chat-reaction[data-emoji="👍"]') as HTMLButtonElement;

    expect(pill().textContent).toBe('👍 1');
    expect(pill().getAttribute('aria-pressed')).toBe('false');

    pill().click();
    await el.updateComplete;
    expect(pill().textContent).toBe('👍 2');
    expect(pill().getAttribute('aria-pressed')).toBe('true');
    expect(JSON.parse(el.getAttribute('reactions')!)).toEqual({ m1: { '👍': 2 } });

    pill().click();
    await el.updateComplete;
    expect(pill().textContent).toBe('👍 1');
    expect(pill().getAttribute('aria-pressed')).toBe('false');
  });

  it('seeds reaction counts from the reactions attribute', async () => {
    const el = await mountFixture(PAYLOAD, { reactions: JSON.stringify({ m1: { '🔥': 5 } }) });
    const pill = el.querySelector('.sem-chat-reaction[data-emoji="🔥"]') as HTMLButtonElement;
    expect(pill.textContent).toBe('🔥 5');
    expect(pill.getAttribute('aria-pressed')).toBe('false');
  });

  it('nests replies under their parent, clamped to thread-depth', async () => {
    const deep = await mountFixture(PAYLOAD, { 'thread-depth': '3' });
    expect(depth(deep, 'm1')).toBe('0');
    expect(depth(deep, 'm2')).toBe('1');
    expect(depth(deep, 'm3')).toBe('2');
    const order = Array.from(deep.querySelectorAll('.sem-chat-log .sem-chat-msg[data-room="r1"]')).map(
      (n) => n.getAttribute('data-id'),
    );
    expect(order).toEqual(['m1', 'm2', 'm3']);

    const clamp = await mountFixture(PAYLOAD, { 'thread-depth': '1' });
    expect(depth(clamp, 'm1')).toBe('0');
    expect(depth(clamp, 'm2')).toBe('1');
    expect(depth(clamp, 'm3')).toBe('1'); // clamped, never dropped
    expect(clamp.querySelector('.sem-chat-msg[data-id="m3"]')).toBeTruthy();
  });

  it('keeps the authored transcript as the zero-JS markup and survives upgrade', async () => {
    const markup = [
      '<div class="sem-chat-msg" data-role="user" data-room="r1"><span class="sem-chat-content">hello no-js</span></div>',
      '<div class="sem-chat-msg" data-role="agent" data-room="r2"><span class="sem-chat-content">ops hidden</span></div>',
    ].join('');
    const el = document.createElement('sem-chat');
    el.setAttribute('rooms', JSON.stringify([{ id: 'r1', name: 'General' }, { id: 'r2', name: 'Ops' }]));
    el.setAttribute('active-room', 'r1');
    el.innerHTML = markup;
    // With JavaScript off, the transcript IS this markup — nothing renders it.
    expect(el.innerHTML).toContain('hello no-js');

    document.body.appendChild(el);
    await el.updateComplete;

    const active = el.querySelector('.sem-chat-msg[data-room="r1"]') as HTMLElement;
    expect(active).toBeTruthy();
    expect(active.hidden).toBe(false);
    expect(active.querySelector('.sem-chat-content')!.textContent).toBe('hello no-js');

    const other = el.querySelector('.sem-chat-msg[data-room="r2"]') as HTMLElement;
    expect(other.hidden).toBe(true);
    expect(other.textContent).toContain('ops hidden'); // preserved, not destroyed
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ships a fixture shaped like the chat API response', async () => {
    expect(FIXTURE.rooms.length).toBeGreaterThanOrEqual(2);
    for (const room of FIXTURE.rooms) {
      expect(typeof room.id).toBe('string');
      expect(typeof room.name).toBe('string');
    }
    expect(FIXTURE.messages.length).toBeGreaterThan(0);
    for (const message of FIXTURE.messages) {
      expect(typeof message.id).toBe('string');
      expect(typeof message.room_id).toBe('string');
      expect(typeof message.content).toBe('string');
      expect('parent_message_id' in message).toBe(true);
      expect(Array.isArray(message.reactions)).toBe(true);
    }

    const el = await mountFixture(FIXTURE);
    expect(fetchMock).not.toHaveBeenCalled();
    const general = FIXTURE.rooms[0];
    expect(el.querySelector(`.sem-chat-room[data-room-id="${general.id}"]`)).toBeTruthy();
    expect(el.querySelectorAll('.sem-chat-log .sem-chat-msg').length).toBeGreaterThan(0);
  });
});
