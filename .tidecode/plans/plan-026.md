---
status: draft
---

# Make Agent plan_create searchable only

## Goal

Keep Agent and Plan on the same underlying Code Mode tool registry, while making plan_create visible by default only in Plan Mode through hidden mode injection. Agent Mode should discover plan_create through tools.tool_search when needed.

## Changes

- Update electron/chat/shared/tools/metaTools.ts so tool_search can include explicitly allowed on-demand local tools in addition to dynamic MCP tools.
- Update electron/chat/shared/tools/factory.ts so Agent Mode makes plan_create searchable without changing the shared underlying registry or preloaded runtime capability set.
- Update src/lib/hiddenUserContext.ts so Agent Mode no longer names or advertises plan_create; Plan Mode keeps its current injected plan_create contract.
- Update focused tests to prove Agent does not see plan_create by default, can discover it with tool_search and call it, while Plan still receives the injected contract.

## Verification

Run chat mode prompt, hidden context, agent tool, plan tool, and Code Mode focused tests, then TypeScript typecheck and git diff --check.
