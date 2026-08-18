/**
 * Model-facing contract for the Code Mode worker.
 */
export const CODE_MODE_EXECUTION_CONTRACT = [
  'Code Mode is a temporary asynchronous JavaScript program running in a tool-only worker.',
  'Use ordinary JavaScript only for control flow, calculation, parsing, filtering, and shaping returned data.',
  'All interaction with files, the operating system, processes, terminals, networks, workers, memory, plans, or connected services must go through the documented `tools.*` APIs.',
  'Unavailable host/runtime APIs in Code Mode include `global`, `process`, `require`, `module`, `fs` / `node:fs`, `child_process` / `node:child_process`, `http`, `https`, `net`, `fetch`, `Worker`, `worker_threads`, `Buffer`, `WebAssembly`, `Electron`, `Bun`, `Deno`, `eval`, and `Function`.',
  'Node modules such as `node:path` and `node:os` are also unavailable because `require` and dynamic `import()` are blocked. Use the documented `tools.*` APIs instead.',
  'Direct blocked runtime access is rejected before execution, so no `tools.*` call runs first. Restriction scanning ignores non-executable string, comment, regex, and template-literal text, so source code passed as tool data may mention unavailable API names.',
  'Await every `tools.*` call. If you need its data, assign it and return a concise JSON-compatible value; for an action-only call, await it before ending the program. Do not use a bare `tools.*` expression as the program result.',
  'Terminal tool results that identify a session expose `session_id` directly; use `result.session_id` for follow-up terminal calls.',
  'If a needed capability is not preloaded, use `tools.tool_search` before attempting another mechanism.',
].join(' ')
