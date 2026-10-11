
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
  TOOL_OUTPUT_MAX_LINE_LENGTH,
  TOOL_OUTPUT_PAGED_READ_MAX_BYTES,
} from './toolOutputBudget'
import {
  createWorkspaceEntryVisibilityFilter,
  filterVisibleRelativeFileEntries,
  listImmediateDirectoryEntries,
  normalizeSearchIncludePattern,
} from './workspaceEntryVisibility'

const DIRECTORY_READ_DEFAULT_LIMIT = 500
const DEFAULT_FILE_READ_LIMIT = 500
const MAX_RESULT_PAGE_SIZE = 500
const READ_LONG_LINE_FRAGMENT_CODEPOINTS = Math.max(256, TOOL_OUTPUT_MAX_LINE_LENGTH - 128)
const RIPGREP_EXCLUDE_GLOBS: string[] = []

interface ReadContinuationCursor {
  characterOffset: number
  lineNumber: number
}

function encodeReadContinuationCursor(cursor: ReadContinuationCursor) {
  return `line:${cursor.lineNumber}:char:${cursor.characterOffset}`
}

function parseReadContinuationCursor(cursor: string | undefined): ReadContinuationCursor | null {
  if (!cursor) return null
  const match = /^line:(\d+):char:(\d+)$/u.exec(cursor.trim())
  if (!match) {
    throw new Error('Invalid read cursor. Pass next_cursor back exactly as returned by the previous read.')
  }
  const lineNumber = Number.parseInt(match[1], 10)
  const characterOffset = Number.parseInt(match[2], 10)
  if (!Number.isSafeInteger(lineNumber) || lineNumber < 1 || !Number.isSafeInteger(characterOffset) || characterOffset < 0) {
    throw new Error('Invalid read cursor. Pass next_cursor back exactly as returned by the previous read.')
  }
  return { characterOffset, lineNumber }
}

function takeCodePointFragment(value: string, characterOffset: number, maxCodePoints: number) {
  if (characterOffset >= value.length) {
    return { endOffset: value.length, text: '' }
  }
  let endOffset = characterOffset
  let count = 0
  for (const character of value.slice(characterOffset)) {
    if (count >= maxCodePoints) break
    endOffset += character.length
    count += 1
  }
  return {
    endOffset,
    text: value.slice(characterOffset, endOffset),
  }
}

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

function buildPageSemantics(total: number, offset: number, returnedCount: number, totalIsExact = true) {
  const nextOffset = offset + returnedCount
  const hasMore = nextOffset < total
  return {
    has_more: hasMore,
    next_offset: hasMore ? nextOffset : null,
    offset,
    returned_count: returnedCount,
    ...(totalIsExact ? { total_count: total } : {}),
  }
}

