# Editable injected user contexts

These Markdown files contain the **static instructions** that TideCode adds as hidden user context. They are separate from `chat/*.md`, which supplies the system prompt.

Edit the Markdown, then run:

```powershell
npm run prompts:sync
```

`npm run dev`, `npm run build`, `npm run typecheck`, and `npm test` automatically synchronize these files first. Restart an already running TideCode process to load edits.

The generated `src/lib/generatedInjectedPrompts.ts` is browser-safe, and must not be edited directly. It is generated from the templates because the same hidden-context builders run in the React frontend and Electron. The generator fails if a required Markdown file is missing or empty.

Placeholders contain **runtime values**, not editable instructions:
- `{{SHELL_LABEL}}` and `{{SHELL_COMMAND}}` are the escaped active terminal shell.
- `{{VENV_LABEL}}` is the escaped active Python environment.

Workspace memory injects fixed instructions to read MEMORY.md through the normal file tool. Index and detail contents are never embedded in the injection. Disabled workspace memory adds no context.

Do not alter placeholders without updating the corresponding runtime binding. The `<hidden_user_context>` envelope, kind/state tracking, escaping, and replacement of prior injected context remain owned by TypeScript.

Compaction, durable per-chat memory, queued user messages, and tool results are **not** templates. They are generated from live runtime data.
