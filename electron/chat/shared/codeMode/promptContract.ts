import type { AppTerminalExecutionMode } from '../../../../src/types/chat'

/**
 * Model-facing contract for the Code Mode worker.
 */
const CODE_MODE_BASE_EXECUTION_CONTRACT = [
  'Code Mode runs one temporary asynchronous JavaScript program. Available host capabilities depend on the active execution and chat modes.',
  'Use ordinary JavaScript for control flow, calculation, parsing, filtering, shaping data, and, when Full Access is active in Agent Mode, normal Node.js runtime work.',
  '`tools` is already injected as a global Code Mode binding. Call `tools.read(...)`, `tools.list(...)`, and other documented APIs directly. Never import, require, redeclare, or initialize `tools`, and never look for a `tools.js` module.',
  'Await every `tools.*` call. If you need its data, assign it and return a concise JSON-compatible value; for an action-only call, await it before ending the program. Do not use a bare `tools.*` expression as the program result.',
  'For native asynchronous work in Full Access, await or return the Promise that represents completion. Detached callbacks or background work are not kept alive after the Code Mode program finishes.',
  'Terminal tool results expose `session_id` directly when a session exists and `exit_code` directly when a command has completed; use those direct fields instead of digging through semantics.',
  'If a needed capability is not preloaded, use `tools.tool_search` before attempting another mechanism.',
] as const

export function buildCodeModeExecutionContract(executionMode: AppTerminalExecutionMode = 'sandbox') {
  const modeContract = executionMode === 'full'
    ? [
        'Full Access is active for Agent Mode Code Mode. Normal Node.js host APIs, `require`, dynamic module imports, and standard top-level `import ...` declarations are available with the same host authority already granted to Full Access terminal execution.',
        'Module loading resolves relative to the selected workspace, so workspace-installed packages and relative modules are preferred over TideCode application dependencies.',
        'Prefer the documented `tools.*` workspace APIs when they directly fit the task because they provide structured results and safer edits, but direct runtime libraries are allowed when useful.',
      ]
    : [
        'Sandbox is active for Code Mode. Filesystem, operating-system, process, terminal, network, worker, memory, plan, and connected-service interaction must go through the documented `tools.*` APIs.',
        'Host globals such as `process`, `require`, `fs`, `child_process`, `http`, `https`, `net`, `fetch`, `Worker`, and code-generation APIs are blocked at runtime. Static and dynamic module loading are unavailable in sandbox mode.',
        'Blocked names are legal as ordinary local variable and property names. TideCode restricts actual host capability access rather than rejecting harmless identifiers.',
      ]
  return [...CODE_MODE_BASE_EXECUTION_CONTRACT, ...modeContract].join(' ')
}

export const CODE_MODE_EXECUTION_CONTRACT = buildCodeModeExecutionContract('sandbox')
