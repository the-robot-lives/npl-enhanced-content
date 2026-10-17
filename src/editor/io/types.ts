/**
 * editor/io — persistence + import/export types (EDITOR.md §12).
 *
 * The io lane is model-first: every byte that leaves the editor comes from
 * `doc.serialize()` (the model of record), never from the projected DOM.
 * The shapes here are the io ↔ shell contract: the shell owns the Open/Save
 * dialogs and calls into these surfaces; nothing in io opens UI on its own
 * beyond the v1 restore prompt (a `confirm()` ladder, injectable for tests).
 */

import type { EditorDocument } from '../model/types.js';

/** `EditorDocument` re-exported for io consumers (the io surface speaks in
 *  documents, so hosts need the type without reaching into the model). */
export type { EditorDocument };

// ── VFS-backed document store (§12 "EditorStore") ────────────────────────────

/** One entry of a store listing. `path` is store-absolute; `size` is the
 *  content length in UTF-16 code units for files. */
export interface FileInfo {
  name: string;
  kind: 'file' | 'dir';
  path: string;
  size?: number;
}

/**
 * A document store: open/save through the sem-shell VFS backends (memory,
 * localStorage, S3). Implemented in `store.ts` over `Vfs`
 * (`src/terminal/vfs.ts`) — the sync cache with a durable backend behind it.
 * All methods reject on failure (missing file, quota, auth); nothing in io
 * contacts a backend unless the host hands one in (local-first).
 */
export interface EditorStore {
  /** Store id for listings/announcements, e.g. `memory`, `local-storage`, `s3`. */
  readonly id: string;
  /** Content of the file at `path`; rejects when it is missing or a dir. */
  read(path: string): Promise<string>;
  /** Put (or replace) the document at `path`, creating directories. */
  write(path: string, source: string): Promise<void>;
  /** Entries of `dir` (default root), files and dirs. */
  list(dir?: string): Promise<FileInfo[]>;
  /** Remove the file (or subtree) at `path`; rejects when missing. */
  delete(path: string): Promise<void>;
}

// ── Drafts (localStorage autosave, §12) ──────────────────────────────────────

/** What one autosave slot holds (`semtext-editor:draft:<key>`). */
export interface DraftPayload {
  /** Full-document source (model serialization, byte-exact for untouched). */
  source: string;
  /** ISO timestamp of the save. */
  savedAt: string;
  /** Editor mode at save time (`wysiwyg | code | split`; informational). */
  mode: string;
}

/** One entry of the drafts index (`semtext-editor:drafts`). */
export interface DraftMeta {
  /** Autosave key (the per-doc key the host chose). */
  key: string;
  savedAt: string;
  /** Document title at save time (outline/label text, never HTML). */
  title: string;
}

// ── Export options ───────────────────────────────────────────────────────────

