import { useEffect, useRef, useState } from 'react'
import type { Monaco } from '@monaco-editor/react'
import type { editor, Position } from 'monaco-editor'
import {
  createWorkspaceMonacoHoverAnchor,
  type WorkspaceMonacoHoverAnchorRect,
} from './workspaceMonacoHoverAnchor'
import {
  latchWorkspaceMonacoModifierPressed,
  readWorkspaceMonacoModifierPressed,
} from './workspaceMonacoModifierState'
import {
  findWorkspaceMonacoModuleSpecifierRange,
  getWorkspaceMonacoQuotedModuleSpecifier,
  type WorkspaceMonacoModuleSpecifierRange,
} from './workspaceMonacoModuleDefinition'
import { resolveWorkspaceMonacoModuleHitTarget } from './workspaceMonacoModuleHitTarget'
import {
  formatWorkspaceMonacoModuleTooltipDisplayText,
  getWorkspaceMonacoTypeScriptTooltip,
  type WorkspaceMonacoTypeScriptTooltipData,
} from './workspaceMonacoTypeScriptHover'

export type WorkspaceMonacoTypeScriptTooltipState = WorkspaceMonacoTypeScriptTooltipData & {
  anchorRect: WorkspaceMonacoHoverAnchorRect
  targetKey: string
}

interface UseWorkspaceMonacoTypeScriptTooltipOptions {
  editorInstance: editor.IStandaloneCodeEditor | null
  monacoInstance: Monaco | null
}

interface HoverTarget {
  anchorRect: WorkspaceMonacoHoverAnchorRect
  lookupPosition: Position
  model: editor.ITextModel
  moduleDisplayText: string | null
  targetKey: string
}

function createHoverTarget(
  editorInstance: editor.IStandaloneCodeEditor,
  position: Position | null,
  moduleRangeOverride?: WorkspaceMonacoModuleSpecifierRange | null,
): HoverTarget | null {
  const model = editorInstance.getModel()
  if (!model || !position) return null
  const anchor = createWorkspaceMonacoHoverAnchor(editorInstance, position)
  if (!anchor) return null

  const moduleRange = moduleRangeOverride ?? findWorkspaceMonacoModuleSpecifierRange(
    model.getLineContent(position.lineNumber),
    position.column,
  )
  const lookupPosition = moduleRange
    ? position.with(undefined, moduleRange.startColumn)
    : position

  return {
    anchorRect: anchor.rect,
    lookupPosition,
    model,
    moduleDisplayText: moduleRange
      ? getWorkspaceMonacoQuotedModuleSpecifier(model.getLineContent(position.lineNumber), moduleRange)
      : null,
    targetKey: anchor.key,
  }
}

