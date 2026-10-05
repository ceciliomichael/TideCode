import { createElement, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Code2, EllipsisVertical, Globe2, Home, LoaderCircle, RefreshCw, Search, X } from 'lucide-react'
import type { BrowserDevToolsDockMode } from '../../types/browser'
import { Tooltip } from '../Tooltip'
import { BrowserTabsBar } from './BrowserTabsBar'
import { BrowserNewTabPage } from './BrowserNewTabPage'
import type { BrowserVisitedSite } from './browserHistory'
import { useBrowserHistory } from './useBrowserHistory'
import {
  createBrowserTab,
  normalizeEmbeddedBrowserUserAgent,
  normalizeBrowserInput,
  resolveBrowserTabTitle,
  selectBrowserTabAfterClose,
  type BrowserTab,
} from './browserTabUtils'

type TidecodeWebview = HTMLElement & {
  canGoBack?: () => boolean
  canGoForward?: () => boolean
  closeDevTools?: () => void
  goBack?: () => void
  goForward?: () => void
  getWebContentsId?: () => number
  isDevToolsOpened?: () => boolean
  loadURL?: (url: string) => Promise<void>
  openDevTools?: () => void
  reload?: () => void
  stop?: () => void
  getTitle?: () => string
  getURL?: () => string
  executeJavaScript?: (code: string) => Promise<unknown>
}

interface BrowserLoadFailure {
  errorCode: number | null
  message: string
  url: string
}

interface BrowserPanelProps {
  active: boolean
  onClose: () => void
  projectKey: string
}

interface BrowserTabSessionProps {
  active: boolean
  devToolsMode: BrowserDevToolsDockMode
  onDevToolsModeChange: (mode: BrowserDevToolsDockMode) => void
  onFaviconChange: (tabId: string, faviconUrl: string) => void
  onCacheFavicon: (url: string, faviconDataUrl: string) => void
  onTitleChange: (tabId: string, title: string) => void
  onVisit: (url: string, faviconDataUrl?: string) => void
  visitedSites: readonly BrowserVisitedSite[]
  tabId: string
}

