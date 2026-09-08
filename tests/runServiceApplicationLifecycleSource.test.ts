import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import test from 'node:test'

test('desktop quit disconnects from the shared run service without shutting it down', async () => {
  const [mainSource, ensureServiceSource] = await Promise.all([
    fs.readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
    fs.readFile(new URL('../electron/runService/ensureService.ts', import.meta.url), 'utf8'),
  ])

  assert.match(mainSource, /disconnectRunServiceForApplication\(\)/u)
  assert.doesNotMatch(mainSource, /shutdownRunServiceForApplication\(\)/u)
  assert.match(ensureServiceSource, /export async function disconnectRunServiceForApplication\(\)/u)
  assert.match(ensureServiceSource, /client\.close\(\)/u)
  assert.doesNotMatch(ensureServiceSource, /client\.shutdown\(\)/u)
  assert.doesNotMatch(ensureServiceSource, /taskkill/u)
})
