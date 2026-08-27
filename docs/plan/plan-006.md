# Repair old reverted canonical replays

- Detect stored replay projections whose `sourceRevision` points to their matching `run_started` event. Those are pre-response snapshots and must not be used as completed history.
- Ignore only those legacy-corrupted replays during projection, allowing durable conversation messages to rebuild assistant and tool-result context. Keep completed run replays and compaction projections unchanged.
- Add a regression with retained tool results that verifies old corrupted replay state produces non-zero tool-result context after projection.
- Verify with the canonical-history tests, typecheck, targeted lint, and `git diff --check`. Do not alter unrelated working-tree changes.
