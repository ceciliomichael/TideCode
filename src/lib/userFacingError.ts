function readErrorMessage(error: unknown) {
  if (error instanceof Error || typeof error === 'string') {
    const message = (error instanceof Error ? error.message : error).trim()
    return message.length > 0 ? message : null
  }

  return null
}

export function toUserFacingErrorMessage(error: unknown, fallbackMessage: string) {
  const message = readErrorMessage(error)
  if (!message) {
    return fallbackMessage
  }

  const normalizedMessage = message.toLowerCase()
  if (
    normalizedMessage.includes('context_length') ||
    normalizedMessage.includes('context window') ||
    normalizedMessage.includes('too many tokens')
  ) {
    return 'This chat is too large for the selected model. Compress it manually or start a new chat.'
  }

  if (
    normalizedMessage.includes('unauthorized') ||
    normalizedMessage.includes('invalid api key') ||
    normalizedMessage.includes('authentication') ||
    /\b401\b/u.test(normalizedMessage)
  ) {
    return 'The provider rejected the connection. Check its account or API key in Settings.'
  }

  if (
    normalizedMessage.includes('fetch failed') ||
    normalizedMessage.includes('econn') ||
    normalizedMessage.includes('network error')
  ) {
    return 'The provider could not be reached. Check your connection and try again.'
  }

  if (
    normalizedMessage.includes('timed out') ||
    normalizedMessage.includes('timeout') ||
    normalizedMessage.includes('etimedout')
  ) {
    return 'The provider took too long to respond. Try again.'
  }

  if (
    message.length > 240 ||
    normalizedMessage.includes('error invoking remote method') ||
    normalizedMessage.includes('ipcmain') ||
    normalizedMessage.includes('nooutputgeneratederror') ||
    normalizedMessage.includes('ai_') ||
    /\s+at\s+\S+[:(]/u.test(message)
  ) {
    return fallbackMessage
  }

  return message
}
