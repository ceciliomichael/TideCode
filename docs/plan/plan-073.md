# CLI compose submission and Codex usage

## Goal
- Keep submitted CLI messages out of the compose box so the transient composer is removed before the user message is committed to the turn transcript.
- Show both available Codex usage windows in the CLI footer, with the 5h window beside the weekly window.

## Changes
- Make the REPL turn flow print submitted user messages exactly once instead of having the prompt submission path print them while clearing the compose region.
- Keep slash commands, undo edits, queued inputs, and active steer/queue behavior unchanged.
- Build the Codex footer text from all available usage summary items instead of only the first item.
- Add no dependencies and make no unrelated changes.

## Verification
- Run the focused CLI terminal screen and composer status tests.
- Run TypeScript type checking.
- Run targeted lint for the changed CLI source files.

## Scope
- Source changes only. Existing tests may be run but are not modified as part of this task.
