/**
 * landing-scripts — the four try-views demos as named start scripts.
 *
 * The landing page's "Switch the view" section mounts one shell per tab;
 * each tab names its script: `<sem-shell start-script="landing-code">`.
 * The values are demo-format line scripts (README.md) — plain text, so a
 * reviewer reads the whole demo in source. The BROWSER tab has no shell
 * (it renders <sem-browser>), so there is no script for it here.
 *
 * File paths are VFS paths inside the semtext-demo plugin (files/), the
 * single source of truth for the demo documents.
 */

/** The deck: the page's four facts as one SemText document. */
export const EXAMPLE_DECK_PATH = 'demo/example-deck.sem.html';
/** Sections + subsections + diagram + table, for the TUI/CLI/toc demos. */
export const AUTH_NOTES_PATH = 'demo/auth-notes.sem.html';

export const LANDING_SCRIPTS: Record<string, string> = {
  'landing-code': `# CODE — the deck as source
## bat prints the SemText source with syntax colour.
$ bat ${EXAMPLE_DECK_PATH}
@expect sem-facts
# Your turn — try grep -c sem-fact ${EXAMPLE_DECK_PATH}`,

  'landing-tui': `# TUI — the deck as flashcards
## semtext tui opens a read-only card view; the keyboard drives it.
$ semtext tui ${AUTH_NOTES_PATH}
@expect tui:
@key <Down>
@key <Enter>
@sleep 1.4
@key <Down>
@key <Enter>
@sleep 1.4
@key q
# Your turn — j/↓ move, Enter expands, / filters, q closes.`,

  'landing-cli': `# CLI — the deck as records
## The same documents read without a UI: text in, facts out.
$ semtext render ${AUTH_NOTES_PATH}
@expect records:
$ render-card demo/render-demo.card
$ render-card demo/render-subsection.card
$ render-card demo/render-toc.card
# Your turn — try semtext outline ${EXAMPLE_DECK_PATH}`,
};

export const LANDING_SCRIPT_NAMES = Object.keys(LANDING_SCRIPTS);

/** Look a script name up in the landing registry. */
export function landingScript(name: string): string | null {
  return LANDING_SCRIPTS[name] ?? null;
}
