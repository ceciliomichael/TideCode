# Persist Workspace Instruction Context

## Goal
Make root `AGENTS.md` instructions a persisted hidden-user-context transition, matching the existing chat-mode and execution-mode behavior.

## Changes
- Build a reusable `workspace_instructions` hidden context with a deterministic content state.
- Read `AGENTS.md` before saving desktop, CLI, and remote user turns, and attach the context when its state changes.
- Preserve the provider-runtime projection as a defensive refresh for old histories and files changed between persistence and execution.
- Keep internal context hidden from normal chat bubbles while making it visible in raw conversation history.

## Verification
- Test initial persistence, unchanged instructions, changed instructions, missing files, Plan Mode delivery, and provider continuation.
- Run focused tests, TypeScript checking, linting, and diff validation.

## Scope
- Root `AGENTS.md` only, matching current behavior; no new dependencies or nested instruction discovery.
