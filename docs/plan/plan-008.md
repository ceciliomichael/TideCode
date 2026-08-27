# Plan 008: Simplify Code Mode mutations and terminal execution

## Goal
Make Code Mode the simple execution boundary for agent work, use the existing Codex-style patch engine as the primary source-mutation API, and stop treating a command's nonzero exit as a failed terminal tool call.

## Current findings
- Agent execution already defaults to Code Mode, but the internal registry is still built from provider-style native tool definitions and legacy direct/hybrid paths remain.
- TideCode already has a working `apply_patch` implementation with parsing, context matching, full-patch preflight, multi-file staging, rollback, checkpoint capture, and `change_diff` results.
- `apply_patch` is not currently wired into the normal agent tool factory/Code Mode contract.
- `apply_patch` already uses the same `buildFileChangeResult(..., 'edit', ...)` result design as edit, but presentation classification only recognizes `edit`, so patch invocations do not yet get identical file-edit UI/grouping behavior.
- Terminal tools return top-level tool success for executed commands, but Code Mode reclassifies `semantics.status === 'failed'` as a failed inner tool call. Terminal summaries/body/presentation also duplicate this process-level judgment.

## Implementation

### 1. Keep Code Mode as the model-facing execution boundary
- Keep `code_mode` as the normal agent provider-facing tool.
- Remove or bypass provider-native exposure of ordinary local workspace tools in the normal agent path. Local filesystem, mutation, terminal, Kanban, planning, skills, and executable MCP capabilities remain internal Code Mode functions.
- Remove direct/hybrid branching where it is no longer required for the supported agent path instead of maintaining parallel execution architectures.
- Keep provider-owned capabilities that cannot execute as TideCode functions as explicit exceptions only if currently required; do not silently remove web capability.
- Do not move inner function signatures into the system prompt. Keep compact local API documentation in the `code_mode` tool contract and dynamic MCP discovery behind `tools.tool_search`.

### 2. Prefer simple internal Code Mode contracts
- Treat Code Mode function arguments as TideCode-owned JavaScript APIs rather than provider-native function schemas.
- Keep validation and security at execution boundaries, but avoid provider-specific schema complexity for inner functions.
- Preserve existing compatible spellings where they are already supported; do not add broad guessing or ambiguous aliases.
- Keep the implementation small by reusing current tool executors instead of rewriting working filesystem/terminal services merely to change the public Code Mode contract.

### 3. Make `apply_patch` the primary targeted source mutation API
- Wire the existing `createApplyPatchTool` into the internal agent/Code Mode registry.
- Document and prefer `tools.apply_patch({ patch })` for targeted source changes.
- Keep the existing Codex-style patch grammar and array-of-complete-lines transport so arbitrary source does not depend on fragile generated JavaScript quoting.
- Preserve full-patch verification before writes, staged multi-file changes, rollback on commit failure, workspace path safety, checkpoints, and explorer notifications.
- Stop advertising `tools.edit` as the primary Code Mode mutation primitive. Keep the existing edit implementation only where needed for compatibility while the patch path is the documented/default source-edit path.
- Update Code Mode validation/recovery guidance that currently hardcodes `tools.edit` so generated retries point to `apply_patch` where appropriate.

### 4. Give `apply_patch` the same result and invocation presentation as edit
- Continue using the shared `change_diff` result contract, including per-file old/new content, line counts, mutation semantics, subject, summary, and checkpoint behavior.
- Classify `apply_patch` as a file edit/mutation in `toolInvocationKinds` rather than inventing a separate presentation system.
- Reuse the existing edit presentation path for:
  - hiding running mutation blocks until a result is ready,
  - edit/create/delete verbs based on actual file changes,
  - single-file target labels,
  - multi-file expansion into one diff block per changed file,
  - group summaries such as edited/created/deleted file counts,
  - Code Mode child-invocation presentation,
  - desktop and CLI presentation.
- Add presentation regressions specifically for single-file and multi-file `apply_patch` results inside Code Mode.

### 5. Simplify terminal success/failure semantics
- Define a terminal tool failure as failure to perform the terminal operation itself: invalid arguments, sandbox denial, missing session, session creation failure, PTY write/read failure, broker/transport failure, or abort.
- Once a command was successfully started/executed, keep the terminal tool call successful regardless of process exit code.
- Remove Code Mode's special rule that converts `semantics.status === 'failed'` into an inner tool failure.
- Stop duplicating process judgment through `status: failed`, `result: failed`, `Terminal command failed`, or `Terminal session ... failed` when the terminal operation itself succeeded.
- Keep factual lifecycle state needed for orchestration: `running`, `completed`, `needs_interaction`, daemon/listening state, session id, and output availability.
- Expose factual process completion data, including exit code when reliably known, so the model can decide whether the command outcome satisfied the task.
- Apply the same semantics consistently to execute, read, and interact terminal results.
- Preserve genuine start/read/write/session failures as tool errors so UI and Code Mode still surface infrastructure failures correctly.

## Reliability and security
- Do not weaken workspace sandbox/path checks, terminal sandbox rules, authorization, checkpoint capture, mutation rollback, output limits, or cancellation behavior.
- Do not introduce fuzzy arbitrary patch matching beyond the existing patch matcher.
- Do not treat malformed patches as successful mutations.
- Do not remove terminal lifecycle/session tracking that is required for long-running or interactive commands.
- Keep unrelated dirty working-tree changes untouched.

## Testing and verification
- Extend `tests/codex/applyPatchTool.test.ts` for Code Mode availability/contract if needed while retaining existing parser, preflight, rollback, and result-contract coverage.
- Extend `tests/codex/toolInvocationPresentation.test.ts` to prove `apply_patch` behaves like edit for single-file and multi-file diff presentation, grouping, Code Mode child invocations, desktop, and CLI paths.
- Update `tests/codex/codeMode.test.ts` so nonzero terminal exits remain successful inner calls and do not make the outer Code Mode result fail; retain tests proving genuine tool errors still fail.
- Update `tests/codex/terminalTools.test.ts` so command exit data is factual rather than a tool-level failure classification while preserving running, interactive, daemon, sandbox, and infrastructure-failure coverage.
- Update agent/prompt/tool factory tests to verify normal agent provider exposure is Code Mode-only and `apply_patch` is the documented internal mutation API.
- Run focused Code Mode, apply-patch, terminal, tool-presentation, agent-tool, and prompt tests.
- Run `npm run typecheck`.
- Run scoped `git diff --check` for files changed by this plan.

## Scope boundaries
- No rewrite of the already-working patch parser/matcher/workspace transaction unless a failing regression proves one is necessary.
- No rewrite of the PTY/broker/session architecture; simplify classification and public contract only.
- No unrelated Kanban/UI/workspace cleanup.
- No new dependencies unless an unexpected implementation blocker materially changes this plan.

## Completion criteria
- Normal agent execution exposes Code Mode rather than ordinary local tools at the provider boundary.
- Code Mode documents and uses `apply_patch` as the primary targeted source mutation API.
- Patch results render exactly through the existing edit/change-diff presentation system, including multi-file Code Mode child invocations.
- A command that executes and exits nonzero remains a successful terminal tool invocation with factual process data.
- Genuine terminal infrastructure/security failures remain tool errors.
- Planned tests, typecheck, and diff checks pass.

## Status
Implemented and verified. Normal agent execution remains Code Mode-only at the provider boundary; the legacy explicit direct/hybrid helpers were left intact because production runtime does not use them and removing them would add compatibility churn outside the required behavior.
