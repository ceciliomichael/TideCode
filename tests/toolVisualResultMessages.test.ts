import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import { estimateModelMessageContextUsage } from '../src/lib/contextUsage'
import {
  createEphemeralToolVisualMessages,
  externalizeVisualToolResultMessages,
  isEphemeralToolVisualMessage,
  stripEphemeralToolVisualMessages,
  stripVisualToolResultFiles,
} from '../electron/chat/shared/toolVisualResultMessages'

function visualToolMessage(imageData: Buffer = Buffer.from([1, 2, 3])): ModelMessage {
  return {
    role: 'tool',
    content: [{
      type: 'tool-result',
      toolCallId: 'call-1',
      toolName: 'code_mode',
      output: {
        type: 'content',
        value: [
          { type: 'text', text: 'Read image @attachments/example.png' },
          {
            type: 'file',
            data: { type: 'data', data: imageData },
            filename: 'example.png',
            mediaType: 'image/png',
          },
        ],
      },
    }],
  }
}

test('visual tool results are moved to ephemeral user image context', () => {
  const projection = externalizeVisualToolResultMessages([visualToolMessage()])
  assert.equal(projection.changed, true)
  assert.equal(projection.messages.length, 2)
  assert.equal(projection.messages[0]?.role, 'tool')
  assert.equal(projection.messages[1]?.role, 'user')
  assert.equal(isEphemeralToolVisualMessage(projection.messages[1]!), true)

  const visualMessage = projection.messages[1]
  assert.ok(visualMessage?.role === 'user' && Array.isArray(visualMessage.content))
  const filePart = visualMessage.content.find((part) => part.type === 'file')
  assert.ok(filePart?.type === 'file')
  assert.deepEqual(filePart.data, {
    type: 'data',
    data: Buffer.from([1, 2, 3]).toString('base64'),
  })

  const serializedToolMessage = JSON.stringify(projection.messages[0])
  assert.doesNotMatch(serializedToolMessage, /"data":\{"type":"data"/u)
  assert.match(serializedToolMessage, /Read image @attachments\/example\.png/u)
})

test('ephemeral visual messages are excluded from durable replay', () => {
  const projection = externalizeVisualToolResultMessages([visualToolMessage()])
  const durable = stripEphemeralToolVisualMessages(projection.messages)
  assert.equal(durable.length, 1)
  assert.equal(durable[0]?.role, 'tool')
  assert.equal(JSON.stringify(durable).includes('"type":"file"'), false)
})

test('visual projection is idempotent after tool output has been sanitized', () => {
  const first = externalizeVisualToolResultMessages([visualToolMessage()])
  const second = externalizeVisualToolResultMessages(first.messages)
  assert.equal(second.changed, false)
  assert.equal(second.messages.length, 2)
})

test('multi-megabyte visual payloads never become durable text or context-token explosions', () => {
  const projection = externalizeVisualToolResultMessages([
    visualToolMessage(Buffer.alloc(4 * 1024 * 1024, 255)),
  ])
  const durable = stripEphemeralToolVisualMessages(projection.messages)

  assert.ok(JSON.stringify(durable).length < 2_000)
  const usage = estimateModelMessageContextUsage(projection.messages)
  assert.ok(usage.totalTokens < 5_000)

  const ephemeral = projection.messages.find(isEphemeralToolVisualMessage)
  assert.ok(ephemeral?.role === 'user' && Array.isArray(ephemeral.content))
  const filePart = ephemeral.content.find((part) => part.type === 'file')
  assert.ok(filePart?.type === 'file')
  assert.equal(typeof (filePart.data as { data?: unknown }).data, 'string')
  assert.doesNotMatch(JSON.stringify(filePart.data), /"type":"Buffer"/u)
})

test('persisted replay sanitization drops old visual tool bytes without re-injecting an image', () => {
  const sanitized = stripVisualToolResultFiles([
    visualToolMessage(Buffer.alloc(2 * 1024 * 1024, 7)),
  ])

  assert.equal(sanitized.length, 1)
  assert.equal(sanitized[0]?.role, 'tool')
  assert.ok(JSON.stringify(sanitized).length < 2_000)
})

test('captured read image output becomes ordinary ephemeral image input without a tool result', () => {
  const messages = createEphemeralToolVisualMessages([{
    type: 'content',
    value: [
      { type: 'text', text: '[Image #1]\nFile: @attachments/example.png' },
      {
        type: 'file',
        data: { type: 'data', data: Buffer.from([1, 2, 3, 4]) },
        filename: 'example.png',
        mediaType: 'image/png',
      },
    ],
  }])

  assert.equal(messages.length, 1)
  assert.equal(messages[0]?.role, 'user')
  assert.ok(messages[0]?.role === 'user' && Array.isArray(messages[0].content))
  assert.equal(messages[0].content.some((part) => part.type === 'tool-result'), false)
  const filePart = messages[0].content.find((part) => part.type === 'file')
  assert.ok(filePart?.type === 'file')
  assert.deepEqual(filePart.data, {
    type: 'data',
    data: Buffer.from([1, 2, 3, 4]).toString('base64'),
  })
})
