import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const PROMPT_REPO_PATH = 'electron/chat/shared/prompts/compression'
const SUMMARY_PROMPT_FILE_NAME = 'prompt.md'

function readPromptFile(fileName: string) {
  const appRoot = process.env.APP_ROOT?.trim()
  const searchRoots = [appRoot, process.cwd()].filter((value): value is string => Boolean(value))

  for (const root of searchRoots) {
    const candidatePath = path.join(root, PROMPT_REPO_PATH, fileName)
    if (existsSync(candidatePath)) {
      return readFileSync(candidatePath, 'utf8').trim()
    }
  }

  throw new Error(`Unable to load chat compression prompt file: ${fileName}`)
}

let cachedPrompt: string | null = null

function getPrompt() {
  if (cachedPrompt !== null) {
    return cachedPrompt
  }

  const summaryPrompt = readPromptFile(SUMMARY_PROMPT_FILE_NAME)
  cachedPrompt = summaryPrompt
  return cachedPrompt
}

export function buildChatCompressionSystemPrompt() {
  return getPrompt()
}
