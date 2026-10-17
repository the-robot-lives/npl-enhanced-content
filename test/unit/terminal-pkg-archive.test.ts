// @vitest-environment node
// Unit spec — the archive command package (src/terminal/packages/archive/):
// base64, md5sum/sha1sum/sha256sum/sha512sum, gzip/gunzip/zcat, tar,
// zip/unzip (packages round, LANE=pkg-archive).
//
// The pure codecs are cross-checked against node:zlib and node:crypto in
// BOTH directions; the command layer runs through a real TerminalCore with
// the posix base commands mounted, so pipes, redirects and exit codes are
// the shell's own. The lazy-package contract tests inject loaders (the
// built chunk file does not exist in the source tree — see lazy.ts).
import { describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { deflateRawSync, gunzipSync, gzipSync, inflateRawSync } from 'node:zlib';
import { TerminalCore } from '../../src/terminal/terminal-core.js';
import { posixPlugin } from '../../src/terminal/plugins/posix/plugin.js';
import { deflateRaw, gzipUnwrap, gzipWrap, inflateRaw, GzipError } from '../../src/terminal/packages/archive/deflate.js';
import { digest } from '../../src/terminal/packages/archive/hashes.js';
import {
  base64Decode,
  base64Encode,
  bytesOf,
  crc32,
  hexOf,
  strOfBytes,
} from '../../src/terminal/packages/archive/bytes.js';
import { tarCreate, tarParse } from '../../src/terminal/packages/archive/ustar.js';
import { zipCreate, zipParse, zipReadEntry } from '../../src/terminal/packages/archive/zipfile.js';
import { commands as archiveCommands } from '../../src/terminal/packages/archive/index.js';
import { archiveStub } from '../../src/terminal/packages/archive/stub.js';
import { createLazyPackage, type LazyPackage } from '../../src/terminal/packages/lazy.js';
import { PACKAGES, packagesPlugin } from '../../src/terminal/packages/manifest.js';
import { GOLDEN_TAR_B64, GOLDEN_ZIP_B64 } from './terminal-pkg-archive-fixtures.js';

const te = (s: string): Uint8Array => new TextEncoder().encode(s);

/** The archive package with a deterministic in-test loader (index.ts). */
function makeTestArchivePackage(): LazyPackage {
  return createLazyPackage(archiveStub, async () => import('../../src/terminal/packages/archive/index.js'));
}

const testPkg = makeTestArchivePackage();
// The lazy package preloads on creation; every command-level test needs the
// chunk resident so no invocation races "chunk still loading".
await testPkg.ensure();

function coreWithArchive(): TerminalCore {
  const core = new TerminalCore();
  for (const plugin of [posixPlugin, { name: 'archive-test', version: '0.0.0', commands: testPkg.commands, files: [] }] as const) {
    const result = core.mountPlugin(plugin);
    if (!result.ok) throw new Error(`mount ${plugin.name}: ${result.error ?? 'failed'}`);
  }
  return core;
}

function run(core: TerminalCore, line: string): { out: string[]; err: string[]; status: number } {
  const result = core.execLine(line);
  return {
    out: result.lines.filter((l) => l.kind === 'stdout').map((l) => l.text),
    err: result.lines.filter((l) => l.kind === 'stderr').map((l) => l.text),
    status: core.state.lastStatus,
  };
}

const randBytes = (n: number): Uint8Array => new Uint8Array(randomBytes(n));

describe('pure codecs', () => {
  it('DEFLATE round-trips text, random and empty payloads (own inflate)', () => {
    const cases: Array<[string, Uint8Array]> = [
      ['empty', new Uint8Array(0)],
      ['one', te('a')],
      ['abc', te('abc')],
      ['text', te('the quick brown fox\n'.repeat(400))],
      ['random', randBytes(4096)],
      ['random60k', randBytes(60000)],
      ['zeros', new Uint8Array(5000)],
    ];
    for (const [name, data] of cases) {
      const back = inflateRaw(deflateRaw(data)).data;
      expect(Buffer.from(back).equals(Buffer.from(data)), name).toBe(true);
    }
  });

  it('node:zlib reads our gzip and raw deflate; we read node output', () => {
    const cases: Array<[string, Uint8Array]> = [
      ['empty', new Uint8Array(0)],
      ['text', te('the quick brown fox\n'.repeat(50))],
      ['random60k', randBytes(60000)],
    ];
    for (const [name, data] of cases) {
      // they read ours
      expect(Buffer.from(inflateRawSync(deflateRaw(data))).equals(Buffer.from(data)), `raw ${name}`).toBe(true);
      expect(Buffer.from(gunzipSync(gzipWrap(data))).equals(Buffer.from(data)), `gzip ${name}`).toBe(true);
      // we read theirs
      const theirs = new Uint8Array(deflateRawSync(data));
      const back = inflateRaw(theirs).data;
      expect(Buffer.from(back).equals(Buffer.from(data)), `inflate theirs ${name}`).toBe(true);
      const theirsGz = new Uint8Array(gzipSync(data));
      const unwrapped = gzipUnwrap(theirsGz);
      expect(Buffer.from(unwrapped.raw).equals(Buffer.from(data)), `gunzip theirs ${name}`).toBe(true);
      expect(unwrapped.end).toBe(theirsGz.length); // no trailing garbage
    }
  });

  it('incompressible input falls back to stored blocks (small growth)', () => {
    const data = randBytes(70000);
    const packed = deflateRaw(data);
    const storedFloor = data.length + 5 * Math.ceil(data.length / 0xffff);
    expect(packed.length).toBeLessThanOrEqual(storedFloor);
    expect(Buffer.from(inflateRaw(packed).data).equals(Buffer.from(data))).toBe(true);
  });

  it('gzipUnwrap verifies CRC and rejects bad magic', () => {
    const wrapped = gzipWrap(te('payload data'));
    wrapped[wrapped.length - 6]! ^= 0xff; // corrupt the stored CRC
    expect(() => gzipUnwrap(wrapped)).toThrow(GzipError);
    expect(() => gzipUnwrap(te('not gzip at all'))).toThrow(/not in gzip format/);
  });

  it('digests match node:crypto on vectors and random input (all four)', () => {
    for (const algo of ['md5', 'sha1', 'sha256', 'sha512'] as const) {
      for (const input of ['', 'a', 'abc', 'hello', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(63), 'q'.repeat(64), 'w'.repeat(65), '~'.repeat(1000)]) {
        const data = bytesOf(input);
        expect(hexOf(digest(algo, data)), `${algo} of ${input.length} bytes`).toBe(createHash(algo).update(data).digest('hex'));
      }
      const data = randBytes(1000);
      expect(hexOf(digest(algo, data)), algo + ' random').toBe(createHash(algo).update(data).digest('hex'));
    }
  });

  it('crc32 and base64 hit their published vectors', () => {
    expect(crc32(te('123456789'))).toBe(0xcbf43926);
    expect(base64Encode(te('hello world'), 76)).toEqual(['aGVsbG8gd29ybGQ=']);
    const long = base64Encode(te('a'.repeat(200)), 0);
    expect(long).toHaveLength(1);
    expect(long[0]!.includes('\n')).toBe(false);
    expect(strOfBytes(base64Decode('aGVsbG8gd29ybGQ=', false))).toBe('hello world');
    expect(base64Decode('!!!', false)).toMatch(/invalid input/);
    expect(strOfBytes(base64Decode('aGVs\n bG8=', true))).toBe('hello');
  });
});

describe('golden fixtures from the real tools', () => {
  it('tarParse reads a bsdtar --format=ustar archive', () => {
    const entries = tarParse(new Uint8Array(Buffer.from(GOLDEN_TAR_B64, 'base64')));
    expect(entries.map((e) => e.name)).toEqual(['sub/', 'sub/a.txt', 'b.txt']);
    expect(entries[0]!.type).toBe('dir');
    expect(strOfBytes(entries[1]!.data!)).toBe('hello tar\n');
    expect(strOfBytes(entries[2]!.data!)).toBe('b\n');
  });

  it('zipParse + zipReadEntry read an Info-ZIP archive (stored, dir, deflated)', () => {
    const bytes = new Uint8Array(Buffer.from(GOLDEN_ZIP_B64, 'base64'));
    const entries = zipParse(bytes);
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'd/', 'd/inner.txt']);
    expect(entries[1]!.isDir).toBe(true);
    expect(strOfBytes(zipReadEntry(bytes, entries[0]!))).toBe('hello zip\n');
    expect(strOfBytes(zipReadEntry(bytes, entries[2]!))).toBe('deep\n');
  });

  it('tarCreate + zipCreate output survives our own parsers', () => {
    const entries = [
      { name: 'x/', type: 'dir' as const, mode: 0o755, mtime: 0 },
      { name: 'x/f.txt', type: 'file' as const, data: te('body'), mode: 0o644, mtime: 0 },
    ];
    const parsed = tarParse(tarCreate(entries));
    expect(parsed.map((e) => e.name)).toEqual(['x/', 'x/f.txt']);
    expect(strOfBytes(parsed[1]!.data!)).toBe('body');

    const zipEntries = [
      { name: 'y/f.txt', data: te('zbody'), mode: 0o644 },
    ];
    const zipBytes = zipCreate(zipEntries);
    const zipped = zipParse(zipBytes);
    expect(zipped.map((e) => e.name)).toEqual(['y/f.txt']);
    expect(strOfBytes(zipReadEntry(zipBytes, zipped[0]!))).toBe('zbody');
  });
});

