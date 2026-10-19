export type TideTimerStatus = 'idle' | 'running' | 'paused' | 'completed' | 'ended'
export type TideTimerCommand = 'start' | 'pause' | 'resume' | 'reset' | 'end' | 'tick'

export interface TideTimerState {
  status: TideTimerStatus
  durationMinutes: number
  remainingMs: number
  deadlineMs: number | null
}

export function validTideTimerMinutes(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 240
}

export function createTideTimer(durationMinutes: number): TideTimerState {
  const minutes = validTideTimerMinutes(durationMinutes) ? durationMinutes : 25
  return { status: 'idle', durationMinutes: minutes, remainingMs: minutes * 60_000, deadlineMs: null }
}

export function tideTimerRemainingSeconds(state: TideTimerState, now: number): number {
  const remaining = state.status === 'running' && state.deadlineMs !== null
    ? Math.max(0, state.deadlineMs - now)
    : state.remainingMs
  return Math.ceil(remaining / 1000)
}

/** Absolute deadlines avoid interval drift after throttling or backgrounding. */
export function transitionTideTimer(
  state: TideTimerState,
  command: TideTimerCommand,
  now: number,
): TideTimerState {
  switch (command) {
    case 'start':
      if (state.status === 'running' || state.status === 'paused') return state
      return {
        ...state,
        status: 'running',
        remainingMs: state.durationMinutes * 60_000,
        deadlineMs: now + state.durationMinutes * 60_000,
      }
    case 'pause':
      if (state.status !== 'running' || state.deadlineMs === null) return state
      return {
        ...state,
        status: 'paused',
        remainingMs: Math.max(0, state.deadlineMs - now),
        deadlineMs: null,
      }
    case 'resume':
      if (state.status !== 'paused') return state
      return {
        ...state,
        status: 'running',
        deadlineMs: now + state.remainingMs,
      }
    case 'reset':
      return createTideTimer(state.durationMinutes)
    case 'end':
      if (state.status === 'ended') return state
      return { ...state, status: 'ended', deadlineMs: null, remainingMs: 0 }
    case 'tick': {
      if (state.status !== 'running' || state.deadlineMs === null) return state
      const remainingMs = Math.max(0, state.deadlineMs - now)
      if (remainingMs <= 0) {
        return { ...state, status: 'completed', remainingMs: 0, deadlineMs: null }
      }
      if (Math.ceil(remainingMs / 1000) === Math.ceil(state.remainingMs / 1000)) return state
      return { ...state, remainingMs }
    }
  }
}

export function changeTideTimerDuration(state: TideTimerState, minutes: number): TideTimerState {
  if (!validTideTimerMinutes(minutes)) return state
  if (state.status === 'running' || state.status === 'paused') return state
  return createTideTimer(minutes)
}
