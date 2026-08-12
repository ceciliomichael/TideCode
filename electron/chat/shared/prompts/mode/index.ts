import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ChatMode, AppTerminalExecutionMode } from '../../../../../src/types/chat'
import type { AgentOrchestrationMode } from '../../orchestration'
import { buildWorkspaceInstructionsBlock } from '../workspaceInstructions'
import { buildPythonVenvPromptBlock } from '../../../../python/venv'

const PROMPT_REPO_PATH = 'electron/chat/shared/prompts/mode'
const MODE_PROMPT_PATHS: Record<ChatMode, string> = {
  agent: 'agent/prompt.md',
  plan: 'plan/prompt.md',
}
const SHARED_PROMPT_FILES = [
  { id: 'shared_mindset_prompt', relativePath: 'shared/mindset.md' },
  { id: 'shared_tooling_prompt', relativePath: 'shared/tooling.md' },
  { id: 'shared_memory_prompt', relativePath: 'shared/memory.md' },
  { id: 'shared_response_prompt', relativePath: 'shared/response.md' },
  { id: 'shared_continuation_prompt', relativePath: 'shared/continuation.md' },
] as const
const MODE_TOOLING_PROMPT_PATHS: Record<ChatMode, string> = {
  agent: 'agent/tooling.md',
  plan: 'plan/tooling.md',
}
const MODE_INTENT_PROMPT_PATHS: Partial<Record<ChatMode, string>> = {
  agent: 'agent/intent.md',
}

function readPromptFile(relativePath: string) {
  const appRoot = process.env.APP_ROOT?.trim()
  const searchRoots = [appRoot, process.cwd()].filter((value): value is string => Boolean(value))

  for (const root of searchRoots) {
    const candidatePath = path.join(root, PROMPT_REPO_PATH, relativePath)
    if (existsSync(candidatePath)) {
      return readFileSync(candidatePath, 'utf8').trim()
    }
  }

  throw new Error(`Unable to load chat prompt file: ${relativePath}`)
}

