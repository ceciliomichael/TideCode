# tools.read

Read the contents of one existing text file or image. Use `tools.list` to inspect directories and the workspace root (`.`). Paths resolve relative to the workspace unless an authorized alias or absolute path is used. Continue large text reads using the returned `next_cursor` verbatim or 1-based offsets; line limits are capped at 500.
