import { memo, useEffect, useMemo, useRef } from 'react'
import { buildTideHtmlDocument } from '../../lib/tideui/htmlSandbox'
import { TIDE_HTML_MESSAGE } from '../../lib/tideui/htmlPreviewBridge'
import { executeHtmlAction } from '../../lib/tideui/htmlActions'
import type { TideUIActions } from '../../lib/tideui/types'
import { copyTextToClipboard } from '../../lib/clipboard'
import { readTideHtmlTheme } from '../../lib/tideui/htmlTheme'
import { isRemoteMobileViewportRuntime } from '../../hooks/useIsMobileViewport'

const NO_ACTIONS: TideUIActions = {}

export const TideUIHtmlPreview = memo(function TideUIHtmlPreview({ source, actions = NO_ACTIONS, isStreaming = false }: {
  source: string
  actions?: TideUIActions
  isStreaming?: boolean
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const widgetRequested = useRef('')
  const actionState = useRef<{ target: Window | null; credential: string; lastId: number; busy: boolean }>({ target: null, credential: '', lastId: 0, busy: false })
  const preview = useMemo(() => {
    try {
      const token = crypto.randomUUID()
      const credential = crypto.randomUUID()
      return { document: buildTideHtmlDocument(source, token, credential, { styles: '', theme: readTideHtmlTheme() }), token, credential, error: '' }
    } catch (error) {
      return { document: '', token: '', credential: '', error: error instanceof Error ? error.message : 'Invalid HTML preview' }
    }
  }, [source])
  useEffect(() => {
    const viewport = frameRef.current?.closest<HTMLElement>('.chat-scroll-viewport')
    const postViewport = () => {
      if (widgetRequested.current !== preview.token) return
      const frame = frameRef.current
      if (!frame) return
      const bounds = frame.getBoundingClientRect()
      const visible = viewport?.getBoundingClientRect()
      const left = Math.max(0, (visible?.left ?? 0) - bounds.left, -bounds.left)
      const top = Math.max(0, (visible?.top ?? 0) - bounds.top, -bounds.top)
      frame.contentWindow?.postMessage({ channel: TIDE_HTML_MESSAGE, token: preview.token, type: 'viewport', isMobile: isRemoteMobileViewportRuntime(), bounds: {
        left,
        top,
        right: Math.max(left, Math.min(bounds.width, (visible?.right ?? window.innerWidth) - bounds.left, window.innerWidth - bounds.left)),
        bottom: Math.max(top, Math.min(bounds.height, (visible?.bottom ?? window.innerHeight) - bounds.top, window.innerHeight - bounds.top)),
      } }, '*')
    }
    const postState = () => {
      const target = frameRef.current?.contentWindow
      target?.postMessage({ channel: TIDE_HTML_MESSAGE, token: preview.token, type: 'theme', ...readTideHtmlTheme() }, '*')
      target?.postMessage({ channel: TIDE_HTML_MESSAGE, token: preview.token, type: 'state', isStreaming, isMobile: isRemoteMobileViewportRuntime() }, '*')
      postViewport()
      void Promise.all([
        import('./tideui.css?raw'),
        import('@fontsource-variable/google-sans-flex/files/google-sans-flex-latin-wght-normal.woff2?inline'),
      ]).then(([styles, font]) => {
        if (frameRef.current?.contentWindow !== target) return
        const fontFace = `@font-face{font-family:'Google Sans Flex Variable';font-style:normal;font-weight:100 1000;font-display:swap;src:url('${font.default}') format('woff2')}`
        target?.postMessage({ channel: TIDE_HTML_MESSAGE, token: preview.token, type: 'styles', styles: fontFace + styles.default }, '*')
      }).catch(() => {
        target?.postMessage({ channel: TIDE_HTML_MESSAGE, token: preview.token, type: 'styles', styles: '' }, '*')
      })
    }
    const themeObserver = new MutationObserver(postState)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })
    postState()
    viewport?.addEventListener('scroll', postViewport, { passive: true })
    window.addEventListener('resize', postViewport)
    const sizeObserver = new ResizeObserver(postViewport)
    if (frameRef.current) sizeObserver.observe(frameRef.current)
    const receiveMessage = (event: MessageEvent) => {
      const frame = frameRef.current
      const message = event.data
      if (!frame || event.source !== frame.contentWindow || event.origin !== 'null' || !message || message.channel !== TIDE_HTML_MESSAGE || message.token !== preview.token) return
      if (message.type === 'ready') {
        postState()
      } else if (message.type === 'widget-runtime-request') {
        widgetRequested.current = preview.token
        postViewport()
        const target = frame.contentWindow
        void import('virtual:tideui-html-runtime').then(runtime => {
          if (frameRef.current?.contentWindow !== target) return
          target?.postMessage({ channel: TIDE_HTML_MESSAGE, token: preview.token, type: 'widget-runtime', script: runtime.script, styles: runtime.styles }, '*')
        }).catch(() => {
          target?.postMessage({ channel: TIDE_HTML_MESSAGE, token: preview.token, type: 'widget-runtime-error' }, '*')
        })
      } else if (message.type === 'height' && Number.isSafeInteger(message.height) && message.height > 0) {
        frame.style.height = `${message.height}px`
      } else if (message.type === 'wheel' && Number.isFinite(message.deltaY)) {
        // Notify the existing follower of intent without applying any movement.
        // Native wheel scrolling and momentum remain entirely browser-owned.
        frame.dispatchEvent(new WheelEvent('wheel', { deltaY: message.deltaY, bubbles: true }))
      } else if (message.type === 'action' && message.credential === preview.credential && Number.isSafeInteger(message.id) && message.id > 0) {
        const target = frame.contentWindow
        if (!target) return
        if (actionState.current.target !== target || actionState.current.credential !== preview.credential) {
          actionState.current = { target, credential: preview.credential, lastId: 0, busy: false }
        }
        const state = actionState.current
        if (message.id <= state.lastId) return
        state.lastId = message.id
        const reply = (result: { ok: boolean; error?: string }) => {
          if (frameRef.current?.contentWindow !== target) return
          target.postMessage({ channel: TIDE_HTML_MESSAGE, token: preview.token, type: 'action-result', id: message.id, ...result }, '*')
        }
        if (state.busy) {
          reply({ ok: false, error: 'An action is already in progress.' })
          return
        }
        state.busy = true
        void executeHtmlAction(message, actions, isStreaming, copyTextToClipboard).then(reply).finally(() => {
          state.busy = false
        })
      }
    }
    window.addEventListener('message', receiveMessage)
    return () => {
      themeObserver.disconnect()
      sizeObserver.disconnect()
      viewport?.removeEventListener('scroll', postViewport)
      window.removeEventListener('resize', postViewport)
      window.removeEventListener('message', receiveMessage)
    }
  }, [actions, isStreaming, preview.credential, preview.token])
  if (preview.error) return <div className="tideui-error" role="alert">{preview.error}</div>
  return <div className="tideui-root tideui-html-preview">
    <div className="tideui-html-viewport">
      <iframe ref={frameRef} title="Custom HTML"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer" className="tideui-html-frame" srcDoc={preview.document} />
    </div>
  </div>
})
