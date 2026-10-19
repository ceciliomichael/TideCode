import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import { build } from 'esbuild'
import type { BrowserPrivateTab } from '../../../src/types/browser'

const compiled = await build({
  stdin: {
    contents: `export * from '../../../electron/browser/sessions'`,
    resolveDir: import.meta.dirname,
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
})

function fixture() {
  const sessions = new Map<string, ReturnType<typeof makeSession>>()
  function makeSession(partition: string) {
    return {
      partition,
      storage: new Map<string, string>(),
      cache: new Map<string, string>(),
      connectionsClosed: false,
      isPersistent: () => partition.startsWith('persist:'),
      async clearStorageData() {
        this.storage.clear()
      },
      async clearCache() {
        this.cache.clear()
      },
      async closeAllConnections() {
        this.connectionsClosed = true
      },
    }
  }
  const nativeSession = {
    fromPartition(partition: string, options?: { cache: boolean }) {
      let entry = sessions.get(partition)
      if (!entry) {
        entry = makeSession(partition)
        sessions.set(partition, entry)
        if (!partition.startsWith('persist:')) {
          assert.equal(options?.cache, false)
        }
      }
      return entry
    },
  }
  const module = {
    exports: {} as {
      createIncognitoTab: (
        owner: unknown,
        projectKey: string,
      ) => BrowserPrivateTab
      releaseIncognitoTab: (ownerId: number, tabId: string) => Promise<void>
      resolveBrowserSession: (
        ownerId: number,
        partition: string,
      ) => ReturnType<typeof makeSession>
      ownsBrowserSession: (ownerId: number, browserSession: unknown) => boolean
      trackPrivateBrowserGuest: (guest: unknown) => void
    },
  }
  const require = createRequire(import.meta.url)
  vm.runInThisContext(
    `(function(module, require) { ${compiled.outputFiles[0].text}\n })`,
  )(module, (name: string) => {
    if (name === 'electron') {
      return { session: nativeSession }
    }
    return require(name)
  })
  const owner = Object.assign(new EventEmitter(), { id: 11 })
  return { api: module.exports, owner, sessions, nativeSession }
}

test('incognito tabs share only their owner/project memory session and closing the last tab clears it', async () => {
  const { api, owner, sessions, nativeSession } = fixture()
  const normal = nativeSession.fromPartition('persist:tidecode-browser')
  normal.storage.set('login', 'normal')
  const first = api.createIncognitoTab(owner, 'project')
  const second = api.createIncognitoTab(owner, 'project')
  const otherProject = api.createIncognitoTab(owner, 'other-project')
  const otherOwner = api.createIncognitoTab(
    Object.assign(new EventEmitter(), { id: 22 }),
    'project',
  )
  const privateSession = sessions.get(first.partition)!
  assert.equal(first.partition, second.partition)
  assert.notEqual(first.partition, otherProject.partition)
  assert.notEqual(first.partition, otherOwner.partition)
  assert.equal(privateSession.isPersistent(), false)
  assert.equal(privateSession.storage.get('login'), undefined)
  assert.equal(api.ownsBrowserSession(owner.id, privateSession), true)
  assert.equal(api.ownsBrowserSession(22, privateSession), false)
  privateSession.storage.set('login', 'private')
  privateSession.cache.set('page', 'private bytes')
  await assert.rejects(
    () => api.releaseIncognitoTab(22, first.tabId),
    /no longer available/,
  )
  await api.releaseIncognitoTab(owner.id, first.tabId)
  assert.equal(privateSession.storage.get('login'), 'private')

  let destroyed = false
  const guest = Object.assign(new EventEmitter(), {
    session: privateSession,
    hostWebContents: owner,
    isDestroyed: () => destroyed,
  })
  api.trackPrivateBrowserGuest(guest)
  const closed = api.releaseIncognitoTab(owner.id, second.tabId)
  assert.throws(
    () => api.resolveBrowserSession(owner.id, first.partition),
    /no longer available/,
  )
  // Cleanup waits for the guest, so its final unload writes cannot survive.
  privateSession.storage.set('unload', 'late write')
  destroyed = true
  guest.emit('destroyed')
  await closed
  assert.equal(privateSession.storage.size, 0)
  assert.equal(privateSession.cache.size, 0)
  assert.equal(privateSession.connectionsClosed, true)
  assert.equal(normal.storage.get('login'), 'normal')
  const fresh = api.createIncognitoTab(owner, 'project')
  assert.notEqual(fresh.partition, first.partition)
})

test('renderer navigation and destruction revoke private sessions without affecting normal storage', async () => {
  const { api, owner, sessions } = fixture()
  const first = api.createIncognitoTab(owner, 'project')
  const privateSession = sessions.get(first.partition)!
  privateSession.storage.set('private', 'value')
  owner.emit('did-start-navigation', {}, 'app://reload', false, true)
  assert.throws(
    () => api.resolveBrowserSession(owner.id, first.partition),
    /no longer available/,
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(privateSession.storage.size, 0)
  const second = api.createIncognitoTab(owner, 'project')
  const nextSession = sessions.get(second.partition)!
  nextSession.storage.set('private', 'next')
  owner.emit('destroyed')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(nextSession.storage.size, 0)
  assert.equal(api.ownsBrowserSession(owner.id, nextSession), false)
})
