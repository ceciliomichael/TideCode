# Agent Loop Compaction Blueprint

Last updated: March 16, 2026

This document defines how to add context compaction to the unified agent loop in a future iteration, without changing the current runtime behavior.

## Goals

- Reduce context growth in long tool-heavy sessions.
- Preserve tool-result correctness and replay safety.
- Keep first-turn and post-compaction instructions/context deterministic.

## Non-Goals (Current Scope)

- No runtime compaction is enabled yet.
- No provider behavior changes in this phase.

## Trigger Policy

Use model-aware token thresholds:

1. Track rolling context usage per stream from:
   - system/instructions segments
   - replayed user/assistant history
   - replayed tool-result context
2. Trigger compaction only when total estimated usage exceeds a provider/model threshold.
3. Do not compact on every turn; compact only at threshold crossings or after a failed turn caused by context size.

## Compaction Flow

1. Build compact input from normalized loop history (model-visible items only).
2. Request compaction using a non-streaming compact endpoint when available:
   - Preferred: `/responses/compact` style API.
3. Validate compacted output:
   - keep only allowed item types
   - remove stale developer/context wrappers
4. Reinject canonical runtime context:
   - permissions/policy layer
   - project instruction layer
   - environment context layer
5. Replace in-memory replay history with compacted history + reinjected canonical context.
6. Keep ghost snapshots/checkpoints and metadata needed for undo/revert workflows.

## Placement Rules

When reinserting canonical context after compaction:

1. Prefer inserting before the last real user message.
2. If no real user message remains, insert before compaction summary.
3. If only compaction records remain, insert before the last compaction item.
4. If no insertion anchor exists, append context at the end.

## Safety Requirements

- Never drop unresolved tool calls or orphan tool outputs.
- Preserve workflow-plan state (`update_plan`) semantics across compaction.
- Recompute context usage after replacement.
- Emit structured diagnostics when compaction fails and continue with fallback behavior.

## Provider Strategy

- `codex`: use compact endpoint when supported by backend contract.
- `custom:*`: enable only when endpoint compatibility is confirmed.
- Other providers: add translator-specific compact adapters later; no hard coupling in loop core.

## Required Tests (Future Implementation)

1. Trigger threshold behavior (no premature compaction).
2. Compaction replacement keeps turn replay valid.
3. Tool call/output pairing remains valid after compaction.
4. Canonical context reinjection placement follows rules.
5. Failure path logs diagnostics and safely falls back.
6. Cross-provider parity tests for enabled adapters.
