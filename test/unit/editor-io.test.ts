// @vitest-environment happy-dom
// Unit spec — editor io (EDITOR.md §12): byte-exact export + round trip,
// clipboard ladder, debounced localStorage drafts + restore prompt,
// VFS-backed EditorStore (memory / localStorage / S3-arg validation), the
// two import doors, and the wire into the shell's request events.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDocument } from '../../src/editor/model/document.js';
import type { EditorDocument, EditorNode, ElementNode } from '../../src/editor/model/types.js';
import { EditorContext } from '../../src/editor/shell/context.js';
import { Vfs } from '../../src/terminal/vfs.js';
import { attachLocalStorage, type KeyValueStore } from '../../src/terminal/backends/local-storage.js';
import {
  AUTOSAVE_DEBOUNCE_MS,
  DRAFTS_INDEX_KEY,
  DRAFT_KEY_PREFIX,
  attachAutosave,
  deleteDraft,
  listDrafts,
  loadDraft,
  promptRestoreDraft,
} from '../../src/editor/io/autosave.js';
import {
  SEM_HTML_EXT,
  downloadSource,
  exportDocument,
  exportFilename,
  fragmentMarker,
  isSemHtmlFilename,
} from '../../src/editor/io/export.js';
import { copySource } from '../../src/editor/io/clipboard.js';
import {
  localStorageStore,
  memoryStore,
  s3Store,
  vfsEditorStore,
} from '../../src/editor/io/store.js';
import { importSanitized, importSource, readFileText } from '../../src/editor/io/import.js';
import { COPY_REQUEST_EVENT, wireIo } from '../../src/editor/io/wire.js';
import type { DraftMeta } from '../../src/editor/io/types.js';

// ── fixtures ─────────────────────────────────────────────────────────────────

const SRC = [
  '<!doctype html>',
  '<html xmlns="http://www.w3.org/1999/xhtml">',
  '<head><title>Field Notes</title></head>',
  '<body>',
  '<!-- a comment -->',
  "<sem-note variant='info' id=\"n1\">",
  '  <span class="sem-note-body">Hello &amp; welcome</span>',
  '</sem-note>',
  '<sem-chat>',
  '  <script type="application/json">{"msgs":[{"who":"a","text":"hi & <bye>"}]}</script>',
  '</sem-chat>',
  '<p>Trailing text</p>',
  '</body>',
  '</html>',
  '',
].join('\n');

/** Deep element lookup (root children are doctype/html, not the tags). */
function deepFind(doc: EditorDocument, name: string): ElementNode | undefined {
  const walk = (nodes: readonly EditorNode[]): ElementNode | undefined => {
    for (const n of nodes) {
      if (n.kind !== 'element') continue;
      if (n.name.toLowerCase() === name) return n;
      const hit = walk(n.children);
      if (hit !== undefined) return hit;
    }
    return undefined;
  };
  return walk(doc.root.children);
}

/** First text child of an element (or undefined). */
function firstText(el: ElementNode): string | undefined {
  const child = el.children.find((c) => c.kind === 'text');
  return child?.kind === 'text' ? child.id : undefined;
}

/** All ids in the tree (root excluded). */
function collectIds(doc: EditorDocument): Set<string> {
  const out = new Set<string>();
  const walk = (nodes: readonly EditorNode[]): void => {
    for (const n of nodes) {
      out.add(n.id);
      if (n.kind === 'element') walk(n.children);
    }
  };
  walk(doc.root.children);
  return out;
}

