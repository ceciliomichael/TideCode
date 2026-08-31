---
status: draft
---

# Fix Kanban mention display labels

Keep Kanban IDs in send-ready message content for the AI, persist a serializable mention label map on user messages, restore that map for editing/revert, and render sent user messages with the saved Kanban title. Preserve existing file/folder/skill behavior. Verify with focused mention/history tests, typecheck, targeted lint, and git diff --check.
