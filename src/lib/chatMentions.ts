// Canonical expanded mention format: [[action:path]]
// e.g. [[load_skill:natural-writing]], [[read_file:src/main.ts]], [[list:src/components]], [[kanban:card-id]]
// The double-bracket delimiters give unambiguous boundaries so no greedy-match
// issues can bleed into surrounding normal text.


// Matches the NEW canonical [[action:path]] delimited format (may contain spaces)
const BRACKETED_ACTION_REGEX = /\[\[((?:read_file|list|load_skill|kanban):[^\]]+)\]\]/g

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

export interface ChatMentionDeletionInput {
  direction: 'backward' | 'forward'
  knownMentionLabels?: ReadonlyMap<string, string>
  selectionEnd: number
  selectionStart: number
  text: string
}

export interface ChatMentionNativeDeletionChangeInput {
  knownMentionLabels?: ReadonlyMap<string, string>
  nextText: string
  previousText: string
}

export function shouldCloseChatMentionMenuForNormalText(triggerState: ChatMentionTriggerState | null) {
  return triggerState !== null && /\s/u.test(triggerState.query)
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

  // Do not require whitespace before a mention. Mentions can be intentionally
  // attached to preceding text, for example "release@RELEASE_INSTRUCTIONS.md".
  // The lookahead keeps the known label boundary intact without consuming any
  // surrounding text, so adjacent mentions and normal text remain separate.
  return new RegExp(`@(${escapedLabels})(?=$|[\\s,.;:!?\\]\\)])`, 'g')
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

function getKnownMentionLabelForPath(
  path: string,
  knownMentionLabels?: ReadonlyMap<string, string>,
) {
  if (!knownMentionLabels) {
    return null
  }

  for (const [label, knownPath] of knownMentionLabels) {
    if (knownPath === path) {
      return label
    }
  }

  return null
}

export function serializeChatMentionPathMap(
  mentionPathMap?: ReadonlyMap<string, string> | null,
): Record<string, string> | undefined {
  if (!mentionPathMap || mentionPathMap.size === 0) {
    return undefined
  }

  return Object.fromEntries(mentionPathMap)
}

export function restoreChatMentionPathMap(
  mentionPathMap?: Readonly<Record<string, string>> | null,
) {
  return new Map(Object.entries(mentionPathMap ?? {}))
}

export function findChatMentionMatches(
  text: string,
  knownMentionLabels?: ReadonlyMap<string, string>,
) {
  const matches: ChatMentionMatch[] = []
  let match: RegExpExecArray | null

  // 1. Canonical format: [[action:path]] with unambiguous boundaries
  const bracketedRegex = new RegExp(BRACKETED_ACTION_REGEX.source, 'g')
  while ((match = bracketedRegex.exec(text)) !== null) {
    const actionTag = match[1] // e.g. "read_file:src/main.ts" or "load_skill:natural-writing"
    const colonIndex = actionTag.indexOf(':')
    const targetPath = actionTag.slice(colonIndex + 1)
    const start = match.index
    const end = start + match[0].length

    if (matches.some((existingMatch) => start < existingMatch.end && end > existingMatch.start)) {
      continue
    }

    matches.push({
      end,
      label: getKnownMentionLabelForPath(actionTag, knownMentionLabels) ?? getPathBasename(targetPath),
      path: actionTag,
      start,
    })
  }

  // 2. Plain @label mentions (only when knownMentionLabels provided — in-composer use)
  const plainMentionRegex = buildPlainMentionRegex(knownMentionLabels)
  if (plainMentionRegex) {
    while ((match = plainMentionRegex.exec(text)) !== null) {
      const label = match[1]
      const start = match.index
      const end = start + label.length + 1 // +1 for the `@`

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

export function collapseChatMentionMarkup(
  text: string,
  knownMentionLabels?: ReadonlyMap<string, string>,
) {
  if (text.length === 0) {
    return text
  }

  const matches = findChatMentionMatches(text, knownMentionLabels)
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

export function getChatMentionTriggerState(
  text: string,
  cursorPosition: number,
  knownMentionLabels?: ReadonlyMap<string, string>,
): ChatMentionTriggerState | null {
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

  const matches = findChatMentionMatches(text, knownMentionLabels)
  if (matches.some((match) => match.start === triggerIndex)) {
    return null
  }

  const rawQuery = textBeforeCursor.slice(triggerIndex + 1)
  if (rawQuery.startsWith('[') || /[\r\n]/u.test(rawQuery)) {
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

export function findChatMentionForDeletion({
  direction,
  knownMentionLabels,
  selectionEnd,
  selectionStart,
  text,
}: ChatMentionDeletionInput) {
  if (selectionStart !== selectionEnd) {
    return null
  }

  if (direction === 'backward') {
    return (
      getChatMentionBeforePosition(text, selectionStart, knownMentionLabels)
      ?? getChatMentionAtPosition(text, selectionStart, knownMentionLabels)
    )
  }

  return findChatMentionMatches(text, knownMentionLabels).find((match) => match.start === selectionStart) ?? null
}

export function resolveChatMentionNativeDeletionChange({
  knownMentionLabels,
  nextText,
  previousText,
}: ChatMentionNativeDeletionChangeInput) {
  if (nextText.length >= previousText.length) {
    return null
  }

  let commonPrefixLength = 0
  const maxPrefixLength = Math.min(previousText.length, nextText.length)
  while (
    commonPrefixLength < maxPrefixLength
    && previousText[commonPrefixLength] === nextText[commonPrefixLength]
  ) {
    commonPrefixLength += 1
  }

  let previousSuffixStart = previousText.length
  let nextSuffixStart = nextText.length
  while (
    previousSuffixStart > commonPrefixLength
    && nextSuffixStart > commonPrefixLength
    && previousText[previousSuffixStart - 1] === nextText[nextSuffixStart - 1]
  ) {
    previousSuffixStart -= 1
    nextSuffixStart -= 1
  }

  // Only repair pure deletions. Replacements/composition edits should remain normal text edits.
  if (nextSuffixStart !== commonPrefixLength || previousSuffixStart <= commonPrefixLength) {
    return null
  }

  const touchedMentions = findChatMentionMatches(previousText, knownMentionLabels).filter(
    (match) => commonPrefixLength < match.end && previousSuffixStart > match.start,
  )
  if (touchedMentions.length === 0) {
    return null
  }

  const removalStart = Math.min(commonPrefixLength, ...touchedMentions.map((match) => match.start))
  const removalEnd = Math.max(previousSuffixStart, ...touchedMentions.map((match) => match.end))

  return {
    nextCursorPosition: removalStart,
    nextValue: `${previousText.slice(0, removalStart)}${previousText.slice(removalEnd)}`,
  }
}

export function expandChatMentions(text: string, knownMentionLabels: ReadonlyMap<string, string>) {
  const plainMentionRegex = buildPlainMentionRegex(knownMentionLabels)
  if (!plainMentionRegex) {
    return text
  }

  return text.replace(plainMentionRegex, (_match, label: string) => {
    const path = knownMentionLabels.get(label)
    if (!path) {
      return `@${label}`
    }

    // Wrap in [[...]] delimiters — gives unambiguous boundaries so regex can
    // never bleed into adjacent normal text regardless of spaces in the path.
    return `[[${path}]]`
  })
}
