import { toUserFacingErrorMessage } from '../../../lib/userFacingError'

const REMOTE_MODEL_LIST_FAILURE_PREFIX = "Error invoking remote method 'models:provider:list':"

function getErrorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    const message = error.message.trim()
    return message.length > 0 ? message : null
  }

  if (typeof error === 'string') {
    const message = error.trim()
    return message.length > 0 ? message : null
  }

  return null
}

export function shouldSuppressProviderModelLoadError(error: unknown): boolean {
  const message = getErrorMessage(error)

  if (!message) {
    return false
  }

  return message.includes(REMOTE_MODEL_LIST_FAILURE_PREFIX) && message.includes('fetch failed')
}

export function getProviderModelLoadErrorMessage(error: unknown): string | null {
  if (shouldSuppressProviderModelLoadError(error)) {
    return null
  }

  return toUserFacingErrorMessage(error, 'Unable to load models.')
}
