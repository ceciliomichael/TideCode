---
status: draft
---

# Dedicated Plan Edit Tool

## Goal

Give Plan Mode a dedicated plan revision tool so initial planning uses plan_create, later revisions use plan_edit, and apply_patch is never part of Plan Mode's allowed workflow.

## Changes

- Create electron/chat/shared/tools/planEditTool.ts wrapping the existing editPlan service and restricting edits to the active plan path.
- Add plan_edit to the shared plan tool set and shared Code Mode registry while hiding both planning tools from permanent Code Mode documentation.
- Remove apply_patch from Plan Mode's native/allowed tool set. Keep it unchanged for Agent Mode source edits.
- Update Plan Mode hidden context and plan review/revision messages to use plan_create for the first artifact and plan_edit for revisions.
- Keep Agent plan tools discoverable through tool_search and preserve identical Agent/Plan provider-facing Code Mode cache context.
- Update plan presentation/tool tests, prompt tests, and hidden-context tests.

## Verification

Run focused plan, prompt, hidden-context, Agent-tool, and Code Mode tests, then TypeScript typecheck and git diff --check.
