import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ChatMode, AppTerminalExecutionMode } from '../../../../../src/types/chat'
import type { AgentOrchestrationMode } from '../../orchestration'
import { buildWorkspaceInstructionsBootstrapBlock } from '../workspaceInstructions'
import { buildPythonVenvPromptBlock } from '../../../../python/venv'
import { getTideCodeRuntimeRoot } from '../../../../runtime/runtimeRoot'
import { resolvePreferredTerminalShell } from '../../../../terminal/configuration'

const PROMPT_REPO_PATH = 'electron/chat/shared/prompts/mode'
const MODE_PROMPT_PATHS: Record<ChatMode, string> = {
  agent: 'agent/prompt.md',
  plan: 'plan/prompt.md',
}
const SHARED_PROMPT_FILES = [
  { id: 'shared_mindset_prompt', relativePath: 'shared/mindset.md' },
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
  '<agent_code_mode_rules description="Use the Code Mode contract without duplicating it">',
  '- The only model-facing tool in this turn is `code_mode`.',
  '- Names such as `tools.list` and `tools.glob` are JavaScript APIs inside the `code_mode` program, never model-facing tool names. Never emit a `tools.*` provider call.',
  '- Treat the `code_mode` tool description as the authoritative contract for inner APIs, restrictions, schemas, and scenario routing. Do not duplicate or override those mechanics in the system prompt.',
  '- Keep each Code Mode program scoped to the smallest complete inspect, mutate, or verify sequence needed for the current decision.',
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
...getSharedPromptComponents(),
  ]

  if (isHybridAgent) {
    systemRuleComponents.push({
      content: [
        '<code_mode_contract>',
        'Use a direct tool for one simple operation; use `code_mode` for related calls, loops, filtering, or batching.',
        'Treat the `code_mode` tool description as authoritative for its inner APIs, restrictions, and discovery mechanics.',
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
        ? '- Follow the path rules in the `code_mode` tool description for inner workspace calls. Inside the `code_mode` JavaScript, discover unknown paths with `tools.list`, `tools.glob`, or `tools.grep`; never emit those names as provider tool calls.'
        : '- If unsure, inspect with `list`, `glob`, or `grep` before choosing a path. Do not infer child filenames from naming conventions.',
      '- If a path fails, correct the relative child path; do not retry the same guessed absolute path.',
      '</workspace_path_rules>',
    ].join('\n'),
    id: 'workspace_path_contract',
    section: 'workspace_context' as const,
    source: 'electron/chat/shared/prompts/mode/index.ts',
  }
  const venvPrompt = buildPythonVenvPromptBlock(workspaceRootPath)
  const terminalShell = chatMode === 'agent' ? resolvePreferredTerminalShell() : null
  const terminalShellPrompt = terminalShell
    ? [
        '<terminal_environment>',
        '- Active terminal shell: ' + escapePromptMarkup(terminalShell.label) + ' (' + escapePromptMarkup(terminalShell.command) + ').',
        '- Write terminal commands using this shell syntax. Do not assume another shell.',
        '</terminal_environment>',
      ].join('\n')
    : ''
  const workspaceInstructionsBootstrap = buildWorkspaceInstructionsBootstrapBlock()
  const workspaceComponents = [
    workspaceRootComponent,
    workspacePathContractComponent,
    {
      content: workspaceInstructionsBootstrap,
      id: 'workspace_instructions_bootstrap',
      section: 'workspace_context' as const,
      source: 'electron/chat/shared/prompts/workspaceInstructions.ts',
    },
    terminalShellPrompt
      ? {
          content: terminalShellPrompt,
          id: 'terminal_shell_context',
          section: 'workspace_context' as const,
          source: 'electron/terminal/configuration.ts',
        }
      : null,
    venvPrompt
      ? {
          content: venvPrompt,
          id: 'python_venv_context',
          section: 'workspace_context' as const,
          source: 'electron/python/venv.ts',
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
