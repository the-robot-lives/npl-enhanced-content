// Unit spec — ANSI/VT tokeniser: the streaming state machine
// (src/terminal/ansi/parser.ts).
//
// Feature: text + controls
//   Scenario: plain output passes through as one text run
//   Scenario: LF/CR/BS/TAB become control tokens; other C0 (BEL, NUL) are dropped
//   Scenario: text coalesces across writes; a run boundary only falls on tokens
// Feature: SGR
//   Scenario: an SGR sequence emits the snapshot in force after it
//   Scenario: attribute state carries across writes and across lines
// Feature: cursor + erase
//   Scenario: CUU/CUD/CUF/CUB/CHA/CUP finals map to cursor tokens with params
//   Scenario: ED/EL map to erase tokens; a missing parameter means mode 0
//   Scenario: ESC 7 / ESC 8 arrive as save/restore cursor tokens
// Feature: everything else is consumed, never printed
//   Scenario: private CSI (?1049 h) arrives as a csi token carrying its prefix
//   Scenario: OSC ends on BEL or ST; the `code;data` split is exact
//   Scenario: DCS/SOS/PM/APC strings are swallowed whole (BEL tolerated)
//   Scenario: charset designators consume one byte
//   Scenario: no text token ever contains an escape byte or a dangling fragment
// Feature: malformed input
//   Scenario: a C0 inside CSI aborts the sequence and counts it
//   Scenario: an ESC inside CSI restarts the escape (old sequence dropped, counted)
//   Scenario: a sequence unterminated at flush() is dropped and counted
//   Scenario: OSC aborted by ESC + other is dropped and counted
// Feature: reset
//   Scenario: reset() clears attributes, buffers and pending text
// Feature: streaming equivalence
//   Scenario: feeding byte-by-byte is token-identical to feeding the whole string

import { describe, it, expect } from 'vitest';
import { AnsiStateMachine } from '../../src/terminal/ansi/parser.js';
import { DEFAULT_SGR } from '../../src/terminal/ansi/types.js';
import type { AnsiToken } from '../../src/terminal/ansi/types.js';

const run = (input: string, cut = 0): AnsiToken[] => {
  const machine = new AnsiStateMachine();
  const tokens = [...machine.write(input.slice(0, cut)), ...machine.write(input.slice(cut))];
  tokens.push(...machine.flush());
  return tokens;
};

/** Coalesce adjacent text tokens so a chunk split cannot manufacture runs. */
const coalesced = (tokens: AnsiToken[]): AnsiToken[] => {
  const out: AnsiToken[] = [];
  for (const token of tokens) {
    const last = out[out.length - 1];
    if (token.type === 'text' && last?.type === 'text') {
      out[out.length - 1] = { type: 'text', text: last.text + token.text, attrs: last.attrs };
      continue;
    }
    out.push(token);
  }
  return out;
};

const NOISY = '\x1b[1;38:5:196m bold \x1b[0m plain \n tab\there \x1b]0;the title\x07 \x1b[?1049h\x1b[2J\x1b[2;5Hcursor';

describe('text + controls', () => {
  it('plain output passes through as one text run', () => {
    expect(coalesced(run('hello world'))).toEqual([{ type: 'text', text: 'hello world', attrs: DEFAULT_SGR }]);
  });

  it('LF/CR/BS/TAB become control tokens; other C0 are dropped silently', () => {
    expect(coalesced(run('a\nb\rc\bd\te\x07f\x00g'))).toEqual([
      { type: 'text', text: 'a', attrs: DEFAULT_SGR },
      { type: 'control', char: '\n' },
      { type: 'text', text: 'b', attrs: DEFAULT_SGR },
      { type: 'control', char: '\r' },
      { type: 'text', text: 'c', attrs: DEFAULT_SGR },
      { type: 'control', char: '\b' },
      { type: 'text', text: 'd', attrs: DEFAULT_SGR },
      { type: 'control', char: '\t' },
      { type: 'text', text: 'efg', attrs: DEFAULT_SGR },
    ]);
  });

  it('text coalesces across writes', () => {
    const machine = new AnsiStateMachine();
    const tokens = coalesced([...machine.write('ab'), ...machine.write('cd'), ...machine.flush()]);
    expect(tokens).toEqual([{ type: 'text', text: 'abcd', attrs: DEFAULT_SGR }]);
  });
});

describe('SGR', () => {
  it('an SGR sequence emits the snapshot in force after it', () => {
    const tokens = run('\x1b[1m');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.type).toBe('sgr');
    expect((tokens[0] as Extract<AnsiToken, { type: 'sgr' }>).attrs.bold).toBe(true);
  });

  it('attribute state carries across writes', () => {
    const machine = new AnsiStateMachine();
    machine.write('\x1b[1m');
    const tokens = machine.write('red next');
    // the 'red next' text token comes with bold already in force
    const text = tokens.find((t) => t.type === 'text');
    expect(text).toBeDefined();
    expect(machine.sgr).toMatchObject({ bold: true });
  });
});

