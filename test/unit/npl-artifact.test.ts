// @vitest-environment happy-dom
// Unit spec — npl-artifact (src/lit/npl/npl-artifact.ts)
//
// Feature: a display-only structured-output block with metadata
//   Scenario: the barrel registers npl-artifact
//   Scenario: type="code" renders the title as a heading and the content
//             as a <pre>, preserving authored inner nodes, in light DOM
//   Scenario: absent type falls back to preformatted text
//   Scenario: type="svg" moves the markup into an empty-sandbox iframe via
//             srcdoc — never inlined — so no script runs; the iframe takes
//             the title as accessible name and mirrors the svg's pixel size
//   Scenario: data-type wins over bare type (dual-form contract) and the
//             bare spelling mirrors to data-type
//   Scenario: class-form alias (.npl-title / .npl-content) enhances alike

import { describe, it, expect, beforeEach } from 'vitest';
import { NplArtifact } from '../../src/lit/npl/npl-artifact.js';

/** updateComplete + one macrotask: whenChildrenReady resolves in a microtask. */
async function settle(el: NplArtifact): Promise<NplArtifact> {
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  return el;
}

describe('npl-artifact', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete (window as { pwned?: unknown }).pwned;
  });

  it('the barrel registers npl-artifact', async () => {
    await import('../../src/lit/npl/index.js');
    expect(customElements.get('npl-artifact')).toBe(NplArtifact);
  });

  it('type="code": title renders as a heading, content as a <pre>, light DOM', async () => {
    document.body.innerHTML =
      '<npl-artifact id="a" type="code"><title>Q3 report</title>' +
      '<content>def q3():<br>  return rows()</content>extra</npl-artifact>';
    const el = await settle(document.getElementById('a') as NplArtifact);

    expect(el.shadowRoot).toBeNull();
    expect(el.hasAttribute('data-sem-upgraded')).toBe(true);

    const heading = el.querySelector('h3.npl-artifact-title');
    expect(heading?.textContent).toBe('Q3 report');

    const pre = el.querySelector('pre.npl-artifact-content');
    expect(pre?.textContent).toContain('def q3():');
    expect(pre?.querySelector('br')).not.toBeNull(); // authored inner nodes preserved

    // the authored parts are gone — replaced by their chrome, not duplicated
    expect(el.querySelector('title, content')).toBeNull();
    // authored siblings survive untouched beside the chrome
    expect(el.textContent).toContain('extra');
  });

  it('absent type falls back to preformatted text', async () => {
    document.body.innerHTML =
      '<npl-artifact id="a"><title>note</title><content>plain words</content></npl-artifact>';
    const el = await settle(document.getElementById('a') as NplArtifact);
    expect(el.querySelector('pre.npl-artifact-content')?.textContent).toBe('plain words');
    expect(el.querySelector('iframe')).toBeNull();
  });

  it('type="svg": markup goes to an empty-sandbox iframe srcdoc, never inlined; no script runs', async () => {
    document.body.innerHTML =
      '<npl-artifact id="a" type="svg"><title>chart</title>' +
      '<content><svg width="10" height="10" onload="window.pwned = 1">' +
      '<circle r="4"/><script>window.pwned = 2<\/script></svg></content></npl-artifact>';
    const el = await settle(document.getElementById('a') as NplArtifact);

    const frame = el.querySelector('iframe.npl-artifact-svg');
    expect(frame).not.toBeNull();
    // strictest sandbox: the attribute is PRESENT and EMPTY
    expect(frame!.hasAttribute('sandbox')).toBe(true);
    expect(frame!.getAttribute('sandbox')).toBe('');
    const srcdoc = frame!.getAttribute('srcdoc') ?? '';
    expect(srcdoc).toContain('<svg');
    expect(srcdoc).toContain('window.pwned');

    // not inlined anywhere in the light DOM: no svg/script chrome, and the
    // only preformatted fallback chrome is absent
    expect(el.querySelector('content, svg, script')).toBeNull();
    expect(el.querySelector('pre')).toBeNull();
    // and nothing executed: the payload's globals were never set
    expect((window as { pwned?: unknown }).pwned).toBeUndefined();
    // title still renders as a heading
    expect(el.querySelector('h3.npl-artifact-title')?.textContent).toBe('chart');
    // accessible name: the heading text, not an untitled frame (axe frame-title)
    expect(frame!.getAttribute('title')).toBe('chart');
    // legacy chrome dropped; authored svg dimensions mirrored to the box
    expect(frame!.getAttribute('frameborder')).toBe('0');
    expect(frame!.getAttribute('width')).toBe('10');
    expect(frame!.getAttribute('height')).toBe('10');
  });

  it('data-type wins over bare type; bare type mirrors to data-type', async () => {
    document.body.innerHTML =
      '<npl-artifact id="a" type="code" data-type="svg">' +
      '<title>t</title><content><svg><rect/></svg></content></npl-artifact>' +
      '<npl-artifact id="b" type="code"><title>t</title><content>x</content></npl-artifact>';
    const a = await settle(document.getElementById('a') as NplArtifact);
    const b = await settle(document.getElementById('b') as NplArtifact);

    expect(a.querySelector('iframe.npl-artifact-svg')).not.toBeNull(); // data-type won
    expect(a.getAttribute('data-type')).toBe('svg'); // mirror did not clobber it
    // authored svg declared no size — the frame stays unsized (UA default,
    // theme-layer territory), not a fabricated box
    expect(a.querySelector('iframe')?.hasAttribute('width')).toBe(false);

    expect(b.querySelector('pre.npl-artifact-content')).not.toBeNull();
    expect(b.getAttribute('data-type')).toBe('code'); // bare form mirrored
  });

  it('class-form alias .npl-title / .npl-content enhances alike', async () => {
    document.body.innerHTML =
      '<npl-artifact id="a" type="text" class="npl-artifact">' +
      '<span class="npl-title">alias head</span>' +
      '<span class="npl-content">alias body</span></npl-artifact>';
    const el = await settle(document.getElementById('a') as NplArtifact);
    expect(el.querySelector('h3.npl-artifact-title')?.textContent).toBe('alias head');
    expect(el.querySelector('pre.npl-artifact-content')?.textContent).toBe('alias body');
  });
});
