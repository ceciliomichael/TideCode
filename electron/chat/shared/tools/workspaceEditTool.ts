import { promises as fs } from 'node:fs'
import path from 'node:path'
import { notifyWorkspaceExplorerChange } from '../../../workspace/explorerNotifications'
import type { AgentToolExecutionResult } from '../toolTypes'
import {
  findExactMatchOffsets,
  findIndentationTolerantMatchOffsets,
  type TextMatch,
} from './textReplacementMatching'
import type { WorkspaceToolContext } from './workspaceToolPaths'
import { resolveReadableTargetPath } from './workspaceToolPaths'
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
  allowMultiple: boolean
}

export interface EditChunk extends EditOperationInput {}

export interface EditInput {
  path: string
  targetContent?: string
  replacementContent?: string
  startLine?: number
  endLine?: number
  allowMultiple?: boolean
  edits?: readonly EditOperationInput[]
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

  let matchOffsets: TextMatch[] = []
  const hasStartLine = chunk.startLine !== undefined
  const hasEndLine = chunk.endLine !== undefined
  if (hasStartLine !== hasEndLine) {
    throw new Error(`Replacement chunk ${chunkIndex + 1} must provide both startLine and endLine when using a line range.`)
  }

  let usedWholeFileFallback = !hasStartLine

  if (hasStartLine && hasEndLine) {
    try {
      const range = getLineRangeOffsets(fileContent, chunk, displayPath)
      const region = fileContent.slice(range.startOffset, range.endOffset)
      matchOffsets = findExactMatchOffsets(
        region,
        chunk.targetContent,
        range.startOffset,
      )
      if (matchOffsets.length === 0) {
        matchOffsets = findIndentationTolerantMatchOffsets(
          region,
          chunk.targetContent,
          range.startOffset,
        )
      }
    } catch {
      // A stale line range can recover below when the exact target is unique.
    }
  }

  if (matchOffsets.length === 0) {
    matchOffsets = findExactMatchOffsets(fileContent, chunk.targetContent)
    usedWholeFileFallback = true
  }

  if (matchOffsets.length === 0) {
    matchOffsets = findIndentationTolerantMatchOffsets(fileContent, chunk.targetContent)
    usedWholeFileFallback = true
  }

  if (matchOffsets.length === 0) {
    throw new Error(
      `Target content not found in "${displayPath}". Read the current file and try again with current text.`,
    )
  }

  if (matchOffsets.length > 1 && !chunk.allowMultiple) {
    throw new Error(
      usedWholeFileFallback
        ? `Target content found ${matchOffsets.length} times in "${displayPath}". Read the file and use a line range that contains one match.`
        : `Target content found ${matchOffsets.length} times between lines ${chunk.startLine} and ${chunk.endLine} in "${displayPath}". Narrow the line range to one match.`,
    )
  }

  return matchOffsets.map(({ endOffset, startOffset }) => ({
    chunkIndex,
    endOffset,
    replacementContent: chunk.replacementContent,
    startOffset,
  }))
}

