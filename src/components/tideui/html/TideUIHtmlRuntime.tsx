import { createRoot, type Root } from 'react-dom/client'
import { useEffect } from 'react'
import { TideUIBlock } from '../TideUIBlock'
import { OverlayContainerContext, OverlayMobileViewportContext } from '../../ui/OverlayContainerContext'
import type { TideUIActions } from '../../../lib/tideui/types'

interface HtmlWidgetBridge {
  draft: (value: string) => Promise<{ ok: boolean; error?: string }>
  send: (value: string) => Promise<{ ok: boolean; error?: string }>
  copy: (value: string) => Promise<{ ok: boolean; error?: string }>
  open: (value: string) => Promise<{ ok: boolean; error?: string }>
}

// The bundle is installed by the trusted iframe bridge only when a widget exists.
const runtime = window as unknown as { tidecode: HtmlWidgetBridge; __tideWidgetStyles: string }
const widgetStyles = new CSSStyleSheet()
widgetStyles.replaceSync(runtime.__tideWidgetStyles)
const actions: TideUIActions = {
  onDraft: async value => (await runtime.tidecode.draft(value)).ok,
  onSend: async value => (await runtime.tidecode.send(value)).ok,
  onCopy: async value => (await runtime.tidecode.copy(value)).ok,
  onOpen: async value => (await runtime.tidecode.open(value)).ok,
}

export function WidgetContent({ owner, source, overlay, isStreaming }: { owner: HTMLElement; source: string; overlay: HTMLElement | null; isStreaming: boolean }) {
  useEffect(() => {
    owner.dispatchEvent(new CustomEvent('tideui:ready', { bubbles: true }))
  }, [owner])
  return <OverlayMobileViewportContext.Provider value={document.documentElement.dataset.tidecodeMobile === 'true'}><OverlayContainerContext.Provider value={overlay}>
    <TideUIBlock source={source} actions={actions} isStreaming={isStreaming} isBlockComplete />
  </OverlayContainerContext.Provider></OverlayMobileViewportContext.Provider>
}

class TideUIElement extends HTMLElement {
  private root: Root | null = null
  private observer: MutationObserver | null = null
  private overlay: HTMLDivElement | null = null
  private update = () => this.renderWidget()

  connectedCallback() {
    const earlySource = Object.getOwnPropertyDescriptor(this, 'source')
    if (earlySource && typeof earlySource.value === 'string') {
      Reflect.deleteProperty(this, 'source')
      this.source = earlySource.value
    }
    if (!this.root) {
      const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' })
      const mount = document.createElement('div')
      this.overlay = document.createElement('div')
      this.overlay.style.display = 'contents'
      shadow.adoptedStyleSheets = [widgetStyles]
      shadow.replaceChildren(mount, this.overlay)
      this.root = createRoot(mount)
    }
    this.observer = new MutationObserver(this.update)
    this.observer.observe(this, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['source'] })
    window.addEventListener('tidecode:state', this.update)
    this.renderWidget()
  }

  disconnectedCallback() {
    this.observer?.disconnect()
    window.removeEventListener('tidecode:state', this.update)
    // Moving an existing element must preserve its React state.
    queueMicrotask(() => {
      if (!this.isConnected) {
        this.root?.unmount()
        this.root = null
      }
    })
  }

  private renderWidget() {
    const source = this.getAttribute('source') ?? this.querySelector('script[type="text/tideui"]')?.textContent ?? ''
    const isStreaming = document.documentElement.dataset.tidecodeStreaming === 'true'
    this.root?.render(<WidgetContent owner={this} source={source} overlay={this.overlay} isStreaming={isStreaming} />)
  }

  set source(value: string) { this.setAttribute('source', value) }
  get source() { return this.getAttribute('source') ?? this.querySelector('script[type="text/tideui"]')?.textContent ?? '' }
}

if (!customElements.get('tide-ui')) customElements.define('tide-ui', TideUIElement)
