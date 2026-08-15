import type { ChatProviderId } from '../../../src/types/chat'
import { findCatalogModel } from '../../models/catalog/catalog'
import { listStoredCustomModels } from '../../models/store'
import { readStoredApiKeyProviders, type StoredApiKeyProviders } from '../../providers/store'
import { isCustomApiKeyProviderId } from '../../providers/providerIds'

export function supportsModelImageInput(providerId: ChatProviderId, modelId: string) {
  const catalogModel = findCatalogModel(providerId, modelId)
  if (typeof catalogModel?.supportsImageInput === 'boolean') {
    return catalogModel.supportsImageInput
  }

  // DeepSeek's chat endpoint currently accepts text-only message content. Keep
  // this provider-level fallback for model IDs that are not in the catalog.
  if (providerId === 'deepseek') {
    return false
  }

  return true
}

export async function resolveModelImageInputSupport(providerId: ChatProviderId, modelId: string) {
  const catalogSupport = supportsModelImageInput(providerId, modelId)
  const catalogModel = findCatalogModel(providerId, modelId)
  if (typeof catalogModel?.supportsImageInput === 'boolean' || providerId === 'deepseek') {
    return catalogSupport
  }

  const normalizedModelId = modelId.trim().toLowerCase()
  const [customModels, storedProviders] = await Promise.all([
    listStoredCustomModels().catch(() => []),
    readStoredApiKeyProviders().catch(() => ({} as StoredApiKeyProviders)),
  ])
  const customModel = customModels.find((model) =>
    model.providerId === providerId && model.apiModelId.trim().toLowerCase() === normalizedModelId,
  )
  if (typeof customModel?.supportsImageInput === 'boolean') {
    return customModel.supportsImageInput
  }

  const providerModel = isCustomApiKeyProviderId(providerId)
    ? storedProviders[providerId]?.models?.find((model) => model.apiModelId.trim().toLowerCase() === normalizedModelId)
    : undefined
  if (typeof providerModel?.supportsImageInput === 'boolean') {
    return providerModel.supportsImageInput
  }

  return catalogSupport
}

export function isUnsupportedImageInputError(error: unknown) {
  const messages: string[] = []
  const visit = (value: unknown, depth: number) => {
    if (depth > 3 || value === null || value === undefined) return
    if (typeof value === 'string') {
      messages.push(value)
      return
    }
    if (value instanceof Error) {
      messages.push(value.message)
      visit(value.cause, depth + 1)
      const errorRecord = value as Error & Record<string, unknown>
      for (const key of ['responseBody', 'error', 'data']) {
        if (key in errorRecord) visit(errorRecord[key], depth + 1)
      }
      return
    }
    if (typeof value !== 'object') return

    const record = value as Record<string, unknown>
    for (const key of ['message', 'responseBody', 'error', 'data', 'cause']) {
      if (key in record) visit(record[key], depth + 1)
    }
  }
  visit(error, 0)

  const combined = messages.join('\n').toLowerCase()
  return (
    /unknown variant [`'" ]*image_url/u.test(combined) ||
    /(?:image|vision|multimodal).{0,80}(?:not supported|unsupported|only supports? text)/u.test(combined) ||
    /(?:not supported|unsupported).{0,80}(?:image|vision|multimodal)/u.test(combined)
  )
}
