import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import React from 'react'
import { transformSync } from 'esbuild'
import type { ChatInput } from '../src/components/ChatInput'
import type { useChatMessageActions } from '../src/pages/chatInterface/useChatMessageActions'
import type { ChatAttachment } from '../src/types/chat'

// Execute the real event handlers without mounting unrelated menus or effects.
function loadWithHooks<T>(relativePath: string, mocks: Record<string, unknown> = {}): T {
  const sourceUrl = new URL(relativePath, import.meta.url)
  const compiled = transformSync(readFileSync(sourceUrl, 'utf8'), {
    loader: 'tsx', format: 'cjs', jsx: 'automatic',
  })
  const loaded = { exports: {} }
  const require = createRequire(sourceUrl)
  const hooks = {
    ...React,
    useCallback: (callback: unknown) => callback,
    useEffect: () => undefined,
    useRef: (current: unknown) => ({ current }),
    useState: (initial: unknown) => [initial, () => undefined],
  }
  vm.runInThisContext(`(function(module, require) { ${compiled.code}\n })`)(loaded, (name: string) => {
    if (name === 'react') {
      return hooks
    }
    if (name in mocks) {
      return mocks[name]
    }
    return require(name)
  })
  return loaded.exports as T
}

const attachment: ChatAttachment = {
  id: 'attachment', kind: 'text', fileName: 'notes.txt', mimeType: 'text/plain',
  sizeBytes: 5, textContent: 'notes',
}

function createComposer(onSend: Parameters<typeof ChatInput>[0]['onSend'], streaming = false) {
  const state = { value: 'Continue with Codex', attachments: [attachment], clears: 0, queued: 0 }
  const mentions = new Map([['@notes', 'notes.txt']])
  const { ChatInput: Input } = loadWithHooks<{ ChatInput: typeof ChatInput }>('../src/components/ChatInput.tsx', {
    '../hooks/useIsMobileViewport': { useIsMobileViewport: () => false },
    '../hooks/useChatMentionNavigation': { useChatMentionNavigation: () => ({}) },
    '../hooks/useChatFileMentionMenu': {
      useChatFileMentionMenu: () => ({
        mentionPathMap: mentions,
        mentionPathMapRef: { current: mentions },
        closeMenu: () => undefined,
        expandValueForSend: (value: string) => value,
        clearMentionPathMap: () => mentions.clear(),
      }),
    },
  })
  const props: Parameters<typeof ChatInput>[0] = {
    value: state.value,
    attachments: state.attachments,
    isStreaming: streaming,
    onSend,
    onQueue: () => { state.queued += 1 },
    onValueChange: (value) => {
      state.value = value
      state.clears += 1
    },
    onAttachmentsChange: (attachments) => { state.attachments = attachments },
  }
  const tree = Input(props)
  function findSubmit(node: React.ReactNode): (() => void) | undefined {
    if (!React.isValidElement<Record<string, unknown>>(node)) {
      return undefined
    }
    if (node.type === 'button' && ['Send message', 'Queue message'].includes(String(node.props['aria-label']))) {
      return node.props.onClick as () => void
    }
    for (const child of React.Children.toArray(node.props.children as React.ReactNode)) {
      const submit = findSubmit(child)
      if (submit) {
        return submit
      }
    }
    return undefined
  }
  const submit = findSubmit(tree)
  assert.ok(submit, 'the composer must expose its submit button')
  return { state, mentions, props, submit }
}

test('a rejected Send preserves text, attachments and mentions', () => {
  let attempts = 0
  const composer = createComposer(() => { attempts += 1 })
  composer.submit()
  assert.equal(attempts, 1)
  assert.equal(composer.state.value, 'Continue with Codex')
  assert.deepEqual(composer.state.attachments, [attachment])
  assert.equal(composer.mentions.size, 1)
  assert.equal(composer.state.clears, 0)
})

test('an accepted Send clears the composer only through its send workflow', () => {
  const composer = createComposer(() => {
    composer.props.onValueChange('')
    composer.props.onAttachmentsChange?.([])
  })
  composer.submit()
  assert.equal(composer.state.value, '')
  assert.deepEqual(composer.state.attachments, [])
  assert.equal(composer.state.clears, 1)
})

test('explicit queue submission still clears the composer after enqueueing', () => {
  const composer = createComposer(() => assert.fail('queue must not send immediately'), true)
  composer.submit()
  assert.equal(composer.state.queued, 1)
  assert.equal(composer.state.value, '')
  assert.deepEqual(composer.state.attachments, [])
  assert.equal(composer.mentions.size, 0)
})

test('Send routed into the busy-chat queue preserves the message before clearing the composer', () => {
  const { useChatMessageActions: useActions } = loadWithHooks<{
    useChatMessageActions: typeof useChatMessageActions
  }>('../src/pages/chatInterface/useChatMessageActions.ts')
  const calls: string[] = []
  const input = {
    chatMessages: {
      isSending: true,
      messages: [],
      setMainComposerValue: () => calls.push('clear text'),
      setMainComposerAttachments: () => calls.push('clear attachments'),
      setMainComposerMentionPathMap: () => calls.push('clear mentions'),
    },
    enqueueMessage: (value: string, attachments: ChatAttachment[], mentions: ReadonlyMap<string, string>) => {
      assert.equal(value, 'Continue with Codex')
      assert.deepEqual(attachments, [attachment])
      assert.equal(mentions.get('@notes'), 'notes.txt')
      calls.push('enqueue')
    },
    workspaceState: {},
  } as unknown as Parameters<typeof useChatMessageActions>[0]
  useActions(input).handleSendMainMessage('Continue with Codex', [attachment], new Map([['@notes', 'notes.txt']]))
  assert.deepEqual(calls, ['enqueue', 'clear text', 'clear attachments', 'clear mentions'])
})
