export interface AppNotification {
  id: number
  title: string
  message: string
  fallbackMessage: string
  action?: { label: string; onClick: () => void }
}

export const NOTIFICATION_EVENT = 'tidecode:app-notification'
let nextNotificationId = 0

export function showAppError(
  error: unknown,
  fallbackMessage: string,
  options: { title?: string; action?: { label: string; onClick: () => void } } = {},
) {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message
        : ''
  window.dispatchEvent(new CustomEvent<AppNotification>(NOTIFICATION_EVENT, {
    detail: {
      id: ++nextNotificationId,
      title: options.title ?? 'Action could not be completed',
      message,
      fallbackMessage,
      action: options.action,
    },
  }))
}
