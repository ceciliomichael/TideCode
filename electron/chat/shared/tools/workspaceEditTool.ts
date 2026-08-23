import { promises as fs } from 'node:fs'
import { notifyWorkspaceExplorerChange } from '../../../workspace/explorerNotifications'
import type { AgentToolExecutionResult } from '../toolTypes'
import {
  findExactMatchOffsets,
  findFuzzyLineMatchOffsets,
  findIndentationTolerantMatchOffsets,
} from './textReplacementMatching'
import type { WorkspaceToolContext } from './workspaceToolPaths'
import { resolveReadableTargetPath } from './workspaceToolPaths'
import { WorkspaceMutationError } from './workspaceMutationErrors'
import { enqueueWorkspaceMutation } from './workspaceMutationQueue'
import {
  computeContentRevision,
  preserveExistingTextFormat,
  writeTextFileAtomically,
} from './workspaceMutationSafety'
import {
  aggregateFileChangeItems,
  buildFileChangeResult,
  captureCheckpointFileStateIfNeeded,
  createSuccessResult,
  normalizeTextMutationContent,
} from './workspaceToolResults'

export interface EditOperationInput {
  targetContent: string
  replacementContent: string
  startLine?: number
  endLine?: number
  replaceAll?: boolean
  /** @deprecated Use replaceAll. Kept for direct internal callers during migration. */
  allowMultiple?: boolean
}

export interface EditChunk {
  targetContent: string
  replacementContent: string
  startLine?: number
  endLine?: number
  replaceAll?: boolean
}

export interface EditInput {
  path: string
  edits: EditOperationInput[]
  expectedRevision?: string
}

interface ResolvedTextReplacement {
  chunkIndex: number
  endOffset: number
  replacementContent: string
  startOffset: number
}

function getLineRangeOffsets(
  fileContent: string,
  chunk: EditChunk,
  displayPath: string,
): { endOffset: number; startOffset: number } {
  const startLine = chunk.startLine
  const endLine = chunk.endLine
  const lines = fileContent.split('\n')
  const totalLines = lines.length

  if (
    typeof startLine !== 'number' ||
    typeof endLine !== 'number' ||
    !Number.isInteger(startLine) ||
    !Number.isInteger(endLine) ||
    startLine < 1 ||
    endLine < startLine ||
    endLine > totalLines
  ) {
    throw new Error(
      `Invalid line range [${startLine}, ${endLine}] for file "${displayPath}" (${totalLines} lines total).`,
    )
  }

  let startOffset = 0
  for (let lineIndex = 0; lineIndex < startLine - 1; lineIndex += 1) {
    startOffset += lines[lineIndex].length + 1
  }

  let endOffset = startOffset
  for (
    let lineIndex = startLine - 1;
    lineIndex < endLine;
    lineIndex += 1
  ) {
    endOffset += lines[lineIndex].length
    if (lineIndex < endLine - 1) {
      endOffset += 1
    } else if (endLine < totalLines) {
      endOffset += 1
    }
  }

  return { endOffset, startOffset }
}

