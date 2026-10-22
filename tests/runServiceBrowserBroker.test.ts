import assert from 'node:assert/strict'
import { createServer, createConnection, type Socket } from 'node:net'
import test from 'node:test'
import { RunServiceBrowserBroker } from '../electron/runService/browserBroker'

test('browser broker forwards browser requests and accepts replies from the registered desktop socket', async () => {
  const broker = new RunServiceBrowserBroker()
  let host: Socket | null = null
  const server = createServer((socket) => {
    host = socket
    broker.register(socket)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const client = createConnection(address.port, '127.0.0.1')
  try {
    await new Promise<void>((resolve) => client.once('connect', resolve))
    assert.ok(host)
    const sent = new Promise<{ type: string; requestId: string; input: Record<string, unknown> }>((resolve) => {
      let pending = ''
      client.on('data', (bytes) => {
        pending += bytes.toString()
        const newline = pending.indexOf('\n')
        if (newline < 0) return
        const json = JSON.parse(pending.slice(0, newline))
        resolve(json)
      })
    })
    const resultPromise = broker.request({
      operation: 'tabs',
      projectPath: 'C:\\test-project',
      page: 1,
    })
    const request = await sent
    assert.equal(request.type, 'browser_request')
    assert.equal(request.input.operation, 'tabs')
    assert.equal(request.input.page, 1)
    broker.receive(host!, {
      requestId: request.requestId,
      ok: true,
      result: { data: { page: 1, total: 0, has_more: false, tabs: [] } },
    })
    assert.deepEqual((await resultPromise).data, { page: 1, total: 0, has_more: false, tabs: [] })
    const rejected = broker.request({ operation: 'tabs', projectPath: 'C:\\test-project', page: 2 })
    broker.disconnect(host!)
    await assert.rejects(rejected, /disconnected/)
    await assert.rejects(() => broker.request({
      operation: 'tabs', projectPath: 'C:\\test-project', page: 1,
    }), /connected desktop browser host/)
  } finally {
    broker.close()
    client.destroy()
    host?.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('browser broker rejects requests without a registered desktop', async () => {
  const broker = new RunServiceBrowserBroker()
  await assert.rejects(() => broker.request({
    operation: 'open',
    projectPath: 'C:\\test-project',
    url: 'https://example.com/',
  }), /connected desktop browser host/)
})

test('browser timeout identifies the request, ignores late replies and permits the next request', async () => {
  const messages: Array<{ requestId: string }> = []
  const host = {
    destroyed: false,
    write: (line: string) => { messages.push(JSON.parse(line)) },
  } as unknown as Socket
  const broker = new RunServiceBrowserBroker(20)
  broker.register(host)
  // Keep the process alive while the production broker uses an unref'ed timer.
  const keepAlive = setInterval(() => undefined, 100)
  try {
    await assert.rejects(broker.request({
      operation: 'read', projectPath: 'C:/test', tabId: 'slow-tab', view: 'combined',
      offset: 0, limit: 80, conversationId: null, includeAnnotations: false,
    }), /did not reply to read on tab slow-tab within 20ms/)
    broker.receive(host, { requestId: messages[0].requestId, ok: true, result: { data: { late: true } } })
    const next = broker.request({ operation: 'tabs', projectPath: 'C:/test', page: 1 })
    broker.receive(host, { requestId: messages[1].requestId, ok: true, result: { data: { total: 0 } } })
    assert.deepEqual(await next, { data: { total: 0 } })
  } finally {
    clearInterval(keepAlive)
    broker.close()
  }
})
