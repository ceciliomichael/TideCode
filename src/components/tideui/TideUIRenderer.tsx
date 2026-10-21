import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { TideNode, TideUIActions } from '../../lib/tideui/types'
import {
  changeTideTimerDuration, createTideTimer, transitionTideTimer,
  type TideTimerCommand, type TideTimerState,
} from '../../lib/tideui/timer'
import type { TideControlContext } from './TideUIControls'
import { TideUINode } from './TideUINode'

const EMPTY_NODES: TideNode[] = []

export const TideUIRenderer = memo(function TideUIRenderer({ nodes, actions, isStreaming = false }: {
  nodes: TideNode[]
  actions: TideUIActions
  isStreaming?: boolean
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [timers, setTimers] = useState<Record<string, TideTimerState>>({})
  const [openModalId, setOpenModalId] = useState<string | null>(null)
  const [modalFeedback, setModalFeedback] = useState('')
  // Streaming actions are disabled, so declaration growth does not need to
  // invalidate the control context or every memoized presentation branch.
  const actionableNodes = isStreaming ? EMPTY_NODES : nodes
  const lookup = useMemo(() => {
    const found = new Map<string, TideNode>()
    const visit = (node: TideNode) => {
      if (node.props.id) found.set(node.props.id, node)
      node.children.forEach(visit)
    }
    actionableNodes.forEach(visit)
    return (id: string) => found.get(id)
  }, [actionableNodes])
  const updateTimer = useCallback((id: string, command: TideTimerCommand) => {
    const node = lookup(id)
    if (!node || node.kind !== 'timer' || isStreaming) return
    const duration = Number(node.props.duration ?? node.args[1] ?? 25)
    setTimers(current => {
      const previous = current[id] ?? createTideTimer(duration)
      const next = transitionTideTimer(previous, command, Date.now())
      return next === previous ? current : { ...current, [id]: next }
    })
  }, [isStreaming, lookup])
  const setTimerDuration = useCallback((id: string, minutes: number) => {
    const node = lookup(id)
    if (!node || node.kind !== 'timer' || isStreaming) return
    setTimers(current => {
      const previous = current[id] ?? createTideTimer(Number(node.props.duration ?? node.args[1] ?? 25))
      const next = changeTideTimerDuration(previous, minutes)
      return next === previous ? current : { ...current, [id]: next }
    })
  }, [isStreaming, lookup])
  const anyTimerRunning = Object.values(timers).some(timer => timer.status === 'running')
  useEffect(() => {
    if (!anyTimerRunning) return
    const tick = () => setTimers(current => {
      let updated: Record<string, TideTimerState> | null = null
      const now = Date.now()
      for (const [id, state] of Object.entries(current)) {
        const next = transitionTideTimer(state, 'tick', now)
        if (next !== state) {
          updated ??= { ...current }
          updated[id] = next
        }
      }
      return updated ?? current
    })
    const intervalId = window.setInterval(tick, 1000)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [anyTimerRunning])
  const setValue = useCallback((id: string, value: string) => {
    setValues(current => ({ ...current, [id]: value }))
  }, [])
  const reset = useCallback(() => setValues({}), [])
  const timerStatus = useCallback((id: string) => timers[id]?.status ?? 'idle', [timers])
  const context = useMemo<TideControlContext>(() => ({
    values, lookup, actions, isStreaming, updateTimer, timerStatus, setValue, reset,
    openModalId,
    openModal: (id: string) => { setModalFeedback(''); setOpenModalId(id) },
    closeModal: () => setOpenModalId(null),
    confirmModal: () => { setModalFeedback('Confirmed in this view. No external changes were saved.'); setOpenModalId(null) },
  }), [values, lookup, actions, isStreaming, updateTimer, timerStatus, setValue, reset, openModalId])
  const render = useCallback(function render(items: TideNode[]): ReactNode {
    return items.map(node => (
      <TideUINode key={node.props.id || node.line} node={node} context={context}
        timers={timers} setTimerDuration={setTimerDuration} render={render} />
    ))
  }, [context, timers, setTimerDuration])
  return <div className="tideui-root" data-streaming={isStreaming}>
    {render(nodes)}
    {modalFeedback ? <div className="tideui-caption" role="status">{modalFeedback}</div> : null}
  </div>
})
