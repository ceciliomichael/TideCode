import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  API_KEY_HANDOFF_STALE_FILE_MS,
  API_KEY_HANDOFF_TTL_MS,
  cleanupExpiredApiKeyHandoffs,
  consumeApiKeyHandoff,
  createApiKeyHandoff,
} from '../../electron/cli/apiKeyHandoff'

function getHandoffDirectory(homeDirectory: string) {
  return path.join(homeDirectory, '.tidecode', 'config', 'cli-api-key-handoffs')
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

test('API-key handoffs are consumed once and removed from shared storage', async () => {
  const homeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-api-key-handoff-'))
  try {
    const token = await createApiKeyHandoff('sk-one-shot', {
      homeDirectory,
      now: () => 10_000,
      platform: 'linux',
    })

    assert.equal(await consumeApiKeyHandoff(token, { homeDirectory, now: () => 10_001 }), 'sk-one-shot')
    assert.equal(await consumeApiKeyHandoff(token, { homeDirectory, now: () => 10_002 }), null)
  } finally {
    await fs.rm(homeDirectory, { recursive: true, force: true })
  }
})

test('expired API-key handoffs cannot be consumed', async () => {
  const homeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-api-key-handoff-expired-'))
  try {
    const token = await createApiKeyHandoff('sk-expired', {
      homeDirectory,
      now: () => 20_000,
      platform: 'linux',
    })

    assert.equal(
      await consumeApiKeyHandoff(token, {
        homeDirectory,
        now: () => 20_000 + API_KEY_HANDOFF_TTL_MS + 1,
      }),
      null,
    )
  } finally {
    await fs.rm(homeDirectory, { recursive: true, force: true })
  }
})

test('cleanup removes expired handoffs while preserving fresh ones', async () => {
  const homeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-api-key-handoff-cleanup-'))
  try {
    const createdAt = 50_000
    const expiredToken = await createApiKeyHandoff('sk-expired-cleanup', {
      homeDirectory,
      now: () => createdAt,
      platform: 'linux',
    })
    const freshToken = await createApiKeyHandoff('sk-fresh-cleanup', {
      homeDirectory,
      now: () => createdAt + API_KEY_HANDOFF_TTL_MS,
      platform: 'linux',
    })

    await cleanupExpiredApiKeyHandoffs({
      homeDirectory,
      now: () => createdAt + API_KEY_HANDOFF_TTL_MS + 1,
    })

    const directoryPath = getHandoffDirectory(homeDirectory)
    assert.equal(await pathExists(path.join(directoryPath, `${expiredToken}.json`)), false)
    assert.equal(await pathExists(path.join(directoryPath, `${freshToken}.json`)), true)
  } finally {
    await fs.rm(homeDirectory, { recursive: true, force: true })
  }
})

test('cleanup removes malformed old files and stale consuming remnants but keeps fresh malformed files', async () => {
  const homeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-api-key-handoff-stale-'))
  try {
    const directoryPath = getHandoffDirectory(homeDirectory)
    await fs.mkdir(directoryPath, { recursive: true })

    const oldToken = 'a'.repeat(43)
    const freshToken = 'b'.repeat(43)
    const consumingToken = 'c'.repeat(43)
    const oldMalformedPath = path.join(directoryPath, `${oldToken}.json`)
    const freshMalformedPath = path.join(directoryPath, `${freshToken}.json`)
    const consumingPath = path.join(directoryPath, `${consumingToken}.json.consuming-123-${'d'.repeat(24)}`)
    await Promise.all([
      fs.writeFile(oldMalformedPath, '{bad-json', 'utf8'),
      fs.writeFile(freshMalformedPath, '{bad-json', 'utf8'),
      fs.writeFile(consumingPath, '{bad-json', 'utf8'),
    ])

    const nowMs = 1_000_000
    const staleDate = new Date(nowMs - API_KEY_HANDOFF_STALE_FILE_MS - 1)
    const freshDate = new Date(nowMs)
    await Promise.all([
      fs.utimes(oldMalformedPath, staleDate, staleDate),
      fs.utimes(freshMalformedPath, freshDate, freshDate),
      fs.utimes(consumingPath, staleDate, staleDate),
    ])

    await cleanupExpiredApiKeyHandoffs({ homeDirectory, now: () => nowMs })

    assert.equal(await pathExists(oldMalformedPath), false)
    assert.equal(await pathExists(freshMalformedPath), true)
    assert.equal(await pathExists(consumingPath), false)
  } finally {
    await fs.rm(homeDirectory, { recursive: true, force: true })
  }
})
