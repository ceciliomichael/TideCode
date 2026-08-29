# Plan 066: Restore dropdown styling and align reasoning selector

## Goal
- Restore the original dropdown selection background behavior while keeping selected Kanban text and check white.
- Match normal dropdown option spacing to the compact selector spacing used by Model Selector and Chat Mode Selector.
- Make Reasoning Effort use the same visual/menu pattern as Chat Mode Selector without changing its values or behavior.

## Implementation
1. Remove the Kanban selected-row background override from Status, Priority, and Type; keep only white selected text and white selected check.
2. Add the small `space-y-0.5` gap between ordinary `DropdownField` options, matching existing chat selectors.
3. Rebuild `ReasoningEffortBlock` with the Chat Mode selector structure: compact runtime-control trigger, floating rounded menu, `space-y-0.5` option stack, matching padding/highlight behavior, and aligned check icon.
4. Preserve `fullWidth`, custom trigger classes, disabled state, reasoning option ordering/labels, and existing change semantics.

## Verification
- Update focused source/UI regressions for Kanban selected styling, DropdownField spacing, and Reasoning Effort selector structure.
- Run the focused UI tests, typecheck, targeted ESLint, and `git diff --check`.

## Scope
- Styling and selector interaction structure only.
- No Kanban workflow/data changes.
- No reasoning-value or provider behavior changes.
