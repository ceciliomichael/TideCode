import { resolveAppError, type ErrorItemKind } from './errors/resolveAppError'

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
  return resolveAppError(error, 'app.unexpected', {
    fallbackMessage,
    itemKind: options.itemKind,
  }).message
}
