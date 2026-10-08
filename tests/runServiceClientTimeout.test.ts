import assert from 'node:assert/strict'
import test from 'node:test'
import net from 'node:net'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { TideCodeRunServiceClient } from '../electron/runService/client'
import { getRunServiceEndpoint, ensureRunServiceDirectory } from '../electron/runService/paths'

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

test('disconnect clears partial response data, process identity, requests, and their timers', async () => {
  const client = new TideCodeRunServiceClient()
  const { internals } = attachFakeSocket(client)
  const cleanup = internals as unknown as {
    handleDisconnect: (error: Error) => void
    serviceProcessId: number | null
  }
  internals.buffered = 'a partial large response'
  cleanup.serviceProcessId = 123
  const request = internals.requestRaw('probe', undefined, 1_000)
  cleanup.handleDisconnect(new Error('connection lost'))
  await assert.rejects(request, /connection lost/)
  assert.equal(internals.buffered, '')
  assert.equal(internals.pending.size, 0)
  assert.equal(client.processId, null)
})

test('failed hello handshake destroys its socket and releases an incomplete receive buffer', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-handshake-'))
  const previousHome = process.env.USERPROFILE
  const previousUnixHome = process.env.HOME
  const previousNamespace = process.env.TIDECODE_RUN_SERVICE_NAMESPACE
  process.env.USERPROFILE = directory
  process.env.HOME = directory
  process.env.TIDECODE_RUN_SERVICE_NAMESPACE = `test-${randomUUID()}`
  const connections = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    connections.add(socket)
    socket.on('data', () => socket.write('{"partialResponse":'))
    socket.on('close', () => connections.delete(socket))
  })
  const client = new TideCodeRunServiceClient()
  t.after(async () => {
    client.close()
    for (const socket of connections) {
      socket.destroy()
    }
    await new Promise<void>((resolve) => server.close(() => resolve()))
    for (const [name, value] of [['USERPROFILE', previousHome], ['HOME', previousUnixHome], ['TIDECODE_RUN_SERVICE_NAMESPACE', previousNamespace]]) {
      if (value === undefined) {
        delete process.env[name!]
      } else {
        process.env[name!] = value
      }
    }
    await fs.rm(directory, { recursive: true, force: true })
  })
  await ensureRunServiceDirectory()
  await new Promise<void>((resolve) => server.listen(getRunServiceEndpoint(), resolve))
  await assert.rejects(client.connect(), /hello.*timed out/)
  const internals = client as unknown as { socket: net.Socket | null; buffered: string; pending: Map<string, unknown> }
  assert.equal(internals.socket, null)
  assert.equal(internals.buffered, '')
  assert.equal(internals.pending.size, 0)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(connections.size, 0)
})
