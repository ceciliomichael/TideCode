import type { LocalCompactionPacketV2 } from './contracts'
import { stripExecutionModeContext } from '../../../../src/lib/executionModeContext'
import { normalizeContinuationMarkdown } from './markdown'

function sanitizeTextList(values: readonly string[]) {
  return values.map(stripExecutionModeContext).filter((value) => value.length > 0)
}

function sanitizeReasoningEntry(entry: LocalCompactionPacketV2['reasoningContinuity'][number]) {
  return {
    ...entry,
    action: stripExecutionModeContext(entry.action),
    evidence: entry.evidence.map(stripExecutionModeContext).filter(Boolean),
    nextCheck: entry.nextCheck === null ? null : stripExecutionModeContext(entry.nextCheck),
    rationale: stripExecutionModeContext(entry.rationale),
    situation: stripExecutionModeContext(entry.situation),
    sourceMessageIds: entry.sourceMessageIds.filter((id) => id.trim().length > 0),
  }
}

export function sanitizeCompactionPacketV2(packet: LocalCompactionPacketV2): LocalCompactionPacketV2 {
  return {
    ...packet,
    continuationMarkdown: normalizeContinuationMarkdown(packet.continuationMarkdown),
    constraints: sanitizeTextList(packet.constraints),
    currentState: sanitizeTextList(packet.currentState),
    completedWork: sanitizeTextList(packet.completedWork),
    decisions: sanitizeTextList(packet.decisions),
    failuresAndWorkarounds: sanitizeTextList(packet.failuresAndWorkarounds),
    filesAndSymbols: packet.filesAndSymbols.map((file) => ({
      ...file,
      evidence: stripExecutionModeContext(file.evidence),
      path: stripExecutionModeContext(file.path),
      symbols: sanitizeTextList(file.symbols),
    })),
    goal: sanitizeTextList(packet.goal),
    nextActions: sanitizeTextList(packet.nextActions),
    omitted: sanitizeTextList(packet.omitted),
    openItems: sanitizeTextList(packet.openItems),
    planState: sanitizeTextList(packet.planState),
    reasoningContinuity: packet.reasoningContinuity.map(sanitizeReasoningEntry),
    reasoningRetention: {
      ...packet.reasoningRetention,
      modelId: stripExecutionModeContext(packet.reasoningRetention.modelId),
      note: stripExecutionModeContext(packet.reasoningRetention.note),
      providerId: stripExecutionModeContext(packet.reasoningRetention.providerId),
    },
    sourceMessageIds: packet.sourceMessageIds.filter((id) => id.trim().length > 0),
    toolObservations: packet.toolObservations.map((observation) => ({
      ...observation,
      fact: stripExecutionModeContext(observation.fact),
      sourceMessageIds: observation.sourceMessageIds.filter((id) => id.trim().length > 0),
      subject: stripExecutionModeContext(observation.subject),
    })),
    userPromptLedger: (packet.userPromptLedger ?? []).map((entry) => ({
      ...entry,
      prompt: stripExecutionModeContext(entry.prompt),
      sourceMessageIds: entry.sourceMessageIds.filter((id) => id.trim().length > 0),
    })),
    validation: sanitizeTextList(packet.validation),
  }
}

function sanitizeCompactionValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeCompactionValue)
  }
  if (typeof value !== 'object' || value === null) {
    return value
  }

  const part = value as Record<string, unknown>
  const isImagePart = part.type === 'image'
    const isImageFilePart =
      part.type === 'file' &&
      typeof part.mediaType === 'string' &&
      (part.mediaType === 'image' || part.mediaType.startsWith('image/'))
  if (isImagePart || isImageFilePart) {
    const mediaType = typeof part.mediaType === 'string' ? part.mediaType : 'image'
    return {
      note: 'Binary image payload omitted from the text-only compaction transcript.',
      type: 'image-reference',
      mediaType,
    }
  }

  return Object.fromEntries(Object.entries(part).map(([key, nestedValue]) => [
    key,
    key === 'text' && typeof nestedValue === 'string'
      ? stripExecutionModeContext(nestedValue)
      : sanitizeCompactionValue(nestedValue),
  ]))
}

export function sanitizeCompactionContent(content: string | readonly unknown[]) {
  return typeof content === 'string'
    ? stripExecutionModeContext(content)
    : sanitizeCompactionValue(content)
}
