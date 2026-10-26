# threats/cli-input — untrusted documents against local CLIs

Covers T-005 (local elevation via parser dependencies) and the CLI trust
contract. The CLIs are developer/agent tooling: they parse arbitrary
documents on the machine that runs them.

## The contract

| CLI | Input | Runtime |
|---|---|---|
| `bin/semtext.mjs` | files or stdin (`-`) | DOM parsing over the document |
| `bin/semtext-validate.mjs` | files/globs | `happy-dom` + `spec/schema/semtext.schema.json` |
| `bin/semtext-agent.mjs` | authored XHTML | `happy-dom`; `xslt-processor` for transform paths |

`happy-dom` and `xslt-processor` are **optional peer dependencies** (deliberate:
library consumers never load them — `dist/semtext.js` never imports them).
That keeps the attack surface off end-user pages and concentrates it on
machines that run the CLIs.

## Exposure

- A parser vulnerability in `happy-dom`/`xslt-processor` reachable from
  document content ⇒ local code execution for anyone running the CLIs on
  attacker-supplied documents. Agents do this routinely (validate-before-
  edit loops), so treat agent-run CLIs as the primary exposure, not
  humans.
- Exit codes are the security-relevant API: `semtext` is pipes-first
  (0 ok · 1 usage/parse · 2 no matches) — a parse "success" on hostile
  input is still full DOM instantiation.

## Controls in place

- Peer deps are optional and absent from the browser bundles (no
  document-driven CLI code ships to consumers).
- The validator's rules come only from `semtext.schema.json` — no code
  evaluation of document content in the rule layer.

## Gaps / acceptance

- No fuzzing of the parse path; dependency CVEs are the realistic vector
  (tracked via Dependabot, see [supply-chain.md](supply-chain.md)).
- **Accepted** while CLIs remain dev/agent tooling. Revisit if
  `semtext-validate` is ever wired to gate third-party uploads — at that
  point parsing moves to a sandboxed worker or a pinned, audited parser.
