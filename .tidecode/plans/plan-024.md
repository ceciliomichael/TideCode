---
status: draft
---

# Expose native web search with Code Mode

## Goal

Allow Codex and OpenAI chats to see OpenAI's native web_search tool while keeping TideCode workspace and terminal capabilities behind code_mode.

## Changes

1. Modify electron/chat/shared/tools/providerWebTool.ts so both codex and openai create openai.tools.webSearch().
2. Modify electron/chat/shared/tools/factory.ts to retain provider-native tools alongside code_mode for code_mode orchestration, without exposing local workspace tools directly.
3. Update tests/codex/agentTools.test.ts to verify Codex and OpenAI native web search construction and exact provider-facing Code Mode surfaces.

## Verification

Run the focused agent tool tests, relevant chat mode prompt tests, TypeScript typecheck, and git diff --check.

## Scope

No changes to provider authentication, local Code Mode APIs, MCP discovery, or non-OpenAI provider web tooling.