function resolveChunkReplacements(
  fileContent: string,
  chunk: EditChunk,
  displayPath: string,
  chunkIndex: number,
): ResolvedTextReplacement[] {
  if (chunk.targetContent.length === 0) {
    throw new Error(`Replacement chunk ${chunkIndex + 1} has empty target content.`)
  }

  const effectiveRange = chunk.startLine !== undefined && chunk.endLine !== undefined
    ? { endLine: chunk.endLine, startLine: chunk.startLine }
    : undefined

  const rangedTargetContent = chunk.targetContent.endsWith('\n')
    ? chunk.targetContent.slice(0, -1)
    : chunk.targetContent

  let matches = findExactMatchOffsets(fileContent, rangedTargetContent)
  if (matches.length === 0) {
    matches = findIndentationTolerantMatchOffsets(fileContent, rangedTargetContent)
  }

  if (matches.length === 0) {
    const fuzzyCandidates = findFuzzyLineMatchOffsets(fileContent, rangedTargetContent)
    const candidateHint = fuzzyCandidates.length > 0
      ? ` Closest candidate line range: ${formatMatchLineRange(fileContent, fuzzyCandidates[0])}.`
      : ''
    const rangeDescription = effectiveRange
      ? ` between lines ${effectiveRange.startLine} and ${effectiveRange.endLine}`
      : ''
    throw new WorkspaceMutationError(
      'TARGET_NOT_FOUND',
      'TARGET_MATCH',
      `Target content not found${rangeDescription} in "${displayPath}".${candidateHint} Reread the file and retry with exact current text.`,
    )
  }

  if (effectiveRange) {
    const range = getLineRangeOffsets(
      fileContent,
      {
        ...chunk,
        endLine: effectiveRange.endLine,
        startLine: effectiveRange.startLine,
      },
      displayPath,
    )
    matches = matches.filter(
      (match) => match.startOffset >= range.startOffset && match.endOffset <= range.endOffset,
    )
    if (matches.length === 0) {
      throw new WorkspaceMutationError(
        'TARGET_NOT_FOUND',
        'TARGET_MATCH',
        `Target content not found between lines ${effectiveRange.startLine} and ${effectiveRange.endLine} in "${displayPath}". Reread the file and retry with exact current text.`,
      )
    }
  }

  if (matches.length > 1 && !chunk.replaceAll) {
    const candidateRanges = [...new Set(matches.map((match) => formatMatchLineRange(fileContent, match)))].join(', ')
    const rangeDescription = effectiveRange
      ? ` between lines ${effectiveRange.startLine} and ${effectiveRange.endLine}`
      : ''
    throw new WorkspaceMutationError(
      'TARGET_AMBIGUOUS',
      'TARGET_MATCH',
      `Target content found ${matches.length} times${rangeDescription} in "${displayPath}". Candidate line ranges: ${candidateRanges}. Use a larger exact target, line bounds, or set replaceAll: true intentionally.`,
    )
  }

  const replacementContent = chunk.replacementContent.endsWith('\n')
    ? chunk.replacementContent.slice(0, -1)
    : chunk.replacementContent

  return matches.map(({ endOffset, startOffset }) => ({
    chunkIndex,
    endOffset,
    replacementContent,
    startOffset,
  }))
}

function formatMatchLineRange(fileContent: string, match: { endOffset: number; startOffset: number }) {
  const startLine = fileContent.slice(0, match.startOffset).split('\n').length
  const endLine = fileContent.slice(0, Math.max(match.startOffset, match.endOffset - 1)).split('\n').length
  return `${startLine}-${endLine}`
}

function applyResolvedTextReplacements(
  fileContent: string,
  replacements: readonly ResolvedTextReplacement[],
) {
  const sortedAscending = [...replacements].sort(
    (left, right) =>
      left.startOffset - right.startOffset || left.endOffset - right.endOffset,
  )

  for (let index = 1; index < sortedAscending.length; index += 1) {
    const previous = sortedAscending[index - 1]
    const current = sortedAscending[index]
    if (current.startOffset < previous.endOffset) {
      throw new WorkspaceMutationError(
        'OVERLAPPING_EDITS',
        'TARGET_MATCH',
        `Edit hunks ${previous.chunkIndex + 1} and ${current.chunkIndex + 1} resolve to overlapping source ranges. No changes were made. Reread the file and retry with non-overlapping targets.`,
      )
    }
  }

  let updatedContent = fileContent
  for (const replacement of sortedAscending.reverse()) {
    updatedContent =
      updatedContent.slice(0, replacement.startOffset) +
      replacement.replacementContent +
      updatedContent.slice(replacement.endOffset)
  }

  return updatedContent
}

export async function createEditToolResult(
  context: WorkspaceToolContext,
  input: EditInput,
): Promise<AgentToolExecutionResult> {
  const chunks = normalizeEditChunks(input)
  const target = resolveReadableTargetPath(
    context.workspaceRootPath,
    input.path,
    context.terminalExecutionMode,
  )

  return enqueueWorkspaceMutation(target.absolutePath, () =>
    createEditToolResultInternal(context, chunks, target, input.expectedRevision),
  )
}

