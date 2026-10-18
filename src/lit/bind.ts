import type { PropertyValues } from 'lit';
import { SemElement } from './base.js';

/**
 * sem-bind — the live-data runtime for sem-* elements.
 *
 * One pipeline for every source: `sem-bind` attribute (or a direct
 * `payload` property) → JSON → element hydration. Two bind forms:
 *
 *   sem-bind="https://example.com/status.json"            plain fetch (no auth unless 401)
 *   sem-bind="./data/x.json"                              same-origin relative path (against document.baseURI)
 *   sem-bind="agent-kit/{org}/proj/{project}/{kind}/{id}" → https://agentonomi.com/status/{org}/proj/{project}/{kind}/{id}
 *
 * Auth (agentonomi embed contract): the Guardian access token is stored
 * per-origin in `localStorage["semtext.bind.token"]` and sent as
 * `Authorization: Bearer` — never cookies. On 401 the login flow opens
 * `https://agentonomi.com/embed/authorize?redirect_uri=…&state=…` in a
 * popup and completes via postMessage (`semtext-bind-token`); if the
 * popup is blocked (or closed without a token) the same authorize URL is
 * navigated to full-page and the token returns in the
 * `#access_token=…&state=…` fragment on the next load, where
 * `consumeBindHash` verifies the state nonce, stores the token and strips
 * the hash silently.
 *
 * Polling: `progress`-kind agent-kit binds refetch every 30s
 * (`sem-refresh="<seconds>"` overrides); every other kind fetches once on
 * connect. Error / empty / auth-pending states render into the host —
 * a bound element never sits blank and silent.
 *
 * Hydration is tag-dispatched (`hydrateFor`): sem-progress takes the
 * progress payload forms; sem-plan / sem-procedure / sem-runbook /
 * sem-workflow take the plan + status-dictionary form; any other element
 * gets the payload as `data-sem-bind-payload` plus a `sem-bind-payload`
 * event — pass-through, nothing dropped. Unknown payload keys are
 * preserved and simply not rendered.
 */

/* ── bind reference ── */

export const AGENTONOMI_ORIGIN = 'https://agentonomi.com';
export const TOKEN_KEY = 'semtext.bind.token';
const EXPIRES_KEY = 'semtext.bind.expires';
const STATE_KEY = 'semtext.bind.state';
export const DEFAULT_REFRESH_MS = 30_000;

export type BindRef =
  | { kind: 'url'; url: string }
  | {
      kind: 'agent-kit';
      org: string;
      project: string;
      /** The status resource: progress | plan | run-book | workflow. */
      resource: string;
      id: string;
      url: string;
    };

/** Minimal Storage shape — the real Storage or a test double. */
export interface KVStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const AGENT_KIT_RE = /^agent-kit\/([^/\s]+)\/proj\/([^/\s]+)\/([^/\s]+)\/([^/\s]+)$/;

/**
 * Parse a `sem-bind` attribute value. Full https? URL → direct fetch;
 * `agent-kit/{org}/proj/{project}/{kind}/{id}` → the agentonomi status
 * route; anything else resolves against the document base (`base`
 * overrides, for tests and non-browser callers) so a same-origin
 * relative path — `./data/x.json`, `/api/plan.json` — is a legitimate
 * direct-fetch bind when it resolves to http(s). Values that resolve
 * elsewhere (other scheme, garbage) → null (the host renders a bind
 * error). A botched `agent-kit/…` path stays null too: it should never
 * silently become a bogus relative fetch of `page/agent-kit/…`.
 */
export function parseBind(raw: string | null | undefined, base?: string): BindRef | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return { kind: 'url', url: value };
  if (value.startsWith('agent-kit/')) {
    const m = AGENT_KIT_RE.exec(value);
    if (!m) return null;
    const [, org, project, resource, id] = m;
    return {
      kind: 'agent-kit',
      org,
      project,
      resource,
      id,
      url: `${AGENTONOMI_ORIGIN}/status/${encodeURIComponent(org)}/proj/${encodeURIComponent(project)}/${encodeURIComponent(resource)}/${encodeURIComponent(id)}`,
    };
  }
  const baseUrl = base ?? (typeof document !== 'undefined' && document.baseURI ? document.baseURI : undefined);
  if (!baseUrl) return null;
  try {
    const resolved = new URL(value, baseUrl);
    if (resolved.protocol === 'https:' || resolved.protocol === 'http:') {
      return { kind: 'url', url: resolved.href };
    }
  } catch {
    /* not a URL against any base — fall through to null */
  }
  return null;
}

