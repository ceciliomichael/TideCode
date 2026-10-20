# TideCode exec

Execute a TideCode-owned restricted JavaScript-like program. The only injected host authority is the documented `tools.*` registry. This is not Node.js: no imports, process, require, raw filesystem or network APIs, or invented capabilities.

Await every tool call. Use `try/catch` for recoverable errors. Return concise JSON-compatible values; outputs are bounded. Parallelize only independent calls. Follow pagination and truncation instructions.

Native namespace information is provided by the current mode-specific hidden user context. Native callable API names do not include their namespace prefix. Use `tools.available.get({ name })` to retrieve a known exact native contract, or `tools.available.list({ namespace })` with an explicitly authorized native namespace to browse it. Native namespaces are omitted from unfiltered discovery. `tools.available.list()` lists connected MCP server namespaces only; `tools.available.search({ query })` searches MCP tools only. To search native tools, specify the current authorized native namespace. MCP tools require discovery before contract retrieval. Each discovery page contains at most ten entries. Always retrieve a tool's contract before executing it. Host authorization and permissions still apply.

For exact multiline code or patch payloads, use outer `exec.payloads` and reference `payloads.<key>` in the program.
