# Runtime Environment Context Cache Stability

## Goal
Keep the provider-facing system prompt stable when the active terminal shell or detected Python virtual environment changes, while leaving the workspace root behavior unchanged.

## Implementation
- Remove terminal-shell and Python-venv state from the system prompt.
- Represent terminal shell and Python venv as separate persisted hidden user context kinds.
- Append a transition only when each state changes.
- Emit an explicit no-venv state when a previously active venv disappears.
- Preserve existing terminal execution-mode, chat-mode, workspace-instruction, workspace-root, tool, and host-side permission behavior.
- Keep skill discovery unchanged because the provider-visible skill tool description is stable and the enabled list is resolved at execution time.

## Verification
- Add focused regression tests for stable system prompts across shell/venv changes.
- Test append-only hidden-context transitions, including venv removal and unchanged-state suppression.
- Re-run existing Plan/Agent prompt-cache invariants.
- Run the focused prompt/context test suite and `npm run typecheck`.

## Scope
No unrelated prompt cleanup, tool-schema changes, installer changes, or workspace-root changes. Release metadata will be prepared separately from updated `main` according to `.github/workflows/release_instructions.md`.
