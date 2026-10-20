import { BrowserScreenshotButton } from './BrowserScreenshotButton'
import { BrowserAnnotations } from './BrowserAnnotations'
import { createElement, FormEvent, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { ArrowLeft, ArrowRight, Globe2, Home, LoaderCircle, RefreshCw, Search, VenetianMask, X } from 'lucide-react'
import { useBrowserPageActions, type BrowserPageControls, type BrowserPageState } from './useBrowserPageActions'
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
  goBack?: () => void
  goForward?: () => void
  getWebContentsId?: () => number
  loadURL?: (url: string) => Promise<void>
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
  agentTab?: { tabId: string; projectPath: string; url: string } | null
  conversationId: string | null
  active: boolean
  isFullScreen: boolean
  onToggleFullScreen: () => void
  onClose: () => void
  projectKey: string
}

interface BrowserTabSessionProps {
  aiOwned?: boolean
  initialUrl?: string
  conversationId: string | null
  incognito: boolean
  partition: string
  projectPath: string
  active: boolean
  controlsRef: RefObject<BrowserPageControls | null> | null
  onPageStateChange: (state: BrowserPageState) => void
  onFaviconChange: (tabId: string, faviconUrl: string) => void
  onCacheFavicon: (url: string, faviconDataUrl: string) => void
  onTitleChange: (tabId: string, title: string) => void
  onVisit: (url: string, faviconDataUrl?: string) => void
  visitedSites: readonly BrowserVisitedSite[]
  tabId: string
}

