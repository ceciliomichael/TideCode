import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { RemoteWorkspaceHost } from '../electron/remote/host'
import { readRemoteConfiguration, writeRemoteConfiguration } from '../electron/remote/configStore'

function listen(server: Server, port: number) {
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '0.0.0.0', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to resolve the test port.'))
        return
      }
      resolve(address.port)
    })
  })
}

function close(server: Server) {
  return new Promise<void>((resolve) => server.close(() => resolve()))
}

async function occupyPortWithFreeSuccessor() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const blocker = createServer()
    const preferredPort = await listen(blocker, 0)
    if (preferredPort >= 65_535) {
      await close(blocker)
      continue
    }

    const probe = createServer()
    try {
      await listen(probe, preferredPort + 1)
      await close(probe)
      return { blocker, preferredPort }
    } catch {
      if (probe.listening) await close(probe)
      await close(blocker)
    }
  }

  throw new Error('Unable to reserve an occupied port with a free successor for the test.')
}

test('Remote host increments and persists the port when the configured port is occupied', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-remote-fallback-state-'))
  const rendererRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-remote-fallback-renderer-'))
  const { blocker, preferredPort } = await occupyPortWithFreeSuccessor()
  process.env.TIDECODE_REMOTE_STATE_HOME = stateRoot
  await writeRemoteConfiguration({ port: preferredPort, webAuthEnabled: false, webUsername: '' })

  const host = new RemoteWorkspaceHost({ getWindow: () => null, rendererDist: rendererRoot })
  try {
    const status = await host.start()
    assert.equal(status.lifecycleState, 'running')
    assert.ok(status.boundPort !== null && status.boundPort > preferredPort)
    assert.equal(status.configuredPort, status.boundPort)
    assert.equal((await host.getConfiguration()).port, status.boundPort)
    assert.equal((await readRemoteConfiguration()).port, status.boundPort)
  } finally {
    await host.stop().catch(() => undefined)
    await close(blocker).catch(() => undefined)
    delete process.env.TIDECODE_REMOTE_STATE_HOME
    await fs.rm(stateRoot, { recursive: true, force: true })
    await fs.rm(rendererRoot, { recursive: true, force: true })
  }
})
