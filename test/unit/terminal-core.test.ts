// @vitest-environment happy-dom
// Unit spec — the terminal core: plugin mounting, loading, dispatch
// (src/terminal/terminal-core.ts + src/terminal/loader.ts)
//
// Feature: mounting a JS-object manifest
//   Scenario: commands register, files mount, provenance recorded
//   Scenario: a duplicate command fails the whole mount, nothing partial
// Feature: command dispatch
//   Scenario: stdin flows down a pipeline (cat file | semtext outline)
//   Scenario: builtins (help lists, clear flags) and unknown commands
// Feature: plugin loading by URL
//   Scenario: a relative manifest URL loads (success path)
//   Scenario: an integrity fragment mismatch is refused
//   Scenario: one plugin failing does not stop the others
// Feature: CDN rules (PLUGINS.md) — refusals happen BEFORE any network
//   Scenario: absolute https manifest URL with no integrity hash is refused
//   Scenario: a JSON manifest pointing its commands at https with no hash is refused

import { describe, it, expect, afterEach, vi } from 'vitest';
import { TerminalCore } from '../../src/terminal/terminal-core.js';
import { demoPlugin } from '../../src/terminal/plugins/demo/plugin.js';
import { posixPlugin } from '../../src/terminal/plugins/posix/plugin.js';

/** Demo + POSIX: the bundle <sem-shell> mounts. */
function mountBundled(core: TerminalCore): void {
  for (const plugin of [posixPlugin, demoPlugin]) {
    const result = core.mountPlugin(plugin);
    if (!result.ok) throw new Error(result.error ?? `${plugin.name} failed to mount`);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function sha256hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('mountPlugin (JS-object manifest)', () => {
  it('registers commands, mounts files, records provenance', () => {
    const core = new TerminalCore();
    const result = core.mountPlugin(demoPlugin);
    expect(result.ok).toBe(true);
    expect(result.plugin).toEqual({ name: 'semtext-demo', version: '0.1.0' });
    expect(core.hasCommand('semtext')).toBe(true);
    expect(core.hasCommand('open')).toBe(true);
    expect(core.vfs.read('/demo/welcome.html')).toContain('<h1>Welcome</h1>');
    expect(core.plugins).toEqual([{ name: 'semtext-demo', version: '0.1.0' }]);
  });

  it('a duplicate command fails the whole mount, nothing partial', () => {
    const core = new TerminalCore();
    core.mountPlugin(demoPlugin);
    const clash = { name: 'clash', version: '1.0.0', commands: [{ name: 'semtext', usage: 'semtext', run: () => {} }], files: [{ path: '/clash.txt', content: 'x' }] };
    const result = core.mountPlugin(clash);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already registered/);
    expect(core.vfs.read('/clash.txt')).toBeNull(); // no partial file mount
    expect(core.hasCommand('clash-only')).toBe(false);
  });
});

describe('execLine (dispatch)', () => {
  it('stdin flows down a pipeline: cat file | semtext outline', () => {
    const core = new TerminalCore();
    mountBundled(core);
    const result = core.execLine('cat demo/welcome.html | semtext outline');
    const out = result.lines.filter((l) => l.kind === 'stdout').map((l) => l.text);
    expect(out.some((t) => t.startsWith('h1 Welcome'))).toBe(true);
    expect(out.some((t) => t.includes('sem-note tip'))).toBe(true);
  });

  it('semtext without a file and without stdin reports how to pipe', () => {
    const core = new TerminalCore();
    core.mountPlugin(demoPlugin);
    const result = core.execLine('semtext outline');
    expect(result.lines.some((l) => l.kind === 'stderr' && l.text.includes('no input file'))).toBe(true);
  });

  it('help lists every registered command; unknown commands are stderr, not throws', () => {
    const core = new TerminalCore();
    mountBundled(core);
    const help = core.execLine('help');
    const text = help.lines.map((l) => l.text).join('\n');
    expect(text).toContain('ls [-1aRh]');
    expect(text).toContain('semtext <sub>');
    expect(text).toContain('clear — wipe the transcript');
    const nope = core.execLine('nope');
    expect(nope.lines.some((l) => l.kind === 'stderr' && l.text === 'sh: command not found: nope')).toBe(true);
  });

  it('cd mutates the shared state; clear flags without lines', () => {
    const core = new TerminalCore();
    mountBundled(core);
    core.execLine('cd demo');
    expect(core.execLine('pwd').lines[1].text).toBe('/demo');
    expect(core.execLine('clear').clear).toBe(true);
  });
});

describe('loadPluginFromUrl', () => {
  const MINI = JSON.stringify({ name: 'mini', version: '1.2.3', files: [{ path: '/mini/hello.txt', content: 'hi' }] });

  it('loads a relative manifest URL (success path)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(MINI, { status: 200 })));
    const core = new TerminalCore();
    const result = await core.loadPluginFromUrl('plugins/mini.json#sha256-' + (await sha256hex(MINI)));
    expect(result.ok).toBe(true);
    expect(result.plugin).toEqual({ name: 'mini', version: '1.2.3' });
    expect(core.vfs.read('/mini/hello.txt')).toBe('hi');
  });

  it('an integrity fragment mismatch is refused', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(MINI, { status: 200 })));
    const core = new TerminalCore();
    const result = await core.loadPluginFromUrl('plugins/mini.json#sha256-' + '0'.repeat(64));
    expect(result.ok).toBe(false);
    expect(core.loadErrors[0].message).toMatch(/integrity mismatch/);
    expect(core.plugins).toHaveLength(0);
  });

  it('one plugin failing does not stop the others', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        if (String(url) === 'bad.json') return new Response('server on fire', { status: 500 });
        return new Response(MINI, { status: 200 });
      }),
    );
    const core = new TerminalCore();
    const bad = await core.loadPluginFromUrl('bad.json');
    const good = await core.loadPluginFromUrl('good.json');
    expect(bad.ok).toBe(false);
    expect(good.ok).toBe(true);
    expect(core.loadErrors.map((e) => e.url)).toEqual(['bad.json']);
    expect(core.plugins.map((p) => p.name)).toEqual(['mini']);
  });
});

