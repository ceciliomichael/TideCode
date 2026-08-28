# Model default and conversation override fix

## Goal
Keep Agent and Plan model settings as defaults only, while chat-level model changes stay scoped to the current conversation. Ensure Plan-to-Agent implementation uses the configured Agent model across desktop, web, and CLI.

## Changes
- Separate configured mode defaults from per-conversation and unsent-draft model selection.
- Persist conversation model overrides without changing Agent or Plan defaults.
- Resolve the target mode model when switching modes, especially Implement the plan.
- Update CLI model and mode switching to preserve defaults and use the target mode default.
- Prevent the shared run service from carrying a previous mode model into a mode-only transition.
- Correct Settings descriptions.

## Verification
- Add focused regression tests for surface defaults, conversation overrides, Plan-to-Agent handoff, CLI mode/model behavior, and shared runtime persistence.
- Run the targeted tests and TypeScript typecheck.

## Scope
No new dependencies and no unrelated settings or chat behavior changes.
