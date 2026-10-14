// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true}}
/**
 * Unit tests — viewer/jail-strip.mjs: the strip pass (design §4.2), the D2
 * consent host scan (§4.5) and unapproved-subresource dropping. happy-dom
 * provides DOMParser; the pass itself is engine-neutral.
 *
 * disableCSSFileLoading: the stripped fixture carries a stylesheet <link>
 * and happy-dom's detached window defaults to http://localhost:3000/ —
 * without the guard happy-dom fetches it, which fails on CI (no listener)
 * and silently hits whatever dev server runs locally.
 */
import { describe, expect, it } from 'vitest';

import {
  collectRemoteHosts,
  dropUnapproved,
  isDangerousUrl,
  stripPayload,
} from '../../viewer/jail-strip.mjs';

const BASE = 'http://localhost:4190/viewer/jail.html';

const strip = (html) => stripPayload(html, { baseUrl: BASE });
const hostsOf = (html) => collectRemoteHosts(strip(html).doc, { baseUrl: BASE });

describe('stripPayload — executable elements', () => {
  it('removes script, including inside <template>', () => {
    const { doc, removed } = strip(
      '<body><script>window.x=1</script><p>keep</p>' +
      '<template><script>window.y=1</script><span>t</span></template></body>',
    );
    expect(doc.querySelectorAll('script').length).toBe(0);
    expect(doc.querySelector('template').content.querySelectorAll('script').length).toBe(0);
    expect(doc.querySelector('p').textContent).toBe('keep');
    expect(doc.querySelector('template').content.querySelector('span')).toBeTruthy();
    expect(removed.elements).toBe(2);
  });

  it('removes iframe/frame/object/embed/applet/base and meta refresh', () => {
    const { doc } = strip(
      '<head><base href="https://evil.example.net/">' +
      '<meta http-equiv="REFRESH" content="0;url=https://evil.example.net/"></head>' +
      '<body><iframe src="https://evil.example.net/"></iframe>' +
      '<object data="x"></object><embed src="x"><applet code="X"></applet></body>',
    );
    for (const tag of ['iframe', 'frame', 'object', 'embed', 'applet', 'base']) {
      expect(doc.querySelectorAll(tag).length).toBe(0);
    }
    expect(doc.querySelectorAll('meta[http-equiv]').length).toBe(0);
  });

  it('keeps stylesheets but drops link[rel=import]', () => {
    const { doc } = strip(
      '<head><link rel="stylesheet" href="/dist/semtext.css">' +
      '<link rel="import" href="https://evil.example.net/x.html"></head><body></body>',
    );
    expect(doc.querySelectorAll('link[rel="import"]').length).toBe(0);
    expect(doc.querySelector('link[rel="stylesheet"]').getAttribute('href')).toBe('/dist/semtext.css');
  });
});

