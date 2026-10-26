export type BrowserPlacement = 'main' | 'side'

const STORAGE_KEY = 'tidecode:browser-placement'

export function loadBrowserPlacement(): BrowserPlacement {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'main' ? 'main' : 'side'
  } catch {
    return 'side'
  }
}

export function saveBrowserPlacement(placement: BrowserPlacement) {
  try {
    window.localStorage.setItem(STORAGE_KEY, placement)
  } catch (error) {
    console.warn('Unable to save Browser placement.', error)
  }
}
