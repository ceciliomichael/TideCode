export const TIDE_HTML_MESSAGE = 'tidecode-html-preview'

/** Runs inside the opaque iframe; it has no access to the application's DOM. */
function installHtmlPreviewBridge(token: string, credential: string) {
  // Keep the action credential private before any generated script can run.
  // The CSP nonce/token is public; it cannot authorize application actions.
  document.currentScript?.remove()
  const postToParent = window.parent.postMessage.bind(window.parent)
  const send = (message: Record<string, unknown>) => {
    postToParent({ channel: 'tidecode-html-preview', token, ...message }, '*')
  }
  let gestureAvailable = false
  let trustedClick: MouseEvent | null = null
  const readEventPhase = Function.prototype.call.bind(Object.getOwnPropertyDescriptor(Event.prototype, 'eventPhase')!.get!) as (event: Event) => number
  let requestId = 0
  let requestedWidgets = false
  const pending = new Map<number, { resolve: (result: { ok: boolean; error?: string }) => void; timeout: number }>()
  const requestAction = (kind: string, value: string): Promise<{ ok: boolean; error?: string }> => {
    if (!gestureAvailable || !trustedClick || readEventPhase(trustedClick) === 0) {
      return Promise.resolve({ ok: false, error: 'Call this action directly from a user click handler.' })
    }
    if (pending.size) return Promise.resolve({ ok: false, error: 'An action is already in progress.' })
    if (!['draft', 'send', 'copy', 'open'].includes(kind) || typeof value !== 'string' || !value.trim() || value.length > 4000) {
      return Promise.resolve({ ok: false, error: 'Action requires a supported type and 1–4000 characters.' })
    }
    gestureAvailable = false
    const id = ++requestId
    return new Promise(resolve => {
      const timeout = window.setTimeout(() => {
        pending.delete(id)
        resolve({ ok: false, error: 'TideCode did not respond to the action.' })
      }, 30000)
      pending.set(id, { resolve, timeout })
      send({ type: 'action', credential, id, kind, value })
    })
  }
  Object.defineProperty(window, 'tidecode', { value: Object.freeze({
    draft: (value: string) => requestAction('draft', value),
    send: (value: string) => requestAction('send', value),
    copy: (value: string) => requestAction('copy', value),
    open: (value: string) => requestAction('open', value),
  }) })
  window.addEventListener('message', event => {
    const message = event.data
    if (event.source !== window.parent || !message || message.channel !== 'tidecode-html-preview' || message.token !== token) return
    if (message.type === 'styles' && typeof message.styles === 'string') {
      let style = document.head.querySelector<HTMLStyleElement>('[data-tide-design]')
      if (!style) {
        style = document.createElement('style')
        style.setAttribute('data-tide-design', '')
        document.head.insertBefore(style, document.head.querySelector('style'))
      }
      style.textContent = message.styles
      return
    }
    if (message.type === 'theme' && message.variables && typeof message.variables === 'object') {
      // Theme tokens are defaults, not inline declarations. Inline styles on
      // :root would override the generated page's own CSS customizations.
      let themeStyle = document.head.querySelector<HTMLStyleElement>('[data-tide-theme]')
      if (!themeStyle) {
        themeStyle = document.createElement('style')
        themeStyle.setAttribute('data-tide-theme', '')
        document.head.insertBefore(themeStyle, document.head.querySelector('style'))
      }
      const declarations: string[] = []
      for (const [name, value] of Object.entries(message.variables)) {
        if (/^--(?:color|font|shadow|radius)-[\w-]+$/.test(name) && typeof value === 'string') {
          // Escape CSS text boundaries; values originate from computed theme
          // tokens, not generated HTML or the preview's JavaScript.
          declarations.push(`${name}:${value.replace(/[;{}]/g, '')}`)
        }
      }
      const mode = message.mode === 'dark' ? 'dark' : 'light'
      themeStyle.textContent = `:root{color-scheme:${mode};${declarations.join(';')}}`
      document.documentElement.dataset.theme = mode
      return
    }
    if (message.type === 'state' && typeof message.isStreaming === 'boolean') {
      document.documentElement.dataset.tidecodeStreaming = String(message.isStreaming)
      document.documentElement.dataset.tidecodeMobile = String(message.isMobile === true)
      window.dispatchEvent(new Event('tidecode:state'))
      return
    }
    if (message.type === 'viewport' && message.bounds && ['left', 'top', 'right', 'bottom'].every(key => Number.isFinite(message.bounds[key]))) {
      document.documentElement.dataset.tidecodeViewport = JSON.stringify(message.bounds)
      const mobile = String(message.isMobile === true)
      if (document.documentElement.dataset.tidecodeMobile !== mobile) {
        document.documentElement.dataset.tidecodeMobile = mobile
        window.dispatchEvent(new Event('tidecode:state'))
      }
      window.dispatchEvent(new Event('resize'))
      return
    }
    if (message.type === 'widget-runtime' && typeof message.script === 'string' && typeof message.styles === 'string' && !customElements.get('tide-ui')) {
      Object.defineProperty(window, '__tideWidgetStyles', { value: message.styles })
      const script = document.createElement('script')
      script.textContent = message.script
      document.head.append(script)
      script.remove()
      return
    }
    if (message.type === 'widget-runtime-error') {
      for (const element of Array.from(document.querySelectorAll('tide-ui'))) {
        const error = document.createElement('span')
        error.className = 'tideui-error'
        error.setAttribute('role', 'alert')
        error.textContent = 'Unable to load TideUI widgets.'
        element.append(error)
      }
      return
    }
    if (message.type !== 'action-result') return
    const item = pending.get(message.id)
    if (!item || typeof message.ok !== 'boolean') return
    pending.delete(message.id)
    clearTimeout(item.timeout)
    item.resolve({ ok: message.ok, error: typeof message.error === 'string' ? message.error : undefined })
  })
  document.addEventListener('click', event => {
    if (!event.isTrusted) return
    gestureAvailable = true
    trustedClick = event
  }, true)
  document.addEventListener('click', event => {
    if (!event.isTrusted || event.defaultPrevented || !(event.target instanceof Element)) return
    const control = event.target.closest<HTMLElement>('[data-tide-action]')
    if (!control || control.hasAttribute('disabled') || control.getAttribute('aria-disabled') === 'true') return
    event.preventDefault()
    control.setAttribute('aria-busy', 'true')
    control.setAttribute('disabled', '')
    const previousFeedback = control.nextElementSibling
    if (previousFeedback?.hasAttribute('data-tide-feedback')) previousFeedback.remove()
    const kind = control.dataset.tideAction || ''
    void requestAction(kind, control.dataset.tideValue || '').then(result => {
      control.removeAttribute('aria-busy')
      if (!result.ok || kind !== 'send') control.removeAttribute('disabled')
      if (!result.ok) {
        const feedback = document.createElement('span')
        feedback.setAttribute('data-tide-feedback', '')
        feedback.setAttribute('role', 'status')
        feedback.textContent = result.error || 'Action failed.'
        control.insertAdjacentElement('afterend', feedback)
      }
      control.dispatchEvent(new CustomEvent('tidecode:action-result', { detail: result, bubbles: true }))
    })
  })
  let lastHeight = -1
  let scheduled = false
  const measure = () => {
    scheduled = false
    const body = document.body
    if (!body) return
    // Unlike documentElement.scrollHeight, the body box can shrink below the
    // current iframe viewport. Include overflow without imposing a viewport floor.
    const bounds = body.getBoundingClientRect()
    let bottom = Math.max(bounds.bottom, bounds.top + body.scrollHeight)
    for (const child of Array.from(body.children)) {
      const childBounds = child.getBoundingClientRect()
      const margin = Number.parseFloat(getComputedStyle(child).marginBottom) || 0
      bottom = Math.max(bottom, childBounds.bottom + margin)
    }
    const height = Math.max(1, Math.ceil(bottom + window.scrollY))
    if (height !== lastHeight) {
      lastHeight = height
      send({ type: 'height', height })
    }
  }
  const scheduleMeasure = () => {
    if (!requestedWidgets && document.querySelector('tide-ui')) {
      requestedWidgets = true
      send({ type: 'widget-runtime-request' })
    }
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(measure)
  }
  const start = () => {
    if (!document.body) return
    new ResizeObserver(scheduleMeasure).observe(document.body)
    new MutationObserver(scheduleMeasure).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true })
    document.addEventListener('load', scheduleMeasure, true)
    window.addEventListener('resize', scheduleMeasure)
    document.fonts.ready.then(scheduleMeasure)
    send({ type: 'ready' })
    scheduleMeasure()
  }
  document.addEventListener('DOMContentLoaded', start, { once: true })
  document.addEventListener('wheel', event => {
    if (event.ctrlKey || event.defaultPrevented || event.deltaY === 0) return
    // Observe intent only. Chromium owns wheel movement, momentum and scroll
    // chaining across the iframe boundary, just as it does outside this embed.
    send({ type: 'wheel', deltaY: event.deltaY })
  }, { passive: true })
}

export function buildHtmlPreviewBridge(token: string, credential: string): string {
  return `(${installHtmlPreviewBridge.toString()})(${JSON.stringify(token)},${JSON.stringify(credential)})`
}
