// @vitest-environment happy-dom
// Unit spec — src/shared/text-render · the pure terminal text renderers
//
// Feature: every SemText element has a text view
//   Scenario: a callout note frames its body (box-drawing, variant in the title)
//   Scenario: collapsed is honored — the note shows the caret and the first line only
//   Scenario: a fact renders statement, conclusion and incorrect statements
//   Scenario: a collection nests its records with tree glyphs
//   Scenario: a table renders aligned columns with a header rule
//   Scenario: progress renders a bracket meter
//   Scenario: reveal is collapsed until open
//   Scenario: code/md render verbatim source in a frame
//   Scenario: tldr renders the label box
//   Scenario: tree containers render structured nodes with glyphs
//   Scenario: faqs render Q/A entries
//   Scenario: workflow renders numbered steps with context parameters
//   Scenario: non-textual elements render one-line placeholders
//   Scenario: pass-through wrappers render nothing
//   Scenario: cols caps every line width
//   Scenario: plain HTML children render as wrapped text

import { describe, it, expect, beforeEach } from 'vitest';
import { renderElementAsText, PASS_THROUGH_TAGS } from '../../src/shared/text-render/index.js';

function el(html: string, tag = 'div'): HTMLElement {
  const host = document.createElement(tag);
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

function lines(text: string): string[] {
  return text.split('\n');
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('record-backed renderers', () => {
  it('frames a callout note with the variant in the title', () => {
    const note = el('<sem-note variant="warning">Beware the bare URL.</sem-note>', 'div')
      .querySelector('sem-note')!;
    const out = renderElementAsText(note, { cols: 60 });
    expect(out).toContain('NOTE · warning');
    expect(out).toContain('│ Beware the bare URL.');
    expect(out.startsWith('┌─')).toBe(true);
    expect(out.endsWith('┘')).toBe(true);
  });

  it('honors collapsed — caret and first body line only', () => {
    const host = el(
      '<sem-note variant="info" collapsed>First line here. Second line that must not show at all.</sem-note>',
    );
    const note = host.querySelector('sem-note')!;
    const out = renderElementAsText(note, { cols: 60 });
    expect(out).toContain('▸');
    expect(out).toContain('First line here');
    expect(out).toContain('…');
    expect(out).not.toContain('Second line');
  });

  it('renders a fact: statement, conclusion, incorrect statements', () => {
    const fact = el(
      `<sem-fact id="f1">
         <statement>Tokens rotate</statement>
         <conclusion>clients refresh mid-session</conclusion>
         <incorrect-statement>tokens live 24h</incorrect-statement>
       </sem-fact>`,
    ).querySelector('sem-fact')!;
    const out = renderElementAsText(fact, { cols: 60 });
    expect(out).toContain('✓ FACT (#f1)');
    expect(out).toContain('Tokens rotate');
    expect(out).toContain('⇒ clients refresh mid-session');
    expect(out).toContain('✗ tokens live 24h');
  });

  it('nests collection records with tree glyphs', () => {
    const facts = el(
      `<sem-facts kind="auth" id="deck">
         <sem-fact>First fact.</sem-fact>
         <sem-fact>Second fact.</sem-fact>
       </sem-facts>`,
    ).querySelector('sem-facts')!;
    const out = renderElementAsText(facts, { cols: 60 });
    expect(out).toContain('sem-facts (#deck kind=auth)');
    expect(out).toContain('├─ ✓ FACT');
    expect(out).toContain('│');
    expect(out).toContain('└─ ✓ FACT');
    expect(out).toContain('First fact.');
    expect(out).toContain('Second fact.');
    // continuation lines ride the gutter, never a second connector
    expect(out).not.toContain('├─     First fact.');
  });

  it('renders an aligned table with header rule', () => {
    const table = el(
      `<sem-table id="t">
         <table>
           <caption>Surface</caption>
           <thead><tr><th>token</th><th>ttl</th></tr></thead>
           <tbody>
             <tr><td>access</td><td>15 min</td></tr>
             <tr><td>refresh</td><td>session</td></tr>
           </tbody>
         </table>
       </sem-table>`,
    ).querySelector('sem-table')!;
    const out = renderElementAsText(table, { cols: 60 });
    const ls = lines(out);
    expect(out).toContain('▦ TABLE (#t): Surface');
    expect(ls.some((l) => l.includes('│ token ') && l.includes('│ ttl ')) ).toBe(true);
    expect(ls.some((l) => l.includes('╪'))).toBe(true);
    expect(ls.some((l) => l.includes('│ access ') && l.includes('15 min'))).toBe(true);
  });

  it('renders a progress meter', () => {
    const p = el('<sem-progress value="0.42" label="migration"></sem-progress>')
      .querySelector('sem-progress')!;
    const out = renderElementAsText(p, { cols: 60 });
    expect(out).toMatch(/\[█{5,6}░{7,8}\] 42% migration/);
  });

  it('renders a reveal collapsed until open', () => {
    const closed = el(
      '<sem-reveal data-summary="Why not?">Because tokens leak.</sem-reveal>',
    ).querySelector('sem-reveal')!;
    const closedOut = renderElementAsText(closed, { cols: 60 });
    expect(closedOut).toContain('▸ REVEAL');
    expect(closedOut).toContain('Why not?');
    expect(closedOut).not.toContain('Because tokens leak');

    const open = el(
      '<sem-reveal open data-summary="Why not?">Because tokens leak.</sem-reveal>',
    ).querySelector('sem-reveal')!;
    const openOut = renderElementAsText(open, { cols: 60 });
    expect(openOut).toContain('▾ REVEAL');
    expect(openOut).toContain('Because tokens leak');
  });

  it('renders code verbatim in a frame', () => {
    const code = el(
      '<sem-code lang="ts" filename="a.ts">const x = 1;\nconst y = 2;</sem-code>',
    ).querySelector('sem-code')!;
    const out = renderElementAsText(code, { cols: 60 });
    expect(out).toContain('CODE · a.ts [ts]');
    expect(out).toContain('│ const x = 1;');
    expect(out).toContain('│ const y = 2;');
  });

  it('renders tldr with its label', () => {
    const t = el('<sem-tldr>Short version only.</sem-tldr>').querySelector('sem-tldr')!;
    const out = renderElementAsText(t, { cols: 60 });
    expect(out).toContain('┌─ [TL;DR]');
    expect(out).toContain('│ Short version only.');
  });
});

describe('DOM-read renderers', () => {
  it('renders structured trees with glyphs', () => {
    const tree = el(
      `<sem-file-tree mode="structured">
         <node path="app" kind="dir">
           <node path="server.ts"></node>
           <node path="routes" kind="dir"><node path="auth.ts" label="OIDC"></node></node>
         </node>
       </sem-file-tree>`,
    ).querySelector('sem-file-tree')!;
    const out = renderElementAsText(tree, { cols: 60 });
    expect(out).toContain('SEM-FILE-TREE');
    expect(out).toContain('└─ app/');
    expect(out).toContain('   ├─ server.ts');
    expect(out).toContain('auth.ts — OIDC');
  });

  it('renders faq entries as Q/A', () => {
    const faqs = el(
      `<sem-faqs kind="auth">
         <sem-faq>
           <question>Do tokens expire?</question>
           <answer>Yes — refresh then.</answer>
         </sem-faq>
       </sem-faqs>`,
    ).querySelector('sem-faqs')!;
    const out = renderElementAsText(faqs, { cols: 60 });
    // the entry line carries the question; the answer keeps its label
    expect(out).toContain('└─ Do tokens expire?');
    expect(out).toContain('A: Yes — refresh then.');
  });

  it('renders workflow steps with context parameters', () => {
    const wf = el(
      `<sem-workflow kind="release" duration="45m" label="Cut a release">
         <sem-step action="Build images" gate="CI green">push the tag</sem-step>
       </sem-workflow>`,
    ).querySelector('sem-workflow')!;
    const out = renderElementAsText(wf, { cols: 60 });
    expect(out).toContain('SEM-WORKFLOW (kind=release): Cut a release · 45m');
    expect(out).toContain('1. Build images');
    expect(out).toContain('gate=CI green');
  });

  it('renders meta cards for prose containers', () => {
    const kb = el(
      `<sem-kb kind="auth"><p>Tokens rotate per session.</p></sem-kb>`,
    ).querySelector('sem-kb')!;
    const out = renderElementAsText(kb, { cols: 60 });
    expect(out).toContain('KB (kind=auth)');
    expect(out).toContain('Tokens rotate per session.');
  });
});

describe('placeholders and pass-through', () => {
  it('placeholders render one bracketed line', () => {
    const chat = el('<sem-chat id="c1"><div data-role="user">hi</div><div data-role="bot">yo</div></sem-chat>')
      .querySelector('sem-chat')!;
    const out = renderElementAsText(chat, { cols: 60 });
    expect(out).toBe('[sem-chat #c1: chat · 2 messages]');
  });

  it('pass-through tags render nothing', () => {
    expect(PASS_THROUGH_TAGS.has('sem-source')).toBe(true);
    const src = el('<sem-source><p>inside</p></sem-source>').querySelector('sem-source')!;
    expect(renderElementAsText(src, { cols: 60 })).toBe('');
  });

  it('plain HTML children render as wrapped text', () => {
    const host = el('<div><p>One plain paragraph about tokens.</p><p>And another.</p></div>');
    const out = renderElementAsText(host, { cols: 60 });
    expect(out).toContain('One plain paragraph about tokens.');
    expect(out).toContain('And another.');
  });
});

describe('width discipline', () => {
  it('cols caps every line (small tolerance for tree indents)', () => {
    const facts = el(
      `<sem-facts>
         <sem-fact>This fact carries a rather long statement that will surely exceed the column budget we asked for.</sem-fact>
         <sem-note variant="danger">And a note whose body also runs long enough to wrap past the same budget line.</sem-note>
       </sem-facts>`,
    ).querySelector('sem-facts')!;
    const out = renderElementAsText(facts, { cols: 40 });
    for (const l of lines(out)) {
      expect(l.length).toBeLessThanOrEqual(40 + 10);
    }
    // wrapping actually happened
    expect(lines(out).length).toBeGreaterThan(3);
  });

  it('defaults to 80 cols', () => {
    const note = el(`<sem-note>${'word '.repeat(40)}</sem-note>`).querySelector('sem-note')!;
    const out = renderElementAsText(note);
    for (const l of lines(out)) expect(l.length).toBeLessThanOrEqual(92);
  });
});
