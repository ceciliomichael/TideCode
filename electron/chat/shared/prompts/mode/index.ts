import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ChatMode, AppTerminalExecutionMode } from '../../../../../src/types/chat'
import { buildWorkspaceInstructionsBlock } from '../workspaceInstructions'
import { buildPythonVenvPromptBlock } from '../../../../python/venv'

const PROMPT_REPO_PATH = 'electron/chat/shared/prompts/mode'
const SHARED_PROMPT_EXTENSIONS = new Set(['.md', '.xml'])
const MODE_PROMPT_PATHS: Record<ChatMode, string> = {
  agent: 'agent/prompt.md',
  plan: 'plan/prompt.md',
}
const SHARED_PROMPT_DIRECTORY = {
  description: 'Supplemental instruction content',
  directory: 'shared',
  wrapperTag: 'instruction_extensions',
} as const
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

function readPromptDirectory(relativeDirectory: string) {
  const appRoot = process.env.APP_ROOT?.trim()
  const searchRoots = [appRoot, process.cwd()].filter((value): value is string => Boolean(value))

  for (const root of searchRoots) {
    const candidateDirectory = path.join(root, PROMPT_REPO_PATH, relativeDirectory)
    if (!existsSync(candidateDirectory)) {
      continue
    }

    const promptFiles = readdirSync(candidateDirectory, { withFileTypes: true })
      .filter((entry) => (
        entry.isFile() &&
        SHARED_PROMPT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))

    const fileContents = promptFiles
      .map((fileName) => {
        const content = readFileSync(path.join(candidateDirectory, fileName), 'utf8').trim()
        if (content.length === 0) {
          return null
        }
        return content
      })
      .filter((content): content is string => content !== null)

    if (fileContents.length === 0) {
      continue
    }

    return fileContents.join('\n\n')
  }

  return ''
}

const cachedPrompts: Partial<Record<ChatMode, string>> = {}
const cachedSharedPrompts: Partial<Record<ChatMode, string>> = {}
const cachedModeToolingPrompts: Partial<Record<ChatMode, string>> = {}
const cachedModeIntentPrompts: Partial<Record<ChatMode, string>> = {}

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

function getModePrompt(chatMode: ChatMode) {
  const cachedPrompt = cachedPrompts[chatMode]
  if (cachedPrompt) {
    return cachedPrompt
  }

  const prompt = readPromptFile(MODE_PROMPT_PATHS[chatMode])
  cachedPrompts[chatMode] = prompt
  return prompt
}

function getSharedPrompt(chatMode: ChatMode) {
  const cachedPrompt = cachedSharedPrompts[chatMode]
  if (cachedPrompt !== undefined) {
    return cachedPrompt
  }

  const prompt = readPromptDirectory(SHARED_PROMPT_DIRECTORY.directory)
  cachedSharedPrompts[chatMode] = prompt
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
  options?: { terminalExecutionMode?: AppTerminalExecutionMode },
): ChatSystemPromptBreakdown {
  void options

  const systemRuleComponents = [
    {
      content: getModeToolingPrompt(chatMode),
      id: `${chatMode}_mode_tooling_prompt`,
      section: 'system_contract' as const,
      source: `electron/chat/shared/prompts/mode/${MODE_TOOLING_PROMPT_PATHS[chatMode]}`,
    },
    {
      content: getModePrompt(chatMode),
      id: `${chatMode}_mode_prompt`,
      section: 'system_contract' as const,
      source: `electron/chat/shared/prompts/mode/${MODE_PROMPT_PATHS[chatMode]}`,
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
      content: getSharedPrompt(chatMode),
      id: 'shared_prompt_extensions',
      section: 'system_contract' as const,
      source: 'electron/chat/shared/prompts/mode/shared/*.{md,xml}',
    },
  ].filter((component) => component.content.length > 0)

  const workspaceRootComponent: ChatSystemPromptComponent = {
    content: `Workspace root: ${workspaceRootPath}`,
    id: 'workspace_root',
    section: 'workspace_context' as const,
    source: 'electron/chat/shared/prompts/mode/index.ts',
  }
  const workspacePathContractComponent: ChatSystemPromptComponent = {
    content: [
      'Workspace path contract:',
      '- The host-provided workspace root above is the canonical absolute root for this turn. Treat it as authoritative; never infer a different root from the project name or a directory listing.',
      '- Native workspace and terminal tools accept either a path relative to that root or the exact absolute path inside that root. Use `.` or omit the optional path to target the root itself.',
      '- Never append the workspace folder name to an absolute workspace root. For example, if the root is `C:\\repo`, do not invent `C:\\repo\\repo`.',
      '- If a tool reports that a path does not exist, reuse the exact root shown above and correct only the relative child path. Do not retry the same invented absolute path.',
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
    '<system_contract priority="highest" description="Core mode, tool, and response requirements">',
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
  options?: { terminalExecutionMode?: AppTerminalExecutionMode },
) {
  return buildChatModeSystemPromptBreakdown(chatMode, workspaceRootPath, options).systemPrompt
}
