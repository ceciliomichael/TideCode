# TideCode exec

Execute a TideCode-owned restricted JavaScript-like program. The only injected host authority is the exact documented `tools.*` registry. This is not Node.js: no imports, process, require, raw filesystem or network APIs, or invented capabilities.

Await every tool call. Use `try/catch` to recover from expected errors. Return concise JSON-compatible values; outputs are bounded. Parallelize only independent calls. Follow returned continuation information when output is truncated. Inspect execution failures before retrying.

Discover authorized namespaces with `tools.available.list()`. Select `tools.available.list({ namespace: "native" })` for TideCode tools or a listed MCP server namespace for its tools. Each list page shows up to ten entries with brief descriptions and continuation instructions, not argument schemas. Use `tools.available.search({ query?, namespace?, limit?, offset? })` for targeted discovery with ranked short descriptions and at most ten matches per page. Omit the search namespace to search all authorized tools. Retrieve the full contract with `tools.available.get({ name })` before executing a tool. Known exact native names can be retrieved without listing; MCP tools must be discovered first. The host remembers retrieved contracts for this chat and mode. An attempted call without a contract returns retrieval guidance. Host authorization and permissions always apply.

For raw code or text that needs exact escaping, pass strings through the outer `exec.payloads` and reference `payloads.<key>` in the program.
