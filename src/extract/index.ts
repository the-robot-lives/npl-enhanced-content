// 〚📦:𔕱𓯩𓲞𓖤〛 extract :: Extraction entry point: structural/plain-text reduction contract (SemText.extractRecords / SemText.extractText); normative contract spec/extraction.md.
/**
 * SemText — extraction entry point.
 *
 * Normative contract: spec/extraction.md
 *
 * Build note: this module is the intended entry for a second Vite lib
 * target emitting an IIFE global (`SemTextExtract`) at `dist/semtext-extract.js`,
 * so a portable document can load extraction with a classic <script> tag.
 * No runtime dependencies, no fetch, no top-level await.
 */

export type { SemRecord, RecordPair } from './records.js';
export {
  extractRecords,
  extractRecordPairs,
  extractText,
  renderRecordsAsText,
  deriveSummary
} from './records.js';
