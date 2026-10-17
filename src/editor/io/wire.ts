/**
 * editor/io/wire — glue between the shell's request events and io (§12).
 *
 * `<sem-editor>`'s toolbar emits `sem-edit-export-request` /
 * `sem-edit-open-request` (shell lane); the insert lane set the precedent of
 * a `wire*` consumer. `wireIo` follows it:
 *
 *  - export → serialize the model, flush the autosave slot, download
 *    `<title>.sem.html`, announce.
 *  - `sem-edit-copy-request` (io-defined, §0 namespace) → the clipboard
 *    ladder + announce.
 *  - open → collect draft + store listings, hand them to `onOpenRequest`
 *    (the shell owns dialogs); with no handler, the v1 fallback offers the
 *    newest draft via the restore prompt and calls `onRestore`.
 *  - Cmd/Ctrl+S on the surface → export (§7 parity row; the shell does not
 *    bind it — integrate: keep exactly one binder).
 *
 * One wire per document context; `openDocument` builds a new context, so
 * integrate re-wires (or re-points `ctx`) when the doc of record changes.
 */

import type { EditorDocument } from '../model/types.js';
import type { EditorContext } from '../shell/context.js';
import type { KeyValueStore } from '../../terminal/backends/local-storage.js';
import {
  attachAutosave,
  listDrafts,
  promptRestoreDraft,
  type AutosaveHandle,
  type RestorePromptOptions,
} from './autosave.js';
import { downloadSource, exportDocument, exportFilename } from './export.js';
import { copySource } from './clipboard.js';
import type { DraftMeta, DraftPayload, EditorStore, FileInfo } from './types.js';

/** io-defined request (§0 reserved `sem-edit-*` namespace). */
export const COPY_REQUEST_EVENT = 'sem-edit-copy-request';

export interface OpenRequestInfo {
  drafts: DraftMeta[];
  files: FileInfo[];
}

export interface WireIoOptions {
  ctx: EditorContext;
  /** Where request events are heard (default: `document`). */
  surface?: HTMLElement | Document | null;
  /** Autosave slot key; null/omitted disables autosave. */
  draftsKey?: string | null;
  /** Autosave/index storage; defaults to `localStorage`, null = memoryless. */
  storage?: KeyValueStore | null;
  /** Editor mode recorded in the draft payload. */
  getMode?: () => string;
  /** VFS store for Save/Open; optional — nothing is contacted without one. */
  store?: EditorStore | null;
  /** Store dir open listings read (default `/`). */
  storeDir?: string;
  /** Export filename override (default `<slugified title>.sem.html`). */
  filename?: (doc: EditorDocument) => string;
  /** Bind Cmd/Ctrl+S → export (default true). */
  saveKey?: boolean;
  /** Restore-prompt override (tests, custom dialogs). */
  confirm?: (message: string) => boolean;
  /** Called after a save the user can rely on: a successful export, or a
   *  successful autosave slot write. The shell clears its dirty state here. */
  onSaved?: () => void;
  /** Open surface: shell dialog hook (drafts + store files). */
  onOpenRequest?: (info: OpenRequestInfo) => void;
  /** v1 no-dialog fallback: restore the accepted draft. */
  onRestore?: (payload: DraftPayload) => void;
  /** Download override (tests). Default `downloadSource`. */
  download?: (source: string, filename: string) => void;
  /** Turn request listeners off selectively (all default on). */
  exportRequest?: boolean;
  copyEvent?: boolean;
  openRequest?: boolean;
}

export interface IoHandle {
  detach(): void;
  /** Force the pending debounced autosave write (also runs on export). */
  flushAutosave(): void;
  /** Serialize + download + announce; returns the exported source. */
  exportNow(): string;
  /** Clipboard ladder + announce. */
  copyNow(): Promise<boolean>;
  /** Collect drafts + store files; run the open surface/fallback. */
  openNow(): Promise<OpenRequestInfo>;
  readonly autosave: AutosaveHandle | null;
}

