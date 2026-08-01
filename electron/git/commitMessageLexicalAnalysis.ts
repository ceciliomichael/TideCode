const MAX_PROMPT_IDENTIFIER_COUNT = 6
const MAX_PROMPT_KEYWORD_COUNT = 6
const MAX_PROMPT_QUOTED_PHRASE_COUNT = 3

export const GENERIC_PATH_SEGMENTS = new Set([
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

export const GENERIC_BASENAMES = new Set([
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


function splitIdentifierWords(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/[_./-]+/gu, ' ')
    .split(/\s+/u)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length > 0)
}

export function humanizeIdentifier(identifier: string) {
  const words = splitIdentifierWords(identifier)
  while (words.length > 1 && LEADING_IDENTIFIER_VERBS.has(words[0])) {
    words.shift()
  }

  const meaningfulWords = words.filter((word) => !STOPWORDS.has(word))
  const selectedWords = meaningfulWords.length > 0 ? meaningfulWords : words
  return selectedWords.slice(0, 5).join(' ').trim()
}

export function normalizePhrase(value: string) {
  return value.replace(/\s+/gu, ' ').trim().toLowerCase()
}

function collectChangedLines(diffText: string) {
  return diffText
    .split(/\r?\n/u)
    .filter((line) => /^[+-]/u.test(line) && !/^(?:\+\+\+|---)/u.test(line))
    .map((line) => line.slice(1))
}

export function collectQuotedPhrases(diffText: string) {
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

export function collectIdentifiers(diffText: string) {
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

export function collectKeywords(diffText: string, touchedFiles: readonly string[]) {
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

export function joinReadableList(items: readonly string[]) {
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
