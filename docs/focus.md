# `semtext focus` — purpose-driven collapse

Read a document the way your current task needs it: sections that serve a
stated purpose stay verbatim, everything else collapses to a TL;DR reveal
that can be expanded back on demand (`semtext expand <file> <id>`).
TL;DRs, task matching and relevance scores are cached content-addressed,
so repeated runs over a stable document cost zero model calls.

## Usage

```sh
# markdown or SemText XHTML; default render: md for .md/.sem.md, html for .html
semtext focus DEPLOY.md --purpose "rotate the staging TLS certificate"

# keep whole sections by id, never collapse them
semtext focus DEPLOY.md --purpose "rotate the staging TLS certificate" --keep rollback,secrets

# one-line task footnote per relevant section
semtext focus DEPLOY.md --purpose "..." --notes

# machine payload (agent CLI defaults to JSON)
semtext focus DEPLOY.md --purpose "..." --format json

# no network: cache-only, first-90-chars TL;DR fallback, unknown relevance ⇒ keep
semtext focus DEPLOY.md --purpose "..." --no-llm

# plan without side effects: prints the classifier/summarizer calls it WOULD make
semtext focus DEPLOY.md --purpose "..." --dry-run

# maintain the document: insert/refresh <sem-tldr data-auto data-digest> blocks in place
semtext focus DEPLOY.md --purpose "..." --write-back      # also --write-notes
```

Flags: `--threshold N` (relevance cut on a 0..1 rubric, default 0.5) ·
`--match-threshold N` (task-match choice cut, default 0.8) ·
`--classifier alibaba|jev` · `--model M` · `--cache-dir DIR` ·
`--config FILE` · `--refresh` · `--track-refs` · `--verbose`.

Missing credentials fail fast with the env-var *names* you need
(e.g. `set QWEN_API_KEY or DASHSCOPE_API_KEY and set QWEN_DECISION_BASE_URL`)
and a pointer to `--no-llm`. Values are never printed.

## Pipeline

1. **Task match** — exact normalized-purpose match reuses the task with no
   model call; otherwise the top-5 token-Jaccard neighbours go through ONE
   batched `:choice` round (with a `none` option; probability ≥
   `--match-threshold` reuses, else a new task is minted).
2. **TL;DR per section** — authored `<sem-tldr>` always wins. Otherwise the
   cache is keyed by sha256 of the whitespace-collapsed body: hit ⇒ reuse;
   miss but the per-file index holds a prior sha ⇒ unified-diff the drift
   and ask ONE batched `:boolean` ("does this change alter the summary?" —
   no ⇒ rebind the old summary, yes ⇒ tweak it); fresh body ⇒ generic
   task-agnostic summary. `--track-refs` hashes file paths referenced in
   the body and treats a changed file as drift.
3. **Relevance** — ONE batched `:score` round against a 10-level rubric
   ("not relevant" … "essential"). Pinned sections (`kind="hard-rule"`,
   `data-pin`) and `--keep` ids are always relevant. Per-task section
   notes are cached alongside the score.
4. **Render** — `md` (collapsed ⇒ `> TL;DR: … (collapsed — semtext expand
   <file> <id>)`, footnotes as `[^fn-…]`), `html` (collapsed ⇒
   `<sem-reveal summary collapsed>`, footnotes `<sem-references>`),
   `text`, `json` (`{task_id, task_reused, sections[], stats}`).

`--write-back` inserts/refreshes `<sem-tldr data-auto data-digest="<sha12>">`
under headings that lack an authored TL;DR — idempotent, path-confined to
the working directory. Authored TL;DRs are never overwritten.

## Configuration

`$XDG_CONFIG_HOME/semtext/config.yaml` (or `--config FILE`,
`$SEMTEXT_CONFIG`). Precedence: CLI flag > env var > config file > default.

```yaml
classifier: alibaba        # alibaba | jev
threshold: 0.5
match-threshold: 0.8

providers:
  alibaba:
    base-url: https://dashscope.aliyuncs.com/api/v1/services/enhance  # else $QWEN_DECISION_BASE_URL
    model: decision-model-preview
  jev:
    base-url: https://api.typesafe.ai/v1                               # else $JEV_BASE_URL
    model: jev-latest
  summarizer:
    base-url: https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
    model: qwen3.8-flash

summarizer-model: qwen3.8-flash
```

Env vars (checked in order, names only — never values):

| role | base | key | model default |
|---|---|---|---|
| classifier `alibaba` | `QWEN_DECISION_BASE_URL` | `QWEN_API_KEY` or `DASHSCOPE_API_KEY` | `decision-model-preview` |
| classifier `jev` | `JEV_BASE_URL` | `JEV_API_KEY` or `TYPESAFE_API_KEY` | `jev-latest` |
| summarizer | `QWEN_TOKEN_BASE_URL` | `QWEN_TOKEN_KEY` or `QWEN_SUB_KEY` | `qwen3.8-flash` |

## Cache layout

Root: `$SEMTEXT_CACHE_DIR`, else `$XDG_CACHE_HOME/semtext`, else
`~/.cache/semtext`.

```
tasks.jsonl                     # task ledger: task_id, purpose, normalized, hits
sections/<sha256>.json          # TL;DR keyed by collapsed-body sha (source_snapshot kept for drift)
notes/<task_id>/<section_sha>.json  # per-task relevance score (+ optional note)
index/<sha256(abspath)>.json    # file → {section id → content sha} for drift detection
```

All writes are atomic (tmp + rename). Delete the root to reset.

## Status / MCP

The US-405 MCP server will wrap `focus()` as a tool so MCP-speaking agents
get purpose-driven collapse without a shell-out — **PENDING** (the CLI and
the `focus(doc, opts, deps)` entry point in `bin/lib/focus/focus.mjs` are
the stable surface that wrapper will call; deps are injectable, so the
MCP layer can stub classifier/summarizer/cache in tests).
