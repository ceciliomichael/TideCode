# TideCode exec

Execute a TideCode-owned, restricted JavaScript-like program. The only injected host authority is the exact documented `tools.*` registry. This is not Node.js; do not import modules, use process/require, access raw filesystem or network APIs, or invent capabilities.

Await every `tools.*` call. Use `try/catch` to recover from an expected failure, not `.catch()` on a tool promise. Return concise JSON-compatible values; tool outputs are bounded. Use independent concurrent calls only when there is no data or mutation dependency. Unsupported syntax and unknown APIs fail explicitly; inspect errors rather than guessing replacements.

Use `tools.available.search({query?,namespace?,limit?,offset?})` to discover an unfamiliar authorized native or connected MCP API and obtain its actual signature and documentation. Preloaded APIs have generated signatures in this tool description. Connected MCP APIs are discovered on demand as `tools.mcp.<name>(args)`; copy returned paths exactly. MCP success returns the decoded payload, not a normal native `ToolResult`.

Paths are workspace relative unless using an explicitly supported alias. `@workspace/...` is the bound workspace, `@attachments/...`, `@skills/...`, and `@tool-output/...` are read-only aliases. Never guess an unobserved child path; use list/glob/grep first. Inspect attachments before relying on their contents. Large results provide exact continuation or `@tool-output/...` paths: use those rather than restarting wide reads.

For exact source/Markdown/patch text containing backticks or quotes, supply `payloads` on the outer `exec` request and reference `payloads.<key>` within the program. Never minify human-authored code merely to save tokens. Before patching, read each exact source region; after a failure reread and rebuild. Terminal commands return a `session_id`; continue with `tools.terminal.read` or `tools.terminal.interact`, not a second execution of the same command. Plan Mode can create one plan and patch only the active plan, never source files.
