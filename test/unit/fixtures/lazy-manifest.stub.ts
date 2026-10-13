/**
 * Stand-in for the virtual tag→chunk manifest (the real one is injected at
 * build time by scripts/build.mjs; vite.config.ts aliases the specifier
 * here for the vitest tier only). The mapping only routes the lazy entry's
 * wiring specs, and the chunk it names does not exist under the test
 * runner — which is the point: every attempt deterministically exercises
 * the report-don't-throw failure path.
 */
const manifest: Record<string, string> = { 'sem-note': 'chunks/sem-note.js' };
export default manifest;
/** Build-time cache-bust token; the real one is a content hash. */
export const BUILD_VERSION = 'test';