function escapePromptMarkup(content: string) {
  return content
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

const cachedPrompts: Partial<Record<ChatMode, string>> = {}
const cachedModeToolingPrompts: Partial<Record<ChatMode, string>> = {}
const cachedModeIntentPrompts: Partial<Record<ChatMode, string>> = {}
let cachedSharedPromptComponents: ChatSystemPromptComponent[] | null = null

const CORE_DECISION_PROMPT = [
  '<decision_priority description="Required order for every model turn">',
  '1. Choose the next action: no tool, inspect, mutate, or verify. Name the fact, change, or check that action must produce.',
  '2. Keep it inside the latest user request, explicit constraints, and the exact `<workspace_root>` value. Questions and diagnosis do not authorize mutation.',
  '3. Use the narrowest exact tool and the smallest complete sequence. Read current state before changing it; keep intermediate data out of the model when possible.',
  '4. Verify the requested result after the final mutation, use failure evidence to choose a different next action, then stop.',
  '</decision_priority>',
].join('\n')

const CODE_MODE_AGENT_PROMPT = [
  '<agent_code_mode_rules description="Local Code Mode contract">',
  '- The only model-facing tools in this turn are `tool_search` and `code_mode`.',
  '- Local workspace APIs are preloaded in the `code_mode` description. Call them directly as `tools.<name>(args)`; use `tool_search` only for connected MCP APIs, then pass exact returned names in `allowedToolNames`.',
  '- Every `path` argument is exactly one existing file or directory path. `read` is for one file (a directory returns entries), `list` is for one directory, and `glob`/`grep` discover paths. Never invent an index file or combine roots with spaces (for example, `"src electron"`); use one call per root or omit `path` to search the workspace root.',
  '- Write boring sequential JavaScript: await each `tools.*` call, keep intermediate data inside the program, and return small JSON-compatible data. Use `Promise.all` only for independent calls.',
  '- Use only documented `tools.*` APIs. Do not use imports, runtime APIs, filesystem APIs, shell APIs, network APIs, or dynamic code loading.',
  '- For source changes, read the exact current file first and use `tools.edit({ path, edits })`. One call has one path; its `edits` array may contain multiple hunks for that file. Every hunk requires complete `targetContent` and `replacementContent`; optional `startLine`/`endLine` restrict matching to that latest read range automatically when omitted. Use `replaceAll: true` only when every occurrence in that effective range is intended. Use source text only in targetContent; never include read metadata or the EOF footer, edit unchanged content, or mix paths in one call.',
  '- After a tool failure or source drift, reread the target and generate a new narrow action. Preserve permissions and approvals, verify the requested result, then stop.',
  '</agent_code_mode_rules>',
].join('\n')

export interface ChatSystemPromptComponent {
  content: string
  id: string
  section: 'system_contract' | 'workspace_context'
  source: string
}

export interface ChatSystemPromptBreakdown {
  components: ChatSystemPromptComponent[]
  systemPrompt: string
}

function getSharedPromptComponents(includeDirectMcpSurface: boolean): ChatSystemPromptComponent[] {
  if (cachedSharedPromptComponents !== null && includeDirectMcpSurface) {
    return cachedSharedPromptComponents
  }

  const components: ChatSystemPromptComponent[] = []
  for (const { id, relativePath } of SHARED_PROMPT_FILES) {
    if (!includeDirectMcpSurface && id === 'shared_tooling_prompt') {
      continue
    }

    let content = ''
    try {
      content = readPromptFile(relativePath)
    } catch {
      continue
    }

    if (content.length === 0) {
      continue
    }

    components.push({
      content,
      id,
      section: 'system_contract',
      source: `electron/chat/shared/prompts/mode/${relativePath}`,
    })
  }

  if (includeDirectMcpSurface) {
    cachedSharedPromptComponents = components
  }
  return components
}

function getModePrompt(chatMode: ChatMode) {
  const cachedPrompt = cachedPrompts[chatMode]
  if (cachedPrompt) {
    return cachedPrompt
  }

  const prompt = readPromptFile(MODE_PROMPT_PATHS[chatMode])
  cachedPrompts[chatMode] = prompt
  return prompt
}

function getModeToolingPrompt(chatMode: ChatMode) {
  const cached = cachedModeToolingPrompts[chatMode]
  if (cached !== undefined) {
    return cached
  }

  try {
    const prompt = readPromptFile(MODE_TOOLING_PROMPT_PATHS[chatMode])
    cachedModeToolingPrompts[chatMode] = prompt
    return prompt
  } catch {
    cachedModeToolingPrompts[chatMode] = ''
    return ''
  }
}

function getModeIntentPrompt(chatMode: ChatMode) {
  const cached = cachedModeIntentPrompts[chatMode]
  if (cached !== undefined) {
    return cached
  }

  const relativePath = MODE_INTENT_PROMPT_PATHS[chatMode]
  if (!relativePath) {
    cachedModeIntentPrompts[chatMode] = ''
    return ''
  }

  try {
    const prompt = readPromptFile(relativePath)
    cachedModeIntentPrompts[chatMode] = prompt
    return prompt
  } catch {
    cachedModeIntentPrompts[chatMode] = ''
    return ''
  }
}

export function buildChatModeSystemPromptBreakdown(
  chatMode: ChatMode,
  workspaceRootPath: string,
  options?: {
    orchestrationMode?: AgentOrchestrationMode
    terminalExecutionMode?: AppTerminalExecutionMode
  },
): ChatSystemPromptBreakdown {
  const isCodeModeAgent = chatMode === 'agent' && options?.orchestrationMode === 'code_mode'
  const isHybridAgent = chatMode === 'agent' && options?.orchestrationMode === 'hybrid'
  const coreDecisionComponent: ChatSystemPromptComponent = {
    content: CORE_DECISION_PROMPT,
    id: 'core_decision_priority',
    section: 'system_contract',
    source: 'electron/chat/shared/prompts/mode/index.ts',
  }
  const modeComponents: ChatSystemPromptComponent[] = isCodeModeAgent
    ? [{
        content: CODE_MODE_AGENT_PROMPT,
        id: 'agent_code_mode_contract',
        section: 'system_contract' as const,
        source: 'electron/chat/shared/prompts/mode/index.ts',
      }]
    : [
        {
          content: getModeToolingPrompt(chatMode),
          id: `${chatMode}_mode_tooling_prompt`,
          section: 'system_contract' as const,
          source: `electron/chat/shared/prompts/mode/${MODE_TOOLING_PROMPT_PATHS[chatMode]}`,
        },
        {
          content: getModeIntentPrompt(chatMode),
          id: `${chatMode}_mode_intent_prompt`,
          section: 'system_contract' as const,
          source: MODE_INTENT_PROMPT_PATHS[chatMode]
            ? `electron/chat/shared/prompts/mode/${MODE_INTENT_PROMPT_PATHS[chatMode]}`
            : '',
        },
        {
          content: getModePrompt(chatMode),
          id: `${chatMode}_mode_prompt`,
          section: 'system_contract' as const,
          source: `electron/chat/shared/prompts/mode/${MODE_PROMPT_PATHS[chatMode]}`,
        },
      ].filter((component) => component.content.length > 0)
  const systemRuleComponents: ChatSystemPromptComponent[] = [
    coreDecisionComponent,
    ...modeComponents,
    ...getSharedPromptComponents(!isCodeModeAgent),
  ]

  if (isHybridAgent) {
    systemRuleComponents.push({
      content: [
        '<code_mode_contract>',
        'This hybrid turn exposes direct tools plus `tool_search` and `code_mode`.',
        'Use direct tools for one simple operation; use code_mode for related calls, loops, filtering, or batching.',
        'Local tools are preloaded in code_mode. Use tool_search only for connected MCP capabilities and pass exact returned names to code_mode.',
        '</code_mode_contract>',
      ].join('\n'),
      id: 'agent_code_mode_contract',
      section: 'system_contract' as const,
      source: 'electron/chat/shared/prompts/mode/index.ts',
    })
  }

  const workspaceRootComponent: ChatSystemPromptComponent = {
    content: [
      '<workspace_root authoritative="true" type="absolute">',
      escapePromptMarkup(workspaceRootPath),
      '</workspace_root>',
    ].join('\n'),
    id: 'workspace_root',
    section: 'workspace_context' as const,
    source: 'electron/chat/shared/prompts/mode/index.ts',
  }
  const workspacePathContractComponent: ChatSystemPromptComponent = {
    content: [
      '<workspace_path_rules>',
      '- Use the exact value inside <workspace_root> as the only workspace root for this turn.',
      '- Prefer paths relative to that root. Use `.` or omit an optional path for the root itself.',
      '- Never guess or construct an absolute path from a project name, display name, process directory, or previous turn. Copy an absolute path only when the user or a tool provided it.',
      isCodeModeAgent
        ? '- Use the preloaded filesystem APIs for path inspection. Use `tool_search` only when the required capability is a connected MCP tool.'
        : '- If unsure, inspect with `list`, `glob`, or `grep` before choosing a path.',
      '- If a path fails, correct the relative child path; do not retry the same guessed absolute path.',
      '</workspace_path_rules>',
    ].join('\n'),
    id: 'workspace_path_contract',
    section: 'workspace_context' as const,
    source: 'electron/chat/shared/prompts/mode/index.ts',
  }
  const venvPrompt = buildPythonVenvPromptBlock(workspaceRootPath)
  const workspaceInstructions = buildWorkspaceInstructionsBlock(workspaceRootPath)
  const workspaceComponents = [
    workspaceRootComponent,
    workspacePathContractComponent,
    venvPrompt
      ? {
          content: venvPrompt,
          id: 'python_venv_context',
          section: 'workspace_context' as const,
          source: 'electron/python/venv.ts',
        }
      : null,
    workspaceInstructions
      ? {
          content: workspaceInstructions,
          id: 'workspace_instructions',
          section: 'workspace_context' as const,
          source: `${path.join(workspaceRootPath, 'AGENTS.md')}`,
        }
      : null,
  ].filter((component): component is ChatSystemPromptComponent => component !== null)

  const systemRules = systemRuleComponents.map((component) => component.content).join('\n\n')

  const systemContractBlock = [
    '<system_contract priority="highest" description="Read in order: decide, scope, execute, verify, then communicate">',
    systemRules,
    '</system_contract>',
  ].join('\n')
  const workspaceContext = workspaceComponents.map((component) => component.content).join('\n')
  const workspaceContextBlock = [
    '<workspace_context>',
    workspaceContext,
    '</workspace_context>',
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n')

  const systemPrompt = [
    systemContractBlock,
    workspaceContextBlock,
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n\n')

  return {
    components: [...systemRuleComponents, ...workspaceComponents],
    systemPrompt,
  }
}

export function buildChatModeSystemPrompt(
  chatMode: ChatMode,
  workspaceRootPath: string,
  options?: {
    orchestrationMode?: AgentOrchestrationMode
    terminalExecutionMode?: AppTerminalExecutionMode
  },
) {
  return buildChatModeSystemPromptBreakdown(chatMode, workspaceRootPath, options).systemPrompt
}
