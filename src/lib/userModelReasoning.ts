import type {
  CustomModelProviderId,
  ReasoningEffort,
  ReasoningRequestBodies,
} from '../types/chat'

export type UserModelReasoningKind = 'none' | 'toggle' | 'effort'

export const USER_MODEL_EFFORT_CHOICES = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly ReasoningEffort[]

const PROVIDER_EFFORT_CHOICES: Partial<Record<CustomModelProviderId, readonly ReasoningEffort[]>> = {
  anthropic: ['low', 'medium', 'high', 'max'],
  codex: ['low', 'medium', 'high', 'xhigh'],
  deepseek: ['none', 'high', 'max'],
  google: ['minimal', 'low', 'medium', 'high'],
  mistral: ['high'],
  openai: ['minimal', 'low', 'medium', 'high', 'xhigh'],
}

export function getSelectableUserModelEfforts(providerId: CustomModelProviderId) {
  return PROVIDER_EFFORT_CHOICES[providerId] ?? USER_MODEL_EFFORT_CHOICES
}

export function getUserModelReasoningKind(
  reasoningCapable: boolean,
  efforts: readonly ReasoningEffort[] | undefined,
): UserModelReasoningKind {
  if (!reasoningCapable || !efforts?.length) return 'none'
  return efforts.length === 2 && efforts.includes('none') && efforts.includes('high')
    ? 'toggle'
    : 'effort'
}

function buildOpenAICompatibleReasoningBodies(efforts: readonly ReasoningEffort[]) {
  return Object.fromEntries(efforts.map((effort) => [
    effort,
    { reasoning_effort: effort },
  ])) as ReasoningRequestBodies
}

export function buildUserModelReasoningProfile(input: {
  defaultEffort?: ReasoningEffort
  effortChoices?: readonly ReasoningEffort[]
  kind: UserModelReasoningKind
  providerId: CustomModelProviderId
}) {
  if (input.kind === 'none') {
    return { reasoningCapable: false } as const
  }

  const reasoningEfforts: ReasoningEffort[] = input.kind === 'toggle'
    ? ['none', 'high']
    : Array.from(new Set(
        (input.effortChoices ?? []).filter((effort) => effort !== 'none'),
      ))
  if (reasoningEfforts.length === 0) {
    throw new Error('Select at least one reasoning effort.')
  }
  const defaultReasoningEffort = input.defaultEffort && reasoningEfforts.includes(input.defaultEffort)
    ? input.defaultEffort
    : reasoningEfforts.includes('medium')
      ? 'medium'
      : reasoningEfforts[0]
  const isCustomProvider = input.providerId.startsWith('custom:')

  return {
    defaultReasoningEffort,
    reasoningCapable: true,
    ...(isCustomProvider
      ? { reasoningBodies: buildOpenAICompatibleReasoningBodies(reasoningEfforts) }
      : {}),
    reasoningEfforts,
  } as const
}
