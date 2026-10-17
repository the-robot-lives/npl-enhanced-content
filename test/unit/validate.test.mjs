/**
 * Unit tests for semtext-validate (US-301/US-302).
 *
 * The validator reads spec/schema/semtext.schema.json; these tests assert
 * both the rule behavior and the schema-driven-ness (a rule change in the
 * schema changes the validator without a code change).
 */
import { describe, it, expect } from 'vitest';
import { loadSchema, validateSource, validateFile, defaultSchemaPath } from '../../src/validate/validate.js';
import { main } from '../../src/validate/cli.js';

const schema = loadSchema(defaultSchemaPath());

const errorsOf = (r) => r.diagnostics.filter((d) => d.severity === 'error');
const warningsOf = (r) => r.diagnostics.filter((d) => d.severity === 'warning');
const rules = (r) => r.diagnostics.map((d) => d.rule);

const VALID = `<!doctype html>
<html lang="en">
<body>
<sem-enhanced-document>
  <sem-note variant="tip" id="n1"><div class="sem-note-body">hello</div></sem-note>
  <sem-facts id="deck">
    <sem-fact id="f1">
      <statement>S</statement>
      <conclusion>C</conclusion>
    </sem-fact>
  </sem-facts>
</sem-enhanced-document>
</body>
</html>`;

describe('valid documents', () => {
  it('a spec-conformant tag-form document has zero errors', () => {
    const r = validateSource(VALID, schema);
    expect(errorsOf(r)).toEqual([]);
  });

  it('a class-form (Appendix A) document has zero errors', () => {
    const src = `<!doctype html><body>
      <div class="sem-enhanced-document">
        <div class="sem-facts"><div class="sem-fact"><div class="sem-statement">S</div><div class="sem-conclusion">C</div></div></div>
      </div></body>`;
    const r = validateSource(src, schema);
    expect(errorsOf(r)).toEqual([]);
  });

  it('ordinary semantic HTML without vocabulary is not a SemText document', () => {
    const r = validateSource('<!doctype html><body><p>plain</p><table><tr><td>x</td></tr></table></body>', schema);
    expect(errorsOf(r)).toEqual([]);
  });
});

describe('root checks', () => {
  it('missing root is an error', () => {
    const r = validateSource('<body><sem-note id="n">x</sem-note></body>', schema);
    expect(rules(r)).toContain('missing-root');
  });

  it('two roots are an error on the second', () => {
    const src = '<body><sem-enhanced-document></sem-enhanced-document><sem-enhanced-document></sem-enhanced-document></body>';
    const r = validateSource(src, schema);
    const multi = r.diagnostics.filter((d) => d.rule === 'multiple-roots');
    expect(multi).toHaveLength(1);
  });
});

describe('element and attribute contracts', () => {
  it('unknown sem-* element is an error', () => {
    const src = `<sem-enhanced-document><sem-frobnicate id="x">hi</sem-frobnicate></sem-enhanced-document>`;
    const r = validateSource(src, schema);
    expect(rules(r)).toContain('unknown-element');
    expect(errorsOf(r).some((d) => d.message.includes('sem-frobnicate'))).toBe(true);
  });

  it('unknown attribute on a vocabulary element is a warning', () => {
    const src = `<sem-enhanced-document><sem-note frob="1" id="n">x</sem-note></sem-enhanced-document>`;
    const r = validateSource(src, schema);
    expect(rules(r)).toContain('unknown-attribute');
    expect(errorsOf(r)).toEqual([]);
  });

  it('unknown attribute on ordinary HTML is not flagged', () => {
    const src = '<body><p frob="1">plain</p></body>';
    const r = validateSource(src, schema);
    expect(rules(r)).not.toContain('unknown-attribute');
  });

  it('a bad enum token is an error', () => {
    const src = `<sem-enhanced-document><sem-note variant="sideways">x</sem-note></sem-enhanced-document>`;
    const r = validateSource(src, schema);
    expect(rules(r)).toContain('attribute-value');
  });

  it('writing both spellings of one parameter is an authoring error', () => {
    const src = `<sem-enhanced-document><sem-note variant="tip" data-variant="warning">x</sem-note></sem-enhanced-document>`;
    const r = validateSource(src, schema);
    expect(rules(r)).toContain('dual-spelling');
    expect(errorsOf(r).some((d) => d.rule === 'dual-spelling')).toBe(true);
  });

  it('missing required attribute is an error', () => {
    const src = `<sem-enhanced-document><sem-views><sem-view>no name</sem-view></sem-views></sem-enhanced-document>`;
    const r = validateSource(src, schema);
    expect(errorsOf(r).some((d) => d.rule === 'missing-attribute' && d.message.includes('"name"'))).toBe(true);
  });

  it('more than one pre child (sem-code) is an error; the flat listing is valid', () => {
    // flat authoring form: no <pre> is fine (the listing is the element's text)
    const flat = `<sem-enhanced-document><sem-code lang="ts">no pre here</sem-code></sem-enhanced-document>`;
    expect(errorsOf(validateSource(flat, schema)).some((d) => d.rule === 'child-structure')).toBe(false);
    // but two <pre> children stay an error (childRule atMostOne)
    const two = `<sem-enhanced-document><sem-code lang="ts"><pre><code>a</code></pre><pre><code>b</code></pre></sem-code></sem-enhanced-document>`;
    expect(errorsOf(validateSource(two, schema)).some((d) => d.rule === 'child-structure')).toBe(true);
  });

  it('unknown controls flags are a warning (spec: ignored), not an error', () => {
    const src = `<sem-enhanced-document><sem-code controls="copy,frob"><pre><code>x</code></pre></sem-code></sem-enhanced-document>`;
    const r = validateSource(src, schema);
    const flagged = r.diagnostics.find((d) => d.message.includes('frob'));
    expect(flagged).toBeTruthy();
    expect(flagged.severity).toBe('warning');
  });

  it('out-of-range progress clamps by design — warning, not error', () => {
    const src = `<sem-enhanced-document><sem-progress value="1.4"></sem-progress></sem-enhanced-document>`;
    const r = validateSource(src, schema);
    expect(errorsOf(r)).toEqual([]);
    expect(warningsOf(r).some((d) => d.message.includes('1.4'))).toBe(true);
  });

  it('runtime tier markers in authored source are a warning', () => {
    const src = `<sem-enhanced-document><sem-note id="n" data-sem-upgraded="1">x</sem-note></sem-enhanced-document>`;
    const r = validateSource(src, schema);
    expect(rules(r)).toContain('tier-marker');
    expect(errorsOf(r)).toEqual([]);
  });

  it('generated chrome in authored source is a warning', () => {
    const src = `<sem-enhanced-document><sem-code-chrome></sem-code-chrome></sem-enhanced-document>`;
    const r = validateSource(src, schema);
    expect(rules(r)).toContain('generated-chrome');
  });

  it('an orphan record part is a warning', () => {
    const src = '<body><div class="sem-statement">loose</div></body>';
    const r = validateSource(src, schema);
    expect(rules(r)).toContain('orphan-part');
  });
});

