import type { ChangeDiffToolResultItem, ToolInvocationTrace } from '../../types/chat'
import { getRelativeDisplayPath } from '../../lib/pathPresentation'
import { parseStructuredToolResultContent } from '../../lib/toolResultContent'
import { isFileEditTool, isFileMutationTool, isFileWriteTool } from './toolInvocationKinds'

interface ToolArgumentsValue {
  absolute_path?: unknown
  command?: unknown
  cmd?: unknown
  patchText?: unknown
  pattern?: unknown
  polling_ms?: unknown
  query?: unknown
  url?: unknown
  session_id?: unknown
  name?: unknown
}

function parseCompleteToolArguments(argumentsText: string): ToolArgumentsValue | null {
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

function extractPartialAbsolutePath(argumentsText: string) {
  const absolutePathMatch = argumentsText.match(/"absolute_path"\s*:\s*"((?:\\.|[^"])*)/u)
  if (!absolutePathMatch) {
    return null
  }

  const absolutePath = decodePartialJsonString(absolutePathMatch[1]).trim()
  return absolutePath.length > 0 ? absolutePath : null
}

function getAbsolutePath(invocation: ToolInvocationTrace) {
  const argumentsValue = parseCompleteToolArguments(invocation.argumentsText)

  if (typeof argumentsValue?.absolute_path === 'string' && argumentsValue.absolute_path.trim().length > 0) {
    return argumentsValue.absolute_path.trim()
  }

  return extractPartialAbsolutePath(invocation.argumentsText)
}

function getBasename(absolutePath: string) {
  const normalizedPath = absolutePath.replace(/\\/g, '/')
  const pathSegments = normalizedPath.split('/').filter((segment) => segment.length > 0)
  return pathSegments[pathSegments.length - 1] ?? absolutePath
}

