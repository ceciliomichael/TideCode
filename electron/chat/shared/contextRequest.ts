import type { ModelMessage } from 'ai'
import type { ContextCapabilities } from './contextCapabilities'
import { calculateModelMessagesContextState } from './compaction/budget'
import { sha256, stableStringify } from '../cache/canonicalization'
import { isEphemeralToolVisualMessage, stripEphemeralToolVisualMessages } from './toolVisualResultMessages'
import { serializeModelContentForEstimate, estimateModelImageTokens } from '../../../src/lib/contextUsage'

export interface PreparedContextRequest {
  requestMessages: ModelMessage[]
  durableMessages: ModelMessage[]
  visualMessages: ModelMessage[]
  fingerprint: string
  state: ReturnType<typeof calculateModelMessagesContextState>
}

export function prepareContextRequest(input: {
  messages: readonly ModelMessage[]
  capabilities: ContextCapabilities
  systemPromptTokens: number
  toolSchemaTokens: number
  triggerRatio: number
  correctionTokens?: number
  scope?: 'next_request' | 'reconstructed_preview'
}): PreparedContextRequest {
  const requestMessages = [...input.messages]
  const state = calculateModelMessagesContextState({
    messages: requestMessages,
    systemPromptTokens: input.systemPromptTokens,
    toolSchemaTokens: input.toolSchemaTokens,
    triggerRatio: input.triggerRatio,
    contextWindowTokens: input.capabilities.contextWindowTokens,
    outputReserveTokens: input.capabilities.maxOutputTokens,
    correctionTokens: input.correctionTokens,
  })
  // Fingerprint sanitized accounting and message structure, never binary image bytes.
  const fingerprint = sha256(stableStringify({
    usage: state.usage,
    structure: requestMessages.map((message) => ({
      role: message.role,
      content: serializeModelContentForEstimate(message.content),
    })),
  }))
  state.usage.scope = input.scope ?? 'next_request'
  state.usage.providerId = input.capabilities.providerId
  state.usage.modelId = input.capabilities.modelId
  state.usage.countingMethod = 'heuristic'
  state.usage.requestFingerprint = fingerprint
  return {
    requestMessages,
    durableMessages: stripEphemeralToolVisualMessages(requestMessages),
    visualMessages: requestMessages.filter(isEphemeralToolVisualMessage),
    fingerprint,
    state,
  }
}

/** Positive feedback only, scoped to an unchanged append-only request segment. */
export class ContextUsageCorrection {
  private correction = 0
  private previousSignatures: string[] = []
  private previousVisuals: readonly ModelMessage[] = []

  prepare(messages: readonly ModelMessage[]) {
    const signatures = messages.map((message) => `${message.role}:${serializeModelContentForEstimate(message.content)}`)
    const visuals = messages.filter((message) => estimateModelImageTokens(message.content) > 0)
    const extendsPrevious = this.previousSignatures.every((signature, index) => signatures[index] === signature)
    const retainsVisuals = this.previousVisuals.every((message, index) => visuals[index] === message)
    if (!extendsPrevious || !retainsVisuals) {
      this.correction = 0
    }
    this.previousSignatures = signatures
    this.previousVisuals = visuals
    return this.correction
  }

  observe(estimatedTokens: number, reportedTokens: number | undefined) {
    if (reportedTokens !== undefined && Number.isFinite(reportedTokens) && reportedTokens >= 0) {
      this.correction = Math.max(this.correction, reportedTokens - estimatedTokens, 0)
    }
  }

  reset() {
    this.correction = 0
    this.previousSignatures = []
    this.previousVisuals = []
  }
}
