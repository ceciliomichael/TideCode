# Plan 071: Prompt AGENTS.md rereads without rewriting history

## Goal
Detect when the current root AGENTS.md revision differs from the latest context and explicitly prompt the AI to reread the current file, without removing or rewriting existing conversation history.

## Changes
- Preserve the existing durable hidden-context history and compaction projection behavior.
- Keep the existing revision marker comparison based on AGENTS.md file metadata.
- Make the runtime workspace-instructions injection say explicitly that AGENTS.md changed and must be reread when a changed revision is detected.
- Detect both a changed file before the next turn and a newly persisted workspace-instructions transition, while avoiding repeating the prompt on later normal messages.
- Add regression coverage that verifies the original history remains unchanged and the reread prompt is emitted only for the changed turn.

## Verification
- Run the focused workspace-instructions and hidden-context tests.
- Run TypeScript typecheck if available.
- Run git diff --check.

## Scope
Only AGENTS.md revision reread prompting, its tests, and this plan are in scope.
