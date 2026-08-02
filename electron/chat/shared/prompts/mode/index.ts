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
const SHARED_TOOLING_PROMPT_FILE = 'tooling.md'
const SHARED_TOOLING_PROMPT_PATH = 'shared/tooling.md'

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
        entry.name !== SHARED_TOOLING_PROMPT_FILE &&
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
let cachedSharedPrompt: string | null = null
let cachedToolingPrompt: string | null = null

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

function getSharedPrompt() {
  if (cachedSharedPrompt !== null) {
    return cachedSharedPrompt
  }

  cachedSharedPrompt = readPromptDirectory(SHARED_PROMPT_DIRECTORY.directory)
  return cachedSharedPrompt
}

function getToolingPrompt() {
  if (cachedToolingPrompt !== null) {
    return cachedToolingPrompt
  }

  cachedToolingPrompt = readPromptFile(SHARED_TOOLING_PROMPT_PATH)
  return cachedToolingPrompt
}

export function buildChatModeSystemPromptBreakdown(
  chatMode: ChatMode,
  workspaceRootPath: string,
  options?: { terminalExecutionMode?: AppTerminalExecutionMode },
): ChatSystemPromptBreakdown {
  void options

  const systemRuleComponents: ChatSystemPromptComponent[] = [
    {
      content: getToolingPrompt(),
      id: 'tooling_prompt',
      section: 'system_contract' as const,
      source: 'electron/chat/shared/prompts/mode/shared/tooling.md',
    },
    {
      content: getModePrompt(chatMode),
      id: `${chatMode}_mode_prompt`,
      section: 'system_contract' as const,
      source: `electron/chat/shared/prompts/mode/${MODE_PROMPT_PATHS[chatMode]}`,
    },
    {
      content: getSharedPrompt(),
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
  const venvPrompt = buildPythonVenvPromptBlock(workspaceRootPath)
  const workspaceInstructions = buildWorkspaceInstructionsBlock(workspaceRootPath)
  const workspaceComponents = [
    workspaceRootComponent,
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
