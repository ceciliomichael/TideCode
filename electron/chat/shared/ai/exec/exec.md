# TideCode exec

Execute JavaScript in a fresh, isolated V8 environment. Native JavaScript functions, classes, collections, regular expressions, built-ins, async/await, and Promise chaining are supported. The only injected host authority is the documented `tools.*` registry. The environment has no Node.js globals, module loader, raw filesystem, or network APIs.

Top-level await and return are supported. Use await or Promise.all/Promise.allSettled to order tool operations; ordinary JavaScript concurrency rules apply. Timers accept function callbacks and delays up to the execution deadline. Timers are cleared when execution ends. console.log/info/warn/error/debug are captured within the output limit and used when no explicit value is returned.

Return JSON-compatible data. Convert Map, Set, class instances, BigInt, and other non-JSON values explicitly before returning them or passing them to a tool. Execution has time, memory, tool-concurrency, tool-call, payload, and output limits. Each exec starts with fresh JavaScript state; retrieved tool contracts remain available across calls in the same chat runtime.

Await every tool call. Use `try/catch` for recoverable errors. Return concise JSON-compatible values; outputs are bounded. Parallelize only independent calls. Follow pagination and truncation instructions.

Start with `tools.available.list({})` to discover the currently authorized native and connected MCP namespaces. These are discovery categories, not callable API prefixes. Use `tools.available.list({ namespace: "native_files" })` only after discovering that namespace; invoke the exact tools shown there (for example `tools.list`, not `tools.native_files.list`). Obtain the full contract with `tools.available.get({ name: "tools.list" })` before calling it. Unfiltered search is MCP-focused; specify a namespace to search native tools. Each discovery page contains at most ten entries. Host authorization and permissions still apply.

For exact multiline code or patch payloads, use outer `exec.payloads` and reference `payloads.<key>` in the program.
