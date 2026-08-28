# Reliability and performance hardening

## Goal
Preserve all user-visible behavior while removing confirmed hangs, stale lifecycle state, mutation races, redundant background work, and cancellation leaks.

## Changes
- Roll back provisional run-service state when provider startup fails.
- Make Code Mode timeout/abort cancel active host tools and always settle cleanly.
- Serialize apply_patch against write/edit for every touched path with deterministic multi-file lock ordering.
- Retry transient Windows history-lock cleanup failures.
- Make Windows terminal termination bounded and asynchronous, and stop infinite automatic cleanup retries.
- Add cancellation and bounded cleanup to ripgrep and MCP external operations.
- Bound local run-service connection/handshake/control requests without imposing blanket AI-run timeouts.
- Bound background/read-only Git operations and coalesce redundant forced refresh work while preserving freshness after mutations.

## Constraints
- No UI redesign or feature changes.
- No new dependencies.
- Preserve current uncommitted changes and existing Windows atomic-write work.
- Avoid storage-format or broad renderer refactors unless required by a confirmed defect.

## Verification
Add deterministic regression tests for each changed failure path and concurrency case, then run affected suites, typecheck, lint, and the broad project test suite.
