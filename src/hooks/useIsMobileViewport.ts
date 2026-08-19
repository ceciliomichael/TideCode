import { useEffect, useState } from 'react'
import { isRemoteBrowserRuntime } from '../remote/webBridge'

export const MOBILE_VIEWPORT_QUERY = '(max-width: 767px)'

function hasRemoteBrowserRuntimeMarker() {
  return typeof document !== 'undefined'
    && document.documentElement.dataset.tidecodeRuntime === 'remote-browser'
}

export function isRemoteMobileViewportRuntime() {
  return typeof window !== 'undefined'
    && (hasRemoteBrowserRuntimeMarker() || isRemoteBrowserRuntime())
    && window.matchMedia(MOBILE_VIEWPORT_QUERY).matches
}

export function useIsMobileViewport() {
const [isMobileViewport, setIsMobileViewport] = useState(isRemoteMobileViewportRuntime)

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_VIEWPORT_QUERY)
const handleChange = () => setIsMobileViewport(isRemoteMobileViewportRuntime())

    handleChange()
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  return isMobileViewport
}
