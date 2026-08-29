# Plan 064: Cleaner Kanban task hierarchy and review workflow

## Goal
- Show a solid selected state with white text and a white check in the task Status, Priority, and Type dropdowns.
- Keep the board focused on top-level tasks only; manage subtasks from the task side panel.
- Treat `for-review` as the automatic completion handoff. `done` remains an explicit user approval state.
- When a top-level task moves to `for-review`, mark all of its direct subtasks complete.

## Implementation
1. Extend the shared dropdown with an optional selected-row class and use it only for the three task-detail dropdowns, alongside the existing selected-check class.
2. Change Kanban board projection to render only top-level tasks. Keep child metadata for subtask progress.
3. Make board column/header counts reflect visible top-level tasks only.
4. Preserve search discoverability: a matching subtask surfaces its parent task on the board; priority filtering remains based on the parent task.
5. When a top-level task moves to `for-review`, mark its direct subtasks `done` so the side-panel subtask checks are complete.
6. Change automatic parent completion to `for-review`, never automatic `done`. If reviewed work becomes incomplete again, return the parent to `in-progress`.
7. Keep explicit human moves to `done` available and keep the AI restriction against directly targeting `done`.
8. Make `Clear done` clear completed top-level tasks and their subtasks only, preserving hidden completed subtasks that belong to a task still in review or active work.

## Verification
- Focused hierarchy, search, review-workflow, task-details, and Code Mode regressions.
- Typecheck.
- Targeted ESLint.
- `git diff --check` and branch status review.

## Scope
- No new Kanban columns or persistence format.
- No change to unrelated dropdowns.
- Subtasks remain editable/openable from the task side panel.
