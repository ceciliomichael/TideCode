export interface BrowserTab {
  id: string
  title: string
}

export const DEFAULT_BROWSER_URL = 'https://www.google.com/'

export function createBrowserTab(): BrowserTab {
  return {
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
