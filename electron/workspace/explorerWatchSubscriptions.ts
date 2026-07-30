export class WorkspaceExplorerWatchSubscriptions {
  private readonly rootsBySubscriber = new Map<number, Map<string, number>>()
  private readonly watchPathsBySubscriber = new Map<number, Map<string, Set<string>>>()

  subscribe(subscriberId: number, rootPath: string, watchPaths: ReadonlySet<string> = new Set(['.'])) {
    const rootSubscriptions = this.rootsBySubscriber.get(subscriberId) ?? new Map<string, number>()
    const currentCount = rootSubscriptions.get(rootPath) ?? 0

    rootSubscriptions.set(rootPath, currentCount + 1)
    this.rootsBySubscriber.set(subscriberId, rootSubscriptions)

    const subscriberWatchPaths = this.watchPathsBySubscriber.get(subscriberId) ?? new Map<string, Set<string>>()
    subscriberWatchPaths.set(rootPath, new Set(watchPaths))
    this.watchPathsBySubscriber.set(subscriberId, subscriberWatchPaths)

    return currentCount === 0
  }

  updateWatchPaths(subscriberId: number, rootPath: string, watchPaths: ReadonlySet<string>) {
    const rootSubscriptions = this.rootsBySubscriber.get(subscriberId)
    if (!rootSubscriptions || (rootSubscriptions.get(rootPath) ?? 0) === 0) {
      return false
    }

    const subscriberWatchPaths = this.watchPathsBySubscriber.get(subscriberId) ?? new Map<string, Set<string>>()
    subscriberWatchPaths.set(rootPath, new Set(watchPaths))
    this.watchPathsBySubscriber.set(subscriberId, subscriberWatchPaths)
    return true
  }

  getWatchPaths(rootPath: string) {
    const watchPaths = new Set<string>()
    for (const subscriberWatchPaths of this.watchPathsBySubscriber.values()) {
      for (const watchPath of subscriberWatchPaths.get(rootPath) ?? []) {
        watchPaths.add(watchPath)
      }
    }

    return watchPaths.size > 0 ? watchPaths : new Set(['.'])
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

    const subscriberWatchPaths = this.watchPathsBySubscriber.get(subscriberId)
    subscriberWatchPaths?.delete(rootPath)
    if (subscriberWatchPaths && subscriberWatchPaths.size === 0) {
      this.watchPathsBySubscriber.delete(subscriberId)
    }

    return true
  }

  removeSubscriber(subscriberId: number) {
    const rootSubscriptions = this.rootsBySubscriber.get(subscriberId)
    if (!rootSubscriptions) {
      return []
    }

    this.rootsBySubscriber.delete(subscriberId)
    this.watchPathsBySubscriber.delete(subscriberId)
    return Array.from(rootSubscriptions.keys())
  }

  clear() {
    this.rootsBySubscriber.clear()
    this.watchPathsBySubscriber.clear()
  }
}
