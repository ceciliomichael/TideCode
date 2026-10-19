import { memo, type ReactNode } from 'react'
import type { TideNode } from '../../lib/tideui/types'
import { createTideTimer, type TideTimerState } from '../../lib/tideui/timer'
import { TideUILayout } from './TideUILayout'
import { TideUIContent } from './TideUIContent'
import { TideUIData } from './TideUIData'
import { TideUICharts } from './TideUICharts'
import { TideUIDiagrams } from './TideUIDiagrams'
import { TideUIControls, TideUITabs, type TideControlContext } from './TideUIControls'
import { TideUITimer } from './TideUITimer'

const LAYOUT = new Set(['panel', 'card', 'section', 'row', 'column', 'grid', 'divider'])
const CONTENT = new Set(['heading', 'text', 'label', 'caption', 'item', 'metric', 'badge', 'alert', 'progress', 'code', 'image', 'gallery'])
const DATA = new Set(['table', 'list', 'comparison'])
const CONTROLS = new Set(['button', 'copy', 'input', 'textarea', 'select', 'checkbox', 'toggle', 'slider', 'link'])

interface TideUINodeProps {
  node: TideNode
  context: TideControlContext
  timers: Record<string, TideTimerState>
  setTimerDuration: (id: string, minutes: number) => void
  render: (nodes: TideNode[]) => ReactNode
}

export const TideUINode = memo(function TideUINode({ node, context, timers, setTimerDuration, render }: TideUINodeProps) {
  if (node.props.mode === 'hidden' && context.values[node.props.id] !== 'true') {
    return null
  }
  if (node.kind === 'timer') {
    const timerId = node.props.id
    const state = timers[timerId] ?? createTideTimer(Number(node.props.duration ?? node.args[1] ?? 25))
    return <TideUITimer node={node} state={state}
      isStreaming={context.isStreaming}
      onCommand={command => context.updateTimer(timerId, command)}
      onDuration={minutes => setTimerDuration(timerId, minutes)} />
  }
  if (node.kind === 'tabs') {
    return <TideUITabs node={node} context={context} render={render} />
  }
  if (node.kind === 'expand') {
    return <details className="tideui-expand"><summary>{node.args[0] || 'Details'}</summary>{render(node.children)}</details>
  }
  if (node.kind === 'chart' || node.kind === 'sparkline') {
    return <TideUICharts node={node} />
  }
  if (node.kind === 'timeline' || node.kind === 'flow') {
    return <TideUIDiagrams node={node} />
  }
  if (CONTROLS.has(node.kind)) {
    return <TideUIControls node={node} context={context} />
  }
  if (DATA.has(node.kind)) {
    return <TideUIData node={node} context={context}>{render(node.children)}</TideUIData>
  }
  if (LAYOUT.has(node.kind)) {
    return <TideUILayout node={node}>{render(node.children)}</TideUILayout>
  }
  if (CONTENT.has(node.kind)) {
    return <TideUIContent node={node} actions={context.actions}>{render(node.children)}</TideUIContent>
  }
  return null
})
