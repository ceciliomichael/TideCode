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

    // A model sometimes emits only the beginning of a long source line. Do
    // not apply that unsafe partial replacement, but show the complete line
    // in the rejection so the next attempt can be generated from fresh text.
    const partialExpected = expectedLine.trim()
    if (partialExpected.length >= 12) {
      const partialIndex = lines.findIndex(
        (line, index) => index >= startIndex && line !== expectedLine && line.includes(partialExpected),
      )
      if (partialIndex !== -1) return partialIndex
    }
  }
  return -1
}

function hasPartialAnchor(
  lines: readonly string[],
  pattern: readonly string[],
  startIndex: number,
) {
  return pattern.some((expectedLine) => {
    const partialExpected = expectedLine.trim()
    return partialExpected.length >= 12 && lines.some(
      (line, index) => index >= startIndex && line !== expectedLine && line.includes(partialExpected),
    )
  })
}

function createMissingSequenceError(
  filePath: string,
  lines: readonly string[],
  pattern: readonly string[],
  revision: string,
  startIndex: number,
) {
  const nearbyAnchor = findNearbyAnchor(lines, pattern, startIndex)
  const partialHint = hasPartialAnchor(lines, pattern, startIndex)
    ? '\n\nThe patch used a partial source line. Emit the complete current source line in each -/+ hunk; do not use a prefix or suffix as the replacement anchor.'
    : ''
  const preview = nearbyAnchor === -1
    ? ''
    : `\n\nCurrent source near the match:\n${formatLinePreview(lines, nearbyAnchor)}`
  return new Error(
    `Patch rejected; no files changed.\nCurrent revision: ${revision}\nFailed to find expected lines in ${filePath}. For multiple hunks in one file, emit hunks from top to bottom and retry from a fresh read:\n${pattern.join('\n')}${partialHint}${preview}`,
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
  if (candidates.length > 0) return candidates[0]

  throw createMissingSequenceError(filePath, lines, pattern, revision, startIndex)
}

function findChangeContextIndex(
  lines: readonly string[],
  changeContext: string,
  startIndex: number,
) {
  return findCandidatesAtBestFidelity(lines, [changeContext], startIndex)[0] ?? -1
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
      const contextIndex = findChangeContextIndex(
        originalLines,
        chunk.changeContext,
        searchStartIndex,
      )
      if (contextIndex === -1) {
        throw new Error(`Failed to find context "${chunk.changeContext}" in ${filePath}`)
      }
      searchStartIndex = contextIndex + 1
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
