import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type RefObject,
} from 'react'
import {
  type BrowserScreenshot,
  BROWSER_ZOOM_LEVELS,
} from '../../types/browser'

export interface BrowserPageState {
  isWebsite: boolean
  canUsePage: boolean
  zoomPercent: number
}
export interface BrowserPageControls {
  captureScreenshot: () => Promise<BrowserScreenshot>
  openDevTools: () => Promise<void>
  changeZoom: (direction: -1 | 0 | 1) => Promise<void>
}

interface BrowserPageActionsInput {
  projectPath: string
  active: boolean
  isElectron: boolean
  isNewTab: boolean
  webviewRef: RefObject<
    (HTMLElement & { getWebContentsId?: () => number }) | null
  >
  controlsRef: RefObject<BrowserPageControls | null> | null
  onStateChange: (state: BrowserPageState) => void
}

export function useBrowserPageActions({
  projectPath,
  active,
  isElectron,
  isNewTab,
  webviewRef,
  controlsRef,
  onStateChange,
}: BrowserPageActionsInput) {
  const [pageState, setPageState] = useState<
    Omit<BrowserPageState, 'isWebsite'>
  >({ canUsePage: false, zoomPercent: 100 })
  const zoomRef = useRef(100)
  const pendingZoomRef = useRef<number | null>(null)
  const zoomRevisionRef = useRef(0)
  const [zoomFeedbackRevision, setZoomFeedbackRevision] = useState(0)
  const navigationReadyRef = useRef(false)
  const [canCapturePage, setCanCapturePage] = useState(false)
  const getTarget = useCallback(() => {
    const guest = webviewRef.current
    const webContentsId = guest?.getWebContentsId?.()
    if (!guest?.isConnected || !webContentsId) {
      throw new Error('Open a webpage first.')
    }
    return { webContentsId }
  }, [webviewRef])

  const openDevTools = useCallback(async () => {
    if (!(await window.tidecodeBrowserDevTools.open(getTarget()))) {
      throw new Error('Could not open page DevTools.')
    }
  }, [getTarget])

  const changeZoom = useCallback(
    async (direction: -1 | 0 | 1) => {
      let percent = 100
      if (direction === 1) {
        percent =
          BROWSER_ZOOM_LEVELS.find((level) => level > zoomRef.current) ?? 500
      } else if (direction === -1) {
        percent =
          [...BROWSER_ZOOM_LEVELS]
            .reverse()
            .find((level) => level < zoomRef.current) ?? 25
      }
      const revision = ++zoomRevisionRef.current
      setZoomFeedbackRevision(revision)
      pendingZoomRef.current = percent
      zoomRef.current = percent
      setPageState((current) => ({ ...current, zoomPercent: percent }))
      let target: { webContentsId: number }
      try {
        target = getTarget()
      } catch {
        // A redirect can begin before Electron exposes its guest ID. Keep the
        // user's zoom choice and apply it as soon as that guest becomes ready.
        return
      }
      const applied = await window.tidecodeBrowserPageActions.setZoom({
        ...target,
        percent,
      })
      if (
        zoomRevisionRef.current === revision &&
        webviewRef.current?.getWebContentsId?.() === target.webContentsId
      ) {
        if (navigationReadyRef.current) {
          pendingZoomRef.current = null
        }
        zoomRef.current = applied
        setPageState({ canUsePage: true, zoomPercent: applied })
      }
    },
    [getTarget, webviewRef],
  )

  const captureScreenshot = useCallback(async () => {
    if (!navigationReadyRef.current) {
      throw new Error(
        'Wait for the webpage to appear before taking a screenshot.',
      )
    }
    return window.tidecodeBrowserPageActions.captureScreenshot({
      ...getTarget(),
      projectPath,
    })
  }, [getTarget, projectPath])

  useImperativeHandle(
    controlsRef,
    () => ({ openDevTools, changeZoom, captureScreenshot }),
    [openDevTools, changeZoom, captureScreenshot],
  )

  useEffect(() => {
    const guest = webviewRef.current
    if (!isElectron || isNewTab || !guest) {
      zoomRef.current = 100
      pendingZoomRef.current = null
      navigationReadyRef.current = false
      setCanCapturePage(false)
      zoomRevisionRef.current += 1
      setPageState({ canUsePage: false, zoomPercent: 100 })
      return
    }
    let disposed = false
    const syncZoom = () => {
      let target: { webContentsId: number }
      try {
        target = getTarget()
      } catch {
        return
      }
      const revision = zoomRevisionRef.current
      const pendingZoom = pendingZoomRef.current
      const request =
        pendingZoom === null
          ? window.tidecodeBrowserPageActions.getZoom(target)
          : window.tidecodeBrowserPageActions.setZoom({
              ...target,
              percent: pendingZoom,
            })
      void request
        .then((zoomPercent) => {
          if (!disposed && revision === zoomRevisionRef.current) {
            if (navigationReadyRef.current) {
              pendingZoomRef.current = null
            }
            zoomRef.current = zoomPercent
            setPageState({ canUsePage: true, zoomPercent })
          }
        })
        .catch(() => {
          if (!disposed) {
            setPageState((current) => ({ ...current, canUsePage: false }))
          }
        })
    }
    const handleDomReady = () => {
      navigationReadyRef.current = true
      setCanCapturePage(true)
      syncZoom()
    }
    const handleNavigation = (event: Event) => {
      const navigation = event as Event & {
        isMainFrame?: boolean
        isInPlace?: boolean
      }
      if (navigation.isMainFrame === false || navigation.isInPlace) {
        return
      }
      navigationReadyRef.current = false
      setCanCapturePage(false)
    }
    const handleGuestGone = () => {
      navigationReadyRef.current = false
      setCanCapturePage(false)
    }
    syncZoom()
    guest.addEventListener('dom-ready', handleDomReady)
    guest.addEventListener('did-start-navigation', handleNavigation)
    guest.addEventListener('render-process-gone', handleGuestGone)
    guest.addEventListener('destroyed', handleGuestGone)
    return () => {
      disposed = true
      guest.removeEventListener('dom-ready', handleDomReady)
      guest.removeEventListener('did-start-navigation', handleNavigation)
      guest.removeEventListener('render-process-gone', handleGuestGone)
      guest.removeEventListener('destroyed', handleGuestGone)
    }
  }, [active, getTarget, isElectron, isNewTab, webviewRef])

  useEffect(() => {
    if (!isElectron || isNewTab || !active) {
      return
    }
    return window.tidecodeBrowserPageActions.onZoomRequest((id, direction) => {
      try {
        if (getTarget().webContentsId !== id) {
          return
        }
        if (direction === 'in') {
          void changeZoom(1).catch(console.error)
        } else if (direction === 'out') {
          void changeZoom(-1).catch(console.error)
        }
      } catch {
        // A guest can detach while the user switches tabs.
      }
    })
  }, [active, changeZoom, getTarget, isElectron, isNewTab])

  useEffect(() => {
    if (active) {
      onStateChange({ ...pageState, isWebsite: isElectron && !isNewTab })
    }
  }, [active, isElectron, isNewTab, onStateChange, pageState])

  useEffect(() => {
    if (!isElectron) {
      return
    }
    return window.tidecodeBrowserDevTools.onShortcut((id) => {
      try {
        if (webviewRef.current?.getWebContentsId?.() === id) {
          void openDevTools().catch(console.error)
        }
      } catch {
        // Background guests can detach while switching projects.
      }
    })
  }, [isElectron, openDevTools, webviewRef])

  return { openDevTools, captureScreenshot, canCapturePage, changeZoom, zoomPercent: pageState.zoomPercent, zoomFeedbackRevision }
}
