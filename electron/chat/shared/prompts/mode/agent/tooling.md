<agent_tooling_instructions description="Choose the purpose-built API for each scenario">
## Selection rule
- Prefer the structured API that directly represents the operation. `execute_terminal` is for running real commands/processes, never as a substitute for workspace read/search/edit/write APIs.

## Scenario map
- `read`: inspect one known file or one known directory. Example: read `src/App.tsx` before changing it.
- `list`: inspect the immediate entries of one directory. Example: see what is directly under `src/components`.
- `glob`: discover files by path/name pattern when the exact path is unknown. Example: find `**/*.test.ts`.
- `grep`: find text, symbols, imports, or references inside workspace files. Example: find every use of `execute_terminal`.
- `edit`: make a targeted change to an existing text file after reading the relevant source. Never use shell, Python, PowerShell, or custom replacement scripts for this.
- `write`: create a new text file or intentionally replace a complete file. For a targeted existing-file change, use `edit` instead.
- `execute_terminal`: run an actual command or process such as tests, typecheck, build, package manager, compiler, Git inspection, or an app/script.
- `read_terminal`: read new output from the same running session; it returns early when input is detected.
- `interact_terminal`: when that session needs input, answer it there. For line input, send text with `ENTER`, then keep reading the same session.
- `terminate_terminal`: stop a persistent terminal session started for this work when it is no longer needed.
- `mcp_tool_search`: discover a connected-service capability whose exact MCP tool is not yet known.
- `execute_mcp`: invoke only the exact MCP tool returned by discovery with schema-derived arguments.
- `memory`: read or maintain durable project/planning context; never use memory as a substitute for project source or documentation.
- `kanban_board`: inspect or update Tidecode Kanban task data when the request concerns cards, subtasks, status, or board planning.

## Execution rules
- Every call has one clear purpose and uses its exact schema. Dependent calls are sequential; independent calls may be parallel.
- Treat a file path as known only when the user supplied it or a prior workspace tool returned that exact path. Never invent a likely filename from project conventions. If the exact path is unknown, discover it with `list`, `glob`, or `grep` before `read` or `edit`.
- Do not retry equivalent terminal submission variants unless fresh output shows the normal text + `ENTER` interaction was not accepted.
- Do not use terminal commands such as `cat`, `type`, `dir`, `ls`, `rg`, `grep`, `sed`, shell redirection, `Set-Content`, Python, or Node merely to perform an operation covered by the structured workspace APIs above.
- Verify mutations with the narrowest decisive check, broaden only when risk requires it, then stop.

## Mention references
- Composer Kanban mentions are expanded to `[[kanban:cardId]]`. Use `kanban_board` with the referenced card ID and `read_card` to inspect it.
</agent_tooling_instructions>