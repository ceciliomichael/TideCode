export const APP_LANGUAGE_OPTIONS = [
  { value: 'en-US', label: 'English (United States)' },
  { value: 'en-GB', label: 'English (United Kingdom)' },
  { value: 'fil-PH', label: 'Filipino (Philippines)' },
] as const

export const APP_APPEARANCE_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const

export const FOLLOW_UP_BEHAVIOR_OPTIONS = [
  { value: 'queue', label: 'Queue' },
  { value: 'steer', label: 'Steer' },
] as const

export type AppLanguageOption = (typeof APP_LANGUAGE_OPTIONS)[number]
export type AppLanguage = AppLanguageOption['value']
export type AppAppearanceOption = (typeof APP_APPEARANCE_OPTIONS)[number]
export type AppAppearance = AppAppearanceOption['value']
export type FollowUpBehaviorOption = (typeof FOLLOW_UP_BEHAVIOR_OPTIONS)[number]
export type FollowUpBehavior = FollowUpBehaviorOption['value']
export type FollowUpBehaviorAction = 'primary' | 'alternate'

export const DEFAULT_APP_LANGUAGE: AppLanguage = APP_LANGUAGE_OPTIONS[0].value
export const DEFAULT_APP_APPEARANCE: AppAppearance = APP_APPEARANCE_OPTIONS[2].value
export const DEFAULT_FOLLOW_UP_BEHAVIOR: FollowUpBehavior = FOLLOW_UP_BEHAVIOR_OPTIONS[0].value

export function isAppLanguage(value: unknown): value is AppLanguage {
  return APP_LANGUAGE_OPTIONS.some((option) => option.value === value)
}

export function isAppAppearance(value: unknown): value is AppAppearance {
  return APP_APPEARANCE_OPTIONS.some((option) => option.value === value)
}

export function isFollowUpBehavior(value: unknown): value is FollowUpBehavior {
  return FOLLOW_UP_BEHAVIOR_OPTIONS.some((option) => option.value === value)
}

export function resolveFollowUpBehaviorForAction(
  action: FollowUpBehaviorAction,
  primaryBehavior: FollowUpBehavior,
): FollowUpBehavior {
  if (action === 'primary') return primaryBehavior
  return primaryBehavior === 'steer' ? 'queue' : 'steer'
}
