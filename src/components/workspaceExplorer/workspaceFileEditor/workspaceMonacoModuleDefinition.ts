export interface WorkspaceMonacoModuleSpecifierRange {
  endColumn: number
  startColumn: number
}

interface QuotedRange {
  closingQuoteIndex: number
  openingQuoteIndex: number
}

function isEscaped(text: string, index: number) {
  let slashCount = 0
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    slashCount += 1
  }
  return slashCount % 2 === 1
}

function findQuotedRanges(lineText: string) {
  const ranges: QuotedRange[] = []
  let openingQuoteIndex = -1
  let quote = ''

  for (let cursor = 0; cursor < lineText.length; cursor += 1) {
    const character = lineText[cursor]
    if ((character !== "'" && character !== '"') || isEscaped(lineText, cursor)) continue

    if (openingQuoteIndex < 0) {
      openingQuoteIndex = cursor
      quote = character
      continue
    }
    if (character !== quote) continue

    ranges.push({ openingQuoteIndex, closingQuoteIndex: cursor })
    openingQuoteIndex = -1
    quote = ''
  }

  return ranges
}

function isModuleSpecifierPrefix(prefix: string) {
  return /(?:\bfrom\s*|\bimport\s*(?:type\s*)?|\brequire\s*\(\s*|\bimport\s*\(\s*)$/u.test(prefix)
}

export function findWorkspaceMonacoModuleSpecifierRanges(
  lineText: string,
): WorkspaceMonacoModuleSpecifierRange[] {
  return findQuotedRanges(lineText).flatMap(({ closingQuoteIndex, openingQuoteIndex }) => {
    const prefix = lineText.slice(0, openingQuoteIndex)
    if (!isModuleSpecifierPrefix(prefix)) return []

    return [{
      startColumn: openingQuoteIndex + 2,
      endColumn: closingQuoteIndex + 1,
    }]
  })
}

export function findWorkspaceMonacoModuleSpecifierRange(
  lineText: string,
  column: number,
): WorkspaceMonacoModuleSpecifierRange | null {
  const characterIndex = Math.max(0, Math.min(lineText.length, column - 1))
  return findWorkspaceMonacoModuleSpecifierRanges(lineText).find((range) => (
    characterIndex >= range.startColumn - 2 && characterIndex <= range.endColumn - 1
  )) ?? null
}

export function getWorkspaceMonacoQuotedModuleSpecifier(
  lineText: string,
  range: WorkspaceMonacoModuleSpecifierRange,
) {
  const moduleText = lineText.slice(range.startColumn - 1, range.endColumn - 1)
  const openingQuote = lineText[range.startColumn - 2]
  const quote = openingQuote === '"' ? '"' : "'"
  return quote + moduleText + quote
}