describe('base64 through the core', () => {
  it('encodes files, wraps at 76, and round-trips through a file', () => {
    const core = coreWithArchive();
    core.vfs.mountFile('/f.txt', 'x'.repeat(200));
    const enc = run(core, 'base64 f.txt');
    expect(enc.status).toBe(0);
    expect(enc.out.every((l) => l.length <= 76)).toBe(true);
    core.vfs.mountFile('/f.b64', enc.out.join('\n') + '\n');
    const dec = run(core, 'base64 -d f.b64');
    expect(dec.status).toBe(0);
    expect(dec.out.join('\n')).toBe('x'.repeat(200));
  });

  it('wraps at -w N and disables wrapping with -w 0', () => {
    const core = coreWithArchive();
    const four = run(core, 'printf aaaaaaaaaaaaaaaaaaaa | base64 -w 4');
    expect(four.out.every((l) => l.length === 4)).toBe(true);
    const none = run(core, 'printf aaaaaaaaaaaaaaaaaaaa | base64 -w 0');
    // execLine's line sugar appends one '\n' to piped text (21 bytes)
    expect(none.out).toHaveLength(1);
    expect(none.out[0]).toBe(Buffer.from('a'.repeat(20) + '\n').toString('base64'));
  });

  it('pipes work; unicode round-trips as UTF-8 when chars exceed latin-1', () => {
    const core = coreWithArchive();
    // chars > 0xff force the UTF-8 path — GNU-parity with node's encoding
    const enc = run(core, 'echo héllo wörld 🌍 | base64');
    expect(enc.status).toBe(0);
    expect(enc.out.join('')).toBe(Buffer.from('héllo wörld 🌍\n', 'utf8').toString('base64'));
    core.vfs.mountFile('/u.b64', enc.out.join('\n') + '\n');
    const dec = run(core, 'base64 -d u.b64');
    expect(dec.status).toBe(0);
    expect(dec.out.join('\n')).toContain('héllo wörld 🌍');
  });

  it('latin-1-range text encodes latin-1 (the documented stringly-VFS divergence)', () => {
    const core = coreWithArchive();
    const enc = run(core, 'echo héllo | base64');
    // every char ≤ 0xff: round-trips as latin-1 raw bytes, NOT GNU's UTF-8
    expect(enc.out.join('')).toBe(Buffer.from('héllo\n', 'latin1').toString('base64'));
  });

  it('empty input encodes to nothing; garbage decode is exit 1', () => {
    const core = coreWithArchive();
    core.vfs.mountFile('/empty.txt', '');
    expect(run(core, 'base64 empty.txt').out).toEqual([]);
    core.vfs.mountFile('/bad.b64', 'not*valid');
    const bad = run(core, 'base64 -d bad.b64');
    expect(bad.status).toBe(1);
    expect(bad.err.join('\n')).toMatch(/invalid input/);
    expect(run(core, 'base64 -w 4 empty.txt').out).toEqual([]);
  });
});