function getReadToolTarget(path: string, workspaceRootPath?: string | null) {
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

function getApplyPatchFileTargets(invocation: ToolInvocationTrace) {
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

function readFirstText(value: unknown): string | null {
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
    for (const candidate of [record.path, record.absolute_path, record.file_path, record.name, record.query, record.command, record.cmd]) {
      const nextValue = readFirstText(candidate)
      if (nextValue) {
        return nextValue
      }
    }
  }

  return null
}

function getSearchTarget(argumentsText: string): string | null {
  const parsedArguments = parseCompleteToolArguments(argumentsText)
  const searchText = readFirstText([parsedArguments?.pattern, parsedArguments?.query])
  return searchText
}

function getWebFetchTarget(argumentsText: string): string | null {
  const parsedArguments = parseCompleteToolArguments(argumentsText)
  return readFirstText(parsedArguments?.url)
}

function readSessionId(value: unknown): string | null {
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

function readSkillName(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }

  return null
}

type FileMutationActionKind = 'create' | 'delete' | 'overwrite' | 'verify'

function readSemanticsCount(value: unknown, key: string) {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const semanticsRecord = value as Record<string, unknown>
  const countValue = semanticsRecord[key]
  return typeof countValue === 'number' && Number.isFinite(countValue) ? countValue : null
}

function detectFileMutationActionKind(
  invocation: ToolInvocationTrace,
  operation: string | null,
  semantics: Record<string, unknown> | null,
): FileMutationActionKind {
  const changeResultPresentation = invocation.resultPresentation?.kind === 'change_diff' ? invocation.resultPresentation : null
  if (changeResultPresentation && changeResultPresentation.changes.length === 1) {
    const [singleChange] = changeResultPresentation.changes
    if (singleChange.kind === 'add') {
      return 'create'
    }
    if (singleChange.kind === 'delete') {
      return 'delete'
    }
    return 'overwrite'
  }

  if (operation === 'noop') {
    return 'verify'
  }

  const addedPathCount = readSemanticsCount(semantics, 'added_path_count') ?? 0
  const deletedPathCount = readSemanticsCount(semantics, 'deleted_path_count') ?? 0
  const updatedPathCount = readSemanticsCount(semantics, 'updated_path_count') ?? 0
  const activeKindCount =
    Number(addedPathCount > 0) + Number(deletedPathCount > 0) + Number(updatedPathCount > 0)

  if (activeKindCount === 1) {
    if (addedPathCount > 0) {
      return 'create'
    }
    if (deletedPathCount > 0) {
      return 'delete'
    }
    if (updatedPathCount > 0) {
      return 'overwrite'
    }
  }

  return 'overwrite'
}

function formatWriteVerb(actionKind: FileMutationActionKind, state: ToolInvocationTrace['state']) {
  if (state === 'running') {
    if (actionKind === 'create') {
      return 'Creating'
    }
    if (actionKind === 'overwrite') {
      return 'Editing'
    }
    if (actionKind === 'delete') {
      return 'Deleting'
    }
    if (actionKind === 'verify') {
      return 'Verifying'
    }
    return 'Editing'
  }

  if (state === 'failed') {
    if (actionKind === 'create') {
      return 'Create failed'
    }
    if (actionKind === 'overwrite') {
      return 'Edit failed'
    }
    if (actionKind === 'delete') {
      return 'Delete failed'
    }
    if (actionKind === 'verify') {
      return 'Verify failed'
    }
    return 'Edit failed'
  }

  if (actionKind === 'create') {
    return 'Created'
  }
  if (actionKind === 'overwrite') {
    return 'Edited'
  }
  if (actionKind === 'delete') {
    return 'Deleted'
  }
  if (actionKind === 'verify') {
    return 'Verified'
  }
  return 'Edited'
}

function formatEditVerb(actionKind: 'create' | 'delete' | 'edit' | 'verify', state: ToolInvocationTrace['state']) {
  if (state === 'running') {
    if (actionKind === 'create') {
      return 'Creating'
    }
    if (actionKind === 'delete') {
      return 'Deleting'
    }
    if (actionKind === 'verify') {
      return 'Verifying'
    }
    return 'Editing'
  }

  if (state === 'failed') {
    if (actionKind === 'create') {
      return 'Create failed'
    }
    if (actionKind === 'delete') {
      return 'Delete failed'
    }
    if (actionKind === 'verify') {
      return 'Verify failed'
    }
    return 'Edit failed'
  }

  if (actionKind === 'create') {
    return 'Created'
  }
  if (actionKind === 'delete') {
    return 'Deleted'
  }
  if (actionKind === 'verify') {
    return 'Verified'
  }
  return 'Edited'
}

function getToolVerb(invocation: ToolInvocationTrace) {
  const parsedResult = invocation.resultContent ? parseStructuredToolResultContent(invocation.resultContent) : null
  const operation =
    parsedResult?.metadata?.semantics && typeof parsedResult.metadata.semantics.operation === 'string'
      ? parsedResult.metadata.semantics.operation
      : null

  if (invocation.toolName === 'list') {
    return invocation.state === 'running' ? 'Listing' : invocation.state === 'completed' ? 'Listed' : 'List failed'
  }

  if (invocation.toolName === 'glob' || invocation.toolName === 'grep') {
    return invocation.state === 'running'
      ? 'Searching'
      : invocation.state === 'completed'
        ? 'Searched'
        : 'Search failed'
  }

  if (invocation.toolName === 'read') {
    return invocation.state === 'running'
      ? 'Reading'
      : invocation.state === 'completed'
        ? 'Read'
        : 'Read failed'
  }

  if (isFileWriteTool(invocation.toolName) || isFileEditTool(invocation.toolName)) {
    const semantics =
      parsedResult?.metadata?.semantics && typeof parsedResult.metadata.semantics === 'object'
        ? parsedResult.metadata.semantics
        : null
    const actionKind = detectFileMutationActionKind(invocation, operation, semantics)
    return isFileWriteTool(invocation.toolName)
      ? formatWriteVerb(actionKind, invocation.state)
      : formatEditVerb(actionKind === 'overwrite' ? 'edit' : actionKind, invocation.state)
  }

  if (invocation.toolName === 'run_terminal') {
    return invocation.state === 'running'
      ? 'Running'
      : invocation.state === 'completed'
        ? 'Ran'
        : 'Run failed'
  }

  if (invocation.toolName === 'get_terminal_output') {
    return invocation.state === 'running'
      ? 'Polling'
      : invocation.state === 'completed'
        ? 'Terminal output'
        : 'Output fetch failed'
  }

  if (invocation.toolName === 'ready_implement') {
    if (invocation.state === 'running' && invocation.decisionRequest) {
      return 'Awaiting implementation approval'
    }

    return invocation.state === 'running'
      ? 'Preparing implementation gate'
      : invocation.state === 'completed'
        ? 'Recorded implementation decision'
        : 'Implementation gate failed'
  }

  if (invocation.toolName === 'ask_question') {
    if (invocation.state === 'running' && invocation.decisionRequest) {
      return 'Awaiting answer'
    }

    return invocation.state === 'running'
      ? 'Asking question'
      : invocation.state === 'completed'
        ? 'Question answered'
        : 'Question failed'
  }

  if (invocation.toolName === 'skill') {
    return invocation.state === 'running'
      ? 'Activating Skill'
      : invocation.state === 'completed'
        ? 'Activated Skill'
        : 'Skill activation failed'
  }

  if (invocation.toolName === 'web_search') {
    return invocation.state === 'running'
      ? 'Exploring the web'
      : invocation.state === 'completed'
        ? 'Searched the web'
        : 'Web exploration failed'
  }

  if (invocation.toolName === 'webfetch') {
    return invocation.state === 'running'
      ? 'Fetching'
      : invocation.state === 'completed'
        ? 'Fetched'
        : 'Fetch failed'
  }

  return invocation.state === 'running'
    ? `Running ${invocation.toolName}`
    : invocation.state === 'completed'
      ? `Completed ${invocation.toolName}`
      : `Failed ${invocation.toolName}`
}

export interface ToolInvocationDisplayEntry {
  invocation: ToolInvocationTrace
  key: string
}

export function getFileMutationGroupType(invocation: ToolInvocationTrace): 'creating' | 'overwriting' | 'editing' | null {
  if (isFileEditTool(invocation.toolName)) {
    return 'editing'
  }

  if (!isFileWriteTool(invocation.toolName)) {
    return null
  }

  const parsedResult = invocation.resultContent ? parseStructuredToolResultContent(invocation.resultContent) : null
  const operation =
    parsedResult?.metadata?.semantics && typeof parsedResult.metadata.semantics.operation === 'string'
      ? parsedResult.metadata.semantics.operation
      : null
  const semantics =
    parsedResult?.metadata?.semantics && typeof parsedResult.metadata.semantics === 'object'
      ? parsedResult.metadata.semantics
      : null
  const actionKind = detectFileMutationActionKind(invocation, operation, semantics)
  return actionKind === 'overwrite' ? 'overwriting' : 'creating'
}

export function getFileMutationSummaryKind(
  invocation: ToolInvocationTrace,
): 'created' | 'edited' | 'deleted' | 'verified' | null {
  if (!isFileWriteTool(invocation.toolName) && !isFileEditTool(invocation.toolName)) {
    return null
  }

  const changeResultPresentation = invocation.resultPresentation?.kind === 'change_diff' ? invocation.resultPresentation : null
  if (changeResultPresentation && changeResultPresentation.changes.length === 1) {
    const [singleChange] = changeResultPresentation.changes
    if (singleChange.kind === 'add') {
      return 'created'
    }
    if (singleChange.kind === 'delete') {
      return 'deleted'
    }
    return 'edited'
  }

  const parsedResult = invocation.resultContent ? parseStructuredToolResultContent(invocation.resultContent) : null
  const operation =
    parsedResult?.metadata?.semantics && typeof parsedResult.metadata.semantics.operation === 'string'
      ? parsedResult.metadata.semantics.operation
      : null
  const semantics =
    parsedResult?.metadata?.semantics && typeof parsedResult.metadata.semantics === 'object'
      ? parsedResult.metadata.semantics
      : null
  if (!parsedResult && !changeResultPresentation) {
    return null
  }

  const actionKind = detectFileMutationActionKind(invocation, operation, semantics)

  if (actionKind === 'create') {
    return 'created'
  }
  if (actionKind === 'delete') {
    return 'deleted'
  }
  if (actionKind === 'verify') {
    return 'verified'
  }

  return 'edited'
}

function getWholeFileChangeSingleChangeTarget(invocation: ToolInvocationTrace) {
  if (!isFileWriteTool(invocation.toolName) && !isFileEditTool(invocation.toolName)) {
    return null
  }

  const changeResultPresentation = invocation.resultPresentation?.kind === 'change_diff' ? invocation.resultPresentation : null
  if (!changeResultPresentation || changeResultPresentation.changes.length !== 1) {
    return null
  }

  const [singleChange] = changeResultPresentation.changes
  return getBasename(singleChange.fileName)
}

export function getToolInvocationDisplayEntries(invocation: ToolInvocationTrace): ToolInvocationDisplayEntry[] {
  if (isFileMutationTool(invocation.toolName) && invocation.state === 'running') {
    return []
  }

  const changeResultPresentation = invocation.resultPresentation?.kind === 'change_diff' ? invocation.resultPresentation : null
  if (
    (isFileWriteTool(invocation.toolName) || isFileEditTool(invocation.toolName)) &&
    invocation.state === 'completed' &&
    changeResultPresentation !== null &&
    changeResultPresentation.changes.length > 1
  ) {
    return changeResultPresentation.changes.map((change: ChangeDiffToolResultItem, index: number) => ({
      invocation: {
        ...invocation,
        id: `${invocation.id}:${index}`,
        resultPresentation: {
          changes: [change],
          kind: 'change_diff',
        },
      },
      key: `${invocation.id}:${index}:${change.fileName}`,
    }))
  }

  return [
    {
      invocation,
      key: invocation.id,
    },
  ]
}

function getToolTarget(invocation: ToolInvocationTrace, workspaceRootPath?: string | null) {
  const parsedArguments = parseCompleteToolArguments(invocation.argumentsText)

  if (invocation.toolName === 'run_terminal') {
    const commandText = readFirstText([parsedArguments?.command, parsedArguments?.cmd])
    if (commandText) {
      return commandText
    }

    const sessionIdText = readSessionId(parsedArguments?.session_id)
    return sessionIdText ? `session ${sessionIdText}` : null
  }

  if (invocation.toolName === 'get_terminal_output') {
    const sessionIdText = readSessionId(parsedArguments?.session_id)
    return sessionIdText ? `session ${sessionIdText}` : null
  }

  if (invocation.toolName === 'skill') {
    const skillNameText = readSkillName(parsedArguments?.name)
    if (skillNameText) {
      return skillNameText
    }
  }

  if (invocation.toolName === 'glob' || invocation.toolName === 'grep') {
    const searchTarget = getSearchTarget(invocation.argumentsText)
    if (searchTarget) {
      return searchTarget
    }
  }

  if (invocation.toolName === 'webfetch') {
    const fetchTarget = getWebFetchTarget(invocation.argumentsText)
    if (fetchTarget) {
      return fetchTarget
    }
  }

  const wholeFileChangeSingleChangeTarget = getWholeFileChangeSingleChangeTarget(invocation)
  if (wholeFileChangeSingleChangeTarget) {
    return wholeFileChangeSingleChangeTarget
  }

  const applyPatchTargets = getApplyPatchFileTargets(invocation)
  if (applyPatchTargets.length === 1) {
    return getBasename(applyPatchTargets[0])
  }

  const parsedResult = invocation.resultContent ? parseStructuredToolResultContent(invocation.resultContent) : null
  const structuredPath = parsedResult?.metadata?.subject?.path
  if (typeof structuredPath === 'string' && structuredPath.trim().length > 0) {
    const normalizedStructuredPath = structuredPath.trim()
    if ((isFileWriteTool(invocation.toolName) || isFileEditTool(invocation.toolName)) && normalizedStructuredPath === '.') {
      const absolutePath = getAbsolutePath(invocation)
      return absolutePath ? getBasename(absolutePath) : null
    }

    if (invocation.toolName === 'list' || invocation.toolName === 'glob' || invocation.toolName === 'grep' || invocation.toolName === 'read') {
      if (invocation.toolName === 'read') {
        return getReadToolTarget(normalizedStructuredPath, workspaceRootPath)
      }
      return normalizedStructuredPath
    }

    return getBasename(normalizedStructuredPath)
  }

  const absolutePath = getAbsolutePath(invocation)
  if (!absolutePath) {
    return null
  }

  if (invocation.toolName === 'list' || invocation.toolName === 'glob' || invocation.toolName === 'grep' || invocation.toolName === 'read') {
    if (invocation.toolName === 'read') {
      return getReadToolTarget(absolutePath, workspaceRootPath)
    }
    return workspaceRootPath ? getRelativeDisplayPath(workspaceRootPath, absolutePath) : absolutePath
  }

  return getBasename(absolutePath)
}

export function getToolInvocationHeaderLabel(
  invocation: ToolInvocationTrace,
  overrideState?: ToolInvocationTrace['state'],
  workspaceRootPath?: string | null,
) {
  const effectiveInvocation =
    overrideState === undefined
      ? invocation
      : {
          ...invocation,
          state: overrideState,
        }
  const target = getToolTarget(invocation, workspaceRootPath)
  return target ? `${getToolVerb(effectiveInvocation)} ${target}` : getToolVerb(effectiveInvocation)
}
