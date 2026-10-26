# threats/supply-chain — build → consumer integrity

Covers T-004 (artifact integrity) and the dependency posture behind
T-005/T-006. Pipeline facts from `.github/workflows/ci.yml` (verified
2026-10-26).

## Path from build to consumer

1. **CI ladder** — `unit` (vitest) → `test` (cypress + `build:strict`
   budget) → `build-push` (Docker image, `main` only) → `bump-chart`
   (CI-bot commit; the only writer of chart tags) → ArgoCD auto-sync.
   A separate `publish-cdn` job runs when the `CDN_PUBLISH` repo variable
   is set; `nightly.yml` runs off-cycle; `ci-timing` instruments PRs.
2. **Image** — nginx serves `dist/{site,demo,spec,themes}` + the
   `semtext*.js` bundles. Static only; no server-side templating, so the
   classic RCE-in-templating class does not exist here.
3. **npm package** — `semtext` ships `dist`, `themes`, `bin`,
   `src/validate`, `spec/schema` from the checkout. No publish workflow
   exists in `.github/` — publishing is a manual act, and there is **no
   documented provenance/signing step** for npm or the CDN (T-004, open).

## Gaps

- No `npm publish` automation ⇒ no enforced link between a passing CI SHA
  and the published tarball; provenance is manual discipline today.
- No SRI hashes published for CDN consumers of `dist/semtext.js` / themes.
- Dependabot reported 3 vulnerabilities on the default branch at sweep
  time (1 high, 2 moderate) — triage them before the next release train;
  they gate nothing today.

## Existing controls

- Budget gate (`build:strict`) blocks oversized/regressed reader bundles
  from merging (T-006).
- `gen:conventions:check` blocks spec/HTML drift (T-007).
- Chart tags written only by the CI-bot `bump-chart` commit (T-009); hand
  edits are forbidden by policy (`CONTRIBUTING.md`).

## Recommendation order

1. Triage the open Dependabot findings (owner: maintainer, next train).
2. Document (or automate) the npm publish step + provenance when the
   package gains external consumers.
3. Consider SRI or a signed manifest for CDN assets once semtext.dev is
   no longer a placeholder.
