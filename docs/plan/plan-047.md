# Default model reasoning effort

## Goal
Let every configurable task model save a default reasoning effort, and make CLI model selection ask for reasoning effort immediately after choosing a reasoning-capable model.

## Changes
- Add surface-scoped reasoning defaults for Agent, Plan, task planning, summarization, and commit.
- Migrate missing values from the existing chat reasoning preference, then validate against model-supported efforts at use time.
- Show a reasoning selector beside each explicit task-model selection when that model exposes configurable reasoning.
- Use the saved task reasoning defaults in Agent/Plan startup and handoffs, task planning, summarization, and commit generation. “Use chat input model” keeps inheriting the active chat effort.
- In CLI /model, prompt for reasoning effort after selecting a reasoning-capable model and save it only to the current conversation. Remove /effort and /e from commands/completions.

## Verification
Run focused settings/model/CLI/task-runtime tests, TypeScript typecheck, and git diff --check. No new dependencies.
