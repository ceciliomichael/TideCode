# TideCode exec

Execute JavaScript in a fresh, isolated V8 environment. Native JavaScript functions, classes, collections, regular expressions, built-ins, async/await, and Promise chaining are supported. The only injected host authority is the documented `tools.*` registry. The environment has no Node.js globals, module loader, raw filesystem, or network APIs.

The `code` field must parse as JavaScript after the outer JSON arguments are decoded. Any non-JavaScript syntax in the executable program will fail to parse before any tools run; exec does not translate other languages into JavaScript. Text passed as string data, including `payloads` values, can contain any language. Keep the distinction clear: `code` is executable JavaScript; file contents and replacement text are data.

When supplying literal multiline file contents, replacement text, patches, or documents, put the exact text in the outer `exec.payloads` object and reference `payloads.<key>` from `code`. Keep the executable program focused on orchestration and pass authored source as data. Do not wrap raw multiline source in JavaScript template literals or String.raw: backticks in the source can terminate the wrapper, and `${...}` expressions can interpolate at the wrong layer. Preserve the intended file text, including its own templates, quotes, backslashes, newlines, and indentation. This does not restrict generating or transforming content programmatically.

If a source-writing exec fails to parse, move its literal source into `exec.payloads` before retrying. Do not resubmit the same malformed wrapper or remove valid syntax from the destination file to make the wrapper parse.

Payload placement and references recover deterministically: extra top-level string fields are included in `payloads`; identical duplicate values are accepted and conflicting values reject before execution. Exact payload keys take precedence. When an exact key is absent, a unique match ignoring ASCII case, underscores, and hyphens is accepted (`payloads.patch_text` can read `patchText`). Multiple candidates or unrelated names reject. Keys that are ordinary nonreserved JavaScript identifiers are also available as exact bare bindings (`patchText`); local declarations still take precedence, and runtime globals and host-related names are never replaced. Recovery does not evaluate payload text, infer missing code, bypass tool validation, or change edit/patch source matching. Recovered references are noted in the execution receipt. Prefer exact explicit references when authoring a new call.

Complete edit example:
```json
{
  "code": "return await tools.edit({ changes: [{ path: 'src/example.ts', oldText: payloads.beforeText, newText: payloads.afterText }] });",
  "payloads": {
    "beforeText": "const offset = 6\n",
    "afterText": "const offset = 8\n"
  }
}
```

Complete patch example:
```json
{
  "code": "return await tools.patch({ patch: payloads.patchText });",
  "payloads": {
    "patchText": "*** Begin Patch\n*** Update File: src/example.ts\n@@\n-const offset = 6\n+const offset = 8\n*** End Patch"
  }
}
```
Obtain the exact tool contract first as required below. Both examples use payload strings as data; source backticks and `${...}` remain literal. Missing payload errors identify available keys; ambiguous errors require an exact key. Undefined values supplied inside tool arguments reject before serialization rather than silently disappearing; omit unused optional properties.

Top-level await and return are supported. Use await or Promise.all/Promise.allSettled to order tool operations; ordinary JavaScript concurrency rules apply. Timers accept function callbacks and delays up to the execution deadline. Timers are cleared when execution ends. console.log/info/warn/error/debug are captured within the output limit and used when no explicit value is returned.

Return JSON-compatible data. Convert Map, Set, class instances, BigInt, and other non-JSON values explicitly before returning them or passing them to a tool. Execution has time, memory, tool-concurrency, tool-call, payload, and output limits. Each exec starts with fresh JavaScript state; retrieved tool contracts remain available across calls in the same chat runtime.

Await every tool call. Use `try/catch` for recoverable errors. Return concise JSON-compatible values; outputs are bounded. Parallelize only independent calls. Follow pagination and truncation instructions.

Tool responses use a concise model-facing representation while the chat UI retains its detailed presentation. Small results remain complete. Large results can be projected into a head/tail preview with relevant error lines and a readable `@tool-output/tool_XXXXX.txt` reference. The archived result is the complete original text, not just the preview. Inspect it with `tools.grep` or paged `tools.read` only when the preview lacks information needed for the next action. Follow `next_offset` and `next_cursor` exactly; do not guess continuations. If no archive reference is present, do not assume omitted text was saved.

At the beginning of a conversation, use `tools.available.list({})` when the needed tools have not yet been discovered. Do not repeat namespace listings or `tools.available.get` for tools whose full contracts were already retrieved in this chat runtime. Obtained contracts remain usable for subsequent turns; retrieve a contract on first use, after an explicit change, or when the runtime requires it. If the runtime reports that a contract is needed, review the supplied contract and retry.  These are discovery categories, not callable API prefixes. Use `tools.available.list({ namespace: "native_files" })` only after discovering that namespace; invoke the exact tools shown there (for example `tools.list`, not `tools.native_files.list`). Obtain the full contract with `tools.available.get({ name: "tools.list" })` before calling it. Unfiltered search is MCP-focused; specify a namespace to search native tools. Each discovery page contains at most ten entries. Host authorization and permissions still apply.
