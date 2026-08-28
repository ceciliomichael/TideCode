# Plan 053: Prevent Accidental Text Selection in Workspace Panels

## Goal

Extend the existing non-selectable UI treatment to the remaining workspace panels without preventing selection of meaningful content or editable fields.

## Changes

- Mark Explorer tree controls, context menus, file tabs, and breadcrumbs as non-selectable.
- Mark Source Control and diff panel chrome, headings, rows, and actions as non-selectable while preserving selectable diff content.
- Mark Commit modal chrome and action choices as non-selectable while preserving the commit textarea and its editable text.
- Mark Terminal tabs and status controls as non-selectable while preserving terminal output selection.
- Mark board panel chrome, columns, cards, and controls as non-selectable while preserving dialog inputs and editable fields.
- Mark Thinking/Thought block headers as non-selectable while preserving expanded thought and tool content.
- Reuse the existing `non-selectable-ui` and `selectable-ui` CSS conventions; add no dependencies or unrelated refactors.

## Verification

- Run `npm run typecheck`.
- Run `git diff --check`.
- Review the final diff to confirm only the approved panel-selection behavior changed.
