# threats/attack-surface — enumeration

Method: STRIDE across every ingress, store, and egress of the shipped
repo. Grounded in [PROJ-ARCH.md](../PROJ-ARCH.md) (components, CI ladder)
and [PROJ-LAYOUT.md](../PROJ-LAYOUT.md) (implementing directories);
verified against code 2026-10-26.

## Ingresses

| Surface | Path | Trust assumption | Notes |
|---|---|---|---|
| Browser rendering | `dist/semtext.js` + document XHTML | Document = untrusted input | Lit templates (escaped) for elements; `src/vanilla/` + `src/reading/` handlers manipulate DOM directly |
| Markdown path | `src/md/parse.ts` | Raw Markdown = untrusted | Built with `createElement`/`textContent` only — no `innerHTML` in the parser, so raw HTML in Markdown is **never** rendered (stated in the file header, verified 2026-10-26) |
| Attribute parameters | `view-as`, `status`, `controls`, `href`, `src`, … | Untrusted | Values drive behavior switches; URL-valued attributes are not centrally scheme-checked (T-001) |
| CLIs | `bin/semtext.mjs`, `bin/semtext-validate.mjs`, `bin/semtext-agent.mjs` | Input documents untrusted | Parse via `happy-dom` (+ `xslt-processor`); see [cli-input.md](cli-input.md) (T-005) |
| bind runtime | `src/lit/bind.ts` | Document-declared URLs; agentonomi auth | `new URL(value, document-base)`; auth route origin-checked (`AGENTONOMI_ORIGIN`); token via popup `postMessage` or `#access_token` fragment with state nonce (T-002, T-003) |
| viewer / extension | `viewer/jail.html`, `extension/jail.html` | Remote documents hostile | `sandbox` iframe without `allow-same-origin` → opaque origin; extension page sandboxed via manifest CSP; remote resources passive (T-008) |

## Stores

| Store | Contents | Boundary |
|---|---|---|
| `localStorage["semtext.bind.token"]` | Guardian access token, per origin | Readable by any same-origin script — XSS = token theft (T-002) |
| nginx-served `dist/` | site, demo, spec, themes, bundles | Immutable-in-deploy; written only by CI `build-push` |
| npm package `semtext` | `dist`, `themes`, `bin`, `src/validate`, `spec/schema` | Published artifact — integrity path undocumented (T-004) |
| CDN (`cdn.semtext.dev`) | themes + bundles | Gated `publish-cdn` CI job (`CDN_PUBLISH` var) |

## Egresses

| Egress | Trigger | Control |
|---|---|---|
| bind fetch to document-declared URLs | document viewed with script | By design; auth origin-checked (T-003) |
| GitHub Actions → image registry / chart repo / CDN | push to `main` | CI-bot identity; `bump-chart` commits are the only chart-tag writer (T-009) |
| Dependabot-reported dependency risk | build/CLI runtime | 3 findings on default branch (1 high, 2 moderate) at sweep time — see [supply-chain.md](supply-chain.md) |

## Explicit non-surfaces

No server-side app runtime, no database, no user accounts, no cookies —
the deployed site is static. Anything that changes this (comments, auth on
semtext.dev, upload endpoints) must add register entries here first.
