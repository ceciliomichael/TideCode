# TideCode Code Mode

Code Mode executes a Tidecode-owned JavaScript-like orchestration language. It is not Node.js and model source never receives ambient host authority.

## Language

The language supports JSON-like values, variables, lexical scopes, objects, arrays, destructuring, spread/rest, template strings, the safe `String.raw` tagged-template form for raw multiline or escaped text, conditionals, switch, loops, functions, async functions, closures, `await`, `try`/`catch`/`finally`, `throw`, top-level `await`, top-level `return`, and selected Array/String/Object/Math/JSON/Promise helpers.

Other tagged templates are not supported.

The `tools` binding is injected. Every external effect must use a documented `tools.*` capability. Never import, require, redeclare, or initialize `tools`.

Workspace discovery APIs understand TideCode virtual paths. `@workspace/...` explicitly addresses the active workspace, `@attachments/...` addresses durable current-chat attachments, `@skills/<skill-name>/...` addresses enabled skill resources, and `@tool-output/...` addresses persisted truncated tool output backed by `~/.tidecode/tool-output`. Attachment, skill, and tool-output aliases are read-only; use read/list/glob/grep for them and copy content into `@workspace/...` before mutation. Relative workspace paths and policy-permitted full absolute paths continue to work.

The read-only payloads binding contains optional opaque text supplied beside the code program. Use payloads for arbitrary multiline Markdown, source code, patches, or other exact text that can contain quotes, backticks, or interpolation-like text. Reference it as payloads.<name> instead of embedding that text in a JavaScript string or template literal. Targeted patches still use direct apply_patch and complete-file writes use direct write.

When direct write or apply_patch is used for human-authored source, readability is required. Never pseudo-minify, compress, or line-pack code to save tokens. Preserve existing formatting when editing; for new source, use conventional formatting appropriate to the file type. Keep logical structure visually clear with normal indentation, line breaks, spacing, and grouping.

Imports, dynamic imports, require, classes, generators, eval, Function construction, Node/process globals, direct filesystem/network APIs, workers, WebAssembly, and prototype traversal are not part of the Code Mode language.

Await tool calls before reading their results. Use `Promise.all` or `Promise.allSettled` only for genuinely independent work; TideCode bounds host tool concurrency automatically.

Promise chaining methods such as `.then(...)`, `.catch(...)`, and `.finally(...)` are not Code Mode syntax. Use `await` with `try`/`catch`/`finally` instead.

Tool failures throw sanitized errors. Catch only failures you can meaningfully recover from; normal empty results such as an empty search are successful values.

Use `tools.$codemode.search({ query, namespace?, limit?, offset? })` to discover capabilities that are not already documented. Invoke only exact callable paths returned by search.

Connected MCP calls return their useful payload directly: JSON response bodies become arrays, objects, or primitives and non-JSON bodies remain strings. Do not access `.body` on a successful MCP result or parse its JSON yourself.

When a tool result is truncated, preserve its exact `output_path` and inspect that `@tool-output/...` path only as needed, preferably with `tools.grep` before a narrow `tools.read`. Do not guess the persisted filename or automatically load the whole saved output.

Return a concise JSON-compatible value that helps the next reasoning step. Terminal results expose `session_id`, `state`, `new_output`, `output_path`, and completed `exit_code` directly when available. Preserve a running command's `session_id` and continue it with `read_terminal`; do not poll by launching shell sleep/status commands.
