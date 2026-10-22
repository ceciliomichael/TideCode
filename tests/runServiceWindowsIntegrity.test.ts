import assert from 'node:assert/strict'
import test from 'node:test'
import childProcess from 'node:child_process'
import net from 'node:net'
import { syncBuiltinESMExports } from 'node:module'
import { configureTideCodeRuntimeRoot } from '../electron/runtime/runtimeRoot'
import { ensureRunServiceClient, resetRunServiceClientForTests } from '../electron/runService/ensureService'
import {
  getWindowsIntegrityLevel,
  parseWindowsIntegrityLevel,
  readWindowsIntegrityLevel,
} from '../electron/runService/windowsIntegrity'

test('Windows integrity detection uses the SID rather than localized group names', () => {
  assert.equal(parseWindowsIntegrityLevel('"Localized medium label","Label","S-1-16-8192",""\r\n'), 8192)
  assert.equal(parseWindowsIntegrityLevel('"Localized high label","Label","S-1-16-12288",""\r\n'), 12288)
})

test('missing, ambiguous and invalid integrity identities cannot select a shared endpoint', () => {
  for (const output of [
    '"Administrators","Alias","S-1-5-32-544",""',
    '"S-1-16-8192"\n"S-1-16-12288"',
    '"S-1-16-999999999999999999999999999"',
  ]) {
    assert.throws(() => parseWindowsIntegrityLevel(output), /Windows security level/u)
  }
})

test('failed Windows identity queries produce an actionable error with the original cause', () => {
  const queryError = Object.assign(new Error('query denied'), { code: 'EACCES' })
  assert.throws(() => readWindowsIntegrityLevel(() => {
    throw queryError
  }), (error: unknown) => {
    assert.match((error as Error).message, /whoami\.exe.*restart TideCode/u)
    assert.equal((error as Error & { cause: unknown }).cause, queryError)
    return true
  })
})

test('the live Windows process has a stable integrity identity', { skip: process.platform !== 'win32' }, () => {
  const integrityLevel = getWindowsIntegrityLevel()
  assert.equal(integrityLevel, readWindowsIntegrityLevel())
  assert.equal(getWindowsIntegrityLevel(), integrityLevel)
})

test('denied Windows service connections fail before spawning or retrying a competing service', { skip: process.platform !== 'win32' }, async (t) => {
  const previousRoot = process.env.TIDECODE_RUNTIME_ROOT
  const previousNamespace = process.env.TIDECODE_RUN_SERVICE_NAMESPACE
  configureTideCodeRuntimeRoot(process.cwd())
  process.env.TIDECODE_RUN_SERVICE_NAMESPACE = 'dev-03d7e7709bc2ca22'
  resetRunServiceClientForTests()
  t.after(() => {
    t.mock.restoreAll()
    syncBuiltinESMExports()
    resetRunServiceClientForTests()
    for (const [key, value] of [
      ['TIDECODE_RUNTIME_ROOT', previousRoot],
      ['TIDECODE_RUN_SERVICE_NAMESPACE', previousNamespace],
    ]) {
      if (value === undefined) {
        delete process.env[key!]
      } else {
        process.env[key!] = value
      }
    }
  })

  let deniedCode = 'EPERM'
  const connect = t.mock.method(net, 'createConnection', () => {
    const socket = new net.Socket()
    process.nextTick(() => {
      socket.emit('error', Object.assign(new Error('access denied'), { code: deniedCode, syscall: 'connect' }))
    })
    return socket
  })
  const spawn = t.mock.method(childProcess, 'spawn', () => {
    throw new Error('Access denial must not launch a competing service.')
  })
  syncBuiltinESMExports()

  for (const code of ['EPERM', 'EACCES']) {
    deniedCode = code
    await assert.rejects(ensureRunServiceClient(), /Windows denied access.*same Windows security level/u)
  }
  assert.equal(connect.mock.callCount(), 2)
  assert.equal(spawn.mock.callCount(), 0)
})