/** Minimal KeyValueStore double over a Map. */
function fakeStorage(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** happy-dom's navigator.clipboard is getter-only — shadow it on the instance. */
function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

/** happy-dom has no execCommand — install a shadow for the fallback ladder. */
function setExecCommand(fn: () => boolean): ReturnType<typeof vi.fn> {
  const spy = vi.fn(fn);
  Object.defineProperty(document, 'execCommand', { value: spy, configurable: true, writable: true });
  return spy;
}

const realCreateObjectURL = URL.createObjectURL;
const realRevokeObjectURL = URL.revokeObjectURL;

beforeEach(() => {
  vi.useFakeTimers();
  (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn(() => 'blob:mock-url');
  (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  URL.createObjectURL = realCreateObjectURL;
  URL.revokeObjectURL = realRevokeObjectURL;
});

// ── export ───────────────────────────────────────────────────────────────────

describe('io export', () => {
  it('exports untouched documents byte-exact', () => {
    const doc = createDocument(SRC);
    expect(exportDocument(doc)).toBe(SRC);
  });

  it('re-emits only the touched attribute on edit', () => {
    const doc = createDocument(SRC);
    const note = deepFind(doc, 'sem-note')!;
    doc.transaction('setAttr', (tx) => {
      tx.push({ type: 'setAttr', node: note.id, name: 'variant', value: 'warning' });
    });
    const out = exportDocument(doc);
    expect(out).toBe(SRC.replace("<sem-note variant='info' id=\"n1\">", "<sem-note variant='warning' id=\"n1\">"));
  });

  it('round-trips export → import → export byte-identically', () => {
    const doc = createDocument(SRC);
    const p = deepFind(doc, 'p')!;
    const textId = firstText(p);
    expect(textId).toBeDefined();
    doc.transaction('edit', (tx) => {
      tx.push({ type: 'setAttr', node: p.id, name: 'kind', value: 'note' });
      tx.push({ type: 'setText', node: textId!, value: 'Rewritten & re-escaped' });
    });
    const once = exportDocument(doc);
    const reopened = importSource(once);
    expect(reopened.ok).toBe(true);
    expect(reopened.doc.serialize()).toBe(once);
  });

  it('prefixes the fragment marker when asked; the marker round-trips', () => {
    const doc = createDocument(SRC);
    const marker = fragmentMarker('sem-note');
    const out = exportDocument(doc, { fragmentRoot: 'sem-note' });
    expect(out.startsWith(marker)).toBe(true);
    expect(out.slice(marker.length)).toBe(SRC);
    // the marker is a comment — preserved trivia — so an import re-exports it
    const again = exportDocument(importSource(out).doc);
    expect(again).toBe(out);
  });

  it('derives the filename from the document title', () => {
    expect(exportFilename(createDocument(SRC))).toBe(`field-notes${SEM_HTML_EXT}`);
    const anon = createDocument('<body><p>x</p></body>');
    expect(exportFilename(anon)).toBe(`untitled${SEM_HTML_EXT}`);
    expect(isSemHtmlFilename('field-notes.sem.html')).toBe(true);
    expect(isSemHtmlFilename('notes.txt')).toBe(false);
  });

  it('downloads the exact bytes via blob + anchor', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadSource(SRC, 'field-notes.sem.html');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Blob;
    expect(blob.type).toBe('application/xhtml+xml');
    expect(click).toHaveBeenCalledTimes(1);
    // the anchor is removed after the click
    expect(document.body.querySelector('a[download]')).toBeNull();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled(); // reclaimed on a later turn
    vi.advanceTimersByTime(1_100);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});

// ── clipboard ────────────────────────────────────────────────────────────────

describe('io clipboard', () => {
  afterEach(() => {
    setClipboard(undefined);
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (navigator as unknown as Record<string, unknown>).clipboard;
  });

  it('uses the async Clipboard API when available', async () => {
    const writeText = vi.fn(async () => undefined);
    setClipboard({ writeText });
    await expect(copySource(SRC)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith(SRC);
  });

  it('falls back to the hidden-textarea ladder', async () => {
    setClipboard({ writeText: vi.fn(async () => Promise.reject(new Error('denied'))) });
    const exec = setExecCommand(() => true);
    await expect(copySource('x')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea[aria-hidden="true"]')).toBeNull(); // cleaned up
  });

  it('resolves false when every rung fails', async () => {
    setClipboard({ writeText: vi.fn(async () => Promise.reject(new Error('denied'))) });
    setExecCommand(() => false);
    await expect(copySource('x')).resolves.toBe(false);
  });
});

// ── autosave ─────────────────────────────────────────────────────────────────

describe('io autosave', () => {
  it('writes a debounced draft + index entry after changes', () => {
    const store = fakeStorage();
    const doc = createDocument(SRC);
    const handle = attachAutosave(doc, { key: 'k1', storage: store });
    const note = deepFind(doc, 'sem-note')!;
    doc.apply({ type: 'setAttr', node: note.id, name: 'id', value: 'n2' });
    expect(store.map.has(DRAFT_KEY_PREFIX + 'k1')).toBe(false); // debounced
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 1);
    const raw = store.map.get(DRAFT_KEY_PREFIX + 'k1')!;
    expect(raw).toBeDefined();
    const payload = JSON.parse(raw) as { source: string; savedAt: string; mode: string };
    expect(payload.source).toBe(doc.serialize());
    expect(payload.mode).toBe('wysiwyg');
    expect(typeof payload.savedAt).toBe('string');
    const index = JSON.parse(store.map.get(DRAFTS_INDEX_KEY)!) as DraftMeta[];
    expect(index).toHaveLength(1);
    expect(index[0]).toMatchObject({ key: 'k1', title: 'Field Notes' });
    handle.dispose();
  });

  it('coalesces a burst into one write', () => {
    const store = fakeStorage();
    const writes: string[] = [];
    const counting: KeyValueStore = {
      getItem: store.getItem,
      removeItem: store.removeItem,
      setItem: (k, v) => {
        if (k === DRAFT_KEY_PREFIX + 'burst') writes.push(v);
        store.setItem(k, v);
      },
    };
    const doc = createDocument(SRC);
    const handle = attachAutosave(doc, { key: 'burst', storage: counting });
    const note = deepFind(doc, 'sem-note')!;
    doc.apply({ type: 'setAttr', node: note.id, name: 'id', value: 'a' });
    vi.advanceTimersByTime(100);
    doc.apply({ type: 'setAttr', node: note.id, name: 'id', value: 'b' });
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 1);
    expect(writes).toHaveLength(1);
    handle.dispose();
  });

  it('flush() writes now; dispose() cancels the pending write', () => {
    const store = fakeStorage();
    const doc = createDocument(SRC);
    const handle = attachAutosave(doc, { key: 'k2', storage: store, getMode: () => 'code' });
    const note = deepFind(doc, 'sem-note')!;
    doc.apply({ type: 'setAttr', node: note.id, name: 'id', value: 'z' });
    handle.flush();
    expect(store.map.has(DRAFT_KEY_PREFIX + 'k2')).toBe(true);
    expect((JSON.parse(store.map.get(DRAFT_KEY_PREFIX + 'k2')!) as { mode: string }).mode).toBe('code');

    const doc2 = createDocument(SRC);
    const handle2 = attachAutosave(doc2, { key: 'k3', storage: store });
    const p = deepFind(doc2, 'p')!;
    doc2.apply({ type: 'setText', node: firstText(p)!, value: 'gone' });
    handle2.dispose();
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(store.map.has(DRAFT_KEY_PREFIX + 'k3')).toBe(false);
    handle.dispose();
  });

  it('records quota failures without throwing, then heals', () => {
    let fail = true;
    const flaky: KeyValueStore = {
      getItem: () => null,
      removeItem: () => {},
      setItem: () => {
        if (fail) throw new Error('QuotaExceededError');
      },
    };
    const doc = createDocument(SRC);
    const handle = attachAutosave(doc, { key: 'k4', storage: flaky });
    const note = deepFind(doc, 'sem-note')!;
    doc.apply({ type: 'setAttr', node: note.id, name: 'id', value: 'q' });
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 1);
    expect(handle.lastError()).toBeInstanceOf(Error);
    fail = false;
    handle.flush();
    expect(handle.lastError()).toBeNull();
    handle.dispose();
  });

  it('lists, loads, and deletes drafts (pruning missing slots)', () => {
    const store = fakeStorage();
    store.map.set(DRAFT_KEY_PREFIX + 'a', JSON.stringify({ source: '<p>a</p>', savedAt: '2026-10-14T10:00:00.000Z', mode: 'wysiwyg' }));
    store.map.set(DRAFT_KEY_PREFIX + 'b', JSON.stringify({ source: '<p>b</p>', savedAt: '2026-10-14T11:00:00.000Z', mode: 'code' }));
    store.map.set(DRAFTS_INDEX_KEY, JSON.stringify([
      { key: 'ghost', savedAt: '2026-10-14T12:00:00.000Z', title: 'Ghost' },
      { key: 'a', savedAt: '2026-10-14T10:00:00.000Z', title: 'A' },
      { key: 'b', savedAt: '2026-10-14T11:00:00.000Z', title: 'B' },
    ]));
    const drafts = listDrafts(store);
    expect(drafts.map((d) => d.key)).toEqual(['b', 'a']); // newest first, ghost pruned

    expect(loadDraft('a', store)).toMatchObject({ source: '<p>a</p>', mode: 'wysiwyg' });
    expect(loadDraft('missing', store)).toBeNull();
    store.map.set(DRAFT_KEY_PREFIX + 'bad', '{not json');
    expect(loadDraft('bad', store)).toBeNull();

    deleteDraft('a', store);
    expect(store.map.has(DRAFT_KEY_PREFIX + 'a')).toBe(false);
    expect(listDrafts(store).map((d) => d.key)).toEqual(['b']);
  });

  it('restore prompt: accepted returns the payload; declined/missing returns null', () => {
    const store = fakeStorage();
    store.map.set(DRAFT_KEY_PREFIX + 'a', JSON.stringify({ source: '<p>a</p>', savedAt: '2026-10-14T10:00:00.000Z', mode: 'wysiwyg' }));
    const meta: DraftMeta = { key: 'a', savedAt: '2026-10-14T10:00:00.000Z', title: 'A' };
    const yes = promptRestoreDraft(meta, store, { confirm: () => true });
    expect(yes).toMatchObject({ source: '<p>a</p>' });
    const no = promptRestoreDraft(meta, store, { confirm: () => false });
    expect(no).toBeNull();
    const ghost = promptRestoreDraft({ key: 'ghost', savedAt: '', title: 'G' }, store, { confirm: () => true });
    expect(ghost).toBeNull();
  });
});

// ── store (VFS-backed EditorStore) ───────────────────────────────────────────

describe('io store', () => {
  it('memory store: write/read/list/delete with nested dirs', async () => {
    const store = memoryStore();
    await store.write('/docs/nested/doc.sem.html', SRC);
    await expect(store.read('/docs/nested/doc.sem.html')).resolves.toBe(SRC);
    const listing = await store.list('/docs/nested');
    expect(listing).toEqual([
      { name: 'doc.sem.html', kind: 'file', path: '/docs/nested/doc.sem.html', size: SRC.length },
    ]);
    const root = await store.list('/');
    expect(root.map((f) => f.kind)).toContain('dir');
    await store.delete('/docs/nested/doc.sem.html');
    await expect(store.read('/docs/nested/doc.sem.html')).rejects.toThrow(/no such file/);
    await expect(store.delete('/docs/nested/doc.sem.html')).rejects.toThrow();
    await expect(store.read('/docs')).rejects.toThrow(/is a directory/);
  });

  it('root option scopes all paths (leading / cannot escape)', async () => {
    const store = memoryStore({ root: '/projects' });
    await store.write('a.sem.html', SRC);
    await store.write('/b.sem.html', SRC);
    await expect(store.read('/projects/a.sem.html')).resolves.toBe(SRC);
    await expect(store.read('/projects/b.sem.html')).resolves.toBe(SRC);
    const listing = await store.list();
    expect(listing.map((f) => f.path).sort()).toEqual(['/projects/a.sem.html', '/projects/b.sem.html']);
  });

  it('localStorage store persists through the shell backend and reloads', async () => {
    const kv = fakeStorage();
    const store = localStorageStore('editor-io-spec', { store: kv });
    await store.write('/doc.sem.html', SRC);
    // the whole-tree payload landed under the shell namespace
    const raw = kv.map.get('semtext:shell:v1:editor-io-spec')!;
    expect(raw).toContain('doc.sem.html');
    // a fresh Vfs + restore sees the document (the reload path)
    const vfs2 = new Vfs();
    const backend = attachLocalStorage(vfs2, { key: 'editor-io-spec', store: kv });
    expect(backend.restore()).toBe('restored');
    const store2 = vfsEditorStore(vfs2, { id: 'local-storage' });
    await expect(store2.read('/doc.sem.html')).resolves.toBe(SRC);
    expect(store2.id).toBe('local-storage');
  });

  it('s3 store rejects bad mount args before any network call', async () => {
    await expect(s3Store([])).rejects.toThrow(/usage: mount s3/);
    await expect(
      s3Store(['https://bucket.example.com/docs/', '/s3', 'access_key=nope']),
    ).rejects.toThrow(/static credentials are never accepted/);
  });
});

// ── import ───────────────────────────────────────────────────────────────────

describe('io import', () => {
  it('opens clean documents; structured failure keeps the best-effort tree', () => {
    const ok = importSource(SRC);
    expect(ok.ok).toBe(true);
    expect(ok.doc.serialize()).toBe(SRC);

    const bad = importSource('<body><sem-note>truncated');
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.code).toBe('unclosed-tag');
      expect(bad.doc.root).toBeDefined(); // last-good decision stays with the session
    }
  });

  it('reads picked files as text', async () => {
    await expect(readFileText(new Blob([SRC], { type: 'application/xhtml+xml' }))).resolves.toBe(SRC);
  });

  it('paste door: sanitizes and rebuilds through the target document', () => {
    const target = createDocument(SRC);
    const before = collectIds(target);
    const pasted =
      '<p onclick="x()">hi</p><script>alert(1)</script><sem-note variant="info">kept</sem-note>';
    const known = new Set(['sem-note']);
    const result = importSanitized(target, pasted, { knownTags: known });
    expect(result.droppedTags).toBeGreaterThanOrEqual(1); // script dropped WITH content
    expect(result.droppedAttrs).toBeGreaterThanOrEqual(1); // onclick dropped
    // known tags survive with their text; attrs outside the §8 allow-list
    // (onclick here, and sem-note's `variant` — not in the global catalog)
    // are dropped by the sanitizer's contract
    expect(result.nodes.some((n) => n.kind === 'element' && n.name === 'sem-note')).toBe(true);
    expect(result.nodes.some((n) => n.kind === 'element' && n.name === 'script')).toBe(false);
    // no script payload leaks in as text
    const texts = result.nodes.map((n) => (n.kind === 'text' ? n.value : n.kind === 'element' ? n.children.map((c) => (c.kind === 'text' ? c.value : '')).join('') : ''));
    expect(texts.join('\n')).not.toContain('alert(1)');
    // ids are fresh (adoption rule); inserting them into the target works and
    // they become resolvable through the document once attached
    for (const node of result.nodes) {
      expect(before.has(node.id)).toBe(false);
    }
    const rootId = target.root.id;
    target.transaction('paste', (tx) => {
      for (const node of result.nodes) {
        tx.push({ type: 'insertNode', parent: rootId, index: target.root.children.length, node });
      }
    });
    for (const node of result.nodes) {
      expect(target.node(node.id)).toBeDefined();
    }
    const out = exportDocument(target);
    expect(out).toContain('<sem-note>kept</sem-note>');
    expect(out).toContain('<p>hi</p>');
    expect(out).not.toContain('alert');
  });
});

// ── wire ─────────────────────────────────────────────────────────────────────

describe('io wire', () => {
  function harness(store?: KeyValueStore) {
    const doc = createDocument(SRC);
    const ctx = new EditorContext(doc);
    const announcements: string[] = [];
    ctx.announce = (m: string) => announcements.push(m);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const downloads: Array<{ source: string; filename: string }> = [];
    const download = (source: string, filename: string) => downloads.push({ source, filename });
    return { doc, ctx, host, announcements, downloads, download, store: store ?? fakeStorage() };
  }

  const fire = (el: HTMLElement, type: string): void => {
    el.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true }));
  };

  it('export request: serializes, flushes autosave, downloads, announces', () => {
    const h = harness();
    const io = wireIo({ ctx: h.ctx, surface: h.host, draftsKey: 'doc-1', storage: h.store, download: h.download });
    fire(h.host, 'sem-edit-export-request');
    expect(h.downloads).toEqual([{ source: SRC, filename: 'field-notes.sem.html' }]);
    expect(h.announcements[0]).toBe('Exported field-notes.sem.html');
    // export flushed the autosave slot without waiting for the debounce
    expect(h.store.map.has(DRAFT_KEY_PREFIX + 'doc-1')).toBe(true);
    io.detach();
  });

  it('copy request: clipboard ladder + announcement', async () => {
    const h = harness();
    const writeText = vi.fn(async () => undefined);
    setClipboard({ writeText });
    const io = wireIo({ ctx: h.ctx, surface: h.host, storage: null, download: h.download });
    fire(h.host, COPY_REQUEST_EVENT);
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(SRC));
    await vi.waitFor(() => expect(h.announcements).toContain('Copied document source'));
    io.detach();
  });

  it('export failure announces instead of throwing', () => {
    const h = harness();
    const io = wireIo({
      ctx: h.ctx,
      surface: h.host,
      storage: null,
      download: () => {
        throw new Error('no downloads here');
      },
    });
    expect(() => fire(h.host, 'sem-edit-export-request')).not.toThrow();
    expect(h.announcements[0]).toBe('Export failed: no downloads here');
    io.detach();
  });

  it('open request: hands drafts + store files to the open surface', async () => {
    const h = harness();
    const mem = memoryStore();
    await mem.write('/notes.sem.html', SRC);
    await mem.write('/assets/readme.txt', 'x'); // real dir in the listing
    const io = wireIo({ ctx: h.ctx, surface: h.host, draftsKey: 'doc-1', storage: h.store, store: mem });
    h.store.map.set(
      DRAFT_KEY_PREFIX + 'other',
      JSON.stringify({ source: '<p>x</p>', savedAt: '2026-10-14T09:00:00.000Z', mode: 'wysiwyg' }),
    );
    h.store.map.set(
      DRAFTS_INDEX_KEY,
      JSON.stringify([{ key: 'other', savedAt: '2026-10-14T09:00:00.000Z', title: 'Other' }]),
    );
    const seen: unknown[] = [];
    const captured = wireIo({
      ctx: h.ctx,
      surface: h.host,
      draftsKey: 'doc-1',
      storage: h.store,
      store: mem,
      onOpenRequest: (info) => seen.push(info),
    });
    fire(h.host, 'sem-edit-open-request');
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    const info = seen[0] as { drafts: DraftMeta[]; files: Array<{ name: string }> };
    expect(info.drafts.map((d) => d.key)).toEqual(['other']);
    expect(info.files.map((f) => f.name)).toEqual(['notes.sem.html']); // dirs filtered
    io.detach();
    captured.detach();
  });

  it('open fallback: restore prompt feeds onRestore (accept and decline)', async () => {
    const h = harness();
    h.store.map.set(
      DRAFT_KEY_PREFIX + 'doc-1',
      JSON.stringify({ source: '<p>restored</p>', savedAt: '2026-10-14T10:00:00.000Z', mode: 'wysiwyg' }),
    );
    h.store.map.set(
      DRAFTS_INDEX_KEY,
      JSON.stringify([{ key: 'doc-1', savedAt: '2026-10-14T10:00:00.000Z', title: 'Field Notes' }]),
    );
    const restored: string[] = [];
    const io = wireIo({
      ctx: h.ctx,
      surface: h.host,
      draftsKey: 'doc-1',
      storage: h.store,
      confirm: () => true,
      onRestore: (p) => restored.push(p.source),
    });
    fire(h.host, 'sem-edit-open-request');
    await vi.waitFor(() => expect(restored).toEqual(['<p>restored</p>']));
    io.detach();

    const restored2: string[] = [];
    const io2 = wireIo({
      ctx: h.ctx,
      surface: h.host,
      draftsKey: 'doc-1',
      storage: h.store,
      confirm: () => false,
      onRestore: (p) => restored2.push(p.source),
    });
    fire(h.host, 'sem-edit-open-request');
    await vi.waitFor(() => expect(restored2).toEqual([]));
    io2.detach();
  });

  it('Cmd/Ctrl+S exports (§7 parity); plain S does not; flag disables', () => {
    const h = harness();
    const io = wireIo({ ctx: h.ctx, surface: h.host, storage: null, download: h.download });
    h.host.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true }));
    expect(h.downloads).toHaveLength(1);
    h.host.dispatchEvent(new KeyboardEvent('keydown', { key: 's', cancelable: true }));
    expect(h.downloads).toHaveLength(1);
    io.detach();

    const io2 = wireIo({ ctx: h.ctx, surface: h.host, storage: null, download: h.download, saveKey: false });
    h.host.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true }));
    expect(h.downloads).toHaveLength(1);
    io2.detach();
  });

  it('detach removes every listener', () => {
    const h = harness();
    const io = wireIo({ ctx: h.ctx, surface: h.host, draftsKey: 'doc-1', storage: h.store, download: h.download });
    io.detach();
    fire(h.host, 'sem-edit-export-request');
    fire(h.host, COPY_REQUEST_EVENT);
    fire(h.host, 'sem-edit-open-request');
    h.host.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true }));
    expect(h.downloads).toHaveLength(0);
    // disposed autosave does not write after detach either
    const note = deepFind(h.doc, 'sem-note')!;
    h.doc.apply({ type: 'setAttr', node: note.id, name: 'id', value: 'late' });
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(h.store.map.has(DRAFT_KEY_PREFIX + 'doc-1')).toBe(false);
  });
});
