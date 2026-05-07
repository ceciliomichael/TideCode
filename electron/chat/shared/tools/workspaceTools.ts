import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { jsonSchema, tool } from 'ai'
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
const MAX_LINE_LENGTH = 2000
const MAX_READ_BYTES = 50 * 1024
const MAX_READ_BYTES_LABEL = `${MAX_READ_BYTES / 1024} KB`
const RIPGREP_EXCLUDE_GLOBS = ['!**/.git', '!**/.git/**', '!**/node_modules', '!**/node_modules/**', '!**/.next', '!**/.next/**']
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
        line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}... (line truncated)` : line
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

  if (lineCount < startLine && !(lineCount === 0 && startLine === 1)) {
    return createErrorResult(`Offset ${startLine} is out of range for ${displayPath}`, {
      subject: {
        kind: 'file',
        path: displayPath,
      },
    })
  }

  const numberedLines = collectedLines.map((line, index) => `${startLine + index}: ${line}`)
  const bodyLines = [...numberedLines]
  if (truncatedByBytes) {
    bodyLines.push('', `(Output capped at ${MAX_READ_BYTES_LABEL}. Continue with offset=${startLine + collectedLines.length}.)`)
  } else if (hasMoreLines) {
    bodyLines.push(
      '',
      `(Showing lines ${startLine}-${startLine + collectedLines.length - 1} of ${lineCount}. Continue with offset=${startLine + collectedLines.length}.)`,
    )
  } else {
    bodyLines.push('', `(End of file - ${lineCount} lines total)`)
  }

  return createSuccessResult({
    body: bodyLines.join('\n'),
    semantics: {
      is_directory: false,
      line_count: lineCount,
      offset: startLine,
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

async function createWholeFileWriteToolResult(
  context: WorkspaceToolContext,
  input: {
    changes: Array<{
      absolute_path: string
      content: string
    }>
  },
) {
  const resolvedChanges = input.changes.map((change) => ({
    content: normalizeTextMutationContent(change.content),
    target: resolveReadableTargetPath(
      context.workspaceRootPath,
      change.absolute_path,
      context.terminalExecutionMode,
    ),
  }))
  const originalContentByPath = new Map<string, string | null>()

  for (const change of resolvedChanges) {
    if (originalContentByPath.has(change.target.absolutePath)) {
      continue
    }

    originalContentByPath.set(change.target.absolutePath, await fs.readFile(change.target.absolutePath, 'utf8').catch(() => null))
  }
  const rawFileChanges: Array<{ fileName: string; newContent: string; oldContent: string | null }> = []

  for (const change of resolvedChanges) {
    const previousContent = originalContentByPath.get(change.target.absolutePath) ?? null
    if (previousContent !== null && normalizeTextMutationContent(previousContent) === change.content) {
      throw new Error(`Write did not change ${change.target.displayPath}`)
    }

    await captureCheckpointFileStateIfNeeded(context.checkpointId, change.target.absolutePath)
    await fs.mkdir(path.dirname(change.target.absolutePath), { recursive: true })
    await fs.writeFile(change.target.absolutePath, change.content, 'utf8')
    rawFileChanges.push({
      fileName: change.target.displayPath,
      newContent: change.content,
      oldContent: previousContent,
    })
  }

  const fileChanges = aggregateFileChangeItems(rawFileChanges)

  const subjectPath = fileChanges.length === 1 ? fileChanges[0].fileName : DEFAULT_WORKSPACE_RELATIVE_PATH
  return buildFileChangeResult(
    `Wrote ${fileChanges.length} file change${fileChanges.length === 1 ? '' : 's'}`,
    fileChanges,
    fileChanges.length === 0 ? 'noop' : 'edit',
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

export async function createToolContext(input: AgentToolContext) {
  const workspaceRootPath = normalizeWorkspacePath(input.workspaceRootPath)
  await assertWorkspaceDirectory(workspaceRootPath)
  return {
    checkpointId: input.checkpointId?.trim() || null,
    terminalExecutionMode: input.terminalExecutionMode ?? 'sandbox',
    workspaceRootPath,
  }
}

export function createWholeFileWriteTool(context: WorkspaceToolContext) {
  return tool({
    description:
      context.terminalExecutionMode === 'full'
        ? 'Create a new file or replace a whole file. Use this when you want to write the full final content. For small edits to an existing file, use `apply_patch` instead. Do not guess `absolute_path`. Do not call write when the target already has identical content. Text content is written with LF line endings. In Full Access, `absolute_path` may be an exact external path if the user provided it. Example: `write({ changes: [{ absolute_path: "/repo/src/new.ts", content: "..." }] })`.'
        : 'Create a new file or replace a whole file. Use this when you want to write the full final content. For small edits to an existing file, use `apply_patch` instead. Do not guess `absolute_path`. Do not call write when the target already has identical content. Text content is written with LF line endings. In Sandbox mode, `absolute_path` must be an exact workspace path. Example: `write({ changes: [{ absolute_path: "/repo/src/new.ts", content: "..." }] })`.',
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        changes: {
          items: {
            additionalProperties: false,
            properties: {
              absolute_path: {
                type: 'string',
              },
              content: {
                type: 'string',
              },
            },
            required: ['absolute_path', 'content'],
            type: 'object',
          },
          minItems: 1,
          type: 'array',
        },
      },
      required: ['changes'],
      type: 'object',
    }),
    execute: async (rawInput) => {
      const inputValue = rawInput as {
        changes: Array<{
          absolute_path: string
          content: string
        }>
      }
      try {
        return await createWholeFileWriteToolResult(context, inputValue)
      } catch (error) {
        return createErrorResult(
          error instanceof Error && error.message.trim().length > 0 ? error.message : 'File change failed.',
        )
      }
    },
  })
}
