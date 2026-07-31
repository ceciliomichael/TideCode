// Canonical expanded mention format: [[action:path]]
// e.g. [[load_skill:natural-writing]], [[read:src/main.ts]], [[list:src/components]]
// The double-bracket delimiters give unambiguous boundaries so no greedy-match
// issues can bleed into surrounding normal text.

const FULL_MENTION_REGEX_SOURCE = /@\[([^\]]+)\]\(([^)]+)\)/.source

// Matches the NEW canonical [[action:path]] delimited format (may contain spaces)
const BRACKETED_ACTION_REGEX = /\[\[((?:read|list|load_skill):[^\]]+)\]\]/g

// Legacy bare action tags stored before the [[]] format was introduced.
// Supports both single-word and multi-word (greedy, stops before next action tag or @) unquoted paths
// for backwards compatibility with old DB messages, plus quoted variants with spaces.
const LEGACY_ACTION_REGEX = /(?:^|[\s(])((?:read|list|load_skill):(?:"([^"]+)"|'([^']+)'|((?:(?!\s+(?:read|list|load_skill):|\s+@)[^\r\n,;:!?\])])+)))(?=\.?(?:\s|[,;:!?\])]|$))/g

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

  // Use a lookbehind for the prefix so the preceding whitespace/boundary is NOT
  // consumed as part of the match. Without this, consecutive @mentions like
  // "@natural-writing @flat-design" only highlight the first one because the
  // space before the second mention is swallowed by the first match[0].
  return new RegExp(`(?:^|(?<=[\\s(]))@(${escapedLabels})(?=$|[\\s,.;:!?\\]\\)])`, 'g')
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
  let match: RegExpExecArray | null

  // 1. Fully resolved @[label](path) markup — highest priority
  const resolvedMentionRegex = new RegExp(FULL_MENTION_REGEX_SOURCE, 'g')
  while ((match = resolvedMentionRegex.exec(text)) !== null) {
    matches.push({
      end: match.index + match[0].length,
      label: match[1],
      path: match[2] ?? null,
      start: match.index,
    })
  }

  // 2. NEW canonical format: [[action:path]] — unambiguous boundaries
  const bracketedRegex = new RegExp(BRACKETED_ACTION_REGEX.source, 'g')
  while ((match = bracketedRegex.exec(text)) !== null) {
    const actionTag = match[1] // e.g. "read:src/main.ts" or "load_skill:natural-writing"
    const colonIndex = actionTag.indexOf(':')
    const targetPath = actionTag.slice(colonIndex + 1)
    const start = match.index
    const end = start + match[0].length

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

  // 3. Legacy bare format: read:path list:path load_skill:name (no brackets)
  //    Kept for backwards compatibility with messages stored in DB before [[]] format.
  //    Unquoted paths are single-word (no spaces); quoted paths allow spaces.
  const legacyRegex = new RegExp(LEGACY_ACTION_REGEX.source, 'g')
  while ((match = legacyRegex.exec(text)) !== null) {
    const fullMatch = match[0]
    const actionTag = match[1]
    const targetPath = match[2] ?? match[3] ?? match[4]
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

  // 4. Plain @label mentions (only when knownMentionLabels provided — in-composer use)
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