async function createEditToolResultInternal(
  context: WorkspaceToolContext,
  chunks: EditChunk[],
  target: ReturnType<typeof resolveReadableTargetPath>,
  expectedRevision?: string,
): Promise<AgentToolExecutionResult> {
  let oldBytes: Buffer
  try {
    oldBytes = await fs.readFile(target.absolutePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new WorkspaceMutationError(
        'FILE_NOT_FOUND',
        'TARGET_MATCH',
        `File not found: "${target.displayPath}". Use write to create new files.`,
      )
    }
    throw error
  }

  if (expectedRevision !== undefined) {
    const currentRevision = computeContentRevision(oldBytes)
    if (currentRevision !== expectedRevision) {
      throw new WorkspaceMutationError(
        'REVISION_CONFLICT',
        'REVISION_CHECK',
        `Revision conflict for "${target.displayPath}". The file changed since the latest read. Reread it and retry the edit.`,
      )
    }
  }

  const oldContent = oldBytes.toString('utf8')
  const normalizedOld = normalizeTextMutationContent(oldContent)
  const replacements = chunks.flatMap((chunk, index) => {
    return resolveChunkReplacements(
      normalizedOld,
      chunk,
      target.displayPath,
      index,
    )
  })

  const newContent = applyResolvedTextReplacements(
    normalizedOld,
    replacements,
  )

  if (newContent === normalizedOld) {
    return createSuccessResult({
      body: `No changes were made to "${target.displayPath}" because the replacement content is identical to the target content.`,
      semantics: {
        changed_paths: [],
        operation: 'noop',
        reason: 'replacement_identical_to_target',
        updated_path_count: 0,
      },
      subject: { kind: 'file', path: target.displayPath },
      summary: `Skipped unchanged edit for ${target.displayPath}`,
    })
  }

  const serializedNewContent = preserveExistingTextFormat(newContent, oldContent)
  await captureCheckpointFileStateIfNeeded(context.checkpointId, target.absolutePath)
  try {
    await writeTextFileAtomically(target.absolutePath, serializedNewContent)
  } catch (error) {
    const stage = error instanceof Error && error.message.includes('Post-write verification failed')
      ? 'POST_WRITE_VERIFY'
      : 'FILESYSTEM_WRITE'
    const detail = error instanceof Error ? error.message : String(error)
    throw new WorkspaceMutationError(
      'WRITE_FAILED',
      stage,
      `Edit failed while persisting "${target.displayPath}": ${detail}`,
    )
  }
  notifyWorkspaceExplorerChange(context.workspaceRootPath)

  const fileChanges = aggregateFileChangeItems([
    {
      fileName: target.displayPath,
      newContent,
      oldContent: normalizedOld,
    },
  ])

  return buildFileChangeResult(
    `Edited 1 file${chunks.length > 1 ? ` in ${chunks.length} blocks` : ''}`,
    fileChanges,
    'edit',
    target.displayPath,
    'File content replaced successfully.',
  )
}

function normalizeEditChunks(input: EditInput): EditChunk[] {
  if (!Array.isArray(input.edits) || input.edits.length === 0) {
    throw new Error('Edit requires a non-empty edits array.')
  }

  const normalized = input.edits.map((operation, index) => normalizeEditChunk(
    operation,
    `Edit hunk ${index + 1}`,
  ))

  const changedChunks = normalized.filter(
    (chunk) => chunk.targetContent !== chunk.replacementContent,
  )

  return changedChunks.length > 0 ? changedChunks : normalized
}

function normalizeEditChunk(
  input: EditOperationInput,
  label: string,
): EditChunk {
  if (typeof input.targetContent !== 'string' || input.targetContent.length === 0) {
    throw new Error(`${label} requires non-empty targetContent.`)
  }
  if (typeof input.replacementContent !== 'string') {
    throw new Error(`${label} requires replacementContent. Use an empty string when deleting the target.`)
  }
  if ((input.startLine === undefined) !== (input.endLine === undefined)) {
    throw new Error(`${label} must provide both startLine and endLine when using a line range.`)
  }

  const startLine = input.startLine
  const endLine = input.endLine
  if (startLine !== undefined && endLine !== undefined && (
    !Number.isInteger(startLine) ||
    startLine < 1 ||
    !Number.isInteger(endLine) ||
    endLine < startLine
  )) {
    throw new Error(`${label} requires integer startLine and endLine values of at least 1 when using a line range.`)
  }

  return {
    endLine: input.endLine,
replaceAll: input.replaceAll ?? input.allowMultiple ?? false,
    replacementContent: normalizeTextMutationContent(input.replacementContent),
    startLine: input.startLine,
    targetContent: normalizeTextMutationContent(input.targetContent),
  }
}
