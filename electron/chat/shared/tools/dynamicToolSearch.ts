import type {
  DynamicToolCatalogEntry,
  DynamicToolPage,
  DynamicToolSummary,
} from './dynamicToolContracts'
import { DYNAMIC_TOOL_PAGE_SIZE, toDynamicToolSummary } from './dynamicToolContracts'

const STOP_WORDS = new Set(['a', 'an', 'and', 'for', 'from', 'in', 'of', 'on', 'the', 'to', 'with'])
const TERM_SYNONYMS: Record<string, string[]> = {
  browse: ['list', 'directory', 'folder'],
  change: ['edit', 'modify', 'update', 'write'],
  command: ['terminal', 'shell', 'run', 'execute'],
  create: ['write', 'add', 'new'],
  delete: ['remove', 'destroy'],
  directory: ['folder', 'list', 'browse'],
  edit: ['change', 'modify', 'update', 'replace'],
  find: ['search', 'grep', 'locate', 'lookup'],
  inspect: ['read', 'view', 'open'],
  lookup: ['search', 'find', 'locate'],
  modify: ['edit', 'change', 'update', 'replace'],
  open: ['read', 'inspect', 'view'],
  read: ['open', 'inspect', 'view', 'contents'],
  remove: ['delete', 'destroy'],
  run: ['execute', 'command', 'terminal', 'shell'],
  search: ['find', 'grep', 'locate', 'lookup'],
  update: ['edit', 'change', 'modify', 'replace'],
  view: ['read', 'inspect', 'open'],
  web: ['internet', 'online', 'browser'],
  write: ['create', 'add', 'edit', 'modify'],
}

interface SearchField {
  text: string
  weight: number
}

interface SearchDocument {
  entry: DynamicToolCatalogEntry
  fields: SearchField[]
  normalizedText: string
  tokens: string[]
}

function splitWords(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
}

function stemToken(token: string) {
  if (token.length > 5 && token.endsWith('ing')) {
    return token.slice(0, -3)
  }
  if (token.length > 4 && token.endsWith('ed')) {
    return token.slice(0, -2)
  }
  if (token.length > 4 && token.endsWith('es')) {
    return token.slice(0, -2)
  }
  if (token.length > 3 && token.endsWith('s')) {
    return token.slice(0, -1)
  }
  return token
}

function expandToken(token: string) {
  const stem = stemToken(token)
  return new Set([token, stem, ...(TERM_SYNONYMS[token] ?? []), ...(TERM_SYNONYMS[stem] ?? [])])
}

function toSearchTokens(value: string) {
  return splitWords(value).flatMap((token) => Array.from(expandToken(token)))
}

function stringifySchema(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function createSearchDocument(entry: DynamicToolCatalogEntry): SearchDocument {
  const fields: SearchField[] = [
    { text: entry.id, weight: 12 },
    { text: entry.name, weight: 11 },
    { text: entry.aliases.join(' '), weight: 8 },
    { text: entry.tags.join(' '), weight: 7 },
    { text: entry.description, weight: 6 },
    { text: stringifySchema(entry.inputSchema), weight: 2 },
  ]
  const normalizedText = fields.map((field) => field.text.toLocaleLowerCase()).join(' ')
  const tokens = Array.from(new Set(fields.flatMap((field) => toSearchTokens(field.text))))
  return { entry, fields, normalizedText, tokens }
}

function levenshteinDistance(left: string, right: string) {
  if (left === right) {
    return 0
  }
  if (left.length === 0) {
    return right.length
  }
  if (right.length === 0) {
    return left.length
  }

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    let diagonal = previous[0]
    previous[0] = leftIndex + 1
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const nextDiagonal = previous[rightIndex + 1]
      const cost = left[leftIndex] === right[rightIndex] ? 0 : 1
      previous[rightIndex + 1] = Math.min(
        previous[rightIndex + 1] + 1,
        previous[rightIndex] + 1,
        diagonal + cost,
      )
      diagonal = nextDiagonal
    }
  }
  return previous[right.length]
}

function scoreToken(queryToken: string, documentTokens: readonly string[]) {
  let bestScore = 0
  for (const documentToken of documentTokens) {
    if (documentToken === queryToken) {
      bestScore = Math.max(bestScore, 1)
      continue
    }
    if (documentToken.startsWith(queryToken) || queryToken.startsWith(documentToken)) {
      bestScore = Math.max(bestScore, 0.82)
      continue
    }
    if (documentToken.includes(queryToken) || queryToken.includes(documentToken)) {
      bestScore = Math.max(bestScore, 0.66)
      continue
    }
    if (queryToken.length >= 4 && documentToken.length >= 4 && levenshteinDistance(queryToken, documentToken) <= 1) {
      bestScore = Math.max(bestScore, 0.5)
    }
  }
  return bestScore
}

function scoreDocument(document: SearchDocument, query: string) {
  const queryTokens = Array.from(new Set(toSearchTokens(query).filter((token) => !STOP_WORDS.has(token))))
  if (queryTokens.length === 0) {
    return 0
  }

  const normalizedQuery = query.toLocaleLowerCase().trim()
  const phraseBoost = document.normalizedText.includes(normalizedQuery) ? 20 : 0
  let matchedTokenCount = 0
  let tokenScore = 0

  for (const queryToken of queryTokens) {
    let bestFieldScore = 0
    for (const field of document.fields) {
      const fieldTokens = toSearchTokens(field.text)
      bestFieldScore = Math.max(bestFieldScore, scoreToken(queryToken, fieldTokens) * field.weight)
    }
    if (bestFieldScore > 0) {
      matchedTokenCount += 1
      tokenScore += bestFieldScore
    }
  }

  if (matchedTokenCount === 0) {
    return 0
  }

  const coverageBoost = matchedTokenCount === queryTokens.length ? 18 : matchedTokenCount * 3
  return phraseBoost + tokenScore / queryTokens.length + coverageBoost
}

function compareSummaries(left: DynamicToolSummary, right: DynamicToolSummary) {
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) || left.id.localeCompare(right.id)
}

export function searchToolCatalog(
  catalog: readonly DynamicToolCatalogEntry[],
  query: string | undefined,
  page = 1,
): DynamicToolPage {
  const normalizedQuery = typeof query === 'string' ? query.trim().slice(0, 512) : ''
  const safePage = Number.isInteger(page) && page >= 1 ? page : 1
  const documents = catalog.map(createSearchDocument)
  const ranked = normalizedQuery.length === 0
    ? documents.map((document) => ({ document, score: 0 }))
    : documents
        .map((document) => ({ document, score: scoreDocument(document, normalizedQuery) }))
        .filter((result) => result.score > 0)

  ranked.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score
    }
    return compareSummaries(toDynamicToolSummary(left.document.entry), toDynamicToolSummary(right.document.entry))
  })

  const totalMatches = ranked.length
  const totalPages = Math.max(1, Math.ceil(totalMatches / DYNAMIC_TOOL_PAGE_SIZE))
  const startIndex = (safePage - 1) * DYNAMIC_TOOL_PAGE_SIZE
  const results = ranked
    .slice(startIndex, startIndex + DYNAMIC_TOOL_PAGE_SIZE)
    .map(({ document }) => toDynamicToolSummary(document.entry))

  return {
    hasMore: startIndex + results.length < totalMatches,
    page: safePage,
    pageSize: DYNAMIC_TOOL_PAGE_SIZE,
    query: normalizedQuery.length > 0 ? normalizedQuery : null,
    results,
    totalMatches,
    totalPages,
  }
}
