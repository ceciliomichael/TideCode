# Plan 032: Plan Mode Runtime Contract and Stable Code Mode Cache

## Goal
Make Agent the permanent system identity and make Plan Mode a turn-scoped runtime contract injected into the current user message. Agent and Plan must keep the same system prompt and provider-facing Code Mode definition so switching modes does not invalidate prompt caching when the workspace, model, and provider are otherwise unchanged.

## Required behavior
- Agent and Plan use the exact same system prompt.
- Workspace instructions, including AGENTS.md, remain an independent instruction source that applies in either mode.
- Plan Mode adds a self-contained runtime contract to the current user turn only.
- Normal Code Mode function documentation stays in the permanent Code Mode description and is not repeated in the Plan injection.
- The Plan injection documents only Plan-specific behavior and the Plan-only tools/capability changes.
- Every Plan flow must own a canonical .tidecode/plans/plan-###.md artifact.
- If no active plan exists, Plan Mode must create one with tools.plan_create.
- If an active plan exists, Plan Mode must revise that exact artifact with tools.apply_patch.
- plan_edit is removed.
- Plan Mode must not implement source changes or execute implementation commands.
- Runtime enforcement, not prompt wording alone, must block disallowed Plan mutations.
- A Plan-scoped apply_patch may update only the active plan artifact and must continue to emit a plan preview result so the Plan tab refreshes.
- Users may switch to Agent at any time. Switching modes alone does not implement a plan.
- Clicking Implement on a Plan tab switches to Agent and sends a programmatic implementation request referencing that exact plan artifact. No Plan-disable injection is sent.

## Implementation
1. Refactor system-prompt assembly so chatMode no longer selects Agent versus Plan prompt/tooling. Code Mode and direct/hybrid paths use the Agent contract in both modes, and mode-sensitive terminal/workspace prompt differences are removed.
2. Convert the existing Plan prompt into a complete model-only runtime contract and inject it into the latest user message whenever chatMode is plan. The contract is explicitly current-turn scoped and incorporates applicable workspace instructions without depending on AGENTS.md to define Plan Mode.
3. Determine the active plan from the latest completed plan presentation in conversation history and include that path, or the absence of one, in the Plan runtime context. Re-apply the context after canonical replay so it survives replay projection.
4. Build a stable Code Mode registry for both Agent and Plan containing the same normal Agent APIs plus hidden plan_create. Keep plan_create out of the permanent generated Code Mode documentation so it is introduced only by the Plan runtime contract.
5. Make CodeModeExecutor allowedToolNames a restrictive allowlist when supplied. In Plan Mode expose only planning-safe Code Mode functions plus apply_patch and plan_create; omit terminal/process/write/dynamic connected mutators from the executable surface.
6. Add shared mutable Plan runtime state in the Code Mode tool bundle. plan_create is enabled only in Plan Mode, refuses a second plan when one is already active, and records the created artifact path immediately for later calls in the same Code Mode program/turn.
7. Extend apply_patch with a Plan-artifact restriction. In Plan Mode it may only update the active plan path, must reject add/delete/move or any other target, and must fail before commit if there is no active plan. After success it returns a plan result presentation for the updated artifact so preview/tab state stays canonical.
8. Remove the plan_edit tool and update review/revision copy, tool grouping/presentation assumptions, and tests to use apply_patch.
9. Make the composer Implement shortcut/button require an actual latest plan artifact and always pass its path. Plan preview Implement continues to use its exact tab path.
10. Keep manual Plan to Agent switching behavior unchanged except that Agent turns receive no Plan runtime injection and normal Agent Code Mode capabilities are restored automatically.

## Verification
- Prompt tests prove Agent and Plan system prompts are byte-identical for the same workspace/options.
- Cache tests prove systemHash, toolsHash, and context fingerprint remain identical across Agent and Plan for the same model/provider.
- Message tests prove Plan runtime context is injected only for Plan turns and includes active-plan state and plan_create/apply_patch rules without duplicating the normal Code Mode inventory.
- Code Mode tests prove restrictive allowlists work and Plan mode cannot call blocked mutation/terminal functions.
- Plan tests prove plan_create establishes the artifact, a Plan apply_patch can revise only that artifact, and the revision returns a plan presentation.
- UI/library tests prove revision prompts reference apply_patch, plan_edit is absent, and Implement always references a real plan artifact.
- Run targeted Node tests, TypeScript typecheck, and lint/build checks required by the touched code.

## Scope
Do not change mode-specific model/provider selection in this change. A different selected model/provider remains an intentional cache boundary. Do not perform unrelated UI or workspace-instruction refactors.
