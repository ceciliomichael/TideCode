import { resolveAppError } from '../../lib/errors/resolveAppError'
import type { AppErrorFeedback, AppErrorId } from '../../lib/errors/errorCatalog'

export interface AppNotification {
  id: number
  feedback: AppErrorFeedback
  action?: { label: string; onClick: () => void }
}

export const NOTIFICATION_EVENT = 'tidecode:app-notification'
export const ERROR_TOAST_DURATION_MS = 3000
let nextNotificationId = 0

export function showAppError(
  error: unknown,
  fallbackMessage: string,
  options: { title?: string; operation?: AppErrorId; action?: { label: string; onClick: () => void } } = {},
) {
  const feedback = resolveAppError(error, options.operation, { fallbackMessage })
  window.dispatchEvent(new CustomEvent<AppNotification>(NOTIFICATION_EVENT, {
    detail: {
      id: ++nextNotificationId,
      feedback: feedback.id === 'app.unexpected' && options.title
        ? { ...feedback, title: options.title }
        : feedback,
      action: options.action,
    },
  }))
}
