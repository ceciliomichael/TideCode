# Plan 070: Honor Full Access in Code Mode filesystem tools

## Goal
Make Code Mode use the selected terminal execution mode so Full Access can inspect folders outside the current workspace while Sandbox remains restricted.

## Changes
- Pass the requested terminal execution mode from the agent tool factory into CodeModeExecutor instead of hardcoding Sandbox.
- Add a regression test covering external-directory listing through the Code Mode tool bundle in Full Access mode and preserving Sandbox restrictions.
- Leave the existing unrelated workspace Monaco changes untouched.

## Verification
- Run the focused agent/workspace tool tests.
- Run TypeScript typecheck if available.
- Run `git diff --check`.

## Scope
Only Code Mode execution-mode propagation, its regression test, and this plan are in scope.
