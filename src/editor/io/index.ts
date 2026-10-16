/**
 * editor/io — public surface (EDITOR.md §12).
 *
 * ```ts
 * import { exportDocument, exportFilename, downloadSource } from '.../editor/io/index.js';
 * import { attachAutosave, listDrafts, promptRestoreDraft } from '.../editor/io/index.js';
 * import { memoryStore, localStorageStore, s3Store } from '.../editor/io/index.js';
 * import { importSource, importSanitized, readFileText } from '.../editor/io/index.js';
 * import { wireIo } from '.../editor/io/index.js';
 * ```
 */

export type { DraftMeta, DraftPayload, EditorDocument, EditorStore, FileInfo } from './types.js';

export {
  SEM_HTML_EXT,
  downloadSource,
  exportDocument,
  exportFilename,
  fragmentMarker,
  isSemHtmlFilename,
  type ExportOptions,
} from './export.js';

export { copySource } from './clipboard.js';

export {
  AUTOSAVE_DEBOUNCE_MS,
  DRAFTS_INDEX_KEY,
  DRAFT_KEY_PREFIX,
  attachAutosave,
  defaultStorage,
  deleteDraft,
  listDrafts,
  loadDraft,
  promptRestoreDraft,
  type AutosaveHandle,
  type AutosaveOptions,
  type RestorePromptOptions,
} from './autosave.js';

export { localStorageStore, memoryStore, s3Store, vfsEditorStore, type StoreOptions } from './store.js';

export { importSanitized, importSource, readFileText, type SanitizedImport } from './import.js';

export {
  COPY_REQUEST_EVENT,
  wireIo,
  type IoHandle,
  type OpenRequestInfo,
  type WireIoOptions,
} from './wire.js';
