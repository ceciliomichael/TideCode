import { useCallback, useEffect, useRef, useState } from 'react'
import { Bug, MessageSquarePlus, Trash2, X } from 'lucide-react'
import { Tooltip } from '../Tooltip'
import { showAppError } from '../ui/appNotifications'
import { AppNoticeSurface } from '../ui/AppNoticeSurface'
import { toUserFacingErrorMessage } from '../../lib/userFacingError'
import type { BrowserElementAnnotation } from '../../types/browser'

interface BrowserSelectableWebview {
  executeJavaScript?: (code: string) => Promise<unknown>
  getWebContentsId?: () => number
  getURL?: () => string
}

interface Selection {
  selector: string
  elementName: string
}

function pickBrowserElement(): Promise<Selection | null> {
  return new Promise((resolve) => {
    let hovered: HTMLElement | null = null
    let oldOutline = ''
    let timer = 0
    const restore = () => {
      if (hovered) hovered.style.outline = oldOutline
      hovered = null
    }
    const done = (selection: Selection | null) => {
      restore()
      document.removeEventListener('pointerover', onHover, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKey, true)
      clearTimeout(timer)
      resolve(selection)
    }
    const onHover = (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLElement) || target === hovered) return
      restore()
      hovered = target
      oldOutline = target.style.outline
      target.style.outline = '2px solid #22a06b'
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        done(null)
      }
    }
    const onClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const pieces: string[] = []
      let current: Element | null = target
      while (current && current !== document.documentElement && pieces.length < 9) {
        if (current.id) {
          pieces.unshift('#' + CSS.escape(current.id))
          break
        }
        const tag = current.tagName.toLowerCase()
        const parent: Element | null = current.parentElement
        const siblings = parent ? Array.from(parent.children).filter((child) => child.tagName === current?.tagName) : []
        const index = siblings.indexOf(current)
        pieces.unshift(tag + (siblings.length > 1 ? ':nth-of-type(' + (index + 1) + ')' : ''))
        current = parent
      }
      const selector = pieces.join(' > ')
      const name = target.getAttribute('aria-label') || target.innerText || target.tagName.toLowerCase()
      done({ selector, elementName: name.trim().slice(0, 160) })
    }
    document.addEventListener('pointerover', onHover, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKey, true)
    timer = window.setTimeout(() => done(null), 30_000)
  })
}

interface BrowserAnnotationsProps {
  active: boolean
  conversationId: string | null
  disabled: boolean
  projectPath: string
  tabId: string
  getWebview: () => BrowserSelectableWebview | null
}

