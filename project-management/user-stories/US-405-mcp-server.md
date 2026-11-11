---
id: US-405
title: "MCP server wrapping extract + validate"
slug: mcp-server
personas: [P-002, P-004]
epic: "E4 Agent Surface"
priority: could-have
complexity: medium
tags: [agent, mcp, tooling]
---

# US-405: MCP Server Wrapping extract + validate

## User Story

**As an** agent-harness maintainer
**I want to** an MCP server exposing `extract` and `validate` as tools
**So that** MCP-speaking agents use SemText documents without shell-outs or custom glue.

## Acceptance Criteria

- **Given** an MCP client
  **When** it calls the validate tool
  **Then** it receives the same structured result the CLI emits (US-301); likewise
  extract (US-404).
- **Given** the server
  **When** either underlying tool changes behavior
  **Then** no separate logic exists in the MCP layer to drift — it is a thin wrapper.

## Notes

`could-have`: valuable only after the CLI pair (US-301, US-404) exists; it is
distribution, not capability.

**focus tool (2026-11-11).** `semtext focus` (purpose-driven collapse) landed
upstream ahead of the MCP wrapper: the pipeline lives in
`bin/lib/focus/focus.mjs` as `focus(doc, opts, deps)` with injectable deps
(classifier / summarizer / cache / clock), so the MCP layer stays a thin
wrapper with no logic to drift — the same shape this story requires of the
extract/validate tools. Docs: `docs/focus.md` (config, cache layout, exit
contracts). MCP tool wrapping this entry point: **PENDING**.
