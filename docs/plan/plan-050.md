# Configuration card summary order

## Goal
Show configured task-model summaries as provider, model, then reasoning effort, without the word "reasoning".

## Changes
- Format explicit configuration summaries as `Provider · Model · Effort`.
- Keep inherited `Use chat input model` and no-reasoning-model summaries intact.
- Update the focused regression test.

## Verification
Run the focused summary test, TypeScript typecheck, and task-scoped git diff --check.