function BrowserTabSession({
  active,
  devToolsMode,
  onDevToolsModeChange,
  onFaviconChange,
  onCacheFavicon,
  onTitleChange,
  onVisit,
  visitedSites,
  tabId,
}: BrowserTabSessionProps) {
  const webviewRef = useRef<TidecodeWebview | null>(null)
  const webviewReadyRef = useRef(false)
  const addressInputRef = useRef<HTMLInputElement | null>(null)
  const addressFocusedRef = useRef(false)
  const addressEditingRef = useRef(false)
  const pendingNavigationRef = useRef<{ started: boolean; url: string } | null>(null)
  const devToolsMenuButtonRef = useRef<HTMLButtonElement | null>(null)
  const devToolsHostRef = useRef<HTMLDivElement | null>(null)
  const isElectron = useMemo(() => navigator.userAgent.toLowerCase().includes('electron'), [])
  const embeddedBrowserUserAgent = useMemo(
    () => normalizeEmbeddedBrowserUserAgent(navigator.userAgent),
    [],
  )
  const [address, setAddress] = useState('')
  const [currentUrl, setCurrentUrl] = useState('')
  const [iframeUrl, setIframeUrl] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [loadFailure, setLoadFailure] = useState<BrowserLoadFailure | null>(null)
  const [devToolsOpen, setDevToolsOpen] = useState(false)
  const isNewTab = !currentUrl

  const releaseAddressEditing = useCallback(() => {
    addressEditingRef.current = false
  }, [])

  const hideDockedDevToolsThenClose = useCallback((webContentsId: number) => {
    void window.tidecodeBrowserDevTools
      .setVisible({ visible: false, webContentsId })
      .catch(() => false)
      .then(() => setDevToolsOpen(false))
  }, [])

  const updateTitle = useCallback((title: string, url: string) => {
    onTitleChange(tabId, resolveBrowserTabTitle(title, url))
  }, [onTitleChange, tabId])

  const handleWebviewRef = useCallback((node: TidecodeWebview | null) => {
    if (webviewRef.current !== node) {
      webviewReadyRef.current = false
    }
    webviewRef.current = node
  }, [])

  useEffect(() => {
    if (active && isNewTab) {
      addressInputRef.current?.focus()
    }
  }, [active, isNewTab])

  useEffect(() => {
    if (active || !isElectron) return

    const webview = webviewRef.current
    if (!webview) return

    webview.blur()
    if (!webviewReadyRef.current || !webview.isConnected) return

    try {
      void webview.executeJavaScript?.('document.activeElement instanceof HTMLElement && document.activeElement.blur()')
        .catch(() => undefined)
    } catch {
      // The webview may detach between the readiness check and this call.
    }
  }, [active, isElectron])

  useEffect(() => {
    if (!isElectron) {
      return
    }

    const handleClosed = (webContentsId: number) => {
      try {
        if (webviewRef.current?.getWebContentsId?.() === webContentsId) {
          setDevToolsOpen(false)
        }
      } catch {
        // The webview may already be detached.
      }
    }
    const handleShortcut = (webContentsId: number) => {
      try {
        if (webviewRef.current?.getWebContentsId?.() !== webContentsId) {
          return
        }
        if (devToolsOpen) {
          if (devToolsMode === 'undocked') {
            void window.tidecodeBrowserDevTools.close({ webContentsId })
            setDevToolsOpen(false)
          } else {
            hideDockedDevToolsThenClose(webContentsId)
          }
        } else {
          setDevToolsOpen(true)
        }
      } catch {
        // The webview may already be detached.
      }
    }

    const unsubscribeClosed = window.tidecodeBrowserDevTools.onClosed(handleClosed)
    const unsubscribeShortcut = window.tidecodeBrowserDevTools.onShortcut(handleShortcut)
    return () => {
      unsubscribeClosed()
      unsubscribeShortcut()
    }
  }, [devToolsMode, devToolsOpen, hideDockedDevToolsThenClose, isElectron])

  useEffect(() => {
    if (!isElectron || !devToolsOpen) {
      return
    }

    const webview = webviewRef.current
    if (!webview || !webview.isConnected) {
      return
    }

    let webContentsId = 0
    try {
      webContentsId = webview.getWebContentsId?.() ?? 0
    } catch {
      return
    }
    if (!webContentsId) {
      return
    }

    if (!active) {
      if (devToolsMode !== 'undocked') {
        void window.tidecodeBrowserDevTools.setVisible({ visible: false, webContentsId })
      }
      return
    }

    if (devToolsMode === 'undocked') {
      void window.tidecodeBrowserDevTools.open({ mode: 'undocked', webContentsId })
      return
    }

    const host = devToolsHostRef.current
    if (!host) {
      return
    }

    const syncBounds = () => {
      const rect = host.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) {
        return
      }
      const bounds = {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      }
      void window.tidecodeBrowserDevTools.updateBounds({ bounds, webContentsId })
    }

    const initialRect = host.getBoundingClientRect()
    if (initialRect.width < 1 || initialRect.height < 1) {
      return
    }

    void window.tidecodeBrowserDevTools.open({
      bounds: {
        x: initialRect.left,
        y: initialRect.top,
        width: initialRect.width,
        height: initialRect.height,
      },
      mode: devToolsMode,
      webContentsId,
    })
    void window.tidecodeBrowserDevTools.setVisible({ visible: true, webContentsId })

    const observer = new ResizeObserver(syncBounds)
    observer.observe(host)
    window.addEventListener('resize', syncBounds)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncBounds)
      void window.tidecodeBrowserDevTools.setVisible({ visible: false, webContentsId })
    }
  }, [active, devToolsMode, devToolsOpen, isElectron])

  const syncNavigationState = useCallback((nextUrlOverride?: string) => {
    const webview = webviewRef.current
    if (!webview) return

    setCanGoBack(Boolean(webview.canGoBack?.()))
    setCanGoForward(Boolean(webview.canGoForward?.()))
    const nextUrl = nextUrlOverride || webview.getURL?.()
    if (pendingNavigationRef.current) {
      return
    }
    if (nextUrl && !addressFocusedRef.current && !addressEditingRef.current) {
      setAddress(nextUrl)
    }
    updateTitle(webview.getTitle?.() ?? '', nextUrl || currentUrl)
  }, [currentUrl, updateTitle])

  useEffect(() => {
    if (!isElectron) return

    const webview = webviewRef.current
    if (!webview) return

    const handleDomReady = () => {
      webviewReadyRef.current = true
      if (active) return

      try {
        void webview.executeJavaScript?.('document.activeElement instanceof HTMLElement && document.activeElement.blur()')
          .catch(() => undefined)
      } catch {
        // The webview may detach while the workspace/browser surface changes.
      }
    }
    const handleStartNavigation = (event: Event) => {
      const navigationEvent = event as Event & { isMainFrame?: boolean; url?: string }
      if (navigationEvent.isMainFrame === false) {
        return
      }
      const pendingNavigation = pendingNavigationRef.current
      if (pendingNavigation && navigationEvent.url) {
        try {
          if (new URL(navigationEvent.url).href === new URL(pendingNavigation.url).href) {
            pendingNavigation.started = true
          }
        } catch {
          if (navigationEvent.url === pendingNavigation.url) {
            pendingNavigation.started = true
          }
        }
      }
      setLoadFailure(null)
      onFaviconChange(tabId, '')
    }
    const handleStart = () => setIsLoading(true)
    const handleStop = () => {
      setIsLoading(false)
      syncNavigationState()
    }
    const handleNavigate = (event: Event) => {
      const navigationEvent = event as Event & { isMainFrame?: boolean; url?: string }
      if (navigationEvent.isMainFrame === false) {
        return
      }
      const pendingNavigation = pendingNavigationRef.current
      if (pendingNavigation) {
        if (!pendingNavigation.started || !navigationEvent.url) {
          return
        }
        // Redirects may commit a different URL. Only accept the current guest's
        // committed navigation, rather than requiring the original request URL.
        const guestUrl = webview.getURL?.()
        if (guestUrl && navigationEvent.url !== guestUrl) {
          return
        }
        pendingNavigationRef.current = null
      }
      syncNavigationState(navigationEvent.url)
      const visitedUrl = navigationEvent.url || webview.getURL?.()
      if (visitedUrl) {
        onVisit(visitedUrl)
      }
    }
    const handleTitle = (event: Event) => {
      const title = (event as Event & { title?: string }).title ?? webview.getTitle?.() ?? ''
      updateTitle(title, webview.getURL?.() || currentUrl)
    }
    const handleFavicon = (event: Event) => {
      const faviconEvent = event as Event & { favicons?: string[] }
      const faviconUrl = faviconEvent.favicons?.find((url) => typeof url === 'string' && url.trim())?.trim() ?? ''
      onFaviconChange(tabId, faviconUrl)
      const webContentsId = webview.getWebContentsId?.()
      if (webContentsId && window.tidecodeBrowserFavicons) {
        void window.tidecodeBrowserFavicons.get(webContentsId).then((page) => {
          if (page && webviewRef.current === webview && webview.getURL?.() === page.url) {
            onCacheFavicon(page.url, page.faviconDataUrl)
          }
        }).catch(() => undefined)
      }
    }
    const handleFailLoad = (event: Event) => {
      const failedLoadEvent = event as Event & {
        errorCode?: number
        errorDescription?: string
        isMainFrame?: boolean
        validatedURL?: string
      }
      if (failedLoadEvent.isMainFrame === false || failedLoadEvent.errorCode === -3) {
        return
      }

      pendingNavigationRef.current = null
      setIsLoading(false)
      setLoadFailure({
        errorCode: typeof failedLoadEvent.errorCode === 'number' ? failedLoadEvent.errorCode : null,
        message: failedLoadEvent.errorDescription?.trim() || 'The page could not be loaded.',
        url: failedLoadEvent.validatedURL?.trim() || webview.getURL?.() || currentUrl,
      })
    }
    const handleRenderProcessGone = (event: Event) => {
      const goneEvent = event as Event & {
        details?: {
          exitCode?: number
          reason?: string
        }
      }
      const reason = goneEvent.details?.reason?.trim()
      setIsLoading(false)
      setLoadFailure({
        errorCode: typeof goneEvent.details?.exitCode === 'number' ? goneEvent.details.exitCode : null,
        message: reason ? `The page renderer stopped: ${reason}.` : 'The page renderer stopped unexpectedly.',
        url: webview.getURL?.() || currentUrl,
      })
    }

    webview.addEventListener('dom-ready', handleDomReady)
    webview.addEventListener('did-start-navigation', handleStartNavigation)
    webview.addEventListener('did-start-loading', handleStart)
    webview.addEventListener('did-stop-loading', handleStop)
    webview.addEventListener('did-fail-load', handleFailLoad)
    webview.addEventListener('did-navigate', handleNavigate)
    webview.addEventListener('did-navigate-in-page', handleNavigate)
    webview.addEventListener('page-favicon-updated', handleFavicon)
    webview.addEventListener('page-title-updated', handleTitle)
    webview.addEventListener('render-process-gone', handleRenderProcessGone)

    return () => {
      webview.removeEventListener('dom-ready', handleDomReady)
      webview.removeEventListener('did-start-navigation', handleStartNavigation)
      webview.removeEventListener('did-start-loading', handleStart)
      webview.removeEventListener('did-stop-loading', handleStop)
      webview.removeEventListener('did-fail-load', handleFailLoad)
      webview.removeEventListener('did-navigate', handleNavigate)
      webview.removeEventListener('did-navigate-in-page', handleNavigate)
      webview.removeEventListener('page-favicon-updated', handleFavicon)
      webview.removeEventListener('page-title-updated', handleTitle)
      webview.removeEventListener('render-process-gone', handleRenderProcessGone)
    }
  }, [active, currentUrl, isElectron, onCacheFavicon, onFaviconChange, onVisit, syncNavigationState, tabId, updateTitle])

  const navigate = useCallback(
    (rawValue: string) => {
      const nextUrl = normalizeBrowserInput(rawValue)
      if (!nextUrl) {
        return
      }
      releaseAddressEditing()
      setAddress(nextUrl)
      setCurrentUrl(nextUrl)
      setLoadFailure(null)
      setIsLoading(true)
      updateTitle('', nextUrl)

      if (isElectron) {
        const pendingNavigation = { started: false, url: nextUrl }
        pendingNavigationRef.current = webviewReadyRef.current ? pendingNavigation : null
        // The src attribute owns navigation, including the first guest mount.
        // Submitting the same src still needs an explicit navigation.
        const webview = webviewRef.current
        if (nextUrl === currentUrl && webviewReadyRef.current && webview?.loadURL) {
          void webview.loadURL(nextUrl).catch(() => {
            if (pendingNavigationRef.current === pendingNavigation) {
              pendingNavigationRef.current = null
              setIsLoading(false)
            }
          })
        }
        return
      }

      setIframeUrl(nextUrl)
    },
    [currentUrl, isElectron, releaseAddressEditing, updateTitle],
  )

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    navigate(address)
  }

  const handleHome = () => {
    releaseAddressEditing()
    pendingNavigationRef.current = null
    setAddress('')
    setCurrentUrl('')
    setIframeUrl('')
    setIsLoading(false)
    setCanGoBack(false)
    setCanGoForward(false)
    setLoadFailure(null)
    setDevToolsOpen(false)
    onFaviconChange(tabId, '')
    updateTitle('', '')
  }
  const handleToggleDevTools = () => {
    const webview = webviewRef.current
    if (!webview || !webview.isConnected) {
      return
    }
    try {
      const webContentsId = webview.getWebContentsId?.()
      if (!webContentsId) {
        return
      }
      if (devToolsOpen) {
        if (devToolsMode === 'undocked') {
          void window.tidecodeBrowserDevTools.close({ webContentsId })
          setDevToolsOpen(false)
        } else {
          hideDockedDevToolsThenClose(webContentsId)
        }
      } else {
        setDevToolsOpen(true)
      }
    } catch {
      // The guest may detach between the connected check and the call.
    }
  }

  const handleSelectDevToolsMode = (mode: BrowserDevToolsDockMode) => {
    onDevToolsModeChange(mode)
  }

  const handleShowDevToolsMenu = () => {
    const menuButton = devToolsMenuButtonRef.current
    if (!menuButton) {
      return
    }

    const rect = menuButton.getBoundingClientRect()
    const styles = getComputedStyle(document.documentElement)
    const readColor = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback

    void window.tidecodeBrowserDevTools.showDockMenu({
      anchor: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
      mode: devToolsMode,
      theme: {
        activeSurface: readColor('--color-brand-soft', '#223630'),
        background: readColor('--color-surface', '#171718'),
        border: readColor('--color-border', '#36363a'),
        brand: readColor('--color-brand', '#7fa59c'),
        foreground: readColor('--color-foreground', '#e7e7e7'),
        hoverSurface: readColor('--color-surface-muted', '#27272a'),
        mutedForeground: readColor('--color-muted-foreground', '#b4b4b6'),
      },
    }).then((mode) => {
      if (mode) {
        handleSelectDevToolsMode(mode)
      }
    }).catch(() => undefined)
  }

  const handleRetry = () => {
    const webview = webviewRef.current
    if (!webview || !isElectron) {
      return
    }

    const retryUrl = loadFailure?.url || currentUrl
    setLoadFailure(null)
    setIsLoading(true)
    if (webview.loadURL) {
      void webview.loadURL(retryUrl).catch(() => {
        setIsLoading(false)
      })
      return
    }
    webview.reload?.()
  }

  return (
    <div className={active ? 'flex min-h-0 flex-1 flex-col bg-background' : 'hidden'}>
      <div
        className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-2"
        onPointerDownCapture={(event) => {
          const input = addressInputRef.current
          if (!input || (event.target instanceof Node && input.form?.contains(event.target))) {
            return
          }
          releaseAddressEditing()
        }}
      >
        <button
          type="button"
          aria-label="Back"
          disabled={!canGoBack}
          onClick={() => webviewRef.current?.goBack?.()}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-35"
        >
          <ArrowLeft size={16} />
        </button>
        <button
          type="button"
          aria-label="Forward"
          disabled={!canGoForward}
          onClick={() => webviewRef.current?.goForward?.()}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-35"
        >
          <ArrowRight size={16} />
        </button>
        <button
          type="button"
          aria-label={isLoading ? 'Stop loading' : 'Reload'}
          disabled={isNewTab}
          onClick={() => {
            if (!isElectron) {
              setIframeUrl((value) => value)
              return
            }
            if (isLoading) webviewRef.current?.stop?.()
            else webviewRef.current?.reload?.()
          }}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-35"
        >
          {isLoading ? <X size={16} /> : <RefreshCw size={16} />}
        </button>
        <button
          type="button"
          aria-label="Home"
          onClick={handleHome}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Home size={16} />
        </button>

        <form onSubmit={handleSubmit} className="relative ml-1 flex min-w-0 flex-1 items-center">
          <Globe2 size={15} className="pointer-events-none absolute left-3 text-muted-foreground" />
          <input
            ref={addressInputRef}
            value={address}
            onChange={(event) => {
              addressEditingRef.current = true
              setAddress(event.target.value)
            }}
            onFocus={(event) => {
              addressFocusedRef.current = true
              event.currentTarget.select()
            }}
            onBlur={() => {
              addressFocusedRef.current = false
              if (isNewTab) {
                return
              }
              if (addressEditingRef.current) {
                return
              }
              if (pendingNavigationRef.current) {
                return
              }
              if (isElectron) {
                const nextUrl = webviewRef.current?.getURL?.()
                if (nextUrl) setAddress(nextUrl)
              }
            }}
            spellCheck={false}
            aria-label="Search or enter address"
            placeholder="Search or enter address"
            className="h-8 w-full rounded-lg border border-border bg-muted/40 pl-9 pr-10 text-sm text-foreground shadow-none outline-none placeholder:text-muted-foreground focus:border-border focus:bg-muted/40 focus:outline-none focus:ring-0 focus:shadow-none focus-visible:border-border focus-visible:outline-none focus-visible:ring-0 focus-visible:shadow-none"
          />
          <button
            type="submit"
            aria-label="Go"
            className="absolute right-1 flex h-6 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Search size={14} />
          </button>
        </form>
        {isElectron && !isNewTab ? (
          <div className="relative flex h-8 shrink-0 items-stretch">
            <Tooltip content={devToolsOpen ? 'Close page DevTools' : 'Open page DevTools (F12 / Ctrl+Shift+I)'} side="bottom" noWrap>
              <button
                type="button"
                aria-label={devToolsOpen ? 'Close page DevTools' : 'Open page DevTools'}
                onClick={handleToggleDevTools}
                className="flex h-8 w-8 items-center justify-center rounded-l-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Code2 size={15} />
              </button>
            </Tooltip>
            <Tooltip content="Choose DevTools position" side="bottom" noWrap>
              <button
                ref={devToolsMenuButtonRef}
                type="button"
                aria-label="Choose DevTools position"
                onClick={handleShowDevToolsMenu}
                className="flex h-8 w-5 items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <EllipsisVertical size={14} />
              </button>
            </Tooltip>
          </div>
        ) : null}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
        {isElectron && !isNewTab && devToolsMode !== 'undocked' ? (
          <div
            ref={devToolsHostRef}
            aria-label="Browser DevTools"
            className={[
              'absolute overflow-hidden bg-background',
              devToolsMode === 'right'
                ? 'inset-y-0 right-0 w-[42%] max-w-[760px] border-l border-border'
                : 'inset-x-0 bottom-0 h-[42%] max-h-[600px] border-t border-border',
            ].join(' ')}
          >
          </div>
        ) : null}

        <div
          className={`absolute left-0 top-0 min-h-0 min-w-0 ${isNewTab ? 'bg-background' : 'bg-white'}`}
          onPointerDownCapture={() => releaseAddressEditing()}
          style={{
            right: isElectron && devToolsOpen && devToolsMode === 'right'
              ? 'min(42%, 760px)'
              : '0px',
            bottom: isElectron && devToolsOpen && devToolsMode === 'bottom'
              ? 'min(42%, 600px)'
              : '0px',
          }}
        >
          {isLoading ? (
            <div className="pointer-events-none absolute bottom-3 left-3 z-10 inline-flex h-7 items-center gap-2 rounded-md border border-black/10 bg-white px-2.5 text-xs text-neutral-600 shadow-sm">
              <LoaderCircle size={13} className="animate-spin" />
              <span>Loading...</span>
            </div>
          ) : null}

          {isNewTab ? (
            <BrowserNewTabPage onNavigate={navigate} visitedSites={visitedSites} />
          ) : isElectron
            ? createElement('webview', {
              ref: handleWebviewRef,
              src: currentUrl,
              useragent: embeddedBrowserUserAgent,
              partition: 'persist:tidecode-browser',
              allowpopups: 'true',
              tabIndex: active ? 0 : -1,
              className: 'h-full w-full',
              style: {
                display: 'flex',
                width: '100%',
                height: '100%',
                pointerEvents: active ? 'auto' : 'none',
              },
            })
          : (
              <iframe
                key={iframeUrl}
                src={iframeUrl}
                title="TideCode browser"
                className="h-full w-full border-0"
                onLoad={() => {
                  setIsLoading(false)
                  onVisit(iframeUrl)
                }}
                sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
                />
              )}
          {isElectron && loadFailure ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-background px-6 text-foreground">
            <div className="w-full max-w-xl">
              <div className="text-lg font-semibold">This page could not be loaded</div>
              <div className="mt-2 break-all text-sm text-muted-foreground">{loadFailure.url}</div>
              <div className="mt-4 rounded-lg border border-border bg-surface-muted p-3 font-mono text-xs text-muted-foreground">
                {loadFailure.message}
                {loadFailure.errorCode !== null ? ` (${loadFailure.errorCode})` : ''}
              </div>
              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRetry}
                  className="inline-flex h-8 items-center justify-center rounded-lg bg-foreground px-3 text-xs font-medium text-background"
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={handleToggleDevTools}
                  className="inline-flex h-8 items-center justify-center rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-surface-muted"
                >
                  Open DevTools
                </button>
              </div>
            </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function BrowserPanel({ active, onClose, projectKey }: BrowserPanelProps) {
  const initialTabRef = useRef<BrowserTab | null>(null)
  if (!initialTabRef.current) {
    initialTabRef.current = createBrowserTab()
  }

  const [tabs, setTabs] = useState<BrowserTab[]>([initialTabRef.current])
  const [activeTabId, setActiveTabId] = useState(initialTabRef.current.id)
  const [devToolsMode, setDevToolsMode] = useState<BrowserDevToolsDockMode>('right')
  const { visitedSites, recordVisit, cacheFavicon } = useBrowserHistory(projectKey)

  const handleTitleChange = useCallback((tabId: string, title: string) => {
    setTabs((currentTabs) => currentTabs.map((tab) => (
      tab.id === tabId && tab.title !== title ? { ...tab, title } : tab
    )))
  }, [])

  const handleFaviconChange = useCallback((tabId: string, faviconUrl: string) => {
    setTabs((currentTabs) => currentTabs.map((tab) => (
      tab.id === tabId && tab.faviconUrl !== faviconUrl ? { ...tab, faviconUrl } : tab
    )))
  }, [])

  const handleCreateTab = useCallback(() => {
    const tab = createBrowserTab()
    setTabs((currentTabs) => [...currentTabs, tab])
    setActiveTabId(tab.id)
  }, [])

  const handleCloseTab = useCallback((tabId: string) => {
    if (tabs.length === 1) {
      onClose()
      return
    }

    const nextActiveTabId = selectBrowserTabAfterClose(tabs, activeTabId, tabId)
    setTabs(tabs.filter((tab) => tab.id !== tabId))
    setActiveTabId(nextActiveTabId)
  }, [activeTabId, onClose, tabs])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <BrowserTabsBar
        activeTabId={activeTabId}
        onCloseTab={handleCloseTab}
        onCreateTab={handleCreateTab}
        onSelectTab={setActiveTabId}
        tabs={tabs}
      />

      <div className="relative flex min-h-0 flex-1 flex-col">
        {tabs.map((tab) => (
          <BrowserTabSession
            key={tab.id}
            active={active && tab.id === activeTabId}
            devToolsMode={devToolsMode}
            onDevToolsModeChange={setDevToolsMode}
            onFaviconChange={handleFaviconChange}
            onCacheFavicon={cacheFavicon}
            onTitleChange={handleTitleChange}
            onVisit={recordVisit}
            visitedSites={visitedSites}
            tabId={tab.id}
          />
        ))}
      </div>
    </div>
  )
}