export function wireIo(opts: WireIoOptions): IoHandle {
  const { ctx } = opts;
  const surface: HTMLElement | Document = opts.surface ?? document;
  const detach: Array<() => void> = [];

  const storage = 'storage' in opts ? opts.storage : undefined;
  const effectiveStorage: KeyValueStore | null =
    storage === undefined
      ? ((globalThis as { localStorage?: KeyValueStore }).localStorage ?? null)
      : storage;
  const autosave: AutosaveHandle | null =
    opts.draftsKey != null
      ? attachAutosave(ctx.doc, {
          key: opts.draftsKey,
          storage: effectiveStorage,
          getMode: opts.getMode,
          onSave: opts.onSaved,
        })
      : null;

  const filenameFor = (): string =>
    (opts.filename ?? exportFilename)(ctx.doc);

  const exportNow = (): string => {
    const source = exportDocument(ctx.doc);
    autosave?.flush();
    const filename = filenameFor();
    try {
      (opts.download ?? downloadSource)(source, filename);
      opts.onSaved?.();
      ctx.announce(`Exported ${filename}`);
    } catch (cause) {
      ctx.announce(`Export failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    return source;
  };

  const copyNow = async (): Promise<boolean> => {
    const ok = await copySource(exportDocument(ctx.doc));
    ctx.announce(ok ? 'Copied document source' : 'Copy failed');
    return ok;
  };

  const openNow = async (): Promise<OpenRequestInfo> => {
    const drafts = autosave !== null && effectiveStorage !== null ? listDrafts(effectiveStorage) : [];
    let files: FileInfo[] = [];
    if (opts.store) {
      try {
        const entries = await opts.store.list(opts.storeDir ?? '/');
        files = entries.filter((f) => f.kind === 'file');
      } catch (cause) {
        ctx.announce(`Open failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
    const info: OpenRequestInfo = { drafts, files };
    if (opts.onOpenRequest) {
      opts.onOpenRequest(info);
    } else if (drafts.length > 0 && opts.onRestore) {
      const promptOpts: RestorePromptOptions | undefined =
        opts.confirm === undefined ? undefined : { confirm: opts.confirm };
      // This document's own slot first; otherwise the newest slot overall.
      const candidate = drafts.find((d) => d.key === autosave?.key) ?? drafts[0]!;
      if (effectiveStorage !== null) {
        const payload = promptRestoreDraft(candidate, effectiveStorage, promptOpts);
        if (payload !== null) opts.onRestore(payload);
      }
    }
    return info;
  };

  if (opts.exportRequest !== false) {
    const onExport = (): void => {
      exportNow();
    };
    surface.addEventListener('sem-edit-export-request', onExport);
    detach.push(() => surface.removeEventListener('sem-edit-export-request', onExport));
  }
  if (opts.copyEvent !== false) {
    const onCopy = (): void => {
      void copyNow();
    };
    surface.addEventListener(COPY_REQUEST_EVENT, onCopy);
    detach.push(() => surface.removeEventListener(COPY_REQUEST_EVENT, onCopy));
  }
  if (opts.openRequest !== false) {
    const onOpen = (): void => {
      void openNow();
    };
    surface.addEventListener('sem-edit-open-request', onOpen);
    detach.push(() => surface.removeEventListener('sem-edit-open-request', onOpen));
  }
  if (opts.saveKey !== false) {
    const onKey = (e: Event): void => {
      const ke = e as KeyboardEvent;
      if (!(ke.metaKey || ke.ctrlKey) || ke.key.toLowerCase() !== 's') return;
      ke.preventDefault();
      exportNow();
    };
    surface.addEventListener('keydown', onKey);
    detach.push(() => surface.removeEventListener('keydown', onKey));
  }

  return {
    detach(): void {
      for (const off of detach) off();
      detach.length = 0;
      autosave?.dispose();
    },
    flushAutosave(): void {
      autosave?.flush();
    },
    exportNow,
    copyNow,
    openNow,
    autosave,
  };
}