export function isAgentonomi(url: string): boolean {
  try {
    return new URL(url).origin === AGENTONOMI_ORIGIN;
  } catch {
    return false;
  }
}

/** `progress` binds poll; every other kind fetches once. */
export function isPollKind(ref: BindRef): boolean {
  return ref.kind === 'agent-kit' && ref.resource === 'progress';
}

/* ── token storage ── */

/** The stored access token, or null when absent or past its expiry. */
export function loadToken(store: KVStore, now: () => number = Date.now): string | null {
  const token = store.getItem(TOKEN_KEY);
  if (!token) return null;
  const expires = store.getItem(EXPIRES_KEY);
  if (expires) {
    const at = Number(expires);
    if (Number.isFinite(at) && at <= now()) {
      clearToken(store);
      return null;
    }
  }
  return token;
}

export function storeToken(
  token: string,
  expiresInSec: number | null,
  store: KVStore,
  now: () => number = Date.now,
): void {
  store.setItem(TOKEN_KEY, token);
  if (expiresInSec != null && Number.isFinite(expiresInSec)) {
    store.setItem(EXPIRES_KEY, String(now() + expiresInSec * 1000));
  } else {
    store.removeItem(EXPIRES_KEY);
  }
}

export function clearToken(store: KVStore): void {
  store.removeItem(TOKEN_KEY);
  store.removeItem(EXPIRES_KEY);
}

const nonce = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'st-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

/* ── login (embed authorize) ── */

export function buildAuthorizeUrl(redirectUri: string, state: string): string {
  return (
    `${AGENTONOMI_ORIGIN}/embed/authorize?redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`
  );
}

/** Page URL (sans hash) the authorize route should return to. */
export function currentRedirectUri(loc: { origin: string; pathname: string; search: string }): string {
  return loc.origin + loc.pathname + loc.search;
}

/**
 * Redirect-mode return: read `#access_token=…&expires_in=…&state=…` off
 * the hash, verify the state against the sessionStorage nonce, store the
 * token and strip the hash silently. A missing/mismatched state leaves
 * everything untouched (returns false) — a token we cannot attribute is
 * a token we do not keep.
 */
export function consumeBindHash(
  loc: { hash: string },
  historyLike: { replaceState(data: unknown, unused: string, url: string): void },
  sess: KVStore,
  store: KVStore,
  now: () => number = Date.now,
): boolean {
  if (!loc.hash || loc.hash.length < 2) return false;
  const params = new URLSearchParams(loc.hash.slice(1));
  const token = params.get('access_token');
  if (!token) return false;
  const state = params.get('state');
  const expected = sess.getItem(STATE_KEY);
  sess.removeItem(STATE_KEY);
  if (!state || !expected || state !== expected) return false;
  const expiresIn = params.get('expires_in');
  storeToken(token, expiresIn == null ? null : Number(expiresIn), store, now);
  historyLike.replaceState(null, '', locHashless(loc as unknown as Location));
  return true;
}

function locHashless(loc: { pathname: string; search: string }): string {
  return loc.pathname + loc.search;
}

export interface TokenRequestDeps {
  /** Default: the current page URL minus its hash. */
  redirectUri?: string;
  win?: Window;
  sess?: KVStore;
  store?: KVStore;
  /** Test hook — resolves instead of opening any popup. */
  requestToken?: () => Promise<{ access_token: string; expires_in: number | null }>;
}

/**
 * Run the popup login flow and resolve the fresh token, or null when the
 * flow had to fall back to a full-page redirect (the page is leaving;
 * the token arrives via `consumeBindHash` on the next load).
 *
 * Popup path: `window.open(authorizeUrl)` + a message listener that
 * accepts only `{type:"semtext-bind-token", access_token, expires_in,
 * state}` from the agentonomi origin with our state echoed back. If the
 * popup never opens, or closes without delivering a token, the flow
 * navigates this page to the same authorize URL (redirect mode).
 */
