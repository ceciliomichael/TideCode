import { createElement, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Globe2, Home, LoaderCircle, RefreshCw, Search, X } from 'lucide-react'
import type { RemoteBrowserFrameEvent, RemoteBrowserState } from '../../types/browser'
import { BrowserTabsBar } from './BrowserTabsBar'
import {
  createBrowserTab,
  DEFAULT_BROWSER_URL,
  resolveBrowserTabTitle,
  selectBrowserTabAfterClose,
  type BrowserTab,
} from './browserTabUtils'

const SEARCH_URL = 'https://www.google.com/search?q='

type TidecodeWebview = HTMLElement & {
  canGoBack?: () => boolean
  canGoForward?: () => boolean
  goBack?: () => void
  goForward?: () => void
  loadURL?: (url: string) => Promise<void>
  reload?: () => void
  stop?: () => void
  getTitle?: () => string
  getURL?: () => string
  executeJavaScript?: (code: string) => Promise<unknown>
}

interface BrowserPanelProps {
  active: boolean
  projectKey: string
}

interface BrowserTabSessionProps {
  active: boolean
  onTitleChange: (tabId: string, title: string) => void
  projectKey: string
  tabId: string
}

function normalizeBrowserInput(value: string) {
  const input = value.trim()
  if (!input) return DEFAULT_BROWSER_URL

  if (/^https?:\/\//i.test(input)) return input

  const looksLikeHost =
    !input.includes(' ') &&
    (input.includes('.') || input.startsWith('localhost') || /^\d{1,3}(\.\d{1,3}){3}(?::\d+)?(?:\/.*)?$/.test(input))

  if (looksLikeHost) {
    return `https://${input}`
  }

  return `${SEARCH_URL}${encodeURIComponent(input)}`
}

function BrowserTabSession({ active, onTitleChange, projectKey, tabId }: BrowserTabSessionProps) {
  const webviewRef = useRef<TidecodeWebview | null>(null)
  const webviewReadyRef = useRef(false)
  const remoteSurfaceRef = useRef<HTMLDivElement | null>(null)
  const remotePointerDownRef = useRef(false)
  const addressInputRef = useRef<HTMLInputElement | null>(null)
  const addressFocusedRef = useRef(false)
  const isElectron = useMemo(() => navigator.userAgent.toLowerCase().includes('electron'), [])
  const isRemote = !isElectron && typeof window !== 'undefined' && 'tidecodeBrowser' in window
  const [address, setAddress] = useState(DEFAULT_BROWSER_URL)
  const [currentUrl, setCurrentUrl] = useState(DEFAULT_BROWSER_URL)
  const [iframeUrl, setIframeUrl] = useState(DEFAULT_BROWSER_URL)
  const [isLoading, setIsLoading] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [remoteScreenshot, setRemoteScreenshot] = useState('')
  const [remoteCursor, setRemoteCursor] = useState('default')

  const updateTitle = useCallback((title: string, url: string) => {
    onTitleChange(tabId, resolveBrowserTabTitle(title, url))
  }, [onTitleChange, tabId])

  const applyRemoteState = useCallback((state: RemoteBrowserState) => {
    if (!addressFocusedRef.current) setAddress(state.url)
    setCanGoBack(state.canGoBack)
    setCanGoForward(state.canGoForward)
    setIsLoading(state.isLoading)
    setRemoteScreenshot(state.screenshotDataUrl)
    updateTitle(state.title, state.url)
  }, [updateTitle])

  const applyRemoteFrame = useCallback((frame: RemoteBrowserFrameEvent) => {
    if (!addressFocusedRef.current) setAddress(frame.url)
    setCanGoBack(frame.canGoBack)
    setCanGoForward(frame.canGoForward)
    setIsLoading(frame.isLoading)
    setRemoteScreenshot(frame.screenshotDataUrl)
    updateTitle(frame.title, frame.url)
  }, [updateTitle])

  const runRemote = useCallback(async (operation: () => Promise<RemoteBrowserState>) => {
    setIsLoading(true)
    try {
      applyRemoteState(await operation())
    } finally {
      setIsLoading(false)
    }
  }, [applyRemoteState])

  useEffect(() => {
    if (!active || !isRemote) return

    let cancelled = false
    const surface = remoteSurfaceRef.current
    const width = surface?.clientWidth || 1280
    const height = surface?.clientHeight || 800
    const deviceScaleFactor = window.devicePixelRatio || 1
    const unsubscribe = window.tidecodeBrowser.onFrame((frame) => {
      if (!cancelled && frame.projectKey === projectKey && frame.tabId === tabId) {
        applyRemoteFrame(frame)
      }
    })

    void window.tidecodeBrowser.startScreencast(projectKey, tabId, width, height, deviceScaleFactor)
      .then((state) => {
        if (!cancelled) applyRemoteState(state)
      })
      .catch(() => window.tidecodeBrowser.capture(projectKey, tabId).then((state) => {
        if (!cancelled) applyRemoteState(state)
      }))

    return () => {
      cancelled = true
      unsubscribe()
      void window.tidecodeBrowser.stopScreencast(projectKey, tabId)
    }
  }, [active, applyRemoteFrame, applyRemoteState, isRemote, projectKey, tabId])

  useEffect(() => {
    if (!active || !isRemote) return

    const surface = remoteSurfaceRef.current
    if (!surface) return

    let lastWidth = 0
    let lastHeight = 0
    const resize = () => {
      const width = Math.max(1, Math.round(surface.clientWidth))
      const height = Math.max(1, Math.round(surface.clientHeight))
      if (width === lastWidth && height === lastHeight) return

      lastWidth = width
      lastHeight = height
      void window.tidecodeBrowser.resize(projectKey, tabId, width, height, window.devicePixelRatio || 1)
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(surface)
    return () => observer.disconnect()
  }, [active, isRemote, projectKey, tabId])

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

  const syncNavigationState = useCallback(() => {
    const webview = webviewRef.current
    if (!webview) return

    setCanGoBack(Boolean(webview.canGoBack?.()))
    setCanGoForward(Boolean(webview.canGoForward?.()))
    const nextUrl = webview.getURL?.()
    if (nextUrl && !addressFocusedRef.current) {
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
    const handleStart = () => setIsLoading(true)
    const handleStop = () => {
      setIsLoading(false)
      syncNavigationState()
    }
    const handleNavigate = () => syncNavigationState()
    const handleTitle = (event: Event) => {
      const title = (event as Event & { title?: string }).title ?? webview.getTitle?.() ?? ''
      updateTitle(title, webview.getURL?.() || currentUrl)
    }

    webview.addEventListener('dom-ready', handleDomReady)
    webview.addEventListener('did-start-loading', handleStart)
    webview.addEventListener('did-stop-loading', handleStop)
    webview.addEventListener('did-navigate', handleNavigate)
    webview.addEventListener('did-navigate-in-page', handleNavigate)
    webview.addEventListener('page-title-updated', handleTitle)

    return () => {
      webview.removeEventListener('dom-ready', handleDomReady)
      webview.removeEventListener('did-start-loading', handleStart)
      webview.removeEventListener('did-stop-loading', handleStop)
      webview.removeEventListener('did-navigate', handleNavigate)
      webview.removeEventListener('did-navigate-in-page', handleNavigate)
      webview.removeEventListener('page-title-updated', handleTitle)
    }
  }, [active, currentUrl, isElectron, syncNavigationState, updateTitle])

  const navigate = useCallback(
    (rawValue: string) => {
      const nextUrl = normalizeBrowserInput(rawValue)
      setAddress(nextUrl)
      setCurrentUrl(nextUrl)
      updateTitle('', nextUrl)

      if (isElectron) {
        return
      }

      if (isRemote) {
        void runRemote(() => window.tidecodeBrowser.navigate(projectKey, tabId, nextUrl))
        return
      }

      setIframeUrl(nextUrl)
    },
    [isElectron, isRemote, projectKey, runRemote, tabId, updateTitle],
  )

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    navigate(address)
  }

  const handleHome = () => navigate(DEFAULT_BROWSER_URL)

  return (
    <div className={active ? 'flex min-h-0 flex-1 flex-col bg-background' : 'hidden'}>
      <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-2">
        <button
          type="button"
          aria-label="Back"
          disabled={!canGoBack}
          onClick={() => isRemote
            ? void runRemote(() => window.tidecodeBrowser.back(projectKey, tabId))
            : webviewRef.current?.goBack?.()}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-35"
        >
          <ArrowLeft size={16} />
        </button>
        <button
          type="button"
          aria-label="Forward"
          disabled={!canGoForward}
          onClick={() => isRemote
            ? void runRemote(() => window.tidecodeBrowser.forward(projectKey, tabId))
            : webviewRef.current?.goForward?.()}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-35"
        >
          <ArrowRight size={16} />
        </button>
        <button
          type="button"
          aria-label={isLoading ? 'Stop loading' : 'Reload'}
          onClick={() => {
            if (isRemote) {
              void runRemote(() => window.tidecodeBrowser.reload(projectKey, tabId))
              return
            }
            if (!isElectron) {
              setIframeUrl((value) => value)
              return
            }
            if (isLoading) webviewRef.current?.stop?.()
            else webviewRef.current?.reload?.()
          }}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => {
              addressFocusedRef.current = true
              event.currentTarget.select()
            }}
            onBlur={() => {
              addressFocusedRef.current = false
              if (isRemote) {
                void window.tidecodeBrowser.capture(projectKey, tabId)
                  .then((state) => {
                    setAddress(state.url)
                    updateTitle(state.title, state.url)
                  })
                  .catch(() => undefined)
                return
              }
              if (isElectron) {
                const nextUrl = webviewRef.current?.getURL?.()
                if (nextUrl) setAddress(nextUrl)
              }
            }}
            spellCheck={false}
            aria-label="Search or enter address"
            placeholder="Search Google or enter an address"
            className="h-8 w-full rounded-lg border border-border bg-muted/40 pl-9 pr-10 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-muted-foreground/50 focus:bg-background focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
          />
          <button
            type="submit"
            aria-label="Go"
            className="absolute right-1 flex h-6 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Search size={14} />
          </button>
        </form>
      </div>

      <div className="relative min-h-0 flex-1 bg-white">
        {isLoading ? (
          <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-md bg-background/90 p-1.5 text-muted-foreground shadow-sm">
            <LoaderCircle size={15} className="animate-spin" />
          </div>
        ) : null}

        {isElectron
          ? createElement('webview', {
              ref: (node: TidecodeWebview | null): void => {
                if (webviewRef.current !== node) {
                  webviewReadyRef.current = false
                }
                webviewRef.current = node
              },
              src: currentUrl,
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
          : isRemote ? (
              <div
                ref={remoteSurfaceRef}
                tabIndex={active ? 0 : -1}
                className="flex h-full w-full items-center justify-center overflow-hidden bg-white outline-none"
                style={{ cursor: remoteCursor }}
                onKeyDown={(event) => {
                  event.preventDefault()
                  const key = event.key
                  const hasModifier = event.ctrlKey || event.metaKey || event.altKey
                  const primaryModifier = event.ctrlKey || event.metaKey
                  const normalizedKey = key.toLowerCase()

                  if (primaryModifier && normalizedKey === 'l') {
                    addressInputRef.current?.focus()
                    addressInputRef.current?.select()
                    return
                  }
                  if ((primaryModifier && normalizedKey === 'r') || key === 'F5') {
                    void runRemote(() => window.tidecodeBrowser.reload(projectKey, tabId))
                    return
                  }
                  if (event.altKey && key === 'ArrowLeft') {
                    void runRemote(() => window.tidecodeBrowser.back(projectKey, tabId))
                    return
                  }
                  if (event.altKey && key === 'ArrowRight') {
                    void runRemote(() => window.tidecodeBrowser.forward(projectKey, tabId))
                    return
                  }
                  if (primaryModifier && normalizedKey === 'c') {
                    void window.tidecodeBrowser.getSelectionText(projectKey, tabId)
                      .then((text) => text ? navigator.clipboard?.writeText(text) : undefined)
                      .catch(() => undefined)
                  }
                  if (primaryModifier && normalizedKey === 'x') {
                    void window.tidecodeBrowser.getSelectionText(projectKey, tabId)
                      .then((text) => text ? navigator.clipboard?.writeText(text) : undefined)
                      .catch(() => undefined)
                  }
                  if (primaryModifier && normalizedKey === 'v' && navigator.clipboard?.readText) {
                    void navigator.clipboard.readText()
                      .then((text) => text ? window.tidecodeBrowser.typeText(projectKey, tabId, text) : undefined)
                      .catch(() => undefined)
                    return
                  }
                  if (key.length === 1 && !hasModifier) {
                    void window.tidecodeBrowser.typeText(projectKey, tabId, key)
                  } else {
                    void window.tidecodeBrowser.key(projectKey, tabId, {
                      altKey: event.altKey,
                      code: event.code,
                      ctrlKey: event.ctrlKey,
                      key,
                      metaKey: event.metaKey,
                      shiftKey: event.shiftKey,
                    })
                  }
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  event.currentTarget.setPointerCapture(event.pointerId)
                  remotePointerDownRef.current = true
                  const rect = event.currentTarget.getBoundingClientRect()
                  void window.tidecodeBrowser.pointerDown(
                    projectKey,
                    tabId,
                    event.clientX - rect.left,
                    event.clientY - rect.top,
                  )
                  event.currentTarget.focus()
                }}
                onPointerUp={(event) => {
                  if (event.button !== 0) return
                  remotePointerDownRef.current = false
                  const rect = event.currentTarget.getBoundingClientRect()
                  void window.tidecodeBrowser.pointerUp(
                    projectKey,
                    tabId,
                    event.clientX - rect.left,
                    event.clientY - rect.top,
                  )
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId)
                  }
                }}
                onPointerCancel={() => {
                  remotePointerDownRef.current = false
                }}
                onPointerMove={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect()
                  void window.tidecodeBrowser.movePointer(
                    projectKey,
                    tabId,
                    event.clientX - rect.left,
                    event.clientY - rect.top,
                    remotePointerDownRef.current ? 1 : 0,
                  ).then(setRemoteCursor).catch(() => undefined)
                }}
                onWheel={(event) => {
                  event.preventDefault()
                  const rect = event.currentTarget.getBoundingClientRect()
                  void window.tidecodeBrowser.wheel(
                    projectKey,
                    tabId,
                    event.clientX - rect.left,
                    event.clientY - rect.top,
                    event.deltaX,
                    event.deltaY,
                  )
                }}
              >
                {remoteScreenshot ? (
                  <img
                    src={remoteScreenshot}
                    alt="Remote browser"
                    draggable={false}
                    className="h-full w-full object-fill select-none"
                  />
                ) : (
                  <LoaderCircle size={20} className="animate-spin text-muted-foreground" />
                )}
              </div>
            ) : (
              <iframe
                key={iframeUrl}
                src={iframeUrl}
                title="TideCode browser"
                className="h-full w-full border-0"
                onLoad={() => setIsLoading(false)}
                sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
              />
            )}
      </div>
    </div>
  )
}

