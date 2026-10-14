import { SemElement } from './base.js';

/**
 * sem-chat — endpoint-driven chat transcript + composer (Lit, light DOM).
 *
 * Two modes, one element:
 *
 *  - **Endpoint mode** (the original contract). The one element in the
 *    bundle that speaks to a server. It holds no API keys and sets no auth
 *    headers: the page author points `endpoint` at a proxy they control,
 *    and the browser's ambient credentials are all this element ever sends.
 *    Nothing it sends or receives is persisted anywhere.
 *
 *  - **Fixture mode** (the agent-kit demo stub). With a `fixtures` source
 *    set, the element renders rooms, messages, threads and reactions from
 *    JSON and makes **no network request** — sending a message is local
 *    only. Rooms, nesting and reaction pills are clickable end-to-end.
 *
 * Contract (attributes, all read live at send time):
 *   endpoint     no default — POST target; without it (and without a
 *                fixtures source) a send surfaces the inline role="alert"
 *                error instead of a fetch
 *   model        optional, no default — passed through in the request body
 *                only when authored (an absent model sends no `model` key,
 *                so the server's default routing applies)
 *   placeholder  composer hint, default "Type a message…"
 *   rooms        optional JSON array of rooms `[{id, name}]` — renders a
 *                room list beside the thread; clicking one selects it
 *   active-room  optional room id whose thread is shown; defaults to the
 *                first room. Switching rooms swaps the thread (reflects)
 *   thread-depth optional number, default 2 — replies nest under their
 *                parent up to this depth; deeper replies render clamped
 *   reactions    optional JSON map `{ "<message-id>": { "<emoji>": count } }`
 *                seeding the reaction pills; clicking a pill toggles it
 *                locally (count moves and `aria-pressed` flips)
 *   fixtures     optional fixture source: a same-origin path to fetch, an
 *                inline JSON string, or an inline `<script type="application/
 *                json">` child. Supplies `{ rooms, messages }` shaped like
 *                the real chat API (`GET /chat/rooms`, `GET /chat/rooms/:id/
 *                messages`). While set, the element never fetches `endpoint`.
 *
 * Zero-JS: the transcript is authored markup — `<div class="sem-chat-msg"
 * data-role data-room data-parent>` children with a `.sem-chat-content`
 * span. Without JavaScript the active room's messages render as plain
 * prose; the enhancer keeps those nodes (it never fabricates the fallback
 * from JSON), annotating depth and hiding non-active rooms.
 *
 * Wire contract (endpoint mode): POST { model?, messages: [{role, content}, …] }
 * as JSON. The reply streams when the response body is a stream and is not
 * `application/json` (each chunk is decoded text appended as it arrives);
 * a JSON body is read as a plain `{ content }` object. Either way the
 * finished assistant text lands in the transcript.
 *
 * Errors — network failures and non-2xx replies — render inline as a
 * role="alert" message and the composer is re-enabled; nothing is thrown
 * at the console beyond the shared author-warning channel.
 *
 * A `sem-chat-message` CustomEvent (bubbles, composed, detail
 * `{role, content}`) fires for each completed message: the user's on send,
 * the assistant's once the reply has fully arrived. A `sem-chat-reaction`
 * event fires on each reaction toggle.
 *
 * Accessibility: the transcript is a role="log" with aria-live="polite";
 * the textarea is labelled; the room list is a labelled tablist; Enter
 * sends, Shift+Enter inserts a newline (left to the browser — the handler
 * only intercepts bare Enter).
 */
export interface ChatRoom {
  id: string;
  name: string;
}

export interface ChatReactionSummary {
  emoji: string;
  count: number;
  me?: boolean;
}

export interface ChatMessage {
  id: string;
  room_id: string;
  content: string;
  sender: string;
  parent_message_id: string | null;
  reactions: ChatReactionSummary[];
  /** The authored/DOM node for this message (zero-JS transcript nodes are reused). */
  el?: HTMLDivElement | null;
}