function formatGrepOutput(
  matches: GrepMatch[],
  hasErrors: boolean,
  offset?: number,
  limit?: number,
  outputTruncated = false,
) {
  if (matches.length === 0) {
    return {
      body: outputTruncated
        ? 'No visible matches were found before search output was truncated. Narrow the path, include, or pattern to search further.'
        : 'No files found',
      page: {
        ...buildPageSemantics(0, 0, 0, !outputTruncated),
        ...(outputTruncated ? { output_truncated: true } : {}),
      },
      summary: outputTruncated ? 'Search output was truncated before any visible matches were found' : 'No files found',
    }
  }

  const totalMatches = matches.length
  const page = normalizeResultPage(offset, limit)
  const candidateMatches = matches.slice(page.offset, page.offset + page.limit)
  const outputLines: string[] = []
  let outputBytes = 0
  let returnedMatchCount = 0

  let currentFilePath = ''
  for (const match of candidateMatches) {
    const clippedLine = takeCodePointFragment(match.lineText, 0, READ_LONG_LINE_FRAGMENT_CODEPOINTS)
    const lineText = clippedLine.endOffset < match.lineText.length
      ? `${clippedLine.text} ... (match line clipped; use read for full content)`
      : clippedLine.text
    const nextLines: string[] = []
    if (currentFilePath !== match.filePath) {
      if (currentFilePath !== '') {
        nextLines.push('')
      }
      nextLines.push(`${match.filePath}:`)
    }
    nextLines.push(`  Line ${match.lineNumber}: ${lineText}`)
    const nextText = nextLines.join('\n')
    const separatorBytes = outputLines.length > 0 ? 1 : 0
    const nextBytes = Buffer.byteLength(nextText, 'utf8') + separatorBytes
    if (returnedMatchCount > 0 && outputBytes + nextBytes > TOOL_OUTPUT_PAGED_READ_MAX_BYTES) {
      break
    }
    currentFilePath = match.filePath
    outputLines.push(...nextLines)
    outputBytes += nextBytes
    returnedMatchCount += 1
  }

  if (hasErrors) {
    outputLines.push('')
    outputLines.push('(Some paths were inaccessible and skipped)')
  }

  if (outputTruncated) {
    outputLines.push('')
    outputLines.push('(Search output was truncated. Narrow the path, include, or pattern to search further.)')
  }

  return {
    body: outputLines.join('\n'),
    page: {
      ...buildPageSemantics(totalMatches, page.offset, returnedMatchCount, !outputTruncated),
      ...(outputTruncated ? { output_truncated: true } : {}),
    },
    summary: outputTruncated ? `Found at least ${totalMatches} matches before search output was truncated` : `Found ${totalMatches} matches`,
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

  const isVirtualRoot = relativePath.startsWith('@')
  const relaxIgnore =
    isVirtualRoot ||
    isInsideWorkspaceIgnoredPath(workspaceRootPath, absolutePath) ||
    (await isExplicitlyGitignoredPath(workspaceRootPath, absolutePath, true))
  const immediateEntries = await listImmediateDirectoryEntries(
    isVirtualRoot ? absolutePath : workspaceRootPath,
    absolutePath,
    { relaxIgnore },
  )
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
  legacyFullFile = false,
  cursor?: string,
) {
  const stats = await fs.stat(absolutePath)
  if (stats.isDirectory()) {
    if (legacyFullFile) {
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



  // Historical callers may still carry full_file: true. Keep that positional
  // compatibility without allowing it to bypass the bounded read contract.
  const continuationCursor = parseReadContinuationCursor(cursor)
  const startLine = continuationCursor?.lineNumber ?? (legacyFullFile ? 1 : Math.max(1, offset ?? 1))
  const maxLines = legacyFullFile
    ? DEFAULT_FILE_READ_LIMIT
    : Math.min(DEFAULT_FILE_READ_LIMIT, Math.max(1, Math.floor(limit ?? DEFAULT_FILE_READ_LIMIT)))
  const stream = createReadStream(absolutePath)
  const reader = createInterface({
    crlfDelay: Infinity,
    input: stream,
  })

  const collectedLines: string[] = []
  let collectedBytes = 0
  let hasMoreLines = false
  let lineCount = 0
  let nextCursor: string | null = null
  let fragmentCharacterOffset: number | null = null
  let fragmentEndCharacterOffset: number | null = null

  try {
    for await (const line of reader) {
      lineCount += 1
      if (lineCount < startLine) {
        continue
      }

      if (continuationCursor && lineCount === continuationCursor.lineNumber) {
        const fragment = takeCodePointFragment(
          line,
          continuationCursor.characterOffset,
          READ_LONG_LINE_FRAGMENT_CODEPOINTS,
        )
        collectedLines.push(fragment.text)
        fragmentCharacterOffset = continuationCursor.characterOffset
        fragmentEndCharacterOffset = fragment.endOffset
        if (fragment.endOffset < line.length) {
          nextCursor = encodeReadContinuationCursor({
            characterOffset: fragment.endOffset,
            lineNumber: lineCount,
          })
          hasMoreLines = true
        } else {
          hasMoreLines = true
        }
        break
      }

      if (collectedLines.length >= maxLines) {
        hasMoreLines = true
        break
      }

      const lineBytes = Buffer.byteLength(line, 'utf8') + (collectedLines.length > 0 ? 1 : 0)
      const longLineFragment = takeCodePointFragment(line, 0, READ_LONG_LINE_FRAGMENT_CODEPOINTS)
      if (longLineFragment.endOffset < line.length) {
        if (collectedLines.length > 0) {
          hasMoreLines = true
          break
        }
        collectedLines.push(longLineFragment.text)
        collectedBytes += Buffer.byteLength(longLineFragment.text, 'utf8')
        fragmentCharacterOffset = 0
        fragmentEndCharacterOffset = longLineFragment.endOffset
        nextCursor = encodeReadContinuationCursor({
          characterOffset: longLineFragment.endOffset,
          lineNumber: lineCount,
        })
        hasMoreLines = true
        break
      }
      if (collectedLines.length > 0 && collectedBytes + lineBytes > TOOL_OUTPUT_PAGED_READ_MAX_BYTES) {
        hasMoreLines = true
        break
      }

      collectedLines.push(line)
      collectedBytes += lineBytes
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
      ...(hasMoreLines && !nextCursor ? { next_offset: endLine + 1 } : {}),
      ...(nextCursor ? { next_cursor: nextCursor } : {}),
      ...(fragmentCharacterOffset !== null && fragmentEndCharacterOffset !== null
        ? {
            fragment_character_end: fragmentEndCharacterOffset,
            fragment_character_start: fragmentCharacterOffset,
            fragment_line: startLine,
          }
        : {}),
      ...(!hasMoreLines ? { total_line_count: lineCount } : {}),
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
  abortSignal?: AbortSignal,
) {
  const args = ['--files', '--hidden', '--no-ignore-vcs', '--glob', pattern]
  for (const globPattern of RIPGREP_EXCLUDE_GLOBS) {
    args.push('--glob', globPattern)
  }

  const result = await runRipgrep(args, absolutePath, { abortSignal, truncateStdoutOnLimit: true })
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
  const isVirtualRoot = relativePath.startsWith('@')
  const ignoreBasePath = isVirtualRoot
    ? absolutePath
    : isInsideWorkspaceIgnoredPath(workspaceRootPath, absolutePath) ||
        (await isExplicitlyGitignoredPath(workspaceRootPath, absolutePath, true))
      ? absolutePath
      : undefined
  const visibleRelativeMatches = isVirtualRoot
    ? relativeMatches
    : await filterVisibleRelativeFileEntries(workspaceRootPath, absolutePath, relativeMatches, {
        ignoreBasePath,
      })
  const virtualDisplayBase = isVirtualRoot
    ? relativePath.replace(/\/+$/u, '')
    : null
  const matches = visibleRelativeMatches.map((entry) => (
    virtualDisplayBase
      ? `${virtualDisplayBase}/${entry.replace(/\\/gu, '/')}`
      : path.resolve(absolutePath, entry)
  ))
  const page = normalizeResultPage(offset, limit)
  const visibleMatches = matches.slice(page.offset, page.offset + page.limit)
  const bodyLines = matches.length === 0
    ? [result.stdoutTruncated
        ? 'No visible files were found before search output was truncated. Narrow the path or pattern to search further.'
        : 'No files found']
    : visibleMatches

  return createSuccessResult({
    body: bodyLines.join('\n'),
    semantics: {
      ...buildPageSemantics(matches.length, page.offset, visibleMatches.length, !result.stdoutTruncated),
      pattern,
      ...(result.stdoutTruncated ? { output_truncated: true } : {}),
    },
    subject: {
      kind: 'directory',
      path: relativePath,
    },
    summary: result.stdoutTruncated
      ? `Found at least ${matches.length} file${matches.length === 1 ? '' : 's'} matching ${pattern} before search output was truncated`
      : matches.length === 0
        ? `No files matched ${pattern} in ${relativePath}`
        : `Found ${matches.length} file${matches.length === 1 ? '' : 's'} matching ${pattern}`,
    ...(result.stdoutTruncated ? { truncated: true } : {}),
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
  abortSignal?: AbortSignal,
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

  const result = await runRipgrep(args, workspaceRootPath, { abortSignal, truncateStdoutOnLimit: true })
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
  const isVirtualRoot = relativePath.startsWith('@')
  const ignoreBasePath = !isVirtualRoot &&
    stats.isDirectory() &&
    (isInsideWorkspaceIgnoredPath(workspaceRootPath, absolutePath) ||
      (await isExplicitlyGitignoredPath(workspaceRootPath, absolutePath, true)))
      ? absolutePath
      : undefined
  const isVisibleEntry = isVirtualRoot
    ? null
    : createWorkspaceEntryVisibilityFilter(workspaceRootPath, {
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

    if (isVisibleEntry && !(await isVisibleEntry(parsedLine.filePath, false))) {
      continue
    }

    const virtualDisplayBase = isVirtualRoot
      ? relativePath.replace(/\/+$/u, '')
      : null
    const displayedFilePath = virtualDisplayBase
      ? stats.isDirectory()
        ? `${virtualDisplayBase}/${path.relative(absolutePath, parsedLine.filePath).replace(/\\/gu, '/')}`
        : relativePath
      : parsedLine.filePath

    parsedMatches.push({
      filePath: displayedFilePath,
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

  const formatted = formatGrepOutput(parsedMatches, result.exitCode === 2, offset, limit, result.stdoutTruncated)
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
    ...(result.stdoutTruncated ? { truncated: true } : {}),
  })
}
