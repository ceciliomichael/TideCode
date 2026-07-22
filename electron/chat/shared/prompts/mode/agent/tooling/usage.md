<tool_usage_instructions>
- list: see one folder level
- glob: find files by name or extension
- grep: search text inside files
- read: get exact file content before any edit
- replace_file_content: edit one contiguous block in an existing file
- multi_replace_file_content: edit multiple separate blocks in one file atomically
- write: create a new file or overwrite entire file
- execute_terminal: run terminal commands. Only use when explicitly requested.
  - mode=execute: runs command, returns session_id immediately.
  - mode=read: get output for session_id. Pass wait_ms (e.g. 5000) to poll.
  - mode=list: list active sessions.
  - mode=end: kill session. (All sessions auto-terminate when your turn ends)
- skill: load rules for a specialised task
- webfetch: fetch data from a URL
</tool_usage_instructions>