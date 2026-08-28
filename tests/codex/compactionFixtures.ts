import type { LocalCompactionPacketV2 } from '../../electron/chat/shared/compaction/contracts'

export function createCompactionPacketFixture(
  input: Partial<LocalCompactionPacketV2> & Pick<LocalCompactionPacketV2, 'sourceDigest' | 'sourceMessageIds'>,
): LocalCompactionPacketV2 {
  return {
    schema: 'tidecode.compaction_packet/v2',
    packetId: input.packetId ?? `fixture-${input.sourceDigest}`,
    parentPacketId: input.parentPacketId ?? null,
    sourceDigest: input.sourceDigest,
    sourceMessageIds: input.sourceMessageIds,
    continuationMarkdown: input.continuationMarkdown ?? [
      '## Current state',
      `- Compacted test fixture for ${input.sourceDigest}.`,
    ].join('\n'),
    reasoningRetention: input.reasoningRetention ?? {
      mode: 'unavailable',
      providerId: 'test-provider',
      modelId: 'test-model',
      note: 'Test fixture packet.',
    },
    reasoningContinuity: input.reasoningContinuity ?? [],
    goal: input.goal ?? [],
    constraints: input.constraints ?? [],
    currentState: input.currentState ?? [],
    completedWork: input.completedWork ?? [],
    decisions: input.decisions ?? [],
    openItems: input.openItems ?? [],
    failuresAndWorkarounds: input.failuresAndWorkarounds ?? [],
    filesAndSymbols: input.filesAndSymbols ?? [],
    validation: input.validation ?? [],
    planState: input.planState ?? [],
    toolObservations: input.toolObservations ?? [],
    userPromptLedger: input.userPromptLedger ?? [],
    nextActions: input.nextActions ?? [],
    omitted: input.omitted ?? [],
    ...(input.sourceRange ? { sourceRange: input.sourceRange } : {}),
  }
}