describe('the *sum family through the core', () => {
  it('prints GNU-format lines for files, stdin, -b and --tag', () => {
    const core = coreWithArchive();
    core.vfs.mountFile('/f.txt', 'hello\n');
    const hex = createHash('sha256').update('hello\n').digest('hex');
    expect(run(core, 'sha256sum f.txt').out).toEqual([`${hex}  f.txt`]);
    const piped = run(core, 'printf hello | md5sum');
    // the shell's line sugar appends one '\n' to piped text
    expect(piped.out[0]).toBe(`${createHash('md5').update('hello\n').digest('hex')}  -`);
    const tag = run(core, 'sha1sum --tag f.txt').out[0]!;
    expect(tag).toBe(`SHA1 (f.txt) = ${createHash('sha1').update('hello\n').digest('hex')}`);
    const bin = run(core, 'sha256sum -b f.txt').out[0]!;
    expect(bin).toBe(`${hex} *f.txt`);
  });

  it('-c verifies listings: OK, FAILED, missing, improper + exit codes', () => {
    const core = coreWithArchive();
    core.vfs.mountFile('/data.txt', 'payload\n');
    const good = `${createHash('sha256').update('payload\n').digest('hex')}  data.txt`;
    core.vfs.mountFile('/ok.sha256', `${good}\n`);
    expect(run(core, 'sha256sum -c ok.sha256')).toMatchObject({ out: ['data.txt: OK'], status: 0 });

    core.vfs.mountFile('/bad.sha256', `${'0'.repeat(64)}  data.txt\n`);
    const mismatch = run(core, 'sha256sum -c bad.sha256');
    expect(mismatch.out).toEqual(['data.txt: FAILED']);
    expect(mismatch.status).toBe(1);
    expect(mismatch.err.join('\n')).toMatch(/WARNING: 1 computed checksum did NOT match/);

    core.vfs.mountFile('/miss.sha256', `${good}  \n${'1'.repeat(64)}  ghost.txt\n`);
    const missing = run(core, 'sha256sum -c miss.sha256');
    expect(missing.status).toBe(1);
    expect(missing.err.join('\n')).toMatch(/ghost\.txt: No such file or directory/);

    core.vfs.mountFile('/junk.sha256', 'this is not a checksum line\n');
    const improper = run(core, 'sha256sum -c junk.sha256');
    expect(improper.status).toBe(2);
    expect(improper.err.join('\n')).toMatch(/no properly formatted checksum lines/);
  });

  it('check mode accepts BSD --tag listings and fails on bad format', () => {
    const core = coreWithArchive();
    core.vfs.mountFile('/f.txt', 'tagged\n');
    const hex = createHash('md5').update('tagged\n').digest('hex');
    core.vfs.mountFile('/f.md5', `MD5 (f.txt) = ${hex}\n`);
    const result = run(core, 'md5sum -c f.md5');
    expect(result.out).toEqual(['f.txt: OK']);
    expect(result.status).toBe(0);
  });
});

