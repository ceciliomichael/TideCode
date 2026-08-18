import { resolveFollowUpBehaviorForAction, type FollowUpBehavior, type FollowUpBehaviorAction } from '../../src/lib/appSettings'

export type ActiveFollowUpKeyAction = FollowUpBehaviorAction

export function resolveFollowUpKeyBehavior(
  action: ActiveFollowUpKeyAction,
  primaryBehavior: FollowUpBehavior,
): FollowUpBehavior {
  return resolveFollowUpBehaviorForAction(action, primaryBehavior)
}

export function getFollowUpKeyHint(primaryBehavior: FollowUpBehavior): string {
  const enter = primaryBehavior === 'steer' ? 'steer' : 'queue'
  const tab = primaryBehavior === 'steer' ? 'queue' : 'steer'
  return `Enter ${enter} · Tab ${tab} · Esc stop`
}
