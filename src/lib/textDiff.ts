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
const EXACT_DIFF_CELL_LIMIT = 250_000

export function normalizeEscapedSequences(content: string) {
  if (!content) {
    return content
  }

  const hasActualNewlines = content.includes('\n')
  const hasEscapedSequences = /\\[ntr]/.test(content)

  if (!hasActualNewlines && hasEscapedSequences) {
    return content.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r')
  }

  return content
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
  const shouldUseExactDiff = !isStreaming && oldLines.length * newLines.length <= EXACT_DIFF_CELL_LIMIT

  if (shouldUseExactDiff) {
    return computeExactDiffLines(oldLines, newLines, startLineNumber)
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
  return summarizeDiffLines(computeDiffLines(oldContent, newContent, options))
}
