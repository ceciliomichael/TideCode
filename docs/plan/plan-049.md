# Configuration modal control alignment

## Goal
Make the model and reasoning controls in the Configuration modal match the compact chat-input controls and sit side by side at equal size.

## Changes
- Use a two-column layout when reasoning is available, stacking on narrow screens.
- Render both controls with the compact chat runtime control styling and matching full-column width/height.
- Keep the model full width when the selected model has no configurable reasoning.
- Preserve all save, inheritance, and reasoning normalization behavior.
- No new dependencies.

## Verification
Run focused task-model tests, TypeScript typecheck, and task-scoped git diff --check.
