import { randomUUID } from 'node:crypto'
import type { Message, QueuedMessage, UpdatePendingSteerMessagesInput } from '../../src/types/chat'
import { ensureRunServiceClient } from '../runService/ensureService'
import type { CliSessionState } from './types'

export type CliFollowUpBehavior = 'steer' | 'queue'

interface CliTurnFollowUp {
  behavior: CliFollowUpBehavior
  consumed: boolean
  message: QueuedMessage
}

type SteerPublisher = (input: UpdatePendingSteerMessagesInput) => void | Promise<unknown>

function publishThroughSharedRunService(input: UpdatePendingSteerMessagesInput) {
  return ensureRunServiceClient().then((client) => client.updatePendingSteerMessages(input))
}

export class CliTurnFollowUpController {
  private readonly followUps: CliTurnFollowUp[] = []
  private revision = 0

  constructor(
    _providerId: CliSessionState['providerId'],
    private readonly streamId: string,
    private readonly publishSteers: SteerPublisher = publishThroughSharedRunService,
  ) {}

  add(content: string, behavior: CliFollowUpBehavior): QueuedMessage | null {
    const normalizedContent = content.trim()
    if (!normalizedContent) return null

    const message: QueuedMessage = {
      content: normalizedContent,
      id: randomUUID(),
      timestamp: Date.now(),
    }
    this.followUps.push({ behavior, consumed: false, message })
    if (behavior === 'steer') this.publishPendingSteers()
    return message
  }

  markConsumed(messages: readonly Message[]): void {
    if (messages.length === 0) return
    const consumedIds = new Set(messages.map((message) => message.id))
    for (const followUp of this.followUps) {
      if (followUp.behavior === 'steer' && consumedIds.has(followUp.message.id)) {
        followUp.consumed = true
      }
    }
  }

  getQueuedTurnInputs(): string[] {
    return this.followUps
      .filter((followUp) => followUp.behavior === 'queue' || !followUp.consumed)
      .map((followUp) => followUp.message.content)
  }

  private publishPendingSteers(): void {
    const messages = this.followUps
      .filter((followUp) => followUp.behavior === 'steer' && !followUp.consumed)
      .map((followUp) => followUp.message)
    const input = {
      messages,
      revision: this.revision,
      streamId: this.streamId,
    }
    this.revision += 1
    void Promise.resolve(this.publishSteers(input)).catch(() => undefined)
  }
}
