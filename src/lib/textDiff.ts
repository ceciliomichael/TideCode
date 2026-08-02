export interface DiffLine {
  collapsedCount?: number
  content: string
  lineNumber: number | null
  newLineNumber?: number
  oldLineNumber?: number
  type: 'added' | 'collapsed' | 'removed' | 'unchanged'
}

export interface DiffSummary {
  addedLineCount: number
  removedLineCount: number
}

interface ComputeDiffOptions {
  isStreaming?: boolean
  startLineNumber?: number
}

const DIFF_LOOKAHEAD_LIMIT = 48
const EXACT_DIFF_CELL_LIMIT = 1_000_000
const MAX_MYERS_WORK = 2_000_000

export function normalizeEscapedSequences(content: string) {
  const normalizedLineEndings = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  if (!normalizedLineEndings) {
    return content
  }

  const hasActualNewlines = normalizedLineEndings.includes('\n')
  const hasEscapedSequences = /\\[ntr]/.test(normalizedLineEndings)

  if (!hasActualNewlines && hasEscapedSequences) {
    return normalizedLineEndings.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r')
  }

  return normalizedLineEndings
}

function createAddedLine(content: string, lineNumber: number) {
  return {
    content,
    lineNumber,
    newLineNumber: lineNumber,
    oldLineNumber: undefined,
    type: 'added' as const,
  }
}

function createRemovedLine(content: string, lineNumber: number) {
  return {
    content,
    lineNumber,
    newLineNumber: undefined,
    oldLineNumber: lineNumber,
    type: 'removed' as const,
  }
}

function createUnchangedLine(content: string, oldLineNumber: number, newLineNumber: number) {
  return {
    content,
    lineNumber: newLineNumber,
    newLineNumber,
    oldLineNumber,
    type: 'unchanged' as const,
  }
}

function computeExactDiffLines(
  oldLines: readonly string[],
  newLines: readonly string[],
  startLineNumber: number,
) {
  const columnCount = newLines.length + 1
  const matrix = new Uint32Array((oldLines.length + 1) * columnCount)

  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      const currentIndex = oldIndex * columnCount + newIndex
      if (oldLines[oldIndex] === newLines[newIndex]) {
        matrix[currentIndex] = matrix[(oldIndex + 1) * columnCount + newIndex + 1] + 1
        continue
      }

      matrix[currentIndex] = Math.max(
        matrix[(oldIndex + 1) * columnCount + newIndex],
        matrix[oldIndex * columnCount + newIndex + 1],
      )
    }
  }

  const diff: DiffLine[] = []
  let oldIndex = 0
  let newIndex = 0

  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    const oldLine = oldLines[oldIndex]
    const newLine = newLines[newIndex]

    if (oldLine === newLine) {
      diff.push(createUnchangedLine(oldLine, oldIndex + startLineNumber, newIndex + startLineNumber))
      oldIndex += 1
      newIndex += 1
      continue
    }

    const removeScore = matrix[(oldIndex + 1) * columnCount + newIndex]
    const addScore = matrix[oldIndex * columnCount + newIndex + 1]

    if (removeScore >= addScore) {
      diff.push(createRemovedLine(oldLine, oldIndex + startLineNumber))
      oldIndex += 1
      continue
    }

    diff.push(createAddedLine(newLine, newIndex + startLineNumber))
    newIndex += 1
  }

  while (oldIndex < oldLines.length) {
    diff.push(createRemovedLine(oldLines[oldIndex], oldIndex + startLineNumber))
    oldIndex += 1
  }

  while (newIndex < newLines.length) {
    diff.push(createAddedLine(newLines[newIndex], newIndex + startLineNumber))
    newIndex += 1
  }

  return diff
}