export async function requestBindToken(deps: TokenRequestDeps = {}): Promise<string | null> {
  const sess = deps.sess ?? (globalThis as { sessionStorage?: KVStore }).sessionStorage;
  const store = deps.store ?? (globalThis as { localStorage?: KVStore }).localStorage;
  if (deps.requestToken) {
    // Test-hook path — same contract as the popup flow: the fresh token
    // lands in storage before the caller retries the fetch.
    const got = await deps.requestToken();
    if (store) storeToken(got.access_token, got.expires_in, store);
    if (sess) sess.removeItem(STATE_KEY);
    return got.access_token;
  }
  const win = deps.win ?? (globalThis as unknown as Window);
  if (!win || !sess || !store) return null;

  const state = nonce();
  sess.setItem(STATE_KEY, state);
  const url = buildAuthorizeUrl(deps.redirectUri ?? currentRedirectUri(win.location), state);

  const popup = typeof win.open === 'function' ? win.open(url, 'semtext-bind', 'width=520,height=680') : null;
  if (!popup) {
    win.location.assign(url);
    return null;
  }

  return await new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (token: string | null): void => {
      if (settled) return;
      settled = true;
      clearInterval(watch);
      win.removeEventListener('message', onMessage);
      try {
        popup.close();
      } catch {
        /* popup already gone */
      }
      resolve(token);
    };
    const onMessage = (ev: MessageEvent): void => {
      if (ev.origin !== AGENTONOMI_ORIGIN) return;
      const data = ev.data as { type?: string; access_token?: string; expires_in?: number; state?: string };
      if (!data || data.type !== 'semtext-bind-token' || data.state !== state) return;
      if (typeof data.access_token !== 'string' || !data.access_token) return;
      storeToken(data.access_token, data.expires_in == null ? null : Number(data.expires_in), store!);
      sess.removeItem(STATE_KEY);
      finish(data.access_token);
    };
    win.addEventListener('message', onMessage);
    // Popup closed by the user without completing: fall back to the
    // full-page redirect — same authorize URL, token comes back in the
    // fragment on the next load.
    const watch = setInterval(() => {
      if (popup.closed) {
        win.location.assign(url);
        finish(null);
      }
    }, 500);
  });
}

/* ── fetch ── */

export interface FetchBindDeps {
  store?: KVStore;
  /** Test hook — the token request step (defaults to `requestBindToken`). */
  requestToken?: TokenRequestDeps['requestToken'];
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface FetchBindResult {
  status: number;
  payload: unknown;
  /** True when a 401 triggered the login flow and the retry still 401'd. */
  authFailed?: boolean;
}

/**
 * Fetch a bind URL and return `{status, payload}`. agentonomi URLs carry
 * the stored bearer token and never credentials; other hosts are fetched
 * plain. A 401 from ANY host (the static file may be behind auth too)
 * triggers the login flow and retries the fetch exactly once.
 */
export async function fetchBindJson(url: string, deps: FetchBindDeps = {}): Promise<FetchBindResult> {
  const doFetch = deps.fetchImpl ?? fetch.bind(globalThis);
  const attempt = async (): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (isAgentonomi(url)) {
      const store = deps.store ?? (globalThis as { localStorage?: KVStore }).localStorage;
      const token = store ? loadToken(store, deps.now) : null;
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
    return await doFetch(url, { headers, credentials: 'omit' });
  };

  let res = await attempt();
  if (res.status === 401) {
    const store = deps.store ?? (globalThis as { localStorage?: KVStore }).localStorage;
    const token = await requestBindToken({ store: store ?? undefined, requestToken: deps.requestToken });
    if (token) {
      res = await attempt();
      if (res.status === 401) return { status: 401, payload: null, authFailed: true };
    } else {
      return { status: 401, payload: null, authFailed: true };
    }
  }
  if (!res.ok) return { status: res.status, payload: null };
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    return { status: res.status, payload: null };
  }
  return { status: res.status, payload };
}

/* ── hydration ── */

const PLAN_TAGS = new Set(['sem-plan', 'sem-procedure', 'sem-runbook', 'sem-workflow']);

/**
 * Tag-dispatched payload intake — the same render pipe regardless of
 * source. Unknown keys inside every payload shape are preserved and left
 * unrendered (pass-through), so future producers never break the reader.
 */
