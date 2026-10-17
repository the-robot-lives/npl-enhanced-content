# arch/decisions — key architectural decisions (brief)

**Why three tiers.** The bottom tier is the contract. Because every page must
work with zero JS (`.nojs.html` artifacts are first-class), the vocabulary
itself — not any script — carries the semantics. Higher tiers can only add
chrome, never move meaning out of the document. This is what makes
extraction invariant and machine-readability enforceable rather than
aspirational.

**Why tag form is canonical (v0.5).** Element names say what content *is*;
attributes are attributes, never `data-*`. A custom element with bare
attributes is what an XML consumer sees — one element, one attribute, no
class list to tokenise, no prefix to strip (conventions.md §8). The v0.4
class form survives as a mechanical compatibility alias (Appendix A) that
every tier keeps accepting.

**Why Lit-thin-wrappers-over-vanilla.** Zero React by policy. Lit
components upgrade authored elements in place, carry content in the light
DOM, and own only shadow-DOM chrome — so the upgrade path cannot fork the
document or break extraction. Any behavior the vanilla handlers provide
(the former fallback core, `src/vanilla/` since 0.9.0), the upgrade
supersedes rather than replaces.

**Why XHTML over Markdown.** The document is the data: qualifying
attributes on semantic children make every datum self-describing for agents
while remaining fully styled, human-readable HTML. Markdown would need a
preprocessing layer to carry the same structure — the landing thesis of the
project.

**Why extraction is a test-enforced contract.** `E(D) = E(R(D)) = E(I(R(D)))`
is pinned by e2e scenarios across JS-off, view-as, reader controls, and both
authoring forms — so any change that lets chrome leak into records fails CI,
not consumers.

→ *Invariant details: [extraction.md](extraction.md) · tier mechanics:
[vocabulary.md](vocabulary.md)*
