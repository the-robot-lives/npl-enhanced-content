# Schema — `npl-mood`

Affective-state chip (display-only). Source: NPL mood blocks — the block's
emoji and optional qualifier ride the `mood` attribute; its tone, context
and approach annotations ride optional children.

## Authoring form

Full form — the mood plus its optional tone, context and approach detail:

```html
<npl-mood mood="🙂 wistful">
  <div class="npl-mood-tone">restrained, unhurried</div>
  <div class="npl-mood-context">draft reply to a cold opener</div>
  <div class="npl-mood-approach">ask one concrete question</div>
</npl-mood>

<npl-mood mood="🔥 sharp"/>
```

The second block is the self-closing form — valid with no children at all
(a lone emoji is valid); the chip stands alone and no detail panel is
generated.

Class-form alias (conventions Appendix A, npl namespace):
`.npl-mood[data-mood]` — same dual-form contract as the sem-* tier,
`data-mood` wins when both spellings are present.

- `mood`: string — required. One emoji followed by an optional qualifier
  string, whitespace-separated (`"🙂 wistful"`); a lone emoji is valid.
  Displayed by `.npl-mood-chip` and mirrored to `data-mood` (dual-form
  contract; the mirror is deferred past parse via afterParse so a
  sem-source snapshot never sees runtime writes).
- `id`, `kind`, `tags` per the global attribute catalog — no bullet needed.

Children (all optional; none, or any subset, in any order):

- `.npl-mood-tone` — how the affect colors delivery.
- `.npl-mood-context` — what the mood attaches to.
- `.npl-mood-approach` — the stance the mood implies going forward.

## Rendered form

- Enhanced: `<npl-mood>` itself (Lit `NplMood` — light DOM, no shadow
  root; content stays searchable/copyable): a `.npl-mood-chip` span
  holding `.npl-mood-emoji` and, when a qualifier is authored,
  `.npl-mood-qualifier`. When any detail child is authored it is grouped
  once into a generated `.npl-mood-detail` panel (moved, never hidden or
  dropped — the sem-note body-wrap pattern); with no children the chip
  stands alone.
- JS-off: the block box from the npl section of `themes/_vocabulary.css`
  (`npl-mood, .npl-mood { display: block; }`). Nothing hidden, nothing
  generated — the mood attribute and any authored children read as plain
  prose.
