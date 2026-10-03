import { useCallback, useEffect, useRef, useState } from 'react'
import { isCachedBrowserFavicon, normalizeBrowserHistory, recordBrowserVisit, updateBrowserFavicon, type BrowserVisitedSite } from './browserHistory'

const normalizedIcons = new Map<string, Promise<string>>()

function cacheIconAsPng(source: string): Promise<string> {
  if (source.length > 180 * 1024 || !/^data:image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/u.test(source)) {
    return Promise.resolve('')
  }
  const cached = normalizedIcons.get(source)
  if (cached) {
    return cached
  }
  // Chromium decodes ICO and SVG as well as raster formats. Rendering only a
  // local data URL into a small canvas avoids CORS and further network requests.
  const normalized = new Promise<string>((resolve) => {
    const image = new Image()
    const finish = (dataUrl: string) => {
      clearTimeout(timeout)
      image.onload = null
      image.onerror = null
      image.src = ''
      resolve(dataUrl)
    }
    const timeout = setTimeout(() => finish(''), 3000)
    image.onerror = () => finish('')
    image.onload = () => {
      try {
        if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 1024 || image.naturalHeight > 1024) {
          finish('')
          return
        }
        const canvas = document.createElement('canvas')
        canvas.width = 32
        canvas.height = 32
        const context = canvas.getContext('2d')
        if (!context) {
          finish('')
          return
        }
        const scale = Math.min(32 / image.naturalWidth, 32 / image.naturalHeight)
        const width = image.naturalWidth * scale
        const height = image.naturalHeight * scale
        context.drawImage(image, (32 - width) / 2, (32 - height) / 2, width, height)
        const dataUrl = canvas.toDataURL('image/png')
        finish(isCachedBrowserFavicon(dataUrl) ? dataUrl : '')
      } catch {
        finish('')
      }
    }
    image.src = source
  })
  if (normalizedIcons.size >= 128) {
    const oldest = normalizedIcons.keys().next().value
    if (oldest !== undefined) {
      normalizedIcons.delete(oldest)
    }
  }
  normalizedIcons.set(source, normalized)
  return normalized
}

function loadBrowserHistory(storageKey: string): readonly BrowserVisitedSite[] {
  if (typeof window === 'undefined') {
    return []
  }
  try {
    const storedHistory = window.localStorage.getItem(storageKey)
    return normalizeBrowserHistory(storedHistory ? JSON.parse(storedHistory) : [])
  } catch {
    return []
  }
}

export function useBrowserHistory(projectKey: string) {
  const storageKey = `tidecode.browser.recentSites:${projectKey}`
  const [visitedSites, setVisitedSites] = useState(() => loadBrowserHistory(storageKey))
  const faviconRequestsRef = useRef(new Map<string, string>())

  useEffect(() => {
    const recentOrigins = new Set(visitedSites.map((site) => site.url))
    for (const origin of faviconRequestsRef.current.keys()) {
      if (!recentOrigins.has(origin)) {
        faviconRequestsRef.current.delete(origin)
      }
    }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(visitedSites))
    } catch {
      // Browsing still works when local storage is unavailable or full.
    }
  }, [storageKey, visitedSites])

  const cacheFavicon = useCallback((url: string, faviconDataUrl: string) => {
    const site = normalizeBrowserHistory([url])[0]
    if (!site) {
      return
    }
    faviconRequestsRef.current.set(site.url, faviconDataUrl)
    void cacheIconAsPng(faviconDataUrl).then((cachedIcon) => {
      if (faviconRequestsRef.current.get(site.url) === faviconDataUrl) {
        setVisitedSites((currentSites) => updateBrowserFavicon(currentSites, site.url, cachedIcon))
      }
    })
  }, [])

  const recordVisit = useCallback((url: string, faviconDataUrl?: string) => {
    setVisitedSites((currentSites) => recordBrowserVisit(currentSites, url))
    if (faviconDataUrl) {
      cacheFavicon(url, faviconDataUrl)
    }
  }, [cacheFavicon])

  return { visitedSites, recordVisit, cacheFavicon }
}
