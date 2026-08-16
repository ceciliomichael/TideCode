import { jsonSchema, tool } from 'ai'

import type { AgentToolExecutionResult } from '../toolTypes'
import { createSuccessResult } from './workspaceToolResults'
import { createToolErrorResult } from './toolResult'
import type { CodeModeExecutor } from '../codeMode/executor'
import { CODE_MODE_EXECUTION_CONTRACT } from '../codeMode/promptContract'
import { formatImplicitCodeModeToolResults } from '../../../../src/lib/codeModeResultOutput'
import { isDynamicAgentTool, type AgentToolRegistry } from './registry'
import { createAgentToolCallableContract } from './callableContract'

const TOOL_SEARCH_INPUT_SCHEMA = {
  additionalProperties: false,
  properties: {
    limit: {
      default: 10,
      description: 'Maximum number of matching tools to return (1-20).',
      maximum: 20,
      minimum: 1,
      type: 'integer',
    },
    namespace: {
      description: 'Optional namespace filter such as filesystem, shell, git, mcp, or skills.',
      type: 'string',
    },
    query: {
      description: 'Natural-language description of the operation you need.',
      minLength: 1,
      type: 'string',
    },
  },
  required: ['query'],
  type: 'object',
} as const

const CODE_MODE_INPUT_SCHEMA = {
  additionalProperties: false,
  properties: {
    code: {
      description: 'Temporary tool-only async JavaScript. Every tools.* function returns Promise<ToolResult>; always await calls before reading or returning them. Use ordinary JavaScript only for in-memory orchestration and return concise JSON-compatible data.',
      minLength: 1,
      type: 'string',
    },
  },
  required: ['code'],
  type: 'object',
} as const

const MAX_TOOL_SEARCH_RESULT_BYTES = 32_000

interface ToolSearchInput {
  limit?: number
  namespace?: string
  query?: string
}

interface CodeModeInput {
  code?: string
}

function stringifyOutput(value: unknown) {
  if (value === undefined) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value, null, 2) ?? ''
  } catch {
    return String(value)
  }
}

function buildBoundedToolSearchResult(
  query: string,
  matches: ReturnType<AgentToolRegistry['search']>,
) {
  const toModelTool = (match: ReturnType<AgentToolRegistry['search']>[number]) => createAgentToolCallableContract({
    description: match.description,
    inputSchema: match.inputSchema,
    name: match.name,
    namespace: match.namespace,
  })

  const boundedMatches = []
  for (const match of matches) {
    const candidateMatches = [...boundedMatches, match]
    const candidate = {
      query,
      tools: candidateMatches.map(toModelTool),
    }
    if (Buffer.byteLength(stringifyOutput(candidate), 'utf8') > MAX_TOOL_SEARCH_RESULT_BYTES) break
    boundedMatches.push(match)
  }

  return {
    query,
    tools: boundedMatches.map(toModelTool),
  }
}

export function createToolSearchTool(registry: AgentToolRegistry, options: { dynamicOnly?: boolean } = {}) {
  const dynamicOnly = options.dynamicOnly === true
  return tool({
    description: dynamicOnly
      ? 'Find connected MCP tools available to Code Mode. Returns compact tools.<name>({ ... }) signatures. Local tools are preloaded in code_mode.'
      : 'Find tools available to Code Mode. Returns compact tools.<name>({ ... }) signatures without raw JSON schemas.',
    inputSchema: jsonSchema<ToolSearchInput>(TOOL_SEARCH_INPUT_SCHEMA),
    execute: async (input): Promise<AgentToolExecutionResult> => {
      const query = typeof input.query === 'string' ? input.query.trim() : ''
      if (query.length === 0) return createToolErrorResult('tool_search requires a non-empty query.')

      const matches = registry.search(query, dynamicOnly ? 'mcp' : input.namespace, input.limit ?? 10)
      const result = buildBoundedToolSearchResult(query, matches)
      return createSuccessResult({
        body: stringifyOutput(result),
        semantics: {
          match_count: matches.length,
          operation: 'tool_search',
          query,
        },
        subject: { kind: 'tool_search', path: query },
        summary: `Found ${matches.length} connected tool${matches.length === 1 ? '' : 's'} for ${query}.`,
      })
    },
  })
}

