export interface BrowserTab {
  faviconUrl: string
  id: string
  title: string
}

export const DEFAULT_BROWSER_URL = 'https://www.google.com/'
const SEARCH_URL = 'https://www.google.com/search?q='

export function normalizeEmbeddedBrowserUserAgent(userAgent: string) {
  return userAgent
    .replace(/\sElectron\/[^\s]+/giu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

function parseHostCandidate(input: string) {
  try {
    return new URL(`http://${input}`).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function isLocalDevelopmentHost(input: string) {
  const hostname = parseHostCandidate(input)
  return (
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/u.test(hostname)
  )
}

function looksLikeHost(input: string) {
  if (input.includes(' ')) {
    return false
  }

  return (
    input.includes('.') ||
    input.startsWith('localhost') ||
    /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#].*)?$/u.test(input) ||
    /^\[[0-9a-f:]+\](?::\d+)?(?:[/?#].*)?$/iu.test(input) ||
    /^[a-z0-9-]+:\d+(?:[/?#].*)?$/iu.test(input)
  )
}

export function normalizeBrowserInput(value: string) {
  const input = value.trim()
  if (!input) {
    return DEFAULT_BROWSER_URL
  }

  if (/^https?:\/\//iu.test(input)) {
    return input
  }

  if (looksLikeHost(input)) {
    return `${isLocalDevelopmentHost(input) ? 'http' : 'https'}://${input}`
  }

  return `${SEARCH_URL}${encodeURIComponent(input)}`
}

export function createBrowserTab(): BrowserTab {
  return {
    faviconUrl: '',
    id: crypto.randomUUID(),
    title: 'New Tab',
  }
}

export function resolveBrowserTabTitle(title: string, url: string) {
  const trimmedTitle = title.trim()
  if (trimmedTitle) return trimmedTitle

  try {
    const parsed = new URL(url)
    return parsed.hostname || 'New Tab'
  } catch {
    return 'New Tab'
  }
}

export function selectBrowserTabAfterClose(
  tabs: readonly BrowserTab[],
  activeTabId: string,
  closingTabId: string,
) {
  if (activeTabId !== closingTabId) return activeTabId

  const closingIndex = tabs.findIndex((tab) => tab.id === closingTabId)
  if (closingIndex < 0) return activeTabId

  return tabs[closingIndex + 1]?.id ?? tabs[closingIndex - 1]?.id ?? activeTabId
}
