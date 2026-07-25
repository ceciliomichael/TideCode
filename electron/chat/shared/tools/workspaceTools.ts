import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { getDiffSummary } from '../../../../src/lib/textDiff'
import type { AppTerminalExecutionMode } from '../../../../src/types/chat'
import type { ChangeDiffToolResultItem } from '../../../../src/types/chat'
import { loadGitignoreMatchers, isGitignored, shouldAlwaysShowEntry, shouldIgnoreWorkspaceEntry } from '../../../workspace/gitignoreMatcher'
import {
  assertWorkspaceDirectory,
  DEFAULT_WORKSPACE_RELATIVE_PATH,
  getSafeWorkspaceTargetPath,
  normalizeWorkspacePath,
} from '../../../workspace/paths'
import { captureWorkspaceCheckpointFileState } from '../../../workspace/checkpoints'
import { applyPatchInWorkspace, type ApplyPatchChange } from '../applyPatch'

import type { AgentToolContext, AgentToolExecutionResult } from '../toolTypes'
import { runRipgrep } from './ripgrep'

const DEFAULT_READ_LIMIT = 2000
const LIST_LIMIT = 100
const SEARCH_LIMIT = 100
const MAX_LINE_LENGTH = 50000
const MAX_READ_BYTES = 256 * 1024
const RIPGREP_EXCLUDE_GLOBS: string[] = []
const RIPGREP_ALL_FILES_GLOBS = new Set(['**/*', '**/{*,.*}', '**'])

export type WorkspaceToolContext = Pick<AgentToolContext, 'checkpointId' | 'terminalExecutionMode' | 'workspaceRootPath'>
type GitignoreMatchers = Awaited<ReturnType<typeof loadGitignoreMatchers>>

export function resolveWorkspaceTargetPath(workspaceRootPath: string, candidatePath: string | undefined) {
  if (!candidatePath || candidatePath.trim().length === 0) {
    return {
      absolutePath: workspaceRootPath,
      relativePath: DEFAULT_WORKSPACE_RELATIVE_PATH,
    }
  }

  if (path.isAbsolute(candidatePath)) {
    return getSafeWorkspaceTargetPath(workspaceRootPath, path.relative(workspaceRootPath, candidatePath))
  }

  return getSafeWorkspaceTargetPath(workspaceRootPath, candidatePath)
}

