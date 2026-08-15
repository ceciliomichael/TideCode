import type { FollowUpBehavior } from '../../src/lib/appSettings'

export type ActiveFollowUpKeyAction = 'primary' | 'alternate'

export function resolveFollowUpKeyBehavior(
  action: ActiveFollowUpKeyAction,
  primaryBehavior: FollowUpBehavior,
): FollowUpBehavior {
  if (action === 'primary') return primaryBehavior
  return primaryBehavior === 'steer' ? 'queue' : 'steer'
}

export function getFollowUpKeyHint(primaryBehavior: FollowUpBehavior): string {
  const enter = primaryBehavior === 'steer' ? 'steer' : 'queue'
  const tab = primaryBehavior === 'steer' ? 'queue' : 'steer'
  return `Enter ${enter} · Tab ${tab} · Esc stop`
}
