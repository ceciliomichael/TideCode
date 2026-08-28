import { stripHiddenUserContext } from './hiddenUserContext'

export const EXECUTION_MODE_CONTEXT_PATTERN =
  /<execution_mode_context mode="(sandbox|full)">[\s\S]*?<\/execution_mode_context>/gu

export function stripExecutionModeContext(value: string) {
  return stripHiddenUserContext(value)
    .replace(EXECUTION_MODE_CONTEXT_PATTERN, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}
