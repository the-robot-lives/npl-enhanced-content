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
/* sem-question + sem-option — the quiz block (shipped 0.9.1, SEMTEX-009) */
export { SemQuestion, SemOption } from './lit/sem-question.js';
import './lit/sem-question.js';
export { SemDetails } from './lit/sem-details.js';
import './lit/sem-details.js';
export { SemReveal } from './lit/sem-reveal.js';
import './lit/sem-reveal.js';
/* reference-definition cards (spec/schema/sem-tag-def.md, sem-api-call.md) */
export { SemTagDef } from './lit/sem-tag-def.js';
import './lit/sem-tag-def.js';
export { SemApiCall } from './lit/sem-api-call.js';
import './lit/sem-api-call.js';
/* claim stubs — the CSS-first vocabulary tags (see src/lit/sem-stubs.ts);
 * registering them makes every sem tag answer customElements.get(). */
import './lit/sem-stubs.js';
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
/* sem-tldr — the namespace walking skeleton (spec/schema/sem-tldr.md):
 * a no-logic display stub in its own module; ships in the core bundle. */
export { SemTldr } from './lit/sem-tldr.js';
import './lit/sem-tldr.js';
/* sem-browser — chrome-like document window (lazy-first: the same
 * element ships as chunks/sem-browser.js for semtext-lazy.js pages;
 * src/lit/sem-browser.ts is the registration the lazy scanner keys on). */
export { SemBrowser, SEM_BROWSER_TAG } from './lit/sem-browser.js';
import './lit/sem-browser.js';
/* interactive containers (spec/schema/sem-workflow.md, sem-site-tree.md,
 * sem-file-tree.md) — lazy-first: each tag also ships as its own
 * chunks/<tag>.js via the lazy manifest; src/lit/<tag>.ts are the
 * registrations the scanner keys on (the trees share src/lit/sem-tree.ts,
 * which registers nothing and factors into a shared chunk). */
export { SemWorkflow, parseStepModels } from './lit/sem-workflow.js';
import './lit/sem-workflow.js';
export { SemSiteTree } from './lit/sem-site-tree.js';
import './lit/sem-site-tree.js';
export { SemFileTree } from './lit/sem-file-tree.js';
import './lit/sem-file-tree.js';
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
/* Family A — static knowledge/doc containers (spec/schema/sem-*.md):
 * no-logic display stubs, one module per contract file; ships in the
 * core bundle. Append-only section (parallel lanes touch this file). */
export { SemKb } from './lit/sem-kb.js';
import './lit/sem-kb.js';
export { SemRunbook } from './lit/sem-runbook.js';
import './lit/sem-runbook.js';
export { SemHowto } from './lit/sem-howto.js';
import './lit/sem-howto.js';
export { SemRequirement } from './lit/sem-requirement.js';
import './lit/sem-requirement.js';
export { SemThreatModel } from './lit/sem-threat-model.js';
import './lit/sem-threat-model.js';
export { SemGuardRails, SemGuardRail } from './lit/sem-guard-rails.js';
import './lit/sem-guard-rails.js';
export { SemMockup } from './lit/sem-mockup.js';
import './lit/sem-mockup.js';
export { SemRubric } from './lit/sem-rubric.js';
import './lit/sem-rubric.js';
export { SemEval } from './lit/sem-eval.js';
import './lit/sem-eval.js';
export { SemPhilosophy } from './lit/sem-philosophy.js';
import './lit/sem-philosophy.js';
export { SemSummary } from './lit/sem-summary.js';
import './lit/sem-summary.js';
export { SemPlan } from './lit/sem-plan.js';
import './lit/sem-plan.js';
export { SemTsgs, SemTsg } from './lit/sem-tsgs.js';
import './lit/sem-tsgs.js';
export { SemFaqs, SemFaq } from './lit/sem-faqs.js';
import './lit/sem-faqs.js';
export { SemChangelogs, SemChangelog } from './lit/sem-changelogs.js';
import './lit/sem-changelogs.js';

/* Core vanilla handlers — sem-views/progress/audiences, deep links, the
 * sem-source snapshot pass and the other elements no Lit component defines
 * (the former standalone fallback bundle's code, renamed 0.9.0). */
import {
  enhance as enhanceCore,
  type VanillaHandler,
} from './vanilla/index.js';
export type { VanillaHandler } from './vanilla/index.js';
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
} from './vanilla/index.js';
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

/* Late-mounted DOM (SPA islands, Hologram renders, async embeds) never
 * sees the one-shot DOMContentLoaded scan — every reference pane on a
 * hydrating host was invisible to it (0.9.1 defect class: views with no
 * tab bar, div-alias handlers never wired). The passes are idempotent on
 * marked DOM (`data-sem-upgraded` / chrome guards, including the
 * window-listener dedup in audience/target), so the cheapest correct
 * strategy is a debounced FULL re-scan whenever nodes enter the document.
 * Our own chrome insertions trigger one extra pass that finds nothing
 * unmarked and quiets — no loop. */
let rescanTimer = 0;
function rescan(): void {
  if (rescanTimer) return;
  rescanTimer = window.setTimeout(() => {
    rescanTimer = 0;
    enhanceCore(document);
    enhanceMdScan(document);
    enhanceReading(document);
  }, 50);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
  if (typeof MutationObserver !== 'undefined' && document.documentElement) {
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.addedNodes.length > 0) {
          rescan();
          return;
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
}