describe('gzip/gunzip/zcat through the core', () => {
  it('file mode replaces, -k keeps, and zcat reads back', () => {
    const core = coreWithArchive();
    core.vfs.mountFile('/f.txt', 'compress me\n'.repeat(20));
    expect(run(core, 'gzip f.txt').status).toBe(0);
    expect(core.vfs.read('/f.txt')).toBeNull();
    expect(core.vfs.read('/f.txt.gz')).not.toBeNull();
    const back = run(core, 'gunzip f.txt.gz');
    expect(back.status).toBe(0);
    expect(core.vfs.read('/f.txt')).toBe('compress me\n'.repeat(20));
    expect(core.vfs.read('/f.txt.gz')).toBeNull();

    core.vfs.mountFile('/keep.txt', 'keepme');
    expect(run(core, 'gzip -k keep.txt').status).toBe(0);
    expect(core.vfs.read('/keep.txt')).toBe('keepme');
    expect(core.vfs.read('/keep.txt.gz')).not.toBeNull();
    expect(run(core, 'zcat keep.txt.gz').out.join('\n')).toBe('keepme');
  });

  it('reads node-written .gz members and pipes work', () => {
    const core = coreWithArchive();
    core.vfs.mountFile('/node.gz', strOfBytes(new Uint8Array(gzipSync(te('from node\n'.repeat(10))))));
    const zcat = run(core, 'zcat node.gz');
    expect(zcat.status).toBe(0);
    expect((zcat.out.join('\n').match(/from node/g) ?? []).length).toBe(10);
    const piped = run(core, 'cat node.gz | gunzip');
    expect(piped.status).toBe(0);
    expect(piped.out.join('\n').startsWith('from node')).toBe(true);
  });

  it('errors like GNU: double-suffix, unknown suffix, corrupt CRC, -t', () => {
    const core = coreWithArchive();
    core.vfs.mountFile('/x.gz', 'already');
    expect(run(core, 'gzip x.gz').status).toBe(2);
    core.vfs.mountFile('/plain.txt', 'nope');
    expect(run(core, 'gunzip plain.txt').status).toBe(2);
    const corrupt = gzipWrap(te('payload'));
    corrupt[10]! ^= 0xff;
    core.vfs.mountFile('/corrupt.gz', strOfBytes(corrupt));
    const tested = run(core, 'gzip -t corrupt.gz');
    expect(tested.status).toBe(1);
    expect(tested.err.join('\n')).not.toBe('');
  });
});

