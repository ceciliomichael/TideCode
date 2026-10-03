import { jsonSchema, tool } from 'ai'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { AppTerminalExecutionMode, ChatProviderId } from '../../../../src/types/chat'
import { getTideCodeRuntimeRoot } from '../../../runtime/runtimeRoot'
import type { AgentToolExecutionResult } from '../toolTypes'
import { createToolErrorResult } from './toolResult'
import type { CodeModeExecutor } from '../codeMode/executor'
import { buildCodeModeExecutionContract } from '../codeMode/promptContract'
import {
  formatExplicitCodeModeOutput,
  formatImplicitCodeModeToolResults,
} from '../../../../src/lib/codeModeResultOutput'
import { isDynamicAgentTool, type AgentToolRegistry } from './registry'
import { createAgentToolCallableContract } from './callableContract'

const TOOL_ROUTING_PROMPT_REPO_PATH = 'electron/chat/shared/prompts/agent'
const TOOL_ROUTING_PROMPT_FILE_NAME = 'tool-routing.md'
const TOOL_ROUTING_PROMPT_FALLBACK = 'Use direct apply_patch for targeted existing-file changes and direct write for complete-file creation or replacement. Inspect exact current source before apply_patch. Keep human-authored source conventionally formatted and readable; never minify or line-pack code merely to save tokens unless the user explicitly requests it. Use code_mode for orchestration and tools.* capabilities only.'

let cachedToolRoutingPrompt: string | null = null

function getToolRoutingPrompt() {
  if (cachedToolRoutingPrompt !== null) return cachedToolRoutingPrompt
  let promptPath: string
  try {
    promptPath = path.join(getTideCodeRuntimeRoot(), TOOL_ROUTING_PROMPT_REPO_PATH, TOOL_ROUTING_PROMPT_FILE_NAME)
  } catch {
    promptPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../prompts/agent',
      TOOL_ROUTING_PROMPT_FILE_NAME,
    )
  }
  cachedToolRoutingPrompt = existsSync(promptPath)
    ? readFileSync(promptPath, 'utf8').trim()
    : TOOL_ROUTING_PROMPT_FALLBACK
  return cachedToolRoutingPrompt
}

const CODE_MODE_SOURCE_INPUT_SCHEMA = {
  additionalProperties: true,
  properties: {
    code: {
      description: 'Tidecode Code Mode program. Use the supported JavaScript-like orchestration language and tools.* capabilities only. Every tools.* call is asynchronous; await it before reading its result. Put arbitrary multiline Markdown/source text containing quotes or backticks in payloads and reference payloads.<name> rather than embedding it in a JavaScript template literal.',
      minLength: 1,
      type: 'string',
    },
    source: {
      description: 'Legacy alias for code. Prefer code for new calls. If both are provided they must be identical.',
      minLength: 1,
      type: 'string',
    },
    payloads: {
      additionalProperties: { type: 'string' },
      description: 'Optional opaque exact-text payloads available inside Code Mode through the read-only payloads global. Prefer payloads for arbitrary multiline Markdown, source code, or other text containing quotes/backticks, including plan_create/plan_edit content. Targeted patches use direct apply_patch and complete-file writes use direct write.',
      maxProperties: 64,
      propertyNames: { maxLength: 128, minLength: 1, type: 'string' },
      type: 'object',
    },
  },
  anyOf: [
    { required: ['code'] },
    { required: ['source'] },
  ],
  type: 'object',
} as const

const HIDDEN_PRELOADED_TOOL_NAMES = new Set(['plan_create', 'plan_edit'])

interface CodeModeSourceInput {
  code?: string
  payloads?: Record<string, string>
  source?: string
}

function buildPreloadedToolDocumentation(registry: AgentToolRegistry) {
  const contracts = registry.entries
    .filter((entry) => !isDynamicAgentTool(entry) && !HIDDEN_PRELOADED_TOOL_NAMES.has(entry.name))
    .map((entry) => createAgentToolCallableContract(entry))

  if (contracts.length === 0) {
    return 'No local tools are preloaded. Use tools.$codemode.search({ query }) inside Code Mode for available capabilities.'
  }

  return [
    'Path rule: every supplied path argument and every patch file header is one exact workspace-relative file or directory. For root-capable `read`, `list`, `glob`, and `grep` calls, an omitted path where the schema permits omission, an empty string, or `.` refers to the bound workspace root. Never invent filenames or index files, combine roots with spaces, or treat a path list as one path. If an exact child path has not been supplied by the user or returned by a prior workspace tool, discover it with list, glob, or grep before reading or patching it.',
    'Preloaded local APIs (call directly inside the program):',
    ...contracts.map((contract) => `- ${contract.signature} — ${contract.description}`),
    'Connected MCP APIs are discoverable inside Code Mode. Call tools.$codemode.search({ query, namespace: "mcp" }), then invoke an exact returned path such as tools.mcp.<name>(args). Do not guess MCP names. The returned value is the MCP payload itself: decoded JSON when possible, otherwise text.',
  ].join('\n')
}

