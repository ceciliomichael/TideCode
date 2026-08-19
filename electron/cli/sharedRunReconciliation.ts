import type { SharedRunSnapshot } from '../../src/types/chat'
import type { TideCodeRunServiceClient } from '../runService/client'

const SHARED_RUN_RECONCILE_MS = 5_000

export function isSharedRunTerminalStatus(status: SharedRunSnapshot['status']) {
  return status === 'completed'
    || status === 'failed'
    || status === 'cancelled'
    || status === 'interrupted'
}

interface SharedRunSettlementWatcherOptions {
  onMissing: () => void
  onTerminal: (run: SharedRunSnapshot) => void
}

export function watchSharedRunSettlement(
  runService: Pick<TideCodeRunServiceClient, 'getRunByStreamId'>,
  streamId: string,
  options: SharedRunSettlementWatcherOptions,
) {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const schedule = () => {
    if (stopped) return
    timer = setTimeout(() => {
      timer = null
      void runService.getRunByStreamId(streamId)
        .then((run) => {
          if (stopped) return
          if (!run) {
            stopped = true
            options.onMissing()
            return
          }
          if (isSharedRunTerminalStatus(run.status)) {
            stopped = true
            options.onTerminal(run)
            return
          }
          schedule()
        })
        .catch(() => schedule())
    }, SHARED_RUN_RECONCILE_MS)
    timer.unref?.()
  }

  schedule()

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    timer = null
  }
}
