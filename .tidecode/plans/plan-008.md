---
status: draft
---

# Fix CLI composer wrap spacing at line boundaries

## Context
The CLI composer could render a word such as `thanks` with an artificial continuation row at a visual wrap boundary. The root cause was in `getComposerVisualLines` in `electron/cli/composer.ts`: it used `wrapVisible(remaining, width)[0]` for rendering, then advanced through the source by only the rendered chunk length. `wrapVisible` intentionally discards whitespace that overflows a line boundary, so that discarded whitespace was processed again on the next composer iteration.

## Goal
Make CLI composer wrapping consume source text and render visual rows consistently so words and continuation rows retain correct spacing and cursor mapping.

## Non-goals
- Do not change generic terminal output wrapping.
- Do not change desktop chat rendering.
- Do not redesign the composer panel layout.
- Do not alter unrelated CLI input behavior.

## Affected files
- `electron/cli/composer.ts`: composer-specific source-aware wrapping and cursor mapping.
- `tests/cli/composer.test.ts`: regression coverage for boundary whitespace and caret placement.
- `.tidecode/plans/plan-008.md`: tracked implementation plan.

## Implemented solution
1. Replaced the composer’s repeated `wrapVisible(...)[0]` slicing with a source-aware `getComposerWrapChunk` helper.
2. The helper mirrors existing word-wrap behavior while separately tracking rendered source length and total consumed source length.
3. Boundary whitespace that does not fit is consumed exactly once without being rendered as a standalone continuation row.
4. Visual line source ranges now leave skipped boundary whitespace as a gap, and cursor mapping sends caret positions in that gap to the next visual row at column zero.
5. Added regression coverage for `123456 thanks` at width 6, asserting visual rows `123456` and `thanks` with no stray whitespace row and correct caret placement after the boundary space.

## Verification
- Direct runtime reproduction now renders exactly two visual rows: `123456` and `thanks`.
- `node --import tsx --test tests/cli/composer.test.ts`: passed, 5 tests.
- `node --import tsx --test tests/cli/terminalPanels.test.ts tests/cli/terminalScreen.test.ts`: passed, 29 tests.
- `npm run typecheck`: passed.
- `git diff --check -- electron/cli/composer.ts tests/cli/composer.test.ts .tidecode/plans/plan-008.md`: passed.

## Acceptance criteria
- [x] Boundary whitespace does not produce an artificial continuation row.
- [x] A word such as `thanks` wraps as one clean continuation row when it fits the composer width.
- [x] Continuation text keeps the intended prompt alignment.
- [x] Cursor row and column remain correct after boundary whitespace is skipped.
- [x] Focused and related CLI tests pass.
- [x] TypeScript type checking passes.
- [x] The plan Markdown is included in the implementation change and will be committed rather than left untracked.
