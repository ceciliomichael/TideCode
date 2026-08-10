import type { ChangeDiffToolResultItem, ToolInvocationTrace } from '../../types/chat'
import { getRelativeDisplayPath } from '../../lib/pathPresentation'
import { parseStructuredToolResultContent } from '../../lib/toolResultContent'
import { getKanbanToolInvocationHeaderLabel } from './kanbanToolInvocationPresentation'
import { isKanbanTool } from './kanbanToolInvocationKinds'
import { isFileEditTool, isFileMutationTool, isFileWriteTool } from './toolInvocationKinds'

import {
  getApplyPatchFileTargets,
  getBasename,
  getReadToolTarget,
  getSearchTarget,
  getToolPath,
  parseCompleteToolArguments,
  readFirstText,
  readSkillName,
} from './toolInvocationParsing'

import {
  detectFileMutationActionKind,
  formatEditVerb,
  formatWriteVerb,
} from './toolInvocationMutationPresentation'

function readPartialAction(argumentsText: string) {
  const match = /["']action["']\s*:\s*["']([^"']*)/u.exec(argumentsText)
  const action = match?.[1]?.trim()
  return action && action.length > 0 ? action : null
}

function getToolVerb(invocation: ToolInvocationTrace) {
  const parsedResult = invocation.resultContent ? parseStructuredToolResultContent(invocation.resultContent) : null
  const parsedArguments = parseCompleteToolArguments(invocation.argumentsText) as Record<string, unknown> | null
  const operation =
    parsedResult?.metadata?.semantics && typeof parsedResult.metadata.semantics.operation === 'string'
      ? parsedResult.metadata.semantics.operation
      : null

  if (invocation.toolName === 'memory') {
    const action = readFirstText([
      parsedArguments?.action,
      readPartialAction(invocation.argumentsText),
      parsedResult?.metadata?.semantics?.action,
    ])
    if (action === 'read_index') {
      return invocation.state === 'running' ? 'Reading memory index' : invocation.state === 'completed' ? 'Read memory index' : 'Memory index read failed'
    }
    if (action === 'read') {
      return invocation.state === 'running' ? 'Reading memory' : invocation.state === 'completed' ? 'Read memory' : 'Memory read failed'
    }
    if (action === 'write') {
      if (operation === 'unchanged') {
        return invocation.state === 'running' ? 'Checking memory' : invocation.state === 'completed' ? 'Kept memory' : 'Memory write failed'
      }
      return invocation.state === 'running' ? 'Recording memory' : invocation.state === 'completed' ? 'Recorded memory' : 'Memory write failed'
    }
    if (action === 'edit') {
      return invocation.state === 'running' ? 'Editing memory' : invocation.state === 'completed' ? 'Edited memory' : 'Memory edit failed'
    }
    if (action === 'forget') {
      return invocation.state === 'running' ? 'Forgetting memory' : invocation.state === 'completed' ? 'Forgot memory' : 'Memory forget failed'
    }
    return invocation.state === 'running' ? '' : invocation.state === 'completed' ? 'Completed memory' : 'Memory operation failed'
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
    return invocation.state === 'running'
      ? 'Starting'
      : invocation.state === 'completed'
        ? 'Started'
        : 'Start failed'
  }

  if (invocation.toolName === 'interact_terminal') {
    return invocation.state === 'running'
      ? 'Interacting with terminal'
      : invocation.state === 'completed'
        ? 'Interacted with terminal'
        : 'Terminal interaction failed'
  }

  if (invocation.toolName === 'get_terminal_output') {
    return invocation.state === 'running'
      ? 'Reading terminal'
      : invocation.state === 'completed'
        ? 'Read terminal'
        : 'Terminal read failed'
  }

  if (invocation.toolName === 'read_terminal') {
    const waitSeconds = parsedArguments?.wait_seconds
    return invocation.state === 'running'
      ? typeof waitSeconds === 'number' && waitSeconds === 0
        ? 'Reading terminal'
        : 'Waiting for terminal'
      : invocation.state === 'completed'
        ? 'Read terminal'
        : 'Terminal read failed'
  }

  if (invocation.toolName === 'terminate_terminal') {
    return invocation.state === 'running'
      ? 'Terminating terminal'
      : invocation.state === 'completed'
        ? 'Terminated terminal'
        : 'Terminal termination failed'
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

  if (invocation.toolName === 'plan_create') {
    return invocation.state === 'running'
      ? 'Creating plan'
      : invocation.state === 'completed'
        ? 'Created plan'
        : 'Plan creation failed'
  }

  if (invocation.toolName === 'plan_edit') {
    return invocation.state === 'running'
      ? 'Updating plan'
      : invocation.state === 'completed'
        ? 'Updated plan'
        : 'Plan update failed'
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

  if (invocation.toolName === 'mcp_tool_search') {
    return invocation.state === 'running'
      ? 'Searching for MCP'
      : invocation.state === 'completed'
        ? 'Searched for MCP'
        : 'MCP search failed'
  }

  if (invocation.toolName === 'execute_mcp') {
    return invocation.state === 'running'
      ? 'Running'
      : invocation.state === 'completed'
        ? 'Ran'
        : 'MCP tool failed'
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
  const parsedArguments = parseCompleteToolArguments(invocation.argumentsText) as Record<string, unknown>
  const parsedResult = invocation.resultContent ? parseStructuredToolResultContent(invocation.resultContent) : null

  if (invocation.toolName === 'memory') {
    const action = readFirstText([
      parsedArguments?.action,
      readPartialAction(invocation.argumentsText),
      parsedResult?.metadata?.semantics?.action,
    ])
    if (action === 'read_index') {
      return null
    }
    const rawPath = readFirstText([
      parsedArguments?.path,
      parsedResult?.metadata?.semantics?.path,
      parsedResult?.metadata?.subject?.path,
    ])
    if (!rawPath) {
      return null
    }
    const normalizedPath = rawPath.replace(/\\/g, '/')
    const foldersMarker = '.tidecode/memory/folders/'
    const markerIndex = normalizedPath.indexOf(foldersMarker)
    return markerIndex >= 0 ? normalizedPath.slice(markerIndex + foldersMarker.length) : getBasename(normalizedPath)
  }

  if (invocation.toolName === 'mcp_tool_search') {
    const parsedResult = invocation.resultContent ? parseStructuredToolResultContent(invocation.resultContent) : null
    const resultQuery = parsedResult?.metadata?.semantics?.query
    return readFirstText([parsedArguments?.query, resultQuery])
  }

  if (invocation.toolName === 'execute_mcp') {
    const parsedResult = invocation.resultContent ? parseStructuredToolResultContent(invocation.resultContent) : null
    const resultToolName = parsedResult?.metadata?.semantics?.mcp_tool_name
    const toolName = readFirstText([resultToolName, parsedArguments?.tool_name])
    if (!toolName) {
      return null
    }

    return `${toolName} mcp`
  }

  if (invocation.toolName === 'execute_terminal') {
    const commandText = readFirstText([parsedArguments?.command, parsedArguments?.cmd])
    if (commandText) {
      return commandText
    }
    return null
  }

  if (
    invocation.toolName === 'interact_terminal' ||
    invocation.toolName === 'read_terminal' ||
    invocation.toolName === 'terminate_terminal'
  ) {
    return null
  }

  if (invocation.toolName === 'get_terminal_output') {
    return null
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
  const target = getToolTarget(effectiveInvocation, workspaceRootPath)
  const verb = getToolVerb(effectiveInvocation)
  return target ? `${verb} ${target}` : verb
}
