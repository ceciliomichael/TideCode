import { jsonSchema, tool } from 'ai'
import { formatExplicitCodeModeOutput, formatImplicitCodeModeToolResults } from '../../../../../src/lib/codeModeResultOutput'
import type { AgentToolExecutionResult } from '../../toolTypes'
import type { CodeModeExecutor } from '../../codeMode/executor'
import { isDynamicAgentTool, type AgentToolRegistry } from '../../tools/registry'
import { createAgentToolCallableContract } from '../../tools/callableContract'
import { getApiInstructions, getExecInstructions } from '../registry/documentation'

const EXEC_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: {
      type: 'string',
      minLength: 1,
      description: 'A TideCode restricted JavaScript-like program using only the documented tools.* APIs.',
    },
    payloads: {
      type: 'object',
      additionalProperties: { type: 'string' },
      maxProperties: 64,
      description: 'Exact opaque text, available in the program as payloads.<key>. Use for raw patches and multiline source.',
    },
  },
  required: ['code'],
} as const

interface ExecInput {
  code: string
  payloads?: Record<string, string>
}

export function buildExecDescription(registry: AgentToolRegistry) {
  const authority = 'The host enforces current workspace and mode permissions. Sandbox restricts paths; Full Access may broaden authorized paths. Neither mode enables imports, Node globals or ambient host authority.'
  const docs = registry.entries
    .filter((entry) => !isDynamicAgentTool(entry))
    .map((entry) => createAgentToolCallableContract(entry))
  const discovery = getApiInstructions('available.search')
  return [
    getExecInstructions(),
    authority,
    'Authorized internal APIs (call only inside this exec program):',
    ...docs.map((entry) => `- ${entry.signature}: ${entry.description}`),
    'tools.available.search({ query?: string, namespace?: string, limit?: number, offset?: number }): Promise<SearchResults>',
    discovery,
    'Connected MCP APIs are discovered through tools.available.search({ namespace: "mcp", query: "..." }). Execute only exact returned tools.mcp.<name> paths.',
  ].join('\n\n')
}

export function createExecTool(
  executor: CodeModeExecutor,
  registry: AgentToolRegistry,
) {
  return tool({
    description: buildExecDescription(registry),
    inputSchema: jsonSchema<ExecInput>(EXEC_INPUT_SCHEMA as unknown as Parameters<typeof jsonSchema>[0]),
    execute: async (input, executionOptions): Promise<AgentToolExecutionResult> => {
      const code = input.code
      if (typeof code !== 'string' || code.trim().length === 0) {
        return { status: 'error', summary: 'exec requires a nonempty code program.', body: 'Supply code as a string.' }
      }
      if (input.payloads !== undefined) {
        if (input.payloads === null || typeof input.payloads !== 'object' || Array.isArray(input.payloads)) {
          return { status: 'error', summary: 'Invalid exec payloads.', body: 'payloads must be an object of string values.' }
        }
        const names = Object.keys(input.payloads)
        if (names.length > 64 || names.some((name) => name.length < 1 || name.length > 128)) {
          return { status: 'error', summary: 'Invalid exec payload names.', body: 'Provide at most 64 payloads, with each key between 1 and 128 characters.' }
        }
        if (names.some((name) => typeof input.payloads?.[name] !== 'string')) {
          return { status: 'error', summary: 'Invalid exec payload values.', body: 'Every payload value must be a string.' }
        }
      }
      const result = await executor.run(code, {
        abortSignal: executionOptions.abortSignal,
        payloads: input.payloads,
      })
      const output = result.status !== 'success'
        ? ''
        : result.output === undefined
          ? formatImplicitCodeModeToolResults(result.toolCalls)
          : formatExplicitCodeModeOutput(result.output)
      const body = [result.status === 'error' ? result.error ?? result.summary : result.summary, output]
        .filter(Boolean).join('\n\n')
      return {
        body,
        status: result.status === 'success' ? 'success' : 'error',
        summary: result.summary,
        subject: { kind: 'code_mode', path: 'local' },
        semantics: {
          execution_id: result.executionId,
          engine: result.engine ?? 'v2',
          operation: 'exec',
          output_limited: result.outputTruncated ?? false,
          steps: result.steps ?? 0,
          ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
          tool_call_count: result.toolCalls.length,
          tool_calls: result.toolCalls.map((call) => ({
            arguments: call.arguments,
            ...(typeof call.body === 'string' && call.body.length <= 2000 ? { body: call.body } : {}),
            ...(typeof call.body === 'string' && call.body.length > 2000
              ? { body_omitted: true, body_bytes: Buffer.byteLength(call.body, 'utf8') } : {}),
            duration_ms: call.durationMs,
            name: call.name,
            ...(call.resultPresentation ? { result_presentation: call.resultPresentation } : {}),
            ...(call.semantics ? { semantics: call.semantics } : {}),
            status: call.status,
            ...(call.subject ? { subject: call.subject } : {}),
            summary: call.summary,
          })),
        },
      }
    },
  })
}
