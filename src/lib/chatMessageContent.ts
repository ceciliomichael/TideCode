import type { Message } from '../types/chat'

export interface AssistantMessageContentParts {
  content: string
  reasoningContent: string
}

interface AssistantMessageContentSplit extends AssistantMessageContentParts {
  hasThinkingTags: boolean
}

const THINK_OPEN_TAG = '<think>'
const THINK_CLOSE_TAG = '</think>'

function shouldStripInternalToolLeakLine(line: string) {
  const normalizedLine = line.trim()
  if (normalizedLine.length === 0) {
    return false
  }

  const hasToolRoutingMarker = /\bto=(?:functions|multi_tool_use)\.[^\s]+/iu.test(normalizedLine)
  if (
    hasToolRoutingMarker &&
    (normalizedLine.includes('{') ||
      /\bassistant\b/iu.test(normalizedLine) ||
      /\bin commentary\b/iu.test(normalizedLine) ||
      normalizedLine.includes('recipient_name'))
  ) {
    return true
  }

  return /recipient_name"\s*:\s*"(?:functions|multi_tool_use)\.[^"]+"/u.test(normalizedLine)
}

function looksLikeRawToolArgumentFragment(line: string) {
  const normalizedLine = line.trim()
  if (normalizedLine.length === 0) {
    return false
  }

  if (!/^[{["]/u.test(normalizedLine)) {
    return false
  }

  return /"(?:path|start_line|end_line|max_lines|old_string|new_string|recipient_name|tool_name)"/u.test(
    normalizedLine,
  )
}

export function stripInternalToolCallLeakage(input: string) {
  const normalizedInput = input.replace(/\r\n/g, '\n')
  const lines = normalizedInput.split('\n')
  const keepLine = lines.map(() => true)

  for (const [index, line] of lines.entries()) {
    if (!shouldStripInternalToolLeakLine(line)) {
      continue
    }

    keepLine[index] = false

    if (index > 0 && looksLikeRawToolArgumentFragment(lines[index - 1])) {
      keepLine[index - 1] = false
    }

    if (index + 1 < lines.length && looksLikeRawToolArgumentFragment(lines[index + 1])) {
      keepLine[index + 1] = false
    }
  }

  return lines.filter((_line, index) => keepLine[index]).join('\n')
}

export function normalizeMarkdownText(input: string) {
  const normalized = stripInternalToolCallLeakage(input)
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n')
    .replace(/(?<=\w)([.!?])(?=[A-Z])/g, '$1\n\n')

  const fenceMatches = normalized.match(/```/g)
  const tripleFenceCount = fenceMatches?.length ?? 0

  if (tripleFenceCount % 2 === 1 && /``\s*$/.test(normalized) && !/```\s*$/.test(normalized)) {
    return normalized.replace(/``(\s*)$/, '```$1')
  }

  if (tripleFenceCount % 2 === 1 && !/```\s*$/.test(normalized)) {
    return `${normalized}\n\`\`\``
  }

  return normalized
}

export function splitThinkingContent(input: string): AssistantMessageContentSplit {
  let content = ''
  let reasoningContent = ''
  let cursor = 0
  let insideThinkingBlock = false
  let hasThinkingTags = false

  while (cursor < input.length) {
    if (insideThinkingBlock) {
      const nextCloseTagIndex = input.indexOf(THINK_CLOSE_TAG, cursor)
      if (nextCloseTagIndex === -1) {
        reasoningContent += input.slice(cursor)
        break
      }

      reasoningContent += input.slice(cursor, nextCloseTagIndex)
      cursor = nextCloseTagIndex + THINK_CLOSE_TAG.length
      insideThinkingBlock = false
      continue
    }

    const nextOpenTagIndex = input.indexOf(THINK_OPEN_TAG, cursor)
    if (nextOpenTagIndex === -1) {
      content += input.slice(cursor)
      break
    }

    hasThinkingTags = true
    content += input.slice(cursor, nextOpenTagIndex)
    cursor = nextOpenTagIndex + THINK_OPEN_TAG.length
    insideThinkingBlock = true
  }

  return {
    content,
    reasoningContent,
    hasThinkingTags,
  }
}

function removeThinkingTags(input: string) {
  return input.replace(/<\/?think>/g, '')
}

function trimEdgeBlankLines(input: string) {
  return input.replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '')
}

function hasThinkingMarkup(input: string) {
  return input.includes(THINK_OPEN_TAG) || input.includes(THINK_CLOSE_TAG)
}

function joinTextParts(parts: readonly string[]) {
  const nonEmptyParts = parts.filter((part) => part.length > 0)
  if (nonEmptyParts.length === 0) {
    return ''
  }

  return nonEmptyParts.join('\n\n')
}

function dedupeReasoningFromContent(content: string, reasoningContent: string) {
  const trimmedContent = content.trim()
  const trimmedReasoning = reasoningContent.trim()

  if (!trimmedContent || !trimmedReasoning) {
    return {
      content,
      reasoningContent,
    }
  }

  if (trimmedContent === trimmedReasoning) {
    return {
      content: '',
      reasoningContent,
    }
  }

  if (trimmedContent.startsWith(trimmedReasoning)) {
    return {
      content: content.replace(trimmedReasoning, '').trimStart(),
      reasoningContent,
    }
  }

  return {
    content,
    reasoningContent,
  }
}

export function normalizeAssistantMessageContent(message: Pick<Message, 'content' | 'reasoningContent'>): AssistantMessageContentParts {
  const sanitizedContent = stripInternalToolCallLeakage(message.content)
  const splitContent = splitThinkingContent(sanitizedContent)
  const normalizedReasoningContent = joinTextParts([
    removeThinkingTags(stripInternalToolCallLeakage(message.reasoningContent ?? '')),
    splitContent.reasoningContent,
  ])
  const sanitizedReasoningContent = stripInternalToolCallLeakage(message.reasoningContent ?? '')
  const shouldTrimEdgeBlankLines = splitContent.hasThinkingTags || hasThinkingMarkup(sanitizedReasoningContent)
  const dedupedParts = dedupeReasoningFromContent(splitContent.content, normalizedReasoningContent)
  const normalizedContent = normalizeMarkdownText(dedupedParts.content)
  const normalizedReasoning = normalizeMarkdownText(dedupedParts.reasoningContent)

  return {
    content: shouldTrimEdgeBlankLines ? trimEdgeBlankLines(normalizedContent) : normalizedContent,
    reasoningContent: shouldTrimEdgeBlankLines ? trimEdgeBlankLines(normalizedReasoning) : normalizedReasoning,
  }
}

export function getCopyableAssistantMessageText(
  message: Pick<Message, 'content' | 'reasoningContent'>,
) {
  return normalizeAssistantMessageContent(message).content.trim()
}

export function hasMeaningfulAssistantContent(
  message: Pick<Message, 'content' | 'reasoningContent' | 'toolInvocations'>,
) {
  const normalizedContent = normalizeAssistantMessageContent(message)
  return (
    normalizedContent.content.trim().length > 0 ||
    normalizedContent.reasoningContent.trim().length > 0 ||
    (message.toolInvocations?.length ?? 0) > 0
  )
}
