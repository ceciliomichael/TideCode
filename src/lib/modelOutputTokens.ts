import type { CustomModelProviderId } from '../types/chat'

export const CUSTOM_PROVIDER_DEFAULT_MAX_OUTPUT_TOKENS = 8_192

const BUILT_IN_PROVIDER_DEFAULT_MAX_OUTPUT_TOKENS: Partial<Record<CustomModelProviderId, number>> = {
  anthropic: 128_000,
  codex: 128_000,
  deepseek: 384_000,
  google: 65_536,
  openai: 128_000,
}

export function isValidMaxOutputTokens(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function getDefaultCustomModelMaxOutputTokens(providerId: CustomModelProviderId) {
  if (providerId.startsWith('custom:')) return CUSTOM_PROVIDER_DEFAULT_MAX_OUTPUT_TOKENS
  return BUILT_IN_PROVIDER_DEFAULT_MAX_OUTPUT_TOKENS[providerId]
}
