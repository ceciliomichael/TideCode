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
  return line.replace(/\r/g, '').trim()
}

function normalizeLineWhitespaceCollapsed(line: string) {
  return line.replace(/\r/g, '').trim().replace(/[\t ]+/g, ' ')
}

function linesMatchTolerantly(contentLineText: string, targetLineText: string): boolean {
  const contentNormalized = normalizeLineWhitespace(contentLineText)
  const targetNormalized = normalizeLineWhitespace(targetLineText)

  if (contentNormalized === targetNormalized) return true
  return normalizeLineWhitespaceCollapsed(contentLineText) === normalizeLineWhitespaceCollapsed(targetLineText)
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

  if (targetLines.length === 0) {
    return matches
  }

  for (let startIndex = 0; startIndex <= contentSegments.length - targetLines.length; startIndex += 1) {
    const matchesTarget = targetLines.every((targetLine, targetIndex) => {
      const contentLine = contentSegments[startIndex + targetIndex]?.text
      if (contentLine === undefined) {
        return false
      }

      return linesMatchTolerantly(contentLine, targetLine.text)
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

    const startOffset = baseOffset + firstSegment.startOffset
    const endOffset = baseOffset + lastSegment.endOffset - (!hasTerminalLineBreak && lastSegment.hasLineBreak ? 1 : 0)

    if (!matches.some((match) => match.startOffset === startOffset && match.endOffset === endOffset)) {
      matches.push({ endOffset, startOffset })
    }
  }

  return matches
}

function extractKeyTokens(str: string): string[] {
  return str.replace(/[^a-zA-Z0-9_$]/g, ' ').split(/\s+/).filter((t) => t.length > 1)
}

export function findFuzzyLineMatchOffsets(
  content: string,
  targetContent: string,
  baseOffset = 0,
): TextMatch[] {
  const contentSegments = getLineSegments(content)
  const targetSegments = getLineSegments(targetContent)
  const hasTerminalLineBreak = targetContent.endsWith('\n')
  const targetLines = hasTerminalLineBreak ? targetSegments.slice(0, -1) : targetSegments
  if (targetLines.length === 0) return []

  const targetTokens = extractKeyTokens(targetContent)
  if (targetTokens.length === 0) return []

  let bestScore = 0
  let bestMatch: TextMatch | null = null

  for (let startIndex = 0; startIndex <= contentSegments.length - targetLines.length; startIndex += 1) {
    const windowSegments = contentSegments.slice(startIndex, startIndex + targetLines.length)
    const windowText = windowSegments.map((s) => s.text).join('\n')
    const windowTokens = new Set(extractKeyTokens(windowText))

    let matchCount = 0
    for (const token of targetTokens) {
      if (windowTokens.has(token)) {
        matchCount += 1
      }
    }

    const score = matchCount / targetTokens.length
    if (score > 0.65 && score > bestScore) {
      bestScore = score
      const firstSegment = windowSegments[0]
      const lastSegment = windowSegments[windowSegments.length - 1]
      const startOffset = baseOffset + firstSegment.startOffset
      const endOffset = baseOffset + lastSegment.endOffset - (!hasTerminalLineBreak && lastSegment.hasLineBreak ? 1 : 0)
      bestMatch = { endOffset, startOffset }
    }
  }

  return bestMatch ? [bestMatch] : []
}
