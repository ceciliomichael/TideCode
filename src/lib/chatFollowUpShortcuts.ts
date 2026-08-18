import type { FollowUpBehaviorAction } from './appSettings'

export interface ChatFollowUpShortcutEvent {
  altKey: boolean
  ctrlKey: boolean
  key: string
  metaKey: boolean
  shiftKey: boolean
}

export function resolveChatFollowUpShortcutAction(
  event: ChatFollowUpShortcutEvent,
): FollowUpBehaviorAction | null {
  if (event.key !== 'Enter' || event.shiftKey || event.altKey) return null
  return event.ctrlKey || event.metaKey ? 'alternate' : 'primary'
}
