/**
 * Type surface for src/shared/media-prompt.js (plain JS — the refresh
 * CLI runs it under Node directly; the Lit tier imports it too).
 */

export interface MediaPromptFields {
  prompt: string;
  negative?: string;
  aspect?: string;
  seed?: string;
}

export type MediaPromptParse =
  | { fields: MediaPromptFields; error?: undefined }
  | { fields?: undefined; error: string };

/** Parse `.media.prompt` key/value YAML; unknown keys, duplicate keys,
 *  empty values, a missing prompt, a non-integer seed or an unknown
 *  aspect yield `{ error }`. */
export function parseMediaPrompt(text: string): MediaPromptParse;

/** Canonical render: prompt, negative, aspect, seed; trailing newline. */
export function renderMediaPrompt(fields: Partial<MediaPromptFields>): string;