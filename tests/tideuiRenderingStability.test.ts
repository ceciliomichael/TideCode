import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { build } from 'esbuild'
import { buildTideHtmlRuntime } from '../scripts/tideuiHtmlRuntimePlugin'

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(import.meta.dirname, '..')

test('Chat immediately follows TideUI and Markdown while preserving controls, interactive HTML preview state and user scroll intent', {
  timeout: 60000,
  skip: process.env.TIDECODE_RUN_TIDEUI_RENDER_TESTS !== '1',
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tidecode-tideui-stability-'))
  try {
    const renderer = `
          import React, { useState } from 'react'
          import { createRoot } from 'react-dom/client'
          import { flushSync } from 'react-dom'
          import { MessageList } from './src/components/MessageList'
          window.__renders = {}
          window.__sent = 0
          window.__sentMessages = []
          window.__draft = ''
          const onSend = message => {
            window.__sent += 1
            window.__sentMessages.push(message)
            if (window.__holdSend) return new Promise(resolve => { window.__releaseSend = resolve })
            return !window.__rejectSend
          }
          const onDraft = message => { window.__draft = message }
          const noop = () => {}
          const initial = [
            'panel "Dashboard"',
            '  chart bar "Activity" interactive=true',
            '    point "Mon" 4',
            '    point "Tue" 7',
            '  input "Notes" id=notes',
            '  button "Send follow-up" action=send message="Review this dashboard"',
            '  expand "Details"',
            '    text "Retained content"',
            ...Array.from({ length: 18 }, (_, i) => '  metric "Item ' + i + '" ' + i),
            '',
          ].join('\\n')
          function Fixture() {
            const [content, setContent] = useState(String.fromCharCode(96).repeat(3) + 'tideui\\n' + initial.split('\\n')[0] + '\\n')
            const [isStreaming, setStreaming] = useState(true)
            const [reasoningContent, setReasoningContent] = useState('')
            const [followLatestSignal, setFollowLatestSignal] = useState(0)
            const [conversationId, setConversationId] = useState('stability')
            const [, setPulse] = useState(0)
            window.fixture = {
              initialize: () => flushSync(() => setContent(String.fromCharCode(96).repeat(3) + 'tideui\\n' + initial)),
              append: text => flushSync(() => setContent(current => current + text)),
              finish: () => flushSync(() => setStreaming(false)),
              replace: text => flushSync(() => { setContent(text); setStreaming(true) }),
              pulse: () => flushSync(() => setPulse(current => current + 1)),
              follow: () => flushSync(() => setFollowLatestSignal(current => current + 1)),
              switchChat: () => flushSync(() => setConversationId(current => current + '-next')),
              reasoning: text => flushSync(() => { setContent(''); setReasoningContent(text); setStreaming(true) }),
              appendReasoning: text => flushSync(() => setReasoningContent(current => current + text)),
            }
            return <MessageList conversationId={conversationId} followLatestSignal={followLatestSignal}
              messages={[{ id: 'answer', role: 'assistant', content, reasoningContent, timestamp: 1 }]}
              streamingAssistantMessageId={isStreaming ? 'answer' : null} streamingTextActive={isStreaming}
              composerValue="" composerAttachments={[]} onTideUISend={onSend} onTideUIDraft={onDraft}
              onCancelEditingMessage={noop} onComposerAttachmentsChange={noop}
              onComposerValueChange={noop} onSendEditedMessage={noop} sendMessageOnEnter={true} />
          }
          createRoot(document.getElementById('root')).render(<Fixture />)
        `
    await build({
      stdin: {
        contents: renderer,
        resolveDir: projectRoot,
        loader: 'tsx',
      },
      outfile: path.join(directory, 'renderer.js'),
      bundle: true,
      platform: 'browser',
      jsx: 'automatic',
      loader: { '.ttf': 'dataurl' },
      define: { 'import.meta.env.BASE_URL': '"/"' },
      plugins: [{
        name: 'count-tideui-renders',
        setup(builder) {
          // This fixture never opens a code editor. Vite worker imports still
          // need resolving because MarkdownRenderer can lazy-load CodeBlock.
          builder.onResolve({ filter: /\?worker$/ }, () => ({ path: 'worker', namespace: 'unused-worker' }))
          builder.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.replace(/\?raw$/, '')), namespace: 'raw-styles' }))
          builder.onResolve({ filter: /\.woff2\?inline$/ }, args => ({ path: path.join(projectRoot, 'node_modules', args.path.replace(/\?inline$/, '')), namespace: 'inline-font' }))
          builder.onLoad({ filter: /.*/, namespace: 'inline-font' }, async args => ({ contents: `export default ${JSON.stringify('data:font/woff2;base64,' + (await readFile(args.path)).toString('base64'))}` }))
          builder.onLoad({ filter: /.*/, namespace: 'raw-styles' }, async args => ({ contents: `export default ${JSON.stringify(await readFile(args.path, 'utf8'))}` }))
          builder.onResolve({ filter: /^virtual:tideui-html-runtime$/ }, () => ({ path: 'widgets', namespace: 'widget-runtime' }))
          builder.onLoad({ filter: /.*/, namespace: 'widget-runtime' }, async () => {
            const runtime = await buildTideHtmlRuntime(projectRoot)
            return { contents: `export const script=${JSON.stringify(runtime.script)};export const styles=${JSON.stringify(runtime.styles)};` }
          })
          builder.onLoad({ filter: /.*/, namespace: 'unused-worker' }, () => ({
            contents: 'export default class { constructor() { throw new Error("Unexpected editor worker in TideUI test") } }',
          }))
          builder.onLoad({ filter: /TideUI(Block|Renderer|Charts|HtmlPreview)\.tsx$/ }, async args => {
            const component = path.basename(args.path, '.tsx')
            const source = await readFile(args.path, 'utf8')
            // Count function executions, including renders that mutate no DOM.
            const contents = source.replace(/^( {2}const )/m,
              `  window.__renders.${component} = (window.__renders.${component} || 0) + 1\n$1`)
            assert.notEqual(contents, source)
            return { contents, loader: 'tsx' }
          })
        },
      }],
    })
    const { compile } = await import('@tailwindcss/node')
    const { Scanner } = await import('@tailwindcss/oxide')
    const cssSource = (await readFile(path.join(projectRoot, 'src/index.css'), 'utf8'))
      .replace("@import '@fontsource-variable/google-sans-flex';", '')
    const compiler = await compile(cssSource, { base: path.join(projectRoot, 'src'), onDependency: () => {} })
    const scanner = new Scanner({ sources: [{ base: path.join(projectRoot, 'src'), pattern: '**/*.{ts,tsx}', negated: false }] })
    const candidates = [...scanner.scan(), ...scanner.scanFiles([{ content: renderer, extension: 'tsx' }])]
    await writeFile(path.join(directory, 'style.css'), compiler.build(candidates))
    await writeFile(path.join(directory, 'index.html'), '<html><head><link rel="stylesheet" href="style.css"><style>html,body{margin:0}#root{display:flex;flex-direction:column;width:600px;height:320px}</style></head><body><div id="root"></div><script>window.tidecodeApp={}</script><script src="renderer.js"></script></body></html>')
    const environment = { ...process.env }
    delete environment.ELECTRON_RUN_AS_NODE
    const child = spawn(require('electron'), [path.join(import.meta.dirname, 'fixtures/tideuiRenderingStability.electron.cjs'), directory], {
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString() })
    child.stderr.on('data', chunk => { output += chunk.toString() })
    const timeout = setTimeout(() => child.kill(), 45000)
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', resolve)
    }).finally(() => clearTimeout(timeout))
    assert.equal(exitCode, 0, output)
    assert.match(output, /TIDEUI_STABILITY_PASS/)
  } finally {
    // mkdtemp returns an absolute task-owned directory under the OS temp path.
    assert.equal(path.dirname(directory), path.resolve(tmpdir()))
    assert.ok(path.basename(directory).startsWith('tidecode-tideui-stability-'))
    await rm(directory, { recursive: true, force: true })
  }
})
