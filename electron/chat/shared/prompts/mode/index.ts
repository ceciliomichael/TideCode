import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ChatMode, AppTerminalExecutionMode } from '../../../../../src/types/chat'
import { buildWorkspaceInstructionsBlock } from '../workspaceInstructions'
import { getTerminalCommandAllowlist } from '../../tools/terminalCommandPolicy'

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
const TOOLING_PROMPT_PATHS: Record<ChatMode, string> = {
  agent: 'agent/tooling',
  plan: 'plan/tooling',
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

function readPromptDirectory(relativeDirectory: string, wrapperTag: string, description: string) {
  const appRoot = process.env.APP_ROOT?.trim()
  const searchRoots = [appRoot, process.cwd()].filter((value): value is string => Boolean(value))

  for (const root of searchRoots) {
    const candidateDirectory = path.join(root, PROMPT_REPO_PATH, relativeDirectory)
    if (!existsSync(candidateDirectory)) {
      continue
    }

    const promptFiles = readdirSync(candidateDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && SHARED_PROMPT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))

    const wrappedPromptFiles = promptFiles
      .map((fileName) => {
        const content = readFileSync(path.join(candidateDirectory, fileName), 'utf8').trim()
        if (content.length === 0) {
          return null
        }

        const extension = path.extname(fileName).slice(1).toLowerCase() || 'file'
        const wrapperName = `${path.basename(fileName, path.extname(fileName))}_extension`

        return [
          `  <${wrapperName} description="${description}" file="${fileName}" format="${extension}">`,
          content,
          `  </${wrapperName}>`,
        ].join('\n')
      })
      .filter((content): content is string => content !== null)

    if (wrappedPromptFiles.length === 0) {
      continue
    }

    return [
      `<${wrapperTag} description="${description}">`,
      ...wrappedPromptFiles,
      `</${wrapperTag}>`,
    ].join('\n')
  }

  return ''
}

const cachedPrompts: Partial<Record<ChatMode, string>> = {}
let cachedSharedPrompt: string | null = null
const cachedToolingPrompts: Partial<Record<ChatMode, string>> = {}

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

  cachedSharedPrompt = readPromptDirectory(
    SHARED_PROMPT_DIRECTORY.directory,
    SHARED_PROMPT_DIRECTORY.wrapperTag,
    SHARED_PROMPT_DIRECTORY.description,
  )
  return cachedSharedPrompt
}

function getToolingPrompt(chatMode: ChatMode) {
  const cachedPrompt = cachedToolingPrompts[chatMode]
  if (cachedPrompt) {
    return cachedPrompt
  }

  const toolingPrompt = readPromptDirectory(TOOLING_PROMPT_PATHS[chatMode], 'tooling_instructions', 'Tool usage guidance')
  cachedToolingPrompts[chatMode] = toolingPrompt
  return toolingPrompt
}

function buildTerminalPermissionBlock(terminalExecutionMode: AppTerminalExecutionMode | undefined) {
  const mode = terminalExecutionMode ?? 'sandbox'
  if (mode === 'full') {
    return [
      '<terminal_permission_instructions>',
      'You are allowed to execute terminal commands.',
      '</terminal_permission_instructions>'
    ].join('\n')
  }

  const allowlist = getTerminalCommandAllowlist()
  const commandsList = allowlist.map((cmd) => `  - ${cmd}`).join('\n')
  return [
    '<terminal_permission_instructions>',
    'Your terminal permission level is sandbox. Here are your enabled commands only:',
    commandsList,
    '</terminal_permission_instructions>'
  ].join('\n')
}

export function buildChatModeSystemPrompt(
  chatMode: ChatMode,
  workspaceRootPath: string,
  options?: { availableSkillsBlock?: string | null; terminalExecutionMode?: AppTerminalExecutionMode },
) {
  return [
    getToolingPrompt(chatMode),
    getModePrompt(chatMode),
    getSharedPrompt(),
    options?.availableSkillsBlock?.trim() ? options.availableSkillsBlock.trim() : null,
    buildWorkspaceInstructionsBlock(workspaceRootPath),
    buildTerminalPermissionBlock(options?.terminalExecutionMode),
    `Workspace root: ${workspaceRootPath}`,
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n\n')
}
