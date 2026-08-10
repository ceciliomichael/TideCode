export type WebSearchAction =
  | {
      type: 'search'
      query?: string
      queries?: string[]
    }
  | {
      type: 'openPage'
      url?: string
    }
  | {
      type: 'findInPage'
      pattern?: string
      url?: string
    }

export type WebSearchSource =
  | {
      title?: string
      type: 'url'
      url: string
    }
  | {
      name: string
      type: 'api'
    }

export interface WebSearchResult {
  action: WebSearchAction | null
  sources: WebSearchSource[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalizedValue = value.trim()
  return normalizedValue.length > 0 ? normalizedValue : undefined
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    const normalizedEntry = readNonEmptyString(entry)
    return normalizedEntry ? [normalizedEntry] : []
  })
}

function normalizeWebUrl(value: unknown): string | undefined {
  const candidate = readNonEmptyString(value)
  if (!candidate) {
    return undefined
  }

  try {
    const parsedUrl = new URL(candidate)
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return undefined
    }

    return parsedUrl.href
  } catch {
    return undefined
  }
}

function readAction(value: unknown): WebSearchAction | null {
  if (!isRecord(value)) {
    return null
  }

  const type = readNonEmptyString(value.type)
  if (type === 'search') {
    const query = readNonEmptyString(value.query)
    const queries = readStringArray(value.queries)

    return {
      type: 'search',
      ...(query ? { query } : {}),
      ...(queries.length > 0 ? { queries } : {}),
    }
  }

  if (type === 'openPage' || type === 'open_page') {
    const url = normalizeWebUrl(value.url)
    return {
      type: 'openPage',
      ...(url ? { url } : {}),
    }
  }

  if (type === 'findInPage' || type === 'find_in_page') {
    const pattern = readNonEmptyString(value.pattern)
    const url = normalizeWebUrl(value.url)
    return {
      type: 'findInPage',
      ...(pattern ? { pattern } : {}),
      ...(url ? { url } : {}),
    }
  }

  return null
}

function readUrlSource(value: Record<string, unknown>): WebSearchSource | null {
  const url = normalizeWebUrl(value.url)
  if (!url) {
    return null
  }

  const title = readNonEmptyString(value.title)
  return {
    type: 'url',
    url,
    ...(title ? { title } : {}),
  }
}

function readSource(value: unknown): WebSearchSource | null {
  if (!isRecord(value)) {
    return null
  }

  const type = readNonEmptyString(value.type)
  if (type === 'url' || type === 'url_citation') {
    const nestedCitation = isRecord(value.url_citation) ? value.url_citation : null
    return readUrlSource(nestedCitation ?? value)
  }

  if (type === 'api') {
    const name = readNonEmptyString(value.name)
    return name ? { name, type: 'api' } : null
  }

  if (isRecord(value.url_citation)) {
    return readUrlSource(value.url_citation)
  }

  return readUrlSource(value)
}

interface CollectedWebSearchValues {
  actionValues: unknown[]
  hasActionField: boolean
  hasSourcesField: boolean
  sourceValues: unknown[]
  sawWebSearchCall: boolean
}

function collectWebSearchValues(value: unknown, collected: CollectedWebSearchValues, visited: Set<object>) {
  if (Array.isArray(value)) {
    if (visited.has(value)) {
      return
    }

    visited.add(value)
    for (const entry of value) {
      collectWebSearchValues(entry, collected, visited)
    }
    return
  }

  if (!isRecord(value) || visited.has(value)) {
    return
  }

  visited.add(value)

  const directAction = readAction(value)
  if (directAction) {
    collected.actionValues.push(value)
  }

  if (value.type === 'web_search_call') {
    collected.sawWebSearchCall = true
    collected.hasActionField = true
    collected.actionValues.push(value.action)
  }

  if ('action' in value) {
    collected.hasActionField = true
    collected.actionValues.push(value.action)
  }

  if ('sources' in value) {
    collected.hasSourcesField = true
    if (Array.isArray(value.sources)) {
      collected.sourceValues.push(...value.sources)
    }
  }

  if (value.type === 'url_citation' || isRecord(value.url_citation)) {
    collected.sourceValues.push(value)
  }

  if (Array.isArray(value.annotations)) {
    collectWebSearchValues(value.annotations, collected, visited)
  }

  if (Array.isArray(value.content)) {
    collectWebSearchValues(value.content, collected, visited)
  }

  if (Array.isArray(value.output)) {
    collectWebSearchValues(value.output, collected, visited)
  }

  if (isRecord(value.action)) {
    collectWebSearchValues(value.action, collected, visited)
  }
}

