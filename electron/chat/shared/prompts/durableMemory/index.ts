import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { getTideCodeRuntimeRoot } from '../../../../runtime/runtimeRoot'

const PROMPT_REPO_PATH = 'electron/chat/shared/prompts/durableMemory'
const MEMORY_PROMPT_FILE_NAME = 'prompt.md'

function readPromptFile(fileName: string) {
  const promptPath = path.join(getTideCodeRuntimeRoot(), PROMPT_REPO_PATH, fileName)
  if (!existsSync(promptPath)) {
    throw new Error(`Unable to load durable conversation memory prompt file: ${fileName}`)
  }
  return readFileSync(promptPath, 'utf8').trim()
}

let cachedPrompt: string | null = null

export function buildDurableMemorySystemPrompt() {
  if (cachedPrompt === null) {
    cachedPrompt = readPromptFile(MEMORY_PROMPT_FILE_NAME)
  }
  return cachedPrompt
}
