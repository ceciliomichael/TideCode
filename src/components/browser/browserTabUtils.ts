export interface BrowserTab {
  faviconUrl: string
  id: string
  title: string
}

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

function windowsPathToFileUrl(input: string) {
  const normalizedPath = input.replace(/\\/gu, '/')
  const driveMatch = /^([a-z]):\/(.*)$/iu.exec(normalizedPath)
  if (driveMatch) {
    const drive = driveMatch[1].toUpperCase()
    const encodedPath = driveMatch[2]
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')
    return `file:///${drive}:/${encodedPath}`
  }

  const uncMatch = /^\/\/([^/]+)\/(.*)$/u.exec(normalizedPath)
  if (uncMatch) {
    const host = uncMatch[1]
    const encodedPath = uncMatch[2]
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')
    return `file://${host}/${encodedPath}`
  }

  return null
}

export function normalizeBrowserInput(value: string) {
  const input = value.trim()
  if (!input) {
    return ''
  }

  if (/^file:\/\//iu.test(input)) {
    return input
  }

  const localFileUrl = windowsPathToFileUrl(input)
  if (localFileUrl) {
    return localFileUrl
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
    if (parsed.protocol === 'file:') {
      const fileName = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() ?? '')
      return fileName || 'Local File'
    }
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