describe('CDN rules — refusals happen BEFORE any network request', () => {
  it('an absolute https manifest URL with no integrity hash is refused, unfetched', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const core = new TerminalCore();
    const result = await core.loadPluginFromUrl('https://cdn.example.com/semtext/manifest.json');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/integrity/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(core.loadErrors[0].url).toBe('https://cdn.example.com/semtext/manifest.json');
  });

  it('a JSON manifest pointing its commands at https with no hash is refused after exactly one fetch (the manifest)', async () => {
    const manifest = JSON.stringify({
      name: 'remote',
      version: '1.0.0',
      load: { src: 'https://cdn.example.com/remote/commands.js' },
    });
    const fetchMock = vi.fn(async () => new Response(manifest, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const core = new TerminalCore();
    const result = await core.loadPluginFromUrl('remote/manifest.json');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/CDN source .* integrity/);
    expect(fetchMock).toHaveBeenCalledTimes(1); // the manifest only, never the module
    expect(core.plugins).toHaveLength(0);
  });
});

describe('help grouping + did-you-mean', () => {
  const gitLike = {
    name: 'gitish',
    version: '1.0.0',
    commands: [{ name: 'git', usage: 'git <sub> — vcs', run: () => {} }],
    files: [],
  };

  it('groups commands under their plugin header; help <cmd> shows one', () => {
    const core = new TerminalCore();
    expect(core.mountPlugin(gitLike).ok).toBe(true);
    const text = (core.execLine('help') as { lines: { text: string }[] }).lines.map((l) => l.text);
    expect(text.indexOf('(builtin):')).toBeGreaterThan(-1);
    const header = text.indexOf('gitish:');
    expect(header).toBeGreaterThan(text.indexOf('(builtin):'));
    expect(text[header + 1]).toBe('  git <sub> — vcs');
    const one = (core.execLine('help git') as { lines: { kind: string; text: string }[] }).lines.filter((l) => l.kind === 'stdout').map((l) => l.text);
    expect(one).toEqual(['git <sub> — vcs', '  provided by gitish']);
  });

  it('suggests the closest command for unknown ones (exit 127)', () => {
    const core = new TerminalCore();
    core.mountPlugin(gitLike);
    const res = core.execLine('gti status') as { lines: { kind: string; text: string }[] };
    const errs = res.lines.filter((l) => l.kind === 'stderr').map((l) => l.text);
    expect(errs).toContain('sh: command not found: gti');
    expect(errs).toContain("sh: did you mean 'git'?");
    expect(core.state.lastStatus).toBe(127);
    const far = core.execLine('zzzzzzzz') as { lines: { kind: string; text: string }[] };
    expect(far.lines.some((l) => l.text.includes('did you mean'))).toBe(false);
  });
});

describe('mountPlugin atomicity + guards', () => {
  it('a failing file leaves no files and no commands behind', () => {
    const core = new TerminalCore();
    core.vfs.mountFile('/taken', 'file');
    const result = core.mountPlugin({
      name: 'half',
      version: '1.0.0',
      commands: [{ name: 'halfcmd', usage: 'halfcmd', run: () => {} }],
      files: [
        { path: '/good.txt', content: 'ok' },
        { path: '/taken/inside.txt', content: 'bad' },
      ],
    });
    expect(result.ok).toBe(false);
    expect(core.vfs.read('/good.txt')).toBeNull();
    expect(core.hasCommand('halfcmd')).toBe(false);
    expect(core.plugins).toHaveLength(0);
  });

  it('ctx.commands is a read-only view', () => {
    const core = new TerminalCore();
    let view: ReadonlyMap<string, unknown> | null = null;
    core.mountPlugin({
      name: 'peek',
      version: '1.0.0',
      commands: [{ name: 'peek', usage: 'peek', run: (ctx) => { view = ctx.commands; } }],
      files: [],
    });
    core.execLine('peek');
    expect(view!.has('peek')).toBe(true);
    expect(view!.size).toBe(core.commands.size);
    expect((view as unknown as { set?: unknown }).set).toBeUndefined();
    expect((view as unknown as { delete?: unknown }).delete).toBeUndefined();
  });
});

describe('mount builtin + backend lifecycle', () => {
  function fakeKind(core: TerminalCore) {
    const log: string[] = [];
    let disposed = 0;
    core.mountKinds.set('fake', {
      id: 'fake',
      help: 'fake',
      create: (args) => ({
        id: 'fake',
        writable: true,
        mountpoint: args[0] ?? '/fake',
        stat: async () => null,
        read: async () => null,
        write: async (path: string) => { log.push('write ' + path); },
        mkdirp: async () => {},
        rm: async () => {},
        rename: async () => {},
        list: async () => [],
        dispose: () => { disposed++; },
        hydrate: async (put: (p: string, c: string) => void) => { put('seeded.txt', 'S'); },
      }),
    });
    return { log, disposed: () => disposed };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('mount attaches (writes flush), hydration does not PUT, umount disposes', async () => {
    const core = new TerminalCore();
    const probe = fakeKind(core);
    await core.execLine('mount fake /fake');
    await settle();
    expect(core.vfs.mounts.has('/fake')).toBe(true);
    expect(core.vfs.read('/fake/seeded.txt')).toBe('S');
    expect(probe.log).toEqual([]); // hydration seeded without uploading
    core.vfs.mountFile('/fake/new.txt', 'N');
    await settle();
    expect(probe.log).toEqual(['write /fake/new.txt']);
    await core.execLine('umount /fake');
    expect(core.vfs.mounts.has('/fake')).toBe(false);
    expect(probe.disposed()).toBe(1);
  });

  it('refuses an occupied mountpoint and a mount at /', async () => {
    const core = new TerminalCore();
    const probe = fakeKind(core);
    await core.execLine('mount fake /fake');
    const again = (await core.execLine('mount fake /fake')) as { lines: { kind: string; text: string }[] };
    expect(again.lines.some((l) => l.kind === 'stderr' && /already a mountpoint/.test(l.text))).toBe(true);
    const root = (await core.execLine('mount fake /')) as { lines: { kind: string; text: string }[] };
    expect(root.lines.some((l) => l.kind === 'stderr' && /refusing to mount over \//.test(l.text))).toBe(true);
    expect(core.vfs.mounts.has('/')).toBe(false);
    expect(probe.disposed()).toBe(2);
  });
});
