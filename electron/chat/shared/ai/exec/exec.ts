import { jsonSchema, tool } from 'ai'
import { formatExplicitCodeModeOutput, formatImplicitCodeModeToolResults } from '../../../../../src/lib/codeModeResultOutput'
import type { AgentToolExecutionResult } from '../../toolTypes'
import type { CodeModeExecutor } from '../../codeMode/executor'
import { getApiInstructions, getExecInstructions } from '../registry/documentation'

const EXEC_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: { type: 'string' },
  properties: {
    code: {
      type: 'string',
      minLength: 1,
      description: 'Must be valid JavaScript after JSON decoding. Any non-JavaScript syntax in the executable program will fail to parse before any tools run. Executed in an isolated V8 runtime, with host access through documented tools.* APIs. Pass literal multiline source and replacement text as payloads; string data can contain any language.',
    },
    payloads: {
      type: 'object',
      additionalProperties: { type: 'string' },
      maxProperties: 64,
      description: 'Exact opaque text, available as payloads.<key>. Use for literal multiline source, replacements, patches, and documents. Top-level string fields are merged into payloads; exact names win, with unique case/underscore/hyphen recovery. Nonreserved identifier keys are also available as bare bindings. Conflicts and ambiguous aliases reject. Preserve embedded backticks and ${...} as data instead of nesting them in code template literals.',
    },
  },
  required: ['code'],
} as const

interface ExecInput {
  [key: string]: unknown
  code: string
  payloads?: Record<string, string>
}

const MAX_NESTED_DISPLAY_BODY_CHARS = 64_000

function createExecToolDefinition() {
  return {
    description: buildExecDescription(),
    inputSchema: jsonSchema<ExecInput>(EXEC_INPUT_SCHEMA as unknown as Parameters<typeof jsonSchema>[0]),
  }
}

function displayReceipt(body: string | undefined) {
  if (typeof body !== 'string') return {}
  if (body.length <= MAX_NESTED_DISPLAY_BODY_CHARS) return { body }
  return {
    body: `${body.slice(0, MAX_NESTED_DISPLAY_BODY_CHARS)}\n\n[Display truncated; read the file in smaller ranges to view more.]`,
    body_omitted: true,
    body_bytes: Buffer.byteLength(body, 'utf8'),
  }
}

export function buildExecDescription() {
  const authority = 'The host enforces current workspace and mode permissions. Sandbox restricts paths; Full Access may broaden authorized paths. Neither mode enables imports, Node globals or ambient host authority.'
  const listing = getApiInstructions('available.list')
  const discovery = getApiInstructions('available.search')
  const getContract = getApiInstructions('available.get')
  return [
    getExecInstructions(),
    authority,
    'Start with tools.available.list({}) to discover authorized native and connected MCP namespaces. Namespaces are discovery categories, not callable prefixes: native_files tools use names like tools.list. List a namespace and retrieve an exact contract before calling it. Unfiltered search remains MCP-focused.',
    'tools.available.list({ namespace?: string, page?: number }): Promise<string> // Markdown: authorized native and MCP namespaces at root, exact tool names within a namespace',
    'tools.available.search({ query?: string, namespace?: string, limit?: number, offset?: number }): Promise<string> // Markdown names-only results with continuation',
    'tools.available.get({ name: string }): Promise<string> // Markdown contract with typed arguments',
    listing,
    discovery,
    getContract,
    'Before executing an API, retrieve its exact contract using tools.available.get. MCP names must be discovered through available.list or available.search first. Retrieved contracts are remembered for the lifetime of this chat runtime.',
  ].join('\n\n')
}

export function createExecToolSchema() {
  return tool(createExecToolDefinition())
}

export function createExecTool(
  executor: CodeModeExecutor,
) {
  return tool({
    ...createExecToolDefinition(),
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
      const payloads: Record<string, string> = Object.assign(Object.create(null), input.payloads)
      const recoveries: string[] = []
      for (const [name, value] of Object.entries(input)) {
        if (name === 'code' || name === 'payloads') {
          continue
        }
        if (typeof value !== 'string') {
          return { status: 'error', summary: 'Invalid exec payload value.', body: `Unexpected field "${name}" must be a string payload.` }
        }
        if (Object.hasOwn(payloads, name) && payloads[name] !== value) {
          return { status: 'error', summary: 'Conflicting exec payloads.', body: `Payload "${name}" has different values at the top level and inside payloads. No code was executed.` }
        }
        payloads[name] = value
        recoveries.push(`Recovered exec input: included top-level "${name}" in payloads.`)
      }
      const result = await executor.run(code, {
        abortSignal: executionOptions.abortSignal,
        payloads,
      })
      const output = result.status !== 'success'
        ? ''
        : result.output === undefined
          ? formatImplicitCodeModeToolResults(result.toolCalls)
          : formatExplicitCodeModeOutput(result.output)
      recoveries.push(...(result.recoveries ?? []))
      const body = [result.status === 'error' ? result.error ?? result.summary : result.summary, ...recoveries, output]
        .filter(Boolean).join('\n\n')
      return {
        body,
        status: result.status === 'success' ? 'success' : 'error',
        summary: result.summary,
        subject: { kind: 'code_mode', path: 'local' },
        semantics: {
          execution_id: result.executionId,
          engine: result.engine ?? 'v8',
          operation: 'exec',
          output_limited: result.outputTruncated ?? false,
          ...(recoveries.length ? { input_recoveries: recoveries } : {}),
          ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
          tool_call_count: result.toolCalls.length,
          tool_calls: result.toolCalls.map((call) => ({
            arguments: call.arguments,
            ...displayReceipt(call.body),
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
