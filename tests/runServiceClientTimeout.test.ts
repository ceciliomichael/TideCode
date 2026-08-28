import assert from 'node:assert/strict'
import test from 'node:test'
import { TideCodeRunServiceClient } from '../electron/runService/client'

function attachFakeSocket(client: TideCodeRunServiceClient) {
  const writes: string[] = []
  const socket = {
    destroyed: false,
    write: (value: string) => {
      writes.push(value)
      return true
    },
  }
  const internals = client as unknown as {
    buffered: string
    handleData: (chunk: string) => void
    pending: Map<string, unknown>
    requestRaw: <T>(method: string, params?: unknown, timeoutMs?: number) => Promise<T>
    socket: typeof socket
  }
  internals.socket = socket
  return { internals, writes }
}

test('run-service request timeouts remove their pending request entry', async () => {
  const client = new TideCodeRunServiceClient()
  const { internals } = attachFakeSocket(client)

  await assert.rejects(
    internals.requestRaw('hello', undefined, 10),
    /request "hello" timed out after 10ms/u,
  )
  assert.equal(internals.pending.size, 0)
})

test('run-service responses clear a request timeout before it can fire', async () => {
  const client = new TideCodeRunServiceClient()
  const { internals, writes } = attachFakeSocket(client)
  const request = internals.requestRaw<{ ok: boolean }>('probe', undefined, 50)
  const wireRequest = JSON.parse(writes[0]) as { id: string }

  internals.handleData(JSON.stringify({ id: wireRequest.id, ok: true, result: { ok: true } }) + '\n')
  assert.deepEqual(await request, { ok: true })
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(internals.pending.size, 0)
})
