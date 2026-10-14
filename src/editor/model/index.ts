/**
 * Editor document model — public surface (see types.ts for the contract).
 *
 * Lanes import from here:
 * ```ts
 * import { parse, tryParse, createDocument } from '../../editor/model/index.js';
 * import type { EditorDocument, EditOp, DocPos } from '../../editor/model/types.js';
 * ```
 */

export type {
  ApplyCheck,
  AttrNode,
  CdataNode,
  ChangeEvent,
  CommentNode,
  DocEvent,
  DocPos,
  DoctypeNode,
  EditOp,
  EditorDocument,
  EditorNode,
  EditorNodeKind,
  ElementNode,
  ElementSpec,
  HistoryChangeEvent,
  HistoryEntry,
  NodeCommon,
  NodeId,
  ParseIssue,
  ParseIssueCode,
  ParseResult,
  ProcessingInstructionNode,
  Selection,
  SerializeStyle,
  SourceRange,
  TextNode,
  Transaction,
  TransactionBuilder,
  TransactionOptions,
  TransactionSpan,
  Unsubscribe,
} from './types.js';

export { ModelError, RAW_TEXT_ELEMENTS, VOID_ELEMENTS } from './types.js';

export { parse, tryParse, createDocument, mapDecodedToRaw, mapRawToDecoded, EditorDocumentImpl } from './document.js';
export { emitDocument, emitSubtree, DEFAULT_STYLE } from './serialize.js';
export { NAMED_ENTITIES, decodeEntities, escapeAttr, escapeText } from './entities.js';
export { allocNodeId, resetIdCounter, seedIdCounter, parseSource } from './parse.js';
export type { ParseOutput } from './parse.js';
