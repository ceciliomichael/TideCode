import { useEffect, useState } from 'react'
import { isRemoteBrowserRuntime } from '../remote/webBridge'

export const MOBILE_VIEWPORT_QUERY = '(max-width: 767px)'

function readMobileViewportMatch() {
  return typeof window !== 'undefined'
    && isRemoteBrowserRuntime()
    && window.matchMedia(MOBILE_VIEWPORT_QUERY).matches
}

export function useIsMobileViewport() {
  const [isMobileViewport, setIsMobileViewport] = useState(readMobileViewportMatch)

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_VIEWPORT_QUERY)
    const handleChange = () => setIsMobileViewport(isRemoteBrowserRuntime() && mediaQuery.matches)

    handleChange()
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  return isMobileViewport
}
