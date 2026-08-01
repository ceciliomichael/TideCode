import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import {
  isInsideWorkspaceIgnoredPath,
} from '../../../workspace/gitignoreMatcher'
import {
  createErrorResult,
  createSuccessResult,
  hasBinaryContent,
} from './workspaceToolResults'
import { runRipgrep } from './ripgrep'
import {
  createWorkspaceEntryVisibilityFilter,
  filterVisibleRelativeFileEntries,
  listImmediateDirectoryEntries,
  normalizeSearchIncludePattern,
} from './workspaceEntryVisibility'

const DEFAULT_READ_LIMIT = 2000
const LIST_LIMIT = 100
const SEARCH_LIMIT = 100
const MAX_LINE_LENGTH = 50000
const MAX_READ_BYTES = 256 * 1024
const RIPGREP_EXCLUDE_GLOBS: string[] = []

interface GrepMatch {
  filePath: string
  lineNumber: number
  lineText: string
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


export async function createListToolResult(workspaceRootPath: string, absolutePath: string, relativePath: string) {
  const relaxIgnore = isInsideWorkspaceIgnoredPath(workspaceRootPath, absolutePath)
  const immediateEntries = await listImmediateDirectoryEntries(workspaceRootPath, absolutePath, { relaxIgnore })
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
  const ignoreBasePath = isInsideWorkspaceIgnoredPath(workspaceRootPath, absolutePath) ? absolutePath : undefined
  const visibleRelativeMatches = await filterVisibleRelativeFileEntries(workspaceRootPath, absolutePath, relativeMatches, {
    ignoreBasePath,
  })
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
  const ignoreBasePath =
    stats.isDirectory() && isInsideWorkspaceIgnoredPath(workspaceRootPath, absolutePath) ? absolutePath : undefined
  const isVisibleEntry = createWorkspaceEntryVisibilityFilter(workspaceRootPath, {
    ignoreBasePath,
  })
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