function computeGreedyDiffLines(
  oldLines: readonly string[],
  newLines: readonly string[],
  isStreaming: boolean,
  startLineNumber: number,
) {
  const diff: DiffLine[] = []
  const maxOldIndex = oldLines.length - 1
  const maxNewIndex = newLines.length - 1

  function findLookaheadIndex(lines: readonly string[], startIndex: number, targetLine: string) {
    const endIndex = Math.min(lines.length, startIndex + DIFF_LOOKAHEAD_LIMIT)
    for (let index = startIndex; index < endIndex; index += 1) {
      if (lines[index] === targetLine) {
        return index - startIndex
      }
    }

    return -1
  }

  let oldIndex = 0
  let newIndex = 0

  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    const oldLine = oldLines[oldIndex]
    const newLine = newLines[newIndex]

    if (oldIndex >= oldLines.length) {
      diff.push(createAddedLine(newLine, newIndex + startLineNumber))
      newIndex += 1
      continue
    }

    if (newIndex >= newLines.length) {
      if (!isStreaming) {
        diff.push(createRemovedLine(oldLine, oldIndex + startLineNumber))
      }
      oldIndex += 1
      continue
    }

    if (oldLine === newLine) {
      diff.push(createUnchangedLine(oldLine, oldIndex + startLineNumber, newIndex + startLineNumber))
      oldIndex += 1
      newIndex += 1
      continue
    }

    const foundInOld = oldIndex < maxOldIndex ? findLookaheadIndex(oldLines, oldIndex + 1, newLine) : -1
    const foundInNew = newIndex < maxNewIndex ? findLookaheadIndex(newLines, newIndex + 1, oldLine) : -1

    if (foundInOld !== -1 && (foundInNew === -1 || foundInOld <= foundInNew)) {
      diff.push(createRemovedLine(oldLine, oldIndex + startLineNumber))
      oldIndex += 1
      continue
    }

    if (foundInNew !== -1) {
      diff.push(createAddedLine(newLine, newIndex + startLineNumber))
      newIndex += 1
      continue
    }

    diff.push(createRemovedLine(oldLine, oldIndex + startLineNumber))
    diff.push(createAddedLine(newLine, newIndex + startLineNumber))
    oldIndex += 1
    newIndex += 1
  }

  return diff
}

interface StableDiffRegion {
  middleNewLines: string[]
  middleOldLines: string[]
  newSuffixStart: number
  oldSuffixStart: number
  prefixLength: number
}

function findStableDiffRegion(oldLines: readonly string[], newLines: readonly string[]): StableDiffRegion {
  let prefixLength = 0
  const sharedPrefixLength = Math.min(oldLines.length, newLines.length)
  while (prefixLength < sharedPrefixLength && oldLines[prefixLength] === newLines[prefixLength]) {
    prefixLength += 1
  }

  let oldSuffixStart = oldLines.length
  let newSuffixStart = newLines.length
  while (
    oldSuffixStart > prefixLength &&
    newSuffixStart > prefixLength &&
    oldLines[oldSuffixStart - 1] === newLines[newSuffixStart - 1]
  ) {
    oldSuffixStart -= 1
    newSuffixStart -= 1
  }

  return {
    middleNewLines: newLines.slice(prefixLength, newSuffixStart),
    middleOldLines: oldLines.slice(prefixLength, oldSuffixStart),
    newSuffixStart,
    oldSuffixStart,
    prefixLength,
  }
}

function computeDiffLinesWithStableEdges(
  oldLines: readonly string[],
  newLines: readonly string[],
  startLineNumber: number,
) {
  const {
    middleNewLines,
    middleOldLines,
    newSuffixStart,
    oldSuffixStart,
    prefixLength,
  } = findStableDiffRegion(oldLines, newLines)
  const middleDiff =
    middleOldLines.length * middleNewLines.length <= EXACT_DIFF_CELL_LIMIT
      ? computeExactDiffLines(middleOldLines, middleNewLines, startLineNumber + prefixLength)
      : computeGreedyDiffLines(middleOldLines, middleNewLines, false, startLineNumber + prefixLength)

  const diff: DiffLine[] = []
  for (let index = 0; index < prefixLength; index += 1) {
    diff.push(createUnchangedLine(
      oldLines[index],
      startLineNumber + index,
      startLineNumber + index,
    ))
  }

  diff.push(...middleDiff)

  const suffixLength = oldLines.length - oldSuffixStart
  for (let index = 0; index < suffixLength; index += 1) {
    diff.push(createUnchangedLine(
      oldLines[oldSuffixStart + index],
      startLineNumber + oldSuffixStart + index,
      startLineNumber + newSuffixStart + index,
    ))
  }

  return diff
}

