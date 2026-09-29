# Agent Tool Routing

## Provider boundary

The model-facing Tidecode tools are `code_mode`, `apply_patch`, and `write` in Agent Mode. Use direct `apply_patch` for targeted patches and direct `write` for complete-file creation or replacement.

Every `tools.*` name documented by Code Mode is a JavaScript API that exists only inside the `code_mode` program. Never emit `tools.*` as a provider tool name.

## Selection

Choose the purpose-built inner API for the scenario. Do not use terminal commands as a substitute for structured workspace APIs.

Code Mode receives one structured outer input with canonical `code` plus optional opaque `payloads`. Inside code, read payload text through `payloads.<name>` or bracket access. Payload text is inert data and is never parsed as Code Mode source.

Generated-call compatibility: unsupported argument properties are ignored instead of failing an otherwise valid tool call. Recognized arguments remain strict, and ignored properties do not gain behavior.

The APIs documented by the Code Mode description are a capability catalog, not permission for the current execution. Runtime policy can restrict this catalog. Treat the active runtime context and actual `tools` object as authoritative.

## Workspace inspection

- `tools.read`: inspect one known file or directory. A path is known only when the user supplied it or a prior workspace tool returned that exact path. Never infer filenames from conventions.
- `tools.read_tool_output`: read only a narrowly targeted section when a truncated result omitted content you actually need; never call it automatically.
- If the exact file path is unknown, discover it first with `tools.list`, `tools.glob`, or `tools.grep`, then use the returned path in `tools.read` or a patch file header.
- `tools.list`: inspect immediate entries of one directory.
- `tools.glob`: discover files by path or filename pattern.
- `tools.grep`: search workspace text, symbols, imports, or references.

## Mutations

- Direct model-facing `apply_patch`: prefer this for a standalone targeted patch; its raw patch string bypasses Code Mode source parsing entirely. Before patching an existing file, inspect the exact current source region used by each hunk. For multi-file patches, every hunk must have current exact source evidence; split out any uncertain file and read it first. After a context-mismatch rejection, re-read the affected region and rebuild the hunk instead of retrying the same stale anchor.
- A direct `apply_patch` call is atomic. Hunks are staged in order, including multiple hunks for the same path, but no file is committed unless every hunk in the patch validates.
- Direct model-facing `write`: create a new text file or intentionally replace a complete file. Do not embed complete file contents in Code Mode source.

## Terminal

- `tools.execute_terminal`: run an actual command/process such as tests, typecheck, build, package manager, compiler, Git command, or app/script.
- Never use shell, PowerShell, Python, or Node just to read, search, edit, or write workspace files when structured workspace APIs apply.
- `tools.read_terminal`: collect new output from an existing terminal session instead of starting the command again.
- `tools.interact_terminal`: answer a prompt or send control/navigation keys to that same terminal session. For ordinary line input, send text with ENTER.
- `tools.terminate_terminal`: stop a persistent terminal session started for the current work.
- Execute once, read the same session, interact only when fresh output/state needs input, then continue reading that same session.

## Other capabilities

- `tools.kanban_board`: inspect or update Kanban task data when the request concerns cards, subtasks, status, or board planning. AI-completed main work stops at `for-review`, which completes direct subtasks. Never directly target `done`; only the user approves main tasks as Done. Set Owner per task: `Human` for user-originated work, `Agent` for work you introduce autonomously; do not blindly inherit parent ownership, and preserve explicit owner names.
- `tools.$codemode.search`: discover capabilities that are not preloaded in the Code Mode description. Use the exact callable path returned by search and never guess MCP/tool names.

Any additional preloaded API should be used only for the capability described by its generated contract.
