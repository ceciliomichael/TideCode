export class WorkspaceExplorerWatchSubscriptions {
  private readonly rootsBySubscriber = new Map<number, Map<string, number>>()

  subscribe(subscriberId: number, rootPath: string) {
    const rootSubscriptions = this.rootsBySubscriber.get(subscriberId) ?? new Map<string, number>()
    const currentCount = rootSubscriptions.get(rootPath) ?? 0

    rootSubscriptions.set(rootPath, currentCount + 1)
    this.rootsBySubscriber.set(subscriberId, rootSubscriptions)

    return currentCount === 0
  }

  unsubscribe(subscriberId: number, rootPath: string) {
    const rootSubscriptions = this.rootsBySubscriber.get(subscriberId)
    const currentCount = rootSubscriptions?.get(rootPath) ?? 0
    if (!rootSubscriptions || currentCount === 0) {
      return false
    }

    if (currentCount > 1) {
      rootSubscriptions.set(rootPath, currentCount - 1)
      return false
    }

    rootSubscriptions.delete(rootPath)
    if (rootSubscriptions.size === 0) {
      this.rootsBySubscriber.delete(subscriberId)
    }

    return true
  }

  removeSubscriber(subscriberId: number) {
    const rootSubscriptions = this.rootsBySubscriber.get(subscriberId)
    if (!rootSubscriptions) {
      return []
    }

    this.rootsBySubscriber.delete(subscriberId)
    return Array.from(rootSubscriptions.keys())
  }

  clear() {
    this.rootsBySubscriber.clear()
  }
}
