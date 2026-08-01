import { Buffer } from 'node:buffer'
import type { ModelMessage } from 'ai'
import { REPLAY_CODEC_SCHEMA, type EncodedReplayValue } from './contracts'

const TYPE_KEY = '__tidecodeReplayType'

function encodeValue(value: unknown, seen: WeakSet<object>): EncodedReplayValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value)
  }

  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return undefined
  }

  if (value instanceof Uint8Array) {
    return {
      [TYPE_KEY]: 'uint8array',
      data: Buffer.from(value).toString('base64'),
      schema: REPLAY_CODEC_SCHEMA,
    }
  }

  if (value instanceof URL) {
    return {
      [TYPE_KEY]: 'url',
      data: value.toString(),
      schema: REPLAY_CODEC_SCHEMA,
    }
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const encoded = encodeValue(item, seen)
      return encoded === undefined ? [] : [encoded]
    })
  }

  if (typeof value !== 'object') {
    return String(value)
  }

  if (seen.has(value)) {
    throw new Error('Cannot persist cyclic provider replay metadata.')
  }

  seen.add(value)
  const encodedObject: Record<string, EncodedReplayValue> = {}
  for (const [key, item] of Object.entries(value)) {
    const encoded = encodeValue(item, seen)
    if (encoded !== undefined) {
      encodedObject[key] = encoded
    }
  }
  seen.delete(value)
  return encodedObject
}

function decodeValue(value: EncodedReplayValue): unknown {
  if (value === null || typeof value !== 'object') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(decodeValue)
  }

  if (value[TYPE_KEY] === 'uint8array' && typeof value.data === 'string') {
    return new Uint8Array(Buffer.from(value.data, 'base64'))
  }

  if (value[TYPE_KEY] === 'url' && typeof value.data === 'string') {
    return new URL(value.data)
  }

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeValue(item)]))
}

export function encodeReplayValue(value: unknown): EncodedReplayValue {
  const encoded = encodeValue(value, new WeakSet())
  return encoded ?? null
}

export function decodeReplayValue(value: EncodedReplayValue): unknown {
  return decodeValue(value)
}

export function encodeModelMessages(messages: ModelMessage[]) {
  return encodeReplayValue(messages)
}

export function decodeModelMessages(value: EncodedReplayValue): ModelMessage[] {
  const decoded = decodeReplayValue(value)
  if (!Array.isArray(decoded)) {
    throw new Error('Canonical replay messages must be an array.')
  }

  for (const message of decoded) {
    if (!message || typeof message !== 'object') {
      throw new Error('Canonical replay contains an invalid message.')
    }

    const role = (message as { role?: unknown }).role
    if (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'tool') {
      throw new Error('Canonical replay contains an unsupported message role.')
    }
  }

  return decoded as ModelMessage[]
}
