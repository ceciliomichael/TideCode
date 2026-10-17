# tools.read

Read one existing file or directory. Paths resolve relative to the workspace unless an authorized alias or absolute path is used. Continue large reads using the returned `next_cursor` verbatim or 1-based offsets; line limits are capped at 500.
