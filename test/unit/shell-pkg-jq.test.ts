// Unit spec — the jq package (src/terminal/packages/jq/): the jq subset
// through the LAZY PATH (stub registration → chunk source injected as the
// loader, exactly what the build bundles into semtext-pkg-jq.js).
//
// Feature: paths and iteration
//   Scenario: field paths, quoted keys, indexes, slices, .[] over both shapes,
//             null propagation, missing keys, ? suppression
// Feature: pipe, comma, construction
//   Scenario: pipelines, multi-output, [..], {..} (incl. $var, computed keys,
//             shorthand), string interpolation
// Feature: builtins — selection/construction, sorting/shape, strings, formats
// Feature: operators — arithmetic across types, comparisons in jq's total
//          order, and/or/not truthiness, // alternative, if/elif/else,
//          try/catch and ? error containment
// Feature: reduce and as-bindings
// Feature: CLI options — -r -c -s -n --arg --argjson, bundling, help/version,
//          exit codes 0/2/3/5, files and the pipe
// Feature: json — pretty-print, compact, raw, validation errors
// Feature: edges — empty input, CRLF, unicode, number rendering
// Feature: package contract — stub answers pre-load, load error, man swap

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TerminalCore, type ExecResult } from '../../src/terminal/terminal-core.js';
import { posixPlugin } from '../../src/terminal/plugins/posix/plugin.js';
import { createLazyPackage } from '../../src/terminal/packages/lazy.js';
import { jqStub } from '../../src/terminal/packages/jq/stub.js';
import { commands as chunkCommands, manPages } from '../../src/terminal/packages/jq/index.js';

vi.setConfig({ testTimeout: 5_000 });

/** The package under test: the production stub + the real chunk source as the loader. */
const pkg = createLazyPackage(jqStub, async () => {
  const mod = await import('../../src/terminal/packages/jq/index.js');
  return { commands: mod.commands, manPages: mod.manPages };
});

let core: TerminalCore;
const out = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stdout').map((l) => l.text);
const errs = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stderr').map((l) => l.text);
const status = (r: ExecResult): number => r.state.lastStatus;
const run = (line: string): ExecResult => core.execLine(line);
/** Expected-shape helper: each chunk is one rendered value (pretty values are multi-line). */
const lines = (...chunks: string[]): string[] => chunks.flatMap((c) => c.split('\n'));
const jq = (program: string, input: string): string[] => out(run(`echo '${input}' | jq '${program}'`));

beforeEach(async () => {
  core = new TerminalCore();
  expect(core.mountPlugin(posixPlugin).ok).toBe(true);
  expect(core.mountPlugin({ name: 'pkg-jq-test', version: '0', commands: pkg.commands, files: [] }).ok).toBe(true);
  core.vfs.mountFile('/u.json', '{"name":"ada","langs":["ml","ts"],"n":3,"nested":{"k":"v"}}\n');
  core.vfs.mountFile('/nums.json', '[5,3,9,1]\n');
  core.vfs.mountFile('/stream.json', '{"a":1}\n{"a":2}\n[3]\n');
  core.vfs.mountFile('/bad.json', '{"a":\n');
  core.vfs.mountFile('/empty.json', '');
  core.vfs.mountFile('/crlf.json', '{\r\n"a": 1\r\n}\r\n');
  core.vfs.mountFile('/uni.json', '{"héllo":"wörld 😀","世界":{"𝔘":"𝔫"}}\n');
  await pkg.ensure();
});

/* ------------------------------------------------------------------ */
/* paths and iteration                                                 */
/* ------------------------------------------------------------------ */

