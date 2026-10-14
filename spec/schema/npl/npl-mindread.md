# Schema — `npl-mindread`

Theory-of-mind reading of the other party — the display upgrade of the NPL
`<npl-mindread>` block (NoizuPromptLingo `npl/npl-full.md` §3.6 Social
Cognition). Source block:

```html
<npl-mindread>
  <subject>{who — user, collaborator, agent name}</subject>
  <signals>
    <signal type="tone|pattern|omission|context|contradiction|expertise">{observed evidence}</signal>
  </signals>
  <inferred>
    <motive>{goal behind the stated request}</motive>
    <mood>{emotional state}</mood>
    <cognitive>{how they're thinking}</cognitive>
    <unspoken>{what they need but haven't articulated}</unspoken>
  </inferred>
  <adaptation>{concrete behavioral change}</adaptation>
</npl-mindread>
```

Contract per conventions.md v0.6 and the namespace recipe in
`src/lit/npl/index.ts`. Display-only: no events, no interactivity.

## Authoring form

```html
<npl-mindread confidence="0.7">
  <subject>User</subject>
  <signals><signal type="tone">Terse fragments — formality dropped.</signal></signals>
  <inferred>
    <motive>Quick resolution over thoroughness.</motive>
    <mood>😤 Pressured, time-crunched</mood>
    <cognitive>Execution mode — solutions, not options.</cognitive>
    <unspoken>Reassurance that it'll be ready.</unspoken>
  </inferred>
  <adaptation>Working solution first; edge cases deferred. Short replies.</adaptation>
</npl-mindread>
```

Class-form alias (conventions Appendix A, npl namespace):
`.npl-mindread[data-confidence]` — same dual-form contract as the sem-*
tier, `data-confidence` wins when both spellings are present.

- `confidence`: `number` — optional, default `<absent>` — a theory-of-mind
  reading is a guess until corrected; authored `0..1`. Out-of-range values
  are **clamped** into `[0,1]` (a non-numeric authoring clamps to `0`), and
  the host is **marked**: `data-confidence` carries the clamped value,
  `data-confidence-out-of-range` the verbatim authored value, and the
  meter gains a `npl-mindread-confidence-out` note.

Child grammar (all optional; rendered only when authored): `subject`,
`signals` (containing `signal` elements, each with a `type` attribute from
the NPL vocabulary `tone | pattern | omission | context | contradiction |
expertise`), `inferred` (containing `motive`, `mood`, `cognitive`,
`unspoken`), `adaptation`. A `signal` whose `type` is unknown — or
missing — renders with its chip marked `npl-mindread-signal-unknown`
(plus `data-unknown-signal-type` on the signal and an author-facing
`warn`): shown, never dropped.
`id`, `kind`, `tags` per the global attribute catalog — no bullet needed.

## Rendered form

- Enhanced: `<npl-mindread>` itself (Lit `NplMindread` — light DOM, no
  shadow root; content stays searchable/copyable). Labelled sections in
  canonical order — **subject, signals, inferred, adaptation** — each
  authored section relocated behind a generated heading
  (`.npl-mindread-heading`), and a confidence meter
  (`.npl-mindread-confidence`, with `.npl-mindread-confidence-label` /
  `-value` / optional `-out`) above them when `confidence` is present.
  Every authored `signal` gets a type chip (`.npl-mindread-signal-type`,
  unknown types gain `npl-mindread-signal-unknown`); every authored
  inferred field gets a label (`.npl-mindread-field-label`). All
  generated chrome carries `data-npl-generated`. Authored content is
  never hidden or rewritten — the component only adds labels and puts
  the sections in order.
- JS-off: the block box from the npl section of `themes/_vocabulary.css`
  (`npl-mindread, .npl-mindread { display: block; }`). Nothing hidden,
  nothing generated — authored text reads as plain prose.