interface ReactionState {
  count: number;
  me: boolean;
}

export class SemChat extends SemElement {
  static properties = {
    endpoint: { type: String },
    model: { type: String },
    placeholder: { type: String },
    rooms: { type: String },
    activeRoom: { type: String, attribute: 'active-room', reflect: true },
    threadDepth: { type: Number, attribute: 'thread-depth' },
    reactions: { type: String, reflect: true },
    fixtures: { type: String },
  };

  declare endpoint: string;
  declare model: string;
  declare placeholder: string;
  declare rooms: string;
  declare activeRoom: string;
  declare threadDepth: number;
  declare reactions: string;
  declare fixtures: string;

  #wired = false;
  #busy = false;
  #sourceLoaded = false;
  #mode: 'none' | 'authored' | 'fixtures' = 'none';
  #log: HTMLDivElement | null = null;
  #error: HTMLDivElement | null = null;
  #input: HTMLTextAreaElement | null = null;
  #roomsRail: HTMLDivElement | null = null;
  #roomsList: ChatRoom[] = [];
  #messages: ChatMessage[] = [];
  #reactionState = new Map<string, Map<string, ReactionState>>();

  constructor() {
    super();
    // `endpoint` is required and deliberately has no default: an unset
    // attribute is an authoring mistake surfaced at send time, not a URL
    // invented here.
    this.endpoint = '';
    this.model = '';
    this.placeholder = 'Type a message…';
    this.rooms = '';
    this.activeRoom = '';
    this.threadDepth = 2;
    this.reactions = '';
    this.fixtures = '';
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'group');
  }

  updated(changed: Map<string, unknown>): void {
    if (!this.#wired) this.#wire();
    this.#syncPlaceholder();
    if (!this.#sourceLoaded) {
      this.#sourceLoaded = true;
      this.#loadSource();
    }
    if (changed.has('activeRoom') || changed.has('threadDepth') || changed.has('rooms')) {
      this.#render();
    }
  }

  #wire(): void {
    this.#wired = true;

    const log = document.createElement('div');
    log.className = 'sem-chat-log';
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');
    log.setAttribute('aria-label', 'Conversation');
    this.#log = log;

    const error = document.createElement('div');
    error.className = 'sem-chat-error';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    this.#error = error;

    const composer = document.createElement('form');
    composer.className = 'sem-chat-composer';

    const input = document.createElement('textarea');
    input.className = 'sem-chat-input';
    input.setAttribute('rows', '1');
    input.setAttribute('aria-label', 'Message');
    input.addEventListener('keydown', this.#onKeydown);
    this.#input = input;

    const send = document.createElement('button');
    send.type = 'submit';
    send.className = 'sem-chat-send';
    send.textContent = 'Send';

    composer.append(input, send);
    composer.addEventListener('submit', this.#onSubmit);
    this.append(log, error, composer);
    // One delegated listener for every reaction pill, however many render.
    this.addEventListener('click', this.#onClick);
  }

  #syncPlaceholder(): void {
    this.#input?.setAttribute('placeholder', this.placeholder ?? '');
  }

  // ── Sources ────────────────────────────────────────────────────

  /**
   * Resolve the first fixture source, in priority order: an inline
   * `<script type="application/json">` child, an inline JSON `fixtures`
   * value, or a same-origin path in `fixtures` (fetched once). With no
   * fixture source the authored transcript markup is the source.
   */
  #loadSource(): void {
    const child = this.#childFixtures();
    if (child) {
      this.#applyFixtures(child);
      return;
    }

    const value = (this.fixtures ?? '').trim();
    if (value.startsWith('{')) {
      const parsed = parseJson(value);
      if (parsed) {
        this.#applyFixtures(parsed);
        return;
      }
    }
    if (value) {
      void this.#fetchFixtures(value);
      return;
    }

    this.#collectAuthored();
  }

  async #fetchFixtures(path: string): Promise<void> {
    try {
      const res = await fetch(path, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`Fixture request failed (${res.status})`);
      this.#applyFixtures(await res.json());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.#setError(`sem-chat: ${message}`);
      this.warn(`sem-chat could not load fixtures from ${path}: ${message}`);
    }
  }

  /** The inline JSON child, if any (a `<script type="application/json">`). */
  #childFixtures(): unknown | null {
    for (const script of Array.from(this.querySelectorAll('script[type="application/json"]'))) {
      const parsed = parseJson(script.textContent);
      if (parsed) return parsed;
    }
    return null;
  }

  /** Build rooms + messages from a fixture payload shaped like the chat API. */
  #applyFixtures(data: unknown): void {
    const record = asRecord(data) ?? {};
    this.#roomsList = asArray(record.rooms)
      .map(asRecord)
      .filter((r): r is Record<string, unknown> => r !== null)
      .map((r) => ({ id: str(r.id ?? r.slug), name: str(r.name ?? r.id ?? r.slug) }))
      .filter((r) => r.id !== '');

    this.#messages = asArray(record.messages)
      .map(asRecord)
      .filter((m): m is Record<string, unknown> => m !== null)
      .map((m) => ({
        id: str(m.id),
        room_id: str(m.room_id ?? m.roomId),
        content: str(m.content),
        sender: str(m.sender ?? m.role, 'assistant'),
        parent_message_id: m.parent_message_id ? str(m.parent_message_id) : null,
        reactions: asArray(m.reactions)
          .map(asRecord)
          .filter((x): x is Record<string, unknown> => x !== null)
          .map((x) => ({ emoji: str(x.emoji), count: Number(x.count) || 0, me: !!x.me })),
        el: null,
      }))
      .filter((m) => m.id !== '');

    this.#mode = 'fixtures';
    this.#seedReactions();
    this.#render();
  }

  /**
   * Authored transcript markup is the source (the zero-JS path). Its
   * `.sem-chat-msg` children are adopted verbatim into the transcript
   * container — never destroyed — so the fallback prose survives.
   */
  #collectAuthored(): void {
    const parsed = parseJson(this.rooms);
    this.#roomsList = asArray(parsed)
      .map(asRecord)
      .filter((r): r is Record<string, unknown> => r !== null)
      .map((r) => ({ id: str(r.id), name: str(r.name ?? r.id) }))
      .filter((r) => r.id !== '');

    const nodes = Array.from(this.querySelectorAll('.sem-chat-msg')) as HTMLDivElement[];
    this.#messages = nodes.map((node, index) => ({
      id: node.getAttribute('data-id') ?? `msg-${index}`,
      room_id: node.getAttribute('data-room') ?? '',
      content: contentText(node),
      sender: node.getAttribute('data-role') ?? 'user',
      parent_message_id: node.getAttribute('data-parent'),
      reactions: [],
      el: node,
    }));
    this.#mode = nodes.length > 0 ? 'authored' : 'none';

    for (const message of this.#messages) {
      if (message.el && this.#log) this.#log.append(message.el);
      const seeded = parseJson(message.el?.getAttribute('data-reactions') ?? '');
      const map = asRecord(seeded);
      if (!map) continue;
      for (const [emoji, count] of Object.entries(map)) {
        this.#setReaction(message.id, emoji, Number(count) || 0, false);
      }
    }

    this.#seedReactions();
    this.#render();
  }

  // ── Reactions ──────────────────────────────────────────────────

  /** Seed reaction state from each message's embedded summaries. */
  #seedReactions(): void {
    for (const message of this.#messages) {
      for (const r of message.reactions) {
        this.#setReaction(message.id, r.emoji, r.count, !!r.me);
      }
    }
    // The `reactions` attribute overrides/extends the embedded counts.
    const attr = asRecord(parseJson(this.reactions));
    if (!attr) return;
    for (const [messageId, emojis] of Object.entries(attr)) {
      const map = asRecord(emojis);
      if (!map) continue;
      for (const [emoji, count] of Object.entries(map)) {
        this.#setReaction(messageId, emoji, Number(count) || 0, false);
      }
    }
  }

  #setReaction(messageId: string, emoji: string, count: number, me: boolean): void {
    if (!messageId || !emoji) return;
    let map = this.#reactionState.get(messageId);
    if (!map) {
      map = new Map();
      this.#reactionState.set(messageId, map);
    }
    map.set(emoji, { count, me });
  }

  #toggleReaction(messageId: string, emoji: string): void {
    let map = this.#reactionState.get(messageId);
    if (!map) {
      map = new Map();
      this.#reactionState.set(messageId, map);
    }
    const current = map.get(emoji) ?? { count: 0, me: false };
    if (current.me) {
      current.me = false;
      current.count -= 1;
      if (current.count <= 0) map.delete(emoji);
      else map.set(emoji, current);
    } else {
      map.set(emoji, { count: current.count + 1, me: true });
    }
    if (map.size === 0) this.#reactionState.delete(messageId);
    this.#syncReactionsAttr();
    this.emit<{ messageId: string; emoji: string }>('sem-chat-reaction', { messageId, emoji });
  }

  /** Reflect the local reaction state back to the `reactions` attribute. */
  #syncReactionsAttr(): void {
    const out: Record<string, Record<string, number>> = {};
    for (const [id, map] of this.#reactionState) {
      if (map.size === 0) continue;
      const counts: Record<string, number> = {};
      for (const [emoji, state] of map) counts[emoji] = state.count;
      out[id] = counts;
    }
    this.reactions = JSON.stringify(out);
  }

  #renderReactions(msgEl: Element, messageId: string): void {
    let row = msgEl.querySelector('.sem-chat-reactions');
    const state = this.#reactionState.get(messageId);
    if (!state || state.size === 0) {
      row?.remove();
      return;
    }
    if (!(row instanceof HTMLElement)) {
      row = document.createElement('div');
      row.className = 'sem-chat-reactions';
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', 'Reactions');
      msgEl.append(row);
    }
    row.replaceChildren(
      ...Array.from(state.entries()).map(([emoji, s]) => {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'sem-chat-reaction';
        pill.setAttribute('data-emoji', emoji);
        pill.setAttribute('aria-pressed', String(s.me));
        pill.setAttribute('aria-label', `${emoji}, ${s.count} reaction${s.count === 1 ? '' : 's'}`);
        pill.textContent = `${emoji} ${s.count}`;
        return pill;
      }),
    );
  }

  // ── Rendering ──────────────────────────────────────────────────

  #render(): void {
    this.#renderRooms();
    this.#renderThread();
  }

  #effectiveRoom(): string {
    return this.activeRoom || this.#roomsList[0]?.id || '';
  }

  #renderRooms(): void {
    if (this.#roomsList.length === 0) {
      this.#roomsRail?.remove();
      this.#roomsRail = null;
      return;
    }
    if (!this.#roomsRail) {
      const rail = document.createElement('div');
      rail.className = 'sem-chat-rooms';
      rail.setAttribute('role', 'tablist');
      rail.setAttribute('aria-label', 'Rooms');
      this.#roomsRail = rail;
      this.prepend(rail);
    }
    const active = this.#effectiveRoom();
    this.#roomsRail.replaceChildren(
      ...this.#roomsList.map((room) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sem-chat-room';
        button.setAttribute('role', 'tab');
        button.setAttribute('data-room-id', room.id);
        button.setAttribute('aria-selected', String(room.id === active));
        button.textContent = room.name;
        button.addEventListener('click', () => {
          this.activeRoom = room.id;
        });
        return button;
      }),
    );
  }

  #renderThread(): void {
    const log = this.#log;
    if (!log) return;
    const room = this.#effectiveRoom();
    const visible = this.#messages.filter((m) => !room || m.room_id === room);
    const ordered = this.#order(visible);

    if (this.#mode === 'fixtures') {
      for (const m of this.#messages) m.el = null;
      log.replaceChildren();
    }

    const shown = new Set(ordered.map((entry) => entry.msg));
    for (const m of this.#messages) {
      if (m.el && !shown.has(m)) m.el.hidden = true;
    }

    for (const { msg, depth } of ordered) {
      const el = this.#messageNode(msg);
      el.setAttribute('data-depth', String(depth));
      el.hidden = false;
      log.append(el);
      this.#renderReactions(el, msg.id);
    }
  }

  /**
   * Thread order: each root followed by its replies, pre-order, depth
   * clamped to `thread-depth` (deeper replies render at the clamp, never
   * dropped). A reply whose parent is not visible is treated as a root.
   */
  #order(visible: ChatMessage[]): Array<{ msg: ChatMessage; depth: number }> {
    const ids = new Set(visible.map((m) => m.id));
    const children = new Map<string, ChatMessage[]>();
    const roots: ChatMessage[] = [];
    for (const m of visible) {
      const parent = m.parent_message_id;
      if (parent && ids.has(parent)) {
        const list = children.get(parent) ?? [];
        list.push(m);
        children.set(parent, list);
      } else {
        roots.push(m);
      }
    }

    const out: Array<{ msg: ChatMessage; depth: number }> = [];
    const seen = new Set<string>();
    const maxDepth = Math.max(0, this.threadDepth ?? 0);
    const walk = (list: ChatMessage[], depth: number): void => {
      for (const m of list) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        out.push({ msg: m, depth });
        const kids = children.get(m.id);
        if (kids) walk(kids, Math.min(depth + 1, maxDepth));
      }
    };
    walk(roots, 0);
    for (const m of visible) if (!seen.has(m.id)) out.push({ msg: m, depth: 0 });
    return out;
  }

  #messageNode(msg: ChatMessage): HTMLDivElement {
    if (msg.el?.isConnected) return msg.el;
    const el = document.createElement('div');
    el.className = `sem-chat-msg sem-chat-${msg.sender}`;
    el.setAttribute('data-role', msg.sender);
    el.setAttribute('data-id', msg.id);
    if (msg.room_id) el.setAttribute('data-room', msg.room_id);

    const label = document.createElement('span');
    label.className = 'sem-chat-role';
    label.textContent = msg.sender;

    const text = document.createElement('span');
    text.className = 'sem-chat-content';
    text.textContent = msg.content;

    el.append(label, text);
    msg.el = el;
    return el;
  }

  // ── Interaction ────────────────────────────────────────────────

  #onClick = (e: MouseEvent): void => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const pill = target.closest('.sem-chat-reaction');
    if (!pill) return;
    const msgEl = pill.closest('.sem-chat-msg');
    const messageId = msgEl?.getAttribute('data-id');
    const emoji = pill.getAttribute('data-emoji');
    if (!messageId || !emoji) return;
    this.#toggleReaction(messageId, emoji);
    if (msgEl) this.#renderReactions(msgEl, messageId);
  };

  #onKeydown = (e: KeyboardEvent): void => {
    // Bare Enter sends; Shift+Enter falls through so the browser inserts
    // the newline (never preventDefault for it).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void this.#send();
    }
  };

  #onSubmit = (e: Event): void => {
    e.preventDefault();
    void this.#send();
  };

  /** True while a fixtures source drives the element: sends stay local. */
  #localMode(): boolean {
    return this.#mode === 'fixtures' || (this.fixtures ?? '').trim() !== '';
  }

  async #send(): Promise<void> {
    if (this.#busy) return;
    const input = this.#input;
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    if (this.#localMode()) {
      input.value = '';
      this.#appendMessage('user', text);
      this.emit<{ role: string; content: string }>('sem-chat-message', { role: 'user', content: text });
      const reply = 'Local demo — no network request was made.';
      this.#appendMessage('assistant', reply);
      this.emit<{ role: string; content: string }>('sem-chat-message', {
        role: 'assistant',
        content: reply,
      });
      return;
    }

    if (!this.endpoint) {
      this.#setError('sem-chat: no endpoint attribute set — the message was not sent.');
      this.warn('sem-chat requires an `endpoint` attribute (a POST URL you control).');
      return;
    }

    this.#busy = true;
    this.#setError(null);
    input.value = '';
    this.#setDisabled(true);

    this.#appendMessage('user', text);
    this.emit<{ role: string; content: string }>('sem-chat-message', { role: 'user', content: text });

    const body: { model?: string; messages: Array<{ role: string; content: string }> } = {
      messages: this.#history(),
    };
    if (this.model) body.model = this.model;

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const assistant = this.#appendMessage('assistant', '');
      const contentSpan = assistant.querySelector('.sem-chat-content')!;
      let streamed = '';
      const content = await consumeReply(res, (delta) => {
        streamed += delta;
        contentSpan.textContent = streamed;
      });
      contentSpan.textContent = content;
      this.emit<{ role: string; content: string }>('sem-chat-message', {
        role: 'assistant',
        content,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.#setError(`sem-chat: ${message}`);
    } finally {
      this.#busy = false;
      this.#setDisabled(false);
      this.#input?.focus();
    }
  }

  /** Full transcript as the wire-format message list (context for the next turn). */
  #history(): Array<{ role: string; content: string }> {
    return Array.from(this.querySelectorAll('.sem-chat-msg')).map((msg) => ({
      role: msg.getAttribute('data-role') ?? 'user',
      content: contentText(msg),
    }));
  }

  #appendMessage(role: string, content: string): HTMLDivElement {
    const msg = document.createElement('div');
    msg.className = `sem-chat-msg sem-chat-${role}`;
    msg.setAttribute('data-role', role);

    const label = document.createElement('span');
    label.className = 'sem-chat-role';
    label.textContent = role;

    const text = document.createElement('span');
    text.className = 'sem-chat-content';
    text.textContent = content;

    msg.append(label, text);
    this.#log?.appendChild(msg);
    return msg;
  }

  #setError(message: string | null): void {
    if (!this.#error) return;
    this.#error.textContent = message ?? '';
    this.#error.hidden = message === null;
  }

  #setDisabled(disabled: boolean): void {
    if (this.#input) this.#input.disabled = disabled;
    const send = this.querySelector('.sem-chat-send');
    if (send instanceof HTMLButtonElement) send.disabled = disabled;
  }
}

