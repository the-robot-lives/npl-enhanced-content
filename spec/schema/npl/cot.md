# Schema — `npl-cot`

Chain-of-thought block: the steps of an NPL `cot` block's `thought_process`
plus its outcome, folded in a native `<details>`. Lit component:
`src/lit/npl/npl-cot.ts`; toggle is native, so it works without JavaScript.

## Authoring form

Both display states — expanded (the default) and `collapsed`:

```html
<npl-cot>
  <sem-step>Pull the failing test's log lines for the window.</sem-step>
  <sem-step>The 502s cluster in one 30-second span, not across the hour.</sem-step>
  <div outcome>The upstream proxy restarted mid-window; retry, not a code fault.</div>
</npl-cot>

<npl-cot collapsed>
  <sem-step>Diff the two schema snapshots column by column.</sem-step>
  <sem-step>Only the column order differs; no column was dropped.</sem-step>
  <div outcome>Additive change; safe to migrate without a rollback.</div>
</npl-cot>
```

Class-form alias (conventions Appendix A, npl namespace):
`.npl-cot` on a block container, with the same bare `collapsed`
attribute — Appendix A keeps `collapsed` bare in both authoring forms
(sem-note, sem-reveal).

Children: the thought_process steps — each a step element (any element
child not marked as the outcome; `sem-step` is the conventional tag) — and
at most one outcome element: an authored child carrying the `outcome`
(or `data-outcome`) attribute, whatever its tag.

- `collapsed`: boolean — default `false`. Absent ⇒ the block starts expanded;
  present ⇒ it starts collapsed. Sets the **initial** open state of the native
  details; the user's own toggling is never re-forced. The runtime mirrors the
  boolean to `data-collapsed` (`"true"`/`"false"`) in `updated()` via
  afterParse — a write for CSS/extraction parity, never an input (the
  component reads the bare attribute only, like the sem tier's `collapsed`);
  the mirror is deferred past parse so a sem-source snapshot never sees
  runtime writes.
- `id`, `kind`, `tags` per the global attribute catalog — no bullet needed.

## Rendered form

- Enhanced: `<npl-cot>` itself (Lit `NplCot` — light DOM, no shadow root).
  Chrome is one native `details.npl-cot-details` with a
  `.npl-cot-summary` (`Chain of thought (N steps)`, N = authored step count)
  and a `.npl-cot-steps` host; the authored step elements are moved inside
  the details. The outcome element (if authored) is moved to a
  `.npl-cot-outcome-slot` **outside** the details, so the answer stays
  visible while the reasoning is collapsed. Collapsed content is hidden by
  the native details itself — no JS event handling behind the toggle.
- JS-off: the block box from the npl section of `themes/_vocabulary.css`
  (`npl-cot, .npl-cot { display: block; }`). Nothing hidden, nothing
  generated — the steps and the outcome read as plain prose blocks.
