import '../configureAppRoot'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import type { ToolExecutionOptions } from 'ai'
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

test('runtime continuation sends captured image reads as separate visual input, never inside Code Mode output', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-image-continuation-'))
  const requests: ModelMessage[][] = []
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
    'base64',
  )

  try {
    await fs.writeFile(path.join(workspaceRootPath, 'pixel.png'), pngBytes)

    const createStream = async (input: ProviderStreamFactoryInput) => {
      requests.push([...input.messages])
      const requestNumber = requests.length

      return {
        fullStream: (async function* () {
          if (requestNumber === 1) {
            const codeModeTool = input.tools.code_mode as {
              execute?: (input: unknown, options: ToolExecutionOptions<unknown>) => Promise<unknown>
            }
            const result = await codeModeTool.execute?.(
              { code: "return await tools.read({ path: 'pixel.png' })" },
              { context: {}, messages: [], toolCallId: 'call-image-1' },
            )
            const serializedResult = JSON.stringify(result)
            assert.ok(serializedResult.length < 20_000)
            assert.doesNotMatch(serializedResult, /iVBOR|"type":"Buffer"/u)

            const toolStep = {
              ...createCodeModeStep(),
              responseMessages: [
                {
                  role: 'assistant',
                  content: [{
                    input: { code: "return await tools.read({ path: 'pixel.png' })" },
                    toolCallId: 'call-image-1',
                    toolName: 'code_mode',
                    type: 'tool-call',
                  }],
                },
                {
                  role: 'tool',
                  content: [{
                    output: { type: 'text', value: serializedResult },
                    toolCallId: 'call-image-1',
                    toolName: 'code_mode',
                    type: 'tool-result',
                  }],
                },
              ],
            }
            await input.onStepEnd?.(toolStep)
            yield { finishReason: 'tool-calls', type: 'finish' }
            return
          }

          await input.onStepEnd?.(createStopStep())
          yield { text: 'I can see the image.', type: 'text-delta' }
          yield { finishReason: 'stop', type: 'finish' }
        })(),
      }
    }

    await runToolEnabledChatStream({
      abortController: new AbortController(),
      createStream,
      startInput: {
        agentContextRootPath: workspaceRootPath,
        cacheScopeId: 'image-continuation-cache',
        chatMode: 'agent',
        contextCompaction: DEFAULT_CONTEXT_COMPACTION_SETTINGS,
        messages: [{
          content: 'Read pixel.png.',
          id: 'user-image-1',
          role: 'user',
          timestamp: 1,
        }],
        modelId: 'test-vision-model',
        providerId: 'openai',
        reasoningEffort: 'high',
        terminalExecutionMode: 'sandbox',
      },
      steering: new ChatStreamSteeringController(),
      streamId: 'stream-image-continuation',
      webContents: { emit: () => undefined },
    })

    assert.equal(requests.length, 2)
    const secondRequest = requests[1] ?? []
    const serializedSecondRequest = JSON.stringify(secondRequest)
    assert.doesNotMatch(serializedSecondRequest, /"type":"Buffer"/u)
    assert.equal(secondRequest.some((message) => (
      message.role === 'user'
      && Array.isArray(message.content)
      && message.content.some((part) => part.type === 'file' && part.mediaType === 'image/png')
    )), true)
    const codeModeToolMessage = secondRequest.find((message) => message.role === 'tool')
    assert.ok(codeModeToolMessage)
    assert.doesNotMatch(JSON.stringify(codeModeToolMessage), /iVBOR|"type":"file"|"type":"Buffer"/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('runtime prepareStep injects captured image reads into the next in-stream model step', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-image-prepare-step-'))
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
    'base64',
  )
  let preparedMessages: ModelMessage[] | null = null

  try {
    await fs.writeFile(path.join(workspaceRootPath, 'pixel.png'), pngBytes)

    const createStream = async (input: ProviderStreamFactoryInput) => ({
      fullStream: (async function* () {
        const codeModeTool = input.tools.code_mode as {
          execute?: (input: unknown, options: ToolExecutionOptions<unknown>) => Promise<unknown>
        }
        const result = await codeModeTool.execute?.(
          { code: "return await tools.read({ path: 'pixel.png' })" },
          { context: {}, messages: [], toolCallId: 'call-image-prepare' },
        )
        const serializedResult = JSON.stringify(result)
        assert.doesNotMatch(serializedResult, /iVBOR|"type":"file"|"type":"Buffer"/u)

        const toolStep = {
          ...createCodeModeStep(),
          responseMessages: [
            {
              role: 'assistant' as const,
              content: [{
                input: { code: "return await tools.read({ path: 'pixel.png' })" },
                toolCallId: 'call-image-prepare',
                toolName: 'code_mode',
                type: 'tool-call' as const,
              }],
            },
            {
              role: 'tool' as const,
              content: [{
                output: { type: 'text' as const, value: serializedResult },
                toolCallId: 'call-image-prepare',
                toolName: 'code_mode',
                type: 'tool-result' as const,
              }],
            },
          ],
        }
        await input.onStepEnd?.(toolStep)

        assert.ok(input.prepareStep)
        const prepared = await input.prepareStep({
          messages: [...input.messages, ...toolStep.responseMessages],
          responseMessages: toolStep.responseMessages,
          stepNumber: 1,
          steps: [],
        } as Parameters<NonNullable<typeof input.prepareStep>>[0])
        preparedMessages = prepared?.messages ? [...prepared.messages] : null
        assert.equal(preparedMessages?.some((message) => (
          message.role === 'user'
          && Array.isArray(message.content)
          && message.content.some((part) => part.type === 'file' && part.mediaType === 'image/png')
        )), true)

        await input.onStepEnd?.(createStopStep())
        yield { text: 'I can see the image.', type: 'text-delta' }
        yield { finishReason: 'stop', type: 'finish' }
      })(),
    })

    await runToolEnabledChatStream({
      abortController: new AbortController(),
      createStream,
      startInput: {
        agentContextRootPath: workspaceRootPath,
        cacheScopeId: 'image-prepare-step-cache',
        chatMode: 'agent',
        contextCompaction: DEFAULT_CONTEXT_COMPACTION_SETTINGS,
        messages: [{
          content: 'Read pixel.png.',
          id: 'user-image-prepare',
          role: 'user',
          timestamp: 1,
        }],
        modelId: 'test-vision-model',
        providerId: 'openai',
        reasoningEffort: 'high',
        terminalExecutionMode: 'sandbox',
      },
      steering: new ChatStreamSteeringController(),
      streamId: 'stream-image-prepare',
      webContents: { emit: () => undefined },
    })

    assert.ok(preparedMessages)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('runtime prepareStep injects a new image when an older visual message remains in step history', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-image-repeat-'))
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
    'base64',
  )
  let secondPreparedMessages: ModelMessage[] | null = null

  try {
    await Promise.all([
      fs.writeFile(path.join(workspaceRootPath, 'first.png'), pngBytes),
      fs.writeFile(path.join(workspaceRootPath, 'second.png'), pngBytes),
    ])

    const createStream = async (input: ProviderStreamFactoryInput) => ({
      fullStream: (async function* () {
        const codeModeTool = input.tools.code_mode as {
          execute?: (input: unknown, options: ToolExecutionOptions<unknown>) => Promise<unknown>
        }
        assert.ok(input.prepareStep)

        const readImage = async (fileName: string, toolCallId: string) => {
          const code = `return await tools.read({ path: '${fileName}' })`
          const result = await codeModeTool.execute?.(
            { code },
            { context: {}, messages: [], toolCallId },
          )
          const serializedResult = JSON.stringify(result)
          assert.doesNotMatch(serializedResult, /iVBOR|"type":"file"|"type":"Buffer"/u)

          const toolStep: ProviderStepRecord = {
            ...createCodeModeStep(),
            responseMessages: [
              {
                role: 'assistant',
                content: [{
                  input: { code },
                  toolCallId,
                  toolName: 'code_mode',
                  type: 'tool-call',
                }],
              },
              {
                role: 'tool',
                content: [{
                  output: { type: 'text', value: serializedResult },
                  toolCallId,
                  toolName: 'code_mode',
                  type: 'tool-result',
                }],
              },
            ],
          }
          return toolStep
        }

        const firstToolStep = await readImage('first.png', 'call-image-first')
        await input.onStepEnd?.(firstToolStep)
        const firstPrepared = await input.prepareStep({
          messages: [...input.messages, ...firstToolStep.responseMessages],
          responseMessages: firstToolStep.responseMessages,
          stepNumber: 1,
          steps: [],
        } as Parameters<NonNullable<typeof input.prepareStep>>[0])
        assert.ok(firstPrepared?.messages)
        const firstPreparedMessages = [...firstPrepared.messages]
        assert.equal(firstPreparedMessages.some((message) => (
          message.role === 'user'
          && Array.isArray(message.content)
          && message.content.some((part) => part.type === 'file' && part.filename === 'first.png')
        )), true)

        await input.onStepEnd?.(createStopStep())

        const secondToolStep = await readImage('second.png', 'call-image-second')
        await input.onStepEnd?.(secondToolStep)
        const secondPrepared = await input.prepareStep({
          messages: [...firstPreparedMessages, ...secondToolStep.responseMessages],
          responseMessages: secondToolStep.responseMessages,
          stepNumber: 3,
          steps: [],
        } as Parameters<NonNullable<typeof input.prepareStep>>[0])
        secondPreparedMessages = secondPrepared?.messages ? [...secondPrepared.messages] : null
        assert.ok(secondPreparedMessages)

        const visualFileNames = secondPreparedMessages.flatMap((message) => (
          message.role === 'user' && Array.isArray(message.content)
            ? message.content
              .filter((part) => part.type === 'file')
              .map((part) => part.filename)
            : []
        ))
        assert.equal(visualFileNames.includes('first.png'), true)
        assert.equal(visualFileNames.includes('second.png'), true)

        await input.onStepEnd?.(createStopStep())
        yield { text: 'Both images are visible.', type: 'text-delta' }
        yield { finishReason: 'stop', type: 'finish' }
      })(),
    })

    await runToolEnabledChatStream({
      abortController: new AbortController(),
      createStream,
      startInput: {
        agentContextRootPath: workspaceRootPath,
        cacheScopeId: 'image-repeat-cache',
        chatMode: 'agent',
        contextCompaction: DEFAULT_CONTEXT_COMPACTION_SETTINGS,
        messages: [{
          content: 'Read first.png, then read second.png.',
          id: 'user-image-repeat',
          role: 'user',
          timestamp: 1,
        }],
        modelId: 'test-vision-model',
        providerId: 'openai',
        reasoningEffort: 'high',
        terminalExecutionMode: 'sandbox',
      },
      steering: new ChatStreamSteeringController(),
      streamId: 'stream-image-repeat',
      webContents: { emit: () => undefined },
    })

    assert.ok(secondPreparedMessages)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
