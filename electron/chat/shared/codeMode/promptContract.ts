import type { AppTerminalExecutionMode } from '../../../../src/types/chat'

const CODE_MODE_LANGUAGE_CONTRACT = [
  'Code Mode executes a Tidecode-owned JavaScript-like orchestration language. It is not Node.js and model source never receives ambient host authority.',
  'The language supports JSON-like values, variables, lexical scopes, objects, arrays, destructuring, spread/rest, template strings, conditionals, switch, loops, functions, async functions, closures, await, try/catch/finally, throw, top-level await, top-level return, and selected Array/String/Object/Math/JSON/Promise helpers.',
  'The `tools` binding is injected. Every external effect must use a documented `tools.*` capability. Never import, require, redeclare, or initialize `tools`.',
  'Imports, dynamic imports, require, classes, generators, eval, Function construction, Node/process globals, direct filesystem/network APIs, workers, WebAssembly, and prototype traversal are not part of the Code Mode language.',
  'Await tool calls before reading their results. Use Promise.all or Promise.allSettled only for genuinely independent work; Tidecode bounds host tool concurrency automatically.',
  'Tool failures throw sanitized errors. Catch only failures you can meaningfully recover from; normal empty results such as an empty search are successful values.',
  'Use `tools.$codemode.search({ query, namespace?, limit?, offset? })` to discover capabilities that are not already documented. Invoke only exact callable paths returned by search.',
  'Return a concise JSON-compatible value that helps the next reasoning step. Terminal results expose session_id directly when a session exists and exit_code directly after completion.',
] as const

export function buildCodeModeExecutionContract(executionMode: AppTerminalExecutionMode = 'sandbox') {
  const authority = executionMode === 'full'
    ? 'Full Access may broaden which tools.* capabilities the host authorizes, but it does not change Code Mode language semantics or enable direct Node.js/module access.'
    : 'Sandbox keeps host authority restricted to the tools.* capabilities authorized for the current chat and workspace.'
  return [...CODE_MODE_LANGUAGE_CONTRACT, authority].join(' ')
}

export const CODE_MODE_EXECUTION_CONTRACT = buildCodeModeExecutionContract('sandbox')