export function useWorkspaceMonacoTypeScriptTooltip({
  editorInstance,
  monacoInstance,
}: UseWorkspaceMonacoTypeScriptTooltipOptions) {
  const [tooltip, setTooltip] = useState<WorkspaceMonacoTypeScriptTooltipState | null>(null)
  const hoveredTargetRef = useRef<HoverTarget | null>(null)
  const modifierPressedRef = useRef(false)
  const requestGenerationRef = useRef(0)
  const cacheRef = useRef(new Map<string, WorkspaceMonacoTypeScriptTooltipData | null>())

  useEffect(() => {
    if (!editorInstance || !monacoInstance) {
      setTooltip(null)
      return
    }

    const hide = () => {
      requestGenerationRef.current += 1
      setTooltip(null)
    }

    const showTarget = async (target: HoverTarget | null, force = false) => {
      const previousTargetKey = hoveredTargetRef.current?.targetKey ?? null
      const nextTargetKey = target?.targetKey ?? null
      hoveredTargetRef.current = target

      if (!modifierPressedRef.current || !target) {
        if (force || previousTargetKey !== nextTargetKey) hide()
        return
      }

      // Mousemove fires for every pixel. A module path already has one canonical
      // target key, so moving inside the same path must not restart QuickInfo.
      // Restarting here was the main source of the apparent Ctrl-hover delay.
      if (!force && previousTargetKey === target.targetKey) return

      const generation = ++requestGenerationRef.current
      const cached = cacheRef.current.get(target.targetKey)
      if (cached !== undefined) {
        setTooltip(cached ? { ...cached, anchorRect: target.anchorRect, targetKey: target.targetKey } : null)
        return
      }

      try {
        const quickInfo = await getWorkspaceMonacoTypeScriptTooltip(
          monacoInstance,
          target.model,
          target.lookupPosition,
        )
        const languageId = target.model.getLanguageId()
        let data: WorkspaceMonacoTypeScriptTooltipData | null = quickInfo
        if (target.moduleDisplayText && (languageId === 'typescript' || languageId === 'javascript')) {
          data = {
            displayText: formatWorkspaceMonacoModuleTooltipDisplayText(
              quickInfo?.displayText ?? '',
              target.moduleDisplayText,
            ),
            documentation: quickInfo?.documentation ?? '',
            languageId,
            tags: quickInfo?.tags ?? [],
          }
        }
        if (cacheRef.current.size >= 96) {
          const oldestKey = cacheRef.current.keys().next().value as string | undefined
          if (oldestKey) cacheRef.current.delete(oldestKey)
        }
        cacheRef.current.set(target.targetKey, data)
        if (
          generation !== requestGenerationRef.current ||
          !modifierPressedRef.current ||
          hoveredTargetRef.current?.targetKey !== target.targetKey
        ) return
        setTooltip(data ? { ...data, anchorRect: target.anchorRect, targetKey: target.targetKey } : null)
      } catch {
        if (generation === requestGenerationRef.current) setTooltip(null)
      }
    }

    const mouseMoveDisposable = editorInstance.onMouseMove((event) => {
      const modifierWasPressed = modifierPressedRef.current
      modifierPressedRef.current = latchWorkspaceMonacoModifierPressed(
        modifierPressedRef.current,
        event.event,
      )
      const clientX = event.event.browserEvent.clientX
      const clientY = event.event.browserEvent.clientY
      const moduleHitTarget = resolveWorkspaceMonacoModuleHitTarget(
        editorInstance,
        clientX,
        clientY,
        event.target.position,
      )
      const livePosition = moduleHitTarget?.position ?? editorInstance.getTargetAtClientPoint(
        clientX,
        clientY,
      )?.position ?? event.target.position
      const target = createHoverTarget(editorInstance, livePosition, moduleHitTarget?.range)
      void showTarget(target, !modifierWasPressed && modifierPressedRef.current)
    })
    const mouseLeaveDisposable = editorInstance.onMouseLeave(() => {
      hoveredTargetRef.current = null
      hide()
    })
    const modelChangeDisposable = editorInstance.onDidChangeModel(() => {
      hoveredTargetRef.current = null
      cacheRef.current.clear()
      hide()
    })
    const scrollDisposable = editorInstance.onDidScrollChange(() => {
      hoveredTargetRef.current = null
      hide()
    })
    const layoutDisposable = editorInstance.onDidLayoutChange(() => {
      hoveredTargetRef.current = null
      hide()
    })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Control' && event.key !== 'Meta') return
      const modifierWasPressed = modifierPressedRef.current
      modifierPressedRef.current = true
      if (!modifierWasPressed) void showTarget(hoveredTargetRef.current, true)
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== 'Control' && event.key !== 'Meta') return
      modifierPressedRef.current = readWorkspaceMonacoModifierPressed(event)
      if (!modifierPressedRef.current) hide()
    }
    const handleBlur = () => {
      modifierPressedRef.current = false
      hoveredTargetRef.current = null
      hide()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', handleBlur)
    return () => {
      mouseMoveDisposable.dispose()
      mouseLeaveDisposable.dispose()
      modelChangeDisposable.dispose()
      scrollDisposable.dispose()
      layoutDisposable.dispose()
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', handleBlur)
      hoveredTargetRef.current = null
      requestGenerationRef.current += 1
    }
  }, [editorInstance, monacoInstance])

  return tooltip
}
