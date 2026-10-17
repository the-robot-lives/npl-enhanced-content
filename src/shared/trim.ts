/**
 * Linear trailing-whitespace trim. Byte-identical to
 * `text.replace(/\s+$/, '')` — it removes exactly the longest suffix of
 * `\s` characters — but a backward per-character scan is O(n); the regex
 * form is polynomial on long whitespace runs (js/polynomial-redos,
 * CodeQL 2026-10-18: src/reading/code.ts, src/extract/records.ts).
 */
export function trimTrailingWs(text: string): string {
  let end = text.length;
  while (end > 0 && /\s/.test(text.charAt(end - 1))) end--;
  return end === text.length ? text : text.slice(0, end);
}
