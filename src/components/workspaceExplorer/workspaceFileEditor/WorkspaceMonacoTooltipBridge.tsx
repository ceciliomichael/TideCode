import { useEffect, useState, type RefObject } from 'react'
import type { Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { AnchoredTooltip } from '../../Tooltip'
import { WorkspaceMonacoColorizedTooltipCode } from './WorkspaceMonacoColorizedTooltipCode'
import { useWorkspaceMonacoTypeScriptTooltip } from './useWorkspaceMonacoTypeScriptTooltip'
import type { WorkspaceMonacoTypeScriptTooltipState } from './useWorkspaceMonacoTypeScriptTooltip'

interface WorkspaceMonacoTooltipBridgeProps {
  containerRef: RefObject<HTMLDivElement>
  editorInstance: editor.IStandaloneCodeEditor | null
  monacoInstance: Monaco | null
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
  if (!nativeTooltip) return
  control.setAttribute(FOLDING_TOOLTIP_DATA_ATTRIBUTE, nativeTooltip)
  control.removeAttribute('title')
}

function suppressNativeFoldingTooltips(container: HTMLDivElement) {
  container
    .querySelectorAll<HTMLElement>(FOLDING_CONTROL_SELECTOR)
    .forEach(suppressNativeFoldingTooltip)
}

function resolveFoldingControl(target: EventTarget | null, container: HTMLDivElement) {
  if (!(target instanceof Element)) return null
  const control = target.closest<HTMLElement>(FOLDING_CONTROL_SELECTOR)
  return control && container.contains(control) ? control : null
}

function isCollapsedControl(control: HTMLElement) {
  return control.classList.contains('codicon-folding-collapsed') ||
    control.classList.contains('codicon-folding-manual-collapsed')
}

function TypeScriptTooltipContent({
  monaco,
  tooltip,
}: {
  monaco: Monaco
  tooltip: WorkspaceMonacoTypeScriptTooltipState
}) {
  return (
    <div className="min-w-0 max-w-[28rem] text-left">
      {tooltip.displayText ? (
        <div className="whitespace-pre-wrap break-words font-mono text-xs leading-5">
          <WorkspaceMonacoColorizedTooltipCode
            languageId={tooltip.languageId}
            monaco={monaco}
            text={tooltip.displayText}
          />
        </div>
      ) : null}
      {tooltip.documentation ? (
        <div className="mt-1.5 whitespace-pre-wrap break-words border-t border-tooltip-border pt-1.5 text-xs leading-4 text-tooltip-foreground/90">
          {tooltip.documentation}
        </div>
      ) : null}
      {tooltip.tags.length > 0 ? (
        <div className="mt-1.5 space-y-0.5 border-t border-tooltip-border pt-1.5 text-xs leading-4 text-muted-foreground">
          {tooltip.tags.map((tag) => <div key={tag}>{tag}</div>)}
        </div>
      ) : null}
    </div>
  )
}

export function WorkspaceMonacoTooltipBridge({
  containerRef,
  editorInstance,
  monacoInstance,
}: WorkspaceMonacoTooltipBridgeProps) {
  const [foldingControl, setFoldingControl] = useState<HTMLElement | null>(null)
  const typeScriptTooltip = useWorkspaceMonacoTypeScriptTooltip({
    editorInstance,
    monacoInstance,
  })
  const typeScriptTooltipHasDetails = Boolean(
    typeScriptTooltip?.documentation || typeScriptTooltip?.tags.length,
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const showFoldingTooltipForTarget = (target: EventTarget | null) => {
      const control = resolveFoldingControl(target, container)
      if (!control) return false
      suppressNativeFoldingTooltip(control)
      setFoldingControl(control)
      container.dataset.foldingTooltipActive = 'true'
      return true
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (showFoldingTooltipForTarget(event.target)) return
      setFoldingControl(null)
      delete container.dataset.foldingTooltipActive
    }

    const handlePointerOut = (event: PointerEvent) => {
      if (event.relatedTarget instanceof Node && container.contains(event.relatedTarget)) return
      setFoldingControl(null)
      delete container.dataset.foldingTooltipActive
    }

    const handleFocusIn = (event: FocusEvent) => {
      showFoldingTooltipForTarget(event.target)
    }

    const handleFocusOut = (event: FocusEvent) => {
      if (resolveFoldingControl(event.relatedTarget, container)) return
      setFoldingControl(null)
      delete container.dataset.foldingTooltipActive
    }

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

    container.addEventListener('pointermove', handlePointerMove)
    container.addEventListener('pointerout', handlePointerOut)
    container.addEventListener('pointerdown', handlePointerDown)
    container.addEventListener('focusin', handleFocusIn)
    container.addEventListener('focusout', handleFocusOut)
    return () => {
      container.removeEventListener('pointermove', handlePointerMove)
      container.removeEventListener('pointerout', handlePointerOut)
      container.removeEventListener('pointerdown', handlePointerDown)
      container.removeEventListener('focusin', handleFocusIn)
      container.removeEventListener('focusout', handleFocusOut)
      foldingControlObserver.disconnect()
      delete container.dataset.foldingTooltipActive
    }
  }, [containerRef])

  return (
    <>
      <AnchoredTooltip
        anchorElement={foldingControl}
        content={foldingControl && isCollapsedControl(foldingControl)
          ? 'Click to expand the range.'
          : 'Click to collapse the range.'}
        noWrap
        side="right"
        visible={foldingControl !== null}
      />
      <AnchoredTooltip
        key={typeScriptTooltip?.targetKey ?? 'workspace-typescript-tooltip'}
        anchorElement={null}
        anchorRect={typeScriptTooltip?.anchorRect ?? null}
        content={typeScriptTooltip && monacoInstance
          ? <TypeScriptTooltipContent monaco={monacoInstance} tooltip={typeScriptTooltip} />
          : ''}
        noWrap={!typeScriptTooltipHasDetails}
        panelClassName="font-normal"
        side="top"
        visible={typeScriptTooltip !== null}
      />
    </>
  )
}
