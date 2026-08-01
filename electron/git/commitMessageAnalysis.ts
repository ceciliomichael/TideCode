import {
  GENERIC_BASENAMES,
  GENERIC_PATH_SEGMENTS,
  humanizeIdentifier,
  normalizePhrase,
} from './commitMessageLexicalAnalysis'

export {
  collectIdentifiers,
  collectKeywords,
  collectQuotedPhrases,
  joinReadableList,
} from './commitMessageLexicalAnalysis'

const MAX_PROMPT_DIFF_LINES = 120
const MAX_PROMPT_DIFF_CHARS = 8_000
export const MAX_PROMPT_FILE_COUNT = 8
const MAX_PROMPT_NUMSTAT_FILE_COUNT = 8
const MAX_COMMIT_SUBJECT_LENGTH = 72

interface ParsedNumstatEntry {
  addedCount: number | null
  filePath: string
  removedCount: number | null
}

export interface CommitMessagePromptContext {
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

export function truncateDiffForPrompt(diffText: string) {
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

export function summarizeNumstatForPrompt(numstatText: string) {
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

export function extractTouchedFilesFromDiff(diffText: string) {
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

export function parseNumstatEntries(numstatText: string): ParsedNumstatEntry[] {
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

function getPathScopeSegments(filePath: string) {
  return filePath
    .split('/')
    .slice(0, -1)
    .map((segment) => segment.trim().toLowerCase())
    .filter((segment) => segment.length > 0 && !GENERIC_PATH_SEGMENTS.has(segment))
}

export function deriveCommitScope(touchedFiles: readonly string[]) {
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

export function deriveTopicCandidate(context: HeuristicCommitContext, scope: string | null) {
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

export function decorateTopicWithScope(topic: string, scope: string | null) {
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

export function deriveCommitType(input: { diffText: string; numstatEntries: readonly ParsedNumstatEntry[]; touchedFiles: readonly string[] }) {
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

export function deriveSubjectVerb(commitType: string, diffText: string) {
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

export function truncateSubject(subject: string) {
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

export function summarizeTouchedFiles(touchedFiles: readonly string[]) {
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

export function dedupePreservingOrder(values: readonly string[]) {
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
