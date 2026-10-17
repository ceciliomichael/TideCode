export interface AvailableApiMatch {
  path: string
  description: string
  namespace: string
  signature: string
}

export interface AvailableSearchOptions {
  query?: string
  namespace?: string
  limit?: number
  offset?: number
}

/** Discovery returns names only. The full contract is intentionally reserved for available.get. */
export function searchAvailableApis(items: readonly AvailableApiMatch[], input: AvailableSearchOptions) {
  const query = input.query?.trim().toLowerCase() ?? ''
  const namespace = input.namespace?.trim().toLowerCase()
  const terms = query.split(/\s+/u).filter(Boolean)
  const limit = Math.max(1, Math.min(50, input.limit ?? 10))
  const offset = Math.max(0, input.offset ?? 0)
  const matching = items.map((item) => {
    const haystack = `${item.path} ${item.description} ${item.namespace}`.toLowerCase()
    const score = terms.reduce((sum, term) => sum
      + (item.path.toLowerCase().includes(term) ? 50 : 0)
      + (item.description.toLowerCase().includes(term) ? 10 : 0)
      + (item.namespace.toLowerCase().includes(term) ? 15 : 0), 0)
    return { item, score, haystack }
  }).filter(({ item, score, haystack }) =>
    (!namespace || (namespace === 'native' ? item.namespace !== 'mcp' : item.namespace === namespace))
    && (terms.length === 0 || terms.every((term) => haystack.includes(term)) && score > 0))
    .sort((left, right) => right.score - left.score || left.item.path.localeCompare(right.item.path))
  const page = matching.slice(offset, offset + limit).map(({ item }) => ({ name: item.path }))
  const remaining = Math.max(0, matching.length - offset - page.length)
  return { items: page, remaining, next: remaining > 0 ? { offset: offset + page.length } : null }
}
