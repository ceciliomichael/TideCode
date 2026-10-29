import { resolveAppError, type ErrorItemKind } from './errors/resolveAppError'
import { errorCatalog } from './errors/errorCatalog'

export type UserFacingErrorItemKind = ErrorItemKind

export interface UserFacingErrorOptions {
  itemKind?: UserFacingErrorItemKind
}

/**
 * Compatibility-free message-only boundary for text fields. New error notices
 * should use resolveAppError to preserve the title and operation context.
 */
export function toUserFacingErrorMessage(
  error: unknown,
  fallbackMessage: string,
  options: UserFacingErrorOptions = {},
): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  for (const [id, feedback] of Object.entries(errorCatalog)) {
    if (id.startsWith('compaction.') && message.includes(feedback.message)) {
      return feedback.message
    }
  }
  return resolveAppError(error, 'app.unexpected', {
    fallbackMessage,
    itemKind: options.itemKind,
  }).message
}