export function buildCodeModeDescription(
  registry: AgentToolRegistry,
  executionMode: AppTerminalExecutionMode = 'sandbox',
) {
  return [
    buildCodeModeExecutionContract(executionMode),
    getToolRoutingPrompt(),
    buildPreloadedToolDocumentation(registry),
  ].join('\n')
}

export function normalizeCodeModeSourceInput(input: unknown): { code: string; payloads?: Record<string, string> } {
  if (typeof input === 'string') return { code: input }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { code: '' }
  const record = input as CodeModeSourceInput
  const code = typeof record.code === 'string' ? record.code : undefined
  const legacySource = typeof record.source === 'string' ? record.source : undefined
  if (code !== undefined && legacySource !== undefined && code !== legacySource) {
    return { code: '' }
  }
  return {
    ...(record.payloads && typeof record.payloads === 'object' && !Array.isArray(record.payloads) ? { payloads: record.payloads } : {}),
    code: code ?? legacySource ?? '',
  }
}

async function executeCodeModeSource(
  executor: CodeModeExecutor,
  input: unknown,
  options: { abortSignal?: AbortSignal; allowedToolNames?: readonly string[] },
): Promise<AgentToolExecutionResult> {
  const normalized = normalizeCodeModeSourceInput(input)
  const code = normalized.code
  if (code.trim().length === 0) {
    return createToolErrorResult('code_mode requires a non-empty "code" JavaScript-like program. Do not provide conflicting code/source values.')
  }

  const result = await executor.run(code, {
    abortSignal: options.abortSignal,
    allowedToolNames: options.allowedToolNames,
    payloads: normalized.payloads,
  })
  const outputBody = result.status !== 'success'
    ? ''
    : result.output === undefined
      ? formatImplicitCodeModeToolResults(result.toolCalls)
      : formatExplicitCodeModeOutput(result.output)
  const body = [
    result.status === 'error' ? result.error ?? result.summary : result.summary,
    outputBody.length > 0 ? outputBody : null,
  ].filter((value): value is string => value !== null).join('\n\n')

  return {
    body,
    semantics: {
      execution_id: result.executionId,
      engine: result.engine ?? 'v2',
      operation: 'code_mode',
      output_limited: result.outputTruncated ?? false,
      steps: result.steps ?? 0,
      ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
      tool_call_count: result.toolCalls.length,
      tool_calls: result.toolCalls.map((call) => ({
        arguments: call.arguments,
        // Keep semantics lightweight. The complete Code Mode output is already
        // represented by the top-level body/output formatting above. Persisting
        // every nested tool body here duplicates large reads/grep/terminal
        // results into chat history and causes context to balloon on each step.
        body: typeof call.body === 'string' && call.body.length > 2_000
          ? `${call.body.slice(0, 2_000)}\n\n[Nested tool body omitted from semantics.]`
          : call.body,
        ...(typeof call.body === 'string' && call.body.length > 2_000
          ? { body_omitted: true, body_bytes: Buffer.byteLength(call.body, 'utf8') }
          : {}),
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
}

export function createCodeModeTool(
  executor: CodeModeExecutor,
  registry: AgentToolRegistry,
  options: {
    allowedToolNames?: readonly string[]
    executionMode?: AppTerminalExecutionMode
    providerId?: ChatProviderId
  } = {},
) {
  const description = buildCodeModeDescription(registry, options.executionMode)
  return tool({
    description,
    inputSchema: jsonSchema<CodeModeSourceInput>(
      CODE_MODE_SOURCE_INPUT_SCHEMA as unknown as Parameters<typeof jsonSchema>[0],
    ),
    execute: async (input, executionOptions): Promise<AgentToolExecutionResult> =>
      executeCodeModeSource(executor, input, {
        abortSignal: executionOptions.abortSignal,
        allowedToolNames: options.allowedToolNames,
      }),
  })
}
