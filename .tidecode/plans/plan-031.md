---
status: draft
---

# Bypass single-tool groups

## Goal

Render a single visible tool invocation directly instead of wrapping it in ToolInvocationGroup. Keep grouping for 2+ visible tool entries.

## Changes

- Update src/components/AssistantMessage.tsx to render ToolInvocationBlock directly when a rendered tool block contains exactly one entry, otherwise keep ToolInvocationGroup.
- Add a focused component rendering regression test that verifies a single invocation has no group wrapper while multiple invocations still use grouping.

## Verification

Run the focused rendering test, relevant tool presentation/grouping tests, TypeScript typecheck, and git diff --check.
