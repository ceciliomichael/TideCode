const assert = require('node:assert/strict')
const http = require('node:http')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

const root = process.argv[2]
app.setPath('userData', path.join(root, 'user-data'))
const browser = require(path.join(root, 'agentBundle.cjs'))

async function run() {
  await app.whenReady()
  const server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end(`<!doctype html><html><head><title>Isolated Agent</title></head><body style="margin:0">
      <button id="click" style="position:absolute;left:10px;top:10px;width:100px;height:50px"
        onclick="window.clicked=(window.clicked||0)+1">Click</button>
      <input id="name" aria-label="Name" style="position:absolute;left:10px;top:90px"/>
      </body></html>`)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const owner = new BrowserWindow({ show: false, width: 640, height: 360 })
  await owner.loadURL('data:text/html,<html><body>Original user window</body></html>')
  const ownerBounds = owner.getBounds()
  const received = []
  const send = owner.webContents.send.bind(owner.webContents)
  owner.webContents.send = (channel, value) => {
    received.push({ channel, value })
    return send(channel, value)
  }
  const projectPath = path.join(root, 'workspace')
  const url = `http://127.0.0.1:${server.address().port}/`
  try {
    const { data: opened } = await browser.executeDesktopBrowserRequest({
      operation: 'open', projectPath, url,
    }, owner.webContents)
    assert.equal(opened.status, 'loaded')
    assert.equal(opened.width, 1440)
    assert.equal(opened.height, 900)
    const tab = browser.resolveAgentBrowserTab(projectPath, opened.tab_id)
    assert.equal(tab.kind, 'agent')
    const navigated = await browser.executeDesktopBrowserRequest({
      operation: 'navigate', projectPath, tabId: opened.tab_id,
      input: { action: 'goto', url, wait_until: 'load' },
    }, owner.webContents)
    assert.equal(navigated.data.status, 'reached load')
    assert.equal(navigated.data.url, url)
    assert.equal(tab.window.isVisible(), false)
    assert.notEqual(tab.contents.id, owner.webContents.id)
    assert.deepEqual(owner.getBounds(), ownerBounds)
    assert.equal(await owner.webContents.executeJavaScript('document.body.textContent'), 'Original user window')
    browser.registerVisibleBrowserTab({
      id: 'visible-user-tab', projectPath, contents: tab.contents, ownerId: owner.webContents.id,
    })
    const widthBefore = await tab.contents.executeJavaScript('window.innerWidth')
    const sharedRead = await browser.executeDesktopBrowserRequest({
      operation: 'read', projectPath, tabId: 'visible-user-tab',
      view: 'structure', width: 390, height: 844, offset: 0, limit: 20,
      conversationId: null, includeAnnotations: false,
    }, owner.webContents)
    assert.ok(Math.abs(sharedRead.data.width - widthBefore) <= 2)
    assert.ok(Math.abs(await tab.contents.executeJavaScript('window.innerWidth') - widthBefore) <= 2)
    assert.deepEqual(owner.getBounds(), ownerBounds)
    await assert.rejects(browser.executeDesktopBrowserRequest({
      operation: 'interact', projectPath, tabId: 'visible-user-tab',
      action: { action: 'hover', x: 30, y: 30, observation_id: sharedRead.data.observation_id },
    }, owner.webContents), /user-owned and read-only/u)
    await assert.rejects(browser.executeDesktopBrowserRequest({
      operation: 'terminate', projectPath, tabId: 'visible-user-tab',
    }, owner.webContents), /user-owned and read-only/u)
    await assert.rejects(browser.executeDesktopBrowserRequest({
      operation: 'navigate', projectPath, tabId: 'visible-user-tab',
      input: { action: 'reload' },
    }, owner.webContents), /user-owned and read-only/u)
    await assert.rejects(browser.executeDesktopBrowserRequest({
      operation: 'devtools', projectPath, tabId: 'visible-user-tab', input: { action: 'evaluate', expression: '1+1' },
    }, owner.webContents), /read-only/u)
    const passive = await browser.executeDesktopBrowserRequest({
      operation: 'devtools', projectPath, tabId: 'visible-user-tab', input: { action: 'console', limit: 5 },
    }, owner.webContents)
    assert.ok(passive.data.output)
    process.stdout.write('BROWSER_USER_READ_ONLY_PASS\n')
    const imageResult = await browser.executeDesktopBrowserRequest({
      operation: 'read', projectPath, tabId: opened.tab_id,
      view: 'combined', width: 1280, height: 720, offset: 0, limit: 80,
      conversationId: null, includeAnnotations: false,
    }, owner.webContents)
    const png = Buffer.from(imageResult.imageBase64, 'base64')
    assert.equal(png.readUInt32BE(16), 1280)
    assert.equal(png.readUInt32BE(20), 720)
    assert.equal(typeof imageResult.data.observation_id, 'string')
    await browser.executeDesktopBrowserRequest({
      operation: 'interact', projectPath, tabId: opened.tab_id,
      action: { action: 'click', x: 40, y: 30, observation_id: imageResult.data.observation_id },
    }, owner.webContents)
    assert.equal(await tab.contents.executeJavaScript('window.clicked'), 1)
    assert.equal(browser.getAgentCursor(tab.contents)?.x, 40)
    assert.equal(browser.getAgentCursor(tab.contents)?.y, 30)
    assert.deepEqual(owner.getBounds(), ownerBounds)
    const sequence = await browser.executeDesktopBrowserRequest({
      operation: 'sequence', projectPath, tabId: opened.tab_id,
      steps: [{ action: 'wait_for', selector: '#name', timeout_ms: 1000 }],
    }, owner.webContents)
    assert.equal(sequence.data.error, undefined)
    const controller = new AbortController()
    const cancelled = browser.executeDesktopBrowserRequest({
      operation: 'sequence', projectPath, tabId: opened.tab_id,
      steps: [
        { action: 'wait', duration_ms: 2000 },
        { action: 'click', x: 40, y: 30, observation_id: imageResult.data.observation_id },
      ],
    }, owner.webContents, controller.signal)
    setTimeout(() => controller.abort(), 30)
    await assert.rejects(cancelled, /abort|cancel/iu)
    assert.equal(await tab.contents.executeJavaScript('window.clicked'), 1)
    await new Promise((resolve) => setTimeout(resolve, 500))
    const frame = received.find((item) => item.channel === 'browser:agentFrame')
    assert.ok(frame, 'agent frame should be emitted for preview')
    assert.equal(frame.value.width, 1440)
    assert.equal(frame.value.height, 900)
    assert.ok(frame.value.imageDataUrl.startsWith('data:image/png;base64,'))
    const mobile = await browser.executeDesktopBrowserRequest({
      operation: 'read', projectPath, tabId: opened.tab_id,
      view: 'combined', width: 390, height: 844, offset: 0, limit: 80,
      conversationId: null, includeAnnotations: false,
    }, owner.webContents)
    const mobileImage = Buffer.from(mobile.imageBase64, 'base64')
    assert.equal(mobileImage.readUInt32BE(16), 390)
    assert.equal(mobileImage.readUInt32BE(20), 844)
    assert.equal(await tab.contents.executeJavaScript('window.innerWidth'), 390)
    assert.equal(await tab.contents.executeJavaScript('window.innerHeight'), 844)
    const lastFrame = received.filter((item) => item.channel === 'browser:agentFrame').at(-1)
    assert.equal(lastFrame.value.width, 390)
    assert.equal(lastFrame.value.height, 844)
    await browser.executeDesktopBrowserRequest({
      operation: 'interact', projectPath, tabId: opened.tab_id,
      action: { action: 'hover', x: 100, y: 120, observation_id: mobile.data.observation_id },
    }, owner.webContents)
    const pointer = received.filter((item) => item.channel === 'browser:agentCursor').at(-1)
    assert.equal(pointer.value.cursor.x, 100)
    assert.equal(pointer.value.cursor.y, 120)
    assert.equal(pointer.value.width, 390)
    assert.equal(pointer.value.height, 844)
    const closed = await browser.executeDesktopBrowserRequest({
      operation: 'terminate', projectPath, tabId: opened.tab_id,
    }, owner.webContents)
    assert.equal(closed.data.status, 'closed')
    const { data: custom } = await browser.executeDesktopBrowserRequest({
      operation: 'open', projectPath, url, width: 390, height: 844, newTab: true,
    }, owner.webContents)
    assert.equal(custom.width, 390)
    assert.equal(custom.height, 844)
    const customRead = await browser.executeDesktopBrowserRequest({
      operation: 'read', projectPath, tabId: custom.tab_id,
      view: 'visual', offset: 0, limit: 20, conversationId: null, includeAnnotations: false,
    }, owner.webContents)
    assert.equal(customRead.data.width, 390)
    assert.equal(customRead.data.height, 844)
    const customPng = Buffer.from(customRead.imageBase64, 'base64')
    assert.equal(customPng.readUInt32BE(16), 390)
    assert.equal(customPng.readUInt32BE(20), 844)
    await browser.executeDesktopBrowserRequest({
      operation: 'terminate', projectPath, tabId: custom.tab_id,
    }, owner.webContents)
    assert.deepEqual(owner.getBounds(), ownerBounds)
    assert.equal(BrowserWindow.getAllWindows().length, 1)
    process.stdout.write('BROWSER_ISOLATION_PASS\n')
  } finally {
    owner.destroy()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

run().then(() => app.quit()).catch((error) => {
  console.error(error)
  app.exit(1)
})
