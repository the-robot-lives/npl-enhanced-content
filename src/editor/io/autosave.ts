/**
 * editor/io/autosave — debounced localStorage drafts (EDITOR.md §12).
 *
 * One autosave slot per document key: `semtext-editor:draft:<key>` holds
 * `{ source, savedAt, mode }`; the `semtext-editor:drafts` index lists the
 * slots (most recent first) with titles for the Open surface. Writes are
 * debounced (1 s trailing) off the document's change stream, so a typing
 * burst costs one write; `flush()` forces the write (export/close paths).
 *
 * Storage is the `KeyValueStore` shape from the shell's localStorage backend
 * (imported, not edited) — injectable, so tests run on a plain Map. Quota
 * and privacy-mode failures NEVER break editing: they land on
 * `handle.lastError` and the next successful write heals the slot.
 */

import type { EditorDocument } from '../model/types.js';
import type { KeyValueStore } from '../../terminal/backends/local-storage.js';
import type { DraftMeta, DraftPayload } from './types.js';
import { documentTitle } from '../shell/context.js';

/** Key namespace is `semtext-editor:*` (EDITOR.md §0 reserved names). */
export const DRAFT_KEY_PREFIX = 'semtext-editor:draft:';
export const DRAFTS_INDEX_KEY = 'semtext-editor:drafts';

/** Default debounce (§12: "debounced (1 s) post-change write"). */
export const AUTOSAVE_DEBOUNCE_MS = 1_000;

/** The browser store, when there is one (tests inject their own). */
export function defaultStorage(): KeyValueStore | null {
  const store = (globalThis as { localStorage?: KeyValueStore }).localStorage;
  return store ?? null;
}

function slotKey(key: string): string {
  return DRAFT_KEY_PREFIX + key;
}

/** Read + parse the drafts index; corrupt/missing → empty. */
function readIndex(store: KeyValueStore): DraftMeta[] {
  const raw = store.getItem(DRAFTS_INDEX_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is DraftMeta =>
        typeof entry === 'object' && entry !== null &&
        typeof (entry as DraftMeta).key === 'string' &&
        typeof (entry as DraftMeta).savedAt === 'string',
    );
  } catch {
    return [];
  }
}

function writeIndex(store: KeyValueStore, entries: DraftMeta[]): void {
  try {
    store.setItem(DRAFTS_INDEX_KEY, JSON.stringify(entries));
  } catch {
    // index loss is non-fatal; slots remain discoverable by key
  }
}

/** Index slots that still have a payload, most recent first. */
export function listDrafts(storage: KeyValueStore): DraftMeta[] {
  const entries = readIndex(storage).filter((meta) => storage.getItem(slotKey(meta.key)) !== null);
  return entries.sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0));
}

/** Load one draft payload; null when missing/corrupt. */
export function loadDraft(key: string, storage: KeyValueStore): DraftPayload | null {
  const raw = storage.getItem(slotKey(key));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DraftPayload> | null;
    if (parsed === null || typeof parsed.source !== 'string' || typeof parsed.savedAt !== 'string') {
      return null;
    }
    return { source: parsed.source, savedAt: parsed.savedAt, mode: parsed.mode ?? 'wysiwyg' };
  } catch {
    return null;
  }
}

/** Drop one draft slot + its index entry. */
export function deleteDraft(key: string, storage: KeyValueStore): void {
  storage.removeItem(slotKey(key));
  const rest = readIndex(storage).filter((meta) => meta.key !== key);
  writeIndex(storage, rest);
}

export interface RestorePromptOptions {
  /** Override the `window.confirm` prompt (tests, custom dialogs). */
  confirm?: (message: string) => boolean;
}

function defaultConfirm(message: string): boolean {
  return typeof window !== 'undefined' && typeof window.confirm === 'function'
    ? window.confirm(message)
    : false;
}

/**
 * The v1 restore prompt: offer the draft, return the payload when accepted.
 * `null` = no draft, or the user declined. The message names the title and
 * the save time so the user knows what they are restoring.
 */
export function promptRestoreDraft(
  meta: DraftMeta,
  storage: KeyValueStore,
  opts?: RestorePromptOptions,
): DraftPayload | null {
  const draft = loadDraft(meta.key, storage);
  if (draft === null) return null;
  const when = new Date(draft.savedAt);
  const label = Number.isNaN(when.getTime())
    ? draft.savedAt
    : when.toLocaleString();
  const ok = (opts?.confirm ?? defaultConfirm)(
    `Restore draft “${meta.title}” (saved ${label})? Unsaved changes in the current document are kept until you edit.`,
  );
  return ok ? draft : null;
}

// ── The autosave attachment ──────────────────────────────────────────────────

export interface AutosaveOptions {
  /** Per-document key (stable across reloads, e.g. a file path or doc id). */
  key: string;
  /** Storage backend; defaults to `window.localStorage` when present. */
  storage?: KeyValueStore | null;
  /** Debounce window; default 1 s. */
  delay?: number;
  /** Mode recorded in the payload (editor mode at save time). */
  getMode?: () => string;
  /** Called after each successful slot write (debounced or flushed) — the
   *  shell clears its dirty dot here (Instrument: "Saved HH:MM"). */
  onSave?: () => void;
}

export interface AutosaveHandle {
  readonly key: string;
  /** Write now (cancels the pending debounced write). */
  flush(): void;
  /** Unsubscribe + cancel; safe twice. */
  dispose(): void;
  /** Last storage failure, if any (quota, privacy mode). */
  lastError(): Error | null;
}

/** Attach debounced autosave for `doc`; the host disposes on close/replace. */
export function attachAutosave(doc: EditorDocument, opts: AutosaveOptions): AutosaveHandle {
  const key = opts.key;
  const storage = opts.storage !== undefined ? opts.storage : defaultStorage();
  const delay = opts.delay ?? AUTOSAVE_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let error: Error | null = null;

  const write = (): void => {
    timer = null;
    if (storage === null) return;
    const payload: DraftPayload = {
      source: doc.serialize(),
      savedAt: new Date().toISOString(),
      mode: opts.getMode?.() ?? 'wysiwyg',
    };
    try {
      storage.setItem(slotKey(key), JSON.stringify(payload));
      const rest = readIndex(storage).filter((meta) => meta.key !== key);
      rest.push({ key, savedAt: payload.savedAt, title: documentTitle(doc) });
      writeIndex(storage, rest);
      error = null;
      opts.onSave?.();
    } catch (cause) {
      error = cause instanceof Error ? cause : new Error(String(cause));
    }
  };

  const onChange = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(write, delay);
  };
  const off = doc.on('change', onChange);

  return {
    key,
    flush(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      write();
    },
    dispose(): void {
      off();
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    lastError: () => error,
  };
}