describe('cursor + erase', () => {
  it('movement finals map to cursor tokens with parameters', () => {
    expect(coalesced(run('\x1b[2A'))).toEqual([{ type: 'cursor', final: 'A', params: [2] }]);
    expect(coalesced(run('\x1b[2;5H'))).toEqual([{ type: 'cursor', final: 'H', params: [2, 5] }]);
    expect(coalesced(run('\x1b[H'))).toEqual([{ type: 'cursor', final: 'H', params: [null] }]); // one omitted group
    expect(coalesced(run('\x1b[5C'))).toEqual([{ type: 'cursor', final: 'C', params: [5] }]);
    expect(coalesced(run('\x1b[3d'))).toEqual([{ type: 'cursor', final: 'd', params: [3] }]);
  });

  it('ED/EL map to erase tokens; a missing parameter means mode 0', () => {
    expect(coalesced(run('\x1b[2J'))).toEqual([{ type: 'erase', final: 'J', mode: 2 }]);
    expect(coalesced(run('\x1b[1K'))).toEqual([{ type: 'erase', final: 'K', mode: 1 }]);
    expect(coalesced(run('\x1b[K'))).toEqual([{ type: 'erase', final: 'K', mode: 0 }]);
  });

  it('ESC 7 / ESC 8 arrive as save/restore cursor tokens', () => {
    expect(coalesced(run('\x1b7'))).toEqual([{ type: 'cursor', final: 's', params: [] }]);
    expect(coalesced(run('\x1b8'))).toEqual([{ type: 'cursor', final: 'u', params: [] }]);
  });
});

describe('everything else is consumed, never printed', () => {
  it('private CSI arrives as a csi token carrying its prefix', () => {
    expect(coalesced(run('\x1b[?1049h'))).toEqual([{ type: 'csi', final: 'h', params: [1049], prefix: '?' }]);
  });

  it('OSC ends on BEL or ST; the code;data split is exact', () => {
    expect(coalesced(run('\x1b]0;title here\x07'))).toEqual([{ type: 'osc', code: 0, data: 'title here' }]);
    expect(coalesced(run('\x1b]2;second\x1b\\'))).toEqual([{ type: 'osc', code: 2, data: 'second' }]);
    expect(coalesced(run('\x1b]8;;https://x\x07'))).toEqual([{ type: 'osc', code: 8, data: ';https://x' }]);
    expect(coalesced(run('\x1b]2\x07'))).toEqual([{ type: 'osc', code: 2, data: '' }]); // no data section
  });

  it('DCS/SOS/PM/APC strings are swallowed whole (BEL tolerated)', () => {
    expect(coalesced(run('\x1bP1$r\x1b\\after'))).toEqual([{ type: 'text', text: 'after', attrs: DEFAULT_SGR }]);
    expect(coalesced(run('\x1b^notification\x07after'))).toEqual([{ type: 'text', text: 'after', attrs: DEFAULT_SGR }]);
  });

  it('charset designators consume one byte', () => {
    expect(coalesced(run('\x1b(Bafter'))).toEqual([{ type: 'text', text: 'after', attrs: DEFAULT_SGR }]);
  });

  it('no text token ever contains an escape byte or a dangling fragment', () => {
    for (const token of run(NOISY)) {
      if (token.type !== 'text') continue;
      expect(token.text.includes('\x1b')).toBe(false);
      expect(token.text.startsWith('[')).toBe(false);
    }
  });
});

describe('malformed input', () => {
  it('a C0 inside CSI aborts the sequence and counts it', () => {
    const machine = new AnsiStateMachine();
    const tokens = coalesced([...machine.write('a\x1b[3\nb'), ...machine.flush()]);
    expect(tokens).toEqual([{ type: 'text', text: 'ab', attrs: DEFAULT_SGR }]);
    expect(machine.droppedSequences).toBe(1);
  });

  it('an ESC inside CSI restarts the escape; the old sequence is dropped and counted', () => {
    const machine = new AnsiStateMachine();
    const tokens = coalesced([...machine.write('\x1b[3\x1b[1m'), ...machine.flush()]);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.type).toBe('sgr');
    expect(machine.droppedSequences).toBe(1);
  });

  it('a sequence unterminated at flush() is dropped and counted', () => {
    for (const tail of ['\x1b', '\x1b[3', '\x1b]0;half', '\x1bPdata', '\x1b(']) {
      const machine = new AnsiStateMachine();
      const tokens = coalesced([...machine.write(`ok${tail}`), ...machine.flush()]);
      expect(tokens).toEqual([{ type: 'text', text: 'ok', attrs: DEFAULT_SGR }]);
      expect(machine.droppedSequences).toBe(1);
    }
  });

  it('OSC aborted by ESC + other is dropped and counted', () => {
    const machine = new AnsiStateMachine();
    expect(coalesced([...machine.write('\x1b]0;title\x1bXafter'), ...machine.flush()])).toEqual([
      { type: 'text', text: 'after', attrs: DEFAULT_SGR },
    ]);
    expect(machine.droppedSequences).toBe(1);
  });
});

describe('reset', () => {
  it('reset() clears attributes, buffers and pending text', () => {
    const machine = new AnsiStateMachine();
    machine.write('\x1b[1;31mpending');
    machine.reset();
    expect(machine.sgr).toEqual(DEFAULT_SGR);
    expect(machine.flush()).toEqual([]);
    expect(machine.write('after')).toEqual([{ type: 'text', text: 'after', attrs: DEFAULT_SGR }]);
  });
});

describe('streaming equivalence', () => {
  it('feeding at every byte boundary is token-identical to one-shot feeding', () => {
    const whole = coalesced(run(NOISY));
    for (let cut = 1; cut < NOISY.length; cut++) {
      expect(coalesced(run(NOISY, cut)), `split after byte ${cut}`).toEqual(whole);
    }
  });

  it('a long gnarly fixture parses without noise in any split', () => {
    const gnarly = '\x1b]0;t\x1b\\pre\x1b[38;2;12;34;56mcolour\x1b[48;5;21m\x1b[0;39;49m\x1b(B\x1b=\x1bMdone';
    const whole = coalesced(run(gnarly));
    for (const token of whole) {
      if (token.type === 'text') expect(token.text.includes('\x1b')).toBe(false);
    }
    for (let cut = 1; cut < gnarly.length; cut++) {
      expect(coalesced(run(gnarly, cut)), `split after byte ${cut}`).toEqual(whole);
    }
  });
});
