---
status: draft
---

# Sync Desktop and CLI conversation runtime state

## Status
Completed and verified.

## Goal
Make normal Desktop and CLI sessions for the same conversation share manual compaction state, chat mode, and selected model in real time. Keep remote functionality unchanged.

## Implemented
- Routed manual compaction through the shared run service and broadcast its lifecycle per conversation.
- Added shared compaction state lookup so a newly attached Desktop or CLI surface can catch up to an in-progress or completed compaction.
- Changed CLI /compact to start compaction without blocking the REPL composer.
- Added an idle CLI status row using the existing thinking spinner frames: "Compacting" while active, then "Compacted" after commit, while retaining the compose panel.
- Added conversation-scoped shared runtime state for chat mode and selected model/provider, including the provider runtime model ID needed by CLI execution.
- Routed CLI slash mode changes and Shift+Tab through shared per-thread mode synchronization.
- Routed CLI model changes through shared per-thread model synchronization.
- Updated Desktop mode and model state to publish and consume the same shared runtime events.
- Kept Desktop model changes thread-scoped when a saved conversation is active instead of changing global defaults.
- Persisted explicit agent/plan mode and per-thread model preferences for restart/resume behavior.
- Made active stream persistence read the latest shared chat mode at flush time so a mid-turn mode change cannot be overwritten by an older turn-start mode.
- Removed the CLI "Plan mode is active." and "Agent mode is active." notices.
- Did not modify remote daemon or /remote behavior.

## Verification
- npm run typecheck: passed.
- Focused regression suite: 35/35 passed.
- Full CLI plus relevant run-service, compaction, conversation-model, and settings suite: 179/179 passed.
- ESLint: all changed files excluding electron/settings/store.ts passed with zero warnings/errors. The full settings store file has 17 pre-existing unrelated lint violations at lines 352-414; this patch changes only its chatMode sanitizer around line 190.
- npm run build: passed. Vite emitted one existing workspaceMonacoTheme dynamic/static import warning.
- git diff --check: passed.
- Remote audit: no remote-related implementation file is changed.

## Acceptance criteria
- [x] /compact from CLI returns control to the composer while compaction continues.
- [x] CLI shows spinner + Compacting, then Compacted, without losing the compose panel.
- [x] Desktop and CLI receive the same manual compaction lifecycle for the same thread.
- [x] Plan/Agent changes synchronize between Desktop and CLI for that conversation only.
- [x] Model changes synchronize between Desktop and CLI for that conversation only.
- [x] CLI mode activation notices are removed.
- [x] Remote implementation remains untouched.
