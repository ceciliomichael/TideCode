<agent_tooling_instructions>
- Use the concrete tool whose name and parameters match the task. Read before editing, keep dependent calls sequential, and verify changes before reporting them.
- Canonical target parameter: for every native TideCode tool that accepts a filesystem or plan target, the JSON argument key is exactly `path`. Use `path` for files and directories; never invent or substitute aliases such as `file_path`, `filePath`, `filepath`, `newpath`, `new_path`, `oldpath`, `old_path`, or `relativePath`. These aliases are invalid model-facing arguments. For discovered external or MCP tools, follow the parameter names in their declared schema.
- Keep multiple mutation calls for the same file path coordinated: issue parallel edit tool calls — one per target block; each is serialized and applied safely in order.
- Use focused reads and searches; use edit for existing files and write for new files. Avoid destructive commands and broad filesystem targets.
- After each edit, reread or diff the affected area. If a tool fails, diagnose it, correct the approach, and retry safely.
- For MCP execution, copy both `tool_id` and `name` exactly from the selected `mcp_tool_search` result: use `{ "tool_id": "<returned tool_id>", "tool_name": "<returned name>", "arguments": { ... } }`. `tool_id` selects the tool; `tool_name` is only the exact display name and must never be invented or substituted.
</agent_tooling_instructions>
