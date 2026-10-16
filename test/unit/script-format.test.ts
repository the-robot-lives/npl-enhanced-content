// script-format — the demo line grammar and start-script value resolution.
import { describe, it, expect } from 'vitest';
import {
  parseDemoScript, resolveScriptValue, looksLikeScriptPath, keyPresses,
  DEFAULT_TYPE_MS, DEFAULT_WAIT_MS, DEFAULT_PAUSE_MS,
} from '../../src/terminal/script/demo-format.js';

const types = (steps: { type: string }[]) => steps.map((s) => s.type);

describe('parseDemoScript', () => {
  it('blank input has no script', () => {
    expect(parseDemoScript('')).toEqual(null);
    expect(parseDemoScript('   \n  ')).toEqual(null);
    expect(parseDemoScript(null)).toEqual(null);
  });

  it('a $ line types, executes, and pauses', () => {
    const steps = parseDemoScript('$ ls')!;
    expect(types(steps)).toEqual(['type', 'run', 'wait']);
    expect(steps[0]).toEqual({ type: 'type', text: 'ls' });
  });

  it('a heading and a description land as comments', () => {
    const steps = parseDemoScript('# H\n## D')!;
    expect(steps).toEqual([
      { type: 'comment', text: 'H' },
      { type: 'comment', text: 'D' },
    ]);
  });

  it('@type and @input both type without running', () => {
    for (const line of ['@type hi', '@input hi']) {
      expect(parseDemoScript(line)).toEqual([{ type: 'type', text: 'hi' }]);
    }
  });

  it('@key splits bare multi-char tokens and maps bracketed names', () => {
    expect(parseDemoScript('@key <Down>')).toEqual([{ type: 'key', key: 'ArrowDown' }]);
    expect(parseDemoScript('@key q')).toEqual([{ type: 'key', key: 'q' }]);
    expect(parseDemoScript('@key :q')).toEqual([
      { type: 'key', key: ':' },
      { type: 'key', key: 'q' },
    ]);
  });

  it('@sleep takes seconds, defaults without one', () => {
    expect(parseDemoScript('@sleep 1.5')).toEqual([{ type: 'wait', ms: 1500 }]);
    expect(parseDemoScript('@sleep')).toEqual([{ type: 'wait', ms: DEFAULT_WAIT_MS }]);
  });

  it('@prompt prints and pauses; @expect asserts; @clear is a no-op', () => {
    const prompt = parseDemoScript('@prompt go on')!;
    expect(types(prompt)).toEqual(['comment', 'wait']);
    expect(parseDemoScript('@clear')).toEqual(null); // a script of pure no-ops is no script
    expect(parseDemoScript('@expect hello')).toEqual([{ type: 'expect', text: 'hello' }]);
  });

  it('an unknown directive becomes a comment, never a throw', () => {
    const steps = parseDemoScript('@wat x')!;
    expect(types(steps)).toEqual(['comment']);
    expect(steps[0].text).toContain('@wat');
  });

  it('plain prose lines land as comments', () => {
    expect(parseDemoScript('just talking')).toEqual([{ type: 'comment', text: 'just talking' }]);
  });

  it('the defaults are the runner-tuned beats', () => {
    expect(DEFAULT_TYPE_MS).toBe(45);
    expect(DEFAULT_WAIT_MS).toBe(400);
    expect(DEFAULT_PAUSE_MS).toBe(900);
  });
});

describe('keyPresses', () => {
  it('bracketed tokens map one-to-one; bare tokens split to chars', () => {
    expect(keyPresses('<Enter>')).toEqual(['Enter']);
    expect(keyPresses('<esc>')).toEqual(['Escape']);
    expect(keyPresses('<f5>')).toEqual(['f5']);
    expect(keyPresses('q')).toEqual(['q']);
    expect(keyPresses(':wq')).toEqual([':', 'w', 'q']);
  });
});

describe('resolveScriptValue', () => {
  it('blank means no demo', () => {
    expect(resolveScriptValue('')).toEqual(null);
    expect(resolveScriptValue('  ')).toEqual(null);
    expect(resolveScriptValue(null)).toEqual(null);
  });

  it('a JSON array parses with unknown step types dropped', () => {
    const steps = resolveScriptValue('[{"type":"comment","text":"hi"},{"type":"mystery"}]')!;
    expect(steps).toEqual([{ type: 'comment', text: 'hi' }]);
  });

  it('a landing name expands to its script', () => {
    const steps = resolveScriptValue('landing-code')!;
    expect(steps.length).toBeGreaterThan(3);
    expect(steps[0].type).toBe('comment');
  });

  it('anything else parses as an inline line script', () => {
    expect(types(resolveScriptValue('$ bat')!)).toEqual(['type', 'run', 'wait']);
  });
});

describe('looksLikeScriptPath', () => {
  it('site paths — the landing contract — are fetchable', () => {
    expect(looksLikeScriptPath('/demo/scripts/code.txt')).toBe(true);
    expect(looksLikeScriptPath('./scripts/tui.txt')).toBe(true);
    expect(looksLikeScriptPath('../demo/cli.txt')).toBe(true);
    expect(looksLikeScriptPath('scripts/code.demo')).toBe(true);
  });

  it('inline scripts and named demos are not fetchable', () => {
    expect(looksLikeScriptPath('$ echo hi\n@expect hi')).toBe(false);
    expect(looksLikeScriptPath('landing-code')).toBe(false);
    expect(looksLikeScriptPath('[{"type":"comment","text":"x"}]')).toBe(false);
    expect(looksLikeScriptPath('')).toBe(false);
  });
});
