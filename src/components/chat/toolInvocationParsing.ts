import type { ToolInvocationTrace } from '../../types/chat'
import { getRelativeDisplayPath } from '../../lib/pathPresentation'
import { parseStructuredToolResultContent } from '../../lib/toolResultContent'

interface ToolArgumentsValue {
  path?: unknown
  command?: unknown
  cmd?: unknown
  patchText?: unknown
  pattern?: unknown
  polling_ms?: unknown
  query?: unknown
  url?: unknown
  session_id?: unknown
  name?: unknown
  id?: unknown
  ids?: unknown
  args?: unknown
}

export function parseCompleteToolArguments(argumentsText: string): ToolArgumentsValue | null {
  try {
    const parsedValue = JSON.parse(argumentsText) as unknown
    if (typeof parsedValue !== 'object' || parsedValue === null) {
      return null
    }

    return parsedValue as ToolArgumentsValue
  } catch {
    return null
  }
}

/**
 * `execute_tool` is a model-facing transport. Once its target is known, the
 * visible invocation is represented as the native tool invocation so every
 * existing tool-specific presenter can be reused unchanged.
 */
export function resolveToolInvocationForPresentation(invocation: ToolInvocationTrace): ToolInvocationTrace {
  if (invocation.toolName !== 'execute_tool') {
    return invocation
  }

  const wrapperArguments = parseCompleteToolArguments(invocation.argumentsText) as (ToolArgumentsValue & {
    args?: unknown
    id?: unknown
  }) | null
  const parsedResult = invocation.resultContent ? parseStructuredToolResultContent(invocation.resultContent) : null
  const resultToolName = parsedResult?.metadata?.toolName
  const wrapperToolId = typeof wrapperArguments?.id === 'string'
    ? wrapperArguments.id.trim()
    : extractPartialStringArgument(invocation.argumentsText, 'id')
  const targetToolName = resultToolName && resultToolName !== 'execute_tool'
    ? resultToolName
    : wrapperToolId

  if (!targetToolName) {
    return invocation
  }

  const targetArguments = wrapperArguments?.args && typeof wrapperArguments.args === 'object' && !Array.isArray(wrapperArguments.args)
    ? wrapperArguments.args
    : parsedResult?.metadata?.arguments ?? {}

  return {
    ...invocation,
    argumentsText: JSON.stringify(targetArguments),
    toolName: targetToolName,
  }
}

function decodePartialJsonString(input: string) {
  let decodedValue = ''

  for (let index = 0; index < input.length; index += 1) {
    const currentCharacter = input[index]
    if (currentCharacter !== '\\') {
      decodedValue += currentCharacter
      continue
    }

    index += 1
    if (index >= input.length) {
      decodedValue += '\\'
      break
    }

    const escapedCharacter = input[index]
    if (escapedCharacter === '"' || escapedCharacter === '\\' || escapedCharacter === '/') {
      decodedValue += escapedCharacter
      continue
    }
    if (escapedCharacter === 'b') {
      decodedValue += '\b'
      continue
    }
    if (escapedCharacter === 'f') {
      decodedValue += '\f'
      continue
    }
    if (escapedCharacter === 'n') {
      decodedValue += '\n'
      continue
    }
    if (escapedCharacter === 'r') {
      decodedValue += '\r'
      continue
    }
    if (escapedCharacter === 't') {
      decodedValue += '\t'
      continue
    }
    if (escapedCharacter === 'u') {
      const unicodeHex = input.slice(index + 1, index + 5)
      if (/^[0-9a-fA-F]{4}$/.test(unicodeHex)) {
        decodedValue += String.fromCharCode(Number.parseInt(unicodeHex, 16))
        index += 4
        continue
      }
    }

    decodedValue += escapedCharacter
  }

  return decodedValue
}

export function extractPartialStringArgument(argumentsText: string, key: 'id' | 'path') {
  const argumentMatch = key === 'id'
    ? argumentsText.match(/"id"\s*:\s*"((?:\\.|[^"])*)/u)
    : argumentsText.match(/"path"\s*:\s*"((?:\\.|[^"])*)/u)
  if (!argumentMatch) {
    return null
  }

  const argumentValue = decodePartialJsonString(argumentMatch[1]).trim()
  return argumentValue.length > 0 ? argumentValue : null
}

export function getToolPath(invocation: ToolInvocationTrace) {
  const argumentsValue = parseCompleteToolArguments(invocation.argumentsText)

  if (typeof argumentsValue?.path === 'string' && argumentsValue.path.trim().length > 0) {
    return argumentsValue.path.trim()
  }

  return extractPartialStringArgument(invocation.argumentsText, 'path')
}

export function getBasename(absolutePath: string) {
  const normalizedPath = absolutePath.replace(/\\/g, '/')
  const pathSegments = normalizedPath.split('/').filter((segment) => segment.length > 0)
  return pathSegments[pathSegments.length - 1] ?? absolutePath
}

export function getReadToolTarget(path: string, workspaceRootPath?: string | null) {
  return getBasename(workspaceRootPath ? getRelativeDisplayPath(workspaceRootPath, path) : path)
}

function readPatchText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalizedValue = value.replace(/\r\n?/g, '\n').trim()
  return normalizedValue.length > 0 ? normalizedValue : null
}

function extractPatchFilePaths(patchText: string) {
  const filePaths: string[] = []
  const seenPaths = new Set<string>()
  const normalizedPatchText = patchText.replace(/\r\n?/g, '\n')
  const patchHeaderPattern = /^\*\*\* (?:Add|Delete|Update) File:\s+(.+)$/gmu

  for (const match of normalizedPatchText.matchAll(patchHeaderPattern)) {
    const filePath = match[1]?.trim()
    if (!filePath || seenPaths.has(filePath)) {
      continue
    }

    seenPaths.add(filePath)
    filePaths.push(filePath)
  }

  return filePaths
}

export function getApplyPatchFileTargets(invocation: ToolInvocationTrace) {
  if (invocation.toolName !== 'apply_patch') {
    return []
  }

  const parsedArguments = parseCompleteToolArguments(invocation.argumentsText)
  const patchText = readPatchText(parsedArguments?.patchText)
  if (!patchText) {
    return []
  }

  return extractPatchFilePaths(patchText)
}

export function readFirstText(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nextValue = readFirstText(entry)
      if (nextValue) {
        return nextValue
      }
    }
    return null
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }

  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    for (const candidate of [record.path, record.file_path, record.name, record.query, record.command, record.cmd]) {
      const nextValue = readFirstText(candidate)
      if (nextValue) {
        return nextValue
      }
    }
  }

  return null
}

export function getSearchTarget(argumentsText: string): string | null {
  const parsedArguments = parseCompleteToolArguments(argumentsText)
  const searchText = readFirstText([parsedArguments?.pattern, parsedArguments?.query])
  return searchText
}

export function readSessionId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.floor(value))
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsedValue = Number(value.trim())
    if (Number.isFinite(parsedValue)) {
      return String(Math.floor(parsedValue))
    }
  }

  return null
}

export function readSkillName(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }

  return null
}