function buildPreloadedToolDocumentation(registry: AgentToolRegistry) {
  const contracts = registry.entries
    .filter((entry) => !isDynamicAgentTool(entry))
    .map((entry) => createAgentToolCallableContract(entry))

  if (contracts.length === 0) {
    return 'No local tools are preloaded. Use tools.tool_search({ query }) inside Code Mode for dynamic capabilities.'
  }

  return [
    'Path rule: every supplied path argument is one exact workspace-relative file or directory. For root-capable `read`, `list`, `glob`, and `grep` calls, an omitted path where the schema permits omission, an empty string, or `.` refers to the bound workspace root. Never invent an index file, combine roots with spaces, or treat a path list as one path.',
    'Preloaded local APIs (call directly inside the program):',
    ...contracts.map((contract) => `- ${contract.signature} — ${contract.description}`),
    'Connected MCP APIs are dynamic. Inside the same program, call tools.tool_search({ query }), then invoke an exact returned tools.<name>(args) function. Do not guess MCP names.',
  ].join('\n')
}

export function createCodeModeTool(
  executor: CodeModeExecutor,
  registry: AgentToolRegistry,
) {
  const runtimePolicy = "Tool-only runtime: direct Node.js and host access is blocked. Use tools.* for every filesystem, terminal, process, network, memory, plan, mutation, or connected-service action. Ordinary JavaScript remains available for in-memory computation and orchestration. Structured tools apply the app's sandbox/full execution policy themselves."

  return tool({
    description: [
      CODE_MODE_EXECUTION_CONTRACT,
      runtimePolicy,
      'Run a temporary local JavaScript orchestration program. Write simple sequential calls, await each call, and return a concise JSON-compatible result. For source mutations, call tools.edit({ path, edits }); use one path per call and complete targetContent/replacementContent hunks. startLine/endLine are optional: when omitted, matching searches the entire file. replaceAll: true replaces every match in the file or range; leave it false for one intended match. Use source text only in targetContent; never include read metadata or the EOF footer. When using backticks in Code Mode, escape literal template expressions as \\${var} or use single quotes.',
      buildPreloadedToolDocumentation(registry),
    ].join('\n'),
    inputSchema: jsonSchema<CodeModeInput>(CODE_MODE_INPUT_SCHEMA),
    execute: async (input, options): Promise<AgentToolExecutionResult> => {
      const code = typeof input.code === 'string' ? input.code : ''
      if (code.trim().length === 0) return createToolErrorResult('code_mode requires a non-empty JavaScript program.')

      const result = await executor.run(code, {
        abortSignal: options.abortSignal,
      })
      const outputBody = result.output === undefined
        ? formatImplicitCodeModeToolResults(result.toolCalls)
        : stringifyOutput(result.output)
      const body = [
        result.status === 'error' ? result.error ?? result.summary : result.summary,
        outputBody.length > 0 ? outputBody : null,
      ].filter((value): value is string => value !== null).join('\n\n')

      return {
        body,
        semantics: {
          execution_id: result.executionId,
          operation: 'code_mode',
          output_limited: result.outputTruncated ?? false,
          tool_call_count: result.toolCalls.length,
          tool_calls: result.toolCalls.map((call) => ({
            arguments: call.arguments,
            body: call.body,
            duration_ms: call.durationMs,
            name: call.name,
            ...(call.resultPresentation ? { result_presentation: call.resultPresentation } : {}),
            ...(call.semantics ? { semantics: call.semantics } : {}),
            status: call.status,
            ...(call.subject ? { subject: call.subject } : {}),
            summary: call.summary,
          })),
        },
        status: result.status === 'success' ? 'success' : 'error',
        subject: { kind: 'code_mode', path: 'local' },
        summary: result.summary,
      }
    },
  })
}
