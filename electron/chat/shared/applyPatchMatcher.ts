import type { ApplyPatchUpdateChunk } from './applyPatchTypes'
import { createFileRevision } from './fileRevision'

interface PatchableContent {
  hasTrailingLineEnding: boolean
  lines: string[]
}

interface Replacement {
  deleteCount: number
  newLines: string[]
  startIndex: number
}

type LineMatchMode = 'exact' | 'whitespace'

function splitPatchableContent(content: string): PatchableContent {
  const normalizedContent = normalizeContentLineEndings(content)
  const hasTrailingLineEnding = normalizedContent.endsWith('\n')
  const lines = hasTrailingLineEnding
    ? normalizedContent.slice(0, -1).split('\n')
    : normalizedContent.length === 0
      ? []
      : normalizedContent.split('\n')

  return { hasTrailingLineEnding, lines }
}

export function normalizeContentLineEndings(content: string) {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function normalizeWhitespace(line: string) {
  return line.trim().replace(/\s+/g, ' ')
}

function linesMatch(actual: string, expected: string, mode: LineMatchMode) {
  return mode === 'exact'
    ? actual === expected
    : normalizeWhitespace(actual) === normalizeWhitespace(expected)
}

function findSequenceCandidates(
  lines: readonly string[],
  pattern: readonly string[],
  startIndex: number,
  mode: LineMatchMode,
) {
  const candidates: number[] = []
  if (pattern.length === 0) return candidates

  for (let lineIndex = startIndex; lineIndex <= lines.length - pattern.length; lineIndex += 1) {
    const matches = pattern.every((expected, patternIndex) =>
      linesMatch(lines[lineIndex + patternIndex], expected, mode),
    )
    if (matches) candidates.push(lineIndex)
  }

  return candidates
}

function findCandidatesAtBestFidelity(
  lines: readonly string[],
  pattern: readonly string[],
  startIndex: number,
) {
  const exactCandidates = findSequenceCandidates(lines, pattern, startIndex, 'exact')
  if (exactCandidates.length > 0) return exactCandidates
  return findSequenceCandidates(lines, pattern, startIndex, 'whitespace')
}

function formatLinePreview(lines: readonly string[], anchorIndex: number) {
  const firstLineIndex = Math.max(0, anchorIndex - 2)
  const lastLineIndex = Math.min(lines.length, anchorIndex + 5)
  return lines
    .slice(firstLineIndex, lastLineIndex)
    .map((line, index) => `${firstLineIndex + index + 1}: ${line}`)
    .join('\n')
}

function findNearbyAnchor(
  lines: readonly string[],
  pattern: readonly string[],
  startIndex: number,
) {
  for (const expectedLine of pattern) {
    if (expectedLine.trim().length === 0) continue
    const exactIndex = lines.findIndex((line, index) => index >= startIndex && line === expectedLine)
    if (exactIndex !== -1) return exactIndex
    const normalizedExpected = normalizeWhitespace(expectedLine)
    const whitespaceIndex = lines.findIndex(
      (line, index) =>
        index >= startIndex && normalizeWhitespace(line) === normalizedExpected,
    )
    if (whitespaceIndex !== -1) return whitespaceIndex
  }
  return -1
}

function createMissingSequenceError(
  filePath: string,
  lines: readonly string[],
  pattern: readonly string[],
  revision: string,
  startIndex: number,
) {
  const nearbyAnchor = findNearbyAnchor(lines, pattern, startIndex)
  const preview = nearbyAnchor === -1
    ? ''
    : `\n\nCurrent source near the match:\n${formatLinePreview(lines, nearbyAnchor)}`
  return new Error(
    `Patch rejected; no files changed.\nCurrent revision: ${revision}\nFailed to find expected lines in ${filePath}:\n${pattern.join('\n')}${preview}`,
  )
}

function resolveSequenceIndex(input: {
  expectedLine?: number
  filePath: string
  isEndOfFile: boolean
  lines: readonly string[]
  pattern: readonly string[]
  revision: string
  startIndex: number
}) {
  const { expectedLine, filePath, isEndOfFile, lines, pattern, revision, startIndex } = input
  if (pattern.length === 0) return -1

  if (isEndOfFile) {
    const candidate = lines.length - pattern.length
    if (candidate >= startIndex) {
      const exact = pattern.every((line, index) => linesMatch(lines[candidate + index], line, 'exact'))
      const whitespace = pattern.every((line, index) =>
        linesMatch(lines[candidate + index], line, 'whitespace'),
      )
      if (exact || whitespace) return candidate
    }
    throw createMissingSequenceError(filePath, lines, pattern, revision, startIndex)
  }

  if (expectedLine !== undefined) {
    const expectedIndex = expectedLine - 1
    if (expectedIndex >= startIndex && expectedIndex + pattern.length <= lines.length) {
      const exact = pattern.every((line, index) => linesMatch(lines[expectedIndex + index], line, 'exact'))
      const whitespace = pattern.every((line, index) =>
        linesMatch(lines[expectedIndex + index], line, 'whitespace'),
      )
      if (exact || whitespace) return expectedIndex
    }
  }

  const candidates = findCandidatesAtBestFidelity(lines, pattern, startIndex)
  if (candidates.length === 1) return candidates[0]
  if (candidates.length > 1) {
    const lineNumbers = candidates.slice(0, 5).map((index) => index + 1).join(', ')
    throw new Error(
      `Ambiguous patch hunk in ${filePath}: the expected lines match at lines ${lineNumbers}. Add more unchanged context and retry.`,
    )
  }

  throw createMissingSequenceError(filePath, lines, pattern, revision, startIndex)
}

function findChangeContextIndex(
  lines: readonly string[],
  changeContext: string,
  startIndex: number,
) {
  const normalizedContext = normalizeWhitespace(changeContext)
  const candidates: number[] = []
  for (let index = startIndex; index < lines.length; index += 1) {
    if (normalizeWhitespace(lines[index]).includes(normalizedContext)) candidates.push(index)
  }
  return candidates
}

function buildReplacementLines(
  chunk: ApplyPatchUpdateChunk,
  foundIndex: number,
  originalLines: readonly string[],
) {
  const replacementLines = [...chunk.newLines]
  for (const mapping of chunk.contextLineMappings) {
    replacementLines[mapping.newLineIndex] = originalLines[foundIndex + mapping.oldLineIndex]
  }
  return replacementLines
}

function assertValidInsertionIndex(filePath: string, insertionIndex: number, lineCount: number) {
  if (insertionIndex < 0 || insertionIndex > lineCount) {
    throw new Error(
      `Invalid insertion offset in ${filePath}: line ${insertionIndex + 1} is outside the file.`,
    )
  }
}

export function applyUpdateChunks(
  filePath: string,
  originalContent: string,
  chunks: readonly ApplyPatchUpdateChunk[],
) {
  const { hasTrailingLineEnding, lines: originalLines } = splitPatchableContent(originalContent)
  const revision = createFileRevision(originalContent)
  const replacements: Replacement[] = []
  let searchStartIndex = 0

  for (const chunk of chunks) {
    if (chunk.changeContext) {
      const contextCandidates = findChangeContextIndex(
        originalLines,
        chunk.changeContext,
        searchStartIndex,
      )
      if (contextCandidates.length === 0) {
        throw new Error(`Failed to find context "${chunk.changeContext}" in ${filePath}`)
      }
      if (contextCandidates.length > 1) {
        throw new Error(
          `Ambiguous context "${chunk.changeContext}" in ${filePath}. Use a more specific @@ context or include more unchanged lines.`,
        )
      }
      searchStartIndex = contextCandidates[0] + 1
    }

    if (chunk.oldLines.length === 0) {
      const insertionIndex = chunk.isEndOfFile
        ? originalLines.length
        : chunk.offset
          ? chunk.offset.startLine - 1
          : searchStartIndex
      assertValidInsertionIndex(filePath, insertionIndex, originalLines.length)
      replacements.push({
        deleteCount: 0,
        newLines: [...chunk.newLines],
        startIndex: insertionIndex,
      })
      searchStartIndex = insertionIndex
      continue
    }

    const foundIndex = resolveSequenceIndex({
      ...(chunk.offset ? { expectedLine: chunk.offset.startLine } : {}),
      filePath,
      isEndOfFile: Boolean(chunk.isEndOfFile),
      lines: originalLines,
      pattern: chunk.oldLines,
      revision,
      startIndex: searchStartIndex,
    })
    replacements.push({
      deleteCount: chunk.oldLines.length,
      newLines: buildReplacementLines(chunk, foundIndex, originalLines),
      startIndex: foundIndex,
    })
    searchStartIndex = foundIndex + chunk.oldLines.length
  }

  const nextLines = [...originalLines]
  for (let index = replacements.length - 1; index >= 0; index -= 1) {
    const replacement = replacements[index]
    nextLines.splice(replacement.startIndex, replacement.deleteCount, ...replacement.newLines)
  }

  return nextLines.join('\n') + (hasTrailingLineEnding || nextLines.length > 0 ? '\n' : '')
}
