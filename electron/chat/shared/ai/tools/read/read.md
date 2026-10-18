# tools.read

Read the contents of one existing text file or image. Use `tools.list` to inspect directories and the workspace root (`.`). Paths resolve relative to the workspace unless an authorized alias or absolute path is used. Continue large text reads using the returned `next_cursor` verbatim or 1-based offsets; line limits are capped at 500.

Use `tools.read({ path: "@chat/DURABLE.md" })` to read the current conversation's saved durable memory when its context requests this. The alias is read-only and bound to the active conversation. It is not a workspace file and cannot be used to access another chat.
