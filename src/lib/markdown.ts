type InlineCodeDelimiter = string | null

interface DetailsTagNormalizationResult {
  inlineCodeDelimiter: InlineCodeDelimiter
  line: string
}

const DETAILS_OR_SUMMARY_TAG_PATTERN = /^<\/?(?:details|summary)>/u

function isEscapedBacktick(line: string, index: number) {
  let precedingBackslashes = 0
  for (let cursor = index - 1; cursor >= 0 && line[cursor] === '\\'; cursor -= 1) {
    precedingBackslashes += 1
  }

  return precedingBackslashes % 2 === 1
}

function appendLineBreakBefore(value: string) {
  return value.endsWith('\n') || value.length === 0 ? value : `${value}\n`
}

function appendLineBreakAfter(value: string) {
  return value.endsWith('\n') ? value : `${value}\n`
}

function normalizeDetailsTagsOutsideInlineCode(
  line: string,
  initialInlineCodeDelimiter: InlineCodeDelimiter,
): DetailsTagNormalizationResult {
  let normalizedLine = ''
  let inlineCodeDelimiter = initialInlineCodeDelimiter
  let index = 0

  while (index < line.length) {
    if (line[index] === '`' && !isEscapedBacktick(line, index)) {
      let delimiterEnd = index + 1
      while (delimiterEnd < line.length && line[delimiterEnd] === '`') {
        delimiterEnd += 1
      }

      const delimiter = line.slice(index, delimiterEnd)
      normalizedLine += delimiter
      if (inlineCodeDelimiter === null) {
        inlineCodeDelimiter = delimiter
      } else if (inlineCodeDelimiter === delimiter) {
        inlineCodeDelimiter = null
      }
      index = delimiterEnd
      continue
    }

    if (inlineCodeDelimiter === null) {
      const tagMatch = line.slice(index).match(DETAILS_OR_SUMMARY_TAG_PATTERN)
      if (tagMatch) {
        const tag = tagMatch[0]
        const isClosingTag = tag.startsWith('</')
        const isDetailsTag = tag.toLowerCase().includes('details')

        if (isClosingTag && !isDetailsTag) {
          normalizedLine += tag
          normalizedLine = appendLineBreakAfter(normalizedLine)
        } else {
          normalizedLine = appendLineBreakBefore(normalizedLine)
          normalizedLine += tag
          if (isDetailsTag) {
            normalizedLine = appendLineBreakAfter(normalizedLine)
          }
        }
        index += tag.length
        continue
      }
    }

    normalizedLine += line[index]
    index += 1
  }

  return { inlineCodeDelimiter, line: normalizedLine }
}

