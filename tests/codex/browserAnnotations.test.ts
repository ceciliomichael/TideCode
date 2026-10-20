import '../configureAppRoot'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  appendBrowserAnnotationsToModelMessages,
  formatBrowserAnnotations,
  listBrowserAnnotations,
  removeBrowserAnnotation,
  saveBrowserAnnotation,
} from '../../electron/history/browserAnnotations'

test('browser annotations persist in the conversation and project scope without leaking across chats', async () => {
  const historyRoot = await mkdtemp(path.join(tmpdir(), 'tidecode-browser-annotations-'))
  const projectPath = path.join(historyRoot, 'project')
  const input = {
    conversationId: 'chat-123',
    projectPath,
    tabId: 'tab-1',
    url: 'http://localhost:3000/',
    selector: '#save-button',
    elementName: 'Save',
    comment: 'The save button needs more padding.',
  }
  try {
    const [first, second] = await Promise.all([
      saveBrowserAnnotation(input, historyRoot),
      saveBrowserAnnotation({ ...input, comment: 'The button needs focus styling.' }, historyRoot),
    ])
    assert.notEqual(first.id, second.id)
    const saved = await listBrowserAnnotations(input.conversationId, projectPath, historyRoot)
    assert.equal(saved.length, 2)
    assert.equal(formatBrowserAnnotations(saved).includes('padding'), true)
    assert.deepEqual(await listBrowserAnnotations('another-chat', projectPath, historyRoot), [])
    assert.deepEqual(await listBrowserAnnotations(input.conversationId, path.join(historyRoot, 'other'), historyRoot), [])
    const original = [{ role: 'user' as const, content: 'Fix the dashboard' }]
    const projected = await appendBrowserAnnotationsToModelMessages(original, input.conversationId, projectPath, historyRoot)
    assert.equal(original[0].content, 'Fix the dashboard')
    assert.match(String(projected[0].content), /#save-button/)
    assert.match(String(projected[0].content), /padding/)
    assert.equal(await removeBrowserAnnotation({
      conversationId: input.conversationId, projectPath, id: first.id,
    }, historyRoot), true)
    assert.equal((await listBrowserAnnotations(input.conversationId, projectPath, historyRoot)).length, 1)
    await assert.rejects(() => saveBrowserAnnotation({
      ...input, conversationId: '../escape',
    }, historyRoot), /existing conversation/)
  } finally {
    await rm(historyRoot, { force: true, recursive: true })
  }
})
