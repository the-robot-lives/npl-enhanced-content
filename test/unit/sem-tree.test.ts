// @vitest-environment happy-dom
// Unit spec — the sem-tree engine's pure logic (spec/schema/
// sem-site-tree.md, sem-file-tree.md): both authoring forms parse to the
// same model, the filter keeps ancestor chains, find marks in document
// order. No chrome is built here — components only.
import { describe, it, expect } from 'vitest';
import {
  parseStructuredTree,
  parseTreeText,
  parseTreeContainer,
  flattenTree,
  filterTree,
  findInTree,
  ancestorsOf,
} from '../../src/lit/sem-tree.js';

const paths = (roots) => {
  const out = [];
  const walk = (nodes, prefix) => {
    for (const n of nodes) {
      // text-mode paths are segments (composed against the parent);
      // structured-mode paths are authored full paths (already prefixed)
      const p =
        prefix && !n.path.startsWith(`${prefix}/`) ? `${prefix}/${n.path}` : n.path;
      out.push(p);
      walk(n.children, p);
    }
  };
  walk(roots, '');
  return out;
};

describe('parseTreeText — box-drawing form', () => {
  const BOX = `assets/
├── icons/
│   └── logo.svg
├── main.css
└── app.js
`;

  it('parses depth in 4-column segments', () => {
    expect(paths(parseTreeText(BOX))).toEqual([
      'assets',
      'assets/icons',
      'assets/icons/logo.svg',
      'assets/main.css',
      'assets/app.js',
    ]);
  });

  it('derives kind from the trailing slash', () => {
    const roots = parseTreeText(BOX);
    expect(roots[0].kind).toBe('dir');
    expect(roots[0].children[1].kind).toBeNull(); // main.css
  });

  it('the unicode model matches the structured parser on the same shape', () => {
    const doc = new DOMParser().parseFromString(
      `<sem-site-tree>
        <node path="assets" kind="dir">
          <node path="icons" kind="dir"><node path="logo.svg" kind="file"></node></node>
          <node path="main.css" kind="file"></node>
          <node path="app.js" kind="file"></node>
        </node>
      </sem-site-tree>`,
      'text/html'
    );
    const structured = parseStructuredTree(doc.body.firstElementChild);
    expect(paths(structured)).toEqual(paths(parseTreeText(BOX)));
  });
});

describe('parseTreeText — plain indentation', () => {
  it('measures depth in the smallest positive indent unit', () => {
    const text = 'a\n  b\n    c\n  d\ne\n';
    expect(paths(parseTreeText(text))).toEqual(['a', 'a/b', 'a/b/c', 'a/d', 'e']);
  });

  it('skips blank lines and tolerates deep jumps', () => {
    const text = 'root\n\n      child\n';
    expect(paths(parseTreeText(text))).toEqual(['root', 'root/child']);
  });
});

describe('parseStructuredTree + parseTreeContainer', () => {
  it('reads node elements (attrs, both spellings) recursively', () => {
    const doc = new DOMParser().parseFromString(
      `<sem-site-tree>
        <node path="src" data-label="Source" kind="dir">
          <node path="src/x.ts"></node>
        </node>
      </sem-site-tree>`,
      'text/html'
    );
    const [root] = parseStructuredTree(doc.body.firstElementChild);
    expect(root.path).toBe('src');
    expect(root.label).toBe('Source');
    expect(root.kind).toBe('dir');
    expect(root.children[0].path).toBe('src/x.ts');
  });

  it('accepts the .sem-node class alias form', () => {
    const doc = new DOMParser().parseFromString(
      `<div class="sem-site-tree"><div class="sem-node" data-path="a"><div class="sem-node" data-path="a/b"></div></div></div>`,
      'text/html'
    );
    expect(paths(parseStructuredTree(doc.body.firstElementChild))).toEqual(['a', 'a/b']);
  });

  it('dispatches: node children → structured; a pre → text; mode attr overrides', () => {
    const doc = new DOMParser().parseFromString(
      `<sem-site-tree id="s"><node path="a"></node></sem-site-tree>
       <sem-file-tree id="t" mode="text"><pre>z</pre></sem-file-tree>
       <sem-file-tree id="u"><node path="a"></node></sem-file-tree>`,
      'text/html'
    );
    const $ = (id) => doc.getElementById(id);
    expect(parseTreeContainer($('s')).mode).toBe('structured');
    expect(parseTreeContainer($('t')).mode).toBe('text');
    expect(parseTreeContainer($('u')).mode).toBe('structured');
  });
});

describe('filterTree — keeps the ancestor chain', () => {
  const roots = parseTreeText('a\n  b\n    target\n  c\nd\n');

  it('keeps matching nodes plus every ancestor, nothing else', () => {
    const { kept } = filterTree(roots, 'target');
    expect([...kept].map((n) => n.path).sort()).toEqual(['a', 'b', 'target']);
  });

  it('matches on label too', () => {
    const labelled = parseTreeText('src\n  main.ts\n');
    labelled[0].label = 'Source';
    const { kept } = filterTree(labelled, 'source');
    expect([...kept].map((n) => n.path)).toEqual(['src']);
  });

  it('matches are case-insensitive substrings of path or label', () => {
    const { kept } = filterTree(roots, 'TAR');
    // the match plus its ancestor chain — nothing else (c, d never kept)
    expect([...kept].map((n) => n.path).sort()).toEqual(['a', 'b', 'target']);
  });

  it('an empty query clears the filter (kept = null)', () => {
    const { kept, open } = filterTree(roots, '   ');
    expect(kept).toBeNull();
    expect(open.size).toBe(0);
  });

  it('flags branch roots that must force open (ancestors of matches)', () => {
    const { open } = filterTree(roots, 'target');
    expect([...open].map((n) => n.path).sort()).toEqual(['a', 'b']);
  });
});

describe('findInTree + ancestorsOf', () => {
  const roots = parseTreeText('root\n  lib\n    util.ts\n  lib-util.ts\n');
  const flat = flattenTree(roots);

  it('returns matches in document order (depth-first)', () => {
    expect(findInTree(roots, 'util').map((n) => n.path)).toEqual(['util.ts', 'lib-util.ts']);
  });

  it('empty query → no matches', () => {
    expect(findInTree(roots, '')).toEqual([]);
  });

  it('flatten assigns stable document-order ids and parents', () => {
    expect(flat.map((f) => f.node.path)).toEqual(['root', 'lib', 'util.ts', 'lib-util.ts']);
    expect(flat[2].parent).toBe(flat[1]);
    expect(flat[1].parent).toBe(flat[0]);
    expect(flat[0].parent).toBeNull();
  });

  it('ancestorsOf walks root-first for the find cycler', () => {
    expect(ancestorsOf(flat[2]).map((f) => f.node.path)).toEqual(['root', 'lib']);
    expect(ancestorsOf(flat[0])).toEqual([]);
  });
});
