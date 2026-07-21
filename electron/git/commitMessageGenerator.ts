import type { ModelMessage } from 'ai'
import type { ChatProviderId, ReasoningEffort } from '../../src/types/chat'
import { parseTouchedFilesFromNumstat } from './serviceHelpers'

const MAX_PROMPT_DIFF_LINES = 120
const MAX_PROMPT_DIFF_CHARS = 8_000
const MAX_PROMPT_FILE_COUNT = 8
const MAX_PROMPT_NUMSTAT_FILE_COUNT = 8
const MAX_PROMPT_IDENTIFIER_COUNT = 6
const MAX_PROMPT_KEYWORD_COUNT = 6
const MAX_PROMPT_QUOTED_PHRASE_COUNT = 3
const MAX_COMMIT_SUBJECT_LENGTH = 72

const GENERIC_PATH_SEGMENTS = new Set([
  'electron',
  'src',
  'tests',
  'test',
  '__tests__',
  'components',
  'hooks',
  'lib',
  'pages',
  'shared',
  'chat',
])

const GENERIC_BASENAMES = new Set([
  'index',
  'main',
  'app',
  'types',
  'type',
  'utils',
  'util',
  'helpers',
  'helper',
  'constants',
  'config',
  'service',
  'services',
  'factory',
])

const LEADING_IDENTIFIER_VERBS = new Set([
  'build',
  'create',
  'derive',
  'ensure',
  'extract',
  'format',
  'generate',
  'get',
  'handle',
  'load',
  'make',
  'normalize',
  'parse',
  'read',
  'resolve',
  'run',
  'strip',
  'update',
  'use',
  'write',
])

const STOPWORDS = new Set([
  'able',
  'about',
  'across',
  'after',
  'again',
  'against',
  'allow',
  'also',
  'and',
  'another',
  'before',
  'being',
  'best',
  'blank',
  'body',
  'branch',
  'bug',
  'clear',
  'code',
  'commit',
  'commits',
  'concrete',
  'context',
  'current',
  'delta',
  'description',
  'details',
  'diff',
  'detailed',
  'file',
  'files',
  'focus',
  'from',
  'generic',
  'have',
  'implementation',
  'into',
  'line',
  'lines',
  'message',
  'messages',
  'model',
  'module',
  'modules',
  'more',
  'only',
  'output',
  'prompt',
  'recent',
  'return',
  'scope',
  'short',
  'specific',
  'staged',
  'subject',
  'summary',
  'tests',
  'text',
  'that',
  'the',
  'then',
  'this',
  'title',
  'tool',
  'tools',
  'touched',
  'update',
  'using',
  'visible',
  'what',
  'when',
  'with',
  'your',
])

const MODEL_SYSTEM_PROMPT = [
  'You write production-grade git commit messages from staged diffs.',
  'Stay strictly grounded in the visible diff and metadata.',
  'Do not output markdown fences, analysis, or commentary.',
  'You must exclusively use the English language.',
].join(' ')

interface ActiveModelSelection {
  modelId: string
  providerId: ChatProviderId
  reasoningEffort: ReasoningEffort
}

interface GenerateCommitMessageInput {
  diffText: string
  numstatText: string
  selection: ActiveModelSelection | null
}

interface ParsedNumstatEntry {
  addedCount: number | null
  filePath: string
  removedCount: number | null
}

interface CommitMessagePromptContext {
  identifiers: string[]
  keywords: string[]
  promptText: string
  quotedPhrases: string[]
  touchedFiles: string[]
}

interface HeuristicCommitContext {
  identifiers: string[]
  keywords: string[]
  quotedPhrases: string[]
  touchedFiles: string[]
}

