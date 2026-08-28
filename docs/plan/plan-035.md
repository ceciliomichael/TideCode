# Runtime Workspace Instructions

## Goal
Supply the root `AGENTS.md` contents to the model as runtime-managed hidden user context so the model does not need to read the file through Code Mode.

## Changes
- Read the root workspace instructions in the host runtime and attach one current `workspace_instructions` hidden context to model messages.
- Replace stale injected instructions when the file changes, and remove them when the file is unavailable.
- Replace the system bootstrap that orders the model to read `AGENTS.md` with a stable explanation of the injected context.
- Apply the same projection to normal execution, provider continuations, and context-usage estimation.
- Preserve the hidden context through the existing compaction carry-forward behavior.

## Scope
- Support the root `AGENTS.md`, matching current behavior; nested instruction discovery is unchanged.
- Add no dependencies and do not alter unrelated prompt or tool-output behavior.

## Verification
- Add focused tests for injection, replacement/removal, prompt behavior, and continuation visibility.
- Run the affected test files and TypeScript checking, then review the final diff for unrelated changes.
