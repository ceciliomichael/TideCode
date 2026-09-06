---
status: draft
---

# Restore reverted chat scroll anchor

Goal: When reopening a conversation with a persisted revert session, keep the revert/edit state and position the chat viewport at the reverted user message instead of the latest message.

Implementation:
1. Expose the active persisted revert message id from useChatMessages so the UI can distinguish a real revert session from ordinary editing.
2. Extend chat auto-scroll with an optional reset anchor message id. On conversation/reset changes, if that anchor exists, scroll that message into the viewport and pause follow-latest; otherwise preserve the current bottom-follow behavior.
3. Pass the active revert message id through ChatConversationSurface into MessageList/useChatAutoScroll.
4. Add focused tests for reset-anchor selection/scroll behavior where practical, and run typecheck plus targeted tests.

Scope: no new settings or dependencies, no general per-chat arbitrary scroll persistence. The change only restores the viewport to the reverted message for persisted revert sessions.