function appendUniqueSources(sources: WebSearchSource[], candidates: readonly unknown[]) {
  const sourceIndexByKey = new Map<string, number>()

  for (const [index, source] of sources.entries()) {
    sourceIndexByKey.set(source.type === 'url' ? `url:${source.url}` : `api:${source.name}`, index)
  }

  for (const candidate of candidates) {
    const source = readSource(candidate)
    if (!source) {
      continue
    }

    const sourceKey = source.type === 'url' ? `url:${source.url}` : `api:${source.name}`
    const existingIndex = sourceIndexByKey.get(sourceKey)
    if (existingIndex === undefined) {
      sourceIndexByKey.set(sourceKey, sources.length)
      sources.push(source)
      continue
    }

    const existingSource = sources[existingIndex]
    if (source.type === 'url' && existingSource?.type === 'url' && !existingSource.title && source.title) {
      sources[existingIndex] = {
        ...existingSource,
        title: source.title,
      }
    }
  }
}

function appendActionUrlSource(sources: WebSearchSource[], action: WebSearchAction | null) {
  if (!action || (action.type !== 'openPage' && action.type !== 'findInPage') || !action.url) {
    return
  }

  appendUniqueSources(sources, [{ type: 'url', url: action.url }])
}

export function parseWebSearchToolResult(value: unknown): WebSearchResult | null {
  const collected: CollectedWebSearchValues = {
    actionValues: [],
    hasActionField: false,
    hasSourcesField: false,
    sourceValues: [],
    sawWebSearchCall: false,
  }
  collectWebSearchValues(value, collected, new Set<object>())

  const action = collected.actionValues.map(readAction).find((candidate): candidate is WebSearchAction => candidate !== null) ?? null
  const sources: WebSearchSource[] = []
  appendUniqueSources(sources, collected.sourceValues)
  appendActionUrlSource(sources, action)

  const hasProviderShape =
    collected.sawWebSearchCall ||
    collected.hasActionField ||
    collected.hasSourcesField ||
    action !== null ||
    sources.length > 0

  return hasProviderShape ? { action, sources } : null
}

export function parseWebSearchToolResultBody(body: string): WebSearchResult | null {
  try {
    return parseWebSearchToolResult(JSON.parse(body) as unknown)
  } catch {
    return null
  }
}

export function getWebSearchSourceHost(source: Extract<WebSearchSource, { type: 'url' }>) {
  try {
    return new URL(source.url).hostname.replace(/^www\./u, '')
  } catch {
    return source.url
  }
}

export function getWebSearchSourceLabel(source: Extract<WebSearchSource, { type: 'url' }>) {
  try {
    const parsedUrl = new URL(source.url)
    const path = parsedUrl.pathname === '/' ? '' : parsedUrl.pathname
    return `${parsedUrl.hostname.replace(/^www\./u, '')}${path}`
  } catch {
    return source.url
  }
}

export function formatWebSearchAction(action: WebSearchAction | null) {
  if (!action) {
    return 'Web search completed'
  }

  if (action.type === 'search') {
    const queries = action.queries?.length ? action.queries : action.query ? [action.query] : []
    return queries.length > 0 ? `Searched for ${queries.join(' · ')}` : 'Searched the web'
  }

  if (action.type === 'openPage') {
    return action.url ? `Opened ${getWebSearchSourceHost({ type: 'url', url: action.url })}` : 'Opened a page'
  }

  return action.pattern ? `Looked for “${action.pattern}” in a page` : 'Looked inside a page'
}

function escapeMarkdownText(value: string) {
  return value
    .replace(/[\r\n]+/gu, ' ')
    .replace(/([\\`*_[\]{}])/gu, '\\$1')
}

function formatMarkdownLinkDestination(url: string) {
  return url.replace(/[<>]/gu, (character) => encodeURIComponent(character))
}

export function formatWebSearchResultAsMarkdown(result: WebSearchResult) {
  const lines = [escapeMarkdownText(formatWebSearchAction(result.action))]

  if (result.sources.length === 0) {
    return lines.join('\n')
  }

  lines.push('', '### Sources')
  for (const source of result.sources) {
    if (source.type === 'api') {
      lines.push(`- ${escapeMarkdownText(source.name)}`)
      continue
    }

    const label = escapeMarkdownText(source.title ?? getWebSearchSourceLabel(source))
    lines.push(`- [${label}](<${formatMarkdownLinkDestination(source.url)}>)`)
  }

  return lines.join('\n')
}

export function normalizeWebSearchMarkdownBody(body: string) {
  const result = parseWebSearchToolResultBody(body)
  return result ? formatWebSearchResultAsMarkdown(result) : body
}
