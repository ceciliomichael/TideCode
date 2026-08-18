import { randomUUID } from 'node:crypto'
import type {
  Message,
  QueuedMessage,
  SharedFollowUpBehavior,
  SharedFollowUpItem,
  SharedFollowUpSnapshot,
  UpdateSharedFollowUpsInput,
} from '../../src/types/chat'
import { ensureRunServiceClient } from '../runService/ensureService'
import type { CliSessionState } from './types'

export type CliFollowUpBehavior = SharedFollowUpBehavior

type FollowUpPublisher = (input: UpdateSharedFollowUpsInput) => void | Promise<unknown>
type FollowUpClaimer = (streamId: string) => Promise<QueuedMessage[]>

function publishThroughSharedRunService(input: UpdateSharedFollowUpsInput) {
  return ensureRunServiceClient().then((client) => client.updatePendingFollowUps(input))
}

async function claimThroughSharedRunService(streamId: string) {
  const client = await ensureRunServiceClient()
  const result = await client.claimPendingFollowUps({ streamId })
  return result.messages
}

export class CliTurnFollowUpController {
  private followUps: SharedFollowUpItem[] = []

  constructor(
    _providerId: CliSessionState['providerId'],
    private readonly streamId: string,
    private readonly publishFollowUp: FollowUpPublisher = publishThroughSharedRunService,
    private readonly claimFollowUps: FollowUpClaimer = claimThroughSharedRunService,
  ) {}

  add(content: string, behavior: CliFollowUpBehavior): QueuedMessage | null {
    const normalizedContent = content.trim()
    if (!normalizedContent) return null

    const message: QueuedMessage = {
      content: normalizedContent,
      id: randomUUID(),
      timestamp: Date.now(),
    }
    const item: SharedFollowUpItem = { behavior, message }
    this.followUps.push(item)
    void Promise.resolve(this.publishFollowUp({
      mutation: { type: 'add', item },
      streamId: this.streamId,
    })).catch(() => undefined)
    return message
  }

  applySnapshot(snapshot: SharedFollowUpSnapshot): void {
    if (snapshot.streamId !== this.streamId) return
    this.followUps = snapshot.items.map((item) => ({ ...item, message: { ...item.message } }))
  }

  markConsumed(messages: readonly Message[]): void {
    if (messages.length === 0) return
    const consumedIds = new Set(messages.map((message) => message.id))
    this.followUps = this.followUps.filter((followUp) => !(
      followUp.behavior === 'steer' && consumedIds.has(followUp.message.id)
    ))
  }

  getQueuedTurnMessages(): QueuedMessage[] {
    return this.followUps.map((followUp) => ({ ...followUp.message }))
  }

  async claimQueuedTurnMessages(): Promise<QueuedMessage[]> {
    try {
      const messages = await this.claimFollowUps(this.streamId)
      this.followUps = []
      return messages
    } catch {
      return []
    }
  }
}
