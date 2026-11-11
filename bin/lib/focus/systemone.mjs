/**
 * focus/systemone — wire port of the TypeSafe System One classifier
 * protocol (mirror of GenAI.Provider.SystemOne / .Rounded, Elixir → JS).
 *
 * Endpoint: POST `<base>/systemone` (an existing `/systemone` or `/models`
 * suffix on the base is stripped before joining). Bearer auth; the key is
 * never logged or echoed.
 *
 * Request body: `{ model, state: <input>, questions: { id -> wire } }` with
 *   - boolean  -> `{ type: "noul", instructions }`
 *   - choice   -> `{ type: "choice", instructions, criteria: { id -> label } }` (<= 255)
 *   - score    -> `{ type: "score", instructions, criteria: [labels] }` (<= 10)
 *
 * Response `json.answers` keyed by question id. Decoding honours the
 * distribution policy:
 *   - strict: probabilities must key-match and sum to 1 within 1e-6; a
 *     score answer's probability-weighted index must match the wire score.
 *   - alibaba_rounded_hundredths (qwen decision-model-preview): the wire
 *     carries hundredths-rounded display estimates; when strict decoding
 *     fails, the distribution is canonicalised (unit-normalised) and the
 *     wire score is validated against the attainable-mean range, exactly
 *     like the Elixir Rounded module.
 *
 * Returns `{ [questionId]: { type, value, probability, confidence } }`
 * where boolean values are thresholded noul probabilities, choice values
 * are option ids, and score values are the caller's numeric scale mapped
 * through the answer distribution (expected score).
 */

const EPSILON = 1e-6;

export class ClassifierError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ClassifierError';
    this.envHint = options.envHint || null;
  }
}

/** `<base>/systemone` without duplicating an existing v1/operation suffix. */
export function systemOneEndpoint(base) {
  if (!base || typeof base !== 'string') throw new ClassifierError('classifier base URL is missing');
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new ClassifierError(`classifier base URL is not a valid URL: ${base}`);
  }
  if (!/^https?:$/.test(url.protocol) || !url.host || url.username || url.password || url.search || url.hash) {
    throw new ClassifierError(`classifier base URL must be a plain http(s) endpoint: ${base}`);
  }
  const path = (url.pathname || '').replace(/\/+$/, '').replace(/\/(systemone|models)$/, '');
  url.pathname = path + '/systemone';
  return url.toString();
}

/** Focus question shape → System One wire question. */
export function encodeQuestion(q) {
  if (q.type === 'boolean') {
    return { type: 'noul', instructions: q.instructions || 'Is the statement true?' };
  }
  if (q.type === 'choice') {
    const ids = q.options.map((o) => o.id);
    if (ids.length > 255) throw new ClassifierError('choice question exceeds 255 options');
    if (new Set(ids).size !== ids.length) throw new ClassifierError('choice question has duplicate option ids');
    const criteria = {};
    for (const o of q.options) criteria[o.id] = String(o.label).slice(0, 255);
    return {
      type: 'choice',
      instructions: q.instructions || 'Which option best describes the state?',
      criteria
    };
  }
  if (q.type === 'score') {
    const labels = (q.levels || []).map((l) => l.label);
    if (labels.length > 10) throw new ClassifierError('score question exceeds 10 levels');
    return {
      type: 'score',
      instructions: q.instructions || 'Which rubric level best describes the state?',
      criteria: labels
    };
  }
  throw new ClassifierError(`unknown question type "${q.type}"`);
}

function probabilityOk(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
}

function weightedIndex(values) {
  let total = 0;
  for (let i = 0; i < values.length; i++) total += values[i] * i;
  return total;
}

function sum(values) {
  return values.reduce((a, b) => a + b, 0);
}

/**
 * Canonicalise a hundredths-rounded wire distribution (port of
 * GenAI.Provider.SystemOne.Rounded). Returns the unit-normalised values or
 * null when the wire shape cannot be a rounded estimate.
 */
