---
status: draft
---

# CLI @mention Enter Selection Fix

## Current State

- The CLI input layer maps plain Enter to a `submit` action in `electron/cli/terminalInput.ts`.
- `electron/cli/terminalScreen.ts` already contains intended logic that checks the currently highlighted completion before normal submission.
- If the highlighted completion value starts with `@`, the screen inserts that completion, refreshes completion items, rerenders the prompt, and returns without submitting.
- The test suite already includes `screen selects an active mention completion with Enter before submitting it` in `tests/cli/terminalScreen.test.ts`.
- The reported runtime behavior indicates that the active mention completion is not consistently present or recognized at the point Enter is handled, so the existing guard is insufficient for the real CLI path.

## Goal

Make plain Enter reliably select the currently highlighted `@mention` suggestion when the CLI completion menu is active, instead of sending the prompt.

## Non-Goals

- Do not change desktop chat mention behavior.
- Do not change normal Enter submission when no active mention completion exists.
- Do not change slash-command completion semantics except where shared code must remain compatible.
- Do not refactor unrelated CLI input or rendering code.

## Relevant Files

- `electron/cli/terminalScreen.ts`
  - Completion state, highlighted completion index, Enter handling, insertion, submission.
- `electron/cli/terminalInput.ts`
  - Maps terminal keypresses to `submit`, `alternate-submit`, navigation, and insertion actions.
- `electron/cli/terminalCompletions.ts`
  - Produces `@mention` completion items for files, folders, and skills.
- `tests/cli/terminalScreen.test.ts`
  - Existing regression coverage for Enter selecting an active mention completion.
- `tests/cli/terminalCompletions.test.ts`
  - Completion catalog coverage for file, folder, and skill mentions.

## Implementation Plan

1. Trace the runtime completion lifecycle around `updateCompletionItems()`, cursor position, `completionIndex`, and `insertCompletion()` for a typed `@mention` query.
2. Identify the exact state transition that allows Enter to fall through to message submission even though a mention suggestion is visibly active.
3. Make the smallest coherent change in the CLI prompt-action path so that, when an active highlighted `@mention` completion exists, plain Enter always:
   - selects/inserts that completion,
   - updates the mention path map,
   - refreshes completion state,
   - keeps the prompt open,
   - returns before any submit logic runs.
4. Preserve existing behavior for:
   - plain Enter with no active completion,
   - slash-command completions,
   - Tab/alternate-submit completion acceptance,
   - active-turn steer/queue behavior when no mention completion is being selected.
5. Strengthen `tests/cli/terminalScreen.test.ts` so the regression test reproduces the actual failing path, including highlighted-index navigation or completion refresh timing if that is the root cause.
6. Add or adjust targeted tests only if needed to cover the discovered edge case. Avoid unrelated test churn.

## Verification

Run targeted CLI tests covering:

- Enter selects an active `@mention` suggestion without submitting.
- A second Enter submits after the mention has been inserted.
- Arrow navigation plus Enter selects the highlighted mention, not a different item.
- Plain Enter still submits when no mention completion is active.
- Existing slash-command completion behavior remains unchanged.

Then run the project's relevant type-check/build verification if available and proportionate to the change.

## Risks and Edge Cases

- Completion items may be refreshed or cleared between the keypress and submit branch.
- `completionIndex` may point at a stale item after filtering changes.
- A completion may be visible but not considered active at the current cursor position.
- Active-turn Enter behavior must not bypass mention selection.
- Mention insertion must continue populating `mentionPathMap` so the submitted text expands to canonical mention markup.

## Acceptance Criteria

- With an `@mention` suggestion menu visible, pressing Enter selects the highlighted item and does not send the prompt.
- After selection, the mention remains in the composer and the user can continue typing.
- Pressing Enter again with no active mention suggestion submits normally.
- Keyboard navigation and highlighted selection behave consistently.
- Existing CLI completion and submission tests pass.
- No desktop chat source is modified for this fix.
