export interface TextMatch {
  endOffset: number
  startOffset: number
}

interface LineSegment {
  endOffset: number
  hasLineBreak: boolean
  startOffset: number
  text: string
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

function getLineSegments(content: string): LineSegment[] {
  const segments: LineSegment[] = []
  let startOffset = 0

  while (startOffset <= content.length) {
    const newlineOffset = content.indexOf('\n', startOffset)
    if (newlineOffset === -1) {
      segments.push({
        endOffset: content.length,
        hasLineBreak: false,
        startOffset,
        text: content.slice(startOffset),
      })
      break
    }

    segments.push({
      endOffset: newlineOffset + 1,
      hasLineBreak: true,
      startOffset,
      text: content.slice(startOffset, newlineOffset),
    })
    startOffset = newlineOffset + 1
  }

  return segments
}

function normalizeLineWhitespace(line: string) {
  return line.replace(/^[\t ]+/u, '').replace(/[\t ]+$/u, '')
}

export function findIndentationTolerantMatchOffsets(
  content: string,
  targetContent: string,
  baseOffset = 0,
): TextMatch[] {
  const contentSegments = getLineSegments(content)
  const targetSegments = getLineSegments(targetContent)
  const hasTerminalLineBreak = targetContent.endsWith('\n')
  const targetLines = hasTerminalLineBreak ? targetSegments.slice(0, -1) : targetSegments
  const matches: TextMatch[] = []

  for (let startIndex = 0; startIndex <= contentSegments.length - targetLines.length; startIndex += 1) {
    const matchesTarget = targetLines.every((targetLine, targetIndex) => {
      const contentLine = contentSegments[startIndex + targetIndex]?.text
      return contentLine !== undefined && normalizeLineWhitespace(contentLine) === normalizeLineWhitespace(targetLine.text)
    })

    if (!matchesTarget) {
      continue
    }

    const firstSegment = contentSegments[startIndex]
    const lastSegment = contentSegments[startIndex + targetLines.length - 1]
    if (!firstSegment || !lastSegment) {
      continue
    }

    if (hasTerminalLineBreak && !lastSegment.hasLineBreak && lastSegment.endOffset < content.length) {
      continue
    }

    matches.push({
      endOffset: baseOffset + lastSegment.endOffset,
      startOffset: baseOffset + firstSegment.startOffset,
    })
  }

  return matches
}
