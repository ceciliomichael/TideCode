import { computeDiffLines } from '../../../lib/textDiff'
import type { WorkspaceEditorLineStatus } from './workspaceEditorTypes'

export function buildWorkspaceEditorLineStatusMap(
  originalContent: string | null | undefined,
  nextContent: string,
) {
  const lineStatusByLineNumber = new Map<number, WorkspaceEditorLineStatus>()

  if (originalContent === null || originalContent === undefined) {
    return lineStatusByLineNumber
  }

  if (originalContent.length === 0) {
    if (nextContent.length === 0) {
      return lineStatusByLineNumber
    }

    const normalizedNextLines = nextContent.split('\n')
    for (let index = 0; index < normalizedNextLines.length; index += 1) {
      lineStatusByLineNumber.set(index + 1, 'added')
    }

    return lineStatusByLineNumber
  }

  const diffLines = computeDiffLines(originalContent, nextContent)

  for (let index = 0; index < diffLines.length; index += 1) {
    const diffLine = diffLines[index]
    if (diffLine.type !== 'added') {
      continue
    }

    const addedBlockStartIndex = index
    let addedBlockEndIndex = index + 1
    while (addedBlockEndIndex < diffLines.length && diffLines[addedBlockEndIndex].type === 'added') {
      addedBlockEndIndex += 1
    }

    const previousDiffLine = diffLines[addedBlockStartIndex - 1]
    const lineStatus: WorkspaceEditorLineStatus = previousDiffLine?.type === 'removed' ? 'changed' : 'added'

    for (let addedIndex = addedBlockStartIndex; addedIndex < addedBlockEndIndex; addedIndex += 1) {
      const addedLine = diffLines[addedIndex]
      if (addedLine.newLineNumber !== undefined) {
        lineStatusByLineNumber.set(addedLine.newLineNumber, lineStatus)
      }
    }

    index = addedBlockEndIndex - 1
  }

  return lineStatusByLineNumber
}
