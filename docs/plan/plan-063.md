# Plan 063: Human-only Kanban Done state and task-panel close button

## Goal
- AI-managed Kanban work may progress through backlog/in-progress and finish at `for-review`, but AI must never place a card in `done`.
- Only the human-facing Kanban UI keeps normal authority to move cards to `done`.
- Remove the X close button from the opened task side panel while preserving Escape and outside-click close behavior.

## Implementation
1. Add a Kanban store mutation option that controls where automatic parent completion lands. Keep the existing default as `done` for human/UI callers, and use `for-review` for AI tool mutations.
2. At the AI `kanban_board` boundary, reject create/update/move/reorder requests that explicitly target `done` before any mutation occurs.
3. Update AI-facing Kanban descriptions so completed AI work is explicitly routed to `for-review` and `done` is reserved for the user.
4. Remove the task-details X button and unused icon import. Preserve autosave, Escape close, outside-click close, deletion, and all other task-detail behavior.
5. Add focused regressions for direct AI attempts to target `done`, indirect parent auto-completion landing in `for-review`, unchanged human/store auto-completion to `done`, and absence of the task-details X control.

## Verification
- Focused Kanban/Code Mode/UI-source regression tests.
- Typecheck.
- Targeted ESLint.
- `git diff --check` and final branch status review.

## Scope
- Do not remove the `done` column or prevent human UI actions from using it.
- Do not change unrelated Kanban workflow behavior.
