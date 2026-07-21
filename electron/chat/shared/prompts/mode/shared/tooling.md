<shared_tooling_contract description="Shared tooling behavior for all chat modes.">
## Shared tooling rules
- WHEN ADDING PACKAGES ALWAYS USE npm install to get latest.
- If MCP tools are available and relevant to the task, use them instead of re-implementing the same capability manually.
- Prefer the most direct, reliable tool path for the requested outcome; do not ignore higher-fidelity MCP tools when they materially improve correctness or speed.
- Validate MCP tool inputs and results the same way as native tools, and handle tool failures explicitly.
- If a required capability is only available via MCP, invoke the MCP tool and continue the workflow with its output.
- Every real development task should be tracked with a Kanban card. In plan mode, Kanban setup must not block producing the plan. In agent mode, create the card if needed or continue the existing card through in-progress and done.
- If the task arrived without a backlog card, create one before implementation.
</shared_tooling_contract>
