---
status: draft
---

# Make Agent plan_create searchable on demand

## Goal

Hide plan_create from Agent Code Mode by default while keeping it discoverable through tools.tool_search and callable after discovery. Plan Mode keeps its existing direct plan workflow.

## Changes

1. Update electron/chat/shared/tools/metaTools.ts so dynamic tool search can include selected local on-demand tools in addition to MCP tools.
2. Update electron/chat/shared/tools/factory.ts so Agent Code Mode marks plan_create as searchable on demand, while Plan Mode does not rely on search for it.
3. Update src/lib/hiddenUserContext.ts so Agent Mode no longer advertises plan_create by name and instead gives generic on-demand tool_search guidance.
4. Update focused tests to verify Agent context does not reveal plan_create, tool_search discovers it, and Plan Mode behavior remains unchanged.

## Verification

Run chat mode prompt tests, Code Mode tests covering tool_search, plan tool tests if affected, typecheck, and git diff --check.

## Scope

Do not remove plan_create from the underlying Agent registry or native tool catalog; this change is about default model visibility and on-demand discovery.
