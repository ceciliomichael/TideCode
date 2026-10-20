import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { getTideCodeRuntimeRoot } from '../../../../runtime/runtimeRoot'

const PROMPT_REPO_PATH = 'electron/chat/shared/ai/prompts/workers'
const MEMORY_PROMPT_FILES = {
  initialize: 'durable-memory-initialize.md',
  reconcile: 'durable-memory-reconcile.md',
} as const

export type DurableMemoryOperation = keyof typeof MEMORY_PROMPT_FILES

function readPromptFile(fileName: string) {
  const promptPath = path.join(getTideCodeRuntimeRoot(), PROMPT_REPO_PATH, fileName)
  if (!existsSync(promptPath)) {
    throw new Error(`Unable to load durable conversation memory prompt file: ${fileName}`)
  }
  return readFileSync(promptPath, 'utf8').trim()
}

const cachedPrompts: Partial<Record<DurableMemoryOperation, string>> = {}

export function buildDurableMemorySystemPrompt(operation: DurableMemoryOperation) {
  const cachedPrompt = cachedPrompts[operation]
  if (cachedPrompt !== undefined) {
    return cachedPrompt
  }

  const prompt = readPromptFile(MEMORY_PROMPT_FILES[operation])
  cachedPrompts[operation] = prompt
  return prompt
}
