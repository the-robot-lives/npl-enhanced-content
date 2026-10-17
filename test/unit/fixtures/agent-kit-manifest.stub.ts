/**
 * Stand-in for the virtual agent-kit tag→chunk manifest (the real one is
 * injected at build time by scripts/build.mjs; vite.config.ts aliases the
 * specifier here for the vitest tier only). The mapping only routes the
 * agent-kit-lazy entry's wiring specs, and the chunk it names does not
 * exist under the test runner — which is the point: every attempt
 * deterministically exercises the report-don't-throw failure path.
 */
const manifest: Record<string, string> = { 'agent-kit-issue': 'agent-kit-chunks/agent-kit-issue.js' };
export default manifest;