export function hydrateFor(el: HTMLElement, payload: unknown): void {
  if (payload == null || typeof payload !== 'object') {
    renderBindState(el, 'empty', 'no payload');
    return;
  }
  const data = payload as Record<string, unknown>;
  if (el.localName === 'sem-progress') {
    hydrateProgress(el, data);
  } else if (PLAN_TAGS.has(el.localName)) {
    hydratePlan(el, data);
  } else {
    el.setAttribute('data-sem-bind-payload', JSON.stringify(data));
    el.dispatchEvent(new CustomEvent('sem-bind-payload', { bubbles: true, composed: true, detail: data }));
  }
}

const BIND_RENDER = 'data-sem-bind-render';

function clearBindRender(el: HTMLElement): void {
  el.querySelectorAll(`[${BIND_RENDER}]`).forEach((n) => n.remove());
}

const marked = (node: HTMLElement): HTMLElement => {
  node.setAttribute(BIND_RENDER, '');
  return node;
};

/** The shared non-blank state line: error | empty | pending. */
export function renderBindState(
  el: HTMLElement,
  kind: 'error' | 'empty' | 'pending',
  detail?: string,
): HTMLElement {
  let node = el.querySelector('.sem-bind-state') as HTMLElement | null;
  if (!node) {
    node = document.createElement('div');
    node.className = 'sem-bind-state';
    node.setAttribute('role', 'status');
    el.appendChild(node);
  }
  node.className = `sem-bind-state sem-bind-${kind}`;
  node.textContent =
    kind === 'error'
      ? `sem-bind failed${detail ? ` (${detail})` : ''}`
      : kind === 'pending'
        ? `sem-bind: loading…${detail ? ` — ${detail}` : ''}`
        : `sem-bind: ${detail ?? 'empty payload'}`;
  return node;
}

function clearBindState(el: HTMLElement): void {
  el.querySelector('.sem-bind-state')?.remove();
}

/**
 * sem-progress payload intake. Two forms:
 *
 *   {percent: 42, comment}          → bar + `label :: NN%`
 *   {step: 3, steps: 7, comment}    → bar at step/steps + `step 3 / 7`
 *
 * Both render the comment when present; unknown keys pass through. The
 * rendered DOM mirrors the vanilla meter (`.sem-progress-track` /
 * `.sem-progress-fill`) so the theme vocabulary styles it unchanged.
 */
export function hydrateProgress(el: HTMLElement, payload: Record<string, unknown>): void {
  clearBindRender(el);
  clearBindState(el);

  const percent = typeof payload.percent === 'number' && Number.isFinite(payload.percent);
  const stepForm =
    typeof payload.step === 'number' &&
    Number.isFinite(payload.step) &&
    typeof payload.steps === 'number' &&
    Number.isFinite(payload.steps) &&
    payload.steps > 0;

  let pct: number;
  let label: string;
  if (percent) {
    pct = Math.min(100, Math.max(0, payload.percent as number));
    label = (el.getAttribute('data-label') ?? el.getAttribute('label') ?? 'progress') + ' :: ' + Math.round(pct) + '%';
  } else if (stepForm) {
    const step = payload.step as number;
    const steps = payload.steps as number;
    pct = Math.min(100, Math.max(0, (step / steps) * 100));
    label = `step ${step} / ${steps}`;
  } else {
    renderBindState(el, 'error', 'unrecognized progress payload');
    return;
  }

  const wrap = marked(document.createElement('div'));
  wrap.className = 'sem-bind-progress';
  const caption = document.createElement('span');
  caption.className = 'sem-bind-progress-label';
  caption.textContent = label;
  const track = document.createElement('span');
  track.className = 'sem-progress-track';
  const fill = document.createElement('span');
  fill.className = 'sem-progress-fill';
  fill.style.width = pct + '%';
  track.appendChild(fill);
  wrap.appendChild(caption);
  wrap.appendChild(track);
  if (typeof payload.comment === 'string' && payload.comment) {
    wrap.appendChild(commentNode(payload.comment));
  }
  el.appendChild(wrap);
}

function commentNode(text: string): HTMLElement {
  const c = document.createElement('div');
  c.className = 'sem-bind-comment';
  c.textContent = text;
  return marked(c);
}