function applyResolvedTextReplacements(
  fileContent: string,
  replacements: readonly ResolvedTextReplacement[],
  displayPath: string,
) {
  const sortedAscending = [...replacements].sort(
    (left, right) =>
      left.startOffset - right.startOffset || left.endOffset - right.endOffset,
  )

  for (let index = 1; index < sortedAscending.length; index += 1) {
    const previous = sortedAscending[index - 1]
    const current = sortedAscending[index]
    if (current.startOffset < previous.endOffset) {
      throw new Error(
        `Replacement chunks ${previous.chunkIndex + 1} and ${current.chunkIndex + 1} overlap in "${displayPath}". ` +
          'Use distinct, non-overlapping target blocks.',
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

interface ActiveFileEditSession {
  baseContent: string
  replacements: ResolvedTextReplacement[]
  lastUpdated: number
}

const activeFileEditSessions = new Map<string, ActiveFileEditSession>()
const SESSION_TTL_MS = 10000

function getActiveFileEditSession(filePath: string): ActiveFileEditSession | null {
  const session = activeFileEditSessions.get(filePath)
  if (!session) return null
  if (Date.now() - session.lastUpdated > SESSION_TTL_MS) {
    activeFileEditSessions.delete(filePath)
    return null
  }
  return session
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

  const oldContent = await fs.readFile(target.absolutePath, 'utf8').catch(() => null)
  if (oldContent === null) {
    if (chunks.length !== 1) {
      throw new Error(`File not found: "${target.displayPath}".`)
    }

    const newContent = chunks[0].replacementContent
    await captureCheckpointFileStateIfNeeded(context.checkpointId, target.absolutePath)
    await fs.mkdir(path.dirname(target.absolutePath), { recursive: true })
    await fs.writeFile(target.absolutePath, newContent, 'utf8')
    notifyWorkspaceExplorerChange(context.workspaceRootPath)

    const fileChanges = aggregateFileChangeItems([
      {
        fileName: target.displayPath,
        newContent,
        oldContent: null,
      },
    ])

    return buildFileChangeResult(
      'Created 1 file',
      fileChanges,
      'edit',
      target.displayPath,
      'File created successfully.',
    )
  }

  const normalizedOld = normalizeTextMutationContent(oldContent)

  const session = getActiveFileEditSession(target.absolutePath)
  let replacements: ResolvedTextReplacement[] = []
  let usedSessionFallback = false

  try {
    replacements = chunks.flatMap((chunk, index) => resolveChunkReplacements(
      normalizedOld,
      chunk,
      target.displayPath,
      (session?.replacements.length ?? 0) + index,
    ))
  } catch (diskError) {
    if (session) {
      try {
        replacements = chunks.flatMap((chunk, index) => resolveChunkReplacements(
          session.baseContent,
          chunk,
          target.displayPath,
          session.replacements.length + index,
        ))
        usedSessionFallback = true
      } catch {
        throw diskError
      }
    } else {
      throw diskError
    }
  }

  let newContent: string
  if (usedSessionFallback && session) {
    const combinedReplacements = [...session.replacements, ...replacements]
    newContent = applyResolvedTextReplacements(
      session.baseContent,
      combinedReplacements,
      target.displayPath,
    )
    session.replacements = combinedReplacements
    session.lastUpdated = Date.now()
  } else {
    newContent = applyResolvedTextReplacements(
      normalizedOld,
      replacements,
      target.displayPath,
    )
    activeFileEditSessions.set(target.absolutePath, {
      baseContent: normalizedOld,
      replacements,
      lastUpdated: Date.now(),
    })
  }

  if (newContent === normalizedOld) {
    return createSuccessResult({
      body: `No changes were made to "${target.displayPath}" because the replacement content is identical to the target content.`,
      subject: { kind: 'file', path: target.displayPath },
      summary: `No changes made to ${target.displayPath}`,
    })
  }

  await captureCheckpointFileStateIfNeeded(context.checkpointId, target.absolutePath)
  await fs.writeFile(target.absolutePath, newContent, 'utf8')
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
  if (input.edits !== undefined) {
    if (input.edits.length === 0 || input.edits.length > 20) {
      throw new Error('Edit requires between 1 and 20 edit operations.')
    }

    return input.edits.map((operation, index) => {
      if (typeof operation.targetContent !== 'string' || operation.targetContent.length === 0) {
        throw new Error(`Edit operation ${index + 1} requires non-empty targetContent.`)
      }
      if (typeof operation.replacementContent !== 'string') {
        throw new Error(`Edit operation ${index + 1} requires replacementContent.`)
      }
      if (typeof operation.allowMultiple !== 'boolean') {
        throw new Error(`Edit operation ${index + 1} requires boolean allowMultiple.`)
      }
      if ((operation.startLine === undefined) !== (operation.endLine === undefined)) {
        throw new Error(`Edit operation ${index + 1} must provide both startLine and endLine when using a line range.`)
      }

      return {
        allowMultiple: operation.allowMultiple,
        endLine: operation.endLine,
        replacementContent: normalizeTextMutationContent(operation.replacementContent),
        startLine: operation.startLine,
        targetContent: normalizeTextMutationContent(operation.targetContent),
      }
    })
  }

  if (typeof input.targetContent !== 'string' || input.targetContent.length === 0) {
    throw new Error('Edit requires non-empty targetContent copied from the latest read result.')
  }
  if (typeof input.replacementContent !== 'string') {
    throw new Error('Edit requires replacementContent. Use an empty string when deleting the target.')
  }
  if (typeof input.allowMultiple !== 'boolean') {
    throw new Error('Edit requires boolean allowMultiple.')
  }
  if ((input.startLine === undefined) !== (input.endLine === undefined)) {
    throw new Error('Edit must provide both startLine and endLine when using a line range.')
  }

  return [{
    allowMultiple: input.allowMultiple,
    endLine: input.endLine,
    replacementContent: normalizeTextMutationContent(input.replacementContent),
    startLine: input.startLine,
    targetContent: normalizeTextMutationContent(input.targetContent),
  }]
}
