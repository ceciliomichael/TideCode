import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ChatMode, AppTerminalExecutionMode } from '../../../../../src/types/chat'
import type { AgentOrchestrationMode } from '../../orchestration'
import { buildWorkspaceInstructionsRuntimeBlock } from '../workspaceInstructions'
import { getTideCodeRuntimeRoot } from '../../../../runtime/runtimeRoot'

const PROMPT_REPO_PATH = 'electron/chat/shared/prompts/mode'
const SHARED_PROMPT_FILES = [
  { id: 'shared_mindset_prompt', relativePath: 'shared/mindset.md' },
  { id: 'shared_response_prompt', relativePath: 'shared/response.md' },
  { id: 'shared_continuation_prompt', relativePath: 'shared/continuation.md' },
] as const

function readPromptFile(relativePath: string) {
  const promptPath = path.join(getTideCodeRuntimeRoot(), PROMPT_REPO_PATH, relativePath)
  if (!existsSync(promptPath)) {
    throw new Error(`Unable to load chat prompt file: ${relativePath}`)
  }
  return readFileSync(promptPath, 'utf8').trim()
}

function escapePromptMarkup(content: string) {
  return content
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

let cachedSharedPromptComponents: ChatSystemPromptComponent[] | null = null

const CORE_DECISION_PROMPT = [
  '<decision_priority description="Required order for every model turn">',
  '1. Choose the next action: no tool, inspect, mutate, or verify. Name the fact, change, or check that action must produce.',
  '2. Keep it inside the latest user request, explicit constraints, and the exact `<workspace_root>` value. Questions and diagnosis do not authorize mutation.',
  '3. Use the narrowest exact tool and the smallest complete sequence. Read current state before changing it; keep intermediate data out of the model when possible.',
  '4. Verify the requested result after the final mutation, use failure evidence to choose a different next action, then stop.',
  '</decision_priority>',
].join('\n')

const CODE_MODE_PROMPT = [
  '<code_mode_rules description="Use the Code Mode contract without duplicating it">',
  '- The only model-facing tool in this turn is `code_mode`.',
  '- Names such as `tools.list` and `tools.glob` are JavaScript APIs inside the `code_mode` program, never model-facing tool names. Never emit a `tools.*` provider call.',
  '- Treat the `code_mode` tool description as the authoritative contract for inner APIs, restrictions, schemas, and scenario routing. Do not duplicate or override those mechanics in the system prompt.',
  '- Keep each Code Mode program scoped to the smallest complete inspect, mutate, or verify sequence needed for the current decision.',
  '- Never invent or assume a child file path from project conventions. Read a child path only when the user supplied it or a prior tool returned that exact path; otherwise discover it with `tools.list`, `tools.glob`, or `tools.grep` first.',
  '</code_mode_rules>',
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

function getSharedPromptComponents(): ChatSystemPromptComponent[] {
  if (cachedSharedPromptComponents !== null) {
    return cachedSharedPromptComponents
  }

  const components: ChatSystemPromptComponent[] = []
  for (const { id, relativePath } of SHARED_PROMPT_FILES) {

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

  cachedSharedPromptComponents = components
  return components
}

export function buildChatModeSystemPromptBreakdown(
  _chatMode: ChatMode,
  workspaceRootPath: string,
  options?: {
    orchestrationMode?: AgentOrchestrationMode
    terminalExecutionMode?: AppTerminalExecutionMode
  },
): ChatSystemPromptBreakdown {
  const isCodeMode = options?.orchestrationMode === 'code_mode'
  const isHybrid = options?.orchestrationMode === 'hybrid'
  const coreDecisionComponent: ChatSystemPromptComponent = {
    content: CORE_DECISION_PROMPT,
    id: 'core_decision_priority',
    section: 'system_contract',
    source: 'electron/chat/shared/prompts/mode/index.ts',
  }
  const modeComponents: ChatSystemPromptComponent[] = isCodeMode
    ? [{
        content: CODE_MODE_PROMPT,
        id: 'code_mode_contract',
        section: 'system_contract' as const,
        source: 'electron/chat/shared/prompts/mode/index.ts',
      }]
    : []
  const systemRuleComponents: ChatSystemPromptComponent[] = [
    coreDecisionComponent,
    ...modeComponents,
...getSharedPromptComponents(),
  ]

  if (isHybrid) {
    systemRuleComponents.push({
      content: [
        '<code_mode_contract>',
        'Use a direct tool for one simple operation; use `code_mode` for related calls, loops, filtering, or batching.',
        'Treat the `code_mode` tool description as authoritative for its inner APIs, restrictions, and discovery mechanics.',
        '</code_mode_contract>',
      ].join('\n'),
      id: 'code_mode_contract',
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
      isCodeMode
        ? '- Follow the path rules in the `code_mode` tool description for inner workspace calls. Inside the `code_mode` JavaScript, discover unknown paths with `tools.list`, `tools.glob`, or `tools.grep`; never emit those names as provider tool calls.'
        : '- If unsure, inspect with `list`, `glob`, or `grep` before choosing a path. Do not infer child filenames from naming conventions.',
      '- If a path fails, correct the relative child path; do not retry the same guessed absolute path.',
      '</workspace_path_rules>',
    ].join('\n'),
    id: 'workspace_path_contract',
    section: 'workspace_context' as const,
    source: 'electron/chat/shared/prompts/mode/index.ts',
  }
  const workspaceInstructionsContext = buildWorkspaceInstructionsRuntimeBlock()
  const workspaceComponents = [
    workspaceRootComponent,
    workspacePathContractComponent,
    {
      content: workspaceInstructionsContext,
      id: 'workspace_instructions_context',
      section: 'workspace_context' as const,
      source: 'electron/chat/shared/prompts/workspaceInstructions.ts',
    },
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
