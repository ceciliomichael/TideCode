import { useEffect, useState } from 'react'

export const MOBILE_VIEWPORT_QUERY = '(max-width: 767px)'

function readMobileViewportMatch() {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_VIEWPORT_QUERY).matches
}

export function useIsMobileViewport() {
  const [isMobileViewport, setIsMobileViewport] = useState(readMobileViewportMatch)

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_VIEWPORT_QUERY)
    const handleChange = () => setIsMobileViewport(mediaQuery.matches)

    handleChange()
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  return isMobileViewport
}
