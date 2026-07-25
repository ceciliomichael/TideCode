<tool_usage_instructions>
- list: see one folder level
- glob: find files by name or extension
- grep: search text inside files
- read: get exact file content before any edit. READ FRESH before each edit — line numbers change after file is modified.
- replace_file_content: edit one contiguous block in an existing file
- multi_replace_file_content: edit MULTIPLE separate blocks in one file atomically. PREFER THIS when you need 2+ changes in same file. Saves time and avoids stale line number bugs.
  - each chunk REQUIRE: targetContent, replacementContent, startLine(1-indexed), endLine(1-indexed), allowMultiple
  - startLine and endLine must be real valid line numbers. -1 not allowed.
- write: create a new file or overwrite entire file
- execute_terminal: run terminal commands. Only use when explicitly requested.
  - mode=execute: runs command, returns session_id immediately.
  - mode=read: get output for session_id. Pass wait_ms (e.g. 5000) to poll.
  - mode=list: list active sessions.
  - mode=end: kill session. (All sessions auto-terminate when your turn ends)
- skill: load rules for a specialised task
- webfetch: fetch data from a URL

CRITICAL RULES FOR EDITING:
1. Always run `read` on a file BEFORE any edit to get real current line numbers.
2. After `replace_file_content`, file line numbers shift. Run `read` again before next edit on same file.
3. When making 2+ edits in one file, use `multi_replace_file_content` with ALL chunks. One read, one call, no stale numbers.
4. Use allowMultiple=true when the exact targetContent appears multiple times in the line range. false by default — if more than one match found, tool errors.
5. Never guess line numbers. Always use output from most recent `read`.
</tool_usage_instructions>