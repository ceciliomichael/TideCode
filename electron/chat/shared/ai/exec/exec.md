# TideCode exec

Execute a TideCode-owned restricted JavaScript-like program. The only injected host authority is the documented `tools.*` registry. This is not Node.js: no imports, process, require, raw filesystem or network APIs, or invented capabilities.

Await every tool call. Use `try/catch` for recoverable errors. Return concise JSON-compatible values; outputs are bounded. Parallelize only independent calls. Follow pagination and truncation instructions.

Start with `tools.available.list({})` to discover the currently authorized native and connected MCP namespaces. These are discovery categories, not callable API prefixes. Use `tools.available.list({ namespace: "native_files" })` only after discovering that namespace; invoke the exact tools shown there (for example `tools.list`, not `tools.native_files.list`). Obtain the full contract with `tools.available.get({ name: "tools.list" })` before calling it. Unfiltered search is MCP-focused; specify a namespace to search native tools. Each discovery page contains at most ten entries. Host authorization and permissions still apply.

For exact multiline code or patch payloads, use outer `exec.payloads` and reference `payloads.<key>` in the program.
