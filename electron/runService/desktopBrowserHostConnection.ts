import type { BrowserHostRequest, BrowserHostResponse } from './browserService'
import type { TideCodeRunServiceClient } from './client'

type DesktopBrowserHandler = (request: BrowserHostRequest, signal?: AbortSignal) => Promise<BrowserHostResponse>
let desktopHandler: DesktopBrowserHandler | null = null
const registrations = new WeakMap<TideCodeRunServiceClient, Promise<void>>()

export function configureDesktopBrowserHost(handler: DesktopBrowserHandler | null) {
  desktopHandler = handler
}

/** Attach the Electron host after handshake, and reattach when a new service connection is established. */
export async function registerDesktopBrowserHostIfConfigured(client: TideCodeRunServiceClient) {
  if (!desktopHandler) return
  const existing = registrations.get(client)
  if (existing) return existing
  const active = new Map<string, AbortController>()
  const unsubscribeCancel = client.onBrowserCancel((id) => active.get(id)?.abort())
  const unsubscribe = client.onBrowserRequest(({ requestId, input }) => {
    const controller = new AbortController()
    active.set(requestId, controller)
    const handler = desktopHandler
    void (async () => {
      try {
        if (!handler) throw new Error('TideCode Desktop is shutting down.')
        if (controller.signal.aborted) throw new Error('Browser operation cancelled.')
        const result = await handler(input, controller.signal)
        await client.replyBrowserHost({ requestId, ok: true, result })
      } catch (error) {
        await client.replyBrowserHost({
          requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined)
      }
    })().finally(() => active.delete(requestId))
  })
  const unsubscribeDisconnect = client.onDisconnect(() => {
    for (const controller of active.values()) controller.abort()
    active.clear()
    unsubscribe()
    unsubscribeCancel()
    unsubscribeDisconnect()
    registrations.delete(client)
  })
  const pending = client.registerBrowserHost().catch((error) => {
    unsubscribe()
    unsubscribeCancel()
    unsubscribeDisconnect()
    for (const controller of active.values()) controller.abort()
    registrations.delete(client)
    throw error
  })
  registrations.set(client, pending)
  return pending
}
