import type { ApplyPatchUpdateChunk } from './applyPatchTypes'


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

function sequenceMatchesAt(
  lines: readonly string[],
  pattern: readonly string[],
  lineIndex: number,
) {
  const exactMatch = pattern.every((expected, patternIndex) =>
    linesMatch(lines[lineIndex + patternIndex], expected, 'exact'),
  )
  if (exactMatch) return true

  return pattern.every((expected, patternIndex) =>
    linesMatch(lines[lineIndex + patternIndex], expected, 'whitespace'),
  )
}

function findFirstSequenceCandidate(
  lines: readonly string[],
  pattern: readonly string[],
  startIndex: number,
) {
  if (pattern.length === 0) return -1

  for (let lineIndex = startIndex; lineIndex <= lines.length - pattern.length; lineIndex += 1) {
    if (sequenceMatchesAt(lines, pattern, lineIndex)) return lineIndex
  }

  return -1
}

function findSequenceCandidates(lines: readonly string[], pattern: readonly string[]) {
  const candidates: number[] = []
  if (pattern.length === 0) return candidates

  for (let lineIndex = 0; lineIndex <= lines.length - pattern.length; lineIndex += 1) {
    if (sequenceMatchesAt(lines, pattern, lineIndex)) candidates.push(lineIndex)
  }

  return candidates
}

function lineMatchesOneExtraBackslashLayer(actual: string, expected: string) {
  const compare = (left: string, right: string) => {
    let leftIndex = 0
    let rightIndex = 0
    let collapsed = false

    while (leftIndex < left.length && rightIndex < right.length) {
      if (left[leftIndex] === '\\' || right[rightIndex] === '\\') {
        if (left[leftIndex] !== '\\' || right[rightIndex] !== '\\') return false

        let leftEnd = leftIndex
        while (leftEnd < left.length && left[leftEnd] === '\\') leftEnd += 1
        let rightEnd = rightIndex
        while (rightEnd < right.length && right[rightEnd] === '\\') rightEnd += 1

        const leftRun = leftEnd - leftIndex
        const rightRun = rightEnd - rightIndex
        if (rightRun === leftRun) {
          leftIndex = leftEnd
          rightIndex = rightEnd
          continue
        }
        if (rightRun !== leftRun * 2) return false

        collapsed = true
        leftIndex = leftEnd
        rightIndex = rightEnd
        continue
      }

      if (left[leftIndex] !== right[rightIndex]) return false
      leftIndex += 1
      rightIndex += 1
    }

    return collapsed && leftIndex === left.length && rightIndex === right.length
  }

  return compare(actual, expected) || compare(normalizeWhitespace(actual), normalizeWhitespace(expected))
}

function sequenceMatchesOneExtraBackslashLayerAt(
  lines: readonly string[],
  pattern: readonly string[],
  lineIndex: number,
) {
  if (lineIndex < 0 || lineIndex + pattern.length > lines.length) return false

  let repaired = false
  for (const [patternIndex, expected] of pattern.entries()) {
    const actual = lines[lineIndex + patternIndex]
    if (linesMatch(actual, expected, 'exact') || linesMatch(actual, expected, 'whitespace')) continue
    if (!lineMatchesOneExtraBackslashLayer(actual, expected)) return false
    repaired = true
  }
  return repaired
}

function findEscapedSequenceCandidates(
  lines: readonly string[],
  pattern: readonly string[],
  startIndex = 0,
) {
  const candidates: number[] = []
  if (pattern.length === 0) return candidates

  for (let lineIndex = startIndex; lineIndex <= lines.length - pattern.length; lineIndex += 1) {
    if (sequenceMatchesOneExtraBackslashLayerAt(lines, pattern, lineIndex)) candidates.push(lineIndex)
  }
  return candidates
}

function decodeOneGeneratedBackslashLayer(value: string) {
  let decoded = ''
  for (let index = 0; index < value.length;) {
    if (value[index] !== '\\') {
      decoded += value[index]
      index += 1
      continue
    }

    let end = index
    while (end < value.length && value[end] === '\\') end += 1
    const runLength = end - index
    decoded += '\\'.repeat(runLength >= 2 && runLength % 2 === 0 ? runLength / 2 : runLength)
    index = end
  }
  return decoded
}

function replacementOverlapsRange(
  replacement: Replacement,
  startIndex: number,
  deleteCount: number,
) {
  const endIndex = startIndex + deleteCount
  if (replacement.deleteCount === 0) {
    return replacement.startIndex >= startIndex && replacement.startIndex < endIndex
  }

  const replacementEndIndex = replacement.startIndex + replacement.deleteCount
  return replacement.startIndex < endIndex && startIndex < replacementEndIndex
}

function findUniqueNonOverlappingSequenceCandidate(
  lines: readonly string[],
  pattern: readonly string[],
  replacements: readonly Replacement[],
) {
  const candidates = findSequenceCandidates(lines, pattern)
  if (candidates.length !== 1) return -1

  const candidate = candidates[0]
  if (replacements.some((replacement) =>
    replacementOverlapsRange(replacement, candidate, pattern.length),
  )) {
    return -1
  }

  return candidate
}

