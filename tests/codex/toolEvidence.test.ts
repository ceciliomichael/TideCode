import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import { formatExplicitCodeModeOutput } from '../../src/lib/codeModeResultOutput'
import { formatStructuredToolResultContent } from '../../src/lib/toolResultContent'
import { buildCompactionRequestPrompt } from '../../electron/chat/shared/compaction/prompt'
import { buildDurableMemoryRequestPrompt } from '../../electron/chat/shared/compaction/durableMemory'
import { compactToolResultMessage, readCodeModeEvidence } from '../../electron/chat/shared/compaction/toolEvidence'
import { extractCodeModeReceipts, appendCodeModeReceiptsToSummary } from '../../electron/chat/shared/compaction/codeModeReceipts'

function toolMessage(value: string): ModelMessage {
  return {
    role: 'tool',
    content: [{ type: 'tool-result', toolCallId: 'validation', toolName: 'exec', output: { type: 'text', value } }],
  }
}

function projectedText(value: string) {
  const message = compactToolResultMessage(toolMessage(value))
  assert.ok(Array.isArray(message.content))
  const part = message.content[0]
  assert.equal(part.type, 'tool-result')
  assert.ok('output' in part && part.output.type === 'text')
  return part.output.value
}

function validationBatch() {
  const reads = Array.from({ length: 4 }, (_, index) => ({
    status: 'success',
    summary: `Read source-${index}.tsx`,
    subject: { kind: 'file', path: `source-${index}.tsx` },
    body: `File start ${index}\n${'large source contents '.repeat(1_000)}\nFile end ${index}`,
  }))
  const grep = {
    status: 'success', summary: 'Found 1 matches',
    subject: { kind: 'file', path: 'ProjectThreadSelector.tsx' },
    body: 'ProjectThreadSelector.tsx:\n  Line 231: aria-checked={isSelected}',
  }
  const checks = ['typecheck', 'eslint', 'project-selection tests', 'git diff --check'].map((check, index) => ({
    status: 'success', summary: `Started terminal session ${700 + index}`,
    semantics: { session_id: 700 + index, state: 'completed', exit_code: 0 },
    body: `${check}\nstate: completed\nexit_code: 0\n${index === 2 ? 'tests 10\npass 10\nfail 0' : 'check completed'}`,
  }))
  return 'Code Mode completed with 9 tool calls.\n\n' + formatExplicitCodeModeOutput([...reads, grep, ...checks])
}

test('both worker transcripts preserve late validation and the actual grep match after large reads', () => {
  const value = validationBatch()
  assert.ok(value.length > 80_000)
  assert.doesNotMatch(value.slice(0, 2_000), /tests 10/u)
  const messages: ModelMessage[] = [
    { role: 'user', content: 'Remove the project checkmarks and verify the change.' },
    { role: 'assistant', content: [{
      type: 'tool-call', toolCallId: 'validation', toolName: 'exec',
      input: { code: 'return await Promise.all([tools.terminal.execute({command: "npm run typecheck"})])' },
    }] },
    toolMessage(value),
    { role: 'assistant', content: 'Removed the checkmarks; checks passed.' },
  ]
  const context = { messages, sourceStartIndex: 0, sourceDigest: 'validation-after-edit', turnState: 'settled' as const }
  const handoff = buildCompactionRequestPrompt({ ...context, sourceMessageIds: ['model:0', 'model:1', 'model:2', 'model:3'] })
  const memory = buildDurableMemoryRequestPrompt(context)

  for (const prompt of [handoff, memory]) {
    for (const check of ['typecheck', 'eslint', 'project-selection tests', 'git diff --check']) {
      assert.ok(prompt.includes(check))
    }
    assert.match(prompt, /Line 231: aria-checked=\{isSelected\}/u)
    assert.match(prompt, /tests 10/u)
    assert.match(prompt, /pass 10/u)
    assert.match(prompt, /fail 0/u)
    assert.match(prompt, /state=completed; exit_code=0; session=703/u)
    assert.match(prompt, /"sourceMessageId":"model:2"/u)
    assert.ok(prompt.length < 24_000)
  }
  const receipts = extractCodeModeReceipts(messages)
  assert.equal(receipts.length, 1)
  assert.equal(receipts[0].status, 'unknown')
  assert.equal(receipts[0].nestedToolCalls.length, 9)
  assert.equal(receipts[0].nestedToolCalls[8].exitCode, 0)
})

test('returned nested objects preserve failure and running state without assuming wrapper success', () => {
  const output = 'Code Mode completed after handling 1 failed tool call.\n\n' + formatExplicitCodeModeOutput({
    check: { status: 'success', summary: 'Command returned', exit_code: 2, state: 'completed', body: 'Typecheck failed.' },
    pending: { status: 'success', summary: 'Started terminal session', semantics: { state: 'running', exit_code: null }, body: 'Still running.' },
    failed: { status: 'error', summary: 'Edit rejected', body: 'No files changed.' },
  })
  const text = projectedText(output)
  assert.match(text, /tool_status=success; state=completed; exit_code=2/u)
  assert.match(text, /tool_status=success; state=running; exit_code=null/u)
  assert.match(text, /tool_status=error/u)
  assert.match(text, /No files changed/u)
  assert.equal(readCodeModeEvidence(output)?.status, 'unknown')
})

test('structured exec receipts preserve commands and outcomes across the full allowed call batch', () => {
  const calls = Array.from({ length: 100 }, (_, index) => ({
    name: 'terminal.execute', status: 'success', summary: `Completed check ${index}`,
    arguments: { command: `run-check-${index}` },
    semantics: { state: 'completed', exit_code: index === 99 ? 1 : 0, session_id: index },
    body: `Start\n${'output '.repeat(2_000)}\nFinal result ${index}`,
  }))
  const value = formatStructuredToolResultContent({
    schema: 'tidecode.tool_result/v1', toolName: 'exec', toolCallId: 'hundred-calls',
    status: 'success', summary: 'Code Mode completed with 100 tool calls.', semantics: { tool_calls: calls },
  })
  const text = projectedText(value)
  assert.ok(text.length <= 24_000)
  assert.equal((text.match(/tool_status=success/gu) ?? []).length, 100)
  assert.match(text, /state=completed; exit_code=1; session=99/u)
  assert.match(text, /command=run-check-99/u)
})

test('unparseable outputs remain bounded evidence without fabricated receipts', () => {
  const value = 'Code Mode completed with 1 tool call.\n\n[{"body":"unterminated ' + 'x'.repeat(8_000) + '\nexit_code: 1'
  const text = projectedText(value)
  assert.equal(readCodeModeEvidence(value), null)
  assert.ok(text.length <= 2_000)
  assert.match(text, /exit_code: 1/u)
  assert.match(text, /middle truncated/u)
})

test('recent validation receipts take precedence over a full older receipt section and retain later summary sections', () => {
  const previous = '## Verified Code Mode executions\n\n' + 'old read result\n'.repeat(300)
  const summary = '## Verified Code Mode executions\n\nolder evidence\n\n## Remaining work\n- Deliver the final response.'
  const result = appendCodeModeReceiptsToSummary(summary, [toolMessage(validationBatch())], previous)
  assert.match(result, /## Remaining work\n- Deliver the final response/u)
  assert.match(result, /session=703/u)
  assert.match(result, /pass 10/u)
})
