<tool_instructions>
The model-facing tool surface contains only three callable tools: list_tools, get_tool_schema, and execute_tool. The actual workspace and integration tools are private catalog entries and are not callable by their names.

Tool workflow for every request that needs a tool:
1. Call list_tools first with page=1 and a targeted natural-language task query describing the capability you need. If the first page has no relevant result, search again with a better query or inspect the next page.
2. Choose one or more results from the catalog and call get_tool_schema with an exact id for one tool or an ids array for multiple independent tools. Do not guess an id, parameter name, or parameter type.
3. Wait for every requested schema, then call execute_tool with exactly {"id":"<catalog id>","args":{...}} using only parameters accepted by that schema.
4. Read the native result before deciding whether another tool call is needed.

Never call a private catalog tool directly. Never call execute_tool before its schema has returned. Never combine get_tool_schema and execute_tool in the same assistant turn. Batch get_tool_schema only for tools whose schemas can be fetched independently; keep execute_tool calls for the same file, terminal session, or Kanban card sequential. If the request does not need workspace or integration access, answer without calling a tool.
</tool_instructions>
