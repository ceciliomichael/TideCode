import { createElement, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Globe2, Home, LoaderCircle, RefreshCw, Search, X } from 'lucide-react'

const DEFAULT_BROWSER_URL = 'https://www.google.com/'
const SEARCH_URL = 'https://www.google.com/search?q='

type TidecodeWebview = HTMLElement & {
  canGoBack?: () => boolean
  canGoForward?: () => boolean
  goBack?: () => void
  goForward?: () => void
  loadURL?: (url: string) => Promise<void>
  reload?: () => void
  stop?: () => void
  getURL?: () => string
  executeJavaScript?: (code: string) => Promise<unknown>
}

interface BrowserPanelProps {
  active: boolean
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

export function BrowserPanel({ active }: BrowserPanelProps) {
  const webviewRef = useRef<TidecodeWebview | null>(null)
  const isElectron = useMemo(() => navigator.userAgent.toLowerCase().includes('electron'), [])
  const [address, setAddress] = useState(DEFAULT_BROWSER_URL)
  const [currentUrl, setCurrentUrl] = useState(DEFAULT_BROWSER_URL)
  const [iframeUrl, setIframeUrl] = useState(DEFAULT_BROWSER_URL)
  const [isLoading, setIsLoading] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)

  useEffect(() => {
    if (active || !isElectron) return

    const webview = webviewRef.current
    if (!webview) return

    webview.blur()
    void webview.executeJavaScript?.('document.activeElement instanceof HTMLElement && document.activeElement.blur()').catch(() => undefined)
  }, [active, isElectron])

  const syncNavigationState = useCallback(() => {
    const webview = webviewRef.current
    if (!webview) return
    setCanGoBack(Boolean(webview.canGoBack?.()))
    setCanGoForward(Boolean(webview.canGoForward?.()))
    const nextUrl = webview.getURL?.()
    if (nextUrl) {
      setAddress(nextUrl)
    }
  }, [])

  useEffect(() => {
    if (!isElectron) return
    const webview = webviewRef.current
    if (!webview) return

    const handleStart = () => setIsLoading(true)
    const handleStop = () => {
      setIsLoading(false)
      syncNavigationState()
    }
    const handleNavigate = () => syncNavigationState()

    webview.addEventListener('did-start-loading', handleStart)
    webview.addEventListener('did-stop-loading', handleStop)
    webview.addEventListener('did-navigate', handleNavigate)
    webview.addEventListener('did-navigate-in-page', handleNavigate)

    return () => {
      webview.removeEventListener('did-start-loading', handleStart)
      webview.removeEventListener('did-stop-loading', handleStop)
      webview.removeEventListener('did-navigate', handleNavigate)
      webview.removeEventListener('did-navigate-in-page', handleNavigate)
    }
  }, [isElectron, syncNavigationState])

  const navigate = useCallback(
    (rawValue: string) => {
      const nextUrl = normalizeBrowserInput(rawValue)
      setAddress(nextUrl)
      setCurrentUrl(nextUrl)

      if (isElectron) {
        return
      } else {
        setIframeUrl(nextUrl)
      }
    },
    [isElectron],
  )

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    navigate(address)
  }

  const handleHome = () => navigate(DEFAULT_BROWSER_URL)

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-2">
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
          onClick={() => {
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
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
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
          : (
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
