import type {
  TerminalBrokerOperationState,
  TerminalBrokerSessionState,
} from '../../../src/types/chat'

const SESSION_TRANSITIONS: Readonly<Record<TerminalBrokerSessionState, readonly TerminalBrokerSessionState[]>> = {
  creating: ['ready', 'exited', 'termination_failed', 'session_lost'],
  ready: ['busy', 'exited', 'terminating', 'session_lost'],
  busy: ['ready', 'needs_interaction', 'exited', 'terminating', 'session_lost'],
  needs_interaction: ['busy', 'ready', 'exited', 'terminating', 'session_lost'],
  exited: ['terminated'],
  terminating: ['terminated', 'termination_failed', 'orphaned'],
  terminated: [],
  termination_failed: ['terminating', 'orphaned', 'terminated'],
  orphaned: ['terminating', 'terminated', 'termination_failed'],
  session_lost: ['terminated'],
}

const OPERATION_TRANSITIONS: Readonly<Record<TerminalBrokerOperationState, readonly TerminalBrokerOperationState[]>> = {
  queued: ['writing', 'cancel_requested', 'session_lost'],
  writing: ['running', 'command_failed', 'cancel_requested', 'session_lost'],
  running: ['needs_interaction', 'completed', 'command_failed', 'cancel_requested', 'session_lost'],
  needs_interaction: ['running', 'completed', 'command_failed', 'cancel_requested', 'session_lost'],
  completed: [],
  command_failed: [],
  cancel_requested: ['terminating', 'terminated', 'termination_failed'],
  terminating: ['terminated', 'termination_failed'],
  terminated: [],
  termination_failed: ['terminating', 'terminated'],
  session_lost: [],
}

function transition<TState extends string>(
  domain: string,
  transitions: Readonly<Record<TState, readonly TState[]>>,
  current: TState,
  next: TState,
) {
  if (current === next) return next
  if (!transitions[current].includes(next)) {
    throw new Error(`Invalid ${domain} state transition: ${current} -> ${next}.`)
  }
  return next
}

export function transitionTerminalSessionState(
  current: TerminalBrokerSessionState,
  next: TerminalBrokerSessionState,
) {
  return transition('terminal session', SESSION_TRANSITIONS, current, next)
}

export function transitionTerminalOperationState(
  current: TerminalBrokerOperationState,
  next: TerminalBrokerOperationState,
) {
  return transition('terminal operation', OPERATION_TRANSITIONS, current, next)
}

export function isTerminalSessionFinal(state: TerminalBrokerSessionState) {
  return state === 'terminated' || state === 'session_lost'
}

export function isTerminalOperationFinal(state: TerminalBrokerOperationState) {
  return state === 'completed'
    || state === 'command_failed'
    || state === 'terminated'
    || state === 'session_lost'
}