/**
 * Plan / run-book / workflow payload intake:
 *
 *   {plan: "<markup>", status: {"<step-key>": {status, comment, choice, …}}}
 *   {definition: {steps: [...]}, status: {…}}   — the agentonomi
 *     `{definition, status}` GET shape for a fully KV-defined record
 *
 * `plan` (optional) BECOMES the element body — authored children are
 * replaced, the fetched definition is the record now (a payload without
 * `plan` leaves authored children alone and only applies the dictionary,
 * so status-only updates never wipe a hand-authored procedure). A
 * definition OBJECT carrying a `steps` array (strings or
 * `{id|key, label|title}`) generates the step list when the element has
 * no authored children to annotate; authored children always win. The
 * status dictionary maps step keys (step `id` / `data-id` / `data-key`)
 * to a status class, a comment line, and a `choice` — a single object
 * renders as the one fork taken, an array as the walked sequence in
 * order. Unknown keys pass through untouched.
 */
export function hydratePlan(el: HTMLElement, payload: Record<string, unknown>): void {
  clearBindState(el);
  if (typeof payload.plan === 'string' && payload.plan.trim()) {
    const state = el.querySelector('.sem-bind-state');
    for (const child of Array.from(el.children)) {
      if (child !== state) child.remove();
    }
    const body = marked(document.createElement('div'));
    body.className = 'sem-bind-body';
    body.appendChild(sanitizeMarkup(payload.plan));
    el.appendChild(body);
  }
  const definition = payload.definition;
  if (definition != null && typeof definition === 'object' && !Array.isArray(definition)) {
    generateDefinitionSteps(el, definition as Record<string, unknown>);
  }
  if (payload.status != null) {
    if (typeof payload.status !== 'object' || Array.isArray(payload.status)) {
      renderBindState(el, 'error', 'status dictionary must be an object');
      return;
    }
    applyStatusDictionary(el, payload.status as Record<string, unknown>);
  }
}

/**
 * Fully-KV-defined plans: the definition is data, not markup. When the
 * element carries no authored children to annotate, its `steps` array
 * becomes a generated sem-step list — keyed by `id` / `key` (strings key
 * by their own text) so the status dictionary annotates the generated
 * record exactly like an authored one. Authored children always win: an
 * element with content of its own is never overwritten by the fetched
 * definition, and a definition without steps is a harmless pass-through.
 */
function generateDefinitionSteps(el: HTMLElement, definition: Record<string, unknown>): void {
  if (!Array.isArray(definition.steps)) return;
  if (hasAuthoredChildren(el)) return;
  el.querySelectorAll('.sem-bind-definition').forEach((n) => n.remove()); // re-hydration replaces
  const list = marked(document.createElement('div'));
  list.className = 'sem-bind-definition';
  definition.steps.forEach((step, index) => {
    const { key, label } = stepKeyLabel(step, index);
    const node = document.createElement('sem-step');
    node.setAttribute('id', key);
    node.textContent = label;
    list.appendChild(node);
  });
  el.appendChild(list);
}

/** Authored content other than bind chrome — generated steps never clobber it. */
function hasAuthoredChildren(el: HTMLElement): boolean {
  return Array.from(el.children).some(
    (child) => !child.classList.contains('sem-bind-state') && !child.hasAttribute(BIND_RENDER),
  );
}

/** Step key + label from a definition-steps entry; never throws on odd shapes. */
function stepKeyLabel(step: unknown, index: number): { key: string; label: string } {
  if (typeof step === 'string') {
    return { key: step, label: step };
  }
  if (step != null && typeof step === 'object') {
    const s = step as Record<string, unknown>;
    const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
    const key = [s.id, s.key].find(isText);
    const label = [s.label, s.title].find(isText);
    if (key || label) {
      const k = key ?? (label as string);
      return { key: k, label: label ?? k };
    }
  }
  const label = step != null && typeof step === 'object' ? JSON.stringify(step) : String(step);
  return { key: `step-${index + 1}`, label };
}

/** Map a payload status onto the vocabulary's step status catalog. */
const STATUS_MAP: Record<string, string | null> = {
  complete: 'done',
  pending: 'todo',
  error: 'blocked',
  skipped: null, // no catalog spelling — carries its own bind attribute
  none: null, // no status at all
};

