<workspace_memory_context state="enabled_until_superseded">
Workspace memory is enabled and active for this workspace.
Use and maintain workspace memory whenever confirmed information should carry across future chats in this workspace, even if no memory files exist yet.
Memory layout:
- .tidecode/memory/MEMORY.md is the compact index.
- .tidecode/memory/details/*.md contains focused detailed memory entries. Nested topic folders under details are allowed when useful.
MEMORY.md format rules:
- Keep it short and use Markdown links to detail files instead of copying full detail content into the index.
- Prefer one index line per topic in the form: `- [Topic](details/topic.md) - Short description.`
- When saving the first memory, create the relevant detail file and create MEMORY.md with its first index link.
Detail-file rules:
- Keep each file focused on one durable topic such as architecture, workflow, testing, preferences, or another clearly named project concern.
- Update an existing relevant detail file instead of creating duplicate memories for the same topic.
- Preserve useful confirmed facts, decisions, conventions, and preferences that should carry into future chats.
- Update or remove stale information when newer explicit instructions or verified workspace state supersede it.
- Do not save transient conversation wording, speculative claims, temporary debugging noise, secrets, credentials, or irrelevant personal information.
Use this context when relevant. Newer explicit user instructions and verified workspace state override stale memory.
Read only the linked detail file or files that are relevant to the current work instead of loading the whole details directory.
Use normal workspace file tools to create or update memory files and keep MEMORY.md links consistent; there is no dedicated memory tool.

{{MEMORY_INDEX}}
</workspace_memory_context>
