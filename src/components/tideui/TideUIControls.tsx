import { useCallback, useRef, useState } from 'react'
import { copyTextToClipboard } from '../../lib/clipboard'
import { executeTideAction } from '../../lib/tideui/actions'
import { isSafeTideUrl } from '../../lib/tideui/assetPolicy'
import { isTideTimerAction, tideControlUnavailableReason } from '../../lib/tideui/capabilities'
import type { TideTimerCommand, TideTimerStatus } from '../../lib/tideui/timer'
import type { TideNode, TideUIActions } from '../../lib/tideui/types'
import { DropdownField } from '../ui/DropdownField'
import { Tooltip } from '../Tooltip'

export interface TideControlContext {
  values: Record<string, string>
  setValue: (id: string, value: string) => void
  reset: () => void
  lookup: (id: string) => TideNode | undefined
  actions: TideUIActions
  isStreaming: boolean
  updateTimer: (id: string, command: TideTimerCommand) => void
  timerStatus: (id: string) => TideTimerStatus
}

export function TideUIControls({ node, context }: { node: TideNode; context: TideControlContext }) {
  const { values, setValue } = context
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)
  const [feedback, setFeedback] = useState('')
  const pendingRef = useRef(false)
  const identifier = node.props.id || String(node.line)
  const label = node.args[0] || node.props.label || ''
  const defaultValue = node.props.default ?? node.props.value ??
    (node.props.checked === undefined ? '' : (node.props.checked === 'true' ? 'true' : 'false'))
  const value = values[identifier] ?? defaultValue
  const action = node.props.action || (node.kind === 'copy' ? 'copy' : '')
  const timerStatus = node.props.target && isTideTimerAction(action) ? context.timerStatus(node.props.target) : undefined
  const unavailable = context.isStreaming
    ? 'This interface is still generating.'
    : tideControlUnavailableReason(node, context.lookup, context.actions, timerStatus)

  const perform = useCallback(async () => {
    if (pendingRef.current || unavailable) return
    const target = node.props.target ? context.lookup(node.props.target) : undefined

    if (isTideTimerAction(action) && node.props.target) {
      context.updateTimer(node.props.target, action.slice('timer.'.length) as TideTimerCommand)
      return
    }
    if (action === 'reset') {
      context.reset()
      return
    }
    if (action === 'toggle' && target?.props.id) {
      setValue(target.props.id, values[target.props.id] === 'true' ? 'false' : 'true')
      return
    }
    if (['select', 'filter', 'sort'].includes(action) && target?.props.id) {
      setValue(target.props.id, node.props.value || node.args[1] || '')
      return
    }
    if (!['copy', 'draft', 'send', 'open'].includes(action)) return
    const submitted = action === 'send' || action === 'draft'
      ? (node.props.message ?? '')
      : action === 'open'
        ? (node.props.url ?? '')
        : (target
          ? (values[target.props.id || String(target.line)] ?? (target.text || target.args[0] || ''))
          : node.props.value || node.props.message || node.args[1] || label)
    pendingRef.current = true
    setPending(true)
    setFeedback('')
    try {
      const accepted = await executeTideAction({
        kind: action as 'copy' | 'draft' | 'send' | 'open',
        value: submitted,
      }, context.actions, copyTextToClipboard)
      if (accepted && action === 'send') setSent(true)
      if (!accepted) setFeedback('Action could not be completed.')
    } catch {
      setFeedback('Action failed.')
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }, [action, context, label, node, setValue, unavailable, values])

  switch (node.kind) {
    case 'button':
    case 'copy':
      return <div className="tideui-action">
        <Tooltip content={unavailable ?? (feedback || label || 'Copy')} side="top" noWrap>
          <button type="button" className="tideui-button" disabled={pending || sent || Boolean(unavailable)}
            aria-busy={pending || undefined}
            onClick={() => void perform()}>
            {label || 'Copy'}
          </button>
        </Tooltip>
        {unavailable && !context.isStreaming
          ? <span className="tideui-caption" role="status">{unavailable}</span> : null}
        {feedback && !unavailable ? <span className="tideui-caption" role="status">{feedback}</span> : null}
      </div>
    case 'input':
      return <label className="tideui-field">
        <span>{label}</span>
        <input className="tideui-control" value={value} placeholder={node.props.placeholder}
          aria-describedby={node.props.hint ? `tideui-hint-${identifier}` : undefined}
          onChange={event => setValue(identifier, event.target.value)} />
        {node.props.hint ? <span id={`tideui-hint-${identifier}`} className="tideui-caption">{node.props.hint}</span> : null}
      </label>
    case 'textarea':
      return <label className="tideui-field">
        <span>{label}</span>
        <textarea className="tideui-control" rows={3} value={value} placeholder={node.props.placeholder}
          aria-describedby={node.props.hint ? `tideui-hint-${identifier}` : undefined}
          onChange={event => setValue(identifier, event.target.value)} />
        {node.props.hint ? <span id={`tideui-hint-${identifier}`} className="tideui-caption">{node.props.hint}</span> : null}
      </label>
    case 'select':
      return <div className="tideui-field">
        <span>{label}</span>
        <DropdownField
          ariaLabel={label || 'Select an option'}
          disabled={context.isStreaming}
          value={value || node.children[0]?.args[0] || ''}
          onChange={next => setValue(identifier, next)}
          options={node.children.filter(child => child.kind === 'option').map(option => ({
            value: option.args[0],
            label: option.args[1] || option.args[0],
          }))}
          triggerClassName="min-w-0"
        />
        {node.props.hint ? <span className="tideui-caption">{node.props.hint}</span> : null}
      </div>
    case 'checkbox':
    case 'toggle':
      return <label className="tideui-check"><input type="checkbox" checked={value === 'true' || value === 'on'}
        onChange={event => setValue(identifier, event.target.checked ? 'true' : 'false')} />{label}</label>
    case 'slider': {
      const min = Number(node.props.min ?? 0)
      const max = Number(node.props.max ?? 100)
      return <label className="tideui-field">{label}: {value || min}<input type="range" min={min} max={max}
        step={Number(node.props.step || 1)} value={value || String(min)}
        onChange={event => setValue(identifier, event.target.value)} /></label>
    }
    case 'link':
      return isSafeTideUrl(node.props.url || '')
        ? <a className="tideui-link" href={node.props.url} target="_blank" rel="noopener noreferrer" onClick={event => {
          if (context.actions.onOpen) {
            event.preventDefault()
            if (!context.isStreaming) void context.actions.onOpen?.(node.props.url)
          }
        }}>{label}</a>
        : <span className="tideui-caption">This link is unavailable.</span>
    default:
      return null
  }
}

export function TideUITabs({ node, context, render }: {
  node: TideNode
  context: TideControlContext
  render: (nodes: TideNode[]) => React.ReactNode
}) {
  const tabs = node.children.filter(child => child.kind === 'tab')
  const identifier = node.props.id || String(node.line)
  const selected = context.values[identifier] ?? tabs[0]?.args[0]
  return <div className="tideui-section">
    <div className="tideui-tabs" role="tablist" aria-label={node.args[0] || 'Views'}>
      {tabs.map(tab => <button type="button" role="tab" aria-selected={selected === tab.args[0]}
        key={tab.line} className="tideui-tab tideui-control" onClick={() => context.setValue(identifier, tab.args[0])}>{tab.args[0]}</button>)}
    </div>
    {render(tabs.find(tab => tab.args[0] === selected)?.children ?? [])}
  </div>
}
