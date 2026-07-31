export interface TextMatch {
  endOffset: number
  startOffset: number
}

export function findExactMatchOffsets(
  content: string,
  targetContent: string,
  baseOffset = 0,
): TextMatch[] {
  const matches: TextMatch[] = []
  let searchOffset = 0

  while (searchOffset <= content.length - targetContent.length) {
    const matchOffset = content.indexOf(targetContent, searchOffset)
    if (matchOffset === -1) {
      break
    }

    matches.push({
      endOffset: baseOffset + matchOffset + targetContent.length,
      startOffset: baseOffset + matchOffset,
    })
    searchOffset = matchOffset + targetContent.length
  }

  return matches
}

function getLineSegments(content: string) {
  const lines = content.split('\n')
  const segments: Array<{ endOffset: number; startOffset: number; text: string }> = []
  let startOffset = 0

  for (const line of lines) {
    segments.push({
      endOffset: startOffset + line.length,
      startOffset,
      text: line,
    })
    startOffset += line.length + 1
  }

  return segments
}

function normalizeLineIndentation(line: string) {
  return line.replace(/^\s+/u, '')
}

export function findIndentationTolerantMatchOffsets(
  content: string,
  targetContent: string,
  baseOffset = 0,
): TextMatch[] {
  const contentSegments = getLineSegments(content)
  const targetLines = targetContent.split('\n')
  const matches: TextMatch[] = []

  for (let startIndex = 0; startIndex <= contentSegments.length - targetLines.length; startIndex += 1) {
    const matchesTarget = targetLines.every((targetLine, targetIndex) => {
      const contentLine = contentSegments[startIndex + targetIndex]?.text
      return contentLine !== undefined && normalizeLineIndentation(contentLine) === normalizeLineIndentation(targetLine)
    })

    if (!matchesTarget) {
      continue
    }

    const firstSegment = contentSegments[startIndex]
    const lastSegment = contentSegments[startIndex + targetLines.length - 1]
    if (!firstSegment || !lastSegment) {
      continue
    }

    matches.push({
      endOffset: baseOffset + lastSegment.endOffset,
      startOffset: baseOffset + firstSegment.startOffset,
    })
  }

  return matches
}
