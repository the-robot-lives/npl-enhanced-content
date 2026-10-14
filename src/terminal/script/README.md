# script — in-view demo playback for shells

The `start-script` attribute turns a terminal into a self-playing demo: it
waits until the element is actually looked at, types the script into the
real DOM (input events, form submits, TUI keys), pauses out of view, and
hands the keyboard back on Escape. Built for the landing page's tabs, but
any SemText element that can supply a driver can adopt it.

## Files

| file | job |
|---|---|
| `demo-format.ts` | the line-format grammar -> `DemoStep[]` (+ `resolveScriptValue`) |
| `landing-scripts.ts` | the four named landing demos (`landing-code`/`landing-tui`/`landing-cli`) |
| `demo-runner.ts` | plays steps through a `DemoDriver` (typing, jitter, `@expect`) |
| `pausable-scheduler.ts` | timer queue that can freeze and resume mid-script |
| `in-view.ts` | IntersectionObserver + tab-visibility watches (both injectable) |
| `autostart.ts` | `attachAutostart()` — the attribute contract end to end |

## Attribute forms

    <sem-shell start-script="landing-code">   named demo (landing-scripts.ts)
    <sem-shell start-script="[...]">          JSON — same as the `script` attribute
    <sem-shell start-script="$ bat demo/welcome.html&#10;@expect Welcome">
                                              inline line-format script

Resolution order: named, JSON, inline. Blank -> nothing plays.

## Line format

    # text      heading — printed instantly as a comment
    ## text     description — printed instantly as a comment
    $ command   typed char by char, then executed, then a beat
    @type text  typed char by char, not executed
    @input text alias of @type (tabbing-on compatibility)
    @key TOKEN  `<Down>` `<Esc>` `<Enter>` ... or bare chars (`@key q`, `@key :q`)
    @sleep N.N  pause N.N seconds
    @expect s   assert the transcript contains s; a miss prints and halts
    @prompt s   prints s and pauses (web demos cannot block on a tty)
    @clear      documented no-op (no clear command yet)

Parsing is lenient: an unknown directive becomes a comment, never a throw.

## Playback contract

- **Starts once**, the first time the element is >= half in view
  (IntersectionObserver threshold 0.5). No observer in the environment ->
  starts immediately rather than never.
- **Pauses** whenever the element falls below the hold threshold (0.05) or
  the tab hides; **resumes** with the remaining delays intact when both
  clear. The pausable scheduler makes pause/resume free mid-key.
- **Escape** (keydown on the element) stops the run and releases the
  input; the demo never restarts after stopping.
- **prefers-reduced-motion** plays everything at full speed — no per-char
  typing, no waits.
- An `@expect` miss prints a comment naming the miss and halts with
  `onFail` — a demo that lies about its subject must not keep playing.
- While the run holds the input, `onRunning(true)` fires; hosts should
  make the input read-only and hand focus back on `onRunning(false)`.

## Adopting

The only integration point is `attachAutostart(element, driver, options)`
from `autostart.ts`; dispose the returned handle in
`disconnectedCallback`. A driver is seven small functions (see
`DemoDriver` in `demo-runner.ts`); `sem-shell` builds one from DOM events
alone — it reaches into no private terminal state. Later lanes can give
`sem-browser` or the ExampleViewer the same treatment with their own
driver; the runner, scheduler, and watches are shared.

## Testing

Every timer goes through the injected clock, every random through
`rand()`, and the observer through an injected constructor — unit tests
drive the whole choreography deterministically (see
`test/unit/script-*.test.ts`).
