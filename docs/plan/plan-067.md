# Plan 067: Owner provenance and card metadata alignment

## Goal
- Keep Kanban Owner free-form while making AI-assigned ownership reflect who introduced the work.
- Fix vertical alignment for Owner, subtask count, and acceptance-criteria metadata on task cards.

## Implementation
1. Remove the automatic `TideCode` Owner default and automatic parent-owner inheritance from AI Kanban creation.
2. Teach the AI to set Owner deliberately per task/subtask: `Person` when the user introduced or brainstormed the work, `Agent` when the AI introduced it autonomously.
3. Preserve explicitly requested free-form owner names; do not restrict the stored assignee field to an enum.
4. Keep each subtask's Owner independent instead of inheriting the parent automatically.
5. Give Owner, subtask count, and acceptance-criteria metadata the same compact line-height, fixed icon sizing, and vertical centering on Kanban cards.

## Verification
- Update focused AI Kanban owner regressions to prove there is no invented default/inheritance and explicit provenance/free-form owners are preserved.
- Add a focused source regression for the three card-footer metadata alignments.
- Run affected Kanban/Code Mode tests, typecheck, targeted ESLint, and `git diff --check`.

## Scope
- No Owner dropdown or enum migration.
- No persistence-format change.
- Existing stored owner strings remain valid.
- No Kanban workflow/status changes.
