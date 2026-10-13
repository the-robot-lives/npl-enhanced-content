# Terminal Core v2 — Epoch 2 architecture

Status: **design (approved direction, not implemented)** · Owner: terminal lane ·
Drafted 2026-10-14 · Amended 2026-10-14 (canvas-everywhere renderer; 256 KB shell
budget — see Decisions) · Companion to `src/terminal/PLUGINS.md` (the v1 plugin
contract, which this design freezes) and `ROADMAP.md` (invariants, budgets).

This document specifies the Epoch 2 rebuild of the `sem-shell` /
`sem-terminal` internals: a real terminal — cell-grid screen model, cooked/raw
line discipline, full-screen apps, a canvas display driver, a Lit-drawn
virtual scrollbar, selection and clipboard, OSC-driven window titles and tabs,
and env/direnv semantics. It absorbs the Epoch 1 lanes as given primitives:
the ANSI/VT parser (`src/terminal/ansi/`, ansi lane), the shared window
chrome (`src/shared/window-chrome.ts`, sem-browser lane), the script runner
with in-view autostart and typed playback (`src/terminal/script/`,
script-runner lane), and the card/subsection/toc render commands
(render-card lane). No code ships with this document; it is the contract the
Epoch 2 implementation is written against.

> **Decisions (user, 2026-10-14).**
> 1. **Canvas everywhere.** The canvas driver is the one rendering path and is
>    bundled into `semtext-js-shell.js` — no `semtext-shell-canvas.js` chunk, no
>    `renderer="canvas"` opt-in. One classic IIFE ⇒ no runtime fetch ⇒ invariant
>    1 holds on file:// by construction. The DOM remains only as the hidden,
>    synchronised accessibility + find-in-page + copy mirror, plus the authored
>    JS-off static transcript (unchanged). §§1, 3, 8, 9, 13, 14, 16, 17 amended.
> 2. **Shell bundle budget = 256 KB raw** (the user's number; absorbs the canvas
>    driver). §13.1 and the `ROADMAP.md` size-budget table updated; every other
>    budget unchanged.

## 1. Scope and invariants

**In scope:** everything between "a key press arrives" and "pixels / DOM text
appear", plus the shell services apps call (screen, input routing, title,
env). **Out of scope:** new commands (Epoch 3: nano, find, sed), the demo
runner's script format (script-runner lane owns the port), the SemText
document renderers, and any server component.

The ROADMAP's non-negotiable invariants apply unchanged, and three of them
shape this design hard enough to restate:

1. **Canonical artifact = standalone XHTML, IIFE classic scripts, no runtime
   fetch, file:// double-click works.** Every v2 capability must fit the
   `semtext-js-shell.js` IIFE bundle — and since the 2026-10-14 decision they
   all do by construction: the canvas driver is compiled into the same classic
   bundle (§8.4), so there is no runtime fetch, no dynamic import, and file://
   works unchanged. No v2 capability ships as a separate opt-in chunk.
2. **Light DOM for content, shadow DOM for chrome only.** A canvas viewport
   is chrome; the *text* stays content. Canvas paints the pixels; the DOM
   survives solely as the hidden, synchronised accessibility + find-in-page +
   copy mirror (§8.1, §9) — nothing a user could select or copy may exist
   only inside a canvas, so the mirror is load-bearing, not a fallback.
3. **JS-off documents stay readable; the zero-JS contract is untouched.** The
   authored static transcript (a `role="log"` div with past lines, no input
   element — see `web/demo/shell.html`) is replaced on first connect exactly
   as today; v2 changes what happens *after* replacement only.

Two more contracts are frozen by this document:

- **The plugin API does not break.** `CommandSpec`, `CommandContext`
  (`args/stdin/vfs/state/color/commands/out/err/emit/exit`), completion
  (`CompletionContext`), `ShellState`, manifests, CDN/integrity rules — all
   as in `PLUGINS.md`. v2 additions are optional fields. §14 states the
   compat matrix explicitly.
- **The transcript API does not break.** `ShellLine` / `ExecResult.lines`
  remain the programmatic transcript; v1 tests assert against them.

## 2. Where v1 is today — and why it ends

Current state (all under `src/`):

| Concern | v1 implementation | Ceiling |
|---|---|---|
| Rendering | `sem-terminal.ts` renders `lines[]` as light-DOM divs via Lit text bindings | O(lines) DOM; no cell-level cursor, no alt screen |
| Line editing | a real `<input>` element owns caret, selection, IME | no in-component cursor; browser owns key interpretation; full-screen apps impossible |
| Input | `keydown` on the input; Up/Down/Tab/Ctrl+L handled ad hoc | no chords, no mouse, no paste discipline, no scriptable `sendKeys` |
| ANSI | `sh-highlight.ts` `splitSgr` whitelists 11 SGR codes into span classes | no 256/truecolor, no cursor control, no OSC; escapes outside the whitelist are dropped, not parsed |
| Interaction | `emit({kind:'tui'})` opens a DOM flashcard overlay (`tui.ts`) | one hard-coded view; commands cannot own the screen |
| Scrollback | the transcript div grows; the page scrolls | unbounded DOM cost; no terminal-scroll semantics |
| Scripting | `playback.ts` steps (type/key/wait/run/comment) | types into the input; cannot drive apps or mouse |

The product intent (bat pager with `/`-find, `semtext tui` colourised and
clickable, nano-class programs later) needs things an `<input>` + div
transcript cannot give: a cell grid an app can address, raw key delivery, an
alternate screen, and a paint path that survives 10k lines of scrollback.
Hence v2: keep `TerminalCore` dispatch, the VFS, the shell grammar
(`sh-parse.ts`), completion (`complete.ts`), playback steps, and the plugin
contract; replace the screen, the discipline, and the render path beneath
them.

## 3. Architecture overview

