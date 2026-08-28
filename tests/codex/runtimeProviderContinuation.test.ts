import '../configureAppRoot'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import { DEFAULT_CONTEXT_COMPACTION_SETTINGS } from '../../src/lib/contextCompactionSettings'
import type { ChatStreamEvent } from '../../src/types/chat'
import type { ProviderStepRecord } from '../../electron/chat/history/contracts'
import {
  runToolEnabledChatStream,
  type ProviderStreamFactoryInput,
} from '../../electron/chat/shared/runtime'
import { ChatStreamSteeringController } from '../../electron/chat/shared/streamSteering'

function createCodeModeStep(): ProviderStepRecord {
  return {
    durationMs: 1,
    finishReason: 'tool-calls',
    providerMetadata: { openai: { responseId: 'resp-luna-tool' } },
    responseMessages: [
      {
        role: 'assistant',
        content: [{
          input: 'return await tools.read({ path: "package.json", full_file: true })',
          toolCallId: 'call-luna-1',
          toolName: 'code_mode',
          type: 'tool-call',
        }],
      },
      {
        role: 'tool',
        content: [{
          output: { type: 'text', value: 'Code Mode completed' },
          toolCallId: 'call-luna-1',
          toolName: 'code_mode',
          type: 'tool-result',
        }],
      },
    ],
    stepNumber: 0,
    usage: {
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      inputTokens: 100,
      noCacheTokens: 100,
      outputTokens: 10,
      reasoningTokens: 5,
      totalTokens: 110,
    },
  }
}

function createStopStep(): ProviderStepRecord {
  return {
    durationMs: 1,
    finishReason: 'stop',
    providerMetadata: { openai: { responseId: 'resp-luna-final' } },
    responseMessages: [{ role: 'assistant', content: 'Implemented.' }],
    stepNumber: 0,
    usage: {
      cacheReadTokens: 100,
      cacheWriteTokens: 0,
      inputTokens: 120,
      noCacheTokens: 20,
      outputTokens: 5,
      reasoningTokens: 0,
      totalTokens: 125,
    },
  }
}

test('runtime issues a second provider request after a completed Luna Code Mode step', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-luna-continuation-'))
  const requests: Array<{ cacheKey: string; messages: ModelMessage[] }> = []
  const events: ChatStreamEvent[] = []
  const codeModeStep = createCodeModeStep()
  const stopStep = createStopStep()

  try {
    await fs.writeFile(path.join(workspaceRootPath, 'AGENTS.md'), '# Test workspace\n', 'utf8')

    const createStream = async (input: ProviderStreamFactoryInput) => {
      requests.push({ cacheKey: input.cacheKey, messages: [...input.messages] })
      const requestNumber = requests.length

      return {
        fullStream: (async function* () {
          if (requestNumber === 1) {
            await input.onStepEnd?.(codeModeStep)
            yield { finishReason: 'tool-calls', type: 'finish' }
            return
          }

          assert.equal(requestNumber, 2, 'runtime should make exactly one continuation request')
          await input.onStepEnd?.(stopStep)
          yield { text: 'Implemented.', type: 'text-delta' }
          yield { finishReason: 'stop', type: 'finish' }
        })(),
      }
    }

    await runToolEnabledChatStream({
      abortController: new AbortController(),
      createStream,
      startInput: {
        agentContextRootPath: workspaceRootPath,
        cacheScopeId: 'luna-continuation-cache',
        chatMode: 'agent',
        contextCompaction: DEFAULT_CONTEXT_COMPACTION_SETTINGS,
        messages: [{
          content: 'Inspect the package, then implement the change.',
          id: 'user-luna-1',
          role: 'user',
          timestamp: 1,
        }],
        modelId: 'gpt-5.6-luna',
        providerId: 'codex',
        reasoningEffort: 'high',
        terminalExecutionMode: 'sandbox',
      },
      steering: new ChatStreamSteeringController(),
      streamId: 'stream-luna-continuation',
      webContents: { emit: (event) => events.push(event) },
    })

    assert.equal(requests.length, 2)
    assert.equal(requests[0]?.cacheKey, requests[1]?.cacheKey)
    for (const request of requests) {
      const serializedMessages = JSON.stringify(request.messages)
      assert.match(serializedMessages, /kind=\\?"workspace_instructions\\?"/u)
      assert.match(serializedMessages, /A root AGENTS\.md exists/u)
      assert.doesNotMatch(serializedMessages, /# Test workspace/u)
    }
    assert.equal(requests[1]?.messages.some((message) => (
      message.role === 'assistant'
      && Array.isArray(message.content)
      && message.content.some((part) => part.type === 'tool-call' && part.toolName === 'code_mode')
    )), true)
    assert.equal(requests[1]?.messages.some((message) => (
      message.role === 'tool'
      && Array.isArray(message.content)
      && message.content.some((part) => part.type === 'tool-result' && part.toolName === 'code_mode')
    )), true)
    assert.equal(events.some((event) => event.type === 'completed'), true)
    assert.equal(events.some((event) => event.type === 'error'), false)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
