---
status: draft
---

# Fix CLI mention streaming display

Goal: prevent canonical mention markup such as [[list:docs]] and [[read_file:src/main.ts]] from appearing in the CLI while a turn is streaming.

Changes:
- Normalize user-facing CLI transcript text with collapseChatMentionMarkup before rendering/storing live transcript entries.
- Apply the same normalization to consumed streamed user messages and active follow-up snapshots so expanded runtime mention markup never leaks into display.
- Keep persisted/runtime mention encoding unchanged.
- Add focused regression tests for folder and file mentions.

Verification:
- Run targeted CLI terminal tests.
- Run TypeScript type checking.

Scope: display-only CLI fix, no dependency or protocol changes.
