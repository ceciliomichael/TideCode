import type { ModelMessage } from 'ai'
import { stripExecutionModeContext } from '../../../../src/lib/executionModeContext'
import type { ChatProviderId } from '../../../../src/types/chat'
import { createPacketId } from './window'
import type { CompactionPacket, LocalCompactionPacketV2 } from './contracts'
import {
  extractActionLinkedReasoning,
  resolveProviderReasoningCapability,
  resolveReasoningRetention,
} from './reasoning'
import { buildContinuationMarkdownFromPacket } from './markdown'
import { sanitizeCompactionPacketV2 } from './sanitize'

function compactText(value: string, maxLength = 1_500) {
  const normalized = stripExecutionModeContext(value).replace(/\s+/gu, ' ').trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1).trimEnd()}…`
}

function textFromContent(content: ModelMessage['content']) {
  if (typeof content === 'string') return content
  return content
    .filter((part): part is Extract<typeof part, { type: 'text' | 'reasoning' }> => (
      typeof part === 'object' && part !== null && (part.type === 'text' || part.type === 'reasoning')
    ))
    .map((part) => part.text)
    .join('\n')
}

function visibleTextFromContent(content: ModelMessage['content']) {
  if (typeof content === 'string') return content
  return content
    .filter((part): part is Extract<typeof part, { type: 'text' }> => (
      typeof part === 'object' && part !== null && part.type === 'text'
    ))
    .map((part) => part.text)
    .join('\n')
}

function roleText(messages: readonly ModelMessage[], role: ModelMessage['role']) {
  return messages
    .filter((message) => message.role === role)
    .map((message) => compactText(textFromContent(message.content)))
    .filter(Boolean)
}

function extractPaths(messages: readonly ModelMessage[]) {
  const paths = new Set<string>()
  const pathPattern = /(?:[A-Za-z]:[\\/]|\.\.?[\\/]|(?:src|electron|tests|docs)[\\/])[A-Za-z0-9_.@~$\\/-]+/gu
  for (const message of messages) {
    for (const match of textFromContent(message.content).matchAll(pathPattern)) {
      const path = match[0].replace(/[),.;]+$/u, '')
      if (path.length > 1) paths.add(path)
    }
  }
  return [...paths].slice(0, 96)
}

function extractToolObservations(messages: readonly ModelMessage[], sourceStartIndex = 0) {
  return messages
    .map((message, index) => ({
      fact: compactText(textFromContent(message.content)),
      index,
      message,
    }))
    .filter(({ fact, message }) => message.role === 'tool' && fact.length > 0)
    .slice(-96)
    .map(({ fact, index }) => ({
      fact,
      sourceMessageIds: [`model:${sourceStartIndex + index}`],
      status: 'current' as const,
      subject: `tool result ${index}`,
    }))
}

function extractFailures(messages: readonly ModelMessage[]) {
  return messages
    .map((message) => compactText(textFromContent(message.content)))
    .filter((value) => /\b(?:error|failed|failure|denied|not found|invalid)\b/iu.test(value))
    .slice(-24)
    .map((value) => `Observed failure: ${value}`)
}

function extractValidation(messages: readonly ModelMessage[]) {
  return messages
    .map((message) => compactText(visibleTextFromContent(message.content)))
    .filter((value) => /\b(?:test|tests|validated|validation|lint|typecheck|build)\b/iu.test(value))
    .slice(-24)
}

function isV2Packet(packet: CompactionPacket | null | undefined): packet is LocalCompactionPacketV2 {
  return packet?.schema === 'tidecode.compaction_packet/v2'
}

export function buildFallbackCompactionPacket(input: {
  messages: readonly ModelMessage[]
  modelId?: string
  parentPacketId?: string | null
  providerId?: ChatProviderId
  sourceDigest: string
  sourceMessageIds: string[]
  sourceStartIndex?: number
  sourceRange?: { startIndex: number; endIndex: number }
  previousPacket?: CompactionPacket | null
}) : LocalCompactionPacketV2 {
  const users = roleText(input.messages, 'user')
  const assistants = roleText(input.messages, 'assistant')
  const tools = roleText(input.messages, 'tool')
  const paths = extractPaths(input.messages)
  const previous = isV2Packet(input.previousPacket) ? input.previousPacket : null
  const capability = resolveProviderReasoningCapability({
    modelId: input.modelId ?? 'unknown-model',
    providerId: input.providerId,
  })
  const retention = resolveReasoningRetention({ messages: input.messages, capability })

  const packetWithoutMarkdown: LocalCompactionPacketV2 = {
    schema: 'tidecode.compaction_packet/v2',
    packetId: createPacketId(),
    parentPacketId: input.parentPacketId ?? previous?.packetId ?? null,
    sourceDigest: input.sourceDigest,
    sourceMessageIds: input.sourceMessageIds,
    continuationMarkdown: 'Continuation state is being reconstructed from verified evidence.',
    reasoningRetention: {
      ...retention,
      providerId: input.providerId?.trim() || retention.providerId,
    },
    reasoningContinuity: extractActionLinkedReasoning(input.messages, input.sourceStartIndex ?? 0),
    goal: users.length > 0 ? users.slice(0, 2) : (previous?.goal ?? []),
    constraints: previous?.constraints ?? [],
    currentState: [
      ...(assistants.at(-1) ? [`Latest assistant state: ${assistants.at(-1)}`] : []),
      ...(tools.at(-1) ? [`Latest tool evidence: ${tools.at(-1)}`] : []),
      retention.note,
    ],
    completedWork: previous?.completedWork ?? [],
    decisions: previous?.decisions ?? [],
    openItems: users.length > 0 ? [users.at(-1) as string] : (previous?.openItems ?? []),
    failuresAndWorkarounds: extractFailures(input.messages),
    filesAndSymbols: paths.map((path) => ({
      path,
      symbols: [],
      status: 'unknown' as const,
      evidence: 'Path detected in retained conversation evidence; exact file state was not independently re-read by the fallback.',
    })),
    validation: extractValidation(input.messages),
    planState: previous?.planState ?? [],
    toolObservations: extractToolObservations(input.messages, input.sourceStartIndex ?? 0),
    nextActions: users.length > 0
      ? ['Continue from the latest user request and verify the next action against retained evidence.']
      : (previous?.nextActions?.length ? previous.nextActions : ['Re-read the durable history before taking an unverified action.']),
    omitted: [
      'Model summarization was unavailable; unsupported private reasoning and unverified work were not reconstructed.',
    ],
    ...(input.sourceRange ? { sourceRange: input.sourceRange } : {}),
  }

  return sanitizeCompactionPacketV2({
    ...packetWithoutMarkdown,
    continuationMarkdown: buildContinuationMarkdownFromPacket(packetWithoutMarkdown),
  })
}