function applyStatusDictionary(el: HTMLElement, dict: Record<string, unknown>): void {
  const steps = Array.from(el.querySelectorAll('sem-step, .sem-step'));
  const byKey = new Map<string, HTMLElement[]>();
  for (const step of steps) {
    for (const key of [step.getAttribute('id'), step.getAttribute('data-id'), step.getAttribute('data-key')]) {
      if (key) {
        const list = byKey.get(key) ?? [];
        list.push(step as HTMLElement);
        byKey.set(key, list);
      }
    }
  }
  for (const [key, entry] of Object.entries(dict)) {
    const targets = byKey.get(key);
    if (!targets || targets.length === 0) continue; // unknown step key: harmless pass-through
    const info = (entry ?? {}) as { status?: unknown; comment?: unknown; choice?: unknown };
    const status = typeof info.status === 'string' ? info.status.trim().toLowerCase() : null;
    for (const step of targets) {
      // stale bind chrome first — re-hydration replaces, never appends
      step.querySelectorAll(`[${BIND_RENDER}]`).forEach((n) => n.remove());
      step.removeAttribute('data-sem-bind-status');
      if (status === 'none' || status == null) {
        if (status == null && info.status != null) {
          // an unlisted status string still surfaces, unstyled
          step.setAttribute('data-sem-bind-status', String(info.status));
        } else {
          step.removeAttribute('data-status');
        }
      } else {
        step.setAttribute('data-sem-bind-status', status);
        const mapped = STATUS_MAP[status];
        if (mapped) step.setAttribute('data-status', mapped);
        else step.removeAttribute('data-status');
      }
      if (typeof info.comment === 'string' && info.comment) step.appendChild(commentNode(info.comment));
      if (info.choice != null) step.appendChild(choiceNode(info.choice));
    }
  }
}

/**
 * A taken fork: single object → one "choice" line; array → the walked
 * sequence, in order, numbered. Non-conforming values render as the raw
 * JSON in the same chrome rather than dropping silently.
 */
function choiceNode(choice: unknown): HTMLElement {
  const box = document.createElement('div');
  box.className = 'sem-bind-choice';
  marked(box);
  const isObj = (v: unknown): v is Record<string, unknown> =>
    v != null && typeof v === 'object' && !Array.isArray(v);
  if (isObj(choice)) {
    box.appendChild(choiceLine(choice));
  } else if (Array.isArray(choice)) {
    const walk = document.createElement('ol');
    walk.className = 'sem-bind-choice-walk';
    for (const item of choice) {
      const li = document.createElement('li');
      if (isObj(item)) li.appendChild(choiceLine(item));
      else li.textContent = JSON.stringify(item);
      walk.appendChild(li);
    }
    box.appendChild(walk);
  } else {
    box.textContent = JSON.stringify(choice);
  }
  return box;
}

function choiceLine(entry: Record<string, unknown>): HTMLElement {
  const line = document.createElement('span');
  line.className = 'sem-bind-choice-line';
  const label = document.createElement('span');
  label.className = 'sem-bind-choice-label';
  label.textContent = 'choice';
  const option = document.createElement('span');
  option.className = 'sem-bind-choice-option';
  option.textContent = String(entry.option ?? '');
  line.appendChild(label);
  line.appendChild(option);
  if (typeof entry.reason === 'string' && entry.reason) {
    const reason = document.createElement('span');
    reason.className = 'sem-bind-choice-reason';
    reason.textContent = ' — ' + entry.reason;
    line.appendChild(reason);
  }
  return line;
}

/**
 * Conservative sanitizer for fetched `plan` markup: script/iframe/object/
 * embed/link/meta/base elements are dropped, `on*` handlers are stripped,
 * and `href`/`src` are scheme-ALLOWLISTED: http, https and mailto pass,
 * any other scheme (javascript:, vbscript:, data:, file:, …) is removed —
 * scheme-less values (relative URLs, fragments) pass. The plan definition
 * is first-party authored, but it renders as live HTML — it gets the same
 * hygiene as anything the network delivered.
 */