describe('stripPayload — attributes', () => {
  it('removes every on* handler, case-insensitive', () => {
    const { doc, removed } = strip(
      '<body><img src="x.png" onerror="p()" ONLOAD="p()"><div onclick="p()">t</div></body>',
    );
    const img = doc.querySelector('img');
    expect(img.getAttribute('onerror')).toBeNull();
    expect(img.getAttribute('ONLOAD')).toBeNull();
    expect(img.getAttribute('src')).toBe('x.png');
    expect(doc.querySelector('div').getAttribute('onclick')).toBeNull();
    expect(removed.attrs).toBe(3);
  });

  it('removes javascript:/vbscript:/data:text/html URL attributes', () => {
    const { doc, removed } = strip(
      '<body><a href="javascript:alert(1)">a</a>' +
      '<a href="vbscript:msgbox">b</a>' +
      '<a href="data:text/html,<script>x</script>">c</a>' +
      '<a href="JaVaScRiPt:alert(2)">d</a>' +
      '<img src="data:image/png;base64,AAAA" alt="ok-img"></body>',
    );
    const hrefs = [...doc.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([null, null, null, null]);
    // data:image is passive and survives
    expect(doc.querySelector('img').getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(removed.urls).toBe(4);
  });

  it('defeats scheme obfuscation (tab inside the scheme, decoded by the parser)', () => {
    const { doc } = strip('<body><a href="jav&#x09;ascript:alert(1)">x</a></body>');
    expect(doc.querySelector('a').getAttribute('href')).toBeNull();
  });

  it('keeps ordinary and relative URLs', () => {
    const { doc } = strip(
      '<body><a href="https://example.net/page">ok</a><a href="#frag">f</a>' +
      '<a href="/local/page">rel</a></body>',
    );
    expect([...doc.querySelectorAll('a')].map((a) => a.getAttribute('href')))
      .toEqual(['https://example.net/page', '#frag', '/local/page']);
  });
});

describe('isDangerousUrl — unit edge cases', () => {
  it('classifies schemes', () => {
    expect(isDangerousUrl('javascript:x')).toBe(true);
    expect(isDangerousUrl('  JAVASCRIPT:x')).toBe(true);
    expect(isDangerousUrl('jav\tascript:x')).toBe(true);
    expect(isDangerousUrl('vbscript:x')).toBe(true);
    expect(isDangerousUrl('data:text/html;base64,PGI+')).toBe(true);
    expect(isDangerousUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isDangerousUrl('/same/origin')).toBe(false);
    expect(isDangerousUrl('#frag')).toBe(false);
    expect(isDangerousUrl('')).toBe(false);
    expect(isDangerousUrl('https://example.net/')).toBe(false);
  });
});

describe('collectRemoteHosts — D2 consent scan', () => {
  it('lists distinct remote hosts from img/srcset/style/@import, excluding same-origin and data:', () => {
    const hosts = hostsOf(
      '<head><style>@import url("https://fonts.example.net/a.css");</style></head>' +
      '<body>' +
      '<img src="https://beacons.example.net/p.png">' +
      '<img src="/local.png">' + // same-origin (relative) — excluded
      '<img src="http://localhost:4190/also-local.png">' + // same-origin absolute — excluded
      '<img src="data:image/gif;base64,AAAA">' + // no host — excluded
      '<img srcset="https://cdn-one.example.net/s.png 1x, https://cdn-two.example.net/s.png 2x">' +
      '<p style="background: url(https://styles.example.net/bg.png)">t</p>' +
      '<template><img src="https://beacons.example.net/in-template.png"></template>' +
      '</body>',
    );
    expect(hosts).toEqual([
      'beacons.example.net',
      'cdn-one.example.net',
      'cdn-two.example.net',
      'fonts.example.net',
      'styles.example.net',
    ]);
  });

  it('returns nothing for a fully local document', () => {
    expect(hostsOf('<body><p>plain</p><img src="/x.png"></body>')).toEqual([]);
  });
});

describe('dropUnapproved — unapproved hosts neutralised, approved kept', () => {
  const DOC =
    '<body>' +
    '<img src="https://beacons.example.net/p.png">' +
    '<img src="https://cdn-one.example.net/s.png">' +
    '<img srcset="https://beacons.example.net/s.png 1x, https://cdn-one.example.net/s.png 2x">' +
    '<p style="background: url(https://beacons.example.net/bg.png)">t</p>' +
    '<style>p { background: url("https://beacons.example.net/in-css.png"); color: red; }</style>' +
    '</body>';

  it('drops blocked hosts from attrs, srcset and CSS; keeps approved', () => {
    const { doc } = strip(DOC);
    const result = dropUnapproved(doc, ['cdn-one.example.net'], { baseUrl: BASE });

    const srcs = [...doc.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    expect(srcs[0]).toBeNull(); // beacons — dropped
    expect(srcs[1]).toBe('https://cdn-one.example.net/s.png'); // approved — kept

    const srcset = doc.querySelectorAll('img')[2].getAttribute('srcset');
    expect(srcset).toBe('https://cdn-one.example.net/s.png 2x'); // blocked candidate filtered

    expect(doc.querySelector('p').getAttribute('style')).not.toContain('beacons.example.net');
    expect(doc.querySelector('p').getAttribute('style')).toContain('url(about:invalid)');

    const styleText = doc.querySelector('style').textContent;
    expect(styleText).not.toContain('beacons.example.net');
    expect(styleText).toContain('url(about:invalid)');
    expect(styleText).toContain('color: red'); // surviving declarations intact

    expect(result.droppedAttrs).toBe(2); // img src + a srcset candidate
    expect(result.droppedCss).toBe(2); // style= url() + <style> url()
  });

  it('approving every host drops nothing', () => {
    const { doc } = strip(DOC);
    const result = dropUnapproved(
      doc,
      ['beacons.example.net', 'cdn-one.example.net'],
      { baseUrl: BASE },
    );
    expect(result.droppedAttrs).toBe(0);
    expect(result.droppedCss).toBe(0);
    expect(doc.querySelector('style').textContent).toContain('beacons.example.net');
  });
});
