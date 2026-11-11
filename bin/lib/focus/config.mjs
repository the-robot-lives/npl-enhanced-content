/**
 * focus/config — configuration for `semtext focus`.
 *
 * Precedence: CLI flag > environment > config file > default.
 *
 * Config file: `$XDG_CONFIG_HOME/semtext/config.yaml` (default
 * `~/.config/semtext/config.yaml`), with a `config.json` fallback in the
 * same directory. The YAML side is a deliberate tiny subset — nested
 * `key: value` maps, scalars, `#` comments — because focus refuses to
 * drag a YAML parser into a pipe CLI (the `yaml` package is not in this
 * repo's install graph). JSON is accepted either as the whole file or via
 * the `.json` fallback.
 *
 * Recognised keys:
 *
 *     classifier: alibaba        # alibaba | jev
 *     threshold: 0.5             # relevance cut (score questions, 0..1)
 *     match-threshold: 0.8       # task-match cut (choice probability)
 *     summarizer:
 *       model: qwen3.8-flash
 *       base-url: https://...    # OpenAI-compatible endpoint base
 *     providers:
 *       alibaba:
 *         base-url: https://...  # System One endpoint base
 *       jev:
 *         base-url: https://...
 *         model: jev-latest
 *
 * Environment overrides: SEMTEXT_CONFIG (file path), SEMTEXT_CLASSIFIER,
 * SEMTEXT_THRESHOLD, SEMTEXT_MATCH_THRESHOLD, SEMTEXT_SUMMARIZER_MODEL.
 * Provider credentials themselves are NEVER read from the config file —
 * keys stay in the environment (see classifierSettings/summarizerSettings;
 * this module only ever reports env var NAMES, never values).
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const DEFAULTS = {
  classifier: 'alibaba',
  threshold: 0.5,
  matchThreshold: 0.8,
  summarizerModel: 'qwen3.8-flash'
};

export function configPath(env = process.env) {
  if (env.SEMTEXT_CONFIG) return env.SEMTEXT_CONFIG;
  const base = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim()
    ? env.XDG_CONFIG_HOME
    : join(homedir(), '.config');
  return join(base, 'semtext', 'config.yaml');
}

/** Tiny YAML subset: nested maps by indentation, scalars, comments. */
export function parseTinyYaml(text) {
  const root = {};
  const stack = [{ indent: -1, obj: root }];
  for (const rawLine of text.split('\n')) {
    const noComment = stripComment(rawLine);
    if (!noComment.trim()) continue;
    const m = /^(\s*)([\w.-]+)\s*:\s*(.*)$/.exec(noComment);
    if (!m) continue; // lists / anchors / anything else: not part of the subset
    const indent = m[1].replace(/\t/g, '  ').length;
    const key = m[2];
    const value = m[3].trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    if (value === '') {
      const child = {};
      parent[key] = child;
      stack.push({ indent, obj: child });
    } else {
      parent[key] = scalar(value);
    }
  }
  return Object.keys(root).length ? root : null;
}

function stripComment(line) {
  let out = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      out += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      out += c;
      continue;
    }
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) break;
    out += c;
  }
  return out;
}

