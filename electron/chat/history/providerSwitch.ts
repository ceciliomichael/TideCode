import type { ChatProviderId, Message } from '../../../src/types/chat'
import type { CanonicalHistoryDocument } from './contracts'

export function shouldMigrateCrossProviderHistoryToText(input: {
  document: CanonicalHistoryDocument
  messages: readonly Message[]
  targetProviderId: ChatProviderId
}) {
  const observedProviders = new Set<ChatProviderId>()

  for (const event of input.document.events) {
    if (event.branchId !== input.document.activeBranchId || event.type !== 'run_started') {
      continue
    }

    observedProviders.add(event.providerId)
  }

  for (const message of input.messages) {
    if (message.providerId) {
      observedProviders.add(message.providerId)
    }
  }

  return input.targetProviderId === 'codex' && [...observedProviders].some(
    (providerId) => providerId !== input.targetProviderId,
  )
}
