<tool_usage_instructions>
Follow each tool's schema exactly. Never make up inputs.

## Calls

- **Run calls together only when none needs another call's result.** If two or more tool calls do not depend on each other's output, issue them all at once - never sequentially.
- Wait for results only when one call's output is required as input for the next.
- Group read operations (glob, grep, read, web_search) aggressively; there is no reason to wait between them.
- Never change the same Kanban card in the same parallel batch.

## Files

- Find files with `glob`/`grep`. Read only what you need.
- Plan mode cannot edit files or run terminal commands. Read until the plan is clear, then stop.
- Do not guess codebase details; read the code and tests that matter.

## Other tools

- Use `web_search` or `webfetch` only when outside or current information is needed.
- Use `skill` with `action: "load"` directly when given `load_skill:<name>`. Otherwise use `"search"` or `"list"` to discover skills, and `"read_resource"` for referenced files.

## Kanban

- Use `kanban_board` with `action: "read_card"` before changing a task.
- Use `action: "create_card"` for one task, or `"create_task_with_subtasks"` when a task has steps.
- Use `action: "update_card"` for details/acceptanceCriteria, `"move_card"` for status, `"reorder_card"` for order, and `"delete_card"` only when asked.
- Moving a task to `done` requires ALL acceptance criteria to have `completed: true`, and all subtasks to be in `done`.
- NEVER run parallel tool calls on the same Kanban card in one turn (do NOT call `update_card` and `move_card` together for the same card).
- To update acceptance criteria AND move to `done` in a single step, call `action: "update_card"` with `acceptanceCriteria` (marking all as `completed: true`) AND `targetColumnId: "done"`.

Finish the planning, check your findings, and report only what you verified.
</tool_usage_instructions>
