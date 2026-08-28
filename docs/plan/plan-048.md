# Configuration cards and modal setup

## Goal
Make Settings > Configuration match the Providers interaction pattern: compact configuration cards open a modal for model and default reasoning effort.

## Changes
- Replace the five inline model/effort controls with provider-style cards showing the current setup.
- Add a reusable task-model configuration dialog with model selection, conditional reasoning effort, Cancel, and Save changes.
- Keep edits local until Save; inherited chat-input settings hide the effort control.
- Preserve all existing settings scope, persistence, runtime defaults, CLI behavior, and Context settings.
- Reuse existing settings/model primitives and styling. No new dependencies.

## Verification
Run focused configuration/settings tests, TypeScript typecheck, and task-scoped git diff --check. Do not rebuild generated artifacts.
