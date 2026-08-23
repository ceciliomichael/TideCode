import { ChatStreamSteeringController, type PendingSteerMessageSnapshot } from './streamSteering'
import type { ChatStreamCancellation } from '../../../src/types/chat'

export interface ActiveChatStreamRegistration {
  readonly abortController: AbortController
  readonly settled: Promise<void>
  readonly steering: ChatStreamSteeringController
}

interface StoredActiveChatStreamRegistration extends ActiveChatStreamRegistration {
  readonly resolveSettled: () => void
}

export class ActiveChatStreamRegistry {
  private readonly registrations = new Map<string, StoredActiveChatStreamRegistration>()

  register(streamId: string, abortController: AbortController): ActiveChatStreamRegistration {
    if (this.registrations.has(streamId)) {
      throw new Error(`Chat stream is already registered: ${streamId}`)
    }

    let resolveSettled: () => void = () => undefined
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve
    })
    const registration: StoredActiveChatStreamRegistration = {
      abortController,
      resolveSettled,
      settled,
      steering: new ChatStreamSteeringController(),
    }
    this.registrations.set(streamId, registration)
    return registration
  }

  updatePendingSteerMessages(streamId: string, snapshot: PendingSteerMessageSnapshot) {
    const registration = this.registrations.get(streamId)
    if (!registration || registration.abortController.signal.aborted) {
      return false
    }

    return registration.steering.replacePending(snapshot)
  }

  settle(streamId: string) {
    const registration = this.registrations.get(streamId)
    if (!registration) {
      return
    }

    this.registrations.delete(streamId)
    registration.resolveSettled()
  }

  async cancel(streamId: string, cancellation: ChatStreamCancellation): Promise<boolean> {
    const registration = this.registrations.get(streamId)
    if (!registration) {
      return false
    }

    if (!registration.abortController.signal.aborted) {
      registration.abortController.abort(cancellation)
    }
    await registration.settled
    return true
  }
}