function truncateDiffForPrompt(diffText: string) {
  const normalizedDiffText = diffText.trim()
  if (normalizedDiffText.length === 0) {
    return '(No textual diff available. Use metadata only.)'
  }

  const diffLines = normalizedDiffText.split(/\r?\n/u)
  const truncatedLines = diffLines.slice(0, MAX_PROMPT_DIFF_LINES)
  let truncatedDiff = truncatedLines.join('\n')
  if (truncatedDiff.length > MAX_PROMPT_DIFF_CHARS) {
    truncatedDiff = truncatedDiff.slice(0, MAX_PROMPT_DIFF_CHARS)
  }

  if (truncatedLines.length < diffLines.length || truncatedDiff.length < normalizedDiffText.length) {
    return `${truncatedDiff}\n\n...[diff truncated for prompt size]`
  }

  return truncatedDiff
}

function formatNumstatEntryForPrompt(entry: ParsedNumstatEntry) {
  const addedCount = entry.addedCount === null ? '?' : String(entry.addedCount)
  const removedCount = entry.removedCount === null ? '?' : String(entry.removedCount)
  return `${addedCount}\t${removedCount}\t${entry.filePath}`
}

function summarizeNumstatForPrompt(numstatText: string) {
  const entries = parseNumstatEntries(numstatText)
  const sortedEntries = [...entries].sort((left, right) => {
    const leftTotal = (left.addedCount ?? 0) + (left.removedCount ?? 0)
    const rightTotal = (right.addedCount ?? 0) + (right.removedCount ?? 0)
    return rightTotal - leftTotal
  })
  const topEntries = sortedEntries.slice(0, MAX_PROMPT_NUMSTAT_FILE_COUNT)

  if (topEntries.length === 0) {
    return '(unavailable)'
  }

  const lines = topEntries.map((entry) => formatNumstatEntryForPrompt(entry))
  if (sortedEntries.length > topEntries.length) {
    lines.push(`... ${sortedEntries.length - topEntries.length} more files omitted`)
  }

  return lines.join('\n')
}

function extractTouchedFilesFromDiff(diffText: string) {
  const filePaths = new Set<string>()
  for (const line of diffText.split(/\r?\n/u)) {
    if (!line.startsWith('diff --git a/')) {
      continue
    }

    const match = /^diff --git a\/(.+?) b\/(.+)$/u.exec(line)
    if (!match) {
      continue
    }

    filePaths.add(match[2])
  }

  return Array.from(filePaths)
}

function parseNumstatEntries(numstatText: string): ParsedNumstatEntry[] {
  const entries: ParsedNumstatEntry[] = []

  for (const line of numstatText.split(/\r?\n/u)) {
    const trimmedLine = line.trim()
    if (trimmedLine.length === 0) {
      continue
    }

    const parts = trimmedLine.split(/\t/u)
    if (parts.length < 3) {
      continue
    }

    const rawPath = parts.slice(2).join('\t').trim()
    if (rawPath.length === 0) {
      continue
    }

    const renamedTargetPath = rawPath.includes('=>') ? rawPath.split('=>').at(-1)?.trim() ?? rawPath : rawPath
    const filePath = renamedTargetPath.replace(/[{}]/gu, '').replace(/^"+|"+$/gu, '')
    const addedCount = /^\d+$/u.test(parts[0]) ? Number.parseInt(parts[0], 10) : null
    const removedCount = /^\d+$/u.test(parts[1]) ? Number.parseInt(parts[1], 10) : null

    entries.push({
      addedCount,
      filePath,
      removedCount,
    })
  }

  return entries
}

function splitIdentifierWords(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/[_./-]+/gu, ' ')
    .split(/\s+/u)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length > 0)
}

function humanizeIdentifier(identifier: string) {
  const words = splitIdentifierWords(identifier)
  while (words.length > 1 && LEADING_IDENTIFIER_VERBS.has(words[0])) {
    words.shift()
  }

  const meaningfulWords = words.filter((word) => !STOPWORDS.has(word))
  const selectedWords = meaningfulWords.length > 0 ? meaningfulWords : words
  return selectedWords.slice(0, 5).join(' ').trim()
}

function normalizePhrase(value: string) {
  return value.replace(/\s+/gu, ' ').trim().toLowerCase()
}

function collectChangedLines(diffText: string) {
  return diffText
    .split(/\r?\n/u)
    .filter((line) => /^[+-]/u.test(line) && !/^(?:\+\+\+|---)/u.test(line))
    .map((line) => line.slice(1))
}