function contentText(msg: Element): string {
  return (msg.querySelector('.sem-chat-content')?.textContent ?? msg.textContent ?? '').trim();
}

function parseJson(text: string | null | undefined): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}

/**
 * Read the assistant reply off a fetch Response, streaming when the body is
 * a stream and not JSON. `onDelta` receives each piece as it arrives; the
 * return value is the full text. A JSON body resolves as plain
 * `{ content }`; anything else with a body is consumed chunk by chunk as
 * decoded UTF-8 text. Exported for the unit tier — the DOM half of the
 * element is otherwise untestable without a network.
 */
export async function consumeReply(
  res: Pick<Response, 'ok' | 'status' | 'headers' | 'body' | 'json' | 'text'>,
  onDelta: (delta: string) => void,
): Promise<string> {
  const type = res.headers?.get?.('content-type') ?? '';

  if (type.includes('application/json')) {
    const data = (await res.json()) as { content?: unknown };
    const content = typeof data?.content === 'string' ? data.content : '';
    if (content) onDelta(content);
    return content;
  }

  if (res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const delta = decoder.decode(value, { stream: true });
      if (delta) {
        full += delta;
        onDelta(delta);
      }
    }
    const tail = decoder.decode();
    if (tail) {
      full += tail;
      onDelta(tail);
    }
    return full;
  }

  const text = await res.text();
  if (text) onDelta(text);
  return text;
}

SemElement.register('sem-chat', SemChat);