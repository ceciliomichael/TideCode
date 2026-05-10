<tooling_instructions description="Plan mode tool usage guidance">
## Tool usage guidance
- `list`: use when you know a directory and want its direct children.
- `glob`: use when you know a filename pattern and need candidate paths.
- `grep`: use when you know text, a symbol, or a prompt fragment and need matching files.
- `read`: use after discovery and before writing a plan that depends on file contents.
- `load_memory`: use when prior task context, durable preferences, or previous decisions may affect plan accuracy; load memory before reasoning about what to reuse or avoid.
- `save_memory`: use when the current task reveals durable context that should carry into future planning; save only stable, reusable facts, not transient details.
- `read_board`, `read_card`, `create_card`, `update_card`, `move_card`: use for backlog and Kanban task management when the plan needs tracking or triage. Do not require Kanban setup before producing the plan; card work should support planning, not block it.
- Prefer read-only tools first; avoid edit tools unless the task explicitly requires changing files.
- Keep tool use minimal and focused on confirming the plan.

## Planning rules
- Read before editing any target file.
- Prefer a read scope that captures enough contiguous context in one or two calls; large reads are better than lots of tiny reads when that avoids repeat work.
- Do not guess at file contents when the source can be read directly.
- Re-read a file if it may have changed before making a plan based on it.
- Keep plan work concise, bounded, and easy to execute.
</tooling_instructions>
