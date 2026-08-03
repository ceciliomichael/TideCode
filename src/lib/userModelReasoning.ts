import type {
  CustomModelProviderId,
  ReasoningEffort,
  ReasoningRequestBodies,
} from '../types/chat'

export type UserModelReasoningKind = 'none' | 'toggle' | 'effort' | 'provider_default'

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
  deepseek: ['none', 'low', 'medium', 'high'],
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
  providerId?: CustomModelProviderId,
): UserModelReasoningKind {
  if (!reasoningCapable) return 'none'
  if (providerId && !providerId.startsWith('custom:')) return 'provider_default'

  const uniqueEfforts = Array.from(new Set(efforts ?? []))
  const enabledEfforts = uniqueEfforts.filter((effort) => effort !== 'none')
  if (
    uniqueEfforts.includes('none') &&
    enabledEfforts.length === 1 &&
    uniqueEfforts.length === 2
  ) {
    return 'toggle'
  }

  return 'effort'
}

function buildOpenAICompatibleReasoningBodies(
  efforts: readonly ReasoningEffort[],
  declaredBodies?: ReasoningRequestBodies,
) {
  return Object.fromEntries(
    efforts.map((effort) => [
      effort,
      declaredBodies?.[effort] ?? { reasoning_effort: effort },
    ]),
  ) as ReasoningRequestBodies
}

export function buildUserModelReasoningProfile(input: {
  customReasoningBodies?: ReasoningRequestBodies
  defaultEffort?: ReasoningEffort
  effortChoices?: readonly ReasoningEffort[]
  kind: UserModelReasoningKind
  providerId: CustomModelProviderId
}) {
  if (input.kind === 'none') {
    return { reasoningCapable: false } as const
  }
  if (input.kind === 'provider_default') {
    const isCustomProvider = input.providerId.startsWith('custom:')
    if (isCustomProvider) {
      throw new Error('Custom providers cannot use the default reasoning schema.')
    }
    const defaultSchema = {
      anthropic: { reasoningCapable: true, reasoningEfforts: ['low', 'medium', 'high', 'max'], defaultReasoningEffort: 'high' },
      codex: { reasoningCapable: true, reasoningEfforts: ['low', 'medium', 'high', 'xhigh'], defaultReasoningEffort: 'medium' },
      deepseek: { reasoningCapable: true, reasoningEfforts: ['none', 'low', 'medium', 'high'], defaultReasoningEffort: 'medium' },
      google: { reasoningCapable: true, reasoningEfforts: ['minimal', 'low', 'medium', 'high'], defaultReasoningEffort: 'medium' },
      mistral: { reasoningCapable: true, reasoningEfforts: ['high'], defaultReasoningEffort: 'high' },
      openai: { reasoningCapable: true, reasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'], defaultReasoningEffort: 'medium' },
    } as const
    const providerSchema = defaultSchema[input.providerId as keyof typeof defaultSchema]
    return providerSchema
      ? {
          ...providerSchema,
          reasoningEfforts: [...providerSchema.reasoningEfforts],
        }
      : { reasoningCapable: true }
  }

  const reasoningEfforts: ReasoningEffort[] = input.kind === 'toggle'
    ? ['none', 'high']
    : Array.from(new Set(input.effortChoices ?? []))
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
      ? {
          reasoningBodies: buildOpenAICompatibleReasoningBodies(
            reasoningEfforts,
            input.customReasoningBodies,
          ),
        }
      : {}),
    reasoningEfforts,
  } as const
}
