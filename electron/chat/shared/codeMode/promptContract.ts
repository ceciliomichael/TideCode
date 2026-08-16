/**
 * Model-facing contract for the Code Mode worker.
 */
export const CODE_MODE_EXECUTION_CONTRACT = [
  'Code Mode is a temporary asynchronous JavaScript program running in a tool-only worker.',
  'Use ordinary JavaScript only for control flow, calculation, parsing, filtering, and shaping returned data.',
  'All interaction with files, the operating system, processes, terminals, networks, workers, memory, plans, or connected services must go through the documented `tools.*` APIs.',
  'Do not use Node.js runtime APIs or host globals such as process, require, fs, child_process, fetch, networking modules, Worker, Buffer, dynamic import, eval, or Function. These are blocked in Code Mode.',
  'Await every `tools.*` call. If you need its data, assign it and return a concise JSON-compatible value; for an action-only call, await it before ending the program. Do not use a bare `tools.*` expression as the program result.',
  'If a needed capability is not preloaded, use `tools.tool_search` before attempting another mechanism.',
].join(' ')
