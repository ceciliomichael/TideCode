---
status: draft
---

# Keep CLI runs alive after desktop exit

Goal: make TideCode CLI work continue when the desktop app exits.

Implementation: change desktop shutdown to disconnect only its run-service client, leaving the detached shared run service alive. Preserve explicit CLI cancellation and existing service reconnection behavior. Avoid unrelated TUI or runtime changes.

Verification: add focused lifecycle coverage for desktop disconnect semantics and run relevant run-service tests plus TypeScript checking.
