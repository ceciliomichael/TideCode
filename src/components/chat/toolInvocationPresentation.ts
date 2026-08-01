import type { ChangeDiffToolResultItem, ToolInvocationTrace } from '../../types/chat'
import { getRelativeDisplayPath } from '../../lib/pathPresentation'
import { parseStructuredToolResultContent } from '../../lib/toolResultContent'
import { getKanbanToolInvocationHeaderLabel } from './kanbanToolInvocationPresentation'
import { isKanbanTool } from './kanbanToolInvocationKinds'
import { isFileEditTool, isFileMutationTool, isFileWriteTool } from './toolInvocationKinds'

import {
  extractPartialStringArgument,
  getApplyPatchFileTargets,
  getBasename,
  getReadToolTarget,
  getSearchTarget,
  getToolPath,
  parseCompleteToolArguments,
  readFirstText,
  readSessionId,
  readSkillName,
  resolveToolInvocationForPresentation,
} from './toolInvocationParsing'
export { resolveToolInvocationForPresentation } from './toolInvocationParsing'

import {
  detectFileMutationActionKind,
  formatEditVerb,
  formatWriteVerb,
} from './toolInvocationMutationPresentation'

function getToolVerb(invocation: ToolInvocationTrace) {
  const parsedResult = invocation.resultContent ? parseStructuredToolResultContent(invocation.resultContent) : null
  const operation =
    parsedResult?.metadata?.semantics && typeof parsedResult.metadata.semantics.operation === 'string'
      ? parsedResult.metadata.semantics.operation
      : null

  if (invocation.toolName === 'list_tools') {
    const query = parseCompleteToolArguments(invocation.argumentsText)?.query
    const queryText = typeof query === 'string' && query.trim().length > 0 ? query.trim() : null
    if (queryText) {
      return invocation.state === 'running'
        ? `Searching ${queryText} in tool set`
        : invocation.state === 'completed'
          ? `Searched ${queryText} in tool set`
          : `Search failed for ${queryText} in tool set`
    }

    return invocation.state === 'running'
      ? 'Listing tool set'
      : invocation.state === 'completed'
        ? 'Listed tool set'
        : 'List tool set failed'
  }

  if (invocation.toolName === 'get_tool_schema') {
    const argumentsValue = parseCompleteToolArguments(invocation.argumentsText)
    const ids = Array.isArray(argumentsValue?.ids)
      ? argumentsValue.ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map((id) => id.trim())
      : []
    const id = typeof argumentsValue?.id === 'string' && argumentsValue.id.trim().length > 0
      ? argumentsValue.id.trim()
      : null
    const targetText = ids.length > 0 ? ids.join(', ') : id ?? 'tool'
    const targetCount = ids.length > 0 ? ids.length : id ? 1 : 0
    const schemaNoun = targetCount === 1 ? 'schema' : 'schemas'
    return invocation.state === 'running'
      ? `Fetching ${schemaNoun} for ${targetText}`
      : invocation.state === 'completed'
        ? `Fetched ${schemaNoun} for ${targetText}`
        : `Fetch ${schemaNoun} failed for ${targetText}`
  }

  if (invocation.toolName === 'execute_tool') {
    const id = parseCompleteToolArguments(invocation.argumentsText)?.id
    const idText = typeof id === 'string' && id.trim().length > 0
      ? id.trim()
      : extractPartialStringArgument(invocation.argumentsText, 'id')
    return invocation.state === 'running'
      ? idText ? `Executing ${idText}` : 'Preparing tool'
      : invocation.state === 'completed'
        ? idText ? `Completed ${idText}` : 'Tool completed'
        : idText ? `Failed ${idText}` : 'Tool failed'
  }

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

  if (invocation.toolName === 'execute_terminal') {
    const parsedArgs = parseCompleteToolArguments(invocation.argumentsText) as Record<string, unknown>
    const mode = parsedArgs?.mode || 'execute'
    if (mode === 'read') {
      return invocation.state === 'running'
        ? 'Reading'
        : invocation.state === 'completed'
          ? 'Read'
          : 'Read failed'
    }
    if (mode === 'list') {
      return invocation.state === 'running'
        ? 'Listing terminal sessions'
        : invocation.state === 'completed'
          ? 'Listed terminal sessions'
          : 'List sessions failed'
    }
    if (mode === 'end') {
      return invocation.state === 'running'
        ? 'Terminating'
        : invocation.state === 'completed'
          ? 'Terminated'
          : 'Terminate failed'
    }
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
    const parsedArgs = parseCompleteToolArguments(invocation.argumentsText) as Record<string, unknown>
    const action = parsedArgs?.action || 'load'

    if (action === 'list') {
      return invocation.state === 'running'
        ? 'Listing skills'
        : invocation.state === 'completed'
          ? 'Listed skills'
          : 'List skills failed'
    }

    if (action === 'search') {
      return invocation.state === 'running'
        ? 'Searching skills'
        : invocation.state === 'completed'
          ? 'Searched skills'
          : 'Skill search failed'
    }

    return invocation.state === 'running'
      ? 'Activating Skill'
      : invocation.state === 'completed'
        ? 'Activated Skill'
        : 'Skill activation failed'
  }

  if (invocation.toolName === 'web_search') {
    return invocation.state === 'running'
      ? 'Searching the web'
      : invocation.state === 'completed'
        ? 'Searched the web'
        : 'Web exploration failed'
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
  invocation = resolveToolInvocationForPresentation(invocation)
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
  invocation = resolveToolInvocationForPresentation(invocation)
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
  invocation = resolveToolInvocationForPresentation(invocation)
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
  invocation = resolveToolInvocationForPresentation(invocation)
  if (invocation.toolName === 'execute_tool' && invocation.state === 'running') {
    return []
  }
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
  const parsedArguments = parseCompleteToolArguments(invocation.argumentsText) as Record<string, unknown>

  if (invocation.toolName === 'execute_terminal') {
    const mode = parsedArguments?.mode || 'execute'
    
    if (mode === 'list') {
      return null
    }
    
    if (mode === 'read' || mode === 'end') {
      const sessionIdText = readSessionId(parsedArguments?.session_id)
      return sessionIdText ? `session ${sessionIdText}` : null
    }

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
    const action = parsedArguments?.action || 'load'
    if (action === 'list') {
      return null
    }

    if (action === 'search') {
      return readFirstText(parsedArguments?.query)
    }

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

  // Precise-edit tools identify their target file through path.
  if (invocation.toolName === 'edit') {
    const toolPath = getToolPath(invocation)
    return toolPath ? getBasename(toolPath) : null
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
      const toolPath = getToolPath(invocation)
      return toolPath ? getBasename(toolPath) : null
    }

    if (invocation.toolName === 'list' || invocation.toolName === 'glob' || invocation.toolName === 'grep' || invocation.toolName === 'read') {
      if (invocation.toolName === 'read') {
        return getReadToolTarget(normalizedStructuredPath, workspaceRootPath)
      }
      return normalizedStructuredPath
    }

    return getBasename(normalizedStructuredPath)
  }

  const toolPath = getToolPath(invocation)
  if (!toolPath) {
    return null
  }

  if (invocation.toolName === 'list' || invocation.toolName === 'glob' || invocation.toolName === 'grep' || invocation.toolName === 'read') {
    if (invocation.toolName === 'read') {
      return getReadToolTarget(toolPath, workspaceRootPath)
    }
    return workspaceRootPath ? getRelativeDisplayPath(workspaceRootPath, toolPath) : toolPath
  }

  return getBasename(toolPath)
}

export function getToolInvocationHeaderLabel(
  invocation: ToolInvocationTrace,
  overrideState?: ToolInvocationTrace['state'],
  workspaceRootPath?: string | null,
) {
  invocation = resolveToolInvocationForPresentation(invocation)
  if (isKanbanTool(invocation.toolName)) {
    const effectiveInvocation =
      overrideState === undefined
        ? invocation
        : {
            ...invocation,
            state: overrideState,
          }
    return getKanbanToolInvocationHeaderLabel(effectiveInvocation)
  }

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