describe('jq — paths and iteration', () => {
  it('field paths, nested, quoted keys', () => {
    expect(jq('.', '{"a":1}')).toEqual(lines('{\n  "a": 1\n}'));
    expect(jq('.a', '{"a":1}')).toEqual(lines('1'));
    expect(jq('.nested.k', '{"nested":{"k":"v"}}')).toEqual(lines('"v"'));
    expect(jq('."a"', '{"a":1}')).toEqual(lines('1'));
    expect(jq('."quoted key"', '{"quoted key":7}')).toEqual(lines('7'));
    expect(jq('.a["b"].c', '{"a":{"b":{"c":3}}}')).toEqual(lines('3'));
  });

  it('array indexing: negative, out-of-range → null, wrong-type errors', () => {
    expect(jq('.[0]', '[9,8]')).toEqual(lines('9'));
    expect(jq('.[-1]', '[9,8]')).toEqual(lines('8'));
    expect(jq('.[5]', '[9,8]')).toEqual(lines('null'));
    expect(jq('.[2]', 'null')).toEqual(lines('null'));
    const r = run(`echo '{"a":1}' | jq '.[1]'`);
    expect(status(r)).toBe(5);
    expect(errs(r).join(' ')).toContain('Cannot index object with number');
  });

  it('slices on arrays and strings, negatives clamp', () => {
    expect(jq('.[1:3]', '[1,2,3,4]')).toEqual(lines('[\n  2,\n  3\n]'));
    expect(jq('.[:2]', '[1,2,3]')).toEqual(lines('[\n  1,\n  2\n]'));
    expect(jq('.[2:]', '[1,2,3,4]')).toEqual(lines('[\n  3,\n  4\n]'));
    expect(jq('.[-2:]', '[1,2,3,4]')).toEqual(lines('[\n  3,\n  4\n]'));
    expect(jq('.[1:1]', '[1,2]')).toEqual(lines('[]'));
    expect(jq('.[0:2]', '"abcd"')).toEqual(lines('"ab"'));
    expect(jq('.[10:20]', '[1]')).toEqual(lines('[]'));
  });

  it('.[] iterates arrays and objects; .[]? suppresses', () => {
    expect(jq('.[]', '[1,2]')).toEqual(lines('1', '2'));
    expect(jq('.[]', '{"a":1,"b":2}')).toEqual(lines('1', '2'));
    expect(jq('.[]?', '5')).toEqual([]);
    expect(status(run(`echo 5 | jq '.[]?'`))).toBe(0);
    expect(errs(run(`echo 5 | jq '.[]'`)).join(' ')).toContain('Cannot iterate over number (5)');
    expect(status(run(`echo 5 | jq '.[]'`))).toBe(5);
  });

  it('missing keys give null; ? stops the error', () => {
    expect(jq('.a', '{}')).toEqual(lines('null'));
    expect(jq('.a?', '5')).toEqual([]);
    expect(status(run(`echo 5 | jq '.a?'`))).toBe(0);
    expect(status(run(`echo 5 | jq '.a'`))).toBe(5);
    expect(errs(run(`echo 5 | jq '.a'`)).join(' ')).toContain('Cannot index number with "a"');
  });

  it('.a?.b vs .a.b? — the ? binds where it is written', () => {
    // {"a":5}: .a? yields 5, then .b errors
    expect(status(run(`echo '{"a":5}' | jq '.a?.b'`))).toBe(5);
    expect(errs(run(`echo '{"a":5}' | jq '.a?.b'`)).join(' ')).toContain('Cannot index number with "b"');
    // .a.b? wraps the whole chain: nothing comes out, no error
    expect(jq('.a.b?', '{"a":5}')).toEqual([]);
    expect(status(run(`echo '{"a":5}' | jq '.a.b?'`))).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* pipe, comma, construction                                           */
/* ------------------------------------------------------------------ */

describe('jq — pipe, comma, construction, interpolation', () => {
  it('pipes feed stage to stage; comma streams both', () => {
    expect(jq('.a | . + 1', '{"a":1}')).toEqual(lines('2'));
    expect(jq('.a, .b', '{"a":1,"b":2}')).toEqual(lines('1', '2'));
    expect(jq('[.[] | . * 2]', '[1,2,3]')).toEqual(lines('[\n  2,\n  4,\n  6\n]'));
    expect(jq('.a | tostring | length', '{"a":"abcd"}')).toEqual(lines('4'));
  });

  it('array and object construction', () => {
    expect(jq('[.[]]', '{"a":1,"b":2}')).toEqual(lines('[\n  1,\n  2\n]'));
    expect(jq('[]', '{"a":1}')).toEqual(lines('[]'));
    expect(jq('{user: .name, n: .n}', '{"name":"ada","n":3}')).toEqual(lines('{\n  "user": "ada",\n  "n": 3\n}'));
    expect(jq('{a}', '{"a":5}')).toEqual(lines('{\n  "a": 5\n}'));
    expect(jq('{"k"}', '{"k":2}')).toEqual(lines('{\n  "k": 2\n}'));
  });

  it('{$var}, {("expr"): val}, {"str": val}', () => {
    expect(out(run(`echo '{}' | jq --arg who ada '{$who}'`))).toEqual(lines('{\n  "who": "ada"\n}'));
    expect(jq('{("k" + "1"): 9}', 'null')).toEqual(lines('{\n  "k1": 9\n}'));
    expect(jq('{"s": 1}', 'null')).toEqual(lines('{\n  "s": 1\n}'));
  });

  it('string interpolation "\\(expr)"', () => {
    expect(jq('"hi \\(.name)!"', '{"name":"ada"}')).toEqual(lines('"hi ada!"'));
    expect(jq('"\\(1+2)"', 'null')).toEqual(lines('"3"'));
    expect(jq('"\\(1,2)-end"', 'null')).toEqual(lines('"1-end"', '"2-end"'));
    expect(jq('"\\(.a)-\\(.b)"', '{"a":1,"b":2}')).toEqual(lines('"1-2"'));
  });
});

/* ------------------------------------------------------------------ */
/* builtins                                                            */
/* ------------------------------------------------------------------ */

describe('jq — selection and shape builtins', () => {
  it('select / map / map_values / with_entries', () => {
    expect(jq('[.[] | select(. > 1)]', '[1,2,3]')).toEqual(lines('[\n  2,\n  3\n]'));
    expect(jq('map(. * 2)', '[1,2]')).toEqual(lines('[\n  2,\n  4\n]'));
    expect(jq('map_values(. + 1)', '{"a":1,"b":2}')).toEqual(lines('{\n  "a": 2,\n  "b": 3\n}'));
    expect(jq('with_entries(select(.key == "a"))', '{"a":1,"b":2}')).toEqual(lines('{\n  "a": 1\n}'));
  });

  it('keys sorts, keys_unsorted preserves, length counts all shapes', () => {
    expect(jq('keys', '{"b":1,"a":2}')).toEqual(lines('[\n  "a",\n  "b"\n]'));
    expect(jq('keys_unsorted', '{"b":1,"a":2}')).toEqual(lines('[\n  "b",\n  "a"\n]'));
    expect(jq('length', '"héllo 😀"')).toEqual(lines('7')); // code points
    expect(jq('length', '[1,2,3]')).toEqual(lines('3'));
    expect(jq('length', '{"a":1}')).toEqual(lines('1'));
    expect(jq('length', 'null')).toEqual(lines('0'));
    expect(jq('length', '-4.5')).toEqual(lines('4.5'));
  });

  it('to_entries / from_entries round trip; has', () => {
    expect(jq('to_entries', '{"a":1}')).toEqual(lines('[\n  {\n    "key": "a",\n    "value": 1\n  }\n]'));
    expect(jq('from_entries', '[{"key":"a","value":1}]')).toEqual(lines('{\n  "a": 1\n}'));
    expect(jq('to_entries | from_entries', '{"a":1,"b":2}')).toEqual(lines('{\n  "a": 1,\n  "b": 2\n}'));
    expect(jq('has("a")', '{"a":1}')).toEqual(lines('true'));
    expect(jq('has("z")', '{"a":1}')).toEqual(lines('false'));
    expect(jq('has(0)', '[9]')).toEqual(lines('true'));
  });

  it('add, range, type, values, not, empty', () => {
    expect(jq('add', '[1,2,3]')).toEqual(lines('6'));
    expect(jq('add', '[]')).toEqual(lines('null'));
    expect(jq('[range(3)]', 'null')).toEqual(lines('[\n  0,\n  1,\n  2\n]'));
    expect(jq('[range(1;4)]', 'null')).toEqual(lines('[\n  1,\n  2,\n  3\n]'));
    expect(jq('[range(0;10;3)]', 'null')).toEqual(lines('[\n  0,\n  3,\n  6,\n  9\n]'));
    expect(jq('type', '"x"')).toEqual(lines('"string"'));
    expect(jq('type', '[1]')).toEqual(lines('"array"'));
    expect(jq('[.[] | values]', '[1,null,2]')).toEqual(lines('[\n  1,\n  2\n]'));
    expect(jq('not', 'true')).toEqual(lines('false'));
    expect(jq('not', 'null')).toEqual(lines('true'));
    expect(jq('empty', '5')).toEqual([]);
    expect(status(run(`echo 5 | jq 'empty'`))).toBe(0);
  });
});

describe('jq — sorting and ordering builtins', () => {
  it('sort / unique / reverse / min / max / first / last', () => {
    expect(jq('sort', '[3,1,2]')).toEqual(lines('[\n  1,\n  2,\n  3\n]'));
    expect(jq('unique', '[2,1,2,3,1]')).toEqual(lines('[\n  1,\n  2,\n  3\n]'));
    expect(jq('reverse', '[1,2,3]')).toEqual(lines('[\n  3,\n  2,\n  1\n]'));
    expect(jq('min', '[3,1,2]')).toEqual(lines('1'));
    expect(jq('max', '[3,1,2]')).toEqual(lines('3'));
    expect(jq('first', '[3,1]')).toEqual(lines('3'));
    expect(jq('last', '[3,1]')).toEqual(lines('1'));
    expect(jq('first', '[]')).toEqual(lines('null'));
  });

  it('sort_by / group_by / unique_by / min_by / max_by key on [f]', () => {
    expect(jq('sort_by(.n)', '[{"n":2},{"n":1}]')).toEqual(lines('[\n  {\n    "n": 1\n  },\n  {\n    "n": 2\n  }\n]'));
    expect(jq('group_by(.k)', '[{"k":"a","v":1},{"k":"b","v":2},{"k":"a","v":3}]')).toEqual(
      lines('[\n  [\n    {\n      "k": "a",\n      "v": 1\n    },\n    {\n      "k": "a",\n      "v": 3\n    }\n  ],\n  [\n    {\n      "k": "b",\n      "v": 2\n    }\n  ]\n]'),
    );
    expect(jq('unique_by(.k)', '[{"k":"a","v":1},{"k":"b","v":2},{"k":"a","v":3}]')).toEqual(
      lines('[\n  {\n    "k": "a",\n    "v": 1\n  },\n  {\n    "k": "b",\n    "v": 2\n  }\n]'),
    );
    expect(jq('min_by(.n)', '[{"n":2},{"n":1}]')).toEqual(lines('{\n  "n": 1\n}'));
    expect(jq('max_by(.n)', '[{"n":2},{"n":1}]')).toEqual(lines('{\n  "n": 2\n}'));
  });

  it('any / all / flatten', () => {
    expect(jq('any', '[false, true]')).toEqual(lines('true'));
    expect(jq('all', '[true, 1]')).toEqual(lines('true'));
    expect(jq('all', '[true, null]')).toEqual(lines('false'));
    expect(jq('any', '[]')).toEqual(lines('false'));
    expect(jq('all', '[]')).toEqual(lines('true'));
    expect(jq('flatten', '[1,[2,[3]]]')).toEqual(lines('[\n  1,\n  2,\n  3\n]'));
    expect(jq('flatten(1)', '[1,[2,[3]]]')).toEqual(lines('[\n  1,\n  2,\n  [\n    3\n  ]\n]'));
  });
});

describe('jq — string builtins and conversions', () => {
  it('join / split', () => {
    expect(jq('join(",")', '["a","b"]')).toEqual(lines('"a,b"'));
    expect(jq('join("-")', '[1,true,null]')).toEqual(lines('"1-true-"'));
    expect(jq('split(",")', '"a,b"')).toEqual(lines('[\n  "a",\n  "b"\n]'));
    expect(jq('split(",")', '""')).toEqual(lines('[\n  ""\n]'));
  });

  it('startswith / endswith / ltrimstr / rtrimstr / case', () => {
    expect(jq('startswith("ab")', '"abc"')).toEqual(lines('true'));
    expect(jq('endswith("c")', '"abc"')).toEqual(lines('true'));
    expect(jq('ltrimstr("a")', '"abc"')).toEqual(lines('"bc"'));
    expect(jq('ltrimstr("x")', '"abc"')).toEqual(lines('"abc"'));
    expect(jq('rtrimstr("c")', '"abc"')).toEqual(lines('"ab"'));
    expect(jq('ascii_downcase', '"AbC"')).toEqual(lines('"abc"'));
    expect(jq('ascii_upcase', '"aBc"')).toEqual(lines('"ABC"'));
  });

  it('tostring / tonumber / tojson / fromjson', () => {
    expect(jq('tostring', '3')).toEqual(lines('"3"'));
    expect(jq('tostring', '"x"')).toEqual(lines('"x"'));
    expect(jq('tonumber', '"3.5"')).toEqual(lines('3.5'));
    expect(jq('tojson', '{"a":1}')).toEqual(lines('"{\\"a\\":1}"'));
    expect(jq('fromjson', '"{\\"a\\":2}"')).toEqual(lines('{\n  "a": 2\n}'));
  });
});

describe('jq — @formats', () => {
  // like real jq, @format results are strings and print JSON-quoted without -r
  it('@csv quotes and empties', () => {
    expect(jq('@csv', '[1,"a b",null,true]')).toEqual(lines('"1,\\"a b\\",,true"'));
    expect(jq('@csv', '["say \\"hi\\""]')).toEqual(lines('"\\"say \\"\\"hi\\"\\"\\""'));
  });
  it('@tsv escapes tabs', () => {
    // field separators AND embedded tabs print as \t inside the JSON string
    expect(jq('@tsv', '[1,"a\\tb",null]')).toEqual(lines('"1\\ta\\\\tb\\t"'));
  });
  it('@json / @text / @base64 / @base64d / @uri / @html', () => {
    expect(jq('@json', '{"a":1}')).toEqual(lines('"{\\"a\\":1}"'));
    expect(jq('@text', '3')).toEqual(lines('"3"'));
    expect(jq('@base64', '"hello"')).toEqual(lines('"aGVsbG8="'));
    expect(jq('@base64d', '"aGVsbG8="')).toEqual(lines('"hello"'));
    expect(jq('@base64 | @base64d', '"round trip"')).toEqual(lines('"round trip"'));
    expect(jq('@uri', '"a b/c"')).toEqual(lines('"a%20b%2Fc"'));
    expect(jq('@html', '"<b>&"')).toEqual(lines('"&lt;b&gt;&amp;"'));
  });
});

/* ------------------------------------------------------------------ */
/* operators                                                           */
/* ------------------------------------------------------------------ */

describe('jq — arithmetic across types', () => {
  it('+ numbers, strings, arrays, objects, null identity', () => {
    expect(jq('1 + 2', 'null')).toEqual(lines('3'));
    expect(jq('"a" + "b"', 'null')).toEqual(lines('"ab"'));
    expect(jq('[1] + [2]', 'null')).toEqual(lines('[\n  1,\n  2\n]'));
    expect(jq('{"a":1} + {"b":2}', 'null')).toEqual(lines('{\n  "a": 1,\n  "b": 2\n}'));
    expect(jq('null + 1', 'null')).toEqual(lines('1'));
    expect(jq('1 + null', 'null')).toEqual(lines('1'));
  });
  it('- numbers and array difference', () => {
    expect(jq('5 - 2', 'null')).toEqual(lines('3'));
    expect(jq('[1,2,3] - [2]', 'null')).toEqual(lines('[\n  1,\n  3\n]'));
  });
  it('* numbers, string repeat, object deep-merge', () => {
    expect(jq('3 * 4', 'null')).toEqual(lines('12'));
    expect(jq('"ab" * 3', 'null')).toEqual(lines('"ababab"'));
    expect(jq('"ab" * 0', 'null')).toEqual(lines('null'));
    expect(jq('{"a":{"x":1},"b":1} * {"a":{"y":2}}', 'null')).toEqual(lines('{\n  "a": {\n    "x": 1,\n    "y": 2\n  },\n  "b": 1\n}'));
  });
  it('/ numbers (zero errors) and split', () => {
    expect(jq('7 / 2', 'null')).toEqual(lines('3.5'));
    expect(jq('"a,b" / ","', 'null')).toEqual(lines('[\n  "a",\n  "b"\n]'));
    expect(status(run(`echo null | jq '1 / 0'`))).toBe(5);
    expect(errs(run(`echo null | jq '1 / 0'`)).join(' ')).toContain('divisor is zero');
  });
  it('% truncates toward zero, requires integers', () => {
    expect(jq('map(. % 3)', '[7,-7]')).toEqual(lines('[\n  1,\n  -1\n]'));
    expect(status(run(`echo null | jq '5.5 % 2'`))).toBe(5);
  });
  it('negation and mixed-type errors exit 5', () => {
    // programs starting with '-' are parsed as options, as in real jq
    expect(jq('map(-.)', '[3]')).toEqual(lines('[\n  -3\n]'));
    expect(status(run(`echo null | jq '1 + "a"'`))).toBe(5);
    expect(errs(run(`echo null | jq '1 + "a"'`))[0]).toBe('jq: error: number (1) and string ("a") cannot be added');
  });
});

describe('jq — comparisons and boolean operators', () => {
  it("jq's total order: null < false < true < numbers < strings < arrays < objects", () => {
    expect(jq('null < false', 'null')).toEqual(lines('true'));
    expect(jq('false < true', 'null')).toEqual(lines('true'));
    expect(jq('true < 0', 'null')).toEqual(lines('true'));
    expect(jq('9 < "a"', 'null')).toEqual(lines('true'));
    expect(jq('"a" < []', 'null')).toEqual(lines('true'));
    expect(jq('[] < {}', 'null')).toEqual(lines('true'));
    expect(jq('[1,2] < [1,3]', 'null')).toEqual(lines('true'));
    expect(jq('{"a":1} == {"a":1}', 'null')).toEqual(lines('true'));
    expect(jq('1 != 2', 'null')).toEqual(lines('true'));
    expect(jq('. <= .', '4')).toEqual(lines('true'));
  });
  it('and / or / not with jq truthiness (false and null are falsy)', () => {
    expect(jq('true and false', 'null')).toEqual(lines('false'));
    expect(jq('null or true', 'null')).toEqual(lines('true'));
    expect(jq('1 and "x"', 'null')).toEqual(lines('true'));
    expect(jq('false and error("never")', 'null')).toEqual(lines('false'));
    expect(jq('true or error("never")', 'null')).toEqual(lines('true'));
  });
  it('// alternative: first truthy stream wins', () => {
    expect(jq('.a // "d"', '{"a":1}')).toEqual(lines('1'));
    expect(jq('.a // "d"', '{"a":null}')).toEqual(lines('"d"'));
    expect(jq('.a // "d"', '{}')).toEqual(lines('"d"'));
    expect(jq('false // 1', 'null')).toEqual(lines('1'));
    expect(jq('(1, null, 2) // 9', 'null')).toEqual(lines('1', '2'));
  });
  it('if / elif / else / end, omitted else is identity', () => {
    expect(jq('if . > 0 then "pos" else "neg" end', '5')).toEqual(lines('"pos"'));
    expect(jq('if . > 0 then "pos" elif . < 0 then "neg" else "zero" end', '0')).toEqual(lines('"zero"'));
    expect(jq('if . then "y" end', 'false')).toEqual(lines('false'));
    expect(jq('if . then "y" end', '"truthy"')).toEqual(lines('"y"'));
    expect(jq('if (true, false) then 1 else 2 end', 'null')).toEqual(lines('1', '2'));
  });
  it('try / catch and error()', () => {
    expect(jq('try error("boom") catch .', 'null')).toEqual(lines('"boom"'));
    expect(jq('try (1/0) catch "caught"', 'null')).toEqual(lines('"caught"'));
    expect(status(run(`echo null | jq 'try error("x")'`))).toBe(0);
    expect(jq('[.[]? // empty]', 'null')).toEqual(lines('[]'));
    expect(status(run(`echo 5 | jq '.[] | "no"'`))).toBe(5);
  });
});

/* ------------------------------------------------------------------ */
/* reduce and as                                                       */
/* ------------------------------------------------------------------ */

describe('jq — reduce and as-bindings', () => {
  it('reduce folds a stream; empty stream yields the init', () => {
    expect(jq('reduce .[] as $x (0; . + $x)', '[1,2,3]')).toEqual(lines('6'));
    expect(jq('reduce .[] as $x (1; . * $x)', '[1,2,3,4]')).toEqual(lines('24'));
    expect(jq('reduce .[] as $x (0; . + $x)', '[]')).toEqual(lines('0'));
  });
  it('as binds per output', () => {
    expect(jq('.[] as $x | $x * 2', '[1,2]')).toEqual(lines('2', '4'));
    expect(jq('(.a, .b) as $v | $v + 1', '{"a":1,"b":9}')).toEqual(lines('2', '10'));
  });
  it('undefined vars and functions are compile (exit 3) errors', () => {
    expect(status(run(`echo '{}' | jq '$nope'`))).toBe(3);
    expect(errs(run(`echo '{}' | jq '$nope'`)).join(' ')).toContain('$nope is not defined');
    expect(status(run(`echo '{}' | jq 'nosuchfn'`))).toBe(3);
    expect(status(run(`echo '{}' | jq 'range("a")'`))).toBe(5); // arity ok, runtime type error
  });
});

/* ------------------------------------------------------------------ */
/* CLI options and files                                               */
/* ------------------------------------------------------------------ */

describe('jq — CLI options', () => {
  it('-r prints strings raw; -c compacts', () => {
    expect(out(run(`echo '{"a":"x"}' | jq -r .a`))).toEqual(lines('x'));
    expect(out(run(`echo '{"a":[1,2]}' | jq -c .a`))).toEqual(lines('[1,2]'));
    expect(out(run(`echo '{"a":"x"}' | jq -rc .a`))).toEqual(lines('x'));
  });
  it('-s slurps the whole stream into one array', () => {
    expect(out(run(`cat /stream.json | jq -sc 'map(.a?)'`))).toEqual(lines('[1,2]'));
    expect(out(run(`cat /stream.json | jq -s 'length'`))).toEqual(lines('3'));
  });
  it('-n runs once with null input and ignores files', () => {
    expect(out(run(`jq -n '[range(3)]'`))).toEqual(lines('[\n  0,\n  1,\n  2\n]'));
    expect(out(run(`jq -n --arg hello world '$hello'`))).toEqual(lines('"world"'));
  });
  it('--arg is a string; --argjson parses', () => {
    expect(out(run(`echo 'null' | jq --arg n 5 '$n + $n'`))).toEqual(lines('"55"'));
    expect(out(run(`echo 'null' | jq --argjson n 5 '$n + $n'`))).toEqual(lines('10'));
    expect(out(run(`echo 'null' | jq --arg who "ada lovelace" '"hi \\($who)"'`))).toEqual(lines('"hi ada lovelace"'));
  });
  it('bad --argjson JSON is a usage error (exit 2)', () => {
    const r = run(`echo 'null' | jq --argjson n '@{bad}' '$n'`);
    expect(status(r)).toBe(2);
    expect(errs(r).join(' ')).toContain('Invalid JSON text');
  });
  it('--help and --version exit 0; unknown options exit 2', () => {
    const h = run(`jq --help`);
    expect(status(h)).toBe(0);
    expect(out(h).join('\n')).toContain('Options:');
    expect(status(run(`jq --version`))).toBe(0);
    const bad = run(`echo '{}' | jq --wat`);
    expect(status(bad)).toBe(2);
    expect(errs(bad).join(' ')).toContain('Unknown option');
    expect(status(run(`echo '{}' | jq -Z '.'`))).toBe(2);
  });
});

describe('jq — files, streams, exit codes', () => {
  it('reads files; several concatenate; - takes the pipe', () => {
    expect(out(run(`jq .name /u.json`))).toEqual(lines('"ada"'));
    expect(out(run(`jq -c . /nums.json`))).toEqual(lines('[5,3,9,1]'));
    expect(out(run(`cat /stream.json | jq -c '.a?'`))).toEqual(lines('1', '2'));
    expect(out(run(`echo '{"b":9}' | jq -c . /u.json -`))).toEqual(
      lines('{"name":"ada","langs":["ml","ts"],"n":3,"nested":{"k":"v"}}', '{"b":9}'),
    );
  });
  it('each document in a stream runs the filter', () => {
    expect(out(run(`cat /stream.json | jq -c 'if type == "object" then .a else .[0] end'`))).toEqual(lines('1', '2', '3'));
  });
  it('malformed input JSON exits 2 with the source named', () => {
    const stdin = run(`cat /bad.json | jq .`);
    expect(status(stdin)).toBe(2);
    expect(errs(stdin).join(' ')).toContain('jq: error (at <stdin>)');
    const file = run(`jq . /bad.json`);
    expect(status(file)).toBe(2);
    expect(errs(file).join(' ')).toContain('jq: error (at /bad.json)');
  });
  it('a runtime error on one document exits 5 but others still print', () => {
    core.vfs.mountFile('/mixed.json', '{"a":1}\n5\n{"a":2}\n');
    const r = run(`cat /mixed.json | jq .a`);
    expect(out(r)).toEqual(lines('1', '2'));
    expect(status(r)).toBe(5);
  });
  it('missing file, directory operand, pipe-less -', () => {
    const r = run(`jq . /nope.json`);
    expect(status(r)).toBe(2);
    expect(errs(r).join(' ')).toContain('Could not open /nope.json');
    const d = run(`jq . /`);
    expect(status(d)).toBe(2);
    expect(errs(d).join(' ')).toContain('Is a directory');
    const p = run(`jq -c . -`);
    expect(status(p)).toBe(2);
    expect(errs(p).join(' ')).toContain('no piped input');
  });
  it('no filter given exits 2', () => {
    const r = run(`echo '{}' | jq`);
    expect(status(r)).toBe(2);
    expect(errs(r).join(' ')).toContain('no filter given');
  });
  it('syntax errors and unknown names exit 3', () => {
    expect(status(run(`echo '{}' | jq '.a['`))).toBe(3);
    expect(status(run(`echo '{}' | jq ''`))).toBe(3);
    expect(errs(run(`echo '{}' | jq '.a['`)).join(' ')).toContain('jq: error');
    expect(status(run(`echo '{}' | jq '.a as $x | $y'`))).toBe(3);
    expect(status(run(`echo '{}' | jq 'break $x'`))).toBe(3);
    expect(errs(run(`echo '{}' | jq 'break $x'`)).join(' ')).toContain('matching label');
  });
});

/* ------------------------------------------------------------------ */
/* json command                                                        */
/* ------------------------------------------------------------------ */

describe('json — pretty-print and validate', () => {
  it('pretty-prints documents from files and the pipe', () => {
    expect(out(run(`json /u.json`))).toEqual(lines('{\n  "name": "ada",\n  "langs": [\n    "ml",\n    "ts"\n  ],\n  "n": 3,\n  "nested": {\n    "k": "v"\n  }\n}'));
    expect(out(run(`echo '[1,{"b":2}]' | json`))).toEqual(lines('[\n  1,\n  {\n    "b": 2\n  }\n]'));
    expect(out(run(`echo '{"a":1}' | json -c`))).toEqual(lines('{"a":1}'));
    expect(out(run(`echo '"raw"' | json -r`))).toEqual(lines('raw'));
  });
  it('multi-document streams print in order', () => {
    expect(out(run(`json -c /stream.json`))).toEqual(lines('{"a":1}', '{"a":2}', '[3]'));
  });
  it('validation errors name the file and offset, exit 2', () => {
    const r = run(`json /bad.json`);
    expect(status(r)).toBe(2);
    expect(errs(r).join(' ')).toContain('json: /bad.json: parse error');
    expect(errs(r).join(' ')).toContain('offset');
  });
  it('good files stay exit 0; --help works', () => {
    expect(status(run(`json /u.json /nums.json`))).toBe(0);
    const h = run(`json --help`);
    expect(status(h)).toBe(0);
    expect(out(h).join('\n')).toContain('pretty-print');
  });
});

/* ------------------------------------------------------------------ */
/* edges                                                               */
/* ------------------------------------------------------------------ */

describe('jq — edges: empty input, CRLF, unicode, numbers', () => {
  it('empty input produces nothing, exit 0', () => {
    const r = run(`cat /empty.json | jq .`);
    expect(out(r)).toEqual([]);
    expect(status(r)).toBe(0);
  });
  it('CRLF whitespace parses fine', () => {
    expect(out(run(`cat /crlf.json | jq -c .`))).toEqual(lines('{"a":1}'));
  });
  it('unicode keys and astral values survive untouched', () => {
    expect(out(run(`cat /uni.json | jq -c .`))).toEqual(lines('{"héllo":"wörld 😀","世界":{"𝔘":"𝔫"}}'));
    expect(out(run(`cat /uni.json | jq -r '.["世界"]["𝔘"]'`))).toEqual(lines('𝔫'));
    expect(jq('.["héllo"] | length', '{"héllo":"😀😀"}')).toEqual(lines('2'));
  });
  it('number rendering: integers stay integral, floats print, exponents render', () => {
    expect(jq('.', '1')).toEqual(lines('1'));
    expect(jq('.', '1.50')).toEqual(lines('1.5'));
    expect(jq('0.1 + 0.2', 'null')).toEqual(lines('0.30000000000000004'));
    expect(jq('2.0 * 3', 'null')).toEqual(lines('6'));
    expect(jq('1e2', 'null')).toEqual(lines('100'));
  });
  it('deep nesting prints with indent', () => {
    expect(out(run(`echo '{"a":{"b":{"c":[1,[2]]}}}' | jq .a.b.c[1]`))).toEqual(lines('[\n  2\n]'));
  });
  it('comments and whitespace inside programs', () => {
    expect(jq('.a # trailing comment', '{"a":1}')).toEqual(lines('1'));
  });
});

/* ------------------------------------------------------------------ */
/* package contract                                                    */
/* ------------------------------------------------------------------ */

describe('jq — package contract (lazy stub)', () => {
  it('the stub answers --help from the stub page when the chunk fails', async () => {
    const failing = createLazyPackage(jqStub, async () => {
      throw new Error('offline');
    });
    expect(failing.loaded()).toBe(false);
    await failing.ensure();
    expect(failing.loaded()).toBe(false);
    const spec = failing.commands.find((c) => c.name === 'jq')!;
    const outs: string[] = [];
    const errsOut: string[] = [];
    let code: number | null = null;
    spec.run({
      args: ['--help'],
      out: (t: string) => outs.push(t),
      err: (t: string) => errsOut.push(t),
      emit: () => {},
      exit: (c: number) => {
        code = c;
      },
    } as never);
    expect(code ?? 0).toBe(0); // --help answers straight from the stub
    expect(outs.join(' ')).toContain('jq [-rscn]');
  });

  it('a real run against a dead chunk reports the load error, exit 1', async () => {
    const failing = createLazyPackage(jqStub, async () => {
      throw new Error('offline');
    });
    await failing.ensure();
    const spec = failing.commands.find((c) => c.name === 'json')!;
    const errsOut: string[] = [];
    let code: number | null = null;
    spec.run({
      args: [],
      out: () => {},
      err: (t: string) => errsOut.push(t),
      emit: () => {},
      exit: (c: number) => {
        code = c;
      },
    } as never);
    expect(errsOut.join(' ')).toContain('package chunk failed to load (semtext-pkg-jq.js)');
    expect(code).toBe(1);
  });

  it('manPage prefers the chunk page once resident; stub page before', async () => {
    const fresh = createLazyPackage(jqStub, async () => {
      const mod = await import('../../src/terminal/packages/jq/index.js');
      return { commands: mod.commands, manPages: mod.manPages };
    });
    expect(fresh.manPage('jq')!.join(' ')).toContain('short page');
    await fresh.ensure();
    expect(fresh.manPage('jq')!.join(' ')).toContain('leaf_paths');
    expect(fresh.manPage('json')!.join(' ')).toContain('pretty-print and validate');
    expect(fresh.manPage('nothing')).toBeNull();
  });

  it('completion lists flags for both commands (chunk-resident)', () => {
    const jqSpec = chunkCommands.find((c) => c.name === 'jq')!;
    const jsonSpec = chunkCommands.find((c) => c.name === 'json')!;
    expect(jqSpec.complete?.({ word: '--', args: [] } as never)).toEqual([
      '--arg',
      '--argjson',
      '--raw-output',
      '--compact-output',
      '--slurp',
      '--null-input',
      '--help',
      '--version',
    ]);
    expect(jqSpec.complete?.({ word: '-r', args: [] } as never)).toEqual(['-r']);
    expect(jsonSpec.complete?.({ word: '-', args: [] } as never)).toEqual(['-c', '-r', '--compact', '--raw', '--help']);
  });
});

/* ------------------------------------------------------------------ */
/* round 2 — regex builtins                                            */
/* ------------------------------------------------------------------ */

describe('jq — regex builtins (round 2)', () => {
  it('test/1 and test/2 with flags', () => {
    expect(jq('test("b+")', '"abbc"')).toEqual(lines('true'));
    expect(jq('test("z")', '"abc"')).toEqual(lines('false'));
    expect(jq('test("^a.c$")', '"abc"')).toEqual(lines('true'));
    expect(jq('test("^a.c$")', '"a\\nc"')).toEqual(lines('false')); // jq default: . stops at newline
    expect(jq('test("^a.c$"; "m")', '"a\\nc"')).toEqual(lines('true')); // jq m/p = dot matches newline
    expect(jq('test("ABC"; "i")', '"abc"')).toEqual(lines('true'));
    expect(jq('test("a b"; "x")', '"ab"')).toEqual(lines('true')); // x strips whitespace
    expect(jq('test("[[:digit:]]+")', '"a1"')).toEqual(lines('true')); // POSIX classes translate
  });
  it('match objects, captures, offsets (code points)', () => {
    expect(jq('match("b+"; "g") | .offset', '"abbc"')).toEqual(lines('1'));
    expect(jq('[match("a"; "g")] | length', '"aaa"')).toEqual(lines('3'));
    expect(jq('match("(?<x>.)-(?<y>.)") | .captures | map(.string)', '"a-b"')).toEqual(lines('[\n  "a",\n  "b"\n]'));
    expect(jq('match("a(?<n>x)?b") | .captures[0].string', '"ab"')).toEqual(lines('null'));
    expect(jq('match("a(?<n>x)?b") | .captures[0].offset', '"ab"')).toEqual(lines('-1'));
    expect(jq('match("😀") | .offset', '"a😀z"')).toEqual(lines('1')); // codepoint offset
    expect(jq('match("(?<w>[a-z]+)") | .captures[0].name', '"ab"')).toEqual(lines('"w"'));
  });
  it('capture / scan', () => {
    expect(jq('capture("(?<a>.)(?<b>.): (?<c>...)")', '"aa: bbb"')).toEqual(lines('{\n  "a": "a",\n  "b": "a",\n  "c": "bbb"\n}'));
    expect(jq('capture("x")', '"abc"')).toEqual([]); // no match → no output
    expect(jq('scan("aa")', '"aaaa"')).toEqual(lines('"aa"', '"aa"'));
    expect(jq('[scan("[0-9]")]', '"a1b2"')).toEqual(lines('[\n  "1",\n  "2"\n]'));
    expect(jq('scan("(?<o>.)(?<i>.)") | .i', '"abcd"')).toEqual(lines('"b"', '"d"'));
  });
  it('sub / gsub, cartesian replacements, flags', () => {
    expect(jq('sub("a"; "X")', '"aaa"')).toEqual(lines('"Xaa"'));
    expect(jq('gsub("a"; "X")', '"aaa"')).toEqual(lines('"XXX"'));
    expect(jq('gsub("o"; "0", "O")', '"foo"')).toEqual(lines('"f00"', '"f0O"', '"fO0"', '"fOO"'));
    expect(jq('gsub("(?<x>a)"; "<\\(.x)>")', '"aa"')).toEqual(lines('"<a><a>"')); // replacement sees captures as .
    expect(jq('sub("a"; "X"; "g")', '"aa"')).toEqual(lines('"XX"'));
    expect(jq('gsub("A"; "x"; "i")', '"aA"')).toEqual(lines('"xx"'));
  });
  it('split/2 and splits (regex, not literal)', () => {
    expect(jq('split(", *"; null)', '"a, b,c"')).toEqual(lines('[\n  "a",\n  "b",\n  "c"\n]'));
    expect(jq('[splits(",")]', '"a,b,c"')).toEqual(lines('[\n  "a",\n  "b",\n  "c"\n]'));
    expect(jq('[splits(",")]', '"a, b"')).toEqual(lines('[\n  "a",\n  " b"\n]'));
  });
  it('regex errors: bad flags and non-string input exit 5', () => {
    const flags = run(`echo '"a"' | jq 'test("a"; "zzz")'`);
    expect(status(flags)).toBe(5);
    expect(errs(flags).join(' ')).toContain('not a valid modifier string');
    const nonstr = run(`echo 5 | jq 'test("a")'`);
    expect(status(nonstr)).toBe(5);
    expect(errs(nonstr).join(' ')).toContain('cannot be matched, as it is not a string');
    const badre = run(`echo '"a"' | jq 'test("a(")'`);
    expect(status(badre)).toBe(5);
  });
});

/* ------------------------------------------------------------------ */
/* round 2 — assignment and update-assignment                          */
/* ------------------------------------------------------------------ */

describe('jq — assignment (round 2)', () => {
  it('= sets paths, creates structure, streams the rhs', () => {
    expect(jq('.a = 1', '{}')).toEqual(lines('{\n  "a": 1\n}'));
    expect(jq('.a.b = 1', 'null')).toEqual(lines('{\n  "a": {\n    "b": 1\n  }\n}'));
    expect(jq('.a = (1, 2)', '{}')).toEqual(lines('{\n  "a": 1\n}', '{\n  "a": 2\n}'));
    expect(jq('.[0] = 9', '[1,2]')).toEqual(lines('[\n  9,\n  2\n]'));
    expect(jq('.[-1] = 9', '[1,2]')).toEqual(lines('[\n  1,\n  9\n]'));
    expect(jq('setpath([0,1]; 9)', '[[0]]')).toEqual(lines('[\n  [\n    0,\n    9\n  ]\n]'));
  });
  it('assignment binds tighter than // (real-jq parse)', () => {
    expect(jq('.a = false // "x"', '{"a":false}')).toEqual(lines('{\n  "a": false\n}'));
  });
  it('|= updates each path; first output wins; empty deletes', () => {
    expect(jq('.a |= . + 1', '{"a":1}')).toEqual(lines('{\n  "a": 2\n}'));
    expect(jq('.[] |= . + 1', '[1,2]')).toEqual(lines('[\n  2,\n  3\n]'));
    expect(jq('.a |= (2, 3)', '{"a":1}')).toEqual(lines('{\n  "a": 2\n}')); // first output only
    expect(jq('.a |= empty', '{"a":1,"b":2}')).toEqual(lines('{\n  "b": 2\n}'));
    expect(jq('(.a, .a) |= . + 1', '{"a":1}')).toEqual(lines('{\n  "a": 3\n}')); // sequential on the evolving doc
    expect(jq('(.[] | select(. > 1)) |= empty', '[1,5,3,0,7]')).toEqual(lines('[\n  1,\n  0\n]')); // jq 1.7 descending delete
  });
  it('+= -= *= /= %= //= update in place', () => {
    expect(jq('.a += 1', '{"a":1}')).toEqual(lines('{\n  "a": 2\n}'));
    expect(jq('.a -= 1', '{"a":1}')).toEqual(lines('{\n  "a": 0\n}'));
    expect(jq('.a *= 3', '{"a":2}')).toEqual(lines('{\n  "a": 6\n}'));
    expect(jq('.a /= 2', '{"a":7}')).toEqual(lines('{\n  "a": 3.5\n}'));
    expect(jq('.a %= 3', '{"a":7}')).toEqual(lines('{\n  "a": 1\n}'));
    expect(jq('.a //= 5', '{"a":null}')).toEqual(lines('{\n  "a": 5\n}'));
    expect(jq('.a //= 5', '{"a":1}')).toEqual(lines('{\n  "a": 1\n}'));
    expect(jq('.[0] += 10', '[1,2]')).toEqual(lines('[\n  11,\n  2\n]'));
  });
  it('with_entries / to_entries round trips with updates', () => {
    expect(jq('with_entries(.value += 1)', '{"a":1,"b":2}')).toEqual(lines('{\n  "a": 2,\n  "b": 3\n}'));
    expect(jq('to_entries | map(.value |= . * 2) | from_entries', '{"a":1,"b":2}')).toEqual(lines('{\n  "a": 2,\n  "b": 4\n}'));
  });
  it('del / delpaths remove paths (deepest first)', () => {
    expect(jq('del(.a)', '{"a":1,"b":2}')).toEqual(lines('{\n  "b": 2\n}'));
    expect(jq('del(.[0], .[2])', '[1,2,3,4]')).toEqual(lines('[\n  2,\n  4\n]'));
    expect(jq('delpaths([[1], [3]])', '[1,5,3,0,7]')).toEqual(lines('[\n  1,\n  3,\n  7\n]'));
    expect(jq('del(.a.b)', '{"a":{"b":1},"c":2}')).toEqual(lines('{\n  "a": {},\n  "c": 2\n}'));
    expect(jq('del(.nope)', '{"a":1}')).toEqual(lines('{\n  "a": 1\n}'));
  });
  it('bad path expressions exit 5', () => {
    const r = run(`echo 5 | jq '.a = 1'`);
    expect(status(r)).toBe(5);
    expect(errs(r).join(' ')).toContain('Cannot index number');
  });
});

/* ------------------------------------------------------------------ */
/* round 2 — def, foreach, label/break, ..                             */
/* ------------------------------------------------------------------ */

describe('jq — def (round 2)', () => {
  it('simple defs, recursion, $params and filter params', () => {
    expect(jq('def f: . + 1; f', '1')).toEqual(lines('2'));
    expect(jq('def fact: if . <= 1 then 1 else . * (. - 1 | fact) end; [range(5) | . + 1 | fact]', 'null')).toEqual(
      lines('[\n  1,\n  2,\n  6,\n  24,\n  120\n]'),
    );
    expect(jq('def pair($a; $b): [$a, $b]; pair(1; 2)', 'null')).toEqual(lines('[\n  1,\n  2\n]'));
    expect(jq('def f($x): $x + 1; f(1, 2)', 'null')).toEqual(lines('2', '3')); // $params bind per output
    expect(jq('def twice(f): f | f; twice(. + 1)', '0')).toEqual(lines('2'));
    expect(jq('def apply(f): map(f); apply(. * 10)', '[1,2]')).toEqual(lines('[\n  10,\n  20\n]'));
    expect(jq('def compose(f; g): f | g; compose(. + 1; . * 2)', '5')).toEqual(lines('12'));
    expect(jq('def outer: def inner: 7; inner; outer', 'null')).toEqual(lines('7')); // lexical nesting
  });
  it('defs shadow builtins; recursion cap is a runtime error', () => {
    expect(jq('def map(f): "shadowed"; map(.x)', '[1]')).toEqual(lines('"shadowed"'));
    const r = run(`echo 0 | jq 'def loop: loop; loop'`);
    expect(status(r)).toBe(5);
    expect(errs(r).join(' ')).toContain('recursion limit');
  });
  it('undefined defs and wrong arities are compile (exit 3) errors', () => {
    expect(status(run(`echo '{}' | jq 'def f: nosuch; f'`))).toBe(3);
    expect(status(run(`echo '{}' | jq 'def f(a): a; f'`))).toBe(3); // arity mismatch
  });
});

describe('jq — foreach, label/break, .. (round 2)', () => {
  it('foreach emits per update; extract reshapes; multi-output updates', () => {
    expect(jq('foreach .[] as $x (0; . + $x)', '[1,2,3]')).toEqual(lines('1', '3', '6'));
    expect(jq('[foreach .[] as $x (0; . + $x; [$x, .])]', '[1,2,3]')).toEqual(lines('[\n  [\n    1,\n    1\n  ],\n  [\n    2,\n    3\n  ],\n  [\n    3,\n    6\n  ]\n]'));
    expect(jq('foreach (1,2) as $x (0; . + $x, . + 10)', 'null')).toEqual(lines('1', '10', '12', '20'));
  });
  it('label / break unwind to the label', () => {
    expect(jq('label $out | 1, break $out, 2', 'null')).toEqual(lines('1'));
    expect(jq('[label $out | .[] | if . > 2 then break $out else . end]', '[1,2,3,4]')).toEqual(lines('[\n  1,\n  2\n]'));
  });
  it('.. recurses; paths / leaf_paths walk it', () => {
    expect(jq('[..]', '{"a":[1]}')).toEqual(lines('[\n  {\n    "a": [\n      1\n    ]\n  },\n  [\n    1\n  ],\n  1\n]'));
    expect(jq('.. | numbers', '{"a":1,"b":{"c":2}}')).toEqual(lines('1', '2'));
    expect(jq('[paths]', '{"a":1}')).toEqual(lines('[\n  [\n    "a"\n  ]\n]'));
    expect(jq('[paths]', '3')).toEqual(lines('[]')); // scalar: root path [] is filtered out (real jq prints [])
    expect(jq('[leaf_paths]', '{"a":{"b":1},"c":null}')).toEqual(lines('[\n  [\n    "a",\n    "b"\n  ]\n]')); // null is not a leaf
    expect(jq('[paths(type == "number")]', '{"a":1,"b":"x"}')).toEqual(lines('[\n  [\n    "a"\n  ]\n]'));
  });
});

/* ------------------------------------------------------------------ */
/* round 2 — control builtins and environment                          */
/* ------------------------------------------------------------------ */

describe('jq — limit/first/last/until/while/repeat and friends (round 2)', () => {
  it('limit / first(f) / last(f)', () => {
    expect(jq('[limit(2; .[])]', '[1,2,3]')).toEqual(lines('[\n  1,\n  2\n]'));
    expect(jq('[limit(0; .[])]', '[1,2]')).toEqual(lines('[]'));
    expect(jq('[first(.[] | select(. > 1))]', '[1,2,3]')).toEqual(lines('[\n  2\n]'));
    expect(jq('[last(range(4))]', 'null')).toEqual(lines('[\n  3\n]'));
  });
  it('until / while / repeat (jq 1.7 semantics)', () => {
    expect(jq('until(. > 100; . * 2)', '3')).toEqual(lines('192'));
    expect(jq('[while(. < 100; . * 2)]', '1')).toEqual(lines('[\n  1,\n  2,\n  4,\n  8,\n  16,\n  32,\n  64\n]'));
    expect(jq('[limit(3; repeat(.*2))]', '1')).toEqual(lines('[\n  2,\n  4,\n  8\n]'));
  });
  it('walk / recurse(f) / add(f) / any(cond) / all(cond) / abs / toarray', () => {
    expect(jq('walk(if type == "number" then . + 1 else . end)', '{"a":[1,2],"b":{"c":3}}')).toEqual(
      lines('{\n  "a": [\n    2,\n    3\n  ],\n  "b": {\n    "c": 4\n  }\n}'),
    );
    expect(jq('[recurse(if . < 3 then . + 1 else empty end)]', '0')).toEqual(lines('[\n  0,\n  1,\n  2,\n  3\n]'));
    expect(jq('add(.[])', '[1,2,3]')).toEqual(lines('6'));
    expect(jq('any(.[]; . > 2)', '[1,2,3]')).toEqual(lines('true'));
    expect(jq('all(.[]; . > 0)', '[1,2,3]')).toEqual(lines('true'));
    expect(jq('abs', '-5')).toEqual(lines('5'));
    expect(jq('toarray', '5')).toEqual(lines('[\n  5\n]'));
    expect(jq('toarray', '[1]')).toEqual(lines('[\n  1\n]'));
  });
  it('input/inputs share the document stream; input_filename names the source', () => {
    expect(out(run(`cat /stream.json | jq -c -n '[inputs]'`))).toEqual(lines('[{"a":1},{"a":2},[3]]'));
    const one = run(`cat /stream.json | jq -c 'input'`);
    expect(out(one)).toEqual(lines('{"a":2}')); // doc 1 ran `input` → doc 2; doc 3's input errors
    expect(status(one)).toBe(5);
    expect(errs(one).join(' ')).toContain('No more inputs');
    expect(out(run(`jq 'input_filename' /u.json`))).toEqual(lines('"/u.json"'));
    expect(out(run(`echo 1 | jq 'input_filename'`))).toEqual(lines('"<stdin>"'));
    expect(out(run(`jq -n 'input_filename'`))).toEqual(lines('null'));
  });
  it('$ENV / env expose the shell environment', () => {
    expect(jq('$ENV == env', 'null')).toEqual(lines('true'));
    expect(jq('env | type', 'null')).toEqual(lines('"object"'));
  });
  it('halt / halt_error stop the whole run with their code', () => {
    const h = run(`echo 1 | jq 'halt'`);
    expect(out(h)).toEqual([]);
    expect(status(h)).toBe(0);
    const he = run(`echo 1 | jq '"boom" | halt_error'`);
    expect(errs(he)).toEqual(['boom']); // raw string payload
    expect(status(he)).toBe(5);
    const he2 = run(`echo 1 | jq '"quiet" | halt_error(2)'`);
    expect(status(he2)).toBe(2);
    expect(errs(he2)).toEqual(['quiet']);
    const obj = run(`echo 1 | jq '{"a":1} | halt_error'`);
    expect(errs(obj)).toEqual(['{"a":1}']); // non-strings print as compact JSON
    expect(status(obj)).toBe(5);
  });
  it('$__loc__ reports the program line', () => {
    expect(jq('$__loc__.line > 0', 'null')).toEqual(lines('true'));
    expect(jq('$__loc__ | type', 'null')).toEqual(lines('"object"'));
  });
});

/* ------------------------------------------------------------------ */
/* round 2 — path/shape builtins                                       */
/* ------------------------------------------------------------------ */

describe('jq — getpath/setpath/path, indices, misc (round 2)', () => {
  it('getpath / setpath / path', () => {
    expect(jq('getpath(["a", "b"])', '{"a":{"b":7}}')).toEqual(lines('7'));
    expect(jq('getpath(["x"])', '{"a":1}')).toEqual(lines('null'));
    expect(jq('setpath(["a"]; 9)', '{}')).toEqual(lines('{\n  "a": 9\n}'));
    expect(jq('setpath(["a", 0]; 1)', 'null')).toEqual(lines('{\n  "a": [\n    1\n  ]\n}'));
    expect(jq('[path(.a.b)]', 'null')).toEqual(lines('[\n  [\n    "a",\n    "b"\n  ]\n]'));
    expect(jq('[path(..)]', '{"a":1}')).toEqual(lines('[\n  [],\n  [\n    "a"\n  ]\n]'));
  });
  it('indices / index / rindex are substring/subarray search, not regex', () => {
    expect(jq('[indices("b")]', '"abcb"')).toEqual(lines('[\n  [\n    1,\n    3\n  ]\n]')); // one array output
    expect(jq('[indices([1,2])]', '[0,1,2,1,2]')).toEqual(lines('[\n  [\n    1,\n    3\n  ]\n]'));
    expect(jq('[indices("z")]', '"abc"')).toEqual(lines('[\n  []\n]'));
    expect(jq('[indices("")]', '"abc"')).toEqual(lines('[\n  []\n]'));
    expect(jq('[indices("a.c")]', '"axc"')).toEqual(lines('[\n  []\n]')); // literal dots
    expect(jq('indices("a")', 'null')).toEqual(lines('null'));
    expect(jq('index("b")', '"abcb"')).toEqual(lines('1'));
    expect(jq('rindex("b")', '"abcb"')).toEqual(lines('3'));
    expect(jq('index("z")', '"abc"')).toEqual(lines('null'));
  });
  it('transpose / explode / implode / ascii', () => {
    expect(jq('transpose', '[[1,2],[3,4]]')).toEqual(lines('[\n  [\n    1,\n    3\n  ],\n  [\n    2,\n    4\n  ]\n]'));
    expect(jq('transpose', '[[1],[2,3]]')).toEqual(lines('[\n  [\n    1,\n    2\n  ],\n  [\n    null,\n    3\n  ]\n]'));
    expect(jq('explode', '"ab"')).toEqual(lines('[\n  97,\n  98\n]'));
    expect(jq('implode', '[97,98]')).toEqual(lines('"ab"'));
    expect(jq('explode | implode', '"a😀"')).toEqual(lines('"a😀"')); // astral round trip
    expect(jq('ascii', '97')).toEqual(lines('"a"'));
    const bad = run(`echo null | jq 'implode'`);
    expect(status(run(`echo '[[55296]]' | jq '.[0] | implode'`))).toBe(5); // surrogate rejected
    expect(status(bad)).toBe(5);
  });
  it('ltrimstr-style helpers stay; min/max/flatten unchanged; round-trips hold', () => {
    expect(jq('[.[] | tostring] | join("-") | ltrimstr("1-")', '[1,2,3]')).toEqual(lines('"2-3"'));
    expect(jq('fromjson | tojson', '"[1,2]"')).toEqual(lines('"[1,2]"')); // string content has no quotes to escape
  });
});
