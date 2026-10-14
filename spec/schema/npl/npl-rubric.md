# Schema — `npl-rubric`

Display-only weighted scoring rubric: one table of criteria, each with a
weight and a score, plus an overall figure that is stated or computed from
the weighted average. Source: NPL rubric blocks. The component renders the
table and owns no state; a criterion whose weight or score is missing or
non-numeric is marked, kept visible, and excluded from the average, and the
overall figure is marked (stated) or (computed) (Lit `NplRubric`,
`src/lit/npl/npl-rubric.ts`). Contract per conventions.md v0.6 and the
namespace recipe in `src/lit/npl/index.ts`.

## Authoring form

```html
<npl-rubric title="Code review">
  <npl-criterion name="Correctness" weight="3" score="4"></npl-criterion>
  <npl-criterion name="Style" weight="1" score="5"></npl-criterion>
  <npl-overall-score value="4.2"></npl-overall-score>
</npl-rubric>
```

Class-form alias (conventions Appendix A, npl namespace):
`.npl-rubric[data-title]`; criteria and the overall-score element match
either spelling (`.npl-criterion`, `.npl-overall-score`).

- `title`: string — default `` (empty). Rendered as the table caption and
  mirrored to `data-title` (dual-form contract; the mirror is deferred
  past parse via afterParse so a sem-source snapshot never sees runtime
  writes).
- Criteria — `:scope >` children matching `npl-criterion` / `.npl-criterion`,
  each carrying:
  - `name`: string — row label; falls back to the element's trimmed text.
  - `weight`: number — no default. Missing, blank or non-numeric ⇒ the
    criterion is marked and excluded from the average.
  - `score`: number — no default. Non-numeric ⇒ marked and excluded (a
    NaN must not reach the average).
- `npl-overall-score` (optional, one) — `value`: number — default: the
  element's trimmed text (`value` wins when both are present). States the
  overall score; when absent or non-numeric the component computes the
  weighted average — sum(weight · score) ÷ sum(weight) over the criteria
  with a numeric weight AND score (all-zero weights ⇒ no figure).
- `id`, `kind`, `tags` per the global attribute catalog.

## Rendered form

- Enhanced: `<npl-rubric>` itself (Lit `NplRubric` — light DOM, no shadow
  root): one `.npl-rubric-table` — caption `.npl-rubric-title` (when
  titled), a criterion row `.npl-rubric-criterion` per criterion
  (excluded rows keep their weight/score cells, gain `data-excluded` and
  a visible `.npl-rubric-flag` note), and a `.npl-rubric-overall` footer
  row whose `.npl-rubric-overall-value` is the stated or computed figure
  with a visible `.npl-rubric-source` marker (`(stated)` / `(computed)`,
  mirrored on `data-source`). Computed figures render at full precision.
  Once consumed, the authored criterion / overall-score children are
  replaced by the table — the table is then the only statement of the
  rubric.
- JS-off: block box from the npl section of `themes/_vocabulary.css`
  (`npl-rubric, .npl-rubric { display: block; }`). Nothing hidden,
  nothing generated — attribute-only criteria read as whitespace, a
  textual `overall_score` reads as plain prose.
