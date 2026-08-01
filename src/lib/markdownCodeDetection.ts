export interface RawCodeDocumentMatch {
  code: string
  language: 'html'
  prefix: string
}

const HTML_DOCUMENT_START_PATTERN = /(^|\r?\n)[ \t]*(?:<![ \t\r\n]*doctype[ \t]+html\b|<html\b)/iu
const HTML_DOCUMENT_STRUCTURE_PATTERN = /<\/?(?:html|head|body|style|script|title|meta|link|canvas)\b/iu
const CSS_RULE_PATTERN = /(?:^|\r?\n)[ \t]*(?:[#.]?[a-z][\w-]*|[#.][\w-]+)[^{}\r\n]*\{[^}]*\}/iu

function isInsideMarkdownCodeFence(input: string, index: number) {
  const precedingContent = input.slice(0, index)
  return (precedingContent.match(/```/gu)?.length ?? 0) % 2 === 1
}

/**
 * Models occasionally emit a complete HTML document without markdown fences.
 * Treat only a strongly identified document as code; ordinary inline HTML and
 * prose should continue through the normal markdown renderer.
 */
export function detectRawHtmlDocument(input: string): RawCodeDocumentMatch | null {
  const documentStartMatch = HTML_DOCUMENT_START_PATTERN.exec(input)
  if (!documentStartMatch || documentStartMatch.index === undefined) {
    return null
  }

  const documentStart = documentStartMatch.index + documentStartMatch[1].length
  if (isInsideMarkdownCodeFence(input, documentStart)) {
    return null
  }

  const code = input.slice(documentStart).trim()
  const hasDocumentStructure = HTML_DOCUMENT_STRUCTURE_PATTERN.test(code) || CSS_RULE_PATTERN.test(code)
  if (!hasDocumentStructure) {
    return null
  }

  return {
    code,
    language: 'html',
    prefix: input.slice(0, documentStart).trim(),
  }
}
