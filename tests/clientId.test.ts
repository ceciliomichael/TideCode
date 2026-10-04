import assert from 'node:assert/strict'
import test from 'node:test'
import { createClientId } from '../src/lib/clientId'

test('createClientId works when crypto.randomUUID is unavailable', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  const fakeCrypto = {
    getRandomValues(bytes: Uint8Array) {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = index + 1
      }
      return bytes
    },
  }

  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: fakeCrypto,
  })

  try {
    assert.equal(createClientId(), '01020304-0506-4708-890a-0b0c0d0e0f10')
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, 'crypto', descriptor)
    } else {
      delete (globalThis as { crypto?: unknown }).crypto
    }
  }
})
