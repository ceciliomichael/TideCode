# Plan 082: Add durable conversation memory before compaction

## Goal

Add a two-phase compaction pipeline so long-lived conversation knowledge is preserved independently from the short continuation handoff.

Before each successful compaction:

1. Reconcile a durable conversation memory snapshot from the previous durable memory plus the raw source messages being compacted.
2. Run the existing short continuation compaction with access to that updated durable memory.
3. Persist both artifacts.
4. Rebuild provider context as durable memory + short handoff + recent raw tail.

The durable memory is a complete replacement snapshot on every revision, not an append-only log. The memory worker must keep still-valid facts, update superseded facts, merge duplicates, remove stale facts only when newer evidence supports doing so, and preserve uncertainty where evidence is incomplete.

## Intended behavior

- Durable memory survives repeated compactions without being recursively folded into the short continuation summary.
- The short continuation summary remains focused on current state and next work.
- The compactor may read durable memory but should not copy it wholesale into the handoff.
- Raw display history remains unchanged.
- Existing canonical compaction replay remains restart-safe.
- Manual and automatic compaction use the same memory reconciliation pipeline.
- Durable-memory reconciliation and the short continuation compactor use the same Summarization model, provider, and reasoning effort configured in Settings. When Summarization is set to inherit the chat input model, both phases inherit the active chat model together.
- If memory reconciliation fails, compaction fails rather than silently discarding long-lived memory.
- Memory is bounded and normalized so it cannot grow without limit.

## Durable memory content

The memory worker outputs Markdown only and may use these sections when useful:

- `## Active goals`
- `## User constraints`
- `## Decisions`
- `## Important project facts`
- `## Current architecture`
- `## Completed milestones`
- `## Known failures and workarounds`
- `## Important files and symbols`
- `## Open work`

The worker receives the previous durable memory and only the new raw evidence since the last compaction barrier. It returns the complete replacement memory snapshot.

## Project structure after the change

```text
electron/chat/shared/compaction/
├── automatic.ts
├── budget.ts
├── contracts.ts
├── durableMemory.ts              # new: durable-memory contracts, validation, reconciliation
├── modelSelection.ts             # new: resolve and create the configured Summarization model stream
├── markdown.ts
├── projection.ts
├── prompt.ts
├── service.ts
├── window.ts
└── ...

electron/chat/shared/prompts/
├── compression/
│   ├── index.ts
│   └── prompt.md
└── durableMemory/                # new
    ├── index.ts
    └── prompt.md

electron/chat/history/
├── contracts.ts
├── eventStore.ts
├── replayProjector.ts
├── validation.ts
└── ...

tests/codex/
├── canonicalHistory.test.ts
├── compactionV2.test.ts
└── localCompaction.test.ts

docs/plan/
└── plan-082.md
```

## File-by-file changes

- **Create** `docs/plan/plan-082.md`
  - Record this implementation plan.

- **Create** `electron/chat/shared/compaction/durableMemory.ts`
  - Define the durable-memory schema/version.
  - Normalize and validate Markdown output.
  - Build the reconciliation request.
  - Run the AI-only memory phase before normal compaction.
  - Produce a model message used separately from the short handoff.

- **Create** `electron/chat/shared/compaction/modelSelection.ts`
  - Resolve Settings > Summarization against the configured model catalog, including inherit-from-chat behavior.
  - Create the no-tools stream factory for that provider so automatic compaction can use a different provider from the active chat.

- **Create** `electron/chat/shared/prompts/durableMemory/index.ts`
  - Load the dedicated durable-memory system prompt using the same runtime prompt-loading pattern as compression.

- **Create** `electron/chat/shared/prompts/durableMemory/prompt.md`
  - Instruct the worker to return the full replacement memory, not a delta.
  - Define KEEP/UPDATE/REMOVE/ADD semantics.
  - Prevent transcript copying, hidden reasoning, and unsupported inference.
  - Keep the result compact and bounded.

- **Modify** `electron/chat/shared/compaction/contracts.ts`
  - Add durable-memory input/result fields to the compaction service contract.
  - Add the durable-memory snapshot to `CompactionResult`.

- **Modify** `electron/chat/shared/compaction/prompt.ts`
  - Include the updated durable memory as read-only long-term context for the continuation compactor.
  - Explicitly tell the compactor not to duplicate the durable memory wholesale.

- **Modify** `electron/chat/shared/compaction/service.ts`
  - Run memory reconciliation after selecting the source window and before generating the normal handoff.
  - Feed the reconciled memory into the normal compaction request.
  - Return the durable memory with the compaction result.

- **Modify** `electron/chat/shared/compaction/projection.ts`
  - Build provider context as durable-memory message + short handoff + recent raw tail.
  - Keep durable memory and handoff distinguishable.

- **Modify** `electron/chat/history/contracts.ts`
  - Persist the durable-memory snapshot with canonical compaction events while preserving backward compatibility with existing events.

- **Modify** `electron/chat/history/eventStore.ts`
  - Read the newest durable memory for the active branch.
  - Persist the durable memory with each compaction commit.

- **Modify** `electron/chat/history/replayProjector.ts`
  - Restore the durable-memory message when rebuilding compacted provider history.
  - Continue supporting older compaction events without durable memory.

- **Modify** `electron/chat/history/validation.ts`
  - Validate optional persisted durable-memory snapshots on compaction events.

- **Modify** `electron/chat/shared/runtime.ts`
  - Track the latest durable memory beside the latest compaction packet.
  - Resolve the configured Summarization model once per compaction attempt and use it for both durable memory and continuation summarization instead of silently using the active agent model.
  - Supply it to automatic/final compaction and update it after success.
  - Persist it with the compaction commit.

- **Modify** `electron/chat/shared/compaction/manual.ts`
  - Load, reconcile, project, and persist durable memory for manual compaction.

- **Modify** `tests/codex/localCompaction.test.ts`
  - Verify the memory phase runs before the handoff phase.
  - Verify previous memory is reconciled rather than appended blindly.
  - Verify durable memory and short handoff remain separate in projected context.
  - Verify repeated compaction carries the newest durable memory forward.
  - Verify invalid memory output fails compaction instead of erasing memory.

- **Modify** `tests/codex/compactionV2.test.ts`
  - Update direct projection fixtures for the durable-memory message.

- **Modify** `tests/codex/canonicalHistory.test.ts`
  - Verify restart/recovery reconstruction restores persisted durable memory separately from the short handoff.

## Verification

Run:

1. Focused compaction tests.
2. TypeScript type checking.
3. Targeted lint for touched TypeScript files if the project exposes a compatible lint command.
4. Full test suite if the focused suite and typecheck pass.
5. `git diff --check`.

## Scope boundaries

- No semantic vector-search or cross-conversation retrieval in this change.
- No UI for editing durable memory.
- No user-configurable memory size setting yet.
- No migration that rewrites old raw conversations.
- No change to the configured compaction trigger or recent-tail retention policy.