const SAFE_URL_SCHEMES = /^($|https?:|mailto:)/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function sanitizeMarkup(html: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = html;
  const root = template.content;
  for (const el of Array.from(root.querySelectorAll('script, iframe, object, embed, link, meta, base'))) {
    el.remove();
  }
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if (name === 'href' || name === 'src') {
        // Scheme allowlist: a URL carrying a scheme must be http/https/
        // mailto; relative URLs (no scheme) pass untouched.
        if (HAS_SCHEME.test(value) && !SAFE_URL_SCHEMES.test(value)) el.removeAttribute(attr.name);
      }
    }
  }
  return root;
}

/* ── attach ── */

export interface AttachBindDeps extends FetchBindDeps {
  /** Override the interval for tests (default 500ms popup watch, 30s poll). */
  refreshMs?: number;
}

const timers = new WeakMap<object, ReturnType<typeof setInterval>>();
const attached = new WeakSet<object>();
let hashChecked = false;

/** Stop an element's poll loop (called on disconnect). */
export function stopBind(el: object): void {
  const timer = timers.get(el);
  if (timer != null) {
    clearInterval(timer);
    timers.delete(el);
  }
}

function refreshMsFor(el: HTMLElement, fallback = DEFAULT_REFRESH_MS): number {
  const raw = Number(el.getAttribute('sem-refresh'));
  return Number.isFinite(raw) && raw > 0 ? raw * 1000 : fallback;
}

/**
 * Wire a connected element's `sem-bind` attribute: parse, fetch, hydrate,
 * poll (progress kind only). Direct `payload` properties bypass this —
 * they hydrate immediately with no network. Fetch/parse failures render
 * the bind error state; a 401 mid-flow renders the auth-pending state.
 */
export async function attachBind(el: HTMLElement, deps: AttachBindDeps = {}): Promise<void> {
  if (attached.has(el)) return;
  attached.add(el);
  if (!hashChecked) {
    hashChecked = true;
    const loc = (globalThis as { location?: Location }).location;
    const hist = (globalThis as { history?: History }).history;
    const sess = (globalThis as { sessionStorage?: KVStore }).sessionStorage;
    const store = (globalThis as { localStorage?: KVStore }).localStorage;
    if (loc && hist && sess && store) consumeBindHash(loc, hist, sess, store, deps.now);
  }

  const ref = parseBind(el.getAttribute('sem-bind'));
  if (!ref) {
    renderBindState(el, 'error', 'unparseable sem-bind');
    return;
  }

  let hydrated = false;
  const tick = async (): Promise<void> => {
    if (!el.isConnected) return;
    // Never overwrite live data with a pending line — only the first
    // load (before any payload has landed) shows it.
    if (!hydrated) renderBindState(el, 'pending');
    try {
      const result = await fetchBindJson(ref.url, deps);
      if (!el.isConnected) return;
      if (result.authFailed) {
        renderBindState(el, 'error', 'authorization required — token rejected');
        return;
      }
      if (result.status !== 200) {
        renderBindState(el, 'error', `HTTP ${result.status}`);
        return;
      }
      hydrated = true;
      hydrateFor(el, result.payload);
    } catch (err) {
      if (el.isConnected) renderBindState(el, 'error', err instanceof Error ? err.message : 'network error');
    }
  };

  await tick();
  if (isPollKind(ref) && !timers.has(el)) {
    timers.set(el, setInterval(tick, deps.refreshMs ?? refreshMsFor(el)));
  }
}

/**
 * The bind-aware SemElement base: a reactive `payload` property (direct
 * JSON intake — demos and tests need no server) and automatic attach for
 * elements authored with a `sem-bind` attribute. Poll loops are torn
 * down on disconnect.
 */
export class BindableElement extends SemElement {
  static properties = {
    payload: { type: Object, attribute: false },
  };

  declare payload: unknown;

  #bound = false;
  #hydratedPayload: unknown;

  constructor() {
    super();
    this.payload = null;
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    if (this.payload !== this.#hydratedPayload) {
      this.#hydratedPayload = this.payload;
      if (this.payload != null) hydrateFor(this, this.payload);
    }
    if (!this.#bound && this.hasAttribute('sem-bind')) {
      this.#bound = true;
      void attachBind(this);
    }
  }

  override disconnectedCallback(): void {
    stopBind(this);
    super.disconnectedCallback();
  }
}
