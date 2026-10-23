import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowserUrlRequest } from '../../types/browser'

export function useBrowserUrlRequests(onOpen: () => void) {
  const [requests, setRequests] = useState<BrowserUrlRequest[]>([])
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen

  useEffect(() => window.tidecodeBrowserPageActions?.onUrlOpen?.((request) => {
    setRequests((current) => [...current, request])
    onOpenRef.current()
  }), [])

  const consumeRequests = useCallback((ids: readonly string[]) => {
    setRequests((current) => current.filter((request) => !ids.includes(request.id)))
  }, [])

  return { requests, consumeRequests }
}