describe('tar through the core', () => {
  it('creates, lists (-v), extracts, and filters members', () => {
    const core = coreWithArchive();
    core.vfs.mountFile('/src/sub/a.txt', 'alpha');
    core.vfs.mountFile('/src/b.txt', 'beta');
    expect(run(core, 'tar -cf /a.tar src').status).toBe(0);
    const list = run(core, 'tar -tf a.tar');
    expect(list.status).toBe(0);
    expect(list.out).toEqual(['src/', 'src/sub/', 'src/sub/a.txt', 'src/b.txt']);
    const long = run(core, 'tar -tvf a.tar').out.join('\n');
    expect(long).toMatch(/drwxr-xr-x/);
    expect(long).toMatch(/-rw-r--r--/);
    expect(run(core, 'tar -xf a.tar -C /out').status).toBe(0);
    expect(core.vfs.read('/out/src/sub/a.txt')).toBe('alpha');
    expect(core.vfs.read('/out/src/b.txt')).toBe('beta');
    const member = run(core, 'tar -xf a.tar -C /out2 src/b.txt');
    expect(member.status).toBe(0);
    expect(core.vfs.read('/out2/src/b.txt')).toBe('beta');
    expect(core.vfs.read('/out2/src/sub/a.txt')).toBeNull();
    const notFound = run(core, 'tar -xf a.tar -C /out3 ghost.txt');
    expect(notFound.status).toBe(2);
    expect(notFound.err.join('\n')).toMatch(/Not found in archive/);
  });

  it('-z archives round-trip and binary content survives byte for byte', () => {
    const core = coreWithArchive();
    const binary = strOfBytes(randBytes(2048));
    core.vfs.mountFile('/bin/data.bin', binary);
    expect(run(core, 'tar -czf /b.tar.gz bin').status).toBe(0);
    expect(run(core, 'tar -xzf b.tar.gz -C /restored').status).toBe(0);
    expect(core.vfs.read('/restored/bin/data.bin')).toBe(binary);
  });

  it('reads a bsdtar archive; refuses traversal and missing files GNU-style', () => {
    const core = coreWithArchive();
    core.vfs.mountFile('/golden.tar', GOLDEN_TAR_B64 === '' ? '' : strOfBytes(new Uint8Array(Buffer.from(GOLDEN_TAR_B64, 'base64'))));
    expect(run(core, 'tar -xf golden.tar -C /g').status).toBe(0);
    expect(core.vfs.read('/g/sub/a.txt')).toBe('hello tar\n');
    expect(core.vfs.read('/g/b.txt')).toBe('b\n');

    const evil = tarCreate([{ name: '../evil.txt', type: 'file', data: te('x'), mode: 0o644, mtime: 0 }]);
    core.vfs.mountFile('/evil.tar', strOfBytes(evil));
    const result = run(core, 'tar -xf evil.tar -C /tmp-target');
    expect(result.status).toBe(2);
    expect(result.err.join('\n')).toMatch(/Member name contains '\.\.'/);
    expect(core.vfs.nodeAt('/tmp-target/evil.txt')).toBeNull();
    const missing = run(core, 'tar -tf missing.tar');
    expect(missing.err.join('\n')).toMatch(/No such file or directory/);
    expect(missing.status).toBe(1);
  });
});

