---
status: draft
---

# Delay TideCode termination until install begins

Goal: opening the Windows setup should not immediately terminate TideCode. Termination should happen only when the installer actually enters the install/update execution flow.

Implementation: move the existing process-termination hook from installer initialization to the install phase while preserving the same process matching and retry behavior. Keep uninstall behavior unchanged unless it shares the same hook and must be separated.

Verification: add or update focused installer source tests and run those checks plus relevant build/config validation. No dependencies or unrelated installer UI changes.
