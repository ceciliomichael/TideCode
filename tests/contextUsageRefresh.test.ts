import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'
import { createContextUsageRefresh } from '../src/hooks/useChatContextUsage'

test('context estimation runs one request at a time and coalesces a burst to the newest request', async () => {
  const queue = createContextUsageRefresh()
  const calls: number[] = []
  let finish!: () => void
  queue.request(async () => {
    calls.push(1)
    await new Promise<void>((resolve) => { finish = resolve })
  })
  queue.request(async () => { calls.push(2) })
  queue.request(async () => { calls.push(3) })
  assert.deepEqual(calls, [1])
  finish()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls, [1, 3])
})

test('context estimation cleanup drops a queued refresh', async () => {
  const queue = createContextUsageRefresh()
  let finish!: () => void
  let called = false
  queue.request(() => new Promise<void>((resolve) => { finish = resolve }))
  queue.request(async () => { called = true })
  queue.cancelPending()
  finish()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(called, false)
})

test('a selected chat can estimate context while the previous chat request is still pending', async () => {
  const previousQueue = createContextUsageRefresh()
  const selectedQueue = createContextUsageRefresh()
  let finishPrevious!: () => void
  let previousFinished = false
  let selectedFinished = false

  previousQueue.request(async () => {
    await new Promise<void>((resolve) => {
      finishPrevious = resolve
    })
    previousFinished = true
  })
  previousQueue.cancelPending()
  selectedQueue.request(async () => {
    selectedFinished = true
  })

  try {
    assert.equal(previousFinished, false)
    assert.equal(selectedFinished, true)
  } finally {
    finishPrevious()
    await new Promise((resolve) => setImmediate(resolve))
  }
})

test('mounted context hook publishes estimates during refresh bursts and isolates chat switches', {
  timeout: 30_000,
  skip: process.platform === 'linux' && !process.env.DISPLAY,
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tidecode-context-hook-'))
  try {
    const renderer = await build({
      stdin: {
        resolveDir: path.resolve(import.meta.dirname, '..'),
        contents: `
          import React from 'react'
          import { createRoot } from 'react-dom/client'
          import { flushSync } from 'react-dom'
          import { useChatContextUsage } from './src/hooks/useChatContextUsage'

          window.runContextTest = async () => {
            const requests = []
            let explorerListener
            let streamListener
            let usage
            const expect = (condition, message) => {
              if (!condition) throw new Error(message)
            }
            const waitFor = async (condition) => {
              for (let attempt = 0; attempt < 200; attempt += 1) {
                if (condition()) return
                await new Promise((resolve) => setTimeout(resolve, 5))
              }
              throw new Error('Timed out waiting for the context hook')
            }
            const estimate = (tokens) => ({
              historyTokens: tokens,
              maxTokens: 200000,
              systemPromptTokens: 10,
              toolSchemaTokens: 20,
              toolResultsTokens: 0,
              totalTokens: tokens + 30,
            })
            window.tidecodeChat = {
              estimateContextUsage: (input) => new Promise((resolve) => {
                requests.push({ input, resolve })
              }),
              onStreamEvent: (listener) => {
                streamListener = listener
                return () => {}
              },
            }
            window.tidecodeRuns = { listActiveRuns: async () => [] }
            window.tidecodeWorkspace = {
              onExplorerChange: (listener) => {
                explorerListener = listener
                return () => {}
              },
              watchExplorerChanges: async () => {},
              unwatchExplorerChanges: async () => {},
            }
            function Probe({ conversationId }) {
              usage = useChatContextUsage({
                agentContextRootPath: '/workspace',
                chatMode: 'agent',
                conversationId,
                contextCompaction: {
                  contextWindowTokens: 200000,
                  retainedContextTokens: 10000,
                  triggerPercent: 80,
                },
                messages: [],
                modelId: 'test-model',
                providerId: 'codex',
                terminalExecutionMode: 'sandbox',
              })
              return null
            }
            const root = createRoot(document.getElementById('root'))
            const render = (id) => flushSync(() => root.render(React.createElement(Probe, { conversationId: id })))
            try {
              render('chat-a')
              await waitFor(() => requests.length === 1)
              explorerListener({ workspaceRootPath: '/workspace' })
              requests[0].resolve(estimate(100))
              await waitFor(() => requests.length === 2)
              await new Promise((resolve) => setTimeout(resolve, 20))
              expect(usage.totalTokens === 130, 'Queued refresh discarded the completed estimate; usage stayed zero')

              render('chat-b')
              expect(usage.totalTokens === 0, 'Chat B displayed chat A usage')
              await waitFor(() => requests.length === 3)
              expect(requests[2].input.conversationId === 'chat-b', 'Chat B did not start its own estimate')
              requests[2].resolve(estimate(200))
              await waitFor(() => usage.totalTokens === 230)
              requests[1].resolve(estimate(999))
              await new Promise((resolve) => setTimeout(resolve, 20))
              expect(usage.totalTokens === 230, 'Late chat A response overwrote chat B')

              render('chat-b')
              expect(usage.totalTokens === 230, 'Equivalent settings reset the context display')
              explorerListener({ workspaceRootPath: '/workspace' })
              await waitFor(() => requests.length === 4)
              streamListener({ type: 'context_usage_updated', conversationId: 'chat-b', streamId: 'live-b', usage: estimate(300) })
              await waitFor(() => usage.totalTokens === 330)
              requests[3].resolve(estimate(1))
              await new Promise((resolve) => setTimeout(resolve, 20))
              expect(usage.totalTokens === 330, 'An estimate replaced newer live context usage')
              return 'CONTEXT_HOOK_PASS'
            } finally {
              flushSync(() => root.unmount())
            }
          }
        `,
      },
      bundle: true,
      platform: 'browser',
      write: false,
    })
    await writeFile(path.join(directory, 'renderer.js'), renderer.outputFiles[0].text)
    await writeFile(path.join(directory, 'main.cjs'), `
      const { app, BrowserWindow } = require('electron')
      const fs = require('node:fs')
      const path = require('node:path')
      app.setPath('userData', path.join(__dirname, 'profile'))
      app.whenReady().then(async () => {
        const win = new BrowserWindow({ show: false })
        await win.loadURL('data:text/html,<div id="root"></div>')
        await win.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'))
        console.log(await win.webContents.executeJavaScript('window.runContextTest()'))
        app.exit(0)
      }).catch((error) => {
        console.error(error)
        app.exit(1)
      })
    `)
    const require = createRequire(import.meta.url)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(require('electron'), [path.join(directory, 'main.cjs')], {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk.toString() })
    child.stderr.on('data', (chunk) => { output += chunk.toString() })
    const timeout = setTimeout(() => child.kill(), 20_000)
    try {
      const exitCode = await new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', resolve)
      })
      assert.equal(exitCode, 0, output)
      assert.match(output, /CONTEXT_HOOK_PASS/)
    } finally {
      clearTimeout(timeout)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