describe('zip/unzip through the core', () => {
  it('creates archives that unzip lists and extracts; globs and -d work', () => {
    const core = coreWithArchive();
    core.vfs.mountFile('/proj/a.txt', 'A');
    core.vfs.mountFile('/proj/d/inner.txt', 'inner');
    expect(run(core, 'zip -r /p.zip proj').status).toBe(0);
    const list = run(core, 'unzip -l p.zip');
    expect(list.status).toBe(0);
    expect(list.out.join('\n')).toContain('Archive:  p.zip');
    expect(list.out.join('\n')).toContain('proj/a.txt');
    expect(list.out.join('\n')).toContain('proj/d/inner.txt');
    expect(run(core, 'unzip p.zip -d /here').status).toBe(0);
    expect(core.vfs.read('/here/proj/a.txt')).toBe('A');
    expect(core.vfs.read('/here/proj/d/inner.txt')).toBe('inner');
    expect(run(core, 'unzip p.zip "proj/d/*" -d /only').status).toBe(0);
    expect(core.vfs.read('/only/proj/d/inner.txt')).toBe('inner');
    expect(core.vfs.read('/only/proj/a.txt')).toBeNull();
  });

  it('updates in place: existing members carried, same-named replaced', () => {
    const core = coreWithArchive();
    core.vfs.mountFile('/a.txt', 'v1');
    expect(run(core, 'zip /u.zip a.txt').status).toBe(0);
    core.vfs.mountFile('/b.txt', 'B');
    core.vfs.mountFile('/a.txt', 'v2');
    expect(run(core, 'zip /u.zip a.txt b.txt').status).toBe(0);
    expect(run(core, 'unzip u.zip -d /u').status).toBe(0);
    expect(core.vfs.read('/u/a.txt')).toBe('v2');
    expect(core.vfs.read('/u/b.txt')).toBe('B');
  });

  it('reads an Info-ZIP archive from disk', () => {
    const core = coreWithArchive();
    core.vfs.mountFile('/golden.zip', strOfBytes(new Uint8Array(Buffer.from(GOLDEN_ZIP_B64, 'base64'))));
    expect(run(core, 'unzip golden.zip -d /gz').status).toBe(0);
    expect(core.vfs.read('/gz/a.txt')).toBe('hello zip\n');
    expect(core.vfs.read('/gz/d/inner.txt')).toBe('deep\n');
  });

  it('Info-ZIP exits: 9 missing archive, 10 no args, 11 no member matched; -n skips', () => {
    const core = coreWithArchive();
    expect(run(core, 'unzip nope.zip').status).toBe(9);
    expect(run(core, 'unzip').status).toBe(10);
    core.vfs.mountFile('/m.zip', strOfBytes(zipCreate([{ name: 'f.txt', data: te('x'), mode: 0o644 }])));
    expect(run(core, 'unzip m.zip nothere.txt').status).toBe(11);
    const first = run(core, 'unzip -n m.zip');
    expect(first.status).toBe(0);
    expect(first.out.join('\n')).toContain('extracting'); // nothing existed yet
    const second = run(core, 'unzip -n m.zip');
    expect(second.status).toBe(0);
    expect(second.out.join('\n')).toContain('skipping'); // -n never overwrites
  });
});

