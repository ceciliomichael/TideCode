import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppTerminalExecutionMode } from '../../../../src/types/chat'
import { getTideCodeRuntimeRoot } from '../../../runtime/runtimeRoot'

const CODE_MODE_PROMPT_REPO_PATH = 'electron/chat/shared/prompts/codeMode'
const CODE_MODE_PROMPT_FILE_NAME = 'code-mode.md'
const CODE_MODE_PROMPT_FALLBACK = 'Code Mode executes a Tidecode-owned JavaScript-like orchestration language. It is not Node.js. Use only documented tools.* capabilities; direct host, filesystem, network, import, require, eval, and Function access are unavailable.'

let cachedCodeModePrompt: string | null = null

function getCodeModePrompt() {
  if (cachedCodeModePrompt !== null) return cachedCodeModePrompt
  let promptPath: string
  try {
    promptPath = path.join(getTideCodeRuntimeRoot(), CODE_MODE_PROMPT_REPO_PATH, CODE_MODE_PROMPT_FILE_NAME)
  } catch {
    promptPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../prompts/codeMode',
      CODE_MODE_PROMPT_FILE_NAME,
    )
  }
  if (!existsSync(promptPath)) {
    cachedCodeModePrompt = CODE_MODE_PROMPT_FALLBACK
    return cachedCodeModePrompt
  }
  cachedCodeModePrompt = readFileSync(promptPath, 'utf8').trim()
  return cachedCodeModePrompt
}

export function buildCodeModeExecutionContract(executionMode: AppTerminalExecutionMode = 'sandbox') {
  const authority = executionMode === 'full'
    ? 'Full Access may broaden which tools.* capabilities the host authorizes, but it does not change Code Mode language semantics or enable direct Node.js/module access.'
    : 'Sandbox keeps host authority restricted to the tools.* capabilities authorized for the current chat and workspace.'
  return [getCodeModePrompt(), authority].join('\n\n')
}

export const CODE_MODE_EXECUTION_CONTRACT = buildCodeModeExecutionContract('sandbox')
