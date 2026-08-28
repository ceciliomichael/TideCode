# Plan 033 - Conditional AGENTS.md workspace bootstrap

Status: implemented

## Goal
Stop TideCode from forcing a failing `AGENTS.md` read in workspaces where the file does not exist, while preserving repository-instruction behavior when it does exist.

## Findings
- The supplied history failed on its first Code Mode call because the system prompt said the model "must read `AGENTS.md`" even though that workspace had no such file.
- The workspace prompt is assembled synchronously with the authoritative workspace root already available, and the prompt builder already uses filesystem existence checks for other workspace context.

## Implementation
- Make the workspace-instruction bootstrap depend on the actual root-level `AGENTS.md` existence at prompt-build time.
- If present, require the model to read and follow it before project-file work.
- If absent, explicitly state that no root `AGENTS.md` is present and the model must continue normally without attempting to read it.
- Keep file contents out of the system prompt.

## Reliability and Cache Behavior
- Use the real authoritative workspace root, not model inference or a tool call.
- Recompute presence whenever the system prompt is built, so adding/removing `AGENTS.md` changes the prompt and therefore the existing system-prompt fingerprint/cache key naturally.
- No provider-specific behavior and no dependencies.

## Verification
- Update unit tests for both present and absent bootstrap states.
- Add prompt-level regression for a workspace with no `AGENTS.md` and confirm it does not contain a forced-read instruction.
- Run focused workspace/prompt tests, TypeScript typecheck, and scoped `git diff --check`.

## Scope
Only workspace instruction bootstrap generation and its tests.
