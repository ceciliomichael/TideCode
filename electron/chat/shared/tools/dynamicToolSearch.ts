import type {
  DynamicToolCatalogEntry,
  DynamicToolPage,
  DynamicToolSummary,
} from './dynamicToolContracts'
import { DYNAMIC_TOOL_PAGE_SIZE, toDynamicToolSummary } from './dynamicToolContracts'

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'can',
  'could',
  'do',
  'does',
  'for',
  'from',
  'if',
  'in',
  'is',
  'it',
  'me',
  'of',
  'on',
  'please',
  'that',
  'the',
  'this',
  'to',
  'used',
  'where',
  'with',
  'you',
  'your',
])

const TERM_SYNONYMS: Record<string, string[]> = {
  auth: ['authentication', 'credential', 'credentials', 'token'],
  browse: ['list', 'directory', 'folder'],
  change: ['edit', 'modify', 'update', 'write'],
  command: ['terminal', 'shell', 'run', 'execute'],
  create: ['write', 'add', 'new'],
  credential: ['auth', 'authentication', 'secret', 'token'],
  credentials: ['auth', 'authentication', 'secret', 'token'],
  delete: ['remove', 'destroy'],
  directory: ['folder', 'list', 'browse'],
  edit: ['change', 'modify', 'update', 'replace'],
  execute: ['run', 'command', 'terminal', 'shell'],
  find: ['search', 'grep', 'locate', 'lookup'],
  inspect: ['read', 'view', 'open'],
  locate: ['search', 'find', 'grep', 'lookup'],
  lookup: ['search', 'find', 'locate', 'grep'],
  modify: ['edit', 'change', 'update', 'replace'],
  open: ['read', 'inspect', 'view'],
  read: ['open', 'inspect', 'view', 'contents'],
  remove: ['delete', 'destroy'],
  replace: ['edit', 'change', 'modify', 'update'],
  run: ['execute', 'command', 'terminal', 'shell'],
  search: ['find', 'grep', 'locate', 'lookup'],
  secret: ['credential', 'credentials', 'token', 'password', 'key'],
  show: ['read', 'inspect', 'view', 'display'],
  token: ['auth', 'authentication', 'credential', 'secret'],
  update: ['edit', 'change', 'modify', 'replace'],
  view: ['read', 'inspect', 'open'],
  web: ['internet', 'online', 'browser'],
  write: ['create', 'add', 'edit', 'modify'],
}

type SearchFieldKind = 'alias' | 'description' | 'guidance' | 'hint' | 'id' | 'name' | 'schema' | 'tag'

interface SearchField {
  kind: SearchFieldKind
  normalizedText: string
  text: string
  tokens: string[]
  weight: number
}

interface SearchDocument {
  entry: DynamicToolCatalogEntry
  fields: SearchField[]
}

interface SearchQueryTerm {
  original: string
  variants: string[]
}

const SEARCH_INDEX_CACHE = new WeakMap<object, SearchDocument[]>()

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
  if (token === 'uses') {
    return 'use'
  }
  if (token.length > 5 && token.endsWith('ies')) {
    return `${token.slice(0, -3)}y`
  }
  if (token.length > 5 && token.endsWith('ing')) {
    const stem = token.slice(0, -3)
    return /(.)\1$/u.test(stem) ? stem.slice(0, -1) : stem
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
  const variants = new Set<string>()
  const addVariant = (candidate: string) => {
    const normalizedCandidate = candidate.trim().toLowerCase()
    if (normalizedCandidate.length === 0) {
      return
    }
    variants.add(normalizedCandidate)
    variants.add(stemToken(normalizedCandidate))
  }

  addVariant(token)
  addVariant(stemToken(token))
  for (const synonym of TERM_SYNONYMS[token] ?? []) {
    addVariant(synonym)
  }
  for (const synonym of TERM_SYNONYMS[stemToken(token)] ?? []) {
    addVariant(synonym)
  }

  return Array.from(variants)
}

function normalizeText(value: string) {
  return splitWords(value).join(' ')
}

function toDocumentTokens(value: string) {
  return Array.from(
    new Set(
      splitWords(value).flatMap((token) => [token, stemToken(token)]),
    ),
  )
}

function toQueryTerms(value: string) {
  const terms: SearchQueryTerm[] = []
  const seen = new Set<string>()

  for (const token of splitWords(value)) {
    if (STOP_WORDS.has(token)) {
      continue
    }

    const stem = stemToken(token)
    if (seen.has(stem)) {
      continue
    }

    seen.add(stem)
    terms.push({
      original: token,
      variants: expandToken(token),
    })
  }

  return terms
}

