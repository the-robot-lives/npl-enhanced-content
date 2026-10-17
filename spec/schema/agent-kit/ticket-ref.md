# Schema — `agent-kit-ticket-ref`

> Inline reference to a ticket record, shipped with the ticket family
> (see `tickets.md` for the record tags). Not a ticket record — a link
> affordance. Mirrors the sem-* prose contracts in `spec/schema/*.md`:
> prose is normative — changes here precede spec changes precede code,
> and the file is the BDD source of truth for
> `test/unit/agent-kit-tickets.test.ts`.

Contract per conventions.md and the namespace recipe in
`src/lit/agent-kit/index.ts`.

## Authoring form

```html
<agent-kit-ticket-ref key="AKIT-001">extractor drops class-form parts</agent-kit-ticket-ref>
```

Class-form alias (conventions Appendix A, agent-kit namespace):
`.agent-kit-ticket-ref[data-attr]` — same dual-form contract as the
sem-* tier, `data-ticket-ref` wins when both spellings are present.

- `key`: `string` — the referenced ticket's key; required, ticket-key
  shape (`/^[A-Z0-9]{1,6}-\d{3,}$/` — e.g. `AKIT-001`). An invalid key
  is warned once and the reference stays inert prose.
- `org`: `string` — the owning organization slug (informational; the
  join is the key).
- `project`: `string` — the project slug within the organization.
- `id`, `kind`, `tags` per the global attribute catalog — no bullet
  needed.

## Reference attributes

The quartet above matches the schema's `reference` defPreset; the live
join between this element and its target card is the `key` — the card
publishes a `#akit-ticket-<KEY>` anchor.

## Rendered form

- Enhanced: the authored text becomes the chip; the element claims
  `role="link"` with `tabindex="0"` and an `aria-label`
  ("Go to ticket AKIT-001: <text>"), and activating it (click, Enter,
  Space) scrolls the referenced ticket card into view via its anchor,
  emitting `agent-kit:ticket-ref-follow`. No fabricated nodes — the
  affordance is behavior on the element itself, so extraction is
  untouched by construction.
- JS-off: the authored text reads as plain text in the block box from
  the agent-kit section of `themes/_vocabulary.css`.

## Events

- `agent-kit:ticket-ref-follow`: bubbles + composed; `detail`:
  `{ key: string }` — fired after the referenced card scrolls into
  view.
