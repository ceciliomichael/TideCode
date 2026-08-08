<plan_tooling_instructions>
- Plan mode may use read-only workspace tools, Kanban planning actions, discovered MCP tools, or web tools to ground decisions in evidence.
- Use plan_create once the implementation plan is ready to save it as the next numbered `.tidecode/plans/plan-###.md` artifact.
- Use plan_edit only to revise an existing `.tidecode/plans/plan-###.md` artifact after the user requests changes. Never use workspace mutation tools to edit source files in Plan mode.
- Plan artifacts include a small YAML frontmatter block with `status: draft` or `status: implementation_started`; the application owns this status and preserves it when revising a plan.
- Use read-only workspace tools to inspect files, search codebase patterns, and answer facts before asking the user.
</plan_tooling_instructions>
