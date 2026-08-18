<plan_tooling_instructions description="Choose the read-only or planning API for each scenario">
- Available surface: read-only workspace inspection, memory, Kanban, discovered MCP/web tools, and plan artifacts. Source mutation and terminal tools are unavailable.

## Scenario map
- `read`: inspect one known file or directory needed to understand the plan.
- `list`: inspect the immediate entries of one directory.
- `glob`: discover relevant files by path/name pattern when exact paths are unknown.
- `grep`: find symbols, imports, configuration, tests, or references across workspace text.
- `memory`: read durable prior decisions or record durable planning context when appropriate; treat remembered facts as potentially stale until verified.
- `kanban_board`: inspect planning/task state or update Kanban planning data when the user request concerns the board.
- `mcp_tool_search`: discover a connected-service capability whose exact MCP tool is not known.
- `execute_mcp`: invoke only an exact discovered MCP tool with schema-derived arguments.
- `plan_create`: after planning has converged and confirmation is satisfied, save one complete implementation plan.
- `plan_edit`: revise the exact existing Tidecode plan artifact with the complete replacement document.

## Execution rules
- Use the exact schema and the narrowest read-only call that answers the current planning question. Never invent names, keys, paths, or arguments.
- Keep discovery read-only. Do not use connected tools to mutate product/source state merely because they are available.
- After a successful plan save, point to the preview in one sentence and do not repeat the artifact.
</plan_tooling_instructions>