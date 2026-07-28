const FULL_MENTION_REGEX_SOURCE = /@\[([^\]]+)\]\(([^)]+)\)/.source

export interface ChatMentionMatch {
  end: number
  label: string
  path: string | null
  start: number
}

export interface ChatMentionSegment {
  text: string
  type: 'mention' | 'text'
  label?: string
  path?: string | null
}

export interface ChatMentionTriggerState {
  query: string
  start: number
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getMentionLabelSet(knownMentionLabels?: ReadonlyMap<string, string>) {
  return knownMentionLabels ? Array.from(knownMentionLabels.keys()) : []
}

function buildPlainMentionRegex(knownMentionLabels?: ReadonlyMap<string, string>) {
  const labels = getMentionLabelSet(knownMentionLabels)
  if (labels.length === 0) {
    return null
  }

  const escapedLabels = labels
    .slice()
    .sort((left, right) => right.length - left.length)
    .map((label) => escapeRegExp(label))
    .join('|')

  return new RegExp(`(^|[\\s(])@(${escapedLabels})(?=$|[\\s,.;:!?\\]\\)])`, 'g')
}

function pushTextSegment(segments: ChatMentionSegment[], text: string) {
  if (text.length === 0) {
    return
  }

  const segment: ChatMentionSegment = {
    text,
    type: 'text',
  }

  segments.push(segment)
}

function getPathBasename(path: string) {
  const normalized = path.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? path
}

export function findChatMentionMatches(
  text: string,
  knownMentionLabels?: ReadonlyMap<string, string>,
) {
  const matches: ChatMentionMatch[] = []
  const resolvedMentionRegex = new RegExp(FULL_MENTION_REGEX_SOURCE, 'g')
  let match: RegExpExecArray | null

  while ((match = resolvedMentionRegex.exec(text)) !== null) {
    matches.push({
      end: match.index + match[0].length,
      label: match[1],
      path: match[2] ?? null,
      start: match.index,
    })
  }

  const rawActionRegex = /(?:^|[\s(])((?:read|list|load_skill):([^\s,.;:!?\])]+))/g
  while ((match = rawActionRegex.exec(text)) !== null) {
    const fullMatch = match[0]
    const actionTag = match[1]
    const targetPath = match[2]
    const start = match.index + (fullMatch.length - actionTag.length)
    const end = start + actionTag.length

    if (matches.some((existingMatch) => start < existingMatch.end && end > existingMatch.start)) {
      continue
    }

    matches.push({
      end,
      label: getPathBasename(targetPath),
      path: actionTag,
      start,
    })
  }

  const plainMentionRegex = buildPlainMentionRegex(knownMentionLabels)
  if (plainMentionRegex) {
    while ((match = plainMentionRegex.exec(text)) !== null) {
      const prefix = match[1] ?? ''
      const label = match[2]
      const start = match.index + prefix.length
      const end = start + label.length + 1

      if (matches.some((existingMatch) => start < existingMatch.end && end > existingMatch.start)) {
        continue
      }

      matches.push({
        end,
        label,
        path: knownMentionLabels?.get(label) ?? null,
        start,
      })
    }
  }

  return matches.sort((left, right) => left.start - right.start)
}

export function splitChatMentionSegments(
  text: string,
  knownMentionLabels?: ReadonlyMap<string, string>,
) {
  if (text.length === 0) {
    return [] as ChatMentionSegment[]
  }

  const matches = findChatMentionMatches(text, knownMentionLabels)
  if (matches.length === 0) {
    const textSegment: ChatMentionSegment = {
      text,
      type: 'text',
    }

    return [
      textSegment,
    ]
  }

  const segments: ChatMentionSegment[] = []
  let lastIndex = 0

  for (const match of matches) {
    if (match.start < lastIndex) {
      continue
    }

    pushTextSegment(segments, text.slice(lastIndex, match.start))
    const mentionSegment: ChatMentionSegment = {
      label: match.label,
      path: match.path,
      text: `@${match.label}`,
      type: 'mention',
    }
    segments.push(mentionSegment)
    lastIndex = match.end
  }

  pushTextSegment(segments, text.slice(lastIndex))
  return segments
}

export function collapseChatMentionMarkup(text: string) {
  if (text.length === 0) {
    return text
  }

  const matches = findChatMentionMatches(text)
  if (matches.length === 0) {
    return text
  }

  let collapsedText = ''
  let lastIndex = 0

  for (const match of matches) {
    if (match.start < lastIndex) {
      continue
    }

    collapsedText += text.slice(lastIndex, match.start)
    collapsedText += `@${match.label}`
    lastIndex = match.end
  }

  collapsedText += text.slice(lastIndex)
  return collapsedText
}

export function buildChatMentionPathMap(text: string) {
  const mentionPathMap = new Map<string, string>()
  for (const match of findChatMentionMatches(text)) {
    if (match.path) {
      mentionPathMap.set(match.label, match.path)
    }
  }

  return mentionPathMap
}

export function getChatMentionTriggerState(text: string, cursorPosition: number): ChatMentionTriggerState | null {
  const clampedCursorPosition = Math.max(0, Math.min(cursorPosition, text.length))
  const textBeforeCursor = text.slice(0, clampedCursorPosition)
  const triggerIndex = textBeforeCursor.lastIndexOf('@')

  if (triggerIndex < 0) {
    return null
  }

  const beforeTrigger = triggerIndex > 0 ? textBeforeCursor[triggerIndex - 1] : ''
  if (beforeTrigger && !/\s/u.test(beforeTrigger)) {
    return null
  }

  const rawQuery = textBeforeCursor.slice(triggerIndex + 1)
  if (rawQuery.startsWith('[') || /\s/u.test(rawQuery)) {
    return null
  }

  return {
    query: rawQuery,
    start: triggerIndex,
  }
}

export function insertChatMention(text: string, cursorPosition: number, label: string) {
  const triggerState = getChatMentionTriggerState(text, cursorPosition)
  if (!triggerState) {
    return {
      nextCursorPosition: cursorPosition,
      nextValue: text,
    }
  }

  const beforeTrigger = text.slice(0, triggerState.start)
  const afterCursor = text.slice(cursorPosition)
  const afterCursorContent = afterCursor.replace(/^[^\s]*/u, '')
  const mentionText = `@${label}`
  const nextValue = `${beforeTrigger}${mentionText} ${afterCursorContent}`

  return {
    nextCursorPosition: beforeTrigger.length + mentionText.length + 1,
    nextValue,
  }
}

export function getChatMentionAtPosition(
  text: string,
  cursorPosition: number,
  knownMentionLabels?: ReadonlyMap<string, string>,
) {
  const clampedCursorPosition = Math.max(0, Math.min(cursorPosition, text.length))
  return findChatMentionMatches(text, knownMentionLabels).find(
    (match) => clampedCursorPosition > match.start && clampedCursorPosition <= match.end,
  ) ?? null
}

export function getChatMentionBeforePosition(
  text: string,
  cursorPosition: number,
  knownMentionLabels?: ReadonlyMap<string, string>,
) {
  const clampedCursorPosition = Math.max(0, Math.min(cursorPosition, text.length))
  return findChatMentionMatches(text, knownMentionLabels).find((match) => match.end === clampedCursorPosition) ?? null
}

export function expandChatMentions(text: string, knownMentionLabels: ReadonlyMap<string, string>) {
  const plainMentionRegex = buildPlainMentionRegex(knownMentionLabels)
  if (!plainMentionRegex) {
    return text
  }

  return text.replace(plainMentionRegex, (_match, prefix: string, label: string) => {
    const path = knownMentionLabels.get(label)
    if (!path) {
      return `${prefix}@${label}`
    }

    return `${prefix}${path}`
  })
}