function findUniqueNonOverlappingEscapedSequenceCandidate(
  lines: readonly string[],
  pattern: readonly string[],
  replacements: readonly Replacement[],
  startIndex = 0,
) {
  const candidates = findEscapedSequenceCandidates(lines, pattern, startIndex)
  if (candidates.length !== 1) return -1

  const candidate = candidates[0]
  if (replacements.some((replacement) =>
    replacementOverlapsRange(replacement, candidate, pattern.length),
  )) {
    return -1
  }

  return candidate
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
    `Patch rejected; no files changed.\nFailed to find expected lines in ${filePath}. For multiple hunks in one file, emit hunks from top to bottom and retry from a fresh read:\n${pattern.join('\n')}${partialHint}${preview}`,
  )
}

function resolveSequenceIndex(input: {
  expectedLine?: number
  filePath: string
  isEndOfFile: boolean
  lines: readonly string[]
  pattern: readonly string[]
  startIndex: number
}) {
  const { expectedLine, filePath, isEndOfFile, lines, pattern, startIndex } = input
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
    throw createMissingSequenceError(filePath, lines, pattern, startIndex)
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

  const candidate = findFirstSequenceCandidate(lines, pattern, startIndex)
  if (candidate !== -1) return candidate

  throw createMissingSequenceError(filePath, lines, pattern, startIndex)
}

function findChangeContextIndex(
  lines: readonly string[],
  changeContext: string,
  startIndex: number,
) {
  return findFirstSequenceCandidate(lines, [changeContext], startIndex)
}

function buildReplacementLines(
  chunk: ApplyPatchUpdateChunk,
  foundIndex: number,
  originalLines: readonly string[],
  decodeGeneratedEscaping = false,
) {
  const replacementLines = decodeGeneratedEscaping
    ? chunk.newLines.map(decodeOneGeneratedBackslashLayer)
    : [...chunk.newLines]
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
  options?: {
    onChunkResolved?: (input: { autofixedEscaping: boolean; chunkIndex: number; startLineNumber: number }) => void
  },
) {
  const { hasTrailingLineEnding, lines: originalLines } = splitPatchableContent(originalContent)
  const replacements: Replacement[] = []
  let searchStartIndex = 0

  for (const [chunkIndex, chunk] of chunks.entries()) {
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
      options?.onChunkResolved?.({ autofixedEscaping: false, chunkIndex, startLineNumber: insertionIndex + 1 })
      searchStartIndex = insertionIndex
      continue
    }

    let foundIndex: number
    let autofixedEscaping = false
    try {
      foundIndex = resolveSequenceIndex({
        ...(chunk.offset ? { expectedLine: chunk.offset.startLine } : {}),
        filePath,
        isEndOfFile: Boolean(chunk.isEndOfFile),
        lines: originalLines,
        pattern: chunk.oldLines,
        startIndex: searchStartIndex,
      })
    } catch (error) {
      const recoveredIndex = chunk.changeContext || chunk.isEndOfFile
        ? -1
        : findUniqueNonOverlappingSequenceCandidate(
            originalLines,
            chunk.oldLines,
            replacements,
          )
      if (recoveredIndex !== -1) {
        foundIndex = recoveredIndex
      } else if (chunk.isEndOfFile) {
        const eofCandidate = originalLines.length - chunk.oldLines.length
        const overlaps = replacements.some((replacement) =>
          replacementOverlapsRange(replacement, eofCandidate, chunk.oldLines.length),
        )
        if (
          eofCandidate < searchStartIndex ||
          overlaps ||
          !sequenceMatchesOneExtraBackslashLayerAt(originalLines, chunk.oldLines, eofCandidate)
        ) {
          throw error
        }
        foundIndex = eofCandidate
        autofixedEscaping = true
      } else {
        const escapedIndex = findUniqueNonOverlappingEscapedSequenceCandidate(
          originalLines,
          chunk.oldLines,
          replacements,
          chunk.changeContext ? searchStartIndex : 0,
        )
        if (escapedIndex === -1) throw error
        foundIndex = escapedIndex
        autofixedEscaping = true
      }
    }

    replacements.push({
      deleteCount: chunk.oldLines.length,
      newLines: buildReplacementLines(chunk, foundIndex, originalLines, autofixedEscaping),
      startIndex: foundIndex,
    })
    options?.onChunkResolved?.({ autofixedEscaping, chunkIndex, startLineNumber: foundIndex + 1 })
    searchStartIndex = Math.max(searchStartIndex, foundIndex + chunk.oldLines.length)
  }

  const orderedReplacements = replacements
    .map((replacement, index) => ({ index, replacement }))
    .sort((left, right) =>
      right.replacement.startIndex - left.replacement.startIndex || right.index - left.index,
    )
  const nextLines = [...originalLines]
  for (const { replacement } of orderedReplacements) {
    nextLines.splice(replacement.startIndex, replacement.deleteCount, ...replacement.newLines)
  }

  return nextLines.join('\n') + (hasTrailingLineEnding || nextLines.length > 0 ? '\n' : '')
}
