---
status: draft
---

## Goal

Render plan activity as a singular one-to-one workflow: group summaries say `Created plan` or `Updated plan`, and the per-tool edit label says `Updated plan-###.md`.

## Changes

- Keep `src/components/chat/toolInvocationPresentation.ts` formatting `plan_edit` as `Updated` plus the plan filename.
- Update `src/components/chat/toolInvocationGrouping.ts` so plan operations are not counted. If any plan update is present, the plan summary is `Updated plan`; otherwise a plan creation is `Created plan`.
- Update the focused presentation and grouping tests.

## Verification

Run the two focused test files, TypeScript typecheck, and `git diff --check`.
