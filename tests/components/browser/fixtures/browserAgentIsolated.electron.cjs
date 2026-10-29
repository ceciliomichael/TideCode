const assert = require('node:assert/strict')
const http = require('node:http')
const path = require('node:path')
const { app, BrowserWindow, nativeImage } = require('electron')

const root = process.argv[2]
app.setPath('userData', path.join(root, 'user-data'))
const browser = require(path.join(root, 'agentBundle.cjs'))

async function run() {
  await app.whenReady()
  const server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end(`<!doctype html><html><head><title>Isolated Agent</title></head><body style="margin:0">
      <button id="click" style="position:absolute;left:10px;top:10px;width:100px;height:50px"
        onclick="window.clicked=(window.clicked||0)+1;document.body.style.background=window.clicked%2?'#ff0000':'#00ff00'">Click</button>
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
    assert.ok(browser.listOpenAgentTabs(projectPath).some((item) => item.tabId === opened.tab_id))
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
    assert.equal(png.readUInt32BE(16), 1440)
    assert.equal(png.readUInt32BE(20), 900)
    assert.equal(typeof imageResult.data.observation_id, 'string')
    await browser.executeDesktopBrowserRequest({
      operation: 'interact', projectPath, tabId: opened.tab_id,
      action: { action: 'click', x: 40, y: 30, observation_id: imageResult.data.observation_id },
    }, owner.webContents)
    assert.equal(await tab.contents.executeJavaScript('window.clicked'), 1)
    const canvasSetup = [
      '(() => {',
      '  const canvas = document.createElement("canvas");',
      '  canvas.id = "draw"; canvas.width = 500; canvas.height = 400;',
      '  canvas.style.cssText = "position:absolute;left:160px;top:120px";',
      '  document.body.appendChild(canvas);',
      '  const ctx = canvas.getContext("2d");',
      '  ctx.strokeStyle = "black"; ctx.lineWidth = 4;',
      '  window.strokeCounters = { downs: 0, moves: 0, ups: 0 };',
      '  let drawing = false;',
      '  canvas.addEventListener("mousedown", event => {',
      '    drawing = true; window.strokeCounters.downs++;',
      '    ctx.beginPath(); ctx.moveTo(event.offsetX, event.offsetY);',
      '  });',
      '  canvas.addEventListener("mousemove", event => {',
      '    if (!drawing) return;',
      '    window.strokeCounters.moves++;',
      '    ctx.lineTo(event.offsetX, event.offsetY); ctx.stroke();',
      '  });',
      '  canvas.addEventListener("mouseup", () => {',
      '    drawing = false; window.strokeCounters.ups++;',
      '  });',
      '})()',
    ].join('\n')
    await tab.contents.executeJavaScript(canvasSetup)
    const drawn = await browser.executeDesktopBrowserRequest({
      operation: 'interact', projectPath, tabId: opened.tab_id,
      action: { action: 'stroke', points: [
        { x: 200, y: 150 }, { x: 220, y: 160 }, { x: 240, y: 170 },
      ] },
    }, owner.webContents)
    assert.equal(drawn.data.report.detail, '3 connected points')
    const counters = await tab.contents.executeJavaScript('window.strokeCounters')
    assert.equal(counters.downs, 1)
    assert.equal(counters.ups, 1)
    assert.ok(counters.moves > 2, 'stroke should interpolate intermediate points')
    const strokePixel = await tab.contents.executeJavaScript(
      'document.getElementById("draw").getContext("2d").getImageData(60,40,1,1).data[3]',
    )
    assert.ok(strokePixel > 0, 'the continuous stroke must paint the canvas between points')
    assert.equal(browser.getAgentCursor(tab.contents)?.x, 240)
    assert.equal(browser.getAgentCursor(tab.contents)?.y, 170)
    assert.equal(drawn.data.width, 1440)
    assert.equal(drawn.data.height, 900)
    const cursorRead = await browser.executeDesktopBrowserRequest({
      operation: 'read', projectPath, tabId: opened.tab_id,
      view: 'visual', offset: 0, limit: 20,
      conversationId: null, includeAnnotations: false,
    }, owner.webContents)
    const cursorImage = nativeImage.createFromBuffer(Buffer.from(cursorRead.imageBase64, 'base64'))
    const cursorPixels = cursorImage.toBitmap()
    const cursorOffset = ((170 + 28) * cursorImage.getSize().width + 240 + 24) * 4
    assert.ok(cursorPixels[cursorOffset + 1] > 100 && cursorPixels[cursorOffset + 2] < 100,
      'browser.read must draw the green AI cursor indicator onto the captured image')
    const sequenceImage = await browser.executeDesktopBrowserRequest({
      operation: 'sequence', projectPath, tabId: opened.tab_id,
      steps: [{ action: 'read', view: 'visual' }],
    }, owner.webContents)
    assert.equal(sequenceImage.data.width, 1440)
    assert.equal(sequenceImage.data.height, 900)
    const captured = nativeImage.createFromBuffer(Buffer.from(sequenceImage.captures[0].imageBase64, 'base64'))
    const pixels = captured.toBitmap()
    assert.ok(pixels[cursorOffset + 1] > 100 && pixels[cursorOffset + 2] < 100,
      'sequence read captures must include the AI cursor overlay')
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
    browser.setAgentLivePreviewVisible(tab.contents, true)
    await new Promise((resolve) => setTimeout(resolve, 150))
    const frameCountBeforeSequence = received.length
    let finished = false
    const pendingSequence = browser.executeDesktopBrowserRequest({
      operation: 'sequence', projectPath, tabId: opened.tab_id,
      steps: [{ action: 'click', x: 40, y: 30 }, { action: 'wait', ms: 900 }],
    }, owner.webContents).finally(() => { finished = true })
    await new Promise((resolve) => setTimeout(resolve, 350))
    assert.equal(finished, false, 'browser sequence must still be in flight')
    const intermediateFrames = received.slice(frameCountBeforeSequence).filter((item) =>
      item.channel === 'browser:agentFrame' && item.value.imageDataUrl.startsWith('data:image/jpeg;base64,'))
    assert.ok(intermediateFrames.length > 0, 'live page frames must arrive before the browser tool completes')
    const renderedChange = intermediateFrames.some((item) => {
      const image = nativeImage.createFromDataURL(item.value.imageDataUrl)
      const pixels = image.toBitmap()
      const index = (60 * image.getSize().width + 300) * 4
      return pixels[index + 1] > 180 && pixels[index + 2] < 90
    })
    assert.ok(renderedChange, 'a mid-sequence preview must show the updated green page, not a stale screenshot')
    await pendingSequence
    browser.setAgentLivePreviewVisible(tab.contents, false)
    const framesAfterUnsubscribe = received.filter((item) =>
      item.channel === 'browser:agentFrame' && item.value.imageDataUrl.startsWith('data:image/jpeg;base64,')).length
    await tab.contents.executeJavaScript("document.body.style.background='#0000ff'")
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(received.filter((item) =>
      item.channel === 'browser:agentFrame' && item.value.imageDataUrl.startsWith('data:image/jpeg;base64,')).length,
    framesAfterUnsubscribe, 'hidden previews must stop publishing frames')
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
    assert.match(mobile.data.body, /AI cursor: \(40, 30\)/)
    const mobileImage = Buffer.from(mobile.imageBase64, 'base64')
    assert.equal(mobileImage.readUInt32BE(16), 1440)
    assert.equal(mobileImage.readUInt32BE(20), 900)
    assert.equal(await tab.contents.executeJavaScript('window.innerWidth'), 1440)
    assert.equal(await tab.contents.executeJavaScript('window.innerHeight'), 900)
    const lastFrame = received.filter((item) => item.channel === 'browser:agentFrame').at(-1)
    assert.equal(lastFrame.value.width, 1440)
    assert.equal(lastFrame.value.height, 900)
    await browser.executeDesktopBrowserRequest({
      operation: 'interact', projectPath, tabId: opened.tab_id,
      action: { action: 'hover', x: 100, y: 120, observation_id: mobile.data.observation_id },
    }, owner.webContents)
    const pointer = received.filter((item) => item.channel === 'browser:agentCursor').at(-1)
    assert.equal(pointer.value.cursor.x, 100)
    assert.equal(pointer.value.cursor.y, 120)
    assert.equal(pointer.value.width, 1440)
    assert.equal(pointer.value.height, 900)
    const closed = await browser.executeDesktopBrowserRequest({
      operation: 'terminate', projectPath, tabId: opened.tab_id,
    }, owner.webContents)
    assert.equal(closed.data.status, 'closed')
    assert.ok(!browser.listOpenAgentTabs(projectPath).some((item) => item.tabId === opened.tab_id))
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
