import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(import.meta.dirname, '../../..')

// Opt-in native checks use a hidden window and never take desktop focus.
test('Browser retains sessions, restores its sidebar, and respects chat-safe panel resizing', {
  timeout: 60000,
  skip: process.env.TIDECODE_RUN_NATIVE_BROWSER_TESTS !== '1',
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tidecode-panel-layout-'))
  try {
    const renderer = `
      import React, { useState } from 'react'
      import { createRoot } from 'react-dom/client'
      import { BrowserWorkspacePanel } from './src/components/browser/BrowserWorkspacePanel'
      import { ConversationDiffPanel } from './src/components/chat/ConversationDiffPanel'
      import { useResizableChatPanel } from './src/pages/chatInterface/useResizableChatPanel'
      import { useWorkspaceExplorerResize } from './src/components/workspaceExplorer/workspaceExplorerPanel/useWorkspaceExplorerResize'
      import { useSourceControlPanelSizing } from './src/components/sourceControl/useSourceControlPanelSizing'
      import { ResizableSidebarPanel } from './src/components/sidebar/ResizableSidebarPanel'
      import { getMaxSidebarWidthForContent } from './src/lib/sidebarSizing'
      window.tidecodeBrowserDevTools = {
        onClosed: () => () => {}, onShortcut: () => () => {},
        close: async () => true, setVisible: async () => true,
      }
      window.tidecodeBrowserPageActions = {
        onZoomRequest: () => () => {}, registerAgentTab: async () => {},
        onAgentTabTermination: () => () => {},
      }
      function OtherPanel({ mode, width, setWidth }) {
        const explorer = useWorkspaceExplorerResize({ isOpen: mode === 'explorer', presentation: 'desktop', width, onWidthChange: setWidth, onWidthCommit: setWidth })
        const source = useSourceControlPanelSizing({ isOpen: mode === 'source', width, onWidthChange: setWidth, onWidthCommit: setWidth, isHistorySectionOpen: false, shouldUseSplitLayout: false })
        if (mode !== 'source' && mode !== 'explorer') return null
        const state = mode === 'source' ? source : explorer
        return <aside ref={state.panelRef} style={{ width: state.renderedWidth }} className="relative h-full shrink-0">
          <div role="separator" aria-label={mode === 'source' ? 'Resize source control panel' : 'Resize explorer panel'} onPointerDown={state.handleResizePointerDown} className="absolute inset-y-0 left-0 z-20 w-3 cursor-col-resize" />
        </aside>
      }
      function Fixture() {
        const [mode, setMode] = useState('browser')
        const [mainBrowser, setMainBrowser] = useState(false)
        const [project, setProject] = useState('a')
        const [agentTab, setAgentTab] = useState(null)
        const [width, setWidth] = useState(448)
        const [editor, setEditor] = useState(false)
        const [sidebarWidth, setSidebarWidth] = useState(336)
        const sideBrowser = mode === 'browser' && !mainBrowser
        const chat = useResizableChatPanel(sideBrowser ? width : 0)
        window.fixture = { setMode, setProject, setAgentTab, setEditor, getWidth: () => width }
        return <ResizableSidebarPanel isSidebarOpen sidebar={<div />} sidebarWidth={sidebarWidth} onSidebarWidthChange={setSidebarWidth}
          getMaxResizeWidth={(current) => {
            const editorWidth = document.querySelector('[data-workspace-editor]')?.getBoundingClientRect().width ?? 0
            return getMaxSidebarWidthForContent(current, chat.chatPanelRef.current.getBoundingClientRect().width + Math.max(0, editorWidth - 200), 512)
          }}>
          <div id="workspace" className="relative flex min-w-0 flex-1 overflow-hidden">
            <div data-chat-panel data-terminal-dock-container data-fixed-width={editor ? 'true' : 'false'} ref={chat.chatPanelRef}
              className="relative flex min-h-0 min-w-0 flex-col overflow-hidden has-[[data-browser-fullscreen=true]]:static" style={{ minWidth: 512, flex: editor ? 'none' : '1', width: editor ? chat.chatPanelWidth + (sideBrowser ? width : 0) : undefined, maxWidth: editor ? 'calc(100% - 200px)' : undefined }}>
              {editor && <div role="separator" aria-label="Resize chat panel" onPointerDown={chat.handleChatResizePointerDown} className="absolute inset-y-0 right-0 z-30 w-2 cursor-col-resize" />}
              <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                <div data-chat-panel className="min-w-[512px] flex-1" style={{display: mainBrowser ? 'none' : undefined}} />
                <BrowserWorkspacePanel agentTab={agentTab} active={mode === 'browser' || mainBrowser} isInMainPanel={mainBrowser}
                  onTogglePlacement={() => { setMainBrowser(value => !value); setMode('browser') }}
                  onClose={() => { setMode('none'); setMainBrowser(false) }} projectKey={project} width={width} onWidthChange={setWidth} onWidthCommit={setWidth} />
              </div>
            </div>
            {editor && <section data-workspace-editor className="min-w-[200px] flex-1" />}
            {mode === 'diff' && <ConversationDiffPanel isOpen currentBranch="main" expandedFilePaths={[]} fileDiffs={[]} onDiscardFile={async () => {}} onExpandedFilePathsChange={() => {}} onStageFile={async () => {}} onUnstageFile={async () => {}} onSelectedScopeChange={() => {}} onWidthChange={setWidth} onWidthCommit={setWidth} pendingFileActionPath={null} selectedScope="unstaged" width={width} />}
            <OtherPanel mode={mode} width={width} setWidth={setWidth} />
          </div>
        </ResizableSidebarPanel>
      }
      createRoot(document.getElementById('root')).render(<Fixture />)
    `
    await build({
      stdin: { contents: renderer, resolveDir: projectRoot, loader: 'tsx' },
      outfile: path.join(directory, 'renderer.js'),
      bundle: true,
      loader: { '.ttf': 'dataurl' },
      // Empty diff panels do not initialize editors or their Vite-only workers.
      plugins: [{ name: 'unused-vite-workers', setup(builder) {
        builder.onResolve({ filter: /\?worker$/ }, () => ({ path: 'worker', namespace: 'unused-worker' }))
        builder.onLoad({ filter: /.*/, namespace: 'unused-worker' }, () => ({ contents: 'export default class { constructor() { throw new Error("Unexpected editor worker in panel layout test") } }' }))
      } }],
      platform: 'browser',
      jsx: 'automatic',
      define: { 'import.meta.env.BASE_URL': '"/"' },
    })
    const { compile } = await import('@tailwindcss/node')
    const { Scanner } = await import('@tailwindcss/oxide')
    const cssSource = (await readFile(path.join(projectRoot, 'src/index.css'), 'utf8'))
      .replace("@import '@fontsource-variable/google-sans-flex';", '')
    const compiler = await compile(cssSource, { base: path.join(projectRoot, 'src'), onDependency: () => {} })
    const scanner = new Scanner({ sources: [{ base: path.join(projectRoot, 'src'), pattern: '**/*.{ts,tsx}', negated: false }] })
    const candidates = [...scanner.scan(), ...scanner.scanFiles([{ content: renderer, extension: 'tsx' }])]
    await writeFile(path.join(directory, 'style.css'), compiler.build(candidates))
    await writeFile(path.join(directory, 'index.html'), '<html><head><link rel="stylesheet" href="style.css"><style>html,body,#root{height:100%;margin:0}#root{display:flex}</style></head><body><div id="root"></div><script src="renderer.js"></script></body></html>')
    // Electron resolves its built-in module when launched with its own executable.
    await writeFile(path.join(directory, 'main.cjs'), `
      const { app, BrowserWindow } = require('electron')
      const assert = require('node:assert/strict')
      const path = require('node:path')
      const pause = () => new Promise(resolve => setTimeout(resolve, 120))
      app.whenReady().then(async () => {
        const window = new BrowserWindow({ show: false, width: 1600, height: 900, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, offscreen: true } })
        window.webContents.on('console-message', (event) => console.log('renderer:', event.message))
        const run = async code => {
          try { return await window.webContents.executeJavaScript(code) }
          catch (error) { console.error('Failed renderer operation:', code); throw error }
        }
        const count = selector => run('document.querySelectorAll(' + JSON.stringify(selector) + ').length')
        const box = selector => run('JSON.parse(JSON.stringify(document.querySelector(' + JSON.stringify(selector) + ').getBoundingClientRect()))')
        const click = async selector => { await run('document.querySelector(' + JSON.stringify(selector) + ').click()'); await pause() }
        const checkLayout = async () => {
          const chat = await box('[data-chat-panel]')
          const workspace = await box('#workspace')
          assert(chat.width >= 512, 'chat retains usable width')
          if (await count('[data-workspace-editor]')) {
            assert((await box('[data-workspace-editor]')).width >= 200, 'editor retains its minimum width')
          }
          const right = await run('Math.max(...Array.from(document.querySelector("#workspace").children).filter(element => getComputedStyle(element).position !== "absolute").map(element => element.getBoundingClientRect().right))')
          assert(right <= workspace.right + 1, 'panels fit the workspace: ' + right + ' > ' + workspace.right)
        }
        const change = async code => { await run(code); await pause(); await checkLayout() }
        const assertSharedWidth = async mode => {
          const labels = {
            browser: 'Resize browser panel',
            diff: 'Resize diff panel',
            source: 'Resize source control panel',
            explorer: 'Resize explorer panel',
          }
          const selector = '[aria-label=' + JSON.stringify(labels[mode]) + ']'
          const panelWidth = await run('document.querySelector(' + JSON.stringify(selector) + ').parentElement.getBoundingClientRect().width')
          const sharedWidth = await run('window.fixture.getWidth()')
          assert(Math.abs(panelWidth - sharedWidth) < 1, mode + ' should use shared panel width: ' + panelWidth + ' != ' + sharedWidth)
        }
        const drag = async (selector, delta) => {
          const rect = await box(selector)
          const x = Math.round(rect.x + rect.width / 2)
          const y = Math.round(rect.y + rect.height / 2)
          window.webContents.sendInputEvent({ type: 'mouseMove', x, y })
          window.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
          await pause()
          window.webContents.sendInputEvent({ type: 'mouseMove', x: x + delta, y, movementX: delta })
          await pause()
          const during = await box('[data-chat-panel]')
          window.webContents.sendInputEvent({ type: 'mouseUp', x: x + delta, y, button: 'left', clickCount: 1 })
          await pause()
          const after = await box('[data-chat-panel]')
          assert(after.width >= 512, 'chat must retain its minimum width')
          await checkLayout()
          assert(Math.abs(during.width - after.width) < 1, 'releasing ' + selector + ' must not shift chat: ' + during.width + ' -> ' + after.width)
        }
        try {
          await window.loadFile(path.join(__dirname, 'index.html'))
          await pause()
          assert(await count('[aria-label="Resize browser panel"]') > 0, 'Browser opens in sidebar mode')
          await assertSharedWidth('browser')
          const before = await box('[aria-label="Resize browser panel"]')
          const newTab = await box('[aria-label="New browser tab"]')
          const fullscreen = await box('[aria-label="Fullscreen browser"]')
          assert.equal(newTab.width, 28)
          assert.equal(newTab.height, 28)
          assert.equal(newTab.y, fullscreen.y, 'header actions are aligned')
          await click('[aria-label="New browser tab"]')
          assert.equal((await box('[aria-label="New browser tab options"]')).width, 176, 'new-tab dropdown uses the compact width')
          await click('[aria-label="New browser tab options"] button')
          assert.equal(await count('[aria-label="Close New Tab"]'), 2)
          await click('[aria-label="Fullscreen browser"]')
          assert.equal(await count('[aria-label="Resize browser panel"]'), 0)
          assert.equal(await run('getComputedStyle(document.querySelector("[data-browser-placement]")).borderLeftWidth'), '0px', 'fullscreen browser has no left divider')
          await click('[aria-label="Exit fullscreen browser"]')
          assert.equal((await box('[aria-label="Resize browser panel"]')).x, before.x)
          assert.equal(await run('getComputedStyle(document.querySelector("[data-browser-placement]")).borderLeftWidth'), '1px', 'restoring browser brings back the sidebar divider')
          await run('window.retainedBrowserPanel = document.querySelector(' + JSON.stringify('[aria-label="Browser menu"]') + ').parentElement.parentElement; undefined')
          await click('[aria-label="Browser menu"]')
          await run('Array.from(document.querySelectorAll(' + JSON.stringify('[aria-label="Browser actions"] button') + ')).find(button => button.textContent === "Open in main panel").click()')
          await pause()
          assert.equal(await count('[aria-label="Browser actions"]'), 0, 'moving to main panel dismisses the menu')
          assert.equal(await count('[aria-label="Resize browser panel"]'), 0)
          const mainPanel = await box('[data-browser-placement="main"]')
          const mainWorkspace = await box('#workspace')
          assert.equal(mainPanel.width, mainWorkspace.width, 'browser fills the main workspace')
          assert.equal(mainPanel.x, mainWorkspace.x, 'browser starts at the main workspace edge')
          assert.equal(await count('[aria-label="Close New Tab"]'), 2, 'moving retains browser tabs')
          for (const mode of ['explorer', 'source', 'diff']) {
            await change('window.fixture.setMode(' + JSON.stringify(mode) + ')')
            const browser = await box('[data-browser-placement="main"]')
            assert.equal(await run('document.querySelector("[data-browser-placement]").getAttribute("aria-hidden")'), 'false', mode + ' keeps Browser open')
            assert(browser.width >= 512, mode + ' preserves main panel space')
            assert(browser.right < (await box('#workspace')).right, mode + ' occupies a separate side panel')
            assert.equal(await count('[aria-label="Close New Tab"]'), 2)
          }
          await click('[aria-label="Fullscreen browser"]')
          assert.equal((await box('[data-browser-fullscreen="true"]')).width, mainWorkspace.width, 'fullscreen remains independent from placement')
          await click('[aria-label="Exit fullscreen browser"]')
          await click('[aria-label="Browser menu"]')
          await run('Array.from(document.querySelectorAll(' + JSON.stringify('[aria-label="Browser actions"] button') + ')).find(button => button.textContent === "Move to side panel").click()')
          await pause()
          assert.equal(await count('[aria-label="Browser actions"]'), 0, 'returning to side panel dismisses the menu')
          assert.equal((await box('[aria-label="Resize browser panel"]')).x, before.x, 'menu restores the side panel width')
          assert(await run('window.retainedBrowserPanel === document.querySelector(' + JSON.stringify('[aria-label="Browser menu"]') + ').parentElement.parentElement'), 'moving keeps the browser mounted')
          await change('window.fixture.setMode("diff")')
          await assertSharedWidth('diff')
          assert.equal(await count('[aria-label="Resize browser panel"]'), 0)
          await click('[aria-label="Fullscreen diff panel"]')
          await click('[aria-label="Exit fullscreen diff panel"]')
          await change('window.fixture.setMode("browser")')
          await assertSharedWidth('browser')
          assert.equal(await count('[aria-label="Close New Tab"]'), 2, 'switching panels retains tabs')
          await drag('[aria-label="Resize browser panel"]', -700)
          await assertSharedWidth('browser')
          await change('window.fixture.setEditor(true)')
          await drag('[aria-label="Resize chat panel"]', -400)
          await drag('[aria-label="Resize browser panel"]', 400)
          const smallerBrowserWidth = await run('window.fixture.getWidth()')
          await drag('[aria-label="Resize browser panel"]', -100)
          assert(await run('window.fixture.getWidth()') > smallerBrowserWidth, 'side Browser can grow into available editor space')
          await drag('[aria-label="Resize chat panel"]', 300)
          await drag('[aria-label="Resize browser panel"]', -400)
          await drag('[aria-label="Resize sidebar"]', 400)
          for (const mode of ['diff', 'source', 'explorer']) {
            await change('window.fixture.setMode(' + JSON.stringify(mode) + ')')
            await assertSharedWidth(mode)
            const resizeHandle = mode === 'diff'
              ? '[aria-label="Resize diff panel"]'
              : mode === 'source'
                ? '[aria-label="Resize source control panel"]'
                : '[aria-label="Resize explorer panel"]'
            await drag(resizeHandle, -400)
            await assertSharedWidth(mode)
          }
          await change('window.fixture.setMode("browser"); window.fixture.setEditor(false)')
          await click('[aria-label="Close New Tab"]')
          await click('[aria-label="Close New Tab"]')
          assert.equal(await count('[aria-label="Resize browser panel"]'), 0, 'last tab closes the panel')
          await change('window.fixture.setMode("browser")')
          await assertSharedWidth('browser')
          assert.equal(await count('[aria-label="Close New Tab"]'), 1, 'reopening creates one fresh tab')
          await change('window.fixture.setAgentTab({tabId:"fixture-ai-tab",projectPath:"a",url:"http://localhost:3000/"})')
          assert.equal(await count('[aria-label="AI browser tab"]'), 1, 'AI tab appears in the native tab strip')
          assert.equal(await count('webview[src="http://localhost:3000/"]'), 1, 'AI tab owns exactly one webview')
          await change('window.fixture.setProject("b")')
          await change('window.fixture.setProject("c")')
          assert.equal(await count('[aria-label="Close New Tab"]'), 2, 'only two project sessions are retained')
          console.log('PANEL_LAYOUT_OK')
          app.exit(0)
        } catch (error) { console.error(error); app.exit(1) }
      })
    `)
    const environment = { ...process.env }
    delete environment.ELECTRON_RUN_AS_NODE
    const child = spawn(require('electron'), [path.join(directory, 'main.cjs')], {
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    const timeout = setTimeout(() => child.kill(), 45000)
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject)
      child.on('exit', resolve)
    })
    clearTimeout(timeout)
    assert.equal(exitCode, 0, output)
    assert.match(output, /PANEL_LAYOUT_OK/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
