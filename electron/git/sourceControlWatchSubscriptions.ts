export class SourceControlWatchSubscriptions {
  private readonly rootsBySubscriber = new Map<number, Map<string, number>>()

  subscribe(subscriberId: number, workspacePath: string) {
    const subscriberRoots = this.rootsBySubscriber.get(subscriberId) ?? new Map<string, number>()
    const currentCount = subscriberRoots.get(workspacePath) ?? 0
    const isNewSubscription = currentCount === 0
    subscriberRoots.set(workspacePath, currentCount + 1)
    this.rootsBySubscriber.set(subscriberId, subscriberRoots)
    return isNewSubscription
  }

  unsubscribe(subscriberId: number, workspacePath: string) {
    const subscriberRoots = this.rootsBySubscriber.get(subscriberId)
    const currentCount = subscriberRoots?.get(workspacePath) ?? 0
    if (!subscriberRoots || currentCount === 0) {
      return false
    }

    if (currentCount > 1) {
      subscriberRoots.set(workspacePath, currentCount - 1)
      return false
    }

    subscriberRoots.delete(workspacePath)
    if (subscriberRoots.size === 0) {
      this.rootsBySubscriber.delete(subscriberId)
    }

    return true
  }

  removeSubscriber(subscriberId: number) {
    const subscriberRoots = this.rootsBySubscriber.get(subscriberId)
    if (!subscriberRoots) {
      return []
    }

    this.rootsBySubscriber.delete(subscriberId)
    return Array.from(subscriberRoots.keys())
  }

  clear() {
    this.rootsBySubscriber.clear()
  }
}
