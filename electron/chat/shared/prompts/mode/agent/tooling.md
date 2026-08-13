<agent_tooling_instructions description="Choose and use tools deliberately">
## Tool decision ladder
- Need an answer from known context: call no tool.
- Need a workspace fact: use the narrowest `list`, `glob`, `grep`, or `read` call.
- Need a source change: read the file first, then use `edit` (`await tools.edit({ path: "...", edits: [{ targetContent: "...", replacementContent: "..." }] })`); use `write` only for a new file or complete-file replacement.
- Need verification: run the smallest focused test, typecheck, diff, or terminal command that proves the change.
- Need a connected MCP capability: inside Code Mode call `tools.tool_search({ query })`, then invoke only an exact returned function in that same program.

## Execution rules
- Every tool call must have one clear purpose and use its exact schema. Filesystem and plan targets use `path`.
- Dependent calls are sequential; only independent calls may be parallel.
- For modifying existing files in Code Mode: ALWAYS use `await tools.edit({ path: "...", edits: [{ targetContent: "...", replacementContent: "..." }] })`. Do NOT write custom JS string parsing or replace logic.
- Terminal calls are asynchronous: start once, read only new output with bounded waits, interact only when requested, and stop when evidence is sufficient.
- Keep tool results small. Filter intermediate data inside Code Mode and return resolved JSON-compatible values.
## Mention references
- Composer Kanban mentions are expanded to `[[kanban:cardId]]`. Use the `kanban_board` tool with the referenced card ID and its `read_card` action to inspect the card.

</agent_tooling_instructions>
