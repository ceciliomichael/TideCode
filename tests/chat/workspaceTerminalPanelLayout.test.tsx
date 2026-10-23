import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(import.meta.dirname, '../..')

test('terminal docking preserves layout and host while terminal/Explorer tabs scroll with deduplicated edges', {
  timeout: 60000,
  skip: process.env.TIDECODE_RUN_NATIVE_BROWSER_TESTS !== '1',
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tidecode-terminal-layout-'))
  try {
    const renderer = `
      import React, { useLayoutEffect, useRef, useState } from 'react'
      import { createRoot } from 'react-dom/client'
      import { WorkspaceTerminalPanelView } from './src/components/chat/workspaceTerminalPanel/WorkspaceTerminalPanelView'
      import { useWorkspaceTerminalPanelSizing } from './src/components/chat/workspaceTerminalPanel/useWorkspaceTerminalPanelSizing'
      import { useResizableChatPanel } from './src/pages/chatInterface/useResizableChatPanel'
      import { WorkspaceFileTabsPanel } from './src/components/workspaceExplorer/WorkspaceFileTabsPanel'
      import { useChatWorkspacePanelActions } from './src/pages/chatInterface/useChatWorkspacePanelActions'
      import { useWorkspaceExplorerResize } from './src/components/workspaceExplorer/workspaceExplorerPanel/useWorkspaceExplorerResize'
      import { ResizableSidebarPanel } from './src/components/sidebar/ResizableSidebarPanel'
      import { WorkspacePanel } from './src/components/layout/WorkspacePanel'
      window.switchSnapshots = []
      window.fixtureErrors = []
      const originalError = console.error
      console.error = (...args) => { window.fixtureErrors.push(args.join(' ')); originalError(...args) }
      function Explorer({isOpen, width, onWidthChange}) {
        const sizing = useWorkspaceExplorerResize({isOpen, presentation: 'desktop', width, onWidthChange, onWidthCommit: onWidthChange})
        if (!isOpen) return null
        return <aside data-explorer-panel ref={sizing.panelRef} style={{width: sizing.renderedWidth}} className="relative h-full shrink-0 border-l border-border bg-background">Explorer</aside>
      }
      function Fixture() {
        const [position, setPosition] = useState('bottom')
        const [activeFile, setActiveFile] = useState('file-0')
        const [height, setHeight] = useState(260)
        const [width, setWidth] = useState(448)
        const [isFullScreen, setFullScreen] = useState(false)
        const [editor, setEditor] = useState(false)
        const [availableWidth, setAvailableWidth] = useState(1400)
        const [isOpen, setOpen] = useState(true)
        const [isExplorerOpen, setExplorerOpen] = useState(false)
        const [isSidebarOpen, setSidebarOpen] = useState(false)
        const restoreRef = useRef(null)
        const [committed, setCommitted] = useState(null)
        const chat = useResizableChatPanel(position === 'right' && !isFullScreen ? width : 0)
        const terminalHostRef = useRef(null)
        const sizing = useWorkspaceTerminalPanelSizing({
          position, isOpen, isFullScreen, storedHeight: height, panelWidth: width,
          onHeightCommit: size => { setHeight(size); setCommitted(size) },
          onWidthChange: setWidth, onWidthCommit: size => { setWidth(size); setCommitted(size) },
        })
        const noop = () => {}
        const actions = useChatWorkspacePanelActions({
          isExplorerOpen, isRightPanelOpen: false, isSidebarOpen, isWorkspaceTabsPanelVisible: editor,
          terminalPanelPosition: position, rightPanelTab: 'diff',
          setIsExplorerOpen: setExplorerOpen, setIsTerminalOpen: setOpen, setIsSidebarOpen: setSidebarOpen,
          setIsTerminalFullScreen: setFullScreen, setIsWorkspaceTabsPanelVisible: setEditor,
          sidebarPanelRestoreRef: restoreRef, workspaceFileTabCount: 0,
          onRightPanelOpenChange: noop, onRightPanelTabChange: noop,
          onDiffPanelWidthChange: noop, onDiffPanelWidthCommit: noop, setConversationDiffPanelWidth: setWidth,
          onUpdateSettings: noop, setWorkspaceExplorerWidth: noop, settings: {},
        })
        window.fixture = { setEditor, setAvailableWidth, setOpen, setPosition, setSidebarOpen, getCommitted: () => committed }
        const right = isOpen && position === 'right' && !isFullScreen
        useLayoutEffect(() => {
          window.switchSnapshots.push({isOpen, isExplorerOpen, isSidebarOpen})
        }, [isOpen, isExplorerOpen, isSidebarOpen])
        return <div className="flex" style={{width: availableWidth, height: 700}}>
        <ResizableSidebarPanel isSidebarOpen={isSidebarOpen} sidebarWidth={240} onSidebarWidthChange={noop} sidebar={<div>Sidebar</div>}>
        <WorkspacePanel isSidebarOpen={isSidebarOpen} showRightBorder={false}>
        <div id="workspace" style={{width: '100%', height: '100%'}} className="relative flex overflow-hidden">
          <button aria-label="Toggle Explorer" onClick={actions.handleToggleExplorerPanel} className="absolute right-4 top-12 z-50">Explorer</button>
          <div id="chat-area" ref={chat.chatPanelRef} data-chat-panel data-terminal-dock-container data-fixed-width={editor ? "true" : "false"} className={'relative flex min-h-0 min-w-0 overflow-hidden ' + (right ? 'flex-row' : 'flex-col')}
            style={editor ? {width: chat.chatPanelWidth + (right ? width : 0), maxWidth: right ? 'calc(100% - 200px)' : undefined, minWidth: 512, flexShrink: 0} : {flex: 1, minWidth: 512}}>
            {editor && <div aria-label="Resize chat panel" onPointerDown={chat.handleChatResizePointerDown} className="absolute inset-y-0 right-0 z-30 w-2 cursor-col-resize" />}
            <div data-chat-panel className="flex-1 min-h-0" style={{display: isFullScreen ? 'none' : undefined, minWidth: right ? 512 : undefined}} />
            <WorkspaceTerminalPanelView panelState={{
              ...sizing, position, onPositionChange: next => {setPosition(next); setFullScreen(false)},
              isFullScreen, onFullScreenChange: setFullScreen,
              terminalHostRef, activeTerminalTab: null, activeTerminalTabKey: null, autoCreateTabOnOpen: false,
              terminalTabs: Array.from({length: 8}, (_, i) => ({key: String(i), label: 'Terminal ' + i, status: 'ready'})),
              closeTerminalTab: noop, clearTerminalTab: noop, restartTerminalTab: noop, openTerminalTab: noop,
              onClose: noop, reorderTerminalTabs: noop, selectTerminalTab: noop,
            }} />
          </div>
          {editor && <WorkspaceFileTabsPanel
            activeTabKey={activeFile} isOpen gitFileDiffs={[]} hasRepository={false}
            tabs={Array.from({length: 12}, (_, i) => ({kind: 'file', tabKey: 'file-' + i, relativePath: 'file-' + i + '.ts', fileName: 'file-' + i + '.ts', status: 'loading'}))}
            onCloseTab={noop} onFileContentChange={noop} onPlanCommentsChange={noop}
            onImplementPlan={noop} onOpenFile={noop} onOpenMarkdownPreview={noop}
            onOpenSvgPreview={noop} onRequestPlanChanges={noop} planCommentsByPath={{}}
            onSelectTab={setActiveFile} wordWrapEnabled={false}
          />}
          <Explorer isOpen={isExplorerOpen} width={width} onWidthChange={setWidth} />
        </div>
        </WorkspacePanel>
        </ResizableSidebarPanel>
        </div>
      }
      createRoot(document.getElementById('root')).render(<Fixture />)
    `
    await build({
      stdin: { contents: renderer, resolveDir: projectRoot, loader: 'tsx' },
      outfile: path.join(directory, 'renderer.js'), bundle: true, platform: 'browser', jsx: 'automatic',
      define: { 'import.meta.env.BASE_URL': '"/"' },
      loader: { '.ttf': 'dataurl' },
      plugins: [{ name: 'tab-strip-content', setup(builder) {
        // Exercise Explorer's real tab strip without initializing document editors.
        builder.onResolve({ filter: /workspaceFileTabsPanel\/WorkspaceFileTabsPanelContent$/ }, () => ({ path: 'content', namespace: 'tab-content' }))
        builder.onLoad({ filter: /.*/, namespace: 'tab-content' }, () => ({ contents: 'export const WorkspaceFileTabsPanelContent = () => null' }))
      } }, { name: 'unused-vite-workers', setup(builder) {
        builder.onResolve({ filter: /\?worker$/ }, () => ({ path: 'worker', namespace: 'unused-worker' }))
        builder.onLoad({ filter: /.*/, namespace: 'unused-worker' }, () => ({ contents: 'export default class {}' }))
      } }],
    })
    const { compile } = await import('@tailwindcss/node')
    const { Scanner } = await import('@tailwindcss/oxide')
    const cssSource = (await readFile(path.join(projectRoot, 'src/index.css'), 'utf8'))
      .replace("@import '@fontsource-variable/google-sans-flex';", '')
    const compiler = await compile(cssSource, { base: path.join(projectRoot, 'src'), onDependency: () => {} })
    const scanner = new Scanner({ sources: [{ base: path.join(projectRoot, 'src'), pattern: '**/*.{ts,tsx}', negated: false }] })
    await writeFile(path.join(directory, 'style.css'), compiler.build([...scanner.scan(), ...scanner.scanFiles([{ content: renderer, extension: 'tsx' }])]))
    await writeFile(path.join(directory, 'index.html'), '<html><head><link rel="stylesheet" href="style.css"><style>html,body,#root{margin:0;height:100%}</style></head><body><div id="root"></div><script src="renderer.js"></script></body></html>')
    await writeFile(path.join(directory, 'main.cjs'), `
      const { app, BrowserWindow } = require('electron')
      const assert = require('node:assert/strict')
      const path = require('node:path')
      const pause = () => new Promise(resolve => setTimeout(resolve, 100))
      app.setPath('userData', path.join(__dirname, 'profile'))
      app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, width: 1600, height: 900, webPreferences: {nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, offscreen: true}})
        win.webContents.on('console-message', event => console.log('renderer:', event.message))
        const run = async code => {
          try { return await win.webContents.executeJavaScript(code) }
          catch (error) { console.error('Failed renderer operation:', code); throw error }
        }
        const box = selector => run('JSON.parse(JSON.stringify(document.querySelector(' + JSON.stringify(selector) + ').getBoundingClientRect()))')
        const click = async label => { await run('document.querySelector(' + JSON.stringify('[aria-label="' + label + '"]') + ').click()'); await pause() }
        const drag = async (dx, dy, label = 'Resize terminal panel') => {
          const rect = await box('[aria-label="' + label + '"]')
          const x = Math.round(rect.x + rect.width / 2)
          const y = Math.round(rect.y + rect.height / 2)
          win.webContents.sendInputEvent({type: 'mouseMove', x, y})
          win.webContents.sendInputEvent({type: 'mouseDown', x, y, button: 'left', clickCount: 1})
          await pause()
          win.webContents.sendInputEvent({type: 'mouseMove', x: x + dx, y: y + dy, movementX: dx, movementY: dy})
          await pause()
          const before = await box('section')
          win.webContents.sendInputEvent({type: 'mouseUp', x: x + dx, y: y + dy, button: 'left', clickCount: 1})
          await pause()
          const after = await box('section')
          assert(Math.abs(before.width - after.width) < 1 && Math.abs(before.height - after.height) < 1, 'release preserves panel bounds')
          return after
        }
        try {
          await win.loadFile(path.join(__dirname, 'index.html'))
          await pause()
          await run('void (window.originalHost = document.querySelector(".workspace-terminal-host"))')
          assert.equal((await box('section')).height, 260)
          assert.equal(await run('getComputedStyle(document.querySelector("[data-terminal-tab-actions]").parentElement).borderTopWidth'), '0px', 'terminal header does not add a second top border')
          assert.equal((await drag(0, -100)).height, 360)
          assert.equal(await run('window.fixture.getCommitted()'), 360)
          await click('Move panel right')
          assert.equal((await box('section')).height, (await box('#workspace')).height)
          assert.equal((await box('section')).width, 448)
          await run('document.querySelector("section .workspace-tabs-scroll-viewport").dispatchEvent(new WheelEvent("wheel", {bubbles: true, cancelable: true, deltaY: 160}))')
          assert(await run('document.querySelector("section .workspace-tabs-scroll-viewport").scrollLeft > 0'), 'terminal wheel scrolls tabs horizontally')
          await run('void (document.querySelector("section .workspace-tabs-scroll-viewport").scrollLeft = 99999)')
          const terminalTabRight = await run('document.querySelector("section .workspace-tabs-scroll-viewport").lastElementChild.getBoundingClientRect().right')
          assert(Math.abs(terminalTabRight - (await box('[data-terminal-tab-actions]')).left - 1) < 1, 'terminal action divider overlaps the last tab border')
          assert.equal((await drag(-120, 0)).width, 568)
          assert.equal(await run('window.fixture.getCommitted()'), 568)
          assert.equal(await run('Array.from(document.querySelector("[data-terminal-tab-actions]").querySelectorAll("button")).at(-1).getAttribute("aria-label")'), 'Move panel bottom', 'docking action is the rightmost control')
          await run('window.fixture.setEditor(true); window.fixture.setAvailableWidth(1400)')
          await pause()
          await drag(-80, 0, 'Resize chat panel')
          await drag(0, 0)
          const dockWidth = (await box('section')).width
          assert((await drag(-50, 0)).width > dockWidth, 'right terminal grows beside an editor')
          await run('window.fixture.setAvailableWidth(1100)')
          await pause()
          const terminal = await box('section')
          await run('document.querySelector("[data-workspace-editor] .workspace-tabs-scroll-viewport").dispatchEvent(new WheelEvent("wheel", {bubbles: true, cancelable: true, deltaY: 160}))')
          assert(await run('document.querySelector("[data-workspace-editor] .workspace-tabs-scroll-viewport").scrollLeft > 0'), 'Explorer wheel scrolls tabs horizontally')
          await run('void (document.querySelector("[data-workspace-editor] .workspace-tabs-scroll-viewport").scrollLeft = 99999)')
          assert.equal(await run('document.querySelectorAll("[data-workspace-tab-edge]").length'), 0, 'Explorer has no separate fixed border beyond the tab separators')
          await run('document.querySelector("[data-workspace-editor] .workspace-tabs-scroll-viewport").lastElementChild.querySelector("button").click()')
          await pause()
          // Paint an adjacent panel divider and inspect actual pixels at the shared edge.
          await run(\`
            (() => {
              const editor = document.querySelector('[data-workspace-editor]')
              editor.style.setProperty('--color-border', 'rgb(255, 0, 0)')
              editor.style.setProperty('--color-brand', 'rgb(0, 255, 0)')
              const viewport = editor.querySelector('.workspace-tabs-scroll-viewport')
              const rect = viewport.getBoundingClientRect()
              const divider = document.createElement('div')
              divider.id = 'adjacent-panel-divider'
              Object.assign(divider.style, {position: 'fixed', left: rect.right + 'px', top: rect.top + 'px', width: '1px', height: rect.height + 'px', background: 'rgb(255, 0, 0)'})
              document.body.appendChild(divider)
            })()
          \`)
          await pause()
          const viewportEdge = await box('[data-workspace-editor] .workspace-tabs-scroll-viewport')
          const edgeImage = await win.webContents.capturePage({x: Math.round(viewportEdge.right) - 1, y: Math.round(viewportEdge.top) + 20, width: 2, height: 1})
          const indicatorImage = await win.webContents.capturePage({x: Math.round(viewportEdge.right) - 1, y: Math.round(viewportEdge.top), width: 1, height: 1})
          assert.deepEqual(Array.from(indicatorImage.toBitmap().subarray(0, 3)), [0, 255, 0], 'the last active tab highlight reaches the right edge without a gap')
          const edgePixels = edgeImage.toBitmap()
          assert.notDeepEqual(Array.from(edgePixels.subarray(0, 3)), [0, 0, 255], 'the tab border is clipped where it meets the panel divider')
          assert.deepEqual(Array.from(edgePixels.subarray(4, 7)), [0, 0, 255], 'the adjacent panel retains its single divider')
          await run('document.getElementById("adjacent-panel-divider").remove()')
          const editor = await box('[data-workspace-editor]')
          const workspace = await box('#workspace')
          assert((await box('[data-chat-panel]')).width >= 512, 'chat keeps minimum width')
          assert(editor.width >= 200, 'editor keeps minimum width')
          assert(editor.right <= workspace.right + 1, 'panels fit available space')
          await click('Full screen')
          assert.equal((await box('section')).height, (await box('#workspace')).height)
          assert.equal((await box('section')).width, (await box('#chat-area')).width)
          await click('Exit full screen')
          assert.equal((await box('section')).width, terminal.width)
          await run('window.fixture.setOpen(false)')
          await pause()
          assert.equal((await box('section')).width, 0)
          await run('window.fixture.setOpen(true)')
          await pause()
          await click('Move panel bottom')
          assert.equal((await box('section')).height, 360)
          assert(await run('window.originalHost === document.querySelector(".workspace-terminal-host")'), 'docking retains the mounted terminal host')
          const actions = await box('[data-terminal-tab-actions]')
          const edge = await run('getComputedStyle(document.querySelector("[data-terminal-tab-actions]")).borderLeftWidth')
          assert.equal(edge, '1px')
          assert(actions.width > 0)
          await run('window.fixture.setEditor(false); window.fixture.setAvailableWidth(1400); window.fixture.setPosition("right"); window.fixture.setOpen(true); window.fixture.setSidebarOpen(true)')
          await pause()
          await new Promise(resolve => setTimeout(resolve, 350))
          await run('void (window.switchSnapshots = [])')
          await run(\`
            window.frameSamples = []
            window.sampleFrames = true
            function sampleSwitchFrame() {
              const terminal = document.querySelector('.workspace-terminal-host').closest('section')
              const explorer = document.querySelector('[data-explorer-panel]')
              window.frameSamples.push({
                terminalVisible: terminal.getBoundingClientRect().width > 0,
                explorerVisible: Boolean(explorer && explorer.getBoundingClientRect().width > 0),
                chatWidth: document.querySelector('#chat-area [data-chat-panel]').getBoundingClientRect().width,
              })
              if (window.sampleFrames) requestAnimationFrame(sampleSwitchFrame)
            }
            requestAnimationFrame(sampleSwitchFrame)
          \`)
          await click('Toggle Explorer')
          await new Promise(resolve => setTimeout(resolve, 350))
          await run('void (window.sampleFrames = false)')
          const frames = await run('window.frameSamples')
          assert(frames.length > 2, 'the animated shell transition was sampled across frames')
          assert(frames.every(frame => frame.terminalVisible !== frame.explorerVisible), 'every sampled frame has exactly one right panel')
          assert(frames.every(frame => frame.chatWidth >= 512), 'chat does not squeeze below its minimum during the switch')
          const snapshots = await run('window.switchSnapshots')
          assert(snapshots.some(state => state.isExplorerOpen), 'Explorer opened')
          assert(snapshots.every(state => !(state.isExplorerOpen && state.isOpen)), 'no committed layout displays Explorer and the right terminal together')
          assert.equal(await run('getComputedStyle(document.querySelector("section")).display'), 'none', 'right terminal is hidden')
          assert((await box('[data-chat-panel]')).width >= 512, 'chat minimum survives the shell transition')
          assert.equal(await run('window.fixtureErrors.length'), 0, 'switching does not update other components during render')
          assert(await run('window.originalHost === document.querySelector(".workspace-terminal-host")'), 'switching to Explorer retains the terminal host')
          console.log('TERMINAL_LAYOUT_OK')
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
    assert.match(output, /TERMINAL_LAYOUT_OK/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