```
                keyboard / mouse / paste / sendKeys
                            │
                    ┌───────▼────────┐        hidden input (IME + OS paste
                    │   InputModel   │        surface, visually hidden —
                    │  normalize →   │        §7.2; NOT the v1 visible box)
                    │  KeyEvent      │
                    └───────┬────────┘
                            │
                 ┌──────────▼──────────┐   raw mode: forward verbatim
                 │   LineDiscipline    │──────────────────────┐
                 │ cooked (line editor │                      │
                 │ + history + compl.) │                      ▼
                 └──────────┬──────────┘            ┌──────────────────┐
                            │ Enter                 │  TerminalApp     │
                            ▼                       │ bat pager, tui,  │
                 ┌─────────────────────┐            │ nano (Epoch 3)   │
                 │   TerminalCore      │ spawn ────►└──────────────────┘
                 │ exec, plugins, VFS  │
                 └──────────┬──────────┘
                            │ out()/err()/write() — text + ANSI
                            ▼
                 ┌─────────────────────┐    damage sets    ┌───────────────┐
                 │       Screen        │──────────────────►│ canvas driver │
                 │ primary+alt buffers │                   │  (the paint)  │
                 │ scrollback ring     │(mirror: throttled)│ hidden mirror │
                 └──────────┬──────────┘                   └───────┬───────┘
                            │ OSC 0/2 title, 9 status              │ pixels
                            ▼                                      ▼
                 ┌─────────────────────┐  chrome (shadow ok) ┌───────────┐
                 │  WindowChrome       │◄────────────────────│ scrollbar │
                 │ (src/shared/window- │                     │ (sem-scroll)│
                 │  chrome.ts) + tabs  │                     └───────────┘
                 └─────────────────────┘
```

