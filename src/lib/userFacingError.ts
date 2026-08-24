export type UserFacingErrorItemKind = 'file' | 'folder' | 'item'

export interface UserFacingErrorOptions {
  itemKind?: UserFacingErrorItemKind
}

function readErrorMessage(error: unknown) {
  if (error instanceof Error || typeof error === 'string') {
    const message = (error instanceof Error ? error.message : error).trim()
    return message.length > 0 ? message : null
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim().length > 0) {
      return message.trim()
    }
  }

  return null
}

function unwrapRemoteMethodMessage(message: string) {
  return message
    .replace(/^Error invoking remote method\s+['"][^'"]+['"]:\s*/iu, '')
    .replace(/^(?:Error|TypeError|RangeError|SyntaxError):\s*/u, '')
    .trim()
}

function sanitizeItemName(value: string) {
  const withoutQuotes = value.trim().replace(/^[`'"]+|[`'"]+$/gu, '')
  const withoutControlCharacters = withoutQuotes.replace(/[\r\n\t]+/gu, ' ').trim()
  const pathSegments = withoutControlCharacters.split(/[\\/]/u).filter((segment) => segment.length > 0)
  const itemName = pathSegments[pathSegments.length - 1] ?? withoutControlCharacters
  if (itemName.length <= 80) {
    return itemName
  }

  return `${itemName.slice(0, 77)}...`
}

function getExistingItemName(message: string) {
  const namedEntryMatch = /\b(?:entry|file|directory|folder)\s+already\s+exists\b\s*:\s*(.+)$/iu.exec(message)
  if (namedEntryMatch?.[1]) {
    return sanitizeItemName(namedEntryMatch[1])
  }

  const eexistPathMatch = /\b(?:eexist|already exists)\b[^'"]*['"]([^'"]+)['"]/iu.exec(message)
  return eexistPathMatch?.[1] ? sanitizeItemName(eexistPathMatch[1]) : null
}

function getDuplicateEntryMessage(message: string, itemKind?: UserFacingErrorItemKind) {
  const normalizedMessage = message.toLowerCase()
  if (!normalizedMessage.includes('already exists') && !normalizedMessage.includes('eexist')) {
    return null
  }

  const itemLabel = itemKind === 'folder' ? 'folder' : itemKind === 'file' ? 'file' : 'item'
  const itemName = getExistingItemName(message)
  return itemName
    ? `A ${itemLabel} named “${itemName}” already exists. Choose a different name.`
    : `An ${itemLabel} with that name already exists. Choose a different name.`
}

function getPartialGitSuccessMessage(message: string) {
  const normalizedMessage = message.toLowerCase()
  if (!normalizedMessage.includes('committed successfully but failed to push')) {
    return null
  }

  return 'The commit succeeded, but the push or pull request step failed. Your commit is still saved locally.'
}

export function toUserFacingErrorMessage(
  error: unknown,
  fallbackMessage: string,
  options: UserFacingErrorOptions = {},
) {
  const message = readErrorMessage(error)
  if (!message) {
    return fallbackMessage
  }

  const isRemoteMethodError = /^Error invoking remote method\s+['"][^'"]+['"]:/iu.test(message)
  const applicationMessage = unwrapRemoteMethodMessage(message)
  const normalizedMessage = applicationMessage.toLowerCase()
  const partialGitSuccessMessage = getPartialGitSuccessMessage(applicationMessage)
  if (partialGitSuccessMessage) {
    return partialGitSuccessMessage
  }

  const duplicateEntryMessage = getDuplicateEntryMessage(applicationMessage, options.itemKind)
  if (duplicateEntryMessage) {
    return duplicateEntryMessage
  }

  if (
    normalizedMessage.includes('permission denied') ||
    normalizedMessage.includes('operation not permitted') ||
    normalizedMessage.includes('eacces') ||
    normalizedMessage.includes('eperm')
  ) {
    return 'TideCode does not have permission to change that item. Check the folder permissions and try again.'
  }

  if (
    normalizedMessage.includes('invalid name') ||
    normalizedMessage.includes('illegal name') ||
    normalizedMessage.includes('invalid argument')
  ) {
    return 'That name is not valid here. Choose a different name and try again.'
  }

  if (normalizedMessage.includes('name too long')) {
    return 'That name is too long. Choose a shorter name and try again.'
  }

  if (
    normalizedMessage.includes('directory does not exist') ||
    normalizedMessage.includes('file does not exist') ||
    normalizedMessage.includes('enoent')
  ) {
    return 'That workspace item is no longer available. Refresh the explorer and try again.'
  }

  if (normalizedMessage.includes('not a directory')) {
    return 'That location is not a folder. Choose a different folder and try again.'
  }

  if (normalizedMessage.includes('not a git repository')) {
    return 'This workspace is not connected to a Git repository.'
  }

  if (normalizedMessage.includes('nothing to commit')) {
    return 'There are no new changes to commit.'
  }

  if (normalizedMessage.includes('non-fast-forward')) {
    return 'The remote has changes that are not in this workspace. Pull the latest changes, then try again.'
  }

  if (normalizedMessage.includes('conflict') && normalizedMessage.includes('git')) {
    return 'Git found a conflict. Resolve the conflicting files, then try again.'
  }

  if (
    normalizedMessage.includes('unknown terminal session') ||
    (normalizedMessage.includes('terminal session') && normalizedMessage.includes('already exited'))
  ) {
    return 'That terminal session is no longer available. Restart the terminal and try again.'
  }

  if (
    normalizedMessage.includes('notreadableerror') ||
    normalizedMessage.includes('could not be read') ||
    normalizedMessage.includes('unable to read')
  ) {
    return 'The item could not be read. Check that it is still available and try again.'
  }

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
    applicationMessage.length > 240 ||
    isRemoteMethodError ||
    normalizedMessage.includes('ipcmain') ||
    normalizedMessage.includes('nooutputgeneratederror') ||
    normalizedMessage.includes('ai_') ||
    /\s+at\s+\S+[:(]/u.test(applicationMessage)
  ) {
    return fallbackMessage
  }

  return applicationMessage
}
