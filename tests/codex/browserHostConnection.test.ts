import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import type { TideCodeRunServiceClient } from '../../electron/runService/client'
import type { BrowserHostRequest } from '../../electron/runService/browserService'
import {
  configureDesktopBrowserHost,
  registerDesktopBrowserHostIfConfigured,
} from '../../electron/runService/desktopBrowserHostConnection'

function fakeClient() {
  let requestListener: ((request: { requestId: string; input: BrowserHostRequest }) => void) | undefined
  let cancelListener: ((id: string) => void) | undefined
  let disconnectListener: (() => void) | undefined
  const replies: Array<{ requestId: string; ok: boolean; error?: string }> = []
  const client = {
    onBrowserRequest: (listener: typeof requestListener) => {
      requestListener = listener
      return () => { requestListener = undefined }
    },
    onBrowserCancel: (listener: typeof cancelListener) => {
      cancelListener = listener
      return () => { cancelListener = undefined }
    },
    onDisconnect: (listener: typeof disconnectListener) => {
      disconnectListener = listener
      return () => { disconnectListener = undefined }
    },
    registerBrowserHost: async () => {},
    replyBrowserHost: async (reply: { requestId: string; ok: boolean; error?: string }) => {
      replies.push(reply)
    },
  } as unknown as TideCodeRunServiceClient
  return {
    client, replies,
    request: (id: string) => requestListener?.({
      requestId: id,
      input: { operation: 'tabs', projectPath: 'C:/workspace', page: 1 },
    }),
    cancel: (id: string) => cancelListener?.(id),
    disconnect: () => disconnectListener?.(),
  }
}

test('desktop broker cancellation aborts the corresponding active host request', async () => {
  const fixture = fakeClient()
  let stopped = false
  configureDesktopBrowserHost(async (_request, signal) => {
    await new Promise<void>((_resolve, reject) => {
      signal?.addEventListener('abort', () => {
        stopped = true
        reject(new Error('Browser operation cancelled.'))
      }, { once: true })
    })
    return { data: {} }
  })
  try {
    await registerDesktopBrowserHostIfConfigured(fixture.client)
    fixture.request('request-one')
    fixture.cancel('request-one')
    await setImmediate()
    assert.equal(stopped, true)
    assert.equal(fixture.replies[0]?.ok, false)
    assert.match(fixture.replies[0]?.error ?? '', /cancelled/u)
  } finally {
    fixture.disconnect()
    configureDesktopBrowserHost(null)
  }
})

test('desktop host disconnect aborts still-running browser requests', async () => {
  const fixture = fakeClient()
  let stopped = false
  configureDesktopBrowserHost(async (_request, signal) => {
    await new Promise<void>((_resolve, reject) => {
      signal?.addEventListener('abort', () => {
        stopped = true
        reject(new Error('Browser operation cancelled.'))
      }, { once: true })
    })
    return { data: {} }
  })
  try {
    await registerDesktopBrowserHostIfConfigured(fixture.client)
    fixture.request('request-two')
    fixture.disconnect()
    await setImmediate()
    assert.equal(stopped, true)
  } finally {
    configureDesktopBrowserHost(null)
  }
})
