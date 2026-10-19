import { useEffect, useState } from 'react'
import type { TideNode } from '../../lib/tideui/types'
import {
  type TideTimerCommand,
  type TideTimerState,
  tideTimerRemainingSeconds,
  validTideTimerMinutes,
} from '../../lib/tideui/timer'

interface TideUITimerProps {
  node: TideNode
  state: TideTimerState
  onCommand: (command: TideTimerCommand) => void
  onDuration: (minutes: number) => void
  isStreaming: boolean
}

/** Trusted native countdown, never JavaScript supplied by the AI. */
export function TideUITimer({ node, state, onCommand, onDuration, isStreaming }: TideUITimerProps) {
  const [customMinutes, setCustomMinutes] = useState(String(state.durationMinutes))
  const [durationError, setDurationError] = useState('')
  useEffect(() => {
    setCustomMinutes(String(state.durationMinutes))
    setDurationError('')
  }, [state.durationMinutes])
  const commitCustomDuration = () => {
    const parsed = Number(customMinutes)
    if (!validTideTimerMinutes(parsed)) {
      setDurationError('Enter a whole number of minutes from 1 to 240.')
      return
    }
    setDurationError('')
    onDuration(parsed)
  }
  const seconds = tideTimerRemainingSeconds(state, Date.now())
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  const timeLabel = [
    ...(hours > 0 ? [String(hours).padStart(2, '0')] : []),
    String(minutes).padStart(2, '0'),
    String(remainingSeconds).padStart(2, '0'),
  ].join(':')
  const isActive = state.status === 'running' || state.status === 'paused'
  const statusText: Record<TideTimerState['status'], string> = {
    idle: 'Ready to start',
    running: 'Focus session running',
    paused: 'Focus session paused',
    completed: 'Focus session complete',
    ended: 'Focus session ended',
  }
  const disabled = isStreaming

  return <section className="tideui-timer" aria-label={node.args[0] || 'Focus timer'}>
    <div className="tideui-heading">{node.args[0] || 'Focus timer'}</div>
    <div className="tideui-timer-time" role="timer" aria-label={`Remaining: ${timeLabel}`}>{timeLabel}</div>
    <div className="tideui-caption" role="status" aria-live="polite">{statusText[state.status]}</div>
    <fieldset className="tideui-timer-duration" disabled={isActive || disabled}>
      <legend className="tideui-caption">Duration (minutes)</legend>
      <div className="tideui-row">
        {[25, 50, 90].map(value => <button key={value} type="button"
          aria-pressed={state.durationMinutes === value}
          className="tideui-control tideui-timer-preset"
          onClick={() => onDuration(value)}>{value}</button>)}
        <label className="tideui-field">
          <span>Custom</span>
          <input className="tideui-control tideui-timer-custom" type="number"
            min={1} max={240} step={1} value={customMinutes}
            onChange={event => setCustomMinutes(event.target.value)}
            onBlur={commitCustomDuration}
            onKeyDown={event => { if (event.key === 'Enter') commitCustomDuration() }}/>
        </label>
      </div>
      {durationError ? <div className="tideui-caption" role="alert">{durationError}</div> : null}
    </fieldset>
    <div className="tideui-row tideui-timer-actions">
      {state.status === 'idle' || state.status === 'ended' || state.status === 'completed'
        ? <button type="button" className="tideui-button" disabled={disabled} onClick={() => onCommand('start')}>Start</button>
        : null}
      {state.status === 'running'
        ? <button type="button" className="tideui-button" disabled={disabled} onClick={() => onCommand('pause')}>Pause</button>
        : null}
      {state.status === 'paused'
        ? <button type="button" className="tideui-button" disabled={disabled} onClick={() => onCommand('resume')}>Resume</button>
        : null}
      <button type="button" className="tideui-control tideui-timer-preset" disabled={disabled || state.status === 'idle'} onClick={() => onCommand('reset')}>Reset</button>
      <button type="button" className="tideui-control tideui-timer-preset" disabled={disabled || state.status === 'idle' || state.status === 'ended'} onClick={() => onCommand('end')}>End</button>
    </div>
    <p className="tideui-caption">
      This timer runs while this chat view stays open, including while the window is in the background.
      It does not survive a reload, and it does not send a system notification.
    </p>
  </section>
}
