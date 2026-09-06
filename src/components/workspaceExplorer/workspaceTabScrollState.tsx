import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type RefCallback } from 'react'

interface WorkspaceTabScrollPosition {
  left: number
  top: number
}

interface WorkspaceTabScrollStateValue {
  positions: Map<string, WorkspaceTabScrollPosition>
}

const WorkspaceTabScrollStateContext = createContext<WorkspaceTabScrollStateValue | null>(null)

interface WorkspaceTabScrollStateProviderProps {
  children: React.ReactNode
  tabKeys: readonly string[]
}

export function WorkspaceTabScrollStateProvider({ children, tabKeys }: WorkspaceTabScrollStateProviderProps) {
  const positionsRef = useRef(new Map<string, WorkspaceTabScrollPosition>())

  useEffect(() => {
    const activeTabKeys = new Set(tabKeys)
    for (const tabKey of positionsRef.current.keys()) {
      if (!activeTabKeys.has(tabKey)) {
        positionsRef.current.delete(tabKey)
      }
    }
  }, [tabKeys])

  const value = useMemo(() => ({ positions: positionsRef.current }), [])
  return <WorkspaceTabScrollStateContext.Provider value={value}>{children}</WorkspaceTabScrollStateContext.Provider>
}

export function useWorkspaceTabScrollPosition(tabKey: string, restorationKey?: unknown) {
  const context = useContext(WorkspaceTabScrollStateContext)
  const viewportRef = useRef<HTMLDivElement | null>(null)

  const restore = useCallback(() => {
    const viewport = viewportRef.current
    const position = context?.positions.get(tabKey)
    if (!viewport || !position) {
      return
    }

    viewport.scrollLeft = Math.min(position.left, Math.max(0, viewport.scrollWidth - viewport.clientWidth))
    viewport.scrollTop = Math.min(position.top, Math.max(0, viewport.scrollHeight - viewport.clientHeight))
  }, [context, tabKey])

  const registerViewport = useCallback<RefCallback<HTMLDivElement>>((viewport) => {
    viewportRef.current = viewport
    if (!viewport) {
      return
    }

    restore()
    const frame = requestAnimationFrame(restore)
    return () => cancelAnimationFrame(frame)
  }, [restore])

  const handleScroll = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport || !context) {
      return
    }
    context.positions.set(tabKey, { left: viewport.scrollLeft, top: viewport.scrollTop })
  }, [context, tabKey])

  useEffect(() => {
    restore()
    const frame = requestAnimationFrame(restore)
    return () => cancelAnimationFrame(frame)
  }, [restore, restorationKey])

  return { handleScroll, registerViewport }
}