export function preprocessMarkdown(markdown: string): string {
  if (!markdown) return ''

  const lines = markdown.split('\n')
  const resultLines: string[] = []
  let inCodeBlock = false
  let inlineCodeDelimiter: InlineCodeDelimiter = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedLine = line.trimStart()

    if (trimmedLine.startsWith('```')) {
      const indent = line.slice(0, line.length - trimmedLine.length)
      const afterBackticks = trimmedLine.slice(3)
      const trimmedAfter = afterBackticks.trim()

      if (inCodeBlock) {
        if (trimmedAfter.length === 0) {
          inCodeBlock = false
          inlineCodeDelimiter = null
          resultLines.push(line)
        } else {
          inCodeBlock = false
          inlineCodeDelimiter = null
          resultLines.push(`${indent}\`\`\``)
          const remainingLine = `${indent}${trimmedAfter}`
          resultLines.push(remainingLine)
        }
        continue
      } else {
        const isMarkdownElement = /^(?:#{1,6}\s|#{1,6}$|[-*+]\s|\d+\.\s|>)/u.test(trimmedAfter)

        if (isMarkdownElement) {
          resultLines.push(`${indent}\`\`\``)
          inCodeBlock = true
          inlineCodeDelimiter = null
          resultLines.push(`${indent}${trimmedAfter}`)
        } else {
          inCodeBlock = true
          inlineCodeDelimiter = null
          resultLines.push(line)
        }
        continue
      }
    }

    if (inCodeBlock) {
      resultLines.push(line)
      continue
    }

    const normalizedDetailsLine = normalizeDetailsTagsOutsideInlineCode(line, inlineCodeDelimiter)
    inlineCodeDelimiter = normalizedDetailsLine.inlineCodeDelimiter
    let processedLine = normalizedDetailsLine.line

    // Process inline highlight: ==text== -> <mark>text</mark>
    processedLine = processedLine.replace(/==([^=]+)==/g, '<mark>$1</mark>')

    // Process superscript: ^text^ -> <sup>text</sup> (avoid matching GFM footnote refs like [^1])
    processedLine = processedLine.replace(/(?<!\[)\^([^\^\s\\]+)\^/g, '<sup>$1</sup>')

    // Process subscript: ~text~ (not ~~strikethrough~~) -> <sub>text</sub>
    processedLine = processedLine.replace(/(?<!~)~([^~\s]+)~(?!~)/g, '<sub>$1</sub>')

    // Process custom/wiki [[read:path/to/file]] or [[path/to/file]] links
    processedLine = processedLine.replace(/\[\[(?:read:)?([^\]]+)\]\]/g, (_, target) => {
      const cleanTarget = target.trim()
      const [pathPart, anchorPart] = cleanTarget.split('#')
      const basename = pathPart.split(/[\/\\]/).pop() || pathPart
      const displayText = anchorPart ? `${basename}#${anchorPart}` : basename
      return `[\`${displayText}\`](${cleanTarget})`
    })

    if (processedLine.trim().startsWith('|') && processedLine.includes('`')) {
      processedLine = processedLine.replace(/(?<!`)`([^`]+)`(?!`)/g, (_, code) => {
        return '`' + code.replace(/\|/g, '\\|') + '`'
      })
    }

    if (resultLines.length > 0 && processedLine.trim().startsWith('|') && processedLine.includes('|')) {
      const prevLine = resultLines[resultLines.length - 1].trim()
      if (prevLine.length > 0 && !prevLine.startsWith('|')) {
        resultLines.push('')
      }
    }

    if (resultLines.length > 0) {
      const isSetextUnderline = /^[-=]{3,}\s*$/.test(processedLine.trim())
      if (isSetextUnderline) {
        const prevLine = resultLines[resultLines.length - 1].trim()
        if (prevLine.length > 0) {
          resultLines.push('')
        }
      }
    }

    resultLines.push(processedLine)
  }

  if (inCodeBlock) {
    resultLines.push('```')
  }

  return resultLines.join('\n')
}

export function resolveRelativePath(basePath: string | undefined, relativeLink: string): string {
  const cleanLink = relativeLink.replace(/^file:\/\/\/?/, '')

  if (!basePath || cleanLink.startsWith('/') || /^[a-zA-Z]:[\\\/]/.test(cleanLink)) {
    return cleanLink.replace(/^\.\//, '')
  }

  const isExplicitRelative = cleanLink.startsWith('./') || cleanLink.startsWith('../')
  const baseParts = basePath.split(/[\/\\]/).slice(0, -1)
  const targetParts = cleanLink.split(/[\/\\]/)

  if (isExplicitRelative) {
    const resolvedParts = [...baseParts]
    for (const part of targetParts) {
      if (part === '.' || part === '') continue
      if (part === '..') {
        if (resolvedParts.length > 0) resolvedParts.pop()
      } else {
        resolvedParts.push(part)
      }
    }
    return resolvedParts.join('/')
  }

  if (baseParts.length > 0 && targetParts.length > 0 && baseParts[0] === targetParts[0]) {
    return cleanLink
  }

  if (baseParts.length > 0) {
    return [...baseParts, ...targetParts].join('/')
  }

  return cleanLink
}

export function handleMarkdownLinkClick(
  e: React.MouseEvent<HTMLAnchorElement>,
  href: string | undefined,
  currentRelativePath?: string,
) {
  if (!href) return

  if (href.startsWith('#')) {
    e.preventDefault()
    const rawId = href.slice(1)
    const targetId = decodeURIComponent(rawId)
    const element =
      document.getElementById(targetId) ||
      document.getElementById(rawId) ||
      document.getElementById(targetId.toLowerCase())
    if (element) {
      const container =
        element.closest('.workspace-markdown-preview') ||
        element.closest('.chat-scroll-container') ||
        element.closest('.overflow-auto') ||
        element.closest('.overflow-y-auto')

      if (container) {
        const containerRect = container.getBoundingClientRect()
        const elementRect = element.getBoundingClientRect()
        const targetTop = elementRect.top - containerRect.top + container.scrollTop - 24
        container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
      } else {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
    return
  }

  if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
    return
  }

  e.preventDefault()
  let cleanHref = href
  if (cleanHref.startsWith('file:///')) {
    cleanHref = cleanHref.slice(8)
  }

  const [pathPart, anchorPart] = cleanHref.split('#')
  const resolvedPath = resolveRelativePath(currentRelativePath, pathPart)

  const isMarkdown = /\.mdx?$/i.test(resolvedPath) || /\.markdown$/i.test(resolvedPath)

  if (isMarkdown) {
    window.dispatchEvent(
      new CustomEvent('tidecode:open-markdown-preview', {
        detail: { relativePath: resolvedPath, anchor: anchorPart },
      }),
    )
  } else if (resolvedPath) {
    window.dispatchEvent(
      new CustomEvent('tidecode:open-file', {
        detail: { relativePath: resolvedPath },
      }),
    )
  }
}


