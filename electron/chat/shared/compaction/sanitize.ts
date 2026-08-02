import type { LocalCompactionPacket } from './contracts'
import { stripExecutionModeContext } from '../../../../src/lib/executionModeContext'

function sanitizeTextList(values: readonly string[]) {
  return values.map(stripExecutionModeContext).filter((value) => value.length > 0)
}

export function sanitizeCompactionPacket(packet: LocalCompactionPacket): LocalCompactionPacket {
  return {
    ...packet,
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
    toolObservations: packet.toolObservations.map((observation) => ({
      ...observation,
      fact: stripExecutionModeContext(observation.fact),
      subject: stripExecutionModeContext(observation.subject),
    })),
    validation: sanitizeTextList(packet.validation),
  }
}

export function sanitizeCompactionContent(content: string | readonly unknown[]) {
  if (typeof content === 'string') {
    return stripExecutionModeContext(content)
  }

  return content.map((part) => {
    if (typeof part !== 'object' || part === null || !('text' in part)) {
      return part
    }

    const text = (part as { text?: unknown }).text
    return typeof text === 'string'
      ? { ...part, text: stripExecutionModeContext(text) }
      : part
  })
}
