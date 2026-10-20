import type { BrowserHostRequest, BrowserHostResponse } from './browserService'
import type { TideCodeRunServiceClient } from './client'

type DesktopBrowserHandler = (request: BrowserHostRequest) => Promise<BrowserHostResponse>
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
  const unsubscribe = client.onBrowserRequest(({ requestId, input }) => {
    const handler = desktopHandler
    void (async () => {
      try {
        if (!handler) throw new Error('TideCode Desktop is shutting down.')
        const result = await handler(input)
        await client.replyBrowserHost({ requestId, ok: true, result })
      } catch (error) {
        await client.replyBrowserHost({
          requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined)
      }
    })()
  })
  const pending = client.registerBrowserHost().catch((error) => {
    unsubscribe()
    registrations.delete(client)
    throw error
  })
  registrations.set(client, pending)
  return pending
}
