/**
 * SemText — the one bundle (spec v0.6, three-file surface).
 *
 * `dist/semtext.js` — one classic IIFE, global `SemText`. This entry:
 *
 *   1. Defines every custom element (src/lit/*): sem-note, sem-facts,
 *      sem-details, sem-code, sem-references, sem-properties, sem-reader,
 *      sem-table, sem-source, sem-md, sem-data-visualizer, sem-browser,
 *      and the interaction stubs (sem-artifact-card, sem-provider-picker,
 *      sem-quota-meter).
 *   2. Re-exports the extraction contract (src/extract/*) and the shared
 *      foundation the npm surface documents — the former
 *      `SemTextExtract` / `SemTextMd` / `SemTextReading` /
 *      `SemTextFallback` globals are all names on this one global now.
 *   3. On DOMContentLoaded runs the vanilla handlers over the document,
 *      in load-bearing order — core (snapshot FIRST), then Markdown,
 *      then prose reading — for the elements no component defines and
 *      for class-alias authoring. Handlers skip anything already claimed
 *      (`data-sem-upgraded`), so component-owned elements are untouched.
 *
 * No smaller script falls back to: with the script absent or JS off, the
 * document reads as plain prose and extraction is unavailable.
 */

/* Shared foundation */
export { SemElement } from './lit/base.js';
export { parseTokens, elementTokens } from './shared/tokens.js';
export { mulberry32, shuffle, resolveSeed, randomFor } from './shared/rng.js';
export {
  parseProfiles,
  buildClosure,
  closureFor,
  matches,
  warn,
} from './shared/audience.js';
export type { Profile, AudienceClosure } from './shared/audience.js';
export {
  hashSegments,
  bareSegments,
  getParam,
  setParam,
  readLocal,
  writeLocal,
  removeLocal,
} from './shared/state.js';

/* Extraction — the former dist/semtext-extract.js (global SemTextExtract) */
export type { SemRecord } from './extract/records.js';
export {
  extractRecords,
  extractText,
  renderRecordsAsText,
  deriveSummary,
} from './extract/records.js';

/* Elements — importing registers the custom element */
export { SemNote } from './lit/sem-note.js';
import './lit/sem-note.js';
export { SemFacts } from './lit/sem-facts.js';
import './lit/sem-facts.js';
export { SemDetails } from './lit/sem-details.js';
import './lit/sem-details.js';
/* R/W1 prose elements — thin wrappers over src/reading/* */
export { SemCode } from './lit/sem-code.js';
import './lit/sem-code.js';
export { SemReferences } from './lit/sem-references.js';
import './lit/sem-references.js';
export { SemProperties } from './lit/sem-properties.js';
import './lit/sem-properties.js';
/* R/W2 chrome + data — thin wrappers over src/reading/* */
export { SemReader } from './lit/sem-reader.js';
import './lit/sem-reader.js';
export { SemTable } from './lit/sem-table.js';
import './lit/sem-table.js';
/* sem-source — rendered/source section wrapper (thin wrapper over src/reading/source.ts) */
export { SemSource } from './lit/sem-source.js';
import './lit/sem-source.js';
/* R/W2.2 Markdown block — thin wrapper over src/md/* */
export { SemMd } from './lit/sem-md.js';
import './lit/sem-md.js';
/* sem-browser — chrome-like document window (lazy-first: the same
 * element ships as chunks/sem-browser.js for semtext-lazy.js pages;
 * src/lit/sem-browser.ts is the registration the lazy scanner keys on). */
