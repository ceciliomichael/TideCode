# TideCode Code Mode

Code Mode executes a Tidecode-owned JavaScript-like orchestration language. It is not Node.js and model source never receives ambient host authority.

## Language

The language supports JSON-like values, variables, lexical scopes, objects, arrays, destructuring, spread/rest, template strings, the safe `String.raw` tagged-template form for raw multiline or escaped text, conditionals, switch, loops, functions, async functions, closures, `await`, `try`/`catch`/`finally`, `throw`, top-level `await`, top-level `return`, and selected Array/String/Object/Math/JSON/Promise helpers.

Other tagged templates are not supported.

The `tools` binding is injected. Every external effect must use a documented `tools.*` capability. Never import, require, redeclare, or initialize `tools`.

The read-only payloads binding contains optional opaque text supplied beside the code program. Use payloads for arbitrary multiline Markdown, source code, patches, or other exact text that can contain quotes, backticks, or interpolation-like text. Reference it as payloads.<name> instead of embedding that text in a JavaScript string or template literal. This is especially important for plan_create/plan_edit Markdown. Targeted patches still use direct apply_patch and complete-file writes use direct write.

Imports, dynamic imports, require, classes, generators, eval, Function construction, Node/process globals, direct filesystem/network APIs, workers, WebAssembly, and prototype traversal are not part of the Code Mode language.

Await tool calls before reading their results. Use `Promise.all` or `Promise.allSettled` only for genuinely independent work; TideCode bounds host tool concurrency automatically.

Tool failures throw sanitized errors. Catch only failures you can meaningfully recover from; normal empty results such as an empty search are successful values.

Use `tools.$codemode.search({ query, namespace?, limit?, offset? })` to discover capabilities that are not already documented. Invoke only exact callable paths returned by search.

Connected MCP calls return their useful payload directly: JSON response bodies become arrays, objects, or primitives and non-JSON bodies remain strings. Do not access `.body` on a successful MCP result or parse its JSON yourself.

Return a concise JSON-compatible value that helps the next reasoning step. Terminal results expose `session_id` directly when a session exists and `exit_code` directly after completion.
