import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { TideNode } from '../../lib/tideui/types'
import { getTideNodeStyle } from '../../lib/tideui/style'

export function TideUIModal({ node, onClose, children }: {
  node: TideNode
  onClose: () => void
  children: ReactNode
}) {
  const titleId = useId()
  const modalRef = useRef<HTMLDivElement>(null)
  const dismiss = node.props.dismiss !== 'false'
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    modalRef.current?.querySelector<HTMLElement>('button')?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])
  const size = node.props.size || 'md'
  const sizeClass: Record<string, string> = {
    sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', full: 'max-w-none h-full',
  }
  return createPortal(
    <div className="tideui-modal-backdrop" onMouseDown={event => {
      if (dismiss && event.target === event.currentTarget) onClose()
    }}>
      <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={`tideui-modal-dialog ${sizeClass[size] || sizeClass.md}`}
        style={getTideNodeStyle(node)}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            if (dismiss) onClose()
          }
          if (event.key !== 'Tab') return
          const candidates = Array.from(modalRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
          ) ?? [])
          if (!candidates.length) {
            event.preventDefault()
            return
          }
          const first = candidates[0]
          const last = candidates[candidates.length - 1]
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }}>
        <header className="tideui-modal-header">
          <h2 id={titleId} className="tideui-title">{node.props.title || node.args[0] || 'Details'}</h2>
          {dismiss ? <button className="tideui-modal-close" type="button" onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button> : null}
        </header>
        <div className="tideui-modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
