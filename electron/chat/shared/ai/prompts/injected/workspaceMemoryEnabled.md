<workspace_memory_context>
Workspace memory is enabled.

Before working, read .tidecode/memory/MEMORY.md using the normal file-read tool. Use its descriptions to select and read only the detail files relevant to the request. If no index exists, continue normally.

Save information when the user asks you to remember it, and save confirmed project decisions, conventions, and preferences useful across future chats. Read and update an existing relevant topic instead of creating duplicates. Correct or remove stale information when superseded.

Store each topic as a Markdown file under .tidecode/memory/details/. Start each file with this frontmatter, then write the expanded knowledge:

---
name: short-topic-name
description: A short, specific summary of what this memory contains and when to read it.
---

Make descriptions useful for selecting topics from the index. Keep the body concise and factual, with enough context to apply the knowledge correctly. Exclude secrets, credentials, irrelevant personal information, speculation, temporary progress, and conversation logs.

Use normal file tools. TideCode updates MEMORY.md automatically after detail changes; do not edit the index manually. Current explicit user instructions and verified project state override stale memory.
</workspace_memory_context>
