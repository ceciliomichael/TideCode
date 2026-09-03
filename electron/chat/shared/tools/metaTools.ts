import { openai } from '@ai-sdk/openai'
import { jsonSchema, tool } from 'ai'

import type { ChatProviderId } from '../../../../src/types/chat'
import type { AgentToolExecutionResult } from '../toolTypes'
import { createSuccessResult } from './workspaceToolResults'
import { createToolErrorResult } from './toolResult'
import type { CodeModeExecutor } from '../codeMode/executor'
import { CODE_MODE_EXECUTION_CONTRACT } from '../codeMode/promptContract'
import {
  formatExplicitCodeModeOutput,
  formatImplicitCodeModeToolResults,
} from '../../../../src/lib/codeModeResultOutput'
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

const CODE_MODE_SOURCE_INPUT_SCHEMA = {
  additionalProperties: false,
  properties: {
    source: {
      description: 'Temporary tool-only async JavaScript source. Every tools.* function returns Promise<ToolResult>; always await calls before reading or returning them.',
      minLength: 1,
      type: 'string',
    },
  },
  required: ['source'],
  type: 'object',
} as const

const CODE_MODE_FREEFORM_GRAMMAR = String.raw`
start: pragma_source | plain_source
pragma_source: PRAGMA_LINE NEWLINE SOURCE
plain_source: SOURCE

PRAGMA_LINE: /[ \t]*\/\/ @exec:[^\r\n]*/
NEWLINE: /\r?\n/
SOURCE: /[\s\S]+/
`

const MAX_TOOL_SEARCH_RESULT_BYTES = 32_000
const HIDDEN_PRELOADED_TOOL_NAMES = new Set(['plan_create', 'plan_edit'])

interface ToolSearchInput {
  limit?: number
  namespace?: string
  query?: string
}

interface CodeModeSourceInput {
  source?: string
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
    if (Buffer.byteLength(formatExplicitCodeModeOutput(candidate), 'utf8') > MAX_TOOL_SEARCH_RESULT_BYTES) break
    boundedMatches.push(match)
  }

  return {
    query,
    tools: boundedMatches.map(toModelTool),
  }
}