function computeMyersDiffSummary(oldLines: readonly string[], newLines: readonly string[]): DiffSummary | null {
  const maxDistance = oldLines.length + newLines.length
  const offset = maxDistance + 1
  const frontier = new Int32Array(offset * 2 + 1)
  frontier.fill(-1)
  frontier[offset + 1] = 0
  let work = 0

  for (let distance = 0; distance <= maxDistance; distance += 1) {
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      work += 1
      if (work > MAX_MYERS_WORK) {
        return null
      }

      const x =
        diagonal === -distance ||
        (diagonal !== distance && frontier[offset + diagonal - 1] < frontier[offset + diagonal + 1])
          ? frontier[offset + diagonal + 1]
          : frontier[offset + diagonal - 1] + 1
      let currentX = x
      let currentY = currentX - diagonal

      while (
        currentX < oldLines.length &&
        currentY < newLines.length &&
        oldLines[currentX] === newLines[currentY]
      ) {
        currentX += 1
        currentY += 1
        work += 1
        if (work > MAX_MYERS_WORK) {
          return null
        }
      }

      frontier[offset + diagonal] = currentX
      if (currentX >= oldLines.length && currentY >= newLines.length) {
        const longestCommonSubsequenceLength = (oldLines.length + newLines.length - distance) / 2
        return {
          addedLineCount: newLines.length - longestCommonSubsequenceLength,
          removedLineCount: oldLines.length - longestCommonSubsequenceLength,
        }
      }
    }
  }

  return null
}

export function computeDiffLines(
  oldContent: string | null | undefined,
  newContent: string,
  { isStreaming = false, startLineNumber = 1 }: ComputeDiffOptions = {},
) {
  const normalizedNewContent = normalizeEscapedSequences(newContent)
  const normalizedOldContent = oldContent ? normalizeEscapedSequences(oldContent) : oldContent

  if (normalizedOldContent === null || normalizedOldContent === undefined) {
    return normalizedNewContent.split('\n').map((line, index) => createAddedLine(line, index + startLineNumber))
  }

  const oldLines = normalizedOldContent.split('\n')
  const newLines = normalizedNewContent.split('\n')

  if (!isStreaming) {
    return computeDiffLinesWithStableEdges(oldLines, newLines, startLineNumber)
  }

  return computeGreedyDiffLines(oldLines, newLines, isStreaming, startLineNumber)
}

export function summarizeDiffLines(diffLines: DiffLine[]): DiffSummary {
  let addedLineCount = 0
  let removedLineCount = 0

  for (const line of diffLines) {
    if (line.type === 'added') {
      addedLineCount += 1
      continue
    }

    if (line.type === 'removed') {
      removedLineCount += 1
    }
  }

  return {
    addedLineCount,
    removedLineCount,
  }
}

export function getDiffSummary(
  oldContent: string | null | undefined,
  newContent: string,
  options?: ComputeDiffOptions,
) {
  if (options?.isStreaming) {
    return summarizeDiffLines(computeDiffLines(oldContent, newContent, options))
  }

  const normalizedNewContent = normalizeEscapedSequences(newContent)
  const normalizedOldContent = oldContent === null || oldContent === undefined
    ? oldContent
    : normalizeEscapedSequences(oldContent)

  if (normalizedOldContent === null || normalizedOldContent === undefined) {
    return summarizeDiffLines(computeDiffLines(normalizedOldContent, normalizedNewContent, options))
  }

  const oldLines = normalizedOldContent.split('\n')
  const newLines = normalizedNewContent.split('\n')
  const region = findStableDiffRegion(oldLines, newLines)
  if (region.middleOldLines.length === 0 && region.middleNewLines.length === 0) {
    return {
      addedLineCount: 0,
      removedLineCount: 0,
    }
  }

  if (region.middleOldLines.length * region.middleNewLines.length <= EXACT_DIFF_CELL_LIMIT) {
    return summarizeDiffLines(computeExactDiffLines(region.middleOldLines, region.middleNewLines, 1))
  }

  const myersSummary = computeMyersDiffSummary(region.middleOldLines, region.middleNewLines)
  if (myersSummary) {
    return myersSummary
  }

  return summarizeDiffLines(
    computeGreedyDiffLines(region.middleOldLines, region.middleNewLines, false, 1),
  )
}
