# Plan 065: AI Kanban owner defaults

## Goal
- Make AI-created Kanban work populate the Owner field consistently.
- Keep human-created Kanban tasks unchanged.

## Implementation
1. At the AI `kanban_board` tool boundary, default an omitted owner on a newly created main task to `TideCode`.
2. For an AI-created subtask, preserve an explicitly supplied owner; otherwise inherit the parent owner, falling back to `TideCode` when the parent has no owner.
3. For `create_task_with_subtasks`, let subtasks inherit the resolved parent owner unless they explicitly provide their own owner.
4. Describe `assignee` to the model as the task Owner field and document the default/inheritance behavior.
5. Do not auto-fill or change Owner on existing cards during unrelated updates.

## Verification
- Add focused AI Kanban regression coverage for default owner, parent inheritance, and explicit owner override.
- Run the focused Kanban/Code Mode tests affected by the contract.
- Run typecheck, targeted ESLint, and `git diff --check`.

## Scope
- No change to human task creation defaults.
- No persistence-format change.
- No owner directory, identity model, or new dependency.
