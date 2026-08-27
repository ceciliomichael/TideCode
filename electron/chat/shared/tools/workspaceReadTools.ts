
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { detectMediaType } from '@ai-sdk/provider-utils'
import { CHAT_ATTACHMENT_MAX_IMAGE_BYTES } from '../../../../src/lib/chatAttachments'
import {
  isExplicitlyGitignoredPath,
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

const DIRECTORY_READ_DEFAULT_LIMIT = 500
const DEFAULT_FILE_READ_LIMIT = 500
const MAX_RESULT_PAGE_SIZE = 500
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

function normalizeResultPage(offset: number | undefined, limit: number | undefined) {
  return {
    limit: Math.min(MAX_RESULT_PAGE_SIZE, Math.max(1, Math.floor(limit ?? 100))),
    offset: Math.max(0, Math.floor(offset ?? 0)),
  }
}

function buildPageSemantics(total: number, offset: number, returnedCount: number) {
  const nextOffset = offset + returnedCount
  const hasMore = nextOffset < total
  return {
    has_more: hasMore,
    next_offset: hasMore ? nextOffset : null,
    offset,
    returned_count: returnedCount,
    total_count: total,
  }
}

function formatGrepOutput(matches: GrepMatch[], hasErrors: boolean, offset?: number, limit?: number) {
  if (matches.length === 0) {
    return {
      body: 'No files found',
      page: buildPageSemantics(0, 0, 0),
      summary: 'No files found',
    }
  }

  const totalMatches = matches.length
  const page = normalizeResultPage(offset, limit)
  const visibleMatches = matches.slice(page.offset, page.offset + page.limit)
  const outputLines: string[] = []

  let currentFilePath = ''
  for (const match of visibleMatches) {
    if (currentFilePath !== match.filePath) {
      if (currentFilePath !== '') {
        outputLines.push('')
      }
      currentFilePath = match.filePath
      outputLines.push(`${match.filePath}:`)
    }

    outputLines.push(`  Line ${match.lineNumber}: ${match.lineText}`)
  }

  if (hasErrors) {
    outputLines.push('')
    outputLines.push('(Some paths were inaccessible and skipped)')
  }

  return {
    body: outputLines.join('\n'),
    page: buildPageSemantics(totalMatches, page.offset, visibleMatches.length),
    summary: `Found ${totalMatches} matches`,
  }
}


export async function createListToolResult(
  workspaceRootPath: string,
  absolutePath: string,
  relativePath: string,
  offset?: number,
  limit?: number,
) {
  const stats = await fs.stat(absolutePath)
  if (!stats.isDirectory()) {
    throw new Error(`Expected a directory for list, but "${relativePath}" is a file. Use read for the file.`)
  }

  const relaxIgnore =
    isInsideWorkspaceIgnoredPath(workspaceRootPath, absolutePath) ||
    (await isExplicitlyGitignoredPath(workspaceRootPath, absolutePath, true))
  const immediateEntries = await listImmediateDirectoryEntries(workspaceRootPath, absolutePath, { relaxIgnore })
  const page = normalizeResultPage(offset, limit)
  const visibleEntries = immediateEntries.slice(page.offset, page.offset + page.limit)
  const bodyLines = immediateEntries.length === 0 ? ['Empty directory'] : visibleEntries

  return createSuccessResult({
    body: bodyLines.join('\n'),
    semantics: {
      ...buildPageSemantics(immediateEntries.length, page.offset, visibleEntries.length),
    },
    subject: {
      kind: 'directory',
      path: relativePath,
    },
    summary: immediateEntries.length === 0 ? 'Empty directory' : `Listed ${relativePath}`,
  })
}
export async function createReadToolResult(
  absolutePath: string,
  displayPath: string,
  offset: number | undefined,
  limit: number | undefined,
  fullFile = false,
) {
  const stats = await fs.stat(absolutePath)
  if (stats.isDirectory()) {
    if (fullFile) {
      throw new Error('full_file is only supported for text files, not directories.')
    }

    const entries = await fs.readdir(absolutePath, { withFileTypes: true })
    const start = Math.max(0, (offset ?? 1) - 1)
    const maxEntries = Math.min(MAX_RESULT_PAGE_SIZE, Math.max(1, Math.floor(limit ?? DIRECTORY_READ_DEFAULT_LIMIT)))
    const lines = entries
      .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`)
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
    const sliced = lines.slice(start, start + maxEntries)

    return createSuccessResult({
      body: sliced.join('\n'),
      semantics: {
        ...buildPageSemantics(lines.length, start, sliced.length),
        is_directory: true,
      },
      subject: {
        kind: 'directory',
        path: displayPath,
      },
      summary: `Read directory ${displayPath}`,
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

  const detectedImageMediaType = detectMediaType({ data: probe, topLevelType: 'image' })
  if (detectedImageMediaType) {
    if (stats.size > CHAT_ATTACHMENT_MAX_IMAGE_BYTES) {
      return createErrorResult(`Cannot read oversized image ${displayPath}`, {
        body: `Images read by the AI must be ${CHAT_ATTACHMENT_MAX_IMAGE_BYTES} bytes or smaller: ${absolutePath}`,
        subject: {
          kind: 'file',
          path: displayPath,
        },
      })
    }

    const imageData = await fs.readFile(absolutePath)
    const imageLabel = '[Image #1]'
    return createSuccessResult({
      modelOutput: {
        type: 'content',
        value: [
          {
            type: 'text',
            text: `${imageLabel}\nFile: ${displayPath}`,
          },
          {
            type: 'file',
            data: { type: 'data', data: imageData },
            filename: path.basename(absolutePath),
            mediaType: detectedImageMediaType,
          },
        ],
      },
      resultPresentation: {
        fileName: path.basename(absolutePath),
        kind: 'image',
        mediaType: detectedImageMediaType,
        relativePath: displayPath,
      },
      semantics: {
        image_bytes: stats.size,
        media_type: detectedImageMediaType,
      },
      subject: {
        kind: 'file',
        path: displayPath,
      },
      summary: `Read image ${displayPath}`,
    })
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



  const startLine = fullFile ? 1 : Math.max(1, offset ?? 1)
  const maxLines = fullFile
    ? Number.MAX_SAFE_INTEGER
    : Math.min(DEFAULT_FILE_READ_LIMIT, Math.max(1, Math.floor(limit ?? DEFAULT_FILE_READ_LIMIT)))
  const stream = createReadStream(absolutePath)
  const reader = createInterface({
    crlfDelay: Infinity,
    input: stream,
  })

  const collectedLines: string[] = []
  let hasMoreLines = false
  let lineCount = 0

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

      collectedLines.push(line)
    }
  } finally {
    reader.close()
    stream.destroy()
  }

  const body = collectedLines.join('\n')
  const endLine = collectedLines.length > 0 ? startLine + collectedLines.length - 1 : startLine - 1

  return createSuccessResult({
    body,
    displayBody: body,
    semantics: {
      ...(collectedLines.length > 0
        ? {
            end_line: endLine,
            start_line: startLine,
          }
        : {}),
      has_more: hasMoreLines,
      is_directory: false,
      next_offset: hasMoreLines ? endLine + 1 : null,
      returned_line_count: collectedLines.length,
      total_line_count: lineCount,
    },
    subject: {
      kind: 'file',
      path: displayPath,
    },
    summary: `Read ${displayPath}`,
  })
}

export async function createGlobToolResult(
  workspaceRootPath: string,
  absolutePath: string,
  relativePath: string,
  pattern: string,
  offset?: number,
  limit?: number,
) {
  const args = ['--files', '--hidden', '--no-ignore-vcs', '--glob', pattern]
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
  const ignoreBasePath =
    isInsideWorkspaceIgnoredPath(workspaceRootPath, absolutePath) ||
    (await isExplicitlyGitignoredPath(workspaceRootPath, absolutePath, true))
      ? absolutePath
      : undefined
  const visibleRelativeMatches = await filterVisibleRelativeFileEntries(workspaceRootPath, absolutePath, relativeMatches, {
    ignoreBasePath,
  })
  const matches = visibleRelativeMatches.map((entry) => path.resolve(absolutePath, entry))
  const page = normalizeResultPage(offset, limit)
  const visibleMatches = matches.slice(page.offset, page.offset + page.limit)
  const bodyLines = matches.length === 0 ? ['No files found'] : visibleMatches

  return createSuccessResult({
    body: bodyLines.join('\n'),
    semantics: {
      ...buildPageSemantics(matches.length, page.offset, visibleMatches.length),
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
  })
}

export async function createGrepToolResult(
  workspaceRootPath: string,
  absolutePath: string,
  relativePath: string,
  pattern: string,
  include: string | undefined,
  offset?: number,
  limit?: number,
) {
  const stats = await fs.stat(absolutePath)
  if (!stats.isDirectory() && !stats.isFile()) {
    throw new Error(`Search path must be a file or directory: ${relativePath}`)
  }
  const subjectKind = stats.isDirectory() ? 'directory' : 'file'

  const args = ['-nH', '--hidden', '--no-ignore-vcs', '--no-messages', '--field-match-separator=|', '--regexp', pattern]
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
        ...buildPageSemantics(0, 0, 0),
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
    stats.isDirectory() &&
    (isInsideWorkspaceIgnoredPath(workspaceRootPath, absolutePath) ||
      (await isExplicitlyGitignoredPath(workspaceRootPath, absolutePath, true)))
      ? absolutePath
      : undefined
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

  const formatted = formatGrepOutput(parsedMatches, result.exitCode === 2, offset, limit)
  return createSuccessResult({
    body: formatted.body,
    semantics: {
      ...formatted.page,
    },
    subject: {
      kind: subjectKind,
      path: relativePath,
    },
    summary: formatted.summary,
  })
}
