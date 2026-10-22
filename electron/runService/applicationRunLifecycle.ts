interface OwnedRun {
  ready: Promise<(() => Promise<unknown>) | null>
}

interface ApplicationState {
  closed: boolean
  runs: Map<string, OwnedRun>
  stopping: Promise<void> | null
}

/** Tracks only work started by a registered desktop connection. */
export class ApplicationRunLifecycle {
  private readonly applications = new WeakMap<object, ApplicationState>()

  register(owner: object) {
    if (!this.applications.has(owner)) {
      this.applications.set(owner, { closed: false, runs: new Map(), stopping: null })
    }
  }

  begin(owner: object, runId: string) {
    const state = this.applications.get(owner)
    if (!state) {
      return null
    }
    if (state.closed || state.stopping) {
      throw new Error('TideCode is closing its AI work. Reopen the window before starting another chat turn.')
    }

    let resolve: (cancel: (() => Promise<unknown>) | null) => void = () => undefined
    const ready = new Promise<(() => Promise<unknown>) | null>((settle) => { resolve = settle })
    state.runs.set(runId, { ready })
    return {
      attach: (cancel: () => Promise<unknown>) => resolve(cancel),
      finish: () => {
        resolve(null)
        state.runs.delete(runId)
      },
    }
  }

  async stop(owner: object, disconnect = false): Promise<void> {
    const state = this.applications.get(owner)
    if (!state) {
      return
    }
    if (disconnect) {
      state.closed = true
    }
    if (state.stopping) {
      return state.stopping
    }

    const pending = Array.from(state.runs.entries())
    const stopping = (async () => {
      const results = await Promise.allSettled(pending.map(async ([runId, run]) => {
        const cancel = await run.ready
        if (cancel) {
          await cancel()
        }
        state.runs.delete(runId)
      }))
      const failures = results.filter((result) => result.status === 'rejected')
      if (failures.length > 0) {
        console.error('[run-service] Desktop AI cleanup failed:', failures)
        throw new Error('Some AI commands could not be stopped. Check the terminal cleanup diagnostics.')
      }
    })()
    state.stopping = stopping
    try {
      await stopping
    } finally {
      state.stopping = null
    }
  }
}
