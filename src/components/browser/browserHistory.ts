export interface BrowserVisitedSite {
  faviconDataUrl?: string
  label: string
  url: string
}

const MAX_RECENT_SITES = 6

export function isCachedBrowserFavicon(value: unknown): boolean {
  return typeof value === 'string'
    && value.length <= 48 * 1024
    && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/u.test(value)
}

function normalizeVisitedSite(value: string): BrowserVisitedSite | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }
    return {
      label: url.hostname.replace(/^www\./u, ''),
      url: `${url.origin}/`,
    }
  } catch {
    return null
  }
}

export function normalizeBrowserHistory(value: unknown): BrowserVisitedSite[] {
  if (!Array.isArray(value)) {
    return []
  }
  const sites: BrowserVisitedSite[] = []
  for (const candidate of value) {
    // Migrate the previously saved URL-only history without losing visits.
    const savedSite = typeof candidate === 'string' ? { url: candidate } : candidate
    if (!savedSite || typeof savedSite !== 'object' || typeof savedSite.url !== 'string') {
      continue
    }
    const site = normalizeVisitedSite(savedSite.url)
    if (!site || sites.some((existing) => existing.url === site.url)) {
      continue
    }
    if ('faviconDataUrl' in savedSite && typeof savedSite.faviconDataUrl === 'string' && isCachedBrowserFavicon(savedSite.faviconDataUrl)) {
      site.faviconDataUrl = savedSite.faviconDataUrl
    }
    sites.push(site)
    if (sites.length === MAX_RECENT_SITES) {
      break
    }
  }
  return sites
}

export function recordBrowserVisit(sites: readonly BrowserVisitedSite[], url: string): readonly BrowserVisitedSite[] {
  const site = normalizeVisitedSite(url)
  if (!site || sites[0]?.url === site.url) {
    return sites
  }
  const previousSite = sites.find((existing) => existing.url === site.url)
  return [previousSite ?? site, ...sites.filter((existing) => existing.url !== site.url)].slice(0, MAX_RECENT_SITES)
}

export function updateBrowserFavicon(sites: readonly BrowserVisitedSite[], url: string, faviconDataUrl: string): readonly BrowserVisitedSite[] {
  const site = normalizeVisitedSite(url)
  if (!site || !isCachedBrowserFavicon(faviconDataUrl)) {
    return sites
  }
  const existing = sites.find((candidate) => candidate.url === site.url)
  if (!existing || existing.faviconDataUrl === faviconDataUrl) {
    return sites
  }
  return sites.map((candidate) => {
    if (candidate.url === site.url) {
      return { ...candidate, faviconDataUrl }
    }
    return candidate
  })
}
