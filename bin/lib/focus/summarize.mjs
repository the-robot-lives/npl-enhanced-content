/**
 * focus/summarize — section TL;DRs through an OpenAI-compatible chat
 * completions endpoint (qwen3.8-flash on the Alibaba token plan by
 * default; see focus/config summarizerSettings).
 *
 * Two prompt modes:
 *   - generic: a task-agnostic 1-2 sentence summary that keeps hard
 *     constraints (numbers, names, rules) — the cacheable default.
 *   - tweak: minimally edit a prior TL;DR given a unified diff of what
 *     changed in the section — the cheap path when a section drifted.
 *
 * Missing credentials raise SummarizerError with an env-var hint (names
 * only — values never cross this module's boundary).
 */

export class SummarizerError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'SummarizerError';
    this.envHint = options.envHint || null;
  }
}

const GENERIC_SYSTEM =
  'You write one-sentence TL;DRs for document sections. Task-agnostic: ' +
  'no audience, no task context. Keep hard constraints (numbers, names, ' +
  'rules, commands) exactly. Output ONLY the sentence(s) — no preamble, ' +
  'no quotes, at most two sentences.';

const TWEAK_SYSTEM =
  'You maintain one-sentence TL;DRs for document sections. You are given ' +
  'the current TL;DR and a unified diff of the section. Change the TL;DR ' +
  'as little as possible so it stays accurate; keep hard constraints ' +
  'exactly. Output ONLY the revised sentence(s) — no preamble, no quotes.';

const NOTE_SYSTEM =
  'You write one-line task-specific footnotes for document sections. ' +
  'Given a task/purpose and a section, the footnote states in ONE line ' +
  'what in this section matters for that task — concrete, no filler. ' +
  'Output ONLY the line — no preamble, no quotes, no markdown.';

export function genericPrompt({ text, heading }) {
  return {
    system: GENERIC_SYSTEM,
    user: `Section heading: ${heading}\n\nSection content:\n${text}`
  };
}

export function tweakPrompt({ prior, diff, heading }) {
  return {
    system: TWEAK_SYSTEM,
    user: `Section heading: ${heading}\n\nCurrent TL;DR: ${prior}\n\nUnified diff of the section:\n${diff}`
  };
}

export function notePrompt({ task, text, heading }) {
  return {
    system: NOTE_SYSTEM,
    user: `Task/purpose: ${task}\n\nSection heading: ${heading}\n\nSection content:\n${text}`
  };
}

export function settingsReady(s) {
  return !!(s.key && s.base);
}

export function settingsHint(s) {
  const parts = [];
  if (s.keyEnv && s.keyEnv.length) parts.push(`set ${s.keyEnv.join(' or ')}`);
  if (s.baseEnv) parts.push(`set ${s.baseEnv}`);
  return parts.join(' and ');
}

/**
 * One chat completion. `settings` = summarizerSettings() shape. Returns
 * the trimmed message content.
 */
export async function chatComplete({ settings, system, user, fetchImpl, timeoutMs = 60000 }) {
  if (!settingsReady(settings)) {
    throw new SummarizerError(
      `summarizer is not configured — ${settingsHint(settings)} (or rerun with --no-llm)`,
      { envHint: settingsHint(settings) }
    );
  }
  const doFetch = fetchImpl || globalThis.fetch;
  if (!doFetch) throw new SummarizerError('no fetch implementation available (Node >= 18 required)');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await doFetch(settings.base.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + settings.key, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      }),
      signal: controller.signal
    });
  } catch (e) {
    throw new SummarizerError(`summarizer transport error — ${e && e.message ? e.message : e}`);
  } finally {
    clearTimeout(timer);
  }
  if (res.status !== 200) throw new SummarizerError(`summarizer HTTP ${res.status}`);
  let json;
  try {
    json = await res.json();
  } catch {
    throw new SummarizerError('summarizer response is not valid JSON');
  }
  const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (typeof content !== 'string') throw new SummarizerError('summarizer response has no message content');
  return content.trim();
}

/**
 * TL;DR / footnote for a section. `mode: 'generic'` summarises `text`;
 * `mode: 'tweak'` minimally edits `prior` given `diff`; `mode: 'note'`
 * writes the one-line task-specific footnote (`task` carries the purpose).
 * Returns the generated string.
 */
export async function summarize({ settings, text, heading, mode = 'generic', prior, diff, task, fetchImpl }) {
  const prompt =
    mode === 'tweak'
      ? tweakPrompt({ prior, diff, heading })
      : mode === 'note'
        ? notePrompt({ task, text, heading })
        : genericPrompt({ text, heading });
  return chatComplete({ settings, ...prompt, fetchImpl });
}
