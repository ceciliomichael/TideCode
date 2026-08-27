import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CodexRequestNormalizationError,
  normalizeCodexRequestBody,
} from '../../electron/chat/codex/requestNormalization'

function parseBody(body: string) {
  return JSON.parse(body) as { input?: Array<Record<string, unknown>>; max_output_tokens?: unknown }
}

test('keeps Responses function-call arguments as JSON strings for Codex', () => {
  const normalized = parseBody(
    normalizeCodexRequestBody(
      JSON.stringify({
        input: [
          {
            type: 'function_call',
            id: 'call_item-1',
            call_id: 'call_previous-provider-1',
            name: 'read_file',
            arguments: '{"path":"src/main.ts","line":12}',
          },
        ],
      }),
    ),
  )

  assert.equal(normalized.input?.[0]?.arguments, '{"path":"src/main.ts","line":12}')
  assert.equal(normalized.input?.[0]?.id, 'tsc_item-1')
  assert.equal(normalized.input?.[0]?.call_id, 'call_previous-provider-1')
})

test('preserves custom Code Mode calls without injecting function-call arguments', () => {
  const normalized = parseBody(
    normalizeCodexRequestBody(
      JSON.stringify({
        input: [
          { type: 'reasoning', id: 'rs_before-code-mode', summary: [] },
          { type: 'message', role: 'user', content: 'Continue.' },
          {
            type: 'custom_tool_call',
            id: 'ctc_code-mode-1',
            call_id: 'call_code-mode-1',
            name: 'code_mode',
            input: 'return await tools.read({ path: "AGENTS.md", full_file: true })',
            arguments: { should: 'be removed' },
          },
          {
            type: 'custom_tool_call_output',
            call_id: 'call_code-mode-1',
            output: 'Code Mode completed',
            arguments: { should: 'also be removed' },
          },
        ],
      }),
    ),
  )

  assert.deepEqual(normalized.input?.[2], {
    call_id: 'call_code-mode-1',
    id: 'ctc_code-mode-1',
    input: 'return await tools.read({ path: "AGENTS.md", full_file: true })',
    name: 'code_mode',
    type: 'custom_tool_call',
  })
  assert.deepEqual(normalized.input?.[3], {
    call_id: 'call_code-mode-1',
    output: 'Code Mode completed',
    type: 'custom_tool_call_output',
  })
})

test('converts legacy tool-call arguments to objects and defaults missing arguments to an object', () => {
  const normalized = parseBody(
    normalizeCodexRequestBody(
      JSON.stringify({
        input: [
          { type: 'tool_call', call_id: 'tsc_existing', name: 'list_files', arguments: '{"path":"."}' },
          { type: 'function', call_id: 'tsc_missing', name: 'list_files' },
        ],
      }),
    ),
  )

  assert.deepEqual(normalized.input?.[0]?.arguments, { path: '.' })
  assert.deepEqual(normalized.input?.[1]?.arguments, {})
})

test('preserves matching function-call outputs and strips only Codex-incompatible fields', () => {
  const normalized = parseBody(
    normalizeCodexRequestBody(
      JSON.stringify({
        max_output_tokens: 400,
        input: [
          {
            type: 'function_call',
            call_id: 'call_read-1',
            name: 'read_file',
            arguments: '{}',
          },
          {
            type: 'function_call_output',
            id: 'call_output-item-1',
            call_id: 'call_read-1',
            arguments: '{"should":"be removed"}',
            output: { status: 'done' },
          },
        ],
      }),
    ),
  )

  assert.equal(normalized.max_output_tokens, undefined)
  assert.equal(normalized.input?.[1]?.type, 'function_call_output')
  assert.deepEqual(normalized.input?.[1], {
    call_id: 'call_read-1',
    id: 'call_output-item-1',
    output: { status: 'done' },
    type: 'function_call_output',
  })
})

test('preserves reasoning IDs while normalizing only function-call IDs', () => {
  const normalized = parseBody(
    normalizeCodexRequestBody(
      JSON.stringify({
        input: [
          { type: 'reasoning', id: 'rs_reasoning-1', summary: [] },
          {
            type: 'function_call',
            id: 'call_tool-item-1',
            call_id: 'call_tool-1',
            name: 'read_file',
            arguments: '{}',
          },
          { type: 'message', id: 'msg_message-1', role: 'user', content: 'Continue.' },
        ],
      }),
    ),
  )

  assert.equal(normalized.input?.[0]?.id, 'rs_reasoning-1')
  assert.equal(normalized.input?.[1]?.id, 'tsc_tool-item-1')
  assert.equal(normalized.input?.[2]?.id, 'msg_message-1')
})

test('rejects malformed or non-object function-call arguments before sending a Codex request', () => {
  assert.throws(
    () =>
      normalizeCodexRequestBody(
        JSON.stringify({
          input: [{ type: 'function_call', name: 'read_file', arguments: '{not-json' }],
        }),
      ),
    (error: unknown) => error instanceof CodexRequestNormalizationError,
  )

  assert.throws(
    () =>
      normalizeCodexRequestBody(
        JSON.stringify({
          input: [{ type: 'tool_call', name: 'read_file', arguments: ['src/main.ts'] }],
        }),
      ),
    (error: unknown) => error instanceof CodexRequestNormalizationError,
  )
})
