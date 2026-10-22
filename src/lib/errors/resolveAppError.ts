import { getAppError, type AppErrorFeedback, type AppErrorId } from './errorCatalog'

export type ErrorItemKind = 'file' | 'folder' | 'item'

export interface ResolveAppErrorOptions {
  itemKind?: ErrorItemKind
  fallbackMessage?: string
}

function readErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error.trim()
  if (error instanceof Error) return error.message.trim()
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message.trim()
  }
  return ''
}

function readErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code.toUpperCase()
  }
  return ''
}

function unwrapTransportError(message: string): string {
  return message
    .replace(/^Error invoking remote method\s+['"][^'"]+['"]:\s*/iu, '')
    .replace(/^(?:Error|TypeError|RangeError|SyntaxError|ReferenceError):\s*/iu, '')
    .trim()
}

function safeItemName(value: string): string {
  const withoutQuotes = value.trim().replace(/^[\x27"\x60]+|[\x27"\x60]+$/gu, '')
  const segments = withoutQuotes.replace(/[\r\n\t]+/gu, ' ').split(/[\\/]/u).filter(Boolean)
  const name = segments[segments.length - 1] ?? ''
  return name.length <= 80 ? name : name.slice(0, 77) + '...'
}

function duplicateName(message: string): string | null {
  const explicitlyNamed = /\b(?:entry|file|directory|folder)\s+already\s+exists\s*:\s*(.+)$/iu.exec(message)
  if (explicitlyNamed?.[1]) return safeItemName(explicitlyNamed[1])
  const quoted = /\b(?:eexist|already exists)\b[^\x27"]*[\x27"]([^\x27"]+)[\x27"]/iu.exec(message)
  return quoted?.[1] ? safeItemName(quoted[1]) : null
}

function matchingFeedback(id: AppErrorId, message?: string): AppErrorFeedback {
  const feedback = getAppError(id)
  return message ? { ...feedback, message } : feedback
}

function friendlyDuplicate(errorMessage: string, operation: AppErrorId, itemKind?: ErrorItemKind): AppErrorFeedback {
  if (operation === 'project.add') return getAppError('project.alreadyAdded')

  const kind = itemKind ?? (operation === 'folder.create' ? 'folder' : operation === 'file.create' ? 'file' : 'item')
  const id = kind === 'folder' ? 'folder.nameExists' : kind === 'file' ? 'file.nameExists' : 'item.nameExists'
  const name = duplicateName(errorMessage)
  if (!name) return getAppError(id)
  const article = kind === 'item' ? 'An item' : kind === 'folder' ? 'A folder' : 'A file'
  return matchingFeedback(id, article + ' named “' + name + '” already exists. Choose a different name.')
}

// Plain, already-actionable validation text may be shown as-is. Internal errors,
// paths, stack traces, credentials and transport details must not pass this gate.
function isSafeUserMessage(message: string, rawMessage: string): boolean {
  if (!message || message.length > 240) return false
  if (/^Error invoking remote method/iu.test(rawMessage)) return false
  if (/^(?:Error|TypeError|SyntaxError|ReferenceError|RangeError):/iu.test(rawMessage)) return false
  if (/(?:\bERR_[A-Z0-9_]+|\bE(?:ACCES|EXIST|PERM|NOENT|CONNREFUSED|CONNRESET|PIPE|TIMEDOUT|NOSPC)\b)/u.test(message)) return false
  if (/(?:[A-Za-z]:\\|\/(?:Users|home|tmp|var|opt)\/|node_modules\/|\.tsx?:\d+|\.js:\d+)/u.test(message)) return false
  if (/(?:traceback|stack trace|exception|ipcmain|rpc|internal server error|failed to invoke|invalid token|api[_-]?key\s*[:=]|authorization\s*[:=])/iu.test(message)) return false
  if (/[{}\r\n]/u.test(message)) return false
  if (/^(?:Unable to (?:create that folder|switch conversations)|Failed to (?:fetch|invoke))/iu.test(message)) return false
  return true
}

/**
 * Resolve once at the operation boundary, before the original failure is lost.
 * Operation context is required for correct titles and domain-specific advice.
 * Never infer a specific cause from an unknown error.
 */
export function resolveAppError(
  error: unknown,
  operation: AppErrorId = 'app.unexpected',
  options: ResolveAppErrorOptions = {},
): AppErrorFeedback {
  const rawMessage = readErrorMessage(error)
  const message = unwrapTransportError(rawMessage)
  const normalized = message.toLowerCase()
  const code = readErrorCode(error)
  const fallback = getAppError(operation)
  const fallbackMessage = options.fallbackMessage ?? fallback.message

  if (!message && !code) return matchingFeedback(operation, fallbackMessage)

  if (normalized.includes('committed successfully but failed to push')) {
    return getAppError('git.partialSuccess')
  }

  if (normalized.includes('already exists') || normalized.includes('eexist') || code === 'EEXIST') {
    return friendlyDuplicate(message, operation, options.itemKind)
  }

  if (code === 'EACCES' || code === 'EPERM' || /permission denied|operation not permitted|eacces|eperm/iu.test(message)) {
    return getAppError('filesystem.permissionDenied')
  }

  if (code === 'ENOSPC' || /no space left|enospc/iu.test(message)) {
    return getAppError('filesystem.noSpace')
  }

  if (code === 'ENOENT' || /\benoent\b|(?:file|directory) does not exist/iu.test(message)) {
    return getAppError('filesystem.notFound')
  }

  if (/not a directory/iu.test(message)) return getAppError('filesystem.notFolder')
  if (/invalid name|illegal name|invalid argument/iu.test(message)) return getAppError('filesystem.invalidName')
  if (/name too long/iu.test(message)) return getAppError('filesystem.nameTooLong')

  if (/not a git repository/iu.test(message)) return getAppError('git.notRepository')
  if (/nothing to commit/iu.test(message)) return getAppError('git.nothingToCommit')
  if (/non-fast-forward|failed to push some refs|fetch first/iu.test(message)) return getAppError('git.pushRejected')
  if (/conflict/iu.test(message) && (operation.startsWith('git.') || /\bgit\b/iu.test(message))) {
    return getAppError('git.conflict')
  }
  if (/unknown terminal session|terminal session.*already exited/iu.test(message)) {
    return getAppError('terminal.unavailable')
  }

  if (/err_name_not_resolved|err_address_unreachable/iu.test(message)) return getAppError('network.websiteNotFound')
  if (/err_internet_disconnected/iu.test(message)) return getAppError('network.offline')
  if (/err_cert_/iu.test(message)) return getAppError('network.certificate')
  if (/err_connection/iu.test(message)) return getAppError('network.websiteUnreachable')

  if (/context_length|context window|too many tokens/iu.test(message)) return getAppError('model.contextLimit')
  if (/unauthorized|invalid api key|authentication|\b401\b/iu.test(message) || code === '401') {
    if (operation.startsWith('github.')) return getAppError('github.authentication')
    return getAppError('provider.authentication')
  }

  if (/rate limit|\b429\b/iu.test(message) || code === '429') return getAppError('network.rateLimit')
  if (/forbidden|\b403\b/iu.test(message) || code === '403') return getAppError('network.forbidden')
  if (/timed out|timeout|etimedout/iu.test(message) || code === 'ETIMEDOUT') {
    if (operation.startsWith('provider.') || operation.startsWith('model.')) {
      return matchingFeedback('network.timeout', 'The provider took too long to respond. Try again.')
    }
    return getAppError('network.timeout')
  }

  if (/fetch failed|econn|network error|connection refused|connection reset/iu.test(message) || /^ECONN/u.test(code)) {
    if (operation.startsWith('browser.')) return getAppError('network.websiteUnreachable')
    if (operation.startsWith('git.')) return getAppError('git.network')
    if (operation.startsWith('updates.')) return getAppError('updates.connection')
    if (operation.startsWith('mcp.')) return getAppError('mcp.connect')
    if (operation.startsWith('remote.')) return getAppError('remote.connect')
    if (operation.startsWith('provider.') || operation.startsWith('model.') || operation === 'app.unexpected') {
      return getAppError('provider.connect')
    }
    return matchingFeedback(operation, fallbackMessage)
  }

  if (/notreadableerror|could not be read|unable to read/iu.test(message)) {
    return matchingFeedback(operation, 'The item could not be read. Check that it is still available and try again.')
  }

  if (isSafeUserMessage(message, rawMessage)) return matchingFeedback(operation, message)
  return matchingFeedback(operation, fallbackMessage)
}

