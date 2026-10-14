# Schema — `npl-hormones`

Contract per conventions.md v0.6 and the namespace recipe in
`src/lit/npl/index.ts`. Source block: the NPL synthetic-hormones pump
(NoizuPromptLingo `conventions/pumps.yaml`, `synthetic-hormones`).
Seven biochemical-analog hormones — Momentum MTM, Tension TNS,
Curiosity CRS, Confidence CNF, Affinity AFN, Fatigue FTG, Restlessness
RST — drawn as bars with delta arrows and threshold alerts.
Display-only: no events, no network, no timers.

## Authoring form

```html
<npl-hormones variant="panel">
  <panel>
    <h name="Momentum"     symbol="MTM" value="6"   delta="+2" trigger="Tests passed first try"></h>
    <h name="Tension"      symbol="TNS" value="3"   delta="0"  trigger="Complexity"></h>
    <h name="Restlessness" symbol="RST" value="8.5" delta="-1" trigger="Strategy failed"></h>
  </panel>
  <state>Productive tension</state>
  <triggered>RST threshold crossed</triggered>
  <alert hormone="RST" value="8.5" threshold="7" behavior="strategy-switch">
    Restlessness threshold crossed. Initiating plan-of-action.
  </alert>
</npl-hormones>
```

Class-form alias (conventions Appendix A, npl namespace):
`.npl-hormones[data-variant]` — same dual-form contract as the sem-* tier,
`data-variant` wins when both spellings are present.

- `variant`: `string` — default `panel`. `panel` renders one row per `h`
  plus the `state` and `triggered` lines; `bars` renders only the rows
  (the compact form); `alert` renders only the `alert` elements. Any
  other value falls back to `panel`.
- `<h>` (one per hormone, inside `panel`): `name` (`string`), `symbol`
  (`string`), `value` (`number`, range [-10, 10] — out-of-range values
  are clamped into range and the row is marked `data-clamped`, the raw
  text mirrored to `data-value`), `delta` (`number`; the sign drives the
  arrow: positive up `↑`, negative down `↓`, zero or absent flat `→`),
  `trigger` (`string`).
- `state`: child element — compound state description, rendered in the
  `panel` variant as the state line.
- `triggered`: child element — threshold behaviors activated, or `none`.
  A row is highlighted (`data-fired`) when this block names the hormone:
  by symbol (word match, so `RST` does not hit "first"), by name, or by
  its `trigger` text; `none` highlights nothing.
- `alert`: child elements — `hormone`, `value`, `threshold`, `behavior`
  attributes, body text as content. Rendered only by the `alert`
  variant.
- `id`, `kind`, `tags` per the global attribute catalog — no bullet
  needed.

## Rendered form

- Enhanced: `<npl-hormones>` itself (Lit `NplHormones` — light DOM, no
  shadow root; authored children stay in place; generated chrome uses
  `.npl-hormones-row`, `-symbol`, `-name`, `-bar`, `-fill`, `-value`,
  `-delta`, `-state`, `-triggered`, `-alert`, `-alert-head`,
  `-alert-body` classes; row state rides `data-variant`, `data-clamped`,
  `data-fired`, `data-delta`).
- JS-off: the block box from the npl section of `themes/_vocabulary.css`
  (`npl-hormones, .npl-hormones { display: block; }`). Nothing hidden,
  nothing generated — authored text reads as plain prose.
