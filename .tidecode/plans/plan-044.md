---
status: draft
---

# Make installer TideCode shutdown reliable

Goal: fix the installer error that says TideCode cannot be closed.

Implementation: keep shutdown inside the install phase, remove taskkill tree termination so detached CLI/run-service processes are not targeted, and retry transient taskkill failures before aborting. Treat the no-process result as success.

Verification: extend installer source tests to assert /T is not used and retry behavior remains, then run the installer test and TypeScript check.
