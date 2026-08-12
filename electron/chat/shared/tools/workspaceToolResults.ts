import { getDiffSummary } from '../../../../src/lib/textDiff'
import type { ChangeDiffToolResultItem } from '../../../../src/types/chat'
import { captureWorkspaceCheckpointFileState } from '../../../workspace/checkpoints'
import type { AgentToolExecutionResult } from '../toolTypes'

export function createSuccessResult(input: Omit<AgentToolExecutionResult, 'status'>): AgentToolExecutionResult {
  return {
    ...input,
    status: 'success',
  }
}

export function createErrorResult(summary: string, input?: Pick<AgentToolExecutionResult, 'body' | 'subject'>): AgentToolExecutionResult {
  return {
    ...(input?.body ? { body: input.body } : {}),
    status: 'error',
    ...(input?.subject ? { subject: input.subject } : {}),
    summary,
  }
}

export function normalizeTextMutationContent(content: string) {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function hasBinaryContent(buffer: Buffer) {
  const probeLength = Math.min(buffer.length, 1024)

  for (let index = 0; index < probeLength; index += 1) {
    if (buffer[index] === 0) {
      return true
    }
  }

  return false
}

function toFileChangeItem(
  fileName: string,
  kind: ChangeDiffToolResultItem['kind'],
  oldContent: string | null,
  newContent: string,
): ChangeDiffToolResultItem {
  const summary = getDiffSummary(oldContent, newContent)
  return {
    addedLineCount: summary.addedLineCount,
    fileName,
    kind,
    newContent,
    oldContent,
    removedLineCount: summary.removedLineCount,
  }
}

export function buildFileChangeResult(
  summary: string,
  changes: ChangeDiffToolResultItem[],
  operation: 'edit' | 'noop',
  subjectPath: string,
  bodyPrefix?: string,
) {
  const addedPathCount = changes.filter((change) => change.kind === 'add').length
  const deletedPathCount = changes.filter((change) => change.kind === 'delete').length
  const updatedPathCount = changes.filter((change) => change.kind === 'update').length
  const bodyLines = bodyPrefix ? [bodyPrefix, summary] : [summary]

  for (const change of changes) {
    const label = change.kind === 'add' ? 'A' : change.kind === 'delete' ? 'D' : 'M'
    bodyLines.push(`${label} ${change.fileName} (+${change.addedLineCount} -${change.removedLineCount})`)
  }

  return createSuccessResult({
    body: bodyLines.join('\n'),
    resultPresentation: {
      changes,
      kind: 'change_diff',
    },
    semantics: {
      added_path_count: addedPathCount,
      changed_paths: changes.map((change) => change.fileName),
      deleted_path_count: deletedPathCount,
      file_changes: changes.map((change) => ({
        added_line_count: change.addedLineCount,
        kind: change.kind,
        path: change.fileName,
        removed_line_count: change.removedLineCount,
      })),
      operation,
      updated_path_count: updatedPathCount,
    },
    subject: {
      kind: changes.length === 1 ? 'file' : 'workspace',
      path: subjectPath,
    },
    summary,
  })
}

function getFileChangeKind(
  oldContent: string | null,
  explicitKind: ChangeDiffToolResultItem['kind'] | undefined,
): ChangeDiffToolResultItem['kind'] {
  if (explicitKind === 'delete') {
    return 'delete'
  }

  return oldContent === null ? 'add' : 'update'
}

export function aggregateFileChangeItems(
  changes: Array<{
    fileName: string
    kind?: ChangeDiffToolResultItem['kind']
    newContent: string
    oldContent: string | null
  }>,
): ChangeDiffToolResultItem[] {
  const orderedFileNames: string[] = []
  const aggregatedByFileName = new Map<
    string,
    {
      kind?: ChangeDiffToolResultItem['kind']
      newContent: string
      oldContent: string | null
    }
  >()

  for (const change of changes) {
    const existingChange = aggregatedByFileName.get(change.fileName)
    if (!existingChange) {
      orderedFileNames.push(change.fileName)
      aggregatedByFileName.set(change.fileName, {
        ...(change.kind ? { kind: change.kind } : {}),
        newContent: change.newContent,
        oldContent: change.oldContent,
      })
      continue
    }

    existingChange.newContent = change.newContent
    if (change.kind) {
      existingChange.kind = change.kind
    }
  }

  return orderedFileNames.map((fileName) => {
    const change = aggregatedByFileName.get(fileName)
    if (!change) {
      throw new Error(`Missing aggregated file change for ${fileName}`)
    }

    return toFileChangeItem(fileName, getFileChangeKind(change.oldContent, change.kind), change.oldContent, change.newContent)
  })
}

export async function captureCheckpointFileStateIfNeeded(checkpointId: string | null | undefined, absolutePath: string) {
  const normalizedCheckpointId = checkpointId?.trim()
  if (!normalizedCheckpointId) {
    return
  }

  await captureWorkspaceCheckpointFileState(normalizedCheckpointId, absolutePath)
}
