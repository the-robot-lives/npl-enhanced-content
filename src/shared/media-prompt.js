/**
 * media-prompt — the `.media.prompt` YAML (media-tools v0.4) parser and
 * canonical renderer, shared by the refresh CLI (src/tools/adapters.js)
 * and the Lit tier (src/lit/sem-media-prompt.ts). One validator, two
 * consumers: the authoring form and the CLI can never drift.
 *
 * Plain JS by design: the refresh CLI runs under Node directly, and the
 * browser chunk must stay free of Node-only modules (adapters.js itself
 * carries a dynamic node:fs import for the styleguide adapter — never
 * import adapters.js from browser code).
 */

const MEDIA_KEYS = ['prompt', 'negative', 'aspect', 'seed'];
const MEDIA_ASPECTS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '21:9']);

/** Parse `key: value` lines; `#` comments and blank lines ignored. */
export function parseMediaPrompt(text) {
  const fields = {};
  for (const [i, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) return { error: `line ${i + 1}: not key: value — "${line}"` };
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (!MEDIA_KEYS.includes(key)) return { error: `line ${i + 1}: unknown key "${key}"` };
    if (key in fields) return { error: `line ${i + 1}: duplicate key "${key}"` };
    if (!value) return { error: `line ${i + 1}: empty value for "${key}"` };
    fields[key] = value;
  }
  if (!fields.prompt) return { error: 'missing prompt' };
  if (fields.aspect && !MEDIA_ASPECTS.has(fields.aspect)) return { error: `unknown aspect "${fields.aspect}"` };
  if (fields.seed && !/^\d+$/.test(fields.seed)) return { error: `seed must be an integer, got "${fields.seed}"` };
  return { fields };
}

/** Canonical render: prompt, negative, aspect, seed; trailing newline. */
export function renderMediaPrompt(fields) {
  return MEDIA_KEYS.filter((k) => fields[k] !== undefined)
    .map((k) => `${k}: ${fields[k]}`)
    .join('\n') + '\n';
}