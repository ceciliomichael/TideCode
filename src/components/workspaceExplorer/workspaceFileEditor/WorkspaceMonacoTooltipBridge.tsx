import { useEffect, useState, type RefObject } from 'react'
import { AnchoredTooltip } from '../../Tooltip'

interface WorkspaceMonacoTooltipBridgeProps {
  containerRef: RefObject<HTMLDivElement>
}

const FOLDING_CONTROL_SELECTOR = [
  '.codicon-folding-collapsed',
  '.codicon-folding-expanded',
  '.codicon-folding-manual-collapsed',
  '.codicon-folding-manual-expanded',
].join(',')

const FOLDING_TOOLTIP_DATA_ATTRIBUTE = 'data-tidecode-folding-tooltip'

function suppressNativeFoldingTooltip(control: HTMLElement) {
  const nativeTooltip = control.getAttribute('title')
  if (!nativeTooltip) {
    return
  }

  control.setAttribute(FOLDING_TOOLTIP_DATA_ATTRIBUTE, nativeTooltip)
  control.removeAttribute('title')
}

function suppressNativeFoldingTooltips(container: HTMLDivElement) {
  container
    .querySelectorAll<HTMLElement>(FOLDING_CONTROL_SELECTOR)
    .forEach(suppressNativeFoldingTooltip)
}

function resolveFoldingControl(target: EventTarget | null, container: HTMLDivElement) {
  if (!(target instanceof Element)) {
    return null
  }

  const control = target.closest<HTMLElement>(FOLDING_CONTROL_SELECTOR)
  return control && container.contains(control) ? control : null
}

function isCollapsedControl(control: HTMLElement) {
  return control.classList.contains('codicon-folding-collapsed') ||
    control.classList.contains('codicon-folding-manual-collapsed')
}

export function WorkspaceMonacoTooltipBridge({ containerRef }: WorkspaceMonacoTooltipBridgeProps) {
  const [foldingControl, setFoldingControl] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const showForTarget = (target: EventTarget | null) => {
      const control = resolveFoldingControl(target, container)
      if (control) {
        suppressNativeFoldingTooltip(control)
        setFoldingControl(control)
        container.dataset.foldingTooltipActive = 'true'
      }
    }
    const hideForTarget = (relatedTarget: EventTarget | null) => {
      if (resolveFoldingControl(relatedTarget, container)) {
        return
      }
      setFoldingControl(null)
      delete container.dataset.foldingTooltipActive
    }
    const handlePointerOver = (event: PointerEvent) => showForTarget(event.target)
    const handlePointerOut = (event: PointerEvent) => hideForTarget(event.relatedTarget)
    const handleFocusIn = (event: FocusEvent) => showForTarget(event.target)
    const handleFocusOut = (event: FocusEvent) => hideForTarget(event.relatedTarget)
    const handlePointerDown = () => {
      setFoldingControl(null)
      delete container.dataset.foldingTooltipActive
    }

    const foldingControlObserver = new MutationObserver(() => {
      suppressNativeFoldingTooltips(container)
    })

    foldingControlObserver.observe(container, {
      attributeFilter: ['title'],
      attributes: true,
      childList: true,
      subtree: true,
    })
    suppressNativeFoldingTooltips(container)

    container.addEventListener('pointerover', handlePointerOver)
    container.addEventListener('pointerout', handlePointerOut)
    container.addEventListener('pointerdown', handlePointerDown)
    container.addEventListener('focusin', handleFocusIn)
    container.addEventListener('focusout', handleFocusOut)
    return () => {
      container.removeEventListener('pointerover', handlePointerOver)
      container.removeEventListener('pointerout', handlePointerOut)
      container.removeEventListener('pointerdown', handlePointerDown)
      container.removeEventListener('focusin', handleFocusIn)
      container.removeEventListener('focusout', handleFocusOut)
      foldingControlObserver.disconnect()
      delete container.dataset.foldingTooltipActive
    }
  }, [containerRef])

  return (
    <AnchoredTooltip
      anchorElement={foldingControl}
      content={foldingControl && isCollapsedControl(foldingControl)
        ? 'Click to expand the range.'
        : 'Click to collapse the range.'}
      noWrap
      side="right"
      visible={foldingControl !== null}
    />
  )
}
