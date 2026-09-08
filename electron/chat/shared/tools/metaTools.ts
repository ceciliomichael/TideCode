import { jsonSchema, tool } from 'ai'

import type { AppTerminalExecutionMode, ChatProviderId } from '../../../../src/types/chat'
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

const CODE_MODE_SOURCE_INPUT_SCHEMA = {
  additionalProperties: false,
  properties: {
    source: {
      description: 'Tidecode Code Mode source. Use the supported JavaScript-like orchestration language and tools.* capabilities only. Every tools.* call is asynchronous; await it before reading its result.',
      minLength: 1,
      type: 'string',
    },
    payloads: {
      additionalProperties: { type: 'string' },
      description: 'Optional opaque exact-text payloads available inside Code Mode through the read-only payloads global. Prefer this for multiline patches, Markdown/code fences, generated source, JSX, JSON, regex-heavy text, shell snippets, and other delimiter-heavy data.',
      maxProperties: 64,
      propertyNames: { maxLength: 128, minLength: 1 },
      type: 'object',
    },
  },
  required: ['source'],
  type: 'object',
} as const

const HIDDEN_PRELOADED_TOOL_NAMES = new Set(['plan_create', 'plan_edit'])

interface CodeModeSourceInput {
  payloads?: Record<string, string>
  source?: string
}

const CODE_MODE_TOOL_ROUTING = [
  'Provider boundary: the model-facing Tidecode tools are code_mode, apply_patch, and write in Agent Mode. Use direct apply_patch for targeted patches and direct write for complete-file creation/replacement. Every tools.* name below is a JavaScript API that exists only inside the code_mode source string; never emit tools.* as a provider tool name.',
  'Choose the purpose-built inner API for the scenario. Do not use terminal commands as a substitute for structured workspace APIs.',
  'Code Mode receives one structured outer input with `source` plus optional opaque `payloads`. Inside source, read payload text through `payloads.<name>` or bracket access. Payload text is inert data and is never parsed as Code Mode source.',
  'The APIs documented below are the stable Code Mode capability catalog, not permission for the current execution. Runtime policy can restrict this catalog. Treat the active runtime context and the actual tools object as authoritative. If an API is unavailable or forbidden, do not infer that it should exist, search for a replacement, or substitute another mutation path.',
  '- `tools.read`: inspect one known file or directory. A path is known only when the user supplied it or a prior workspace tool returned that exact path. Never infer filenames from conventions.',
  '- `tools.read_tool_output`: read only a narrowly targeted section when a truncated result omitted content you actually need; never call it automatically.',
  '- If the exact file path is unknown, discover it first with `tools.list`, `tools.glob`, or `tools.grep`, then use the returned path in `tools.read` or the patch file header.',
  '- `tools.list`: inspect immediate entries of one directory.',
  '- `tools.glob`: discover files by path or filename pattern.',
  '- `tools.grep`: search workspace text, symbols, imports, or references.',
  '- Direct model-facing `apply_patch`: prefer this for a standalone targeted patch; its structured patch-line array bypasses Code Mode source parsing entirely.',
  '- Direct model-facing `write`: create a new text file or intentionally replace a complete file. Its structured `{ path, content }` input bypasses Code Mode source parsing entirely; do not embed complete file contents in code_mode source.',
  '- `tools.execute_terminal`: run an actual command/process such as tests, typecheck, build, package manager, compiler, Git command, or app/script. Terminal results expose `session_id` directly, and completed commands expose `exit_code` directly. Never use shell, PowerShell, Python, or Node just to read, search, edit, or write workspace files when the structured APIs above apply.',
  '- `tools.read_terminal`: collect new output from an existing terminal session instead of starting the command again; it returns early when input is detected.',
  '- `tools.interact_terminal`: answer a prompt or send control/navigation keys to that same terminal session. For ordinary line input, send text with ENTER.',
  '- `tools.terminate_terminal`: stop a persistent terminal session started for the current work.',
  'Terminal interaction loop: execute once, read the same session, interact only when its output/state needs input, then continue reading that same session. Do not retry equivalent newline, CRLF, Enter, or Return variants unless fresh output shows the first normal interaction was not accepted.',
  '- `tools.memory`: read or maintain durable project/planning context, not project source.',
  '- `tools.kanban_board`: inspect or update Kanban task data when the request concerns cards, subtasks, status, or board planning. AI-completed main work stops at `for-review`, which completes direct subtasks. Never directly target `done`; only the user approves main tasks as Done. Set Owner per task: `Human` for user-originated work, `Agent` for work you introduce autonomously; do not blindly inherit parent ownership, and preserve explicit owner names.',
  '- `tools.$codemode.search`: discover capabilities that are not preloaded in this description. Use the exact callable path returned by search and never guess MCP/tool names.',
  'Any additional preloaded API should be used only for the capability described by its generated contract below.',
].join('\n')

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
    'Connected MCP APIs are discoverable inside Code Mode. Call tools.$codemode.search({ query, namespace: "mcp" }), then invoke an exact returned path such as tools.mcp.<name>(args). Do not guess MCP names.',
  ].join('\n')
}

export function buildCodeModeDescription(
  registry: AgentToolRegistry,
  executionMode: AppTerminalExecutionMode = 'sandbox',
) {
  return [
    buildCodeModeExecutionContract(executionMode),
    CODE_MODE_TOOL_ROUTING,
    buildPreloadedToolDocumentation(registry),
  ].join('\n')
}

export function normalizeCodeModeSourceInput(input: unknown): { payloads?: Record<string, string>; source: string } {
  if (typeof input === 'string') return { source: input }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { source: '' }
  const record = input as CodeModeSourceInput
  return {
    ...(record.payloads && typeof record.payloads === 'object' && !Array.isArray(record.payloads) ? { payloads: record.payloads } : {}),
    source: typeof record.source === 'string' ? record.source : '',
  }
}

async function executeCodeModeSource(
  executor: CodeModeExecutor,
  input: unknown,
  options: { abortSignal?: AbortSignal; allowedToolNames?: readonly string[] },
): Promise<AgentToolExecutionResult> {
  const normalized = normalizeCodeModeSourceInput(input)
  const source = normalized.source
  if (source.trim().length === 0) return createToolErrorResult('code_mode requires a non-empty JavaScript program.')

  const result = await executor.run(source, {
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
    inputSchema: jsonSchema<CodeModeSourceInput>(CODE_MODE_SOURCE_INPUT_SCHEMA),
    execute: async (input, executionOptions): Promise<AgentToolExecutionResult> =>
      executeCodeModeSource(executor, input, {
        abortSignal: executionOptions.abortSignal,
        allowedToolNames: options.allowedToolNames,
      }),
  })
}
