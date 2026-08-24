export interface StartupBackgroundTaskOptions {
  delayMs?: number
  idleTimeoutMs?: number
}

const DEFAULT_STARTUP_BACKGROUND_DELAY_MS = 1_000
const DEFAULT_STARTUP_IDLE_TIMEOUT_MS = 4_000

export function scheduleStartupBackgroundTask(
  task: () => void,
  options: StartupBackgroundTaskOptions = {},
) {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  const delayMs = Math.max(0, options.delayMs ?? DEFAULT_STARTUP_BACKGROUND_DELAY_MS)
  const idleTimeoutMs = Math.max(0, options.idleTimeoutMs ?? DEFAULT_STARTUP_IDLE_TIMEOUT_MS)
  let cancelled = false
  let idleCallbackId: number | null = null

  const timeoutId = window.setTimeout(() => {
    if (cancelled) {
      return
    }

    if (typeof window.requestIdleCallback === 'function') {
      idleCallbackId = window.requestIdleCallback(
        () => {
          if (!cancelled) {
            task()
          }
        },
        { timeout: idleTimeoutMs },
      )
      return
    }

    task()
  }, delayMs)

  return () => {
    cancelled = true
    window.clearTimeout(timeoutId)
    if (idleCallbackId !== null && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(idleCallbackId)
    }
  }
}