export { SemBrowser, SEM_BROWSER_TAG } from './lit/sem-browser.js';
import './lit/sem-browser.js';
/* Data visualizer — inline data sources (spec/data-visualizer.md) */
export { SemDataVisualizer } from './lit/sem-data-visualizer.js';
import './lit/sem-data-visualizer.js';
export {
  parseGfmTable,
  inferSchema,
  parseViews,
  resolveView,
  visibleColumns,
} from './data/table.js';
export type { ColumnSchema, ColumnType, TableData, ViewSpec, SourceParse } from './data/table.js';
/* sem-shell / sem-terminal — NOT in the core bundle: the interactive
 * shell (src/shell/*) and the reusable terminal core (src/terminal/*:
 * plugins attribute, manifest loading, dispatch, the POSIX plugin surface,
 * scripted playback and the flashcard TUI) are demo/agent tooling, not
 * document vocabulary. They ship as their own standalone bundle,
 * dist/semtext-js-shell.js (IIFE global SemTextShell, entry src/js-shell.ts,
 * mapped in dist/semtext-js-shell-manifest.json) so semtext.js never grows
 * for them. Only the type surface is re-exported here — type-only exports
 * are erased at build and cost the core bundle nothing. */
export type {
  ShellState,
  ShellLine,
  ShellLineKind,
  ShellAction,
  WindowAction,
  CommandContext,
  CommandSpec,
  PluginManifest,
  PluginFileEntry,
  MountResult,
  ExecResult,
} from './terminal/terminal-core.js';
export type { PlaybackStep, PlaybackDriver, PlaybackHandle } from './terminal/playback.js';
export type { TuiCard, TuiState, TuiAction } from './terminal/tui.js';
export type { ShellStage, ShellRedirect, ParsedLine } from './terminal/sh-parse.js';
/* agent-kit upsell stubs — NOT in the core bundle any more: sem-chat,
 * sem-review-canvas, sem-media-gallery, sem-upload-drop and
 * sem-artifact-card each ship as their own lazy chunk, mapped in
 * dist/semtext-manifest.json and loaded on demand by semtext-lazy.js. */

/* The npl-* namespace does NOT live here: it ships as its own bundle
 * (dist/npl.js, entry src/npl.ts) and its own lazy loader
 * (dist/npl-lazy.js). Core keeps only the sem-* components. */

/* agent-kit upsell stubs — interaction-only, fixture-fed, zero network */
export { SemArtifactCard } from './lit/sem-artifact-card.js';
import './lit/sem-artifact-card.js';
/* App chrome — provider selection (ids + labels only; no keys, no URLs) */
export { SemProviderPicker, PROVIDERS, DEFAULT_PROVIDER_ID } from './lit/sem-provider-picker.js';
export type { ProviderId } from './lit/sem-provider-picker.js';
import './lit/sem-provider-picker.js';
/* sem-quota-meter — rolling usage window (provider caps); pure display */
export { SemQuotaMeter } from './lit/sem-quota-meter.js';
import './lit/sem-quota-meter.js';

/* Vanilla handlers — the former dist/semtext-fallback.js,
 * dist/semtext-md.js and dist/semtext-reading.js entry points. */
import {
  enhance as enhanceCore,
  type FallbackHandler,
} from './fallback/index.js';
export type { FallbackHandler } from './fallback/index.js';
export {
  enhanceSource,
  enhanceAttrs,
  enhanceFacts,
  enhanceDetails,
  enhanceNote,
  enhanceProperties,
  enhanceViews,
  enhanceReveal,
  enhanceProgress,
  enhanceAudience,
  enhanceTarget,
} from './fallback/index.js';
import { enhance as enhanceMdScan } from './md/index.js';
export { enhanceMd, enhanceMdElement, normalizeMd, parseBlocks, safeUrl } from './md/index.js';
import { enhance as enhanceReading } from './reading/index.js';
export {
  enhanceCodeElement,
  enhanceReferencesElement,
  enhanceGlossaryElement,
  enhanceTableElement,
  enhanceDataVisualizerElement,
  enhanceSourceElement,
  enhanceReaderElement,
  disposeReaderElement,
} from './reading/index.js';
export { enhanceCore, enhanceMdScan as enhanceMdDocument, enhanceReading };

function init(): void {
  // Load-bearing order: the core's sem-source snapshot pass must precede
  // every handler that adds chrome; the reader is generated last.
  enhanceCore(document);
  enhanceMdScan(document);
  enhanceReading(document);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}
