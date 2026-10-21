import type { TideNode, TideUIActions } from './types'
import { isSafeTideUrl } from './assetPolicy'
import type { TideTimerStatus } from './timer'

export const TIDE_TIMER_ACTIONS = ['timer.start', 'timer.pause', 'timer.resume', 'timer.reset', 'timer.end'] as const
export type TideTimerAction = (typeof TIDE_TIMER_ACTIONS)[number]

export const TIDE_ACTIONS = new Set([
  'copy', 'draft', 'send', 'open', 'toggle', 'select', 'sort', 'filter', 'reset',
  'modal.open', 'modal.close', 'modal.confirm',
  ...TIDE_TIMER_ACTIONS,
])

export function isTideTimerAction(action: string): action is TideTimerAction {
  return (TIDE_TIMER_ACTIONS as readonly string[]).includes(action)
}

export function tideControlUnavailableReason(
  node: TideNode,
  lookup: (id: string) => TideNode | undefined,
  actions: TideUIActions,
  timerStatus?: TideTimerStatus,
  openModalId?: string | null,
): string | null {
  const action = node.props.action || (node.kind === 'copy' ? 'copy' : '')
  if (!action) return 'No action was defined.'
  if (!TIDE_ACTIONS.has(action)) return 'This action is not supported.'
  if (action === 'send' && !actions.onSend) return 'Sending messages is unavailable here.'
  if (action === 'draft' && !actions.onDraft) return 'Chat draft editing is unavailable here.'
  if ((action === 'send' || action === 'draft') && !node.props.message?.trim()) {
    return 'A message is required.'
  }
  if (action === 'open' && !isSafeTideUrl(node.props.url ?? '')) {
    return 'A valid HTTP(S) URL is required.'
  }
  if (action === 'modal.open' && (!node.props.target || lookup(node.props.target)?.kind !== 'modal')) {
    return 'This button needs an existing modal.'
  }
  if ((action === 'modal.close' || action === 'modal.confirm') && !openModalId) {
    return 'No dialog is open.'
  }
  if (isTideTimerAction(action) && (node.props.target === undefined || lookup(node.props.target)?.kind !== 'timer')) {
    return 'This button needs a valid timer target.'
  }
  if (timerStatus) {
    if (action === 'timer.start' && !['idle', 'ended', 'completed'].includes(timerStatus)) return 'Timer already started.'
    if (action === 'timer.pause' && timerStatus !== 'running') return 'Timer is not running.'
    if (action === 'timer.resume' && timerStatus !== 'paused') return 'Timer is not paused.'
    if (action === 'timer.reset' && timerStatus === 'idle') return 'Timer has not started.'
    if (action === 'timer.end' && ['idle', 'ended'].includes(timerStatus)) return 'Timer is not active.'
  }
  if (['toggle', 'select', 'sort', 'filter'].includes(action) &&
      (!node.props.target || !lookup(node.props.target)?.props.id)) {
    return 'This button needs a valid control target.'
  }
  if (node.props.target && !lookup(node.props.target)) return 'The action target is unavailable.'
  return null
}
