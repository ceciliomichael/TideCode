import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { getTideCodeRuntimeRoot } from '../../../../runtime/runtimeRoot'

const PROMPT_REPO_PATH = 'electron/chat/shared/prompts/compression'
const SUMMARY_PROMPT_FILE_NAME = 'prompt.md'

function readPromptFile(fileName: string) {
  const promptPath = path.join(getTideCodeRuntimeRoot(), PROMPT_REPO_PATH, fileName)
  if (!existsSync(promptPath)) {
    throw new Error(`Unable to load chat compression prompt file: ${fileName}`)
  }
  return readFileSync(promptPath, 'utf8').trim()
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