Layer rules (these are the design's load-bearing walls):

- **TerminalCore stays DOM-free and synchronous on the command path.** It
  gains one new output sink: writes flow through the ANSI parser (ansi lane)
  into the Screen instead of only accumulating `ShellLine`s. `ExecResult`
  keeps its `lines` view, derived from the same writes.
- **The Screen is the single source of truth for what is displayed.** The
  canvas driver and the DOM mirror both read it; neither owns state. The v1
  DOM renderer becomes "the mirror", not "the transcript" — and not a second
  live paint path (§8.2).
- **Discipline is a strategy, not a place.** Cooked and raw are two
  implementations of one interface; the v1 line editor's *behaviors*
  (history with draft, Tab completion, Ctrl+L) move into cooked mode intact.
- **Apps are guests, not owners.** A `TerminalApp` receives events and draws
  through the same Screen API anyone else uses; when it exits, the shell
  restores the primary screen and cooked discipline. Crash-safety comes from
  the runner's teardown, not from app goodwill.
- **Chrome consumes feeds.** Window title/status and scroll position are
  observables the chrome (and tests) subscribe to; OSC never touches DOM.

New modules (all under `src/terminal/` unless noted):

| Module | Owns |
|---|---|
| `screen/screen.ts` | buffers, cells, scrollback ring, damage |
| `screen/palette.ts` | 16/256/truecolor resolution, theme mapping |
| `discipline/*.ts` | cooked editor, raw passthrough, transitions |
| `input/keys.ts` | key normalization, chord grammar, `sendKeys` parser |
| `input/mouse.ts` | selection state, click/wheel routing, SGR-style reports |
| `apps/api.ts` | `TerminalApp` contract, runner, alt-screen lifecycle |
| `render/canvas.ts` | the renderer — glyph atlas, damage paint, DPR, selection overlay (in-bundle; the one visible path) |
| `render/mirror.ts` | the v1 DOM renderer, demoted: hidden synchronised mirror (a11y tree, find-in-page, copy; promoted to the visible paint under forced-colors / 2d-context failure) |
| `chrome/sem-scroll.ts` | Lit scrollbar component |
| `chrome/tabs.ts` | tab model (per-tab session, shared VFS) |
| `env/direnv.ts` | `.envrc` subset evaluation on `cd` |

## 4. Screen model

### 4.1 Cell

One character position. Structure-of-arrays per line (see 4.3), logical shape:

```ts
interface Cell {
  code: number;          // base codepoint (USV); 0 = blank
  combining: number[];   // combining marks folded onto this cell (rare)
  width: 0 | 1 | 2;      // 2 = East-wide glyph, 0 = continuation cell
  fg: number;            // palette ref, see 4.2
  bg: number;
  attrs: number;         // bit flags: BOLD|DIM|ITALIC|UNDERLINE|BLINK|
                         // REVERSE|HIDDEN|STRIKE — 1:1 with the ansi lane's
                         // SGR state bits, no translation layer
}
```

The attr bits match the ansi lane's SGR state machine exactly — SGR 1/2/3/4/
5/7/8/9 map to BOLD/DIM/ITALIC/UNDERLINE/BLINK/REVERSE/HIDDEN/STRIKE, SGR 22/
23/24/25/27/28/29 clear them, SGR 0 clears all plus colors. (SGR 21 — double
underline — is treated as plain UNDERLINE; the exact call is the ansi lane's,
this doc only requires the bit set to exist.) REVERSE is
stored, not baked (renderers and selection highlighting compose it at paint).

### 4.2 Color

`fg`/`bg` are 16-bit refs: `0–255` index the terminal palette (16 ANSI +
240 extended, i.e. the xterm 256 cube), `0x8000–0xFFFE` index a per-screen
truecolor table (RGB24 stored, table deduplicates), `0xFFFF` = theme default
(foreground/background tokens from the active `data-sem-theme`). The palette
module resolves refs → CSS colors for the DOM mirror and → fill styles for
canvas, from one place, so paint and mirror cannot drift. Themes map the 16
ANSI names the way `themes/_vocabulary.css` maps semantics today (a dedicated
`--sem-ansi-*` ramp added by the terminal CSS block owner; see §14 M2).

### 4.3 Lines and buffers

A `ScreenLine` is `{ cols }` fixed-width SoA storage: `Uint32Array` codes,
`Uint8Array` widths, `Uint16Array` fg/bg, `Uint16Array` attrs, plus
`combining: Map<number, number[]>` allocated lazily, and flags: `wrapped`
(true when the line is the continuation of a logical line — set by autowrap,
consumed by reflow, selection and copy), `dirty` (damage), `stale` (renderer
bookkeeping).

Two buffers:

- **Primary** — `rows × cols` viewport plus the **scrollback ring**. When a
  line scrolls off the top it moves into the ring (a circular buffer of
  `ScreenLine` refs, default capacity 5,000 lines, element attribute
  `scrollback="N"`, hard-capped 50,000 — the ring stores refs, and a line is
  immutable once it leaves the viewport, so capacity is a memory dial, not a
  correctness one). The *viewport* can be scrolled back over
  `ring + primary`; new output while scrolled back does not yank the view
  (mirrors every real terminal; the scrollbar shows the offset).
- **Alternate** — `rows × cols`, no scrollback, not cleared on resize
  scroll-reflow (it is redimensioned and the app is notified). Entered/exited
  by apps (§6); on exit the primary viewport and the saved cursor/attrs are
  restored exactly.

Selection and copy address `(absoluteLine, col)` where `absoluteLine`
monotonically numbers logical lines from the ring's oldest retained line —
scrollback eviction never invalidates a live selection, it just clips it.

### 4.4 Modes (the small xterm subset we implement)

| Mode | Default | Meaning |
|---|---|---|
| autowrap (DECAWM) | on | cursor at right margin wraps to next line (sets `wrapped`) |
| cursor visible | on | apps may hide the cursor (tui, pager idle) |
| alt screen | off | app lifecycle only, not settable by commands |
| origin mode | off | **not implemented** — out of subset |
| insert mode | off | **not implemented** |

Cursor state: `(absoluteLine, col)`, plus saved-cursor slot
(DECSC/DECRC semantics: position + attrs + charset — we save position and
attrs). Cursor control sequences the parser accepts: CUU/CUD/CUF/CUB
(relative moves, clamped), CUP/HVP (absolute), CHA (column), ED/EL (erase
display/line, respecting attrs-vs-blank semantics: erased cells take the
current SGR background), IL/DL (insert/delete line, primary + alternate),
SU/SD (scroll), and CR/LF/BS/HT (control chars). Anything outside the subset
is consumed silently by the parser (never printed as noise — ansi lane rule)
and logged to a debug counter.

### 4.5 Damage tracking

Every mutation marks line(s) dirty and/or sets a global "cursor moved" /
"viewport scrolled" flag. Writes are batched per microtask into a damage set
`{ lines: Set<ScreenLine>, cursor: boolean, scroll: boolean }`; renderers
drain it on the next animation frame. Nothing in the write path touches DOM
or canvas — the v1 property that commands stay DOM-free and Node-testable is
preserved (the Screen is a plain data structure).

### 4.6 Resize and reflow

`cols`/`rows` come from the active renderer's cell metrics (§8), clamped
`cols ∈ [20, 500]`, `rows ∈ [4, 200]`. On resize:

1. Primary: re-unwrap the wrapped lines of each logical line (using the
   `wrapped` flags) and re-wrap at the new width; scrollback lines reflow
   too — this is why wrap state lives on lines, not on a render. The cursor
   keeps its logical (line, column-within-logical-line) position, clamped.
2. Alternate: redimension in place (top-left anchored; apps redraw on
   `onResize`), no reflow.
3. Apps receive `onResize(cols, rows)` after the screen has been
   redimensioned.

## 5. Line discipline — cooked and raw

### 5.1 The interface

```ts
interface LineDiscipline {
  mode: 'cooked' | 'raw';
  // Physical/scripted key events, already normalized (§7.1).
  key(ev: KeyEvent): void;
  // Cooked only: the shell callback when a line is submitted.
  onSubmit(line: string): void;
  // Raw only: the app that owns the session.
  attach(app: TerminalApp): void;   // enter raw
  detach(): void;                   // exit raw, restore cooked
}
```

The discipline owns the *prompt row*: in cooked mode it renders the prompt +
input buffer + in-grid cursor into the primary screen's last line(s); in raw
mode it renders nothing (the app owns every cell) and simply forwards.

### 5.2 Cooked mode — the v1 editor, relocated

Every behavior users have today survives, specified against the grid:

- **Buffer + cursor**: the input is a string with a char-offset cursor
  (grapheme-cluster aware — movement uses the same width table as the
  screen). Left/Right/Home/End/Backspace/Delete edit it; the discipline
  repaints the prompt row(s) on each keystroke (cheap: one line).
- **History**: Up/Down walk `history` with draft preservation on the way
  down past the newest — a direct port of `#navigate` in `sem-terminal.ts`,
  including the "down past newest restores the draft" behavior the v1 tests
  pin.
- **Completion**: Tab runs `completeLine` (unchanged); `extend` rewrites the
  buffer; `list` prints the candidate line into the transcript once, capped
  at 8 + "… +N more", exactly as `#complete` does now. A second Tab with no
  extension lists — preserved.
- **Control chars** (cooked table): Ctrl+A/E → home/end, Ctrl+B/F →
  left/right, Ctrl+K → kill to end, Ctrl+U → kill line, Ctrl+W /
  Alt+Backspace → kill word left, Ctrl+L → clear screen (primary viewport;
  keeps scrollback), Ctrl+C → abandon the line and print a fresh prompt
  (v1 has no Ctrl+C handler; v2 makes the common expectation true), Ctrl+D
  on empty buffer → no-op
  (there is no session to end), Ctrl+P/N → history like Up/Down.
- **Prompt**: `PS1` semantics are not adopted; the prompt stays
  `<cwd> $` composed from `state.cwd` (with `$HOME` abbreviation as v1
  prints it), so no new template language enters scope.
- **IME + OS paste** (see §7.2): composition happens in a hidden input; the
  discipline shows the in-progress composition string inline at the cursor
  (UNDERLINE attr) and commits on `compositionend`.

### 5.3 Raw mode

`attach(app)` enters raw: the cooked prompt row is erased, the alternate
screen is entered, and every normalized key event routes to `app.key(ev)` —
no echo, no interpretation (the app decides what Ctrl+C means; the runner's
interrupt escape hatch is §6.3). `detach()` exits: alternate screen popped,
primary restored, fresh prompt painted, cooked editing resumes. If the
element disconnects or the app throws, the runner guarantees `detach` — raw
mode can never leak past the app's lifetime.

### 5.4 What moves where (v1 → v2)

| v1 (in `sem-terminal.ts`) | v2 home |
|---|---|
| `#onKeydown` switch | `input/keys.ts` normalization + cooked table |
| `#navigate` history | cooked discipline |
| `#complete` | cooked discipline (calls `complete.ts` unchanged) |
| `#renderPrompt` `<input>` | prompt row painted on the grid + hidden input |
| `#renderLine` spans | mirror renderer reading screen cells |
| `#onFrameKeydown` Escape ladder | discipline transitions (§6.3 keeps the ladder) |

## 6. Full-screen app API

### 6.1 Contract

```ts
interface TerminalApp {
  readonly id: string;                  // e.g. 'bat', 'semtext-tui'
  start(api: AppApi): void | Promise<void>;
  key(ev: KeyEvent): void;              // raw mode delivery
  resize?(cols: number, rows: number): void;
  paste?(text: string): void;           // bracketed-paste content
  mouse?(ev: MouseEventInfo): void;     // only if it requested reporting
  stop(): void;                         // app is being torn down
}

interface AppApi {
  readonly screen: ScreenWriter;        // write ANSI, move cursor, etc.
  readonly cols: number; readonly rows: number;
  setTitle(title: string): void;        // OSC 0/2 feed (§11)
  setStatus(text: string, tone?: 'idle'|'busy'|'alert'): void;  // OSC 9 feed
  requestMouse(report: boolean): void;
  exit(code?: number): void;            // the ONLY way out; runner detaches
  // Read-side for future pipes is out of scope for Epoch 2.
}
```

`ScreenWriter` is a thin typed façade over "append ANSI-bearing text through
the parser into the screen" plus cursor helpers — apps may also emit raw
ANSI strings (the parser is the gate; unknown sequences are consumed, never
printed). Apps are registered like commands (§6.4).

### 6.2 Lifecycle and the alternate screen

`spawn` → save cursor/attrs → enter alternate → `attach(app)` → `start(api)`.
Input routes to the app until `api.exit(code)` (or teardown). Then: `stop()`
→ `detach()` → pop alternate → restore cursor → the shell prints the
command's `status` line (`exit N`) into the transcript, exactly as pipeline
commands do today, and `$?` is set. The transcript/history semantics of
`TerminalCore.execLine` are unchanged — an app run is one command.

### 6.3 Interrupt and the Escape ladder

v1's priority ladder (filter owns Escape → close TUI → stop playback)
generalizes into one ordered rule set, and every v1 meaning survives:
(1) **playback running → Escape stops the script and hands the terminal
over** (v1 behavior, kept verbatim — the script-runner lane inherits it);
(2) **an app owns the screen → Escape is an app key**, because pagers need
it (product intent: `q` / `:q` / Esc exit `bat`); (3) **cooked mode →
Escape has no meaning** (v1 kept). Separately, **Ctrl+C while an app runs →
`app.stop()` + detach** (documented as "interrupt", status `exit 130`). This
is the one place v1 semantics change shape, and it is additive: no v1 key
path loses its meaning.

### 6.4 Declaring apps from plugins (additive, backwards compatible)

```ts
// PLUGINS.md addition — optional field on CommandSpec:
interface CommandSpec {
  // ...existing fields unchanged...
  /** When set, running this command spawns the app instead of run(). */
  app?(ctx: CommandContext): TerminalApp | null;
}
```

`run` and `app` are mutually exclusive in practice: if `app` is present and
`ctx.color` is true (stdout is the terminal — same gating as the tui action
today; a *piped* pager prints plain and exits 0), the core spawns; otherwise
it falls back to `run` (authors provide both, the piped path being the plain
renderer). The existing `emit({kind:'tui'})` DATA-action keeps working all
through v2 and is *not* deprecated on that timeline — the flashcard view
re-implements itself as a `TerminalApp` when its colourised grid version
lands, and the emit path retires only when parity is verified (§14 M5).

First apps: `bat` pager (Epoch 2), `semtext tui` grid version (Epoch 2),
`nano` (Epoch 3).

## 7. Input model — keys, mouse, paste, sendKeys

### 7.1 Key normalization and the chord grammar

Every physical `keydown`/`keyup` and every scripted key becomes a
`KeyEvent { key: string; ctrl: boolean; alt: boolean; shift: boolean; meta:
boolean }` where `key` is the normalized key name: printable single
characters as themselves; named keys `Enter`, `Escape`, `Backspace`, `Delete`
, `Tab`, `ArrowUp/Down/Left/Right`, `Home`, `End`, `PageUp`, `PageDown`,
`Insert`, `F1`–`F12`, `Space`. Meta is observed but reserved (browser-owned);
no v2 behavior binds it.

One string grammar names any of them — used by `sendKeys`, by playback
steps, and by documentation:

```
keyspec   := chord? base
chord     := ( "Ctrl+" | "Alt+" | "Shift+" )+
base      := printable-char | "<" name ">"     e.g. "a", "?", "<Enter>",
                                               "<Ctrl+L>", "<Alt+.>", "<Shift+Tab>"
```

This is a superset of v1 playback `key` names (which were bare `"Enter"`,
`"ArrowDown"`, …) — the script-runner lane's port targets the same grammar so
scripts, tests and the demo runner speak one language.

### 7.2 The hidden input (IME and OS paste)

A real terminal needs OS-level text input services the keyboard events alone
cannot provide: IME composition and paste-menu integration. v2 keeps a
*visually hidden* `<input>` (clip-pathed, opacity 0, positioned at the drawn
cursor) as the focus/IME surface in both modes. This is deliberately not the
v1 "input box": it renders nothing, owns no caret, and is invisible to
layout — the drawn cursor (§8.3) is the only caret. Composition events
update the cooked buffer (§5.2) or are committed straight to the focused app
as paste text in raw mode. Focus management (click-to-focus, focus ring via
window chrome) stays as v1 plus the chrome standard.

### 7.3 Mouse

- **Click** on a cell: focus + collapse selection. **Drag**: selection in
  (absoluteLine, col) space, rectangular mode with Alt-drag (both modes
  reflow-safe because selection addresses logical lines).
- **Wheel**: primary screen → scroll the viewport over scrollback (and back
  to bottom on any new output only if the user is at bottom — stickiness);
  alternate screen or app mouse-reporting on → wheel deltas delivered to the
  app as `MouseEventInfo { kind:'wheel', dx, dy }`.
- **App reporting**: apps opt in via `requestMouse(true)`; they then receive
  clicks/wheel with cell coordinates (`col`, `row`, `button`, `mods`). One
  encoding, internally SGR-1006-shaped (`<btn>;<col>;<row>` semantics) — we
  never synthesize legacy encodings.
- Selection semantics on mobile: long-press select, drag handles are native
  to the mirror layer (§9) — canvas does not fight the platform.

### 7.4 Paste and clipboard

Paste into cooked mode inserts at the cursor (multiline paste is bracketed:
each interior newline is escaped and shown as a visible `⏎`-token until
submit — never auto-executes a pasted multiline blob). Paste into raw mode
delivers `paste(text)` (bracketed semantics). Copy: `navigator.clipboard`
when available, `document.execCommand('copy')` from the hidden input as the
file:// fallback; both feed from the same `extractText(selection)` the DOM
mirror uses.

### 7.5 `sendKeys` — the one programmatic input path

```ts
// On the element (and mirrored on the discipline for tests):
el.sendKeys('bat demo/example-deck.sem.html<Enter>');
el.sendKeys('<Down><Down><PgDn>'); el.sendKeys('/fact'); el.sendKeys('<Enter>');
el.sendKeys('<Ctrl+L>'); el.sendKeys('<Esc>');
```

`sendKeys(spec)` parses the §7.1 grammar and injects normalized KeyEvents
through the exact same pipeline as physical keys — there is one input path,
so scripts, the demo-runner port (script-runner lane), e2e tests, and user
typing cannot diverge. Literal segments type as chars (no per-char delay —
timing belongs to the script runner, which wraps `sendKeys` for its typed
playback).

## 8. Renderers

One contract, two implementations — the canvas driver paints, the DOM
implementation mirrors (2026-10-14 decision: canvas is the only visible path;
§8.2):

```ts
interface ScreenRenderer {
  attach(screen: Screen, host: HTMLElement): void;
  metrics(): { cols: number; rows: number; cellWidth: number; cellHeight: number };
  drain(damage: DamageSet): void;     // called per rAF with the batch
  detach(): void;
}
```

### 8.1 The DOM mirror (a11y tree, find-in-page, copy — and the fallback paint)

Renders the viewport as light-DOM line divs (one div per screen line, spans
per attribute run — the shape `#renderLine` already produces, now driven by
cells instead of `splitSgr`) — visually hidden (clipped to zero size,
`aria-hidden="false"`) and derived from the same damage sets as the canvas,
throttled to ≥ 100ms / on-idle. It is the accessibility tree, the surface
browser find-in-page and platform text services read, and the text source
copy extracts from (§9). Scrollback is not kept as DOM: the mirror
re-renders the viewport window on scroll; the full scrollback text remains
available through copy and app-level search (the pager's `/`). Cost is
O(rows) regardless of scrollback depth. Under `forced-colors: active` — or
if the canvas 2d context cannot be created — the mirror is promoted to the
*visible* renderer for the session (same code path, unclipped): the
automatic fallback strategy, with no opt-out attribute.

### 8.2 Why canvas is the one path (2026-10-14 decision)

The original draft kept the DOM renderer as the default with canvas as an
opt-in chunk; the user decided otherwise: one rendering path, bundled. Two
live paint paths mean two code paths to test, a per-page opt-in no landing
page would exercise, and a file:// story with a conditional second script
tag. One in-bundle canvas driver gives every page — file:// included — the
same pixels, and the DOM code that remains is repurposed, not deleted: the
mirror (§8.1) already produces the exact light-DOM shape v1 rendered, so
a11y, find-in-page, copy, and the forced-colors paint all fall out of code
that had to exist anyway.

### 8.3 Canvas driver (in `semtext-js-shell.js` — the one renderer)

- **Glyph atlas**: one offscreen canvas texture per style bucket (the cross
  product that matters is: bold × italic × underline × dim × fg-color-ref;
  buckets materialize lazily). Glyphs rasterized on first use via
  `fillText`, packed into 512px pages with a simple row allocator;
  evicted whole-page when a bucket goes cold (LRU, 4 pages max).
- **Damage painting**: `drain(damage)` repaints only dirty lines' rects and
  the cursor cell; a scrolled viewport paints all rows (cheap: blits).
- **DPR**: backing store sized `cssSize × devicePixelRatio` (clamped 1–3),
  `ctx.setTransform(scale)` so cell math stays in CSS pixels; re-rasterized
  on DPR change (zoom).
- **Fonts**: a monospace stack (`ui-monospace, SFMono-Regular, Menlo,
  Consolas, monospace`); cell metrics measured once per font-load state
  (document.fonts.ready) and re-measured on change; width-2 glyphs measured
  against the same table the screen uses, so grid math and paint agree.
- **Cursor**: drawn as a block/underline/beam at the cursor cell
  (style settable by apps), blinking at 530ms on/off — **steady, not
  blinking, under `prefers-reduced-motion`** (canvas queries the media
  query; the mirror's CSS does the same via the theme block).
- **Selection**: translucent overlay rect per selected run; the selection
  lives on the screen as `(absoluteLine, col)` ranges, so the mirror can
  express the same ranges natively (platform selection, a11y highlighting)
  and the two cannot disagree; copy feeds from one `extractText` (§9).
- **Forced-colors / high-contrast**: the element detects
  `forced-colors: active` (and any `getContext('2d')` failure) and promotes
  the DOM mirror to the visible renderer for the session (§8.1) — canvas
  cannot honor forced-color semantics honestly. Automatic only; no public
  attribute switches renderers.

### 8.4 Loading — one bundle, no fetch (invariant 1 by construction)

`semtext-js-shell.js` (IIFE, file://-safe) ships everything: §3–§7, the
canvas driver, and the DOM mirror. There is no `semtext-shell-canvas.js`
chunk and no `renderer="canvas"` opt-in (2026-10-14 decision): one classic
script, evaluated in one pass — nothing is fetched, imported, or
lazy-loaded at runtime, on any origin. Invariant 1 holds by construction
rather than by discipline. The document-side lazy loader
(`semtext-lazy.js`) is untouched and stays out of the shell's business.

## 9. Accessibility

- **The DOM mirror is the accessibility tree — always.** With canvas the
  only visible path, the mirror (§8.1) is unconditionally mounted:
  visually-hidden (`aria-hidden="false"`, clipped to zero size), derived
  from the same damage sets, throttled to ≥ 100ms / on-idle. Screen
  readers, browser find-in-page, and platform text services all read it;
  both surfaces derive from one source (the screen) so they cannot
  disagree. Find-in-page hits map back through the mirror's line/cell
  structure to screen ranges and are painted on canvas as selection-overlay
  rects — the browser highlights nothing visible by itself (the mirror is
  clipped); the canvas does.
- **Selection and clipboard run through the screen.** Drag-select paints
  canvas overlays; assistive/platform selection on the mirror addresses the
  same `(absoluteLine, col)` ranges. Copy — keyboard, context menu, or
  `navigator.clipboard` (execCommand from the hidden input on file://,
  §7.4) — feeds from one `extractText`, so canvas selection and mirror
  selection copy identical text.
- **Live regions**: the transcript keeps `role="log" aria-live="polite"` (v1
  semantics). App screens announce a compact summary line on change ("pager:
  lines 1–24 of 214") rather than diffing 2,000 cells into speech — the
  `TerminalApp` may provide `a11ySummary(): string`; the runner emits it on
  the live region when present.
- **Interactive apps keep a semantic surface**: the flashcard TUI (and any
  app that is fundamentally a document viewer, not a canvas of characters)
  renders its *content* as light DOM (the current overlay pattern) while its
  chrome paints on the grid. Hybrid mode is part of the app contract, not a
  hack: `app.semantic?(): HTMLElement` — when present the runner mounts it
  alongside the grid and keeps it in the a11y tree.
- **Keyboard**: everything is keyboard-first by construction (it is a
  terminal); focus visible via the window-chrome focus ring; Tab/Shift+Tab
  leave the terminal when the cooked line is empty (v1 behavior kept).
- **Motion**: cursor blink, playback typing, and scroll animation all gate
  on `prefers-reduced-motion` (playback already does — `playback.ts`
  `reducedMotion` — and stays).
- **Contrast**: the palette's 16 ANSI colors are chosen per theme to meet
  4.5:1 against that theme's background; the palette module exposes a
  contrast check the theme lint can run (the `--sem-ansi-*` ramp is theme
  data, validated like any theme token).

## 10. Virtual scrollbar — `sem-scroll`

A Lit component (`src/terminal/chrome/sem-scroll.ts`) — chrome, so it may
live in the shadow root of the shell frame; it draws **no native scrollbar**:

- Track + thumb as absolutely-positioned divs; thumb geometry maps the
  viewport window over `ring + primary` (min thumb height 24px; proportional
  beyond that).
- Input: pointer drag (pointer events, pointer capture), click-to-page,
  wheel over track; output: a `scrollto` callback the screen consumes
  (viewport move; dragging pins the viewport at bottom only when released
  there).
- Hidden entirely when the content fits (no scrollback). Never intercepts
  keys: keyboard scrollback is Shift+PageUp/PageDown (and Home/End with
  Shift) in cooked mode, delivered to the app when it owns the screen — the
  scrollbar is pointer-only, like every real terminal.
- Reduced motion: the viewport jump is instant (no animated scroll).
- Reads theme tokens (`--sem-shell-*`) from the terminal CSS block — no
  hard-coded colors.

## 11. Window title, OSC, and tabs

### 11.1 OSC feeds

The ansi lane's parser surfaces OSC; the screen exposes two observables:

- **`title`** — OSC 0 / OSC 2 (set window/tab title). Plain text, control
  chars stripped, length-capped 200.
- **`status`** — OSC 9 (`ESC ] 9 ; <text> ST`), a SemText-private status
  line (the slot tabbing-on uses for "what am I doing" text), optionally
  `OSC 9 ; <tone> ; <text>` with tone `idle|busy|alert` mapping to the
  window-chrome status dot.

Subscribers: the window chrome (title bar text + status dot — this is the
*one shared window-chrome standard* from the sem-browser lane:
`src/shared/window-chrome.ts` consumes the same feed for `sem-browser`,
`sem-shell`, `sem-code`, and the reference ExampleViewer), the tab strip
(§11.2), and tests. OSC never writes to the screen.

### 11.2 Tabs

`<sem-shell tabs>` (Epoch 3 build-out; the model lands in Epoch 2): a tab
strip from window chrome; **each tab owns one session** — `TerminalCore`
(state, env, history, discipline, screen) — while the **VFS is shared
per element** (one filesystem, several shells — the POSIX mental model).
Per-tab titles come from OSC 0 scoped to the owning session. `Ctrl+PgUp/
PgDn` (and `Alt+1..9`) switch tabs in cooked mode; the strip itself is an
accessible tablist (arrow keys, `aria-selected`). Tabs play equally with
script-runner autostart: a tab's start script waits for *that tab* to
intersect the viewport.

### 11.3 tabbing-on compatibility

The tabbing-on conventions (`tabbing-on` README: title + status + priority;
`.envrc` exporting `TAB_TITLE` / `TAB_THEME`) map directly: a future
`tabbing` plugin issues OSC 0/9 from shell commands (`tab-on`, `tab-status`),
and §12's direnv hooks feed the same variables — no new channels invented.

## 12. Environment and direnv

`ShellState.env` already exists (HOME/PWD/SHELL seeded; `export`/`unset`;
`$VAR` in the grammar). v2 adds:

- **`.envrc` on `cd`** (`src/terminal/env/direnv.ts`): when `cd` enters a
  directory whose VFS dir contains `.envrc`, the shell evaluates a
  **declarative subset** — lines of `export NAME=value`, `unset NAME`,
  comments (`#`), blanks; values use the same quoting rules as `sh-parse`
  words (single = literal, double = `$VAR` expansion at load). Anything
  else is a stderr warning and the line is skipped — **no arbitrary command
  execution**, by design: real direnv's power comes from running code, and
  code execution is exactly what this shell does not grant to a document
  until the sandbox decision (Appendix A) is made.
- **Stacking**: entering a child dir with its own `.envrc` layers it on the
  parent's; leaving the stack unwinds to the enclosing dir's set. `cd`
  prints one dim comment line (`direnv: loaded .envrc`) — visible, not
  silent, per the "no hidden magic" tone of the existing shell.
- **Hooks**: after evaluation, `TAB_TITLE` / `TAB_THEME` (if set) feed the
  title/status chrome (§11.3); `PS1`-like variables are intentionally not
  introduced.
- `export`/`unset` commands and `$?`/`$VAR` expansion are untouched.

## 13. Budgets

### 13.1 Bundle (raw minified, `npm run build:strict` gates)

| Artifact | Budget today | After Epoch 1 (est.) | v2 budget | Rationale |
|---|---|---|---|---|
| `semtext-js-shell.js` | 96 KB (74.8 measured) | ~88–92 KB (ansi parser, script-runner, cards, demo files) | **256 KB raw** | the user's number (2026-10-14): screen + discipline + input + apps + scrollbar + direnv + **the canvas driver, bundled (no separate chunk)** |
| `semtext.js` (core) | 126 KB (124.1) | unchanged | **unchanged** | terminal code must never grow the document bundle (existing rule, `scripts/build.mjs`) |

Gzip target: shell ≤ 90 KB (canvas included; derived at the current raw:gzip
ratio). Every budget line keeps the existing build discipline: printed per
build, failing only under `--strict-budget`, history recorded in
`ROADMAP.md` "Size budgets" (the 96 → 256 KB bump is logged there,
2026-10-14).

### 13.2 Runtime

| Metric | Budget | Measurement |
|---|---|---|
| Keystroke → paint (cooked) | < 16 ms (one frame) at 120×40 | perf marks in unit bench |
| `sendKeys` batch of 1k keys | < 150 ms total | bench |
| Scroll 10k-line scrollback | 60 fps wheel, no DOM growth | bench + e2e |
| Damage paint (canvas, 1 dirty line) | < 0.5 ms | bench |
| Full repaint (canvas, 120×40) | < 4 ms | bench |
| Resize reflow (10k lines) | < 100 ms | bench |
| Memory, 10k lines scrollback | < 40 MB heap growth | e2e sampler |
| Mirror update (a11y) | ≥ 100 ms throttle, < 2 ms per update | unit |

Benchmarks live as vitest `bench` files next to the units (Node for the
data structures; renderer benches run in cypress with
`performance.now()` marks) — CI reports, does not yet gate; gating is an
open question (§17).

## 14. Migration plan — no plugin API break

Compat guarantees up front (frozen unless a listed phase says otherwise):
`CommandSpec.run`/`complete`, `CommandContext` fields, `ShellState` fields,
`ShellLine`/`ExecResult` shapes, `playback` step grammar, the `script` /
`plugins` / `local-storage` attributes, manifest + CDN rules, and the
zero-JS authored transcript. Tests that pin these
(`terminal-core.test.ts`, `shell-posix.test.ts`, `sem-shell.test.ts`,
`playback.test.ts`, `terminal-demo-plugin.test.ts`) stay green through
every phase — that is the migration's definition of success.

| Phase | Ships | Acceptance |
|---|---|---|
| **M1 — parser lands** (Epoch 1, ansi lane) | ANSI/VT parser behind one output hook | existing tests green; SGR codes beyond the whitelist parsed, still rendered via span classes |
| **M2 — screen beneath** | `Screen` introduced as the write sink; the DOM paint reads cells (interim visible path); `lines` becomes a derived view over writes | all v1 transcript tests green against the derived `lines`; double-render of prompt row removed |
| **M3 — canvas paints, DOM mirrors** | the canvas driver (from the one bundle) becomes the visible renderer; the DOM renderer demoted to the hidden mirror; forced-colors / 2d-context promotion logic | canvas e2e + pixel-diff via the snap harness; mirror text assertions (never only pixels); forced-colors mirror-promotion e2e; file:// smoke — same bundle, no fetch |
| **M4 — discipline swap** | cooked editor on the grid (hidden input, drawn cursor); v1 `#onKeydown`/`#navigate`/`#complete` logic deleted | typing/history/completion e2e parity checklist; IME composition e2e; `nojs.html` proof unchanged |
| **M5 — apps + alt screen** | `TerminalApp` API, runner, bat pager, semtext-tui grid version alongside the DOM overlay | pager interactions (§ product intent: ↑/↓/PgUp/PgDn, `/` find, n/N, q/:q/Esc) e2e; tui keyboard+mouse e2e; interrupt ladder e2e |
| **M6 — chrome + env** | `sem-scroll`, OSC title/status feeds into window chrome, direnv subset, `sendKeys` public | scrollbar e2e; direnv unit + e2e; sendKeys drives the landing demo scripts |

Rollback story: M1–M6 keep the external surface constant, so a revert is a
revert. M3 flips the visible path, but the DOM paint code stays in the bundle
as the mirror/fallback — reverting M3 promotes it visible again, with no
artifact boundary involved. The v1 TUI overlay is only deleted after the
grid tui passes the overlay's own e2e suite (`semtext-tui.test.ts` +
cypress) — parity, then retire.

## 15. Test strategy

- **Unit (vitest, plain Node — the v1 property that the core tests without
  a DOM is preserved):** screen ops (wrap flags, ring eviction, damage
  sets, rewrap at width change, selection clipping), palette resolution,
  cooked table (every control char), key grammar round-trips, `sendKeys`
  parsing, OSC feed extraction, direnv subset (stacking, unwind, refusal of
  command lines), app runner (exit paths, crash teardown, isatty gating).
- **Golden grids:** apps and the screen serialize to a text+attr grid dump;
  snapshots are the ratatui-TestBackend pattern (headless backend, golden
  files, diff on change). The bat pager and tui each ship a golden set per
  theme.
- **e2e (cypress, against built `dist/demo/`):** typing/history/completion
  parity; pager key set; tui keyboard + click; Escape ladder; sendKeys
  driving the four landing scripts; scrollback + scrollbar; reduced-motion
  (instant playback, steady cursor); `nojs.html` still proves the JS-off
  transcript; canvas paint (screenshot diff via the snap harness + mirror
  text assertions — never only pixels); forced-colors mirror-promotion; a11y
  mirror (axe on the mirror, live-region announcements); a file:// smoke of
  the single bundle.
- **Perf:** §13.2 benches, reported in CI.
- **Fuzz:** the ansi lane's parser fuzz (random bytes, split at every
  offset) extends to the screen — no throw, no unbounded growth, damage
  stays consistent.

## 16. Risks

| Risk | Mitigation |
|---|---|
| IME regressions from losing the visible input | hidden-input surface is specified (§7.2) and e2e'd in M2 before the v1 input is deleted |
| Canvas grid vs screen width disagreement (font metrics drift) | one metrics module, measured after `document.fonts.ready`; disagreement impossible by construction |
| A11y mirror drift / double source of truth | one source (the screen); the mirror is derived from the same damage sets; mirror assertions in e2e |
| Scrollback memory on long sessions | ring capacity attr + hard cap; lines immutable once in the ring |
| Safari/file:// clipboard limits | execCommand fallback specified; copy degrades to selection + Ctrl+C on the mirror (native path still works — text is real DOM) |
| Bundle growth pressure | the 256 KB raw shell budget absorbs the in-bundle canvas driver (2026-10-14 decision); per-phase budget checks; core bundle forbidden to grow (standing rule) |
| Escape-ladder behavior change surprising v1 users | ladder documented here, e2e-pinned, and the v1 meanings all survive |
| Mobile: virtual keyboards + raw mode | cooked works with composition path; raw-mode apps on touch get an on-screen key bar (Epoch 3, noted — not silently broken: apps declare `touch` capability and the shell refuses to spawn pager-on-touch with a readable message until then) |

## 17. Open questions

1. Should perf budgets gate CI (fail the build) or report-only for the
   first cycles? (Recommend report-only until the migration completes at
   M6, gate after.)
2. Tab model timing: land `chrome/tabs.ts` data model in Epoch 2 (unused)
   or defer all of it to Epoch 3 with the tab strip?
3. Direnv: is the declarative subset enough for the demo use cases, or do
   we need `PATH`-like list mutation (`export PATH=$PATH:/x`) in v1 of it?
   (Recommend yes to list-append sugar — cheap, common.)
4. With canvas-everywhere, renderer switching is automatic-only
   (forced-colors, 2d-context failure): should any user- or author-facing
   escape hatch to the mirror paint exist (e.g. a debug attribute), or
   none at all? (Recommend none — one code path exercised in the wild.)
5. `semtext tui` grid version: replace the flashcard DOM overlay at M5 or
   keep hybrid-semantic mode permanently for screen-reader quality?
   (Recommend permanent hybrid — it is the better a11y answer.)

## Appendix A — WASM micro-kernel proof of concept

Long-term direction (user, 2026-10-14): a true Linux kernel compiled to
WASM, starting with a micro-kernel PoC. The terminal API above is deliberately
the stable surface this sits behind: a kernel is just another thing that
writes to the screen and reads keys.

**Options.**

| | v86 / x86 emulator | Rust/C micro-kernel → wasm32 |
|---|---|---|
| What it is | full x86 PC emulator in WASM booting a real Linux image | a small kernel we own, compiled to wasm32 (no_std Rust or freestanding C) |
| Fidelity | real Linux, real syscalls, real binaries | our syscall surface, our binaries |
| Size | multiple MB (kernel + rootfs + emulator) | tens–hundreds of KB |
| Startup | seconds | < 100 ms target |
| Hard constraint | needs SharedArrayBuffer → COOP/COEP headers → **cross-origin isolation, which file:// pages cannot have** — breaks invariant 1 for the canonical artifact | single-threaded wasm runs anywhere an IIFE does |
| Verdict | plausible for http-hosted "full Linux" demos later | **the PoC** |

**PoC scope (behind the same terminal API):**

1. A freestanding Rust kernel (wasm32-wasi) with a minimal syscall set:
   `read`, `write`, `open`, `close`, `spawn`, `wait`, `exit` — over a
   flat filesystem image linked into the module.
2. The bridge is two existing interfaces, nothing new: a **`VfsBackend`**
   whose backing store is the kernel's filesystem image, and a
   **`TerminalApp`** (`wasm-kernel`) that shuttles bytes between the
   kernel's console device and `AppApi.screen`, and forwards keys to the
   kernel's stdin. The shell needs zero changes.
3. Success criteria: `ls`, `cat` running *inside* the kernel's process
   model (spawned by its own `sh`, not our commands), through our screen,
   our input, our scrollbar; bundle ≤ 300 KB for kernel + init; startup
   < 100 ms; `semtext tui` still works beside it (no global state seized).
4. Explicitly out of the PoC: networking, multiple TTYs, signals beyond
   kill-on-exit, and any `.envrc`-style code execution grant (that gate
   stays shut until the kernel gives us an actual sandbox to grant it in).

The WASI question (p1 vs p2, component model) is deferred to PoC kickoff;
wasi-sdk's p1 is sufficient for the syscall surface above.
