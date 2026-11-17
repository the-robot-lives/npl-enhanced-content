# Schema — `agent-kit-ref`

An inline reference to a document or artifact record by UUID, whose authored text is the chip label and the JS-off view.

Contract per conventions.md and the namespace recipe in `src/lit/agent-kit/index.ts`. Prose is normative; the BDD source of truth for `test/unit/agent-kit-ref.test.ts`. A reference element, not an embed: it carries no record content and fetches nothing.

## Authoring form

```html
<agent-kit-ref kind="doc" id="0b5d6f0e-2c4a-4d57-9d2a-5a9f3c1e7b11">Release runbook</agent-kit-ref>
```

Class-form alias (conventions Appendix A, agent-kit namespace): `.agent-kit-ref[data-attr]` — same dual-form contract as the sem-* tier; `data-kind` wins when both spellings are present.

- `kind`: `token` — required. One of `doc` or `artifact`.
- `id`: `string` — required. The referenced record's UUID.
- `org`: `string` — the owning organization slug (informational).
- `project`: `string` — the project slug within the organization (informational).
- `tags` per the global attribute catalog — no bullet needed.

An invalid or missing `kind` or `id` is warned once and the reference stays inert prose.

## Rendered form

- Enhanced: the authored text becomes the chip. The element claims `role="link"` with `tabindex="0"` and an `aria-label` ("Open doc: Release runbook", or "Open doc 0b5d6f0e" when the label is empty). Activating it (click, Enter, Space) emits `agent-kit:ref-follow`. No fabricated nodes, so extraction is untouched.
- JS-off: the authored text reads as plain inline text. If the label is empty the host is expected to fall back to `doc <first 8 of id>` or `artifact <first 8 of id>`.
- The element fetches nothing and navigates nowhere. Following is the host's decision (a viewer modal, a page).

## Events

- `agent-kit:ref-follow`: bubbles + composed; `detail`: `{ kind: "doc" | "artifact", id: string }` (id lowercased) — fired on activation of a valid reference.
