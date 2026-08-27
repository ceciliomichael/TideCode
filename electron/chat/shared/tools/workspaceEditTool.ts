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
  targetContent?: string
  replacementContent?: string
  startLine?: number
  endLine?: number
  replaceAll?: boolean
  insertContent?: string
  insertAt?: 'start' | 'end'
  /** @deprecated Use replaceAll. Kept for direct internal callers during migration. */
  allowMultiple?: boolean
}

export type EditChunk =
  | {
      kind: 'text'
      targetContent: string
      replacementContent: string
      startLine?: number
      endLine?: number
      replaceAll?: boolean
    }
  | {
      kind: 'range'
      replacementContent: string
      startLine: number
      endLine: number
    }
  | {
      kind: 'insert'
      insertAt: 'start' | 'end'
      insertContent: string
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

const MAX_RECOVERY_CANDIDATE_CONTEXTS = 20
const RECOVERY_CONTEXT_RADIUS = 2

type MatchOffsets = { endOffset: number; startOffset: number }

function getMatchLineNumbers(fileContent: string, match: MatchOffsets) {
  const startLine = fileContent.slice(0, match.startOffset).split('\n').length
  const endLine = fileContent.slice(0, Math.max(match.startOffset, match.endOffset - 1)).split('\n').length
  return { endLine, startLine }
}

function createCandidateContexts(fileContent: string, matches: readonly MatchOffsets[]) {
  const lines = fileContent.split('\n')
  const seenRanges = new Set<string>()
  const contexts: Array<{
    content: string
    context_line_range: string
    line_range: string
  }> = []
  let uniqueMatchCount = 0

  for (const match of matches) {
    const { endLine, startLine } = getMatchLineNumbers(fileContent, match)
    const lineRange = startLine + '-' + endLine
    if (seenRanges.has(lineRange)) continue
    seenRanges.add(lineRange)
    uniqueMatchCount += 1
    if (contexts.length >= MAX_RECOVERY_CANDIDATE_CONTEXTS) continue

    const contextStartLine = Math.max(1, startLine - RECOVERY_CONTEXT_RADIUS)
    const contextEndLine = Math.min(lines.length, endLine + RECOVERY_CONTEXT_RADIUS)
    contexts.push({
      content: lines.slice(contextStartLine - 1, contextEndLine).join('\n'),
      context_line_range: contextStartLine + '-' + contextEndLine,
      line_range: lineRange,
    })
  }

  return {
    contexts,
    truncated: uniqueMatchCount > contexts.length,
  }
}

function getLineRangeOffsets(
  fileContent: string,
  chunk: { endLine?: number; startLine?: number },
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
  if (chunk.kind === 'insert') {
    const offset = chunk.insertAt === 'start' ? 0 : fileContent.length
    return [{
      chunkIndex,
      endOffset: offset,
      replacementContent: chunk.insertContent,
      startOffset: offset,
    }]
  }

  if (chunk.kind === 'range') {
    const range = getLineRangeOffsets(fileContent, chunk, displayPath)
    return [{
      chunkIndex,
      endOffset: range.endOffset,
      replacementContent: chunk.replacementContent,
      startOffset: range.startOffset,
    }]
  }

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
    const closestCandidate = fuzzyCandidates[0]
    const closestCandidateContext = closestCandidate
      ? createCandidateContexts(fileContent, [closestCandidate]).contexts[0]
      : undefined
    throw new WorkspaceMutationError(
      'TARGET_NOT_FOUND',
      'TARGET_MATCH',
      `Target content not found${rangeDescription} in "${displayPath}".${candidateHint} Reread the file and retry with exact current text.`,
      {
        closest_candidate_context: closestCandidateContext,
        closest_candidate_line_range: closestCandidate
          ? formatMatchLineRange(fileContent, closestCandidate)
          : undefined,
        hunk_index: chunkIndex + 1,
        requested_line_range: effectiveRange
          ? `${effectiveRange.startLine}-${effectiveRange.endLine}`
          : undefined,
      },
    )
  }

  if (effectiveRange) {
    const unboundedMatches = matches
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
      const recoveryContexts = createCandidateContexts(fileContent, unboundedMatches)
      throw new WorkspaceMutationError(
        'TARGET_NOT_FOUND',
        'TARGET_MATCH',
        `Target content not found between lines ${effectiveRange.startLine} and ${effectiveRange.endLine} in "${displayPath}". Reread the file and retry with exact current text.`,
        {
          candidate_contexts: recoveryContexts.contexts,
          ...(recoveryContexts.truncated ? { candidate_contexts_truncated: true } : {}),
          hunk_index: chunkIndex + 1,
          requested_line_range: `${effectiveRange.startLine}-${effectiveRange.endLine}`,
        },
      )
    }
  }

  if (matches.length > 1 && !chunk.replaceAll) {
    const candidateLineRanges = [...new Set(matches.map((match) => formatMatchLineRange(fileContent, match)))]
    const candidateRanges = candidateLineRanges.join(', ')
    const recoveryContexts = createCandidateContexts(fileContent, matches)
    const rangeDescription = effectiveRange
      ? ` between lines ${effectiveRange.startLine} and ${effectiveRange.endLine}`
      : ''
    throw new WorkspaceMutationError(
      'TARGET_AMBIGUOUS',
      'TARGET_MATCH',
      `Target content found ${matches.length} times${rangeDescription} in "${displayPath}". Candidate line ranges: ${candidateRanges}. Use a larger exact target, line bounds, or set replaceAll: true intentionally.`,
      {
        candidate_contexts: recoveryContexts.contexts,
        ...(recoveryContexts.truncated ? { candidate_contexts_truncated: true } : {}),
        candidate_line_ranges: candidateLineRanges,
        hunk_index: chunkIndex + 1,
        match_count: matches.length,
      },
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

function formatMatchLineRange(fileContent: string, match: MatchOffsets) {
  const { endLine, startLine } = getMatchLineNumbers(fileContent, match)
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
    const sharesInsertionPoint =
      current.startOffset === previous.startOffset &&
      (current.startOffset === current.endOffset || previous.startOffset === previous.endOffset)
    if (current.startOffset < previous.endOffset || sharesInsertionPoint) {
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

  return input.edits.map((operation, index) => normalizeEditChunk(
    operation,
    `Edit hunk ${index + 1}`,
  ))
}

function normalizeEditChunk(
  input: EditOperationInput,
  label: string,
): EditChunk {
  const hasInsertionFields = input.insertContent !== undefined || input.insertAt !== undefined
  if (hasInsertionFields) {
    if (typeof input.insertContent !== 'string' || input.insertContent.length === 0) {
      throw new Error(`${label} requires non-empty insertContent when using insertion.`)
    }
    if (input.insertAt !== 'start' && input.insertAt !== 'end') {
      throw new Error(`${label} requires insertAt to be "start" or "end" when using insertion.`)
    }
    if (
      input.targetContent !== undefined ||
      input.replacementContent !== undefined ||
      input.startLine !== undefined ||
      input.endLine !== undefined ||
      input.replaceAll !== undefined ||
      input.allowMultiple !== undefined
    ) {
      throw new Error(`${label} cannot combine insertion with replacement fields.`)
    }
    return {
      insertAt: input.insertAt,
      insertContent: normalizeTextMutationContent(input.insertContent),
      kind: 'insert',
    }
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

  const replacementContent = normalizeTextMutationContent(input.replacementContent)
  if (input.targetContent === undefined) {
    if (startLine === undefined || endLine === undefined) {
      throw new Error(`${label} requires targetContent or an exact startLine/endLine range.`)
    }
    if (input.replaceAll !== undefined || input.allowMultiple !== undefined) {
      throw new Error(`${label} cannot use replaceAll with an exact range replacement.`)
    }
    return {
      endLine,
      kind: 'range',
      replacementContent,
      startLine,
    }
  }

  if (typeof input.targetContent !== 'string' || input.targetContent.length === 0) {
    throw new Error(`${label} requires non-empty targetContent when using text replacement.`)
  }

  return {
    endLine,
    kind: 'text',
    replaceAll: input.replaceAll ?? input.allowMultiple ?? false,
    replacementContent,
    startLine,
    targetContent: normalizeTextMutationContent(input.targetContent),
  }
}
