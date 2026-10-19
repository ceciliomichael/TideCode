import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { build, transform } from 'esbuild'

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(import.meta.dirname, '../../..')

test(
  'browser menu works over a real guest with page zoom, session clearing, floating DevTools, and shared selector keyboard behavior',
  {
    timeout: 60000,
    skip: process.env.TIDECODE_RUN_NATIVE_BROWSER_TESTS !== '1',
  },
  async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), 'tidecode-browser-menu-'),
    )
    try {
      const renderer = `
      import React, { useState } from 'react'
      import { createRoot } from 'react-dom/client'
      import { BrowserPanel } from './src/components/browser/BrowserPanel'
      import { DropdownField } from './src/components/ui/DropdownField'
      const { ipcRenderer } = require('electron')
      window.tidecodeBrowserDevTools = {
        open: input => ipcRenderer.invoke('open-devtools', input),
        close: async () => true, onClosed: () => () => {},
        onShortcut: listener => {
          const wrapped = (_event, id) => listener(id)
          ipcRenderer.on('browser:devToolsShortcut', wrapped)
          return () => ipcRenderer.off('browser:devToolsShortcut', wrapped)
        },
      }
      window.tidecodeBrowserPageActions = {
        captureScreenshot: input => ipcRenderer.invoke('browser:captureScreenshot', input),
        screenshotAction: input => ipcRenderer.invoke('browser:screenshotAction', input),
        getZoom: input => ipcRenderer.invoke('browser:getZoom', input),
        setZoom: input => ipcRenderer.invoke('browser:setZoom', input),
        clearCookies: () => ipcRenderer.invoke('browser:clearCookies'),
        clearCache: () => ipcRenderer.invoke('browser:clearCache'),
      }
      function Fixture() {
        const [full, setFull] = useState(false)
        const [selection, setSelection] = useState('a')
        return <>
          <BrowserPanel active isFullScreen={full} onToggleFullScreen={() => setFull(value => !value)} onClose={() => {}} projectKey={${JSON.stringify(directory)}} />
          <div className="absolute bottom-4 left-4 z-20"><DropdownField ariaLabel="Test selector" value={selection} onChange={setSelection} options={[{label:'First',value:'a'},{label:'Second',value:'b'}]} /></div>
        </>
      }
      createRoot(document.getElementById('root')).render(<Fixture />)
    `
      await build({
        stdin: { contents: renderer, resolveDir: projectRoot, loader: 'tsx' },
        outfile: path.join(directory, 'renderer.js'),
        bundle: true,
        platform: 'browser',
        external: ['electron'],
        jsx: 'automatic',
        define: { 'import.meta.env.BASE_URL': '"/"' },
      })
      await build({
        entryPoints: [
          path.join(projectRoot, 'electron/browser/pageActions.ts'),
        ],
        outfile: path.join(directory, 'pageActions.cjs'),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['electron'],
      })
      const windowSource = await readFile(
        path.join(projectRoot, 'electron/window/createApplicationWindow.ts'),
        'utf8',
      )
      const floatingCode = await transform(
        windowSource.slice(
          windowSource.indexOf('const browserGuestFloatingDevTools'),
          windowSource.indexOf('function getInitialWindowBounds'),
        ),
        { loader: 'ts', format: 'cjs' },
      )
      const { compile } = await import('@tailwindcss/node')
      const { Scanner } = await import('@tailwindcss/oxide')
      const compiler = await compile(
        (
          await readFile(path.join(projectRoot, 'src/index.css'), 'utf8')
        ).replace("@import '@fontsource-variable/google-sans-flex';", ''),
        { base: path.join(projectRoot, 'src'), onDependency: () => {} },
      )
      const scanner = new Scanner({
        sources: [
          {
            base: path.join(projectRoot, 'src'),
            pattern: '**/*.{ts,tsx}',
            negated: false,
          },
        ],
      })
      await writeFile(
        path.join(directory, 'style.css'),
        compiler.build([
          ...scanner.scan(),
          ...scanner.scanFiles([{ content: renderer, extension: 'tsx' }]),
        ]),
      )
      await writeFile(
        path.join(directory, 'index.html'),
        '<html><head><link rel="stylesheet" href="style.css"><style>html,body,#root{height:100%;margin:0}#root{display:flex}</style></head><body><div id="root"></div><script src="renderer.js"></script></body></html>',
      )
      await writeFile(
        path.join(directory, 'main.cjs'),
        `
      const { app, BrowserWindow, ipcMain, webContents, session, clipboard, nativeImage, shell } = require('electron')
      const assert = require('node:assert/strict')
      const { writeFileSync, readFileSync, readdirSync } = require('node:fs')
      const path = require('node:path')
      const http = require('node:http')
      app.setPath('userData', path.join(__dirname, 'user-data'))
      function HiddenDevToolsWindow(options) {
        const nativeWindow = new BrowserWindow({ ...options, show: false })
        nativeWindow.show = () => {}
        nativeWindow.focus = () => {}
        return nativeWindow
      }
      const floatingModule = { exports: {} }
      ;(function(module, BrowserWindow) { ${floatingCode.code} })(floatingModule, HiddenDevToolsWindow)
      app.whenReady().then(async () => {
        let cacheRequests = 0
        let pendingPage
        let slowImage
        const server = http.createServer((request, response) => {
          if (request.url === '/redirect') {
            response.writeHead(302, { Location: '/pending' }); response.end()
          } else if (request.url === '/pending') {
            pendingPage = response
          } else if (request.url === '/slow-image') {
            slowImage = response
          } else if (request.url === '/favicon.ico') {
            response.writeHead(404); response.end()
          } else if (request.url === '/cache') {
            cacheRequests += 1
            response.setHeader('Cache-Control', 'public, max-age=3600')
            response.end('cached response ' + cacheRequests)
          } else {
            response.setHeader('Content-Type', 'text/html')
            response.setHeader('Set-Cookie', 'menu-test=present; Path=/')
            response.end('<html><body style="background:#ddd"><h1>Browser menu test page</h1></body></html>')
          }
        })
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
        const url = 'http://127.0.0.1:' + server.address().port
        const window = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { nodeIntegration: true, contextIsolation: false, webviewTag: true, offscreen: true, backgroundThrottling: false } })
        window.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message) })
        require('./pageActions.cjs').registerBrowserPageActions(() => window)
        let copiedScreenshot
        let copiedPath
        let revealedPath
        clipboard.writeText = text => { copiedPath = text }
        shell.showItemInFolder = filePath => { revealedPath = filePath }
        clipboard.writeImage = image => { copiedScreenshot = image.toPNG() }
        let guest
        let guestDomReady = false
        window.webContents.on('did-attach-webview', (_event, attached) => { guest = attached; attached.on('dom-ready', () => { guestDomReady = true }) })
        ipcMain.handle('open-devtools', async (event, input) => {
          assert.equal(event.sender, window.webContents)
          assert.equal(input.webContentsId, guest.id)
          assert.deepEqual(Object.keys(input), ['webContentsId'], 'no dock mode or bounds')
          await floatingModule.exports.openBrowserGuestDevTools(guest, window)
          return true
        })
        const run = async code => {
          try { return await window.webContents.executeJavaScript(code) }
          catch (error) { console.error('Failed renderer operation:', code); throw error }
        }
        const pause = () => new Promise(resolve => setTimeout(resolve, 60))
        const wait = async (check, label) => {
          const deadline = Date.now() + 10000
          while (!await check()) {
            assert(Date.now() < deadline, 'Timed out: ' + label)
            await pause()
          }
        }
        const click = async selector => { await run('document.querySelector(' + JSON.stringify(selector) + ').click()'); await pause() }
        const clickText = async label => { await run('Array.from(document.querySelectorAll("[aria-label=\\\\"Browser actions\\\\"] button")).find(button => (button.getAttribute("aria-label") || button.textContent.trim()) === ' + JSON.stringify(label) + ').click()'); await pause() }
        try {
          await window.loadFile(path.join(__dirname, 'index.html'))
          await wait(() => run('!!document.querySelector("[aria-label=\\\\"Browser menu\\\\"]")'), 'browser toolbar')
          await click('[aria-label="Browser menu"]')
          assert(await run('!document.querySelector("[aria-label=\\\\"Browser actions\\\\"]").textContent.includes("Profile")'))
          assert(await run('!document.querySelector("[aria-label=\\\\"Page zoom\\\\"]")'), 'new tabs hide the zoom row')
          assert(await run('Array.from(document.querySelectorAll("[aria-label=\\\\"Browser actions\\\\"] button")).every(button => !button.textContent.includes("Open DevTools"))'))
          await run('document.body.dispatchEvent(new MouseEvent("mousedown", {bubbles:true}))')
          await click('[aria-label="Fullscreen browser"]')
          await click('[aria-label="Exit fullscreen browser"]')
          await run('const input = document.querySelector("input[aria-label=\\\\"Search or enter address\\\\"]"); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(input, ' + JSON.stringify(url + '/redirect') + '); input.dispatchEvent(new Event("input", {bubbles:true}));')
          await pause()
          await run('document.querySelector("form").requestSubmit()')
          await wait(() => Boolean(pendingPage), 'redirect begins before HTML is available')
          assert(await run('document.querySelector(' + JSON.stringify('[aria-label="Screenshot"]') + ').disabled'), 'camera stays disabled before the first page document is ready')
          await click('[aria-label="Browser menu"]')
          assert(await run('!!document.querySelector("[aria-label=\\\\"Page zoom\\\\"]")'))
          assert(await run('!document.querySelector("[aria-label=\\\\"Zoom out\\\\"]").disabled'))
          await click('[aria-label="Zoom out"]')
          assert(await run('document.querySelector("[aria-label=\\\\"Page zoom\\\\"]").textContent.includes("90%")'), await run('document.querySelector("[aria-label=\\\\"Browser actions\\\\"]").textContent'))
          assert(guest.isLoading(), 'zoom is usable while the redirect is still loading')
          await click('[aria-label="Zoom in"]')
          await click('[aria-label="Zoom out"]')
          pendingPage.setHeader('Content-Type', 'text/html')
          pendingPage.setHeader('Set-Cookie', 'menu-test=present; Path=/')
          pendingPage.end('<html><body style="background:#ddd"><h1>Browser menu test page</h1><img src="/slow-image"></body></html>')
          await wait(() => Boolean(slowImage) && guestDomReady && Math.abs(guest.getZoomFactor() - .9) < .001, 'page renders while a resource is still loading')
          await wait(() => run('!document.querySelector(' + JSON.stringify('[aria-label="Screenshot"]') + ').disabled'), 'camera enables once the document is ready while resources are still loading')
          await pause()
          await run('document.body.dispatchEvent(new MouseEvent("mousedown", {bubbles:true}))')
          await click('[aria-label="Screenshot"]')
          await wait(() => run('!!document.querySelector(' + JSON.stringify('[aria-label="Browser screenshot notification"]') + ')'), 'screenshot saves before page finishes loading')
          assert(guest.isLoading(), 'screenshot does not wait for full loading')
          const earlyScreenshotFile = readdirSync(path.join(__dirname, '.tidecode', 'browser-screenshots'))[0]
          await click('[aria-label="Dismiss screenshot notification"]')

          slowImage.writeHead(404); slowImage.end()
          await wait(() => !guest.isLoading(), 'page finishes after screenshot')
          await click('[aria-label="Browser menu"]')

          await click('[aria-label="Reset page zoom"]')
          await wait(() => guest.getZoomFactor() === 1, 'initial reset')
          await run('document.querySelector("[aria-label=\\\\"Browser actions\\\\"] button").focus()')
          await run('document.querySelector("[aria-label=\\\\"Browser actions\\\\"]").dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowDown",bubbles:true}))')
          assert.equal(await run('document.activeElement.getAttribute("aria-label")'), 'Zoom out')
          const menuOverGuest = await run('const panel=document.querySelector("[aria-label=\\\\"Browser actions\\\\"]"); const rect=panel.getBoundingClientRect(); panel.contains(document.elementFromPoint(rect.x+20,rect.y+80))')
          assert(menuOverGuest, 'shared dropdown stays above the webpage')
          await click('[aria-label="Zoom in"]')
          await wait(() => Math.abs(guest.getZoomFactor() - 1.1) < .001, 'guest zoom')
          assert.equal(window.webContents.getZoomFactor(), 1)
          await click('[aria-label="Reset page zoom"]')
          await wait(() => guest.getZoomFactor() === 1, 'zoom reset')
          await run('document.body.dispatchEvent(new MouseEvent("mousedown", {bubbles:true}))')
          await click('[aria-label="Screenshot"]')
          await wait(() => run('!!document.querySelector(' + JSON.stringify('[aria-label="Browser screenshot notification"]') + ')'), 'saved screenshot toast')
          await run('(() => {const button=document.querySelector(' + JSON.stringify('[aria-label="Browser screenshot notification"] button') + '); button.matches=()=>true; button.dispatchEvent(new FocusEvent("focusin", {bubbles:true}))})()')
          const screenshotDirectory = path.join(__dirname, '.tidecode', 'browser-screenshots')
          const savedFiles = readdirSync(screenshotDirectory)
          assert.equal(savedFiles.length, 2)
          const loadedScreenshotFile = savedFiles.find(filename => filename !== earlyScreenshotFile)
          assert.match(loadedScreenshotFile, /^browser-screenshot-127-0-0-1-[a-z0-9]+-[a-f0-9]{8}\\.png$/)
          const screenshotPath = path.join(screenshotDirectory, loadedScreenshotFile)
          assert.equal(copiedScreenshot, undefined, 'saving does not copy the image automatically')
          const cameraRow = await run('(() => { const button=document.querySelector(' + JSON.stringify('[aria-label="Screenshot"]') + '); const input=document.querySelector(' + JSON.stringify('[aria-label="Search or enter address"]') + '); const camera=button.getBoundingClientRect(); const address=input.getBoundingClientRect(); return JSON.stringify({aligned:Math.abs(camera.y-address.y)<1, right:camera.x>=address.right}) })()')
          assert.deepEqual(JSON.parse(cameraRow), {aligned:true,right:true}, 'camera stays on the right of the URL row')
          const toastAction = async label => { await run('Array.from(document.querySelectorAll(' + JSON.stringify('[aria-label="Browser screenshot notification"] button') + ')).find(button => (button.getAttribute("aria-label") || button.textContent.trim()) === ' + JSON.stringify(label) + ').click()'); await pause() }
          await toastAction('Copy path')
          await wait(() => copiedPath === screenshotPath, 'path copied')
          assert(await run('!!document.querySelector(' + JSON.stringify('[aria-label="Copied path"]') + ')'), 'copy path confirms in the button')

          await toastAction('Reveal in File Explorer')
          await wait(() => revealedPath === screenshotPath, 'file revealed')
          assert(await run('!document.querySelector(' + JSON.stringify('[aria-label="Browser screenshot notification"]') + ').textContent.includes("Shown in File Explorer")'), 'reveal adds no success text')

          await new Promise(resolve => setTimeout(resolve, 600))
          await run('(() => { const original=window.tidecodeBrowserPageActions.screenshotAction; window.tidecodeBrowserPageActions.screenshotAction=async input=>{ if(input.action==="copyImage") { await new Promise(resolve=>{window.releaseImageCopy=resolve}); window.tidecodeBrowserPageActions.screenshotAction=original } return original(input) } })()')
          await toastAction('Copy image')
          assert(await run('(() => { const toast=document.querySelector(' + JSON.stringify('[aria-label="Browser screenshot notification"]') + '); const image=toast.querySelector(' + JSON.stringify('[aria-label="Copy image"]') + '); const others=Array.from(toast.querySelectorAll("button")).filter(button=>button!==image); return image.disabled && others.every(button=>!button.disabled && getComputedStyle(button).opacity==="1") })()'), 'pending copy image leaves all other buttons enabled and undimmed')
          await run('window.releaseImageCopy()')

          await wait(() => Boolean(copiedScreenshot), 'saved image copied')
          assert(await run('!!document.querySelector(' + JSON.stringify('[aria-label="Copied image"]') + ')'), 'copy image confirms in the button')
          assert(await run('!!document.querySelector(' + JSON.stringify('[aria-label="Copied path"]') + ')'), 'copy image does not reset copied path')
          await wait(() => run('!!document.querySelector(' + JSON.stringify('[aria-label="Copy path"]') + ')'), 'copy path label restores on its own timer')
          assert(await run('!!document.querySelector(' + JSON.stringify('[aria-label="Copied image"]') + ')'), 'path timer does not reset copied image')

          await wait(() => run('!!document.querySelector(' + JSON.stringify('[aria-label="Copy image"]') + ')'), 'copy image label restores')

          const screenshotBytes = readFileSync(screenshotPath)
          assert.deepEqual(copiedScreenshot, screenshotBytes)
          assert.equal(screenshotBytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
          const screenshotSize = nativeImage.createFromBuffer(screenshotBytes).getSize()
          await pause()
          const guestSize = await guest.executeJavaScript('({width:innerWidth,height:innerHeight})')
          assert.deepEqual(screenshotSize, guestSize, 'screenshot contains the webpage viewport only')
          window.setSize(240, 800)
          await pause()
          assert(await run('(() => { const toast=document.querySelector(' + JSON.stringify('[aria-label="Browser screenshot notification"]') + '); const rect=toast.getBoundingClientRect(); return rect.left>=0 && rect.right<=innerWidth && Array.from(toast.querySelectorAll("button")).every(button=>{ const bounds=button.getBoundingClientRect(); return bounds.left>=rect.left && bounds.right<=rect.right }) })()'), 'compact toast and actions fit a very narrow browser: ' + await run('(() => {const toast=document.querySelector(' + JSON.stringify('[aria-label="Browser screenshot notification"]') + '); return JSON.stringify({width:innerWidth,toast:toast.getBoundingClientRect().toJSON(),buttons:Array.from(toast.querySelectorAll("button")).map(button=>button.getBoundingClientRect().toJSON())})})()'))
          window.setSize(360, 800)
          await pause()
          assert(await run('(() => { const rect=document.querySelector(' + JSON.stringify('[aria-label="Browser screenshot notification"]') + ').getBoundingClientRect(); return rect.left>=0 && rect.right<=innerWidth })()'), 'toast fits a narrow window')
          assert(await run('(() => { const toast=document.querySelector(' + JSON.stringify('[aria-label="Browser screenshot notification"]') + '); const panel=toast.parentElement; const rect=toast.getBoundingClientRect(); const bounds=panel.getBoundingClientRect(); return panel.contains(document.querySelector(' + JSON.stringify('[aria-label="Search or enter address"]') + ')) && Math.abs(rect.top-bounds.top-56)<1 && rect.left>=bounds.left && rect.right<=bounds.right })()'), 'toast anchors to the top of the browser below the URL row')
          for (const theme of ['light', 'dark']) {
            await run('document.documentElement.dataset.theme=' + JSON.stringify(theme))
            await pause()
            assert(await run('(() => { const toast=document.querySelector(' + JSON.stringify('[aria-label="Browser screenshot notification"]') + '); const primary=Array.from(toast.querySelectorAll("button")).find(button=>button.getAttribute("aria-label")==="Copy image"); function token(name) { const probe=document.createElement("span"); probe.style.color="var("+name+")"; toast.append(probe); const color=getComputedStyle(probe).color; probe.remove(); return color } return getComputedStyle(toast).backgroundColor===token("--color-surface-raised") && getComputedStyle(toast).color===token("--color-foreground") && getComputedStyle(primary).backgroundColor===token("--color-action") && getComputedStyle(primary).color===token("--color-action-foreground") && !toast.querySelector("[role=status] svg") })()'), theme + ' toast uses theme surface, text, and action colors with no success icon')
            writeFileSync(path.join(require('node:os').tmpdir(), 'codex-browser-screenshot-toast-' + theme + '.png'), (await window.webContents.capturePage()).toPNG())
          }
          await run('document.documentElement.dataset.theme="light"')

          window.setSize(1200, 800)
          await click('[aria-label="Dismiss screenshot notification"]')
          assert(await run('!document.querySelector(' + JSON.stringify('[aria-label="Browser screenshot notification"]') + ')'))
          await click('[aria-label="Screenshot"]')
          await wait(() => run('!!document.querySelector(' + JSON.stringify('[aria-label="Browser screenshot notification"]') + ')'), 'new capture gets its own toast')
          await run('(() => { const button=document.querySelector(' + JSON.stringify('[aria-label="Browser screenshot notification"] button') + '); button.matches=()=>false; button.dispatchEvent(new FocusEvent("focusin", {bubbles:true})); button.dispatchEvent(new MouseEvent("mouseover", {bubbles:true,relatedTarget:document.body})) })()')
          await new Promise(resolve => setTimeout(resolve, 3200))
          assert(await run('!!document.querySelector(' + JSON.stringify('[aria-label="Browser screenshot notification"]') + ')'), 'pointer hover keeps the toast open')
          await run('(() => {const button=document.querySelector(' + JSON.stringify('[aria-label="Browser screenshot notification"] button') + '); button.dispatchEvent(new MouseEvent("mouseout", {bubbles:true,relatedTarget:document.body})); delete button.matches })()')
          await wait(() => run('!document.querySelector(' + JSON.stringify('[aria-label="Browser screenshot notification"]') + ')'), 'pointer focus does not keep toast open after mouse leaves')
          await click('[aria-label="Screenshot"]')
          await wait(() => run('!!document.querySelector(' + JSON.stringify('[aria-label="Browser screenshot notification"]') + ')'), 'fresh toast for keyboard focus check')

          await new Promise(resolve => setTimeout(resolve, 1200))
          await run('(() => { const button=document.querySelector(' + JSON.stringify('[aria-label="Browser screenshot notification"] button') + '); button.focus(); button.matches=()=>true; button.dispatchEvent(new FocusEvent("focusin", {bubbles:true})) })()')
          await new Promise(resolve => setTimeout(resolve, 3200))
          assert(await run('!!document.querySelector(' + JSON.stringify('[aria-label="Browser screenshot notification"]') + ')'), 'focused toast pauses dismissal')
          await run('document.activeElement.blur(); document.querySelector(' + JSON.stringify('[aria-label="Browser screenshot notification"] button') + ').dispatchEvent(new FocusEvent("focusout", {bubbles:true,relatedTarget:document.body}))')
          const resumedAt = Date.now()
          await wait(() => run('!document.querySelector(' + JSON.stringify('[aria-label="Browser screenshot notification"]') + ')'), 'toast automatically dismisses after idle timeout')
          assert(Date.now() - resumedAt < 2600, 'dismissal resumes the remaining duration rather than restarting the countdown')

          await click('[aria-label="Browser menu"]')
          const browserSession = session.fromPartition('persist:tidecode-browser')
          await session.defaultSession.cookies.set({url, name:'host-only', value:'keep'})
          assert((await browserSession.cookies.get({url})).length > 0)
          await clickText('Clear cookies')
          await wait(async () => (await browserSession.cookies.get({url})).length === 0, 'cookies cleared')
          assert.equal((await session.defaultSession.cookies.get({url}))[0].name, 'host-only')
          await guest.executeJavaScript('fetch("/cache").then(response => response.text())')
          await guest.executeJavaScript('fetch("/cache").then(response => response.text())')
          assert.equal(cacheRequests, 1)
          await clickText('Clear cache')
          await wait(() => run('Array.from(document.querySelectorAll("[role=status]")).find(node => node.textContent === "Cache cleared.")?.textContent === "Cache cleared."'), 'cache clear finished')
          await guest.executeJavaScript('fetch("/cache").then(response => response.text())')
          assert.equal(cacheRequests, 2, 'cache clear causes a new network request')
          writeFileSync(${JSON.stringify(path.join(tmpdir(), 'codex-browser-menu-preview.png'))}, (await window.webContents.capturePage()).toPNG())
          const viewCount = window.contentView.children.length
          await clickText('Open DevTools')
          await wait(() => BrowserWindow.getAllWindows().length === 2, 'floating DevTools')
          const floating = BrowserWindow.getAllWindows().find(candidate => candidate !== window)
          assert(floating)
          assert.equal(floating.getParentWindow(), window)
          assert.equal(window.contentView.children.length, viewCount, 'DevTools adds no docked view')
          await click('[aria-label="Browser menu"]')
          await clickText('Open DevTools')
          assert.equal(BrowserWindow.getAllWindows().length, 2, 'opening again reuses the floating window')
          floatingModule.exports.closeBrowserGuestDevTools(guest)
          for (let index = 0; index < 9; index += 1) {
            await click('[aria-label="New browser tab"]')
          }
          const seam = await run('const viewport=document.querySelector(".workspace-tabs-scroll-viewport"); viewport.scrollLeft=viewport.scrollWidth; const actions=document.querySelector("[aria-label=\\\\"New browser tab\\\\"]").closest("div"); JSON.stringify({border:getComputedStyle(actions).borderLeftWidth, overlap:viewport.getBoundingClientRect().right-actions.getBoundingClientRect().left, aboveTabs:getComputedStyle(actions).zIndex})')
          assert.deepEqual(JSON.parse(seam), {border:'1px',overlap:1,aboveTabs:'10'}, 'overflowing tabs and actions share one border')
          await click('[aria-label="Browser menu"]')
          assert(await run('!document.querySelector("[aria-label=\\\\"Page zoom\\\\"]")'), 'new tabs hide zoom after switching')
          assert(await run('!document.querySelector("[aria-label=\\\\"Browser actions\\\\"] button").querySelector("svg")'), 'menu actions have no icons')
          await run('document.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape",bubbles:true}))')
          await pause()
          await click('[aria-label="Test selector"]')
          await run('document.querySelector("[role=listbox]").dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowDown",bubbles:true}))')
          await pause()
          await run('document.querySelector("[role=listbox]").dispatchEvent(new KeyboardEvent("keydown", {key:"Enter",bubbles:true}))')
          assert.equal(await run('document.querySelector("[aria-label=\\\\"Test selector\\\\"]").textContent.trim()'), 'Second')
          await click('[aria-label="Browser menu"]')
          await run('document.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape",bubbles:true}))')
          await pause()
          assert(await run('document.activeElement.getAttribute("aria-label") === "Browser menu"'))
          await click('[aria-label="Browser menu"]')
          await run('document.body.dispatchEvent(new MouseEvent("mousedown", {bubbles:true}))')
          await pause()
          assert(await run('!document.querySelector("[aria-label=\\\\"Browser actions\\\\"]")'))
          console.log('BROWSER_MENU_OK')
          window.destroy()
          server.close()
          app.exit(0)
        } catch (error) { console.error(error.stack); app.exit(1) }
      })
    `,
      )
      const environment = { ...process.env }
      delete environment.ELECTRON_RUN_AS_NODE
      const child = spawn(
        require('electron'),
        [path.join(directory, 'main.cjs')],
        {
          env: environment,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      let output = ''
      child.stdout.on('data', (chunk) => {
        output += chunk
      })
      child.stderr.on('data', (chunk) => {
        output += chunk
      })
      const timeout = setTimeout(() => child.kill(), 45000)
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.on('error', reject)
        child.on('exit', resolve)
      })
      clearTimeout(timeout)
      assert.equal(exitCode, 0, output)
      assert.match(output, /BROWSER_MENU_OK/)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)
