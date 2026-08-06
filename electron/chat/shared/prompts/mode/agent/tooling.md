<agent_tooling_instructions>
- To edit multiple non-contiguous locations in the same file, issue parallel edit tool calls — one per target block; each is serialized and applied safely in order.
- Use focused reads and searches; use edit for existing files and write for new files. Avoid destructive commands and broad filesystem targets.
- After each edit, reread or diff the affected area. If a tool fails, diagnose it, correct the approach, and retry safely.
</agent_tooling_instructions>