function BrowserTabSession({
  initialUrl,
  conversationId,
  incognito,
  partition,
  projectPath,
  active,
  controlsRef,
  onPageStateChange,
  onFaviconChange,
  onCacheFavicon,
  onTitleChange,
  onVisit,
  visitedSites,
  tabId,
}: BrowserTabSessionProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const webviewRef = useRef<TidecodeWebview | null>(null)
  const webviewReadyRef = useRef(false)
  const addressInputRef = useRef<HTMLInputElement | null>(null)
  const addressFocusedRef = useRef(false)
  const addressEditingRef = useRef(false)
  const pendingNavigationRef = useRef<{ started: boolean; url: string } | null>(null)
  const isElectron = useMemo(() => navigator.userAgent.toLowerCase().includes('electron'), [])
  const embeddedBrowserUserAgent = useMemo(
    () => normalizeEmbeddedBrowserUserAgent(navigator.userAgent),
    [],
  )
  const [address, setAddress] = useState(initialUrl ?? '')
  const [currentUrl, setCurrentUrl] = useState(initialUrl ?? '')
  const [iframeUrl, setIframeUrl] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [loadFailure, setLoadFailure] = useState<BrowserLoadFailure | null>(null)
  const isNewTab = !currentUrl
  const { openDevTools, captureScreenshot, canCapturePage } = useBrowserPageActions({ projectPath, active, isElectron, isNewTab, webviewRef, controlsRef, onStateChange: onPageStateChange })

  const releaseAddressEditing = useCallback(() => {
    addressEditingRef.current = false
  }, [])

  const updateTitle = useCallback((title: string, url: string) => {
    const nextTitle = incognito && !url ? 'New Incognito Tab' : resolveBrowserTabTitle(title, url)
    onTitleChange(tabId, nextTitle)
  }, [incognito, onTitleChange, tabId])

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
      const webContentsId = webview.getWebContentsId?.()
      if (!incognito && webContentsId && window.tidecodeBrowserPageActions?.registerAgentTab) {
        void window.tidecodeBrowserPageActions.registerAgentTab({
          tabId,
          projectPath,
          webContentsId,
        }).catch(console.error)
      }
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
      if (visitedUrl && !incognito) {
        onVisit(visitedUrl)
      }
    }
    const handleTitle = (event: Event) => {
      const title = (event as Event & { title?: string }).title ?? webview.getTitle?.() ?? ''
      updateTitle(title, webview.getURL?.() || currentUrl)
    }
    const handleFavicon = (event: Event) => {
      if (incognito) {
        return
      }
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
  }, [active, currentUrl, incognito, isElectron, onCacheFavicon, onFaviconChange, onVisit, projectPath, syncNavigationState, tabId, updateTitle])

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
    onFaviconChange(tabId, '')
    updateTitle('', '')
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
    <div
      ref={panelRef}
      className={active
        ? 'relative z-10 flex min-h-0 min-w-0 flex-1 flex-col bg-background'
        : 'pointer-events-none absolute inset-0 flex min-h-0 min-w-0 flex-col bg-background opacity-0'}
      aria-hidden={!active}
    >
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
          {incognito ? <VenetianMask size={15} aria-label="Incognito" className="pointer-events-none absolute left-3 text-muted-foreground" /> : <Globe2 size={15} className="pointer-events-none absolute left-3 text-muted-foreground" />}
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
        <BrowserAnnotations
          active={active && isElectron}
          conversationId={conversationId}
          disabled={incognito || isNewTab || projectPath === '__no-workspace__'}
          projectPath={projectPath}
          tabId={tabId}
          getWebview={() => webviewRef.current}
        />
        <BrowserScreenshotButton
          toastContainerRef={panelRef}
          active={active}
          disabled={incognito || !isElectron || isNewTab || !canCapturePage || projectPath === '__no-workspace__'}
          onCapture={captureScreenshot}
        />

      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-background">

        <div
          className={`absolute left-0 top-0 min-h-0 min-w-0 ${isNewTab ? 'bg-background' : 'bg-white'}`}
          onPointerDownCapture={() => releaseAddressEditing()}
          style={{ right: 0, bottom: 0 }}
        >
          {isLoading ? (
            <div className="pointer-events-none absolute bottom-3 left-3 z-10 inline-flex h-7 items-center gap-2 rounded-md border border-border bg-surface-raised px-2.5 text-xs text-muted-foreground shadow-soft">
              <LoaderCircle size={13} className="animate-spin" />
              <span>Loading...</span>
            </div>
          ) : null}

          {isNewTab ? (
            <BrowserNewTabPage onNavigate={navigate} visitedSites={incognito ? [] : visitedSites} />
          ) : isElectron
            ? <div style={{ position: 'absolute', inset: 0 }}>
              {createElement('webview', {
              ref: handleWebviewRef,
              src: currentUrl,
              useragent: embeddedBrowserUserAgent,
              partition,
              allowpopups: 'true',
              tabIndex: active ? 0 : -1,
              className: 'h-full w-full',
              style: {
                display: 'flex',
                width: '100%',
                height: '100%',
                pointerEvents: active ? 'auto' : 'none',
              },
            })}
            </div>
          : (
              <iframe
                key={iframeUrl}
                src={iframeUrl}
                title="TideCode browser"
                className="h-full w-full border-0"
                onLoad={() => {
                  setIsLoading(false)
                  if (!incognito) {
                    onVisit(iframeUrl)
                  }
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
                  onClick={() => void openDevTools().catch(console.error)}
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

export function BrowserPanel({ active, isFullScreen, onToggleFullScreen, onClose, projectKey, conversationId, agentTab }: BrowserPanelProps) {
  const initialTabRef = useRef<BrowserTab | null>(null)
  if (!initialTabRef.current) {
    initialTabRef.current = createBrowserTab()
  }

  const [tabs, setTabs] = useState<BrowserTab[]>([initialTabRef.current])
  const [activeTabId, setActiveTabId] = useState(initialTabRef.current.id)
  useEffect(() => {
    if (!agentTab || agentTab.projectPath.toLowerCase() !== projectKey.toLowerCase()) return
    setTabs((current) => {
      if (current.some((tab) => tab.id === agentTab.tabId)) return current
      return [...current, {
        ...createBrowserTab(),
        id: agentTab.tabId,
        title: new URL(agentTab.url).hostname,
        initialUrl: agentTab.url,
        aiOwned: true,
      }]
    })
    setActiveTabId(agentTab.tabId)
  }, [agentTab, projectKey])
  const pageControlsRef = useRef<BrowserPageControls | null>(null)
  const privateTabIdsRef = useRef(new Set<string>())
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    const privateTabIds = privateTabIdsRef.current
    return () => {
      mountedRef.current = false
      for (const tabId of privateTabIds) {
        void window.tidecodeBrowserPageActions.releaseIncognitoTab({ tabId }).catch(console.error)
      }
      privateTabIds.clear()
    }
  }, [])
  const [pageState, setPageState] = useState<BrowserPageState>({ isWebsite: false, canUsePage: false, zoomPercent: 100 })
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

  const handleCreateTab = useCallback(async (incognito: boolean) => {
    let tab: BrowserTab
    if (incognito) {
      const privateTab = await window.tidecodeBrowserPageActions.createIncognitoTab({ projectKey })
      if (!mountedRef.current) {
        await window.tidecodeBrowserPageActions.releaseIncognitoTab({ tabId: privateTab.tabId })
        return
      }
      privateTabIdsRef.current.add(privateTab.tabId)
      tab = createBrowserTab(privateTab)
    } else {
      tab = createBrowserTab()
    }
    setTabs((currentTabs) => [...currentTabs, tab])
    setActiveTabId(tab.id)
  }, [projectKey])

  const handleCloseTab = useCallback((tabId: string) => {
    if (privateTabIdsRef.current.delete(tabId)) {
      void window.tidecodeBrowserPageActions.releaseIncognitoTab({ tabId }).catch(console.error)
    }
    if (tabs.length === 1) {
      if (tabs[0]?.aiOwned) {
        const replacement = createBrowserTab()
        setTabs([replacement])
        setActiveTabId(replacement.id)
      }
      onClose()
      return
    }

    const nextActiveTabId = selectBrowserTabAfterClose(tabs, activeTabId, tabId)
    setTabs(tabs.filter((tab) => tab.id !== tabId))
    setActiveTabId(nextActiveTabId)
  }, [activeTabId, onClose, tabs])

  useEffect(() => {
    if (!window.tidecodeBrowserPageActions?.onAgentTabTermination) return
    return window.tidecodeBrowserPageActions.onAgentTabTermination(({ tabId, projectPath }) => {
      if (projectPath !== projectKey) return
      if (!tabs.some((tab) => tab.id === tabId)) return
      if (tabs.length === 1) {
        const replacement = createBrowserTab()
        setTabs([replacement])
        setActiveTabId(replacement.id)
        onClose()
      } else {
        handleCloseTab(tabId)
      }
    })
  }, [handleCloseTab, onClose, projectKey, tabs])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <BrowserTabsBar
        activeTabId={activeTabId}
        onCloseTab={handleCloseTab}
        onCreateTab={handleCreateTab}
        isFullScreen={isFullScreen}
        onToggleFullScreen={onToggleFullScreen}
        pageState={pageState}

        onOpenDevTools={async () => {
          if (!pageControlsRef.current) {
            throw new Error('Open a webpage first.')
          }
          await pageControlsRef.current.openDevTools()
        }}
        onChangeZoom={async (direction) => {
          await pageControlsRef.current?.changeZoom(direction)
        }}
        onSelectTab={setActiveTabId}
        tabs={tabs}
      />

      <div className="relative flex min-h-0 flex-1 flex-col">
        {tabs.map((tab) => (
          <BrowserTabSession
            aiOwned={tab.aiOwned}
            initialUrl={tab.initialUrl}
            conversationId={conversationId}
            projectPath={projectKey}
            incognito={tab.incognito}
            partition={tab.partition}
            key={tab.id}
            active={active && tab.id === activeTabId}
            controlsRef={active && tab.id === activeTabId ? pageControlsRef : null}
            onPageStateChange={setPageState}
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