function stringifySchema(schema: Record<string, unknown>): string {
  try {
    return JSON.stringify(schema)
  } catch {
    return ''
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getSchemaSearchText(schema: Record<string, unknown>) {
  const parts: string[] = []
  const properties = isRecord(schema.properties) ? schema.properties : null

  if (properties) {
    for (const [propertyName, propertySchema] of Object.entries(properties)) {
      parts.push(propertyName)
      if (!isRecord(propertySchema)) {
        continue
      }
      for (const key of ['title', 'description', 'format']) {
        const value = propertySchema[key]
        if (typeof value === 'string') {
          parts.push(value)
        }
      }
      const enumValues = propertySchema.enum
      if (Array.isArray(enumValues)) {
        parts.push(...enumValues.filter((value): value is string => typeof value === 'string'))
      }
    }
  }

  return `${parts.join(' ')} ${stringifySchema(schema)}`.trim()
}

function createSearchField(kind: SearchFieldKind, text: string, weight: number): SearchField | null {
  const normalizedText = normalizeText(text)
  if (normalizedText.length === 0) {
    return null
  }

  return {
    kind,
    normalizedText,
    text,
    tokens: toDocumentTokens(text),
    weight,
  }
}

function createSearchDocument(entry: DynamicToolCatalogEntry): SearchDocument {
  const fields = [
    createSearchField('id', entry.id, 18),
    createSearchField('name', entry.name, 17),
    createSearchField('alias', entry.aliases.join(' '), 12),
    createSearchField('hint', (entry.searchHints ?? []).join(' '), 15),
    createSearchField('tag', entry.tags.join(' '), 10),
    createSearchField('description', entry.description, 9),
    createSearchField(
      'guidance',
      `${entry.guidance.whenToUse} ${entry.guidance.workflow.join(' ')}`,
      8,
    ),
    createSearchField('schema', getSchemaSearchText(entry.inputSchema), 4),
  ].filter((field): field is SearchField => field !== null)

  return { entry, fields }
}

function getSearchIndex(catalog: readonly DynamicToolCatalogEntry[]) {
  const cacheKey = catalog as object
  const cachedIndex = SEARCH_INDEX_CACHE.get(cacheKey)
  if (cachedIndex) {
    return cachedIndex
  }

  const index = catalog.map(createSearchDocument)
  SEARCH_INDEX_CACHE.set(cacheKey, index)
  return index
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

function getFuzzyDistanceLimit(left: string, right: string) {
  const shortestLength = Math.min(left.length, right.length)
  if (shortestLength < 4) {
    return 0
  }
  return shortestLength >= 7 ? 2 : 1
}

function isAdjacentTransposition(left: string, right: string) {
  if (left.length !== right.length) {
    return false
  }

  let mismatchIndex = 0
  while (mismatchIndex < left.length && left[mismatchIndex] === right[mismatchIndex]) {
    mismatchIndex += 1
  }

  if (mismatchIndex >= left.length - 1) {
    return false
  }

  return (
    left[mismatchIndex] === right[mismatchIndex + 1] &&
    left[mismatchIndex + 1] === right[mismatchIndex] &&
    left.slice(mismatchIndex + 2) === right.slice(mismatchIndex + 2)
  )
}

function scoreToken(queryToken: string, documentTokens: readonly string[]) {
  let bestScore = 0

  for (const documentToken of documentTokens) {
    if (documentToken === queryToken) {
      bestScore = Math.max(bestScore, 1)
      continue
    }

    if (documentToken.startsWith(queryToken) || queryToken.startsWith(documentToken)) {
      bestScore = Math.max(bestScore, 0.86)
      continue
    }

    if (
      Math.min(queryToken.length, documentToken.length) >= 4 &&
      (documentToken.includes(queryToken) || queryToken.includes(documentToken))
    ) {
      bestScore = Math.max(bestScore, 0.7)
      continue
    }

    if (isAdjacentTransposition(queryToken, documentToken)) {
      bestScore = Math.max(bestScore, 0.68)
      continue
    }

    const distanceLimit = getFuzzyDistanceLimit(queryToken, documentToken)
    if (distanceLimit === 0 || Math.abs(queryToken.length - documentToken.length) > distanceLimit) {
      continue
    }

    if (levenshteinDistance(queryToken, documentToken) <= distanceLimit) {
      bestScore = Math.max(bestScore, distanceLimit === 1 ? 0.62 : 0.52)
    }
  }

  return bestScore
}

function scoreQueryTerm(term: SearchQueryTerm, document: SearchDocument) {
  let bestMatch = 0
  let bestFieldKind: SearchFieldKind | null = null

  for (const field of document.fields) {
    let fieldMatch = 0
    for (const variant of term.variants) {
      fieldMatch = Math.max(fieldMatch, scoreToken(variant, field.tokens))
    }

    const weightedMatch = fieldMatch * field.weight
    if (weightedMatch > bestMatch) {
      bestMatch = weightedMatch
      bestFieldKind = field.kind
    }
  }

  return { bestFieldKind, bestMatch }
}

function scoreDocument(document: SearchDocument, query: string) {
  const queryTerms = toQueryTerms(query)
  if (queryTerms.length === 0) {
    return 0
  }

  const normalizedQuery = normalizeText(query)
  let matchedTermCount = 0
  let totalTokenScore = 0
  let semanticHintMatchCount = 0

  for (const term of queryTerms) {
    const { bestFieldKind, bestMatch } = scoreQueryTerm(term, document)
    if (bestMatch > 0) {
      matchedTermCount += 1
      totalTokenScore += bestMatch
      if (bestFieldKind === 'hint' || bestFieldKind === 'guidance') {
        semanticHintMatchCount += 1
      }
    }
  }

  if (matchedTermCount === 0) {
    return 0
  }

  const coverage = matchedTermCount / queryTerms.length
  if (queryTerms.length > 1 && coverage < 0.5) {
    return 0
  }

  const averageTokenScore = totalTokenScore / queryTerms.length
  const phraseBoost = document.fields.some((field) => field.normalizedText.includes(normalizedQuery)) ? 24 : 0
  const completeCoverageBoost = coverage === 1 ? 22 : coverage * 8
  const missingTermPenalty = (queryTerms.length - matchedTermCount) * 5
  const semanticHintBoost = semanticHintMatchCount > 0 ? semanticHintMatchCount * 3 : 0
  const exactIdentifierBoost = document.fields.some(
    (field) => (field.kind === 'id' || field.kind === 'name') && field.normalizedText === normalizedQuery,
  )
    ? 34
    : 0

  return Math.max(
    0,
    averageTokenScore +
      phraseBoost +
      completeCoverageBoost +
      semanticHintBoost +
      exactIdentifierBoost -
      missingTermPenalty,
  )
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
  const documents = getSearchIndex(catalog)
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