export function normalizeRoundedHundredths(values, type, nativeScore) {
  const count = values.length;
  const eps = 1e-10;
  const halfStep = 0.005;
  const grid = (v) => Math.abs(v * 100 - Math.round(v * 100)) <= eps;
  const allProb = values.every(probabilityOk);
  if (count < 2 || count > 10 || !allProb) return null;
  const total = sum(values);
  if (!(total > 0)) return null;
  if (!values.every(grid)) return null;
  if (Math.abs(total - 1) > Math.min(count * halfStep, 0.01) + eps) return null;
  const bounds = values.map((v) => [Math.max(0, v - halfStep), Math.min(1, v + halfStep)]);
  if (!bounds.every(([lo, hi]) => lo <= hi)) return null;
  const lowerSum = sum(bounds.map((b) => b[0]));
  const upperSum = sum(bounds.map((b) => b[1]));
  if (lowerSum > 1 + eps || upperSum < 1 - eps) return null;
  const attainableMean = (descending) => {
    let indexed = bounds.map((b, i) => [b, i]);
    if (descending) indexed = indexed.slice().reverse();
    let mass = Math.max(0, 1 - lowerSum);
    let mean = 0;
    for (const [[lo, hi], i] of indexed) {
      const extra = Math.min(mass, hi - lo);
      mass = Math.max(0, mass - extra);
      mean += (lo + extra) * i;
    }
    return mean;
  };
  if (type === 'score') {
    const minimum = attainableMean(false);
    const maximum = attainableMean(true);
    const okScore =
      typeof nativeScore === 'number' &&
      Number.isFinite(nativeScore) &&
      nativeScore >= 0 &&
      nativeScore <= count - 1 &&
      grid(nativeScore) &&
      nativeScore >= minimum - halfStep - eps &&
      nativeScore <= maximum + halfStep + eps;
    if (!okScore) return null;
  }
  return values.map((v) => v / total);
}

/**
 * Decode one wire response against the questions. `policy` is
 * 'strict' | 'alibaba_rounded_hundredths'; `threshold` gates booleans
 * (noul probability > threshold → true, strict greater-than).
 */
export function decodeAnswers(json, questions, policy, threshold = 0.5) {
  const answers = json && json.answers;
  if (!answers || typeof answers !== 'object') throw new ClassifierError('classifier response has no answers map');
  const expected = questions.map((q) => q.id).sort();
  const received = Object.keys(answers).sort();
  if (expected.length !== received.length || expected.some((v, i) => v !== received[i])) {
    throw new ClassifierError(`classifier response question ids do not match the request (${received.join(',')} ≠ ${expected.join(',')})`);
  }
  const out = {};
  for (const q of questions) {
    const wire = answers[q.id];
    if (!wire || typeof wire !== 'object') throw new ClassifierError(`classifier answer "${q.id}" is malformed`);
    if (q.type === 'boolean') {
      const p = wire.noul;
      if (!probabilityOk(p)) throw new ClassifierError(`classifier answer "${q.id}" has no valid noul probability`);
      out[q.id] = {
        type: 'boolean',
        value: p > threshold,
        probability: p,
        confidence: probabilityOk(wire.confidence) ? wire.confidence : undefined
      };
      continue;
    }
    if (q.type === 'choice') {
      const ids = q.options.map((o) => o.id);
      const index = ids.indexOf(wire.choice);
      if (index < 0) throw new ClassifierError(`classifier answer "${q.id}" chose an unknown option`);
      const wireMap = wire.probabilities;
      let values = null;
      if (wireMap && typeof wireMap === 'object' && ids.every((id) => probabilityOk(wireMap[id])) && Object.keys(wireMap).length === ids.length) {
        const vals = ids.map((id) => wireMap[id]);
        const meanCheck = Math.abs(sum(vals) - 1) <= EPSILON;
        if (policy === 'alibaba_rounded_hundredths') {
          if (meanCheck) values = vals;
          else values = normalizeRoundedHundredths(vals, 'choice', undefined);
        } else if (meanCheck) {
          values = vals;
        }
      }
      if (!values) throw new ClassifierError(`classifier answer "${q.id}" has an invalid probability distribution`);
      const max = Math.max(...values);
      if (values[index] + EPSILON < max) {
        throw new ClassifierError(`classifier answer "${q.id}" chose an option that is not the distribution maximum`);
      }
      out[q.id] = {
        type: 'choice',
        value: ids[index],
        index,
        probability: values[index],
        confidence: probabilityOk(wire.confidence) ? wire.confidence : undefined
      };
      continue;
    }
    if (q.type === 'score') {
      const n = q.levels.length;
      const indices = Array.from({ length: n }, (_, i) => String(i));
      const wireMap = wire.probabilities;
      const legend = wire.legend;
      const legendOk =
        legend &&
        typeof legend === 'object' &&
        indices.every((k) => legend[k] === q.levels[i2(k)].label);
      if (!legendOk) throw new ClassifierError(`classifier answer "${q.id}" legend does not match the rubric`);
      let values = null;
      if (
        wireMap &&
        typeof wireMap === 'object' &&
        Object.keys(wireMap).length === n &&
        indices.every((k) => probabilityOk(wireMap[k]))
      ) {
        const vals = indices.map((k) => wireMap[k]);
        const nativeMean = weightedIndex(vals);
        const scoreOk =
          typeof wire.score === 'number' &&
          Number.isFinite(wire.score) &&
          wire.score >= 0 &&
          wire.score <= n - 1;
        if (!scoreOk) {
          // fall through to rounded validation below, which re-checks score
        }
        if (policy === 'alibaba_rounded_hundredths') {
          if (scoreOk && Math.abs(nativeMean - wire.score) <= EPSILON * Math.max(1, Math.abs(nativeMean))) {
            values = vals;
          } else {
            values = normalizeRoundedHundredths(vals, 'score', typeof wire.score === 'number' ? wire.score : NaN);
          }
        } else if (
          scoreOk &&
          Math.abs(nativeMean - wire.score) <= EPSILON * Math.max(1, Math.abs(nativeMean))
        ) {
          values = vals;
        }
      }
      if (!values) throw new ClassifierError(`classifier answer "${q.id}" has an invalid score distribution`);
      // Map the answer index onto the caller's numeric scale: expected
      // score = Σ p(level) * level.score (levels carry normalized 0..1 scores).
      const expectedScore = q.levels.reduce((acc, level, i) => acc + values[i] * level.score, 0);
      out[q.id] = {
        type: 'score',
        value: expectedScore,
        expectedIndex: weightedIndex(values),
        distribution: values,
        confidence: probabilityOk(wire.confidence) ? wire.confidence : undefined
      };
      continue;
    }
    throw new ClassifierError(`unknown question type "${q.type}"`);
  }
  return out;
}

function i2(i) {
  return Number(i);
}

/**
 * One classify round-trip. `settings` = classifierSettings() shape
 * ({provider, base, key, model, policy, keyEnv, baseEnv}); `questions` =
 * focus question array. Returns the decoded answers map. Throws
 * ClassifierError (with .envHint) on missing credentials or wire errors.
 */
export async function classify({ settings, input, questions, threshold = 0.5, fetchImpl, timeoutMs = 60000 }) {
  if (!settingsReady(settings)) {
    throw new ClassifierError(
      `classifier "${settings.provider}" is not configured — ${settingsHint(settings)} (or rerun with --no-llm)`,
      { envHint: settingsHint(settings) }
    );
  }
  const wireQuestions = {};
  for (const q of questions) wireQuestions[q.id] = encodeQuestion(q);
  const body = { model: settings.model, state: input, questions: wireQuestions };
  const doFetch = fetchImpl || globalThis.fetch;
  if (!doFetch) throw new ClassifierError('no fetch implementation available (Node >= 18 required)');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await doFetch(systemOneEndpoint(settings.base), {
      method: 'POST',
      headers: { authorization: 'Bearer ' + settings.key, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (e) {
    throw new ClassifierError(`classifier transport error — ${e && e.message ? e.message : e}`);
  } finally {
    clearTimeout(timer);
  }
  if (res.status !== 200) throw new ClassifierError(`classifier HTTP ${res.status} from ${settings.provider}`);
  let json;
  try {
    json = await res.json();
  } catch {
    throw new ClassifierError('classifier response is not valid JSON');
  }
  return decodeAnswers(json, questions, settings.policy, threshold);
}

function settingsReady(s) {
  return !!(s.key && s.base);
}

function settingsHint(s) {
  const parts = [];
  if (s.keyEnv && s.keyEnv.length) parts.push(`set ${s.keyEnv.join(' or ')}`);
  if (s.baseEnv) parts.push(`set ${s.baseEnv}`);
  return parts.join(' and ');
}