export function createToolSearchTool(
  registry: AgentToolRegistry,
  options: { dynamicOnly?: boolean; onDemandToolNames?: readonly string[] } = {},
) {
  const dynamicOnly = options.dynamicOnly === true
  const onDemandToolNames = new Set(options.onDemandToolNames ?? [])
  return tool({
    description: dynamicOnly
      ? 'Find connected or on-demand tools available to Code Mode. Returns compact tools.<name>({ ... }) signatures. Documented local tools are preloaded in code_mode.'
      : 'Find tools available to Code Mode. Returns compact tools.<name>({ ... }) signatures without raw JSON schemas.',
    inputSchema: jsonSchema<ToolSearchInput>(TOOL_SEARCH_INPUT_SCHEMA),
    execute: async (input): Promise<AgentToolExecutionResult> => {
      const query = typeof input.query === 'string' ? input.query.trim() : ''
      if (query.length === 0) return createToolErrorResult('tool_search requires a non-empty query.')

      const limit = input.limit ?? 10
      const normalizedNamespace = typeof input.namespace === 'string' ? input.namespace.trim().toLowerCase() : ''
      const matches = dynamicOnly
        ? registry.search(query, undefined, 20)
          .filter((match) => match.namespace === 'mcp' || onDemandToolNames.has(match.name))
          .filter((match) => normalizedNamespace.length === 0 || match.namespace === normalizedNamespace)
          .slice(0, limit)
        : registry.search(query, input.namespace, limit)
      const result = buildBoundedToolSearchResult(query, matches)
      return createSuccessResult({
        body: formatExplicitCodeModeOutput(result),
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

const CODE_MODE_TOOL_ROUTING = [
  'Provider boundary: invoke the model-facing code_mode tool. Every tools.* name below is a JavaScript API that exists only inside the code_mode code string; never emit tools.* as a provider tool name.',
  'Choose the purpose-built inner API for the scenario. Do not use terminal commands as a substitute for structured workspace APIs.',
  'Code Mode receives one JavaScript source program. Do not create a separate payloads object or emit nested provider tool calls.',
  'The APIs documented below are the stable Code Mode capability catalog, not permission for the current execution. Runtime policy can restrict this catalog. Treat the active runtime context and the actual tools object as authoritative. If an API is unavailable or forbidden, do not infer that it should exist, search for a replacement, or substitute another mutation path.',
  '- `tools.read`: inspect one known file or directory. A path is known only when the user supplied it or a prior workspace tool returned that exact path. Never infer filenames from conventions.',
  '- `tools.read_tool_output`: read only a narrowly targeted section when a truncated result omitted content you actually need; never call it automatically.',
  '- If the exact file path is unknown, discover it first with `tools.list`, `tools.glob`, or `tools.grep`, then use the returned path in `tools.read` or the patch file header.',
  '- `tools.list`: inspect immediate entries of one directory.',
  '- `tools.glob`: discover files by path or filename pattern.',
  '- `tools.grep`: search workspace text, symbols, imports, or references.',
  '- `tools.apply_patch`: primary API for targeted source changes. Pass one raw Codex-style patch string directly. Complete patch templates are literal patch data, so nested backticks, ${...}, \\n-style source text, regex escapes, JSX/TSX quotes, and Windows paths do not need double escaping. If a generated anchor still contains one redundant escaping layer, TideCode repairs it only when there is one unique non-overlapping source match. Use fresh source context and include multiple files in one patch when useful; TideCode verifies the full patch before writing.',
  '- `tools.write`: create a new text file or intentionally replace a complete file; use apply_patch for targeted existing-file changes.',
  '- `tools.execute_terminal`: run an actual command/process such as tests, typecheck, build, package manager, compiler, Git command, or app/script. Terminal results expose `session_id` directly, and completed commands expose `exit_code` directly. Never use shell, PowerShell, Python, or Node just to read, search, edit, or write workspace files when the structured APIs above apply.',
  '- `tools.read_terminal`: collect new output from an existing terminal session instead of starting the command again; it returns early when input is detected.',
  '- `tools.interact_terminal`: answer a prompt or send control/navigation keys to that same terminal session. For ordinary line input, send text with ENTER.',
  '- `tools.terminate_terminal`: stop a persistent terminal session started for the current work.',
  'Terminal interaction loop: execute once, read the same session, interact only when its output/state needs input, then continue reading that same session. Do not retry equivalent newline, CRLF, Enter, or Return variants unless fresh output shows the first normal interaction was not accepted.',
  '- `tools.memory`: read or maintain durable project/planning context, not project source.',
  '- `tools.kanban_board`: inspect or update Kanban task data when the request concerns cards, subtasks, status, or board planning. AI-completed main work stops at `for-review`, which completes direct subtasks. Never directly target `done`; only the user approves main tasks as Done. Set Owner per task: `Human` for user-originated work, `Agent` for work you introduce autonomously; do not blindly inherit parent ownership, and preserve explicit owner names.',
  '- `tools.tool_search`: discover a connected MCP capability that is not preloaded, then invoke only an exact returned function.',
  'Any additional preloaded API should be used only for the capability described by its generated contract below.',
].join('\n')

function buildPreloadedToolDocumentation(registry: AgentToolRegistry) {
  const contracts = registry.entries
    .filter((entry) => !isDynamicAgentTool(entry) && !HIDDEN_PRELOADED_TOOL_NAMES.has(entry.name))
    .map((entry) => createAgentToolCallableContract(entry))

  if (contracts.length === 0) {
    return 'No local tools are preloaded. Use tools.tool_search({ query }) inside Code Mode for dynamic capabilities.'
  }

  return [
    'Path rule: every supplied path argument and every patch file header is one exact workspace-relative file or directory. For root-capable `read`, `list`, `glob`, and `grep` calls, an omitted path where the schema permits omission, an empty string, or `.` refers to the bound workspace root. Never invent filenames or index files, combine roots with spaces, or treat a path list as one path. If an exact child path has not been supplied by the user or returned by a prior workspace tool, discover it with list, glob, or grep before reading or patching it.',
    'Preloaded local APIs (call directly inside the program):',
    ...contracts.map((contract) => `- ${contract.signature} — ${contract.description}`),
    'Connected MCP APIs are dynamic. Inside the same program, call tools.tool_search({ query }), then invoke an exact returned tools.<name>(args) function. Do not guess MCP names.',
  ].join('\n')
}

export function buildCodeModeDescription(registry: AgentToolRegistry) {
  return [
    CODE_MODE_EXECUTION_CONTRACT,
    CODE_MODE_TOOL_ROUTING,
    buildPreloadedToolDocumentation(registry),
  ].join('\n')
}

export function normalizeCodeModeSourceInput(input: unknown) {
  if (typeof input === 'string') return input
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ''
  const source = (input as CodeModeSourceInput).source
  return typeof source === 'string' ? source : ''
}

function usesNativeFreeformCodeModeTransport(providerId?: ChatProviderId) {
  return providerId === 'openai' || providerId === 'codex'
}

async function executeCodeModeSource(
  executor: CodeModeExecutor,
  input: unknown,
  options: { abortSignal?: AbortSignal; allowedToolNames?: readonly string[] },
): Promise<AgentToolExecutionResult> {
  const source = normalizeCodeModeSourceInput(input)
  if (source.trim().length === 0) return createToolErrorResult('code_mode requires a non-empty JavaScript program.')

  const result = await executor.run(source, {
    abortSignal: options.abortSignal,
    allowedToolNames: options.allowedToolNames,
  })
  const outputBody = result.output === undefined
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
}

export function createCodeModeTool(
  executor: CodeModeExecutor,
  registry: AgentToolRegistry,
  options: { allowedToolNames?: readonly string[]; providerId?: ChatProviderId } = {},
) {
  const description = buildCodeModeDescription(registry)
  if (usesNativeFreeformCodeModeTransport(options.providerId)) {
    return openai.tools.customTool({
      description,
      execute: async (source, executionOptions) => executeCodeModeSource(executor, source, {
        abortSignal: executionOptions.abortSignal,
        allowedToolNames: options.allowedToolNames,
      }),
      format: {
        definition: CODE_MODE_FREEFORM_GRAMMAR,
        syntax: 'lark',
        type: 'grammar',
      },
    })
  }

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
