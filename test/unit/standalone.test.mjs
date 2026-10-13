// Unit spec — scripts/standalone-lib.mjs · the pure half of build-standalone
//
// Feature: the nojs stripper and the spec-page copy behave without a build
//   Scenario: stripScripts removes every script element, including nested reveals
//   Scenario: stripScripts ignores a script tag mentioned inside an HTML comment
//   Scenario: stripScripts throws on an unclosed opener instead of truncating
//   Scenario: specAssetRefs lists real relative links only, resolved per prefix
//   Scenario: rewriteSpecPage rewrites ../dist/ on real tags and leaves listings alone

import { describe, it, expect } from 'vitest';
import { stripScripts, specAssetRefs, rewriteSpecPage } from '../../scripts/standalone-lib.mjs';

describe('stripScripts', () => {
  it('removes every script element and the markers they leave', () => {
    const out = stripScripts('<p>a</p><script>x</script><script src="b.js"></script ><p>b</p>');
    expect(out).toBe('<p>a</p><p>b</p>');
  });

  it('removes a pair that only becomes adjacent after another is removed', () => {
    const out = stripScripts('<scr<script>x</script>ipt>y</script>');
    expect(out).not.toMatch(/<script/i);
  });

  it('ignores a script tag mentioned inside an HTML comment', () => {
    const src = '<!-- loaded by <script src> --><link href="a.css"><script>x</script><p>kept</p>';
    const out = stripScripts(src);
    expect(out).toContain('<link href="a.css">');
    expect(out).toContain('<p>kept</p>');
  });

  it('throws on an unclosed opener rather than truncating to the end of the file', () => {
    expect(() => stripScripts('<p>a</p>\n<script>\nx\n<p>b</p>')).toThrow(/unclosed <script opener at line 2/);
  });
});

describe('specAssetRefs', () => {
  it('lists relative links from real tags, resolved by prefix, without fragments or queries', () => {
    const html = [
      '<link rel="stylesheet" href="../themes/x.css">',
      '<link rel="stylesheet" href="spec.css?v=2">',
      '<script src="../dist/semtext.js"></script>',
      '<a href="/README.md#top">root</a>',
      '<a href="https://example.com/a.css">abs</a>',
      '<a href="#local">frag</a>',
      '<img src="data:image/png;base64,AAAA">',
      '<pre><code>&lt;link href="semtext/themes/x.css"&gt;</code></pre>',
    ].join('\n');
    expect(specAssetRefs(html)).toEqual([
      { ref: '../themes/x.css', rel: 'themes/x.css' },
      { ref: 'spec.css', rel: 'spec/spec.css' },
      { ref: '../dist/semtext.js', rel: 'dist/semtext.js' },
      { ref: '/README.md', rel: 'README.md' },
    ]);
  });
});

describe('rewriteSpecPage', () => {
  it('rewrites ../dist/ on link and script tags only', () => {
    const html = '<script src="../dist/a.js"></script><link href="../dist/b.css"><pre>&lt;script src="../dist/a.js"&gt;</pre><p>../dist/prose</p>';
    expect(rewriteSpecPage(html)).toBe('<script src="../a.js"></script><link href="../b.css"><pre>&lt;script src="../dist/a.js"&gt;</pre><p>../dist/prose</p>');
  });

  it('appends the cache-bust version to bundle script srcs, never to link/css or escaped text', () => {
    const html = '<script defer src="../dist/semtext.js"></script><link href="../dist/semtext.css"><pre>&lt;script src="../dist/semtext.js"&gt;</pre>';
    expect(rewriteSpecPage(html, 'deadbeefcafe1234')).toBe(
      '<script defer src="../semtext.js?v=deadbeefcafe1234"></script><link href="../semtext.css"><pre>&lt;script src="../dist/semtext.js"&gt;</pre>',
    );
  });
});