function isPathWithinWorkspace(workspaceRootPath: string, targetPath: string) {
  const relativePath = path.relative(workspaceRootPath, targetPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

export function resolveReadableTargetPath(
  workspaceRootPath: string,
  candidatePath: string | undefined,
  terminalExecutionMode: AppTerminalExecutionMode = 'sandbox',
) {
  if (terminalExecutionMode === 'sandbox') {
    const target = resolveWorkspaceTargetPath(workspaceRootPath, candidatePath)
    return {
      absolutePath: target.absolutePath,
      displayPath: target.relativePath,
    }
  }

  if (!candidatePath || candidatePath.trim().length === 0) {
    return {
      absolutePath: workspaceRootPath,
      displayPath: DEFAULT_WORKSPACE_RELATIVE_PATH,
    }
  }

  const absolutePath = path.isAbsolute(candidatePath)
    ? path.resolve(candidatePath)
    : path.resolve(workspaceRootPath, candidatePath)
  const relativePath = path.relative(workspaceRootPath, absolutePath)

  return {
    absolutePath,
    displayPath: isPathWithinWorkspace(workspaceRootPath, absolutePath)
      ? relativePath === ''
        ? DEFAULT_WORKSPACE_RELATIVE_PATH
        : relativePath
      : absolutePath,
  }
}

function createSuccessResult(input: Omit<AgentToolExecutionResult, 'status'>): AgentToolExecutionResult {
  return {
    ...input,
    status: 'success',
  }
}

function createErrorResult(summary: string, input?: Pick<AgentToolExecutionResult, 'body' | 'subject'>): AgentToolExecutionResult {
  return {
    ...(input?.body ? { body: input.body } : {}),
    status: 'error',
    ...(input?.subject ? { subject: input.subject } : {}),
    summary,
  }
}

function normalizeTextMutationContent(content: string) {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function hasBinaryContent(buffer: Buffer) {
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

function buildFileChangeResult(
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

interface GrepMatch {
  filePath: string
  lineNumber: number
  lineText: string
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

function aggregateFileChangeItems(
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

function aggregateAppliedPatchChanges(changes: ApplyPatchChange[]): ChangeDiffToolResultItem[] {
  return aggregateFileChangeItems(
    changes.map((change) => ({
      fileName: change.relativePath,
      kind: change.type,
      newContent: change.newContent,
      oldContent: change.oldContent,
    })),
  )
}

function parseRipgrepOutputLine(line: string) {
  const [filePath, lineNumStr, ...lineTextParts] = line.split('|')
  if (!filePath || !lineNumStr || lineTextParts.length === 0) {
    return null
  }

  const lineNumber = Number.parseInt(lineNumStr, 10)
  if (!Number.isFinite(lineNumber)) {
    return null
  }

  return {
    filePath,
    lineNumber,
    lineText: lineTextParts.join('|'),
  }
}

function formatGrepOutput(matches: GrepMatch[], hasErrors: boolean) {
  if (matches.length === 0) {
    return {
      body: 'No files found',
      summary: 'No files found',
      truncated: false,
    }
  }

  const totalMatches = matches.length
  const truncated = totalMatches > SEARCH_LIMIT
  const visibleMatches = truncated ? matches.slice(0, SEARCH_LIMIT) : matches
  const outputLines = [`Found ${totalMatches} matches${truncated ? ` (showing first ${SEARCH_LIMIT})` : ''}`]

  let currentFilePath = ''
  for (const match of visibleMatches) {
    if (currentFilePath !== match.filePath) {
      if (currentFilePath !== '') {
        outputLines.push('')
      }
      currentFilePath = match.filePath
      outputLines.push(`${match.filePath}:`)
    }

    const truncatedLineText =
      match.lineText.length > MAX_LINE_LENGTH ? `${match.lineText.slice(0, MAX_LINE_LENGTH)}...` : match.lineText
    outputLines.push(`  Line ${match.lineNumber}: ${truncatedLineText}`)
  }

  if (truncated) {
    outputLines.push('')
    outputLines.push(
      `(Results truncated: showing ${SEARCH_LIMIT} of ${totalMatches} matches (${totalMatches - SEARCH_LIMIT} hidden). Consider using a more specific path or pattern.)`,
    )
  }

  if (hasErrors) {
    outputLines.push('')
    outputLines.push('(Some paths were inaccessible and skipped)')
  }

  return {
    body: outputLines.join('\n'),
    summary: `Found ${totalMatches} matches`,
    truncated,
  }
}

async function captureCheckpointFileStateIfNeeded(checkpointId: string | null | undefined, absolutePath: string) {
  const normalizedCheckpointId = checkpointId?.trim()
  if (!normalizedCheckpointId) {
    return
  }

  await captureWorkspaceCheckpointFileState(normalizedCheckpointId, absolutePath)
}

async function listImmediateDirectoryEntries(workspaceRootPath: string, directoryPath: string) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true })
  const gitignoreMatchers = await loadGitignoreMatchers(workspaceRootPath, directoryPath)
  const visibleEntries = entries
    .filter((entry) => !entry.isSymbolicLink())
    .filter((entry) => entry.isDirectory() || entry.isFile())
    .filter((entry) => !shouldIgnoreWorkspaceEntry(entry.name))
    .filter((entry) => {
      if (shouldAlwaysShowEntry(entry.name)) {
        return true
      }

      return !isGitignored(path.join(directoryPath, entry.name), entry.isDirectory(), gitignoreMatchers)
    })
    .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`)
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))

  return visibleEntries
}

function createWorkspaceEntryVisibilityFilter(workspaceRootPath: string) {
  const matcherCache = new Map<string, Promise<GitignoreMatchers>>()

  function loadCachedMatchers(directoryPath: string): Promise<GitignoreMatchers> {
    const normalizedDirectoryPath = path.resolve(directoryPath)
    let matchersPromise: Promise<GitignoreMatchers> | undefined = matcherCache.get(normalizedDirectoryPath)
    if (!matchersPromise) {
      matchersPromise = loadGitignoreMatchers(workspaceRootPath, normalizedDirectoryPath)
      matcherCache.set(normalizedDirectoryPath, matchersPromise)
    }

    return matchersPromise
  }

  return async (entryAbsolutePath: string, isDirectory: boolean) => {
    const workspaceRelativeSegments = path
      .relative(workspaceRootPath, entryAbsolutePath)
      .split(path.sep)
      .filter((segment) => segment.length > 0)

    if (workspaceRelativeSegments.some((segment) => shouldIgnoreWorkspaceEntry(segment))) {
      return false
    }

    const gitignoreMatchers = await loadCachedMatchers(path.dirname(entryAbsolutePath))
    return !isGitignored(entryAbsolutePath, isDirectory, gitignoreMatchers)
  }
}

function normalizeSearchIncludePattern(include: string | undefined) {
  const trimmedInclude = include?.trim()
  if (!trimmedInclude) {
    return null
  }

  if (RIPGREP_ALL_FILES_GLOBS.has(trimmedInclude)) {
    return null
  }

  return trimmedInclude
}

async function filterVisibleRelativeFileEntries(
  workspaceRootPath: string,
  baseAbsolutePath: string,
  relativeEntries: readonly string[],
) {
  const isVisibleEntry = createWorkspaceEntryVisibilityFilter(workspaceRootPath)
  const visibleEntries: string[] = []

  for (const relativeEntry of relativeEntries) {
    const entryAbsolutePath = path.resolve(baseAbsolutePath, relativeEntry)
    if (await isVisibleEntry(entryAbsolutePath, false)) {
      visibleEntries.push(relativeEntry)
    }
  }

  return visibleEntries
}

export async function createListToolResult(workspaceRootPath: string, absolutePath: string, relativePath: string) {
  const immediateEntries = await listImmediateDirectoryEntries(workspaceRootPath, absolutePath)
  const limitedEntries = immediateEntries.slice(0, LIST_LIMIT)

  const bodyLines = [...limitedEntries]
  if (immediateEntries.length > LIST_LIMIT) {
    bodyLines.push('', `(Showing ${LIST_LIMIT} of ${immediateEntries.length} entries. Refine the path or use glob/read next.)`)
  }

  return createSuccessResult({
    body: bodyLines.join('\n'),
    semantics: {
      count: immediateEntries.length,
    },
    subject: {
      kind: 'directory',
      path: relativePath,
    },
    summary: `Listed ${relativePath}`,
    truncated: immediateEntries.length > LIST_LIMIT,
  })
}

export async function createReadToolResult(
  absolutePath: string,
  displayPath: string,
  offset: number | undefined,
  limit: number | undefined,
) {
  const stats = await fs.stat(absolutePath)
  if (stats.isDirectory()) {
    const entries = await fs.readdir(absolutePath, { withFileTypes: true })
    const start = Math.max(0, (offset ?? 1) - 1)
    const maxEntries = limit ?? DEFAULT_READ_LIMIT
    const lines = entries
      .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`)
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
    const sliced = lines.slice(start, start + maxEntries)

    return createSuccessResult({
      body: sliced.join('\n'),
      semantics: {
        entry_count: lines.length,
        is_directory: true,
      },
      subject: {
        kind: 'directory',
        path: displayPath,
      },
      summary: `Read directory ${displayPath}`,
      truncated: start + sliced.length < lines.length,
    })
  }

  const probe = Buffer.alloc(Math.min(stats.size, 1024))
  if (probe.length > 0) {
    const fileHandle = await fs.open(absolutePath, 'r')
    try {
      await fileHandle.read(probe, 0, probe.length, 0)
    } finally {
      await fileHandle.close()
    }
  }

  if (hasBinaryContent(probe)) {
    return createErrorResult(`Cannot read binary file ${displayPath}`, {
      body: `Binary files are not supported by the read tool: ${absolutePath}`,
      subject: {
        kind: 'file',
        path: displayPath,
      },
    })
  }



  const startLine = Math.max(1, offset ?? 1)
  const maxLines = Math.max(1, limit ?? DEFAULT_READ_LIMIT)
  const stream = createReadStream(absolutePath, { encoding: 'utf8' })
  const reader = createInterface({
    crlfDelay: Infinity,
    input: stream,
  })

  const collectedLines: string[] = []
  let byteCount = 0
  let hasMoreLines = false
  let lineCount = 0
  let truncatedByBytes = false

  try {
    for await (const line of reader) {
      lineCount += 1
      if (lineCount < startLine) {
        continue
      }

      if (collectedLines.length >= maxLines) {
        hasMoreLines = true
        continue
      }

      const limitedLine =
        line.length > MAX_LINE_LENGTH
          ? `${line.slice(0, MAX_LINE_LENGTH)}... (line truncated, ${line.length} chars total)`
          : line
      const nextBytes = Buffer.byteLength(limitedLine, 'utf8') + (collectedLines.length > 0 ? 1 : 0)
      if (byteCount + nextBytes > MAX_READ_BYTES) {
        truncatedByBytes = true
        hasMoreLines = true
        break
      }

      collectedLines.push(limitedLine)
      byteCount += nextBytes
    }
  } finally {
    reader.close()
    stream.destroy()
  }

  const numberedLines = collectedLines.map((line, index) => `${startLine + index}: ${line}`)
  const bodyLines = [...numberedLines]
  if (!truncatedByBytes && !hasMoreLines && bodyLines.length > 0) {
    bodyLines.push('', `(End of file - ${lineCount} lines total)`)
  }

  return createSuccessResult({
    body: bodyLines.join('\n'),
    semantics: {
      is_directory: false,
      line_count: lineCount,
      offset: startLine,
      truncated_by_bytes: truncatedByBytes,
      truncated_by_lines: hasMoreLines && !truncatedByBytes,
    },
    subject: {
      kind: 'file',
      path: displayPath,
    },
    summary: `Read ${displayPath}`,
    truncated: truncatedByBytes || hasMoreLines,
  })
}

export async function createGlobToolResult(
  workspaceRootPath: string,
  absolutePath: string,
  relativePath: string,
  pattern: string,
) {
  const args = ['--files', '--hidden', '--glob', pattern]
  for (const globPattern of RIPGREP_EXCLUDE_GLOBS) {
    args.push('--glob', globPattern)
  }

  const result = await runRipgrep(args, absolutePath)
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    return createErrorResult(`Glob failed for ${relativePath}`, {
      body: result.stderr.trim() || `ripgrep exited with code ${result.exitCode}`,
      subject: {
        kind: 'directory',
        path: relativePath,
      },
    })
  }

  const relativeMatches = result.stdout
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  const visibleRelativeMatches = await filterVisibleRelativeFileEntries(workspaceRootPath, absolutePath, relativeMatches)
  const matches = visibleRelativeMatches.map((entry) => path.resolve(absolutePath, entry))
  const limitedMatches = matches.slice(0, SEARCH_LIMIT)
  const bodyLines = limitedMatches.length === 0 ? ['No files found'] : limitedMatches

  if (matches.length > SEARCH_LIMIT) {
    bodyLines.push('', `(Showing ${SEARCH_LIMIT} of ${matches.length} matches. Narrow the pattern or path.)`)
  }

  return createSuccessResult({
    body: bodyLines.join('\n'),
    semantics: {
      count: matches.length,
      pattern,
    },
    subject: {
      kind: 'directory',
      path: relativePath,
    },
    summary:
      matches.length === 0
        ? `No files matched ${pattern} in ${relativePath}`
        : `Found ${matches.length} file${matches.length === 1 ? '' : 's'} matching ${pattern}`,
    truncated: matches.length > SEARCH_LIMIT,
  })
}

export async function createGrepToolResult(
  workspaceRootPath: string,
  absolutePath: string,
  relativePath: string,
  pattern: string,
  include: string | undefined,
) {
  const stats = await fs.stat(absolutePath)
  if (!stats.isDirectory() && !stats.isFile()) {
    throw new Error(`Search path must be a file or directory: ${relativePath}`)
  }
  const subjectKind = stats.isDirectory() ? 'directory' : 'file'

  const args = ['-nH', '--hidden', '--no-messages', '--field-match-separator=|', '--regexp', pattern]
  const effectiveInclude = normalizeSearchIncludePattern(include)
  if (effectiveInclude) {
    args.push('--glob', effectiveInclude)
  }

  for (const globPattern of RIPGREP_EXCLUDE_GLOBS) {
    args.push('--glob', globPattern)
  }

  args.push(absolutePath)

  const result = await runRipgrep(args, workspaceRootPath)
  const output = result.stdout.trim()
  if (result.exitCode === 1 || (result.exitCode === 2 && output.length === 0)) {
    return createSuccessResult({
      body: 'No files found',
      semantics: {
        matches: 0,
        truncated: false,
      },
      subject: {
        kind: subjectKind,
        path: relativePath,
      },
      summary: 'No files found',
    })
  }

  if (result.exitCode !== 0 && result.exitCode !== 2) {
    throw new Error(`ripgrep failed: ${result.stderr}`)
  }

  const parsedMatches: GrepMatch[] = []
  const isVisibleEntry = createWorkspaceEntryVisibilityFilter(workspaceRootPath)
  for (const line of output.split(/\r?\n/u)) {
    if (!line) {
      continue
    }

    const parsedLine = parseRipgrepOutputLine(line)
    if (!parsedLine) {
      continue
    }

    if (!(await isVisibleEntry(parsedLine.filePath, false))) {
      continue
    }

    parsedMatches.push({
      filePath: parsedLine.filePath,
      lineNumber: parsedLine.lineNumber,
      lineText: parsedLine.lineText,
    })
  }

  parsedMatches.sort((left, right) => {
    if (left.filePath !== right.filePath) {
      return left.filePath.localeCompare(right.filePath, undefined, { sensitivity: 'base' })
    }

    return left.lineNumber - right.lineNumber
  })

  const formatted = formatGrepOutput(parsedMatches, result.exitCode === 2)
  return createSuccessResult({
    body: formatted.body,
    semantics: {
      matches: parsedMatches.length,
      truncated: formatted.truncated,
    },
    subject: {
      kind: subjectKind,
      path: relativePath,
    },
    summary: formatted.summary,
    truncated: formatted.truncated,
  })
}

export async function createWholeFileWriteToolResult(
  context: WorkspaceToolContext,
  input: {
    absolute_path: string
    content: string
  },
) {
  const resolvedChange = {
    content: normalizeTextMutationContent(input.content),
    target: resolveReadableTargetPath(
      context.workspaceRootPath,
      input.absolute_path,
      context.terminalExecutionMode,
    ),
  }

  const previousContent = await fs.readFile(resolvedChange.target.absolutePath, 'utf8').catch(() => null)
  const rawFileChanges: Array<{ fileName: string; newContent: string; oldContent: string | null }> = []

  if (previousContent === null || normalizeTextMutationContent(previousContent) !== resolvedChange.content) {
    await captureCheckpointFileStateIfNeeded(context.checkpointId, resolvedChange.target.absolutePath)
    await fs.mkdir(path.dirname(resolvedChange.target.absolutePath), { recursive: true })
    await fs.writeFile(resolvedChange.target.absolutePath, resolvedChange.content, 'utf8')
    rawFileChanges.push({
      fileName: resolvedChange.target.displayPath,
      newContent: resolvedChange.content,
      oldContent: previousContent,
    })
  } else {
    throw new Error(`Write did not change ${resolvedChange.target.displayPath}`)
  }

  const fileChanges = aggregateFileChangeItems(rawFileChanges)

  const subjectPath = resolvedChange.target.displayPath
  return buildFileChangeResult(
    `Wrote 1 file change`,
    fileChanges,
    'edit',
    subjectPath,
  )
}

export async function createApplyPatchToolResult(context: WorkspaceToolContext, patchText: string, basePath?: string) {
  const appliedPatch = await applyPatchInWorkspace(context.workspaceRootPath, patchText, {
    ...(basePath ? { basePath } : {}),
    onBeforeChange: async ({ absolutePath, nextAbsolutePath }) => {
      await captureCheckpointFileStateIfNeeded(context.checkpointId, absolutePath)
      if (nextAbsolutePath && nextAbsolutePath !== absolutePath) {
        await captureCheckpointFileStateIfNeeded(context.checkpointId, nextAbsolutePath)
      }
    },
    resolveTargetPath:
      context.terminalExecutionMode === 'full'
        ? (candidatePath) => {
            const target = resolveReadableTargetPath(context.workspaceRootPath, candidatePath, context.terminalExecutionMode)
            return {
              absolutePath: target.absolutePath,
              relativePath: target.displayPath,
            }
          }
        : undefined,
  })
  const changes = aggregateAppliedPatchChanges(appliedPatch.changes)
  const subjectPath = changes.length === 1 ? changes[0].fileName : DEFAULT_WORKSPACE_RELATIVE_PATH

  return buildFileChangeResult(
    `Patched ${changes.length} file${changes.length === 1 ? '' : 's'}`,
    changes,
    changes.length === 0 ? 'noop' : 'edit',
    subjectPath,
    changes.length === 0
      ? 'Patch parsed successfully, but no file content changed.'
      : 'Patch applied successfully. The files listed below were changed on disk.',
  )
}

export interface ReplaceFileContentChunk {
  targetContent: string
  replacementContent: string
  startLine: number
  endLine: number
  allowMultiple: boolean
}

export interface ReplaceFileContentInput {
  absolute_path: string
  targetContent: string
  replacementContent: string
  startLine: number
  endLine: number
  allowMultiple: boolean
}

export interface MultiReplaceFileContentInput {
  absolute_path: string
  chunks: ReplaceFileContentChunk[]
}

interface ResolvedTextReplacement {
  chunkIndex: number
  endOffset: number
  replacementContent: string
  startOffset: number
}

function getLineRangeOffsets(
  fileContent: string,
  chunk: ReplaceFileContentChunk,
  displayPath: string,
): { endOffset: number; startOffset: number } {
  const lines = fileContent.split('\n')
  const totalLines = lines.length

  if (
    !Number.isInteger(chunk.startLine) ||
    !Number.isInteger(chunk.endLine) ||
    chunk.startLine < 1 ||
    chunk.endLine < chunk.startLine ||
    chunk.endLine > totalLines
  ) {
    throw new Error(
      `Invalid line range [${chunk.startLine}, ${chunk.endLine}] for file "${displayPath}" (${totalLines} lines total).`,
    )
  }

  let startOffset = 0
  for (let lineIndex = 0; lineIndex < chunk.startLine - 1; lineIndex += 1) {
    startOffset += lines[lineIndex].length + 1
  }

  let endOffset = startOffset
  for (
    let lineIndex = chunk.startLine - 1;
    lineIndex < chunk.endLine;
    lineIndex += 1
  ) {
    endOffset += lines[lineIndex].length
    if (lineIndex < chunk.endLine - 1) {
      endOffset += 1
    }
  }

  return { endOffset, startOffset }
}

function findExactMatchOffsets(
  content: string,
  targetContent: string,
  baseOffset = 0,
) {
  const matchOffsets: number[] = []
  let searchOffset = 0

  while (searchOffset <= content.length - targetContent.length) {
    const matchOffset = content.indexOf(targetContent, searchOffset)
    if (matchOffset === -1) {
      break
    }

    matchOffsets.push(baseOffset + matchOffset)
    searchOffset = matchOffset + targetContent.length
  }

  return matchOffsets
}

function resolveChunkReplacements(
  fileContent: string,
  chunk: ReplaceFileContentChunk,
  displayPath: string,
  chunkIndex: number,
): ResolvedTextReplacement[] {
  if (chunk.targetContent.length === 0) {
    throw new Error(`Replacement chunk ${chunkIndex + 1} has empty target content.`)
  }

  let matchOffsets: number[] = []
  let usedWholeFileFallback = false

  try {
    const range = getLineRangeOffsets(fileContent, chunk, displayPath)
    const region = fileContent.slice(range.startOffset, range.endOffset)
    matchOffsets = findExactMatchOffsets(
      region,
      chunk.targetContent,
      range.startOffset,
    )
  } catch {
    // A stale line range can recover below when the exact target is unique.
  }

  if (matchOffsets.length === 0) {
    matchOffsets = findExactMatchOffsets(fileContent, chunk.targetContent)
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

  return matchOffsets.map((startOffset) => ({
    chunkIndex,
    endOffset: startOffset + chunk.targetContent.length,
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

export async function createReplaceFileContentToolResult(
  context: WorkspaceToolContext,
  input: ReplaceFileContentInput,
): Promise<AgentToolExecutionResult> {
  const target = resolveReadableTargetPath(
    context.workspaceRootPath,
    input.absolute_path,
    context.terminalExecutionMode,
  )

  const oldContent = await fs.readFile(target.absolutePath, 'utf8').catch(() => null)
  if (oldContent === null) {
    throw new Error(`File not found: "${target.displayPath}". Use the write tool to create new files.`)
  }

  const normalizedOld = normalizeTextMutationContent(oldContent)
  const chunk: ReplaceFileContentChunk = {
    allowMultiple: input.allowMultiple,
    endLine: input.endLine,
    replacementContent: normalizeTextMutationContent(input.replacementContent),
    startLine: input.startLine,
    targetContent: normalizeTextMutationContent(input.targetContent),
  }

  const replacements = resolveChunkReplacements(
    normalizedOld,
    chunk,
    target.displayPath,
    0,
  )
  const newContent = applyResolvedTextReplacements(
    normalizedOld,
    replacements,
    target.displayPath,
  )

  if (newContent === normalizedOld) {
    return createSuccessResult({
      body: `No changes were made to "${target.displayPath}" because the replacement content is identical to the target content.`,
      subject: { kind: 'file', path: target.displayPath },
      summary: `No changes made to ${target.displayPath}`,
    })
  }

  await captureCheckpointFileStateIfNeeded(context.checkpointId, target.absolutePath)
  await fs.writeFile(target.absolutePath, newContent, 'utf8')

  const fileChanges = aggregateFileChangeItems([
    {
      fileName: target.displayPath,
      newContent,
      oldContent: normalizedOld,
    },
  ])

  return buildFileChangeResult(
    `Edited 1 file`,
    fileChanges,
    'edit',
    target.displayPath,
    'File content replaced successfully.',
  )
}

export async function createMultiReplaceFileContentToolResult(
  context: WorkspaceToolContext,
  input: MultiReplaceFileContentInput,
): Promise<AgentToolExecutionResult> {
  if (!Array.isArray(input.chunks) || input.chunks.length === 0) {
    throw new Error('At least one replacement chunk must be provided.')
  }

  const target = resolveReadableTargetPath(
    context.workspaceRootPath,
    input.absolute_path,
    context.terminalExecutionMode,
  )

  const oldContent = await fs.readFile(target.absolutePath, 'utf8').catch(() => null)
  if (oldContent === null) {
    throw new Error(`File not found: "${target.displayPath}". Use the write tool to create new files.`)
  }

  const normalizedOld = normalizeTextMutationContent(oldContent)

  const normalizedChunks: ReplaceFileContentChunk[] = input.chunks.map((chunk) => ({
    allowMultiple: chunk.allowMultiple,
    endLine: chunk.endLine,
    replacementContent: normalizeTextMutationContent(chunk.replacementContent),
    startLine: chunk.startLine,
    targetContent: normalizeTextMutationContent(chunk.targetContent),
  }))

  const validationErrors: string[] = []
  const replacements: ResolvedTextReplacement[] = []
  for (const [chunkIndex, chunk] of normalizedChunks.entries()) {
    try {
      replacements.push(
        ...resolveChunkReplacements(
          normalizedOld,
          chunk,
          target.displayPath,
          chunkIndex,
        ),
      )
    } catch (error) {
      validationErrors.push(error instanceof Error ? error.message : String(error))
    }
  }

  if (validationErrors.length > 0) {
    throw new Error(`Multi-replace validation failed:\n${validationErrors.map((e, i) => `  ${i + 1}. ${e}`).join('\n')}`)
  }

  let workingContent: string
  try {
    workingContent = applyResolvedTextReplacements(
      normalizedOld,
      replacements,
      target.displayPath,
    )
  } catch (error) {
    throw new Error(
      `Multi-replace validation failed:\n  1. ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (workingContent === normalizedOld) {
    return createSuccessResult({
      body: `No changes were made to "${target.displayPath}" because all replacement contents were identical to their target contents.`,
      subject: { kind: 'file', path: target.displayPath },
      summary: `No changes made to ${target.displayPath}`,
    })
  }

  await captureCheckpointFileStateIfNeeded(context.checkpointId, target.absolutePath)
  await fs.writeFile(target.absolutePath, workingContent, 'utf8')

  const fileChanges = aggregateFileChangeItems([
    {
      fileName: target.displayPath,
      newContent: workingContent,
      oldContent: normalizedOld,
    },
  ])

  return buildFileChangeResult(
    `Edited 1 file`,
    fileChanges,
    'edit',
    target.displayPath,
    `File content replaced successfully (${input.chunks.length} chunk${input.chunks.length === 1 ? '' : 's'}).`,
  )
}

export async function createToolContext(input: AgentToolContext) {
  const workspaceRootPath = normalizeWorkspacePath(input.workspaceRootPath)
  await assertWorkspaceDirectory(workspaceRootPath)
  return {
    checkpointId: input.checkpointId?.trim() || null,
    terminalExecutionMode: input.terminalExecutionMode ?? 'sandbox',
    workspaceRootPath,
  }
}
