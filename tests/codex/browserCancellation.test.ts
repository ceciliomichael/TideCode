import assert from 'node:assert/strict'
import test from 'node:test'
import type { Socket } from 'node:net'
import { RunServiceBrowserBroker } from '../../electron/runService/browserBroker'
import { AgentBrowserOperation } from '../../electron/browser/agentBrowserOperation'

function host() {
  const messages: Array<{ type: string; requestId: string }> = []
  const socket = {
    destroyed: false,
    write: (data: string) => { messages.push(JSON.parse(data)); return true },
  } as unknown as Socket
  return { socket, messages }
}

test('aborting a broker request notifies the desktop and rejects without awaiting its reply', async () => {
  const broker = new RunServiceBrowserBroker(10000)
  const { socket, messages } = host()
  broker.register(socket)
  const controller = new AbortController()
  const pending = broker.request({ operation: 'tabs', projectPath: 'C:/workspace', page: 1 }, controller.signal)
  assert.equal(messages[0].type, 'browser_request')
  controller.abort()
  await assert.rejects(pending, /cancelled/u)
  assert.deepEqual(messages.map((message) => message.type), ['browser_request', 'browser_cancel'])
  assert.equal(messages[0].requestId, messages[1].requestId)
  broker.receive(socket, { requestId: messages[0].requestId, ok: true, result: { data: {} } })
  broker.close()
})

test('a pre-cancelled browser request is never sent to the desktop', async () => {
  const broker = new RunServiceBrowserBroker()
  const { socket, messages } = host()
  broker.register(socket)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(broker.request({ operation: 'tabs', projectPath: 'C:/workspace', page: 1 }, controller.signal), /cancelled/u)
  assert.equal(messages.length, 0)
  broker.close()
})

test('abort interrupts an active Chromium command and prevents subsequent commands', async () => {
  const controller = new AbortController()
  const operation = new AgentBrowserOperation(10000, controller.signal)
  let detached = false
  const pending = operation.run('test Chrome command', () => new Promise<void>(() => {}), () => { detached = true })
  controller.abort()
  await assert.rejects(pending, /cancelled/u)
  assert.equal(detached, true)
  await assert.rejects(operation.run('subsequent action', async () => {}, () => {}), /cancelled/u)
})