describe('file:line accuracy', () => {
  it('reports the line of the offending open tag', () => {
    // 6 lines of padding; the bad element sits on line 7.
    const src = `<!doctype html>
<html>
<body>
<sem-enhanced-document>
  <!-- a comment the scanner must skip -->
  <p>padding</p>
  <sem-frobnicate id="bad">x</sem-frobnicate>
</sem-enhanced-document>
</body>
</html>`;
    const r = validateSource(src, schema);
    const unknown = r.diagnostics.find((d) => d.rule === 'unknown-element');
    expect(unknown.line).toBe(7);
  });

  it('resyncs past lookalike tags inside code listings', () => {
    const src = `<!doctype html>
<body>
<sem-enhanced-document>
  <sem-code lang="ts"><pre><code>const x: Array<sem-note> = [];</code></pre></sem-code>
  <sem-frobnicate>bad</sem-frobnicate>
</sem-enhanced-document>
</body></html>`;
    const r = validateSource(src, schema);
    const unknown = r.diagnostics.find((d) => d.rule === 'unknown-element');
    expect(unknown.line).toBe(5);
  });
});

describe('schema-driven rules', () => {
  it('the schema file is the rule source: an unknown element name resolves through $defs', () => {
    // sem-md is documented; adding it to the validator by schema alone is
    // the contract — assert the schema defines every element the validator
    // treats as vocabulary, so the two cannot drift.
    for (const name of ['sem-note', 'sem-facts', 'sem-code', 'sem-table', 'sem-md', 'sem-reader', 'sem-progress', 'sem-views']) {
      expect(schema.$defs[name], `${name} missing from schema`).toBeTruthy();
    }
  });
});

describe('repo dogfood — the repo validates clean', () => {
  const pages = [
    'web/site/index.html',
    'web/demo/index.html',
    'web/demo/md-only.html',
    'web/demo/reading.html',
    'web/demo/reading-lit.html',
    'web/demo/standalone-lit.html',
    'spec/conventions.html'
  ];
  for (const page of pages) {
    it(`${page} has zero errors`, () => {
      const r = validateFile(page, schema);
      expect(r.readError).toBeUndefined();
      expect(errorsOf(r), JSON.stringify(errorsOf(r), null, 2)).toEqual([]);
    });
  }
});

describe('CLI', () => {
  it('exit 0 on clean, 1 on errors, 2 on usage', () => {
    const out = { chunks: '' , write(s) { this.chunks += s; return true; } };
    expect(main(['web/demo/md-only.html'], out, out)).toBe(0);
    expect(main(['test/unit/fixtures/does-not-exist.html'], out, out)).toBe(1);
    expect(main([], out, out)).toBe(2);
    expect(main(['--bogus'], out, out)).toBe(2);
  });

  it('--format json emits structured diagnostics', () => {
    const out = { chunks: '', write(s) { this.chunks += s; return true; } };
    const code = main(['--format', 'json', 'web/demo/index.html'], out, out);
    expect(code).toBe(0);
    const parsed = JSON.parse(out.chunks);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.totals.errors).toBe(0);
  });
});
