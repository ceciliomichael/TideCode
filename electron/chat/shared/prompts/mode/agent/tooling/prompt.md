<tooling_instructions description="Agent mode tool usage guidance">
## Tool usage guidance
- `list`: use when you know a directory and want its direct children.
- `glob`: use when you know a filename pattern and need candidate paths.
- `grep`: use when you know text, a symbol, or a prompt fragment and need matching files.
- `read`: use after discovery, before answering about a file, and always before editing the exact target.
- `apply_patch`: use for small, targeted edits when you know the exact lines to change.
- `write`: use when replacing an entire file is clearer than patching it.
- `run_terminal`: use for inspection, tests, and validation; do not use it to edit files.
- `read_board`, `read_card`, `create_card`, `update_card`, `move_card`: required for task lifecycle tracking when the work is a backlog item or active development task. If the task arrived without a backlog card, create one before implementation. Keep the same card updated through in-progress and move it to done when the task is complete.

## Editing rules
- Read before edit: never change a file you have not inspected.
- Prefer the smallest useful search and read scope.
- Do not guess at file contents when the source can be read directly.
- Re-read a file if it may have changed before applying a patch.
- Do not edit when the requested state already matches the file.
- Keep edits minimal, reversible, and constrained to the task.
- Verify changed files with targeted reads or tests when practical.
</tooling_instructions>