function scalar(v) {
  const unquoted = /^"(.*)"$/s.exec(v) || /^'(.*)'$/s.exec(v);
  if (unquoted) return unquoted[1];
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

/** Load + parse the config file; missing file → null (defaults apply). */
export function loadConfigFile(path = configPath()) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  if (/^\s*[{[]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  return parseTinyYaml(text);
}

function get(obj, path) {
  let cur = obj;
  for (const part of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Merge one config layer over the defaults and apply environment
 * overrides. Returns the flat effective shape the CLI works with.
 */
export function effectiveConfig({ file, env = process.env, flags = {} } = {}) {
  const cfg = loadConfigFile(file || configPath(env));
  const providers = get(cfg, 'providers') || {};
  const summarizer = get(cfg, 'summarizer') || {};
  const out = {
    classifier: String(
      flags.classifier ?? env.SEMTEXT_CLASSIFIER ?? get(cfg, 'classifier') ?? DEFAULTS.classifier
    ),
    threshold: num(flags.threshold ?? env.SEMTEXT_THRESHOLD ?? get(cfg, 'threshold')) ?? DEFAULTS.threshold,
    matchThreshold:
      num(flags.matchThreshold ?? env.SEMTEXT_MATCH_THRESHOLD ?? get(cfg, 'match-threshold')) ??
      DEFAULTS.matchThreshold,
    summarizerModel: String(
      flags.model ?? env.SEMTEXT_SUMMARIZER_MODEL ?? summarizer.model ?? DEFAULTS.summarizerModel
    ),
    providers: providers,
    summarizerBaseUrl: summarizer['base-url'] ? String(summarizer['base-url']) : undefined,
    configLoaded: cfg ? file || configPath(env) : null
  };
  return out;
}

/**
 * Classifier wire settings. Keys/base URLs come from the environment (or
 * provider config base-url overrides); settings objects name the env vars
 * so callers can print actionable errors WITHOUT ever touching values.
 */
export function classifierSettings(cfg, name, env = process.env) {
  const which = name === 'jev' ? 'jev' : 'alibaba';
  const providerCfg = cfg.providers?.[which] || {};
  if (which === 'alibaba') {
    return {
      provider: 'alibaba',
      base: providerCfg['base-url'] || env.QWEN_DECISION_BASE_URL || '',
      baseEnv: providerCfg['base-url'] ? null : 'QWEN_DECISION_BASE_URL',
      key: env.QWEN_API_KEY || env.DASHSCOPE_API_KEY || '',
      keyEnv: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'],
      model: providerCfg.model || 'decision-model-preview',
      policy: 'alibaba_rounded_hundredths'
    };
  }
  return {
    provider: 'jev',
    base: providerCfg['base-url'] || env.JEV_BASE_URL || 'https://api.typesafe.ai/v1',
    baseEnv: providerCfg['base-url'] ? null : 'JEV_BASE_URL',
    key: env.JEV_API_KEY || env.TYPESAFE_API_KEY || '',
    keyEnv: ['JEV_API_KEY', 'TYPESAFE_API_KEY'],
    model: providerCfg.model || 'jev-latest',
    policy: 'strict'
  };
}

/** Summarizer (OpenAI-compatible chat completions) settings. */
export function summarizerSettings(cfg, env = process.env) {
  const tokenCfg = cfg.providers?.summarizer || {};
  return {
    base:
      cfg.summarizerBaseUrl ||
      tokenCfg['base-url'] ||
      env.QWEN_TOKEN_BASE_URL ||
      'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
    baseEnv: cfg.summarizerBaseUrl || tokenCfg['base-url'] ? null : 'QWEN_TOKEN_BASE_URL',
    key: env.QWEN_TOKEN_KEY || env.QWEN_SUB_KEY || '',
    keyEnv: ['QWEN_TOKEN_KEY', 'QWEN_SUB_KEY'],
    model: cfg.summarizerModel
  };
}

/** True when settings are usable for a network call (key present). */
export function settingsReady(s) {
  return !!(s.key && s.base);
}

/** Human hint naming the missing env vars — values never appear. */
export function settingsHint(s) {
  const parts = [];
  if (s.keyEnv) parts.push(`set ${s.keyEnv.join(' or ')}`);
  if (s.baseEnv) parts.push(`set ${s.baseEnv}`);
  return parts.join(' and ');
}

/** Resolve the cache root from flags/env (config does not own the cache). */
export function cacheRoot(flags = {}, env = process.env) {
  if (flags.cacheDir) return resolve(String(flags.cacheDir));
  if (env.SEMTEXT_CACHE_DIR) return resolve(env.SEMTEXT_CACHE_DIR);
  const base = env.XDG_CACHE_HOME && env.XDG_CACHE_HOME.trim()
    ? env.XDG_CACHE_HOME
    : join(homedir(), '.cache');
  return join(base, 'semtext');
}