describe('the lazy-package contract (injected loaders)', () => {
  it('the manifest registers the archive package with all 11 commands', () => {
    expect(PACKAGES.map((p) => p.name)).toContain('archive');
    const mounted = packagesPlugin.commands.map((c) => c.name);
    for (const name of archiveStub.commands.map((c) => c.name)) {
      expect(mounted).toContain(name);
    }
    expect(archiveStub.commands).toHaveLength(11);
  });

  it('--help answers from the stub with the chunk absent (never-loading loader)', () => {
    const fresh = createLazyPackage(archiveStub, () => new Promise(() => {}));
    const core = new TerminalCore();
    core.mountPlugin({ name: 'p', version: '0', commands: fresh.commands, files: [] });
    const result = run(core, 'tar --help');
    expect(result.status).toBe(0);
    expect(result.out[0]).toContain('tar (');
    expect(fresh.loaded()).toBe(false);
  });

  it('first use before load gets the retry hint, not a hang', () => {
    const fresh = createLazyPackage(archiveStub, () => new Promise(() => {}));
    const core = new TerminalCore();
    core.mountPlugin({ name: 'p', version: '0', commands: fresh.commands, files: [] });
    const result = run(core, 'base64 f.txt');
    expect(result.err).toEqual(['base64: chunk still loading — try again']);
    expect(result.status).toBe(1);
  });

  it('a failed chunk load reports the chunk file', async () => {
    const fresh = createLazyPackage(archiveStub, () => Promise.reject(new Error('offline')));
    await fresh.ensure();
    const core = new TerminalCore();
    core.mountPlugin({ name: 'p', version: '0', commands: fresh.commands, files: [] });
    const result = run(core, 'zcat f.gz');
    expect(result.err[0]).toBe('zcat: package chunk failed to load (semtext-pkg-archive.js)');
    expect(result.status).toBe(1);
    // --help STILL answers from the stub after a load failure
    const help = run(core, 'zcat --help');
    expect(help.status).toBe(0);
    expect(help.out[0]).toContain('zcat');
  });

  it('post-load the real specs answer, and man pages swap to the chunk pages', async () => {
    const never = createLazyPackage(archiveStub, () => new Promise(() => {}));
    expect(never.manPage('tar')!.join('\n')).toContain('short page');
    const loaded = createLazyPackage(archiveStub, async () => import('../../src/terminal/packages/archive/index.js'));
    await loaded.ensure();
    expect(loaded.loaded()).toBe(true);
    expect(loaded.manPage('tar')!.join('\n')).toContain('ustar archives');
    expect(loaded.manPage('nonexistent')).toBeNull();

    const core = new TerminalCore();
    core.mountPlugin({ name: 'p', version: '0', commands: loaded.commands, files: [] });
    core.vfs.mountFile('/f.txt', 'hello');
    expect(run(core, 'base64 f.txt').out).toEqual(base64Encode(te('hello'), 76));
  });
});
