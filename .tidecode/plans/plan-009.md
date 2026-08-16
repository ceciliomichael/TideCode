---
status: draft
---

# Parse Markdown in CLI reasoning previews

## Context
Live CLI reasoning is displayed through the active-turn activity row. `terminalScreen.ts` compacts streamed reasoning text into `activity.detail`, then `terminalActiveTurn.ts` delegates that row to `renderTerminalActivityLine` in `electron/cli/terminalActivity.ts`.

The activity renderer previously truncated and printed `activity.detail` as raw text. Provider reasoning such as `**Diagnosing extraction bug and planning fix**` therefore reached the terminal with literal Markdown delimiters. Assistant text and the legacy single-row reasoning presenter already use `formatInlineMarkdown` from `terminalMarkdown.ts`.

## Goal
Render supported inline Markdown in the live CLI reasoning preview so Markdown delimiters are not displayed literally and the preview uses the terminal's existing inline Markdown presentation.

## Non-goals
- Do not change reasoning extraction or provider event payloads.
- Do not expose additional reasoning content.
- Do not redesign the Thinking activity row.
- Do not broaden the existing lightweight Markdown grammar.

## Affected files
- `electron/cli/terminalActivity.ts`: parse activity detail with the shared inline Markdown formatter before width truncation.
- `tests/cli/terminalActiveTurn.test.ts`: regression coverage for parsed and truncated reasoning Markdown.
- `.tidecode/plans/plan-009.md`: finalized implementation plan.

## Implemented solution
1. Imported and reused `formatInlineMarkdown` in `renderTerminalActivityLine`.
2. Formatted `activity.detail` before applying `truncateVisible`, so display width is based on rendered text rather than Markdown delimiters.
3. Preserved the existing Thinking-row label, separator, subtle styling, and width bound.
4. Added a regression case for `**Diagnosing extraction bug and planning fix**` that verifies the visible output contains no literal `**` and retains bold terminal styling when untruncated.
5. Added a narrow-width regression verifying Markdown delimiters do not leak after truncation and the row remains within the requested terminal width.

## Verification
- `node --import tsx --test tests/cli/terminalActiveTurn.test.ts`: passed, 13 tests.
- `node --import tsx --test tests/cli/terminalMarkdown.test.ts`: passed, 3 tests.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed. Vite emitted the existing dynamic/static import chunking warning for `workspaceMonacoTheme.ts`; there were no build errors.
- `git diff --check -- electron/cli/terminalActivity.ts tests/cli/terminalActiveTurn.test.ts .tidecode/plans/plan-009.md`: passed.

## Acceptance criteria
- [x] Live CLI reasoning displays `Diagnosing extraction bug and planning fix` instead of literal `**Diagnosing extraction bug and planning fix**`.
- [x] Supported inline Markdown receives the same terminal styling used elsewhere in the CLI.
- [x] Truncated reasoning previews do not leak Markdown delimiters and remain width-bounded.
- [x] Existing active-turn and Markdown regression tests pass.
- [x] TypeScript type checking passes.
- [x] Production build passes.
