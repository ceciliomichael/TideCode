import type { ModelMessage } from 'ai'
import { createPacketId } from './window'
import type { CompactionReasoningMode, LocalCompactionPacket } from './contracts'

function compactText(value: string, maxLength = 1_500) {
  const normalized = value.replace(/\s+/gu, ' ').trim()
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

function detectReasoningMode(messages: readonly ModelMessage[]): CompactionReasoningMode {
  const hasReasoning = messages.some((message) => (
    Array.isArray(message.content) && message.content.some((part) => (
      typeof part === 'object' && part !== null && part.type === 'reasoning'
    ))
  ))
  return hasReasoning ? 'summarizable_reasoning' : 'unavailable_reasoning'
}

export function buildFallbackCompactionPacket(input: {
  messages: readonly ModelMessage[]
  sourceDigest: string
  sourceMessageIds: string[]
  previousPacket?: LocalCompactionPacket | null
}) {
  const users = roleText(input.messages, 'user')
  const assistants = roleText(input.messages, 'assistant')
  const tools = roleText(input.messages, 'tool')
  const paths = extractPaths(input.messages)
  const reasoningMode = detectReasoningMode(input.messages)
  const prior = input.previousPacket

  const packet: LocalCompactionPacket = {
    schema: 'tidecode.compaction_packet/v1',
    packetId: createPacketId(),
    sourceDigest: input.sourceDigest,
    sourceMessageIds: input.sourceMessageIds,
    goal: prior?.goal.length ? prior.goal : users.slice(0, 2),
    constraints: prior?.constraints ?? [],
    currentState: [
      ...((assistants.at(-1) ? [`Latest assistant state: ${assistants.at(-1)}`] : [])),
      ...(tools.at(-1) ? [`Latest tool evidence: ${tools.at(-1)}`] : []),
      `Reasoning retention mode: ${reasoningMode}.`,
    ],
    completedWork: prior?.completedWork ?? [],
    decisions: prior?.decisions ?? [],
    openItems: users.length > 0 ? [users.at(-1) as string] : (prior?.openItems ?? []),
    failuresAndWorkarounds: prior?.failuresAndWorkarounds ?? [],
    filesAndSymbols: paths.map((path) => ({
      path,
      symbols: [],
      status: 'unknown' as const,
      evidence: 'Path detected in retained conversation evidence.',
    })),
    validation: prior?.validation ?? [],
    planState: prior?.planState ?? [],
    toolObservations: prior?.toolObservations ?? [],
    nextActions: prior?.nextActions?.length ? prior.nextActions : ['Continue from the latest user request and retained tool evidence.'],
    omitted: ['Model summarization was unavailable; older details may require rereading from durable history.'],
  }
  return packet
}
