// Never open a desktop window unless the native test was explicitly enabled.
if (process.env.TIDECODE_RUN_NATIVE_BROWSER_TESTS !== '1') {
  process.exit(0)
}

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { app, BrowserWindow, ipcMain, session, webContents, WebContentsView } = require('electron')

const directory = process.argv[2]
const mode = process.argv[3] || 'fixed'
app.setPath('userData', path.join(directory, 'user-data'))
const guestScript = JSON.parse(readFileSync(path.join(directory, 'guest-script.json'), 'utf8'))
let slowResponse
let guest
let attachments = 0
let devToolsRequests = 0
let injectingKeyboard = false
const trace = []

async function waitFor(predicate, label) {
  const deadline = Date.now() + 10000
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, `Timed out: ${label}; ${JSON.stringify(trace)}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

async function run() {
  await app.whenReady()
  const server = http.createServer((request, response) => {
    if (request.url === '/slow.svg') {
      slowResponse = response
      return
    }
    response.setHeader('Content-Type', 'text/html')
    response.end(`<input id="page-input" style="position:absolute;left:20px;top:20px;width:250px;height:30px" autofocus>
      <input id="clicked-input" style="position:absolute;left:20px;top:80px;width:250px;height:30px">
      <button id="page-button" style="position:absolute;left:350px;top:20px;width:100px;height:30px" onclick="this.dataset.clicks = String(Number(this.dataset.clicks || 0) + 1)">Click</button>
      <img src="/slow.svg"><script>
      addEventListener('load', () => {
        document.title = 'Late page title';
        const icon = document.createElement('link');
        icon.rel = 'icon'; icon.href = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
        document.head.appendChild(icon);
      });
      </script>`)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const pageUrl = `http://127.0.0.1:${server.address().port}/`
  session.fromPartition('persist:tidecode-browser').webRequest.onBeforeRequest({ urls: ['https://www.google.com/*'] }, (_details, callback) => {
    callback({ redirectURL: pageUrl })
  })
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    x: -2000,
    webPreferences: { nodeIntegration: true, contextIsolation: false, webviewTag: true },
  })
  const host = win.webContents
  // The fixture briefly owns native focus. Ignore physical keyboard events
  // from the interactive desktop; test characters are injected directly.
  const filterKeyboard = (event) => {
    if (!injectingKeyboard) {
      event.preventDefault()
    }
  }
  host.on('before-input-event', filterKeyboard)
  host.on('focus', () => trace.push('host-focus'))
  host.on('blur', () => trace.push('host-blur'))
  host.on('did-attach-webview', (_event, contents) => {
    guest = contents
    contents.on('before-input-event', filterKeyboard)
    attachments += 1
    contents.on('focus', () => trace.push('guest-focus'))
    contents.on('blur', () => trace.push('guest-blur'))
    contents.on('dom-ready', () => {
      trace.push('dom-ready')
      void contents.executeJavaScript(guestScript, false)
      if (mode === 'warmup') {
        setTimeout(() => openDevTools({ webContentsId: contents.id }), 0)
      }
    })
    contents.on('did-stop-loading', () => trace.push('did-stop-loading'))
  })
  function openDevTools(input) {
    devToolsRequests += 1
    const target = webContents.fromId(input.webContentsId)
    const view = new WebContentsView({ webPreferences: { sandbox: true } })
    view.setVisible(false)
    win.contentView.addChildView(view)
    target.setDevToolsWebContents(view.webContents)
    target.openDevTools({ mode: 'detach', activate: true })
    return true
  }
  ipcMain.handle('open-devtools', (_event, input) => openDevTools(input))
  await win.loadFile(path.join(directory, 'index.html'))
  win.show()
  win.focus()
  const evaluate = (code) => host.executeJavaScript(code, false)
  await waitFor(() => evaluate('!!document.querySelector("input[aria-label]")'), 'address input')
  assert.equal(attachments, 0, 'A new tab must not attach a guest')
  assert.equal(devToolsRequests, 0, 'A new tab must not create native DevTools')
  assert.equal(await evaluate(`!!document.querySelector('section[aria-label="New tab"]')`), true)
  await waitFor(() => evaluate('document.activeElement === document.querySelector("input[aria-label]")'), 'new-tab address autofocus')
  host.insertText('https://www.google.com/')
  await waitFor(() => evaluate('document.querySelector("input[aria-label]").value === "https://www.google.com/"'), 'explicit first navigation')
  await evaluate('document.querySelector("form").requestSubmit()')
  await waitFor(() => Boolean(guest && slowResponse), 'explicit guest load')
  // Use pointer input so Chromium owns the focus transition.
  host.sendInputEvent({ type: 'mouseDown', x: 100, y: 65, button: 'left', clickCount: 1 })
  host.sendInputEvent({ type: 'mouseUp', x: 100, y: 65, button: 'left', clickCount: 1 })
  await waitFor(() => evaluate('document.activeElement === document.querySelector("input[aria-label]")'), 'address focus')
  await evaluate('document.querySelector("input[aria-label]").select()')
  host.insertText('https://example.test/draft')
  await waitFor(() => evaluate('document.querySelector("input[aria-label]").value === "https://example.test/draft"'), 'address draft')
  await waitFor(() => Boolean(slowResponse), 'blocked page resource')
  if (mode === 'fixed') {
    assert.equal(devToolsRequests, 0, 'Loading must not open hidden native DevTools')
  }
  const guestId = guest.id
  slowResponse.setHeader('Content-Type', 'image/svg+xml')
  slowResponse.end('<svg xmlns="http://www.w3.org/2000/svg"/>')
  await waitFor(() => !guest.isLoading(), 'page load completion')
  await waitFor(() => guest.getTitle() === 'Late page title', 'late metadata')
  await new Promise((resolve) => setTimeout(resolve, 500))
  // Another desktop application may activate while this native test runs.
  // Reactivating the window must also preserve its existing address focus.
  win.focus()
  assert.equal(host.isFocused(), true, `Native host focus lost: ${JSON.stringify(trace)}`)
  assert.equal(await evaluate('document.activeElement === document.querySelector("input[aria-label]")'), true)
  assert.equal(attachments, 1, 'Metadata updates must not reattach the guest')
  assert.equal(guest.id, guestId)
  if (mode === 'fixed') {
    assert.equal(devToolsRequests, 0)
  }
  injectingKeyboard = true
  host.sendInputEvent({ type: 'char', keyCode: 'x' })
  await new Promise((resolve) => setTimeout(resolve, 100))
  await waitFor(() => evaluate('document.querySelector("input[aria-label]").value.includes("draftx")'), 'continued native typing')
  injectingKeyboard = false
  host.sendInputEvent({ type: 'mouseDown', x: 100, y: 245, button: 'left', clickCount: 1 })
  await new Promise((resolve) => setTimeout(resolve, 50))
  host.sendInputEvent({ type: 'mouseUp', x: 100, y: 245, button: 'left', clickCount: 1 })
  guest.sendInputEvent({ type: 'mouseDown', x: 100, y: 95, button: 'left', clickCount: 1 })
  guest.sendInputEvent({ type: 'mouseUp', x: 100, y: 95, button: 'left', clickCount: 1 })
  await waitFor(() => evaluate('document.activeElement.tagName === "WEBVIEW"'), 'intentional guest focus')
  injectingKeyboard = true
  guest.sendInputEvent({ type: 'char', keyCode: 'y' })
  await waitFor(() => guest.executeJavaScript('document.getElementById("clicked-input").value.includes("y")', false), 'first click targets the intended page input')
  injectingKeyboard = false
  host.sendInputEvent({ type: 'mouseDown', x: 100, y: 65, button: 'left', clickCount: 1 })
  host.sendInputEvent({ type: 'mouseUp', x: 100, y: 65, button: 'left', clickCount: 1 })
  await waitFor(() => evaluate('document.activeElement.tagName === "INPUT"'), 'address focus')
  host.sendInputEvent({ type: 'mouseDown', x: 380, y: 185, button: 'left', clickCount: 1 })
  await new Promise((resolve) => setTimeout(resolve, 50))
  host.sendInputEvent({ type: 'mouseUp', x: 380, y: 185, button: 'left', clickCount: 1 })
  guest.sendInputEvent({ type: 'mouseDown', x: 380, y: 35, button: 'left', clickCount: 1 })
  guest.sendInputEvent({ type: 'mouseUp', x: 380, y: 35, button: 'left', clickCount: 1 })
  await waitFor(() => guest.executeJavaScript('document.getElementById("page-button").dataset.clicks === "1"', false), 'first click activates page button')
  const requestsBeforeOpening = devToolsRequests
  await evaluate(`document.querySelector('button[aria-label="Open page DevTools"]').click()`)
  await waitFor(() => devToolsRequests === requestsBeforeOpening + 1, 'explicit DevTools opening')
  await evaluate(`document.querySelector('button[aria-label="Home"]').click()`)
  await waitFor(() => evaluate(`!!document.querySelector('section[aria-label="New tab"]') && !document.querySelector('webview')`), 'Home returns to a local new tab')
  assert.equal(await evaluate('document.activeElement === document.querySelector("input[aria-label]")'), true)
  assert.equal(await evaluate('document.querySelector("input[aria-label]").value'), '')
  assert.equal(guest.isDestroyed(), true)
  console.log('BROWSER_FOCUS_PASS ' + JSON.stringify(trace))
  win.destroy()
  server.close()
  app.exit(0)
}

run().catch((error) => {
  console.error(error.stack)
  console.error(JSON.stringify(trace))
  app.exit(1)
})