function collectQuotedPhrases(diffText: string) {
  const phrases = new Map<string, number>()

  for (const line of collectChangedLines(diffText)) {
    const matches = line.matchAll(/(['"`])([^'"`\r\n]{8,96})\1/gu)
    for (const match of matches) {
      const normalizedPhrase = normalizePhrase(match[2])
      const wordCount = normalizedPhrase.split(/\s+/u).length
      if (wordCount < 3 || wordCount > 12) {
        continue
      }

      if (!/[a-z]/u.test(normalizedPhrase)) {
        continue
      }

      phrases.set(normalizedPhrase, (phrases.get(normalizedPhrase) ?? 0) + 1)
    }
  }

  return Array.from(phrases.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([phrase]) => phrase)
    .slice(0, MAX_PROMPT_QUOTED_PHRASE_COUNT)
}

function collectIdentifiers(diffText: string) {
  const identifierScores = new Map<string, number>()
  const patterns = [
    /\b(?:test|it|describe)\((['"`])([^'"`\r\n]{6,96})\1/gu,
    /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gu,
    /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gu,
    /\b(?:export\s+)?(?:class|interface|type)\s+([A-Za-z_$][\w$]*)/gu,
  ]

  for (const line of collectChangedLines(diffText)) {
    for (const pattern of patterns) {
      const matches = line.matchAll(pattern)
      for (const match of matches) {
        const rawValue = normalizePhrase(match[2] ?? match[1] ?? '')
        if (rawValue.length === 0) {
          continue
        }

        const phrase = pattern.source.includes('test|it|describe') ? rawValue : humanizeIdentifier(rawValue)
        if (phrase.length < 4) {
          continue
        }

        identifierScores.set(phrase, (identifierScores.get(phrase) ?? 0) + 1)
      }
    }
  }

  return Array.from(identifierScores.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([phrase]) => phrase)
    .slice(0, MAX_PROMPT_IDENTIFIER_COUNT)
}

function collectKeywords(diffText: string, touchedFiles: readonly string[]) {
  const keywordScores = new Map<string, number>()

  const pushToken = (token: string, weight: number) => {
    if (token.length < 3 || STOPWORDS.has(token) || /^\d+$/u.test(token)) {
      return
    }

    keywordScores.set(token, (keywordScores.get(token) ?? 0) + weight)
  }

  for (const line of collectChangedLines(diffText)) {
    for (const token of splitIdentifierWords(line)) {
      pushToken(token, 1)
    }
  }

  for (const filePath of touchedFiles) {
    const basename = filePath.split('/').at(-1)?.replace(/\.[^.]+$/u, '') ?? ''
    for (const token of splitIdentifierWords(basename)) {
      pushToken(token, GENERIC_BASENAMES.has(token) ? 1 : 2)
    }
  }

  return Array.from(keywordScores.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([token]) => token)
    .slice(0, MAX_PROMPT_KEYWORD_COUNT)
}

function joinReadableList(items: readonly string[]) {
  if (items.length === 0) {
    return ''
  }

  if (items.length === 1) {
    return items[0]
  }

  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`
  }

  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`
}

function getPathScopeSegments(filePath: string) {
  return filePath
    .split('/')
    .slice(0, -1)
    .map((segment) => segment.trim().toLowerCase())
    .filter((segment) => segment.length > 0 && !GENERIC_PATH_SEGMENTS.has(segment))
}

function deriveCommitScope(touchedFiles: readonly string[]) {
  const scopeCounts = new Map<string, number>()

  for (const filePath of touchedFiles) {
    const scope = getPathScopeSegments(filePath).at(-1)
    if (!scope) {
      continue
    }

    scopeCounts.set(scope, (scopeCounts.get(scope) ?? 0) + 1)
  }

  const rankedScopes = Array.from(scopeCounts.entries()).sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )

  return rankedScopes[0]?.[0] ?? null
}

function deriveTopicCandidate(context: HeuristicCommitContext, scope: string | null) {
  for (const phrase of context.quotedPhrases) {
    if (scope && phrase.includes(scope)) {
      return phrase
    }
  }

  for (const phrase of context.identifiers) {
    if (scope && phrase === scope) {
      continue
    }

    if (!/\b(?:value|input|output|result|state|data)\b/u.test(phrase)) {
      return phrase
    }
  }

  for (const filePath of context.touchedFiles) {
    const basename = filePath.split('/').at(-1)?.replace(/\.[^.]+$/u, '') ?? ''
    if (!basename || GENERIC_BASENAMES.has(basename.toLowerCase())) {
      continue
    }

    const phrase = humanizeIdentifier(basename)
    if (phrase.length > 0) {
      return phrase
    }
  }

  const keywordCandidates = context.keywords.filter((keyword) => keyword !== scope)
  if (keywordCandidates.length > 0) {
    return keywordCandidates.slice(0, 2).join(' ')
  }

  return scope ?? 'repository changes'
}

function singularizeScope(scope: string) {
  return scope.endsWith('s') && scope.length > 3 ? scope.slice(0, -1) : scope
}

function decorateTopicWithScope(topic: string, scope: string | null) {
  if (!scope) {
    return topic
  }

  const singularScope = singularizeScope(scope)
  if (topic.includes(scope) || topic.includes(singularScope)) {
    return topic
  }

  if (topic.split(/\s+/u).length === 1) {
    return `${topic} ${singularScope}`
  }

  return topic
}

function deriveCommitType(input: { diffText: string; numstatEntries: readonly ParsedNumstatEntry[]; touchedFiles: readonly string[] }) {
  const loweredDiff = input.diffText.toLowerCase()
  const touchedFiles = input.touchedFiles

  const docsOnly =
    touchedFiles.length > 0 &&
    touchedFiles.every((filePath) => /(^|\/)(docs?|readme)(\/|\.|$)/iu.test(filePath) || /\.md$/iu.test(filePath))
  if (docsOnly) {
    return 'docs'
  }

  const testsOnly =
    touchedFiles.length > 0 &&
    touchedFiles.every((filePath) => /(^|\/)(test|tests|__tests__)(\/|$)|\.test\./iu.test(filePath))
  if (testsOnly) {
    return 'test'
  }

  const buildOnly =
    touchedFiles.length > 0 &&
    touchedFiles.every((filePath) =>
      /(^|\/)(package(-lock)?\.json|tsconfig(\..+)?\.json|vite\.config|electron-builder\.json5)/iu.test(filePath),
    )
  if (buildOnly) {
    return 'build'
  }

  if (/\b(fix|bug|handle|avoid|prevent|guard|sanitize|normalize|fallback|default|empty|missing)\b/u.test(loweredDiff)) {
    return 'fix'
  }

  const totalAdded = input.numstatEntries.reduce((sum, entry) => sum + (entry.addedCount ?? 0), 0)
  const totalRemoved = input.numstatEntries.reduce((sum, entry) => sum + (entry.removedCount ?? 0), 0)
  if (
    /\b(add|support|enable|allow|introduce|implement|create)\b/u.test(loweredDiff) &&
    totalAdded >= totalRemoved
  ) {
    return 'feat'
  }

  return 'refactor'
}

function deriveSubjectVerb(commitType: string, diffText: string) {
  const loweredDiff = diffText.toLowerCase()

  if (commitType === 'docs') {
    return 'document'
  }

  if (commitType === 'test') {
    return 'cover'
  }

  if (commitType === 'build') {
    return 'update'
  }

  if (/\b(prompt|instruction|guidance)\b/u.test(loweredDiff)) {
    return 'tighten'
  }

  if (/\b(register|registry|export|factory|wire|wiring)\b/u.test(loweredDiff)) {
    return 'streamline'
  }

  if (/\b(normalize|sanitize|trim|strip)\b/u.test(loweredDiff)) {
    return 'normalize'
  }

  if (/\b(handle|empty|missing|null|undefined|fallback|default)\b/u.test(loweredDiff)) {
    return 'handle'
  }

  if (commitType === 'feat') {
    return 'add'
  }

  if (commitType === 'fix') {
    return 'fix'
  }

  return 'refine'
}

function truncateSubject(subject: string) {
  if (subject.length <= MAX_COMMIT_SUBJECT_LENGTH) {
    return subject
  }

  const clipped = subject.slice(0, MAX_COMMIT_SUBJECT_LENGTH)
  const lastWhitespaceIndex = clipped.lastIndexOf(' ')
  if (lastWhitespaceIndex >= 20) {
    return clipped.slice(0, lastWhitespaceIndex).trim()
  }

  return clipped.trim()
}

function summarizeTouchedFiles(touchedFiles: readonly string[]) {
  if (touchedFiles.length === 0) {
    return 'the staged files'
  }

  if (touchedFiles.length === 1) {
    return touchedFiles[0]
  }

  if (touchedFiles.length === 2) {
    return `${touchedFiles[0]} and ${touchedFiles[1]}`
  }

  return `${touchedFiles[0]}, ${touchedFiles[1]}, and ${touchedFiles.length - 2} more files`
}

function dedupePreservingOrder(values: readonly string[]) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    const normalizedValue = normalizePhrase(value)
    if (normalizedValue.length === 0 || seen.has(normalizedValue)) {
      continue
    }

    seen.add(normalizedValue)
    result.push(value)
  }

  return result
}

export function buildCommitMessagePrompt(input: { diffText: string; numstatText: string }): CommitMessagePromptContext {
  const touchedFiles = dedupePreservingOrder([
    ...parseTouchedFilesFromNumstat(input.numstatText),
    ...extractTouchedFilesFromDiff(input.diffText),
  ])
  const diffSnippet = truncateDiffForPrompt(input.diffText)
  const identifiers = collectIdentifiers(input.diffText)
  const keywords = collectKeywords(input.diffText, touchedFiles)
  const quotedPhrases = collectQuotedPhrases(input.diffText)
  const topFiles = touchedFiles.slice(0, MAX_PROMPT_FILE_COUNT)
  const fileList = topFiles.length > 0 ? topFiles.join('\n') : '(none detected)'
  const numstatList = summarizeNumstatForPrompt(input.numstatText)
  const identifierList = identifiers.length > 0 ? identifiers.join('\n') : '(none detected)'
  const keywordList = keywords.length > 0 ? keywords.join(', ') : '(none detected)'
  const quotedPhraseList = quotedPhrases.length > 0 ? quotedPhrases.join('\n') : '(none detected)'

  const promptText = [
    'Write a git commit message for this staged diff.',
    '',
    'Output format:',
    '1. Line 1 must be a conventional commit subject no longer than 72 characters.',
    '2. Add a blank line.',
    '3. Then write 2-4 bullet points, each starting with "- ".',
    '',
    'Rules:',
    '- Be specific about the dominant behavior, tool, bug, prompt, test, or config change.',
    '- Ground every claim in the provided diff, identifiers, keywords, and numstat.',
    '- Prefer concrete nouns from the diff over file-count summaries.',
    '- Mention tests only when they changed.',
    '- Do not mention AI, prompts, merge requests, review flow, or truncation.',
    '- Do not use generic filler like "update implementation details", "changed modules", "misc fixes", or "various updates".',
    '- Do not repeat the touched-file list as the subject.',
    '',
    'Staged numstat (top changes only):',
    numstatList,
    '',
    'Touched files (top changes only):',
    fileList,
    '',
    'Changed identifiers and test names:',
    identifierList,
    '',
    'High-signal keywords:',
    keywordList,
    '',
    'Useful quoted phrases from changed lines:',
    quotedPhraseList,
    '',
    'Unified diff excerpt:',
    diffSnippet,
  ].join('\n')

  return {
    identifiers,
    keywords,
    promptText,
    quotedPhrases,
    touchedFiles,
  }
}

export function buildHeuristicCommitMessageFromDiff(input: { diffText: string; numstatText: string }) {
  const promptContext = buildCommitMessagePrompt(input)
  const numstatEntries = parseNumstatEntries(input.numstatText)
  const commitType = deriveCommitType({
    diffText: input.diffText,
    numstatEntries,
    touchedFiles: promptContext.touchedFiles,
  })
  const scope = deriveCommitScope(promptContext.touchedFiles)
  const topic = decorateTopicWithScope(
    deriveTopicCandidate(
      {
        identifiers: promptContext.identifiers,
        keywords: promptContext.keywords,
        quotedPhrases: promptContext.quotedPhrases,
        touchedFiles: promptContext.touchedFiles,
      },
      scope,
    ),
    scope,
  )
  const subjectPrefix = scope ? `${commitType}(${scope}): ` : `${commitType}: `
  const subject = truncateSubject(`${subjectPrefix}${deriveSubjectVerb(commitType, input.diffText)} ${topic}`)

  const bulletCandidates = dedupePreservingOrder([
    promptContext.identifiers.length > 0
      ? `Update ${joinReadableList(promptContext.identifiers.slice(0, 2))}.`
      : '',
    promptContext.quotedPhrases.length > 0
      ? `Capture ${joinReadableList(promptContext.quotedPhrases.slice(0, 2))}.`
      : '',
    promptContext.touchedFiles.length > 0 ? `Touch ${summarizeTouchedFiles(promptContext.touchedFiles)}.` : '',
    promptContext.touchedFiles.some((filePath) => /(^|\/)(test|tests|__tests__)(\/|$)|\.test\./iu.test(filePath))
      ? `Refresh tests covering ${topic}.`
      : '',
    promptContext.touchedFiles.some((filePath) => /(^|\/)(docs?|readme)(\/|\.|$)/iu.test(filePath) || /\.md$/iu.test(filePath))
      ? `Refresh docs related to ${topic}.`
      : '',
  ]).filter((line) => line.length > 0)

  const bodyLines = (bulletCandidates.length > 0 ? bulletCandidates : ['Update the staged repository changes.'])
    .slice(0, 4)
    .map((line) => `- ${line}`)

  return `${subject}\n\n${bodyLines.join('\n')}`
}

async function readCommitMessageFromStream(stream: { fullStream: AsyncIterable<{ [key: string]: unknown; type: string }> }) {
  let generatedText = ''

  for await (const part of stream.fullStream) {
    if (part.type === 'text-delta' && typeof part.text === 'string') {
      generatedText += part.text
    }
  }

  return generatedText.trim()
}

async function generateCommitMessageWithModel(promptText: string, selection: ActiveModelSelection) {
  const messages: ModelMessage[] = [
    {
      content: promptText,
      role: 'user',
    },
  ]

  if (selection.providerId === 'codex') {
    const { createCodexClient } = await import('../chat/codex/client')
    const client = createCodexClient()
    const stream = await client.chat.completions.create({
      messages,
      model: selection.modelId,
      reasoningEffort: selection.reasoningEffort,
      system: MODEL_SYSTEM_PROMPT,
    })

    return readCommitMessageFromStream(stream)
  }

  const { readApiKeyChatProviderConfig } = await import('../chat/apiKey/config')
  const { createApiKeyChatClient } = await import('../chat/apiKey/client')
  const providerConfig = await readApiKeyChatProviderConfig(selection.providerId)
  const client = createApiKeyChatClient(providerConfig)
  const stream = await client.chat.completions.create({
    messages,
    model: selection.modelId,
    reasoningEffort: selection.reasoningEffort,
    system: MODEL_SYSTEM_PROMPT,
  })

  return readCommitMessageFromStream(stream)
}

export async function generateCommitMessageFromDiff(input: GenerateCommitMessageInput) {
  const promptContext = buildCommitMessagePrompt({
    diffText: input.diffText,
    numstatText: input.numstatText,
  })

  if (input.selection) {
    try {
      const generatedMessage = await generateCommitMessageWithModel(promptContext.promptText, input.selection)
      if (generatedMessage.length > 0) {
        return generatedMessage
      }
    } catch {
      // Fall back to a local summary when model generation is unavailable or misconfigured.
    }
  }

  return buildHeuristicCommitMessageFromDiff({
    diffText: input.diffText,
    numstatText: input.numstatText,
  })
}
