/**
 * Type surface for the media-prompt functions re-exported by
 * src/tools/adapters.js — they live in src/shared/media-prompt.js (the
 * adapters module itself is Node-side CLI code; browser code imports
 * the shared module directly).
 */
export {
  parseMediaPrompt,
  renderMediaPrompt,
  type MediaPromptFields,
  type MediaPromptParse,
} from '../shared/media-prompt.js';