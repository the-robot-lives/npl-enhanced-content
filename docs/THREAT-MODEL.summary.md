# Threat Model — Summary

Content-format repo: XHTML documents + one reader bundle + CLIs + static
nginx deploy. No server runtime, no DB. Crown jewels: format trust
(chrome mints nothing) and artifact integrity. Boundaries: untrusted
document → browser runtime; untrusted document → CLIs; build → consumer;
document → remote data (bind runtime + token).

## Register (details: THREAT-MODEL.md)

| ID | Sev | Component | Status |
|----|-----|-----------|--------|
| T-001 | High | Document script injection (Markdown path textContent-only; attribute URL schemes unchecked) | Partial |
| T-002 | Med | bind token in localStorage + URL fragment (state nonce, stripped) | Mitigated (residual via XSS) |
| T-003 | Med | bind fetches author-declared URLs (author trusted by design) | Partial |
| T-004 | Med | npm/CDN artifact integrity; no publish automation/SRI; 3 Dependabot findings | Open |
| T-005 | Med | CLIs parse untrusted XHTML via happy-dom/xslt-processor | Open (accepted for dev/agent tooling) |
| T-006 | Low | Bundle size creep | Mitigated (build:strict) |
| T-007 | Low | conventions.html drift | Mitigated (gen:conventions:check) |
| T-008 | Low | Remote docs in viewer/extension | Mitigated (opaque-origin jail) |
| T-009 | Low | Chart-tag tampering | Mitigated (CI-bot-only) |

5 mitigated · 2 partial · 2 open. Load-bearing opens: T-001 (attribute-URL
policy), T-004 (artifact integrity). Section files: threats/attack-surface.md ·
threats/supply-chain.md · threats/cli-input.md
