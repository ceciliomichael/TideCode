import type { ProviderOptions } from '@ai-sdk/provider-utils'
import { findCatalogModel } from '../../models/catalog/catalog'
import { resolveModelReasoningProfile } from '../../../src/lib/modelReasoningProfiles'
import type { ConfigurableProviderModel, ReasoningEffort } from '../../../src/types/chat'
import { isCustomApiKeyProviderId } from '../../providers/providerIds'
import type { ApiKeyChatProviderConfig } from './config'

function findConfiguredModel(
  config: ApiKeyChatProviderConfig,
  modelId: string,
): ConfigurableProviderModel | null {
  const normalizedModelId = modelId.trim().toLowerCase()
  return config.models.find((model) => model.apiModelId.trim().toLowerCase() === normalizedModelId) ?? null
}

export function resolveModelExtraBody(
  config: ApiKeyChatProviderConfig,
  modelId: string,
): Record<string, unknown> {
  if (!isCustomApiKeyProviderId(config.providerId)) return {}
  return findConfiguredModel(config, modelId)?.extraBody ?? {}
}

function findReasoningModel(config: ApiKeyChatProviderConfig, modelId: string) {
  return findConfiguredModel(config, modelId) ??
    (isCustomApiKeyProviderId(config.providerId) ? null : findCatalogModel(config.providerId, modelId))
}

function supportsReasoningEffort(
  config: ApiKeyChatProviderConfig,
  modelId: string,
  reasoningEffort: ReasoningEffort,
) {
  const model = findReasoningModel(config, modelId)
  const profile = model ? resolveModelReasoningProfile(model) : null
  return profile?.efforts.includes(reasoningEffort) === true
}

export function resolveReasoningExtraBody(
  config: ApiKeyChatProviderConfig,
  modelId: string,
  reasoningEffort: ReasoningEffort,
): Record<string, unknown> {
  if (!supportsReasoningEffort(config, modelId, reasoningEffort)) return {}

  if (isCustomApiKeyProviderId(config.providerId)) {
    return findConfiguredModel(config, modelId)?.reasoningBodies?.[reasoningEffort] ?? {}
  }

  if (config.providerId === 'deepseek') {
    if (reasoningEffort === 'none') {
      return {
        thinking: { type: 'disabled' },
      }
    }
    // DeepSeek user-facing efforts map to backend values: low -> low,
    // medium -> high, high -> max. Legacy max/xhigh values stay at max.
    let mappedEffort = reasoningEffort
    if (reasoningEffort === 'medium') mappedEffort = 'high' as typeof reasoningEffort
    else if (reasoningEffort === 'high' || reasoningEffort === 'max' || reasoningEffort === 'xhigh') mappedEffort = 'max' as typeof reasoningEffort

    return {
      reasoning_effort: mappedEffort,
      thinking: { type: 'enabled' },
    }
  }

  return {}
}

export function mergeRequestExtras(base: Record<string, unknown>, reasoning: Record<string, unknown>) {
  const baseChatTemplate = typeof base.chat_template_kwargs === 'object' && base.chat_template_kwargs !== null
    ? base.chat_template_kwargs as Record<string, unknown>
    : {}
  const reasoningChatTemplate = typeof reasoning.chat_template_kwargs === 'object' && reasoning.chat_template_kwargs !== null
    ? reasoning.chat_template_kwargs as Record<string, unknown>
    : {}

  return {
    ...base,
    ...reasoning,
    ...(Object.keys(reasoningChatTemplate).length > 0
      ? { chat_template_kwargs: { ...baseChatTemplate, ...reasoningChatTemplate } }
      : {}),
  }
}

export function resolveProviderReasoningOptions(
  config: ApiKeyChatProviderConfig,
  modelId: string,
  reasoningEffort: ReasoningEffort,
): ProviderOptions | undefined {
  if (!supportsReasoningEffort(config, modelId, reasoningEffort)) return undefined

  if (config.providerId === 'openai') return { openai: { reasoningEffort } }
  if (config.providerId === 'anthropic') {
    const supportsAdaptiveThinking = /claude-(sonnet-4-6|sonnet-5|opus-4-[678]|fable-5|mythos)/u.test(modelId.toLowerCase())
    return {
      anthropic: {
        effort: reasoningEffort,
        ...(supportsAdaptiveThinking ? { thinking: { type: 'adaptive' } } : {}),
      },
    }
  }
  if (config.providerId === 'google') return { google: { thinkingConfig: { thinkingLevel: reasoningEffort } } }
  if (config.providerId === 'mistral') {
    return { mistral: { reasoningEffort: reasoningEffort === 'high' ? 'high' : 'none' } }
  }
  return undefined
}