export function BrowserPanel({ active, projectKey }: BrowserPanelProps) {
  const initialTabRef = useRef<BrowserTab | null>(null)
  if (!initialTabRef.current) {
    initialTabRef.current = createBrowserTab()
  }

  const [tabs, setTabs] = useState<BrowserTab[]>([initialTabRef.current])
  const [activeTabId, setActiveTabId] = useState(initialTabRef.current.id)
  const isElectron = useMemo(() => navigator.userAgent.toLowerCase().includes('electron'), [])
  const isRemote = !isElectron && typeof window !== 'undefined' && 'tidecodeBrowser' in window

  const handleTitleChange = useCallback((tabId: string, title: string) => {
    setTabs((currentTabs) => currentTabs.map((tab) => (
      tab.id === tabId && tab.title !== title ? { ...tab, title } : tab
    )))
  }, [])

  const handleCreateTab = useCallback(() => {
    const tab = createBrowserTab()
    setTabs((currentTabs) => [...currentTabs, tab])
    setActiveTabId(tab.id)
  }, [])

  const handleCloseTab = useCallback((tabId: string) => {
    if (tabs.length === 1) {
      const replacementTab = createBrowserTab()
      setTabs([replacementTab])
      setActiveTabId(replacementTab.id)

      if (isRemote) {
        void window.tidecodeBrowser.close(projectKey, tabId)
      }
      return
    }

    const nextActiveTabId = selectBrowserTabAfterClose(tabs, activeTabId, tabId)
    setTabs(tabs.filter((tab) => tab.id !== tabId))
    setActiveTabId(nextActiveTabId)

    if (isRemote) {
      void window.tidecodeBrowser.close(projectKey, tabId)
    }
  }, [activeTabId, isRemote, projectKey, tabs])

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
            onTitleChange={handleTitleChange}
            projectKey={projectKey}
            tabId={tab.id}
          />
        ))}
      </div>
    </div>
  )
}