export function BrowserAnnotations({
  active, conversationId, disabled, projectPath, tabId, getWebview,
}: BrowserAnnotationsProps) {
  const [developerEnabled, setDeveloperEnabled] = useState(false)
  const [annotations, setAnnotations] = useState<BrowserElementAnnotation[]>([])
  const [selected, setSelected] = useState<Selection | null>(null)
  const [comment, setComment] = useState('')
  const [isPicking, setIsPicking] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const notifiedErrorRef = useRef<string | null>(null)

  useEffect(() => {
    if (!error) {
      notifiedErrorRef.current = null
      return
    }
    if (error && !open) {
      if (notifiedErrorRef.current === error) {
        return
      }
      notifiedErrorRef.current = error
      showAppError(error, 'The annotation action could not be completed. Try again.', { title: 'Annotation action failed' })
      setError('')
    }
  }, [error, open])

  const refresh = useCallback(() => {
    if (!conversationId || !projectPath || projectPath === '__no-workspace__') {
      setAnnotations([])
      return
    }
    if (!window.tidecodeBrowserPageActions?.listAnnotations) return
    void window.tidecodeBrowserPageActions.listAnnotations({ conversationId, projectPath })
      .then((items) => setAnnotations(items.filter((item) => item.tabId === tabId)))
      .catch((failure) => setError(toUserFacingErrorMessage(failure, 'Annotations could not be loaded. Try again.')))
  }, [conversationId, projectPath, tabId])

  useEffect(() => {
    if (!active) return
    refresh()
    if (!window.tidecodeBrowserPageActions?.getDeveloperMode) return
    void window.tidecodeBrowserPageActions.getDeveloperMode(projectPath)
      .then(setDeveloperEnabled)
      .catch(() => setDeveloperEnabled(false))
  }, [active, projectPath, refresh])

  async function pick() {
    const webview = getWebview()
    if (!webview?.executeJavaScript || !conversationId) return
    setError('')
    setIsPicking(true)
    try {
      const result = await webview.executeJavaScript('(' + pickBrowserElement.toString() + ')()')
      if (result && typeof result === 'object' && typeof (result as Selection).selector === 'string') {
        setSelected(result as Selection)
        setOpen(true)
      }
    } catch (failure) {
      setError(toUserFacingErrorMessage(failure, 'The annotation could not be saved. Try again.'))
    } finally {
      setIsPicking(false)
    }
  }

  async function save() {
    const webview = getWebview()
    const webContentsId = webview?.getWebContentsId?.()
    const url = webview?.getURL?.()
    if (!selected || !conversationId || !url || !webContentsId) return
    setError('')
    try {
      await window.tidecodeBrowserPageActions.saveAnnotation({
        ...selected, comment, projectPath, conversationId, tabId, url, webContentsId,
      })
      setSelected(null)
      setComment('')
      refresh()
    } catch (failure) {
      setError(toUserFacingErrorMessage(failure, 'The annotation could not be saved. Try again.'))
    }
  }

  if (!active) return null

  return (
    <div className="relative flex shrink-0 items-center gap-1">
      <Tooltip content={isPicking ? 'Click an element in the page or press Escape' : 'Annotate webpage element'} side="bottom" noWrap>
        <button
          type="button"
          disabled={disabled || !conversationId || isPicking}
          onClick={() => void pick()}
          aria-label="Annotate webpage element"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <MessageSquarePlus size={16} />
        </button>
      </Tooltip>
      <Tooltip content={developerEnabled ? 'Disable Full Developer Mode' : 'Enable Full Developer Mode for this project'} side="bottom" noWrap>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={developerEnabled}
          aria-label="Full Developer Mode"
          onClick={() => {
            void window.tidecodeBrowserPageActions.setDeveloperMode({ projectPath, enabled: !developerEnabled })
              .then(setDeveloperEnabled)
              .catch((failure) => setError(toUserFacingErrorMessage(failure, 'Annotations could not be loaded. Try again.')))
          }}
          className={[
            'flex h-8 w-8 items-center justify-center rounded-lg hover:bg-muted',
            developerEnabled ? 'text-amber-600' : 'text-muted-foreground hover:text-foreground',
          ].join(' ')}
        >
          <Bug size={16} />
        </button>
      </Tooltip>
      {annotations.length > 0 ? (
        <button
          type="button"
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          aria-label="View browser annotations"
          className="h-7 rounded-lg px-1.5 text-xs text-muted-foreground hover:bg-muted"
        >
          {annotations.length}
        </button>
      ) : null}
      {(open || selected) ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[90vw] rounded-xl border border-border bg-background p-3 shadow-xl">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Browser annotations</span>
            <button type="button" aria-label="Close annotations" onClick={() => { setOpen(false); setSelected(null) }}><X size={15} /></button>
          </div>
          {selected ? (
            <div className="mt-2 flex flex-col gap-2">
              <div className="truncate text-xs text-muted-foreground">{selected.elementName} ({selected.selector})</div>
              <textarea
                autoFocus
                aria-label="Element annotation"
                rows={3}
                maxLength={2000}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                className="w-full resize-y rounded-md border border-border bg-background p-2 text-sm text-foreground"
                placeholder="Describe what should change about this element"
              />
              <button type="button" disabled={!comment.trim()} onClick={() => void save()} className="self-end rounded-md bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-40">Save annotation</button>
            </div>
          ) : null}
          <div className="mt-2 max-h-52 space-y-2 overflow-y-auto">
            {annotations.map((annotation) => (
              <div key={annotation.id} className="flex items-start gap-2 border-t border-border pt-2 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-muted-foreground">{annotation.elementName}</div>
                  <div className="break-words text-foreground">{annotation.comment}</div>
                </div>
                <button type="button" aria-label="Remove annotation" onClick={() => {
                  void window.tidecodeBrowserPageActions.removeAnnotation({
                    id: annotation.id, conversationId: annotation.conversationId, projectPath,
                  }).then(refresh).catch((failure) => setError(toUserFacingErrorMessage(failure, 'The annotation could not be removed. Try again.')))
                }}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
          {error ? <AppNoticeSurface className="mt-2" title="Annotation action failed" message={error} fallbackMessage="The annotation action could not be completed. Try again." onDismiss={() => setError('')} /> : null}
        </div>
      ) : null}
    </div>
  )
}
