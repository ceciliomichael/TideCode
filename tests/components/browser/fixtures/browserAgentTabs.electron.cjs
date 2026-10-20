const assert = require('node:assert/strict')
const http = require('node:http')
const path = require('node:path')
const { app, BrowserWindow, ipcMain, nativeImage, webContents } = require('electron')

const root = process.argv[2]
app.setPath('userData', path.join(root, 'user-data'))
const browser = require(path.join(root, 'agentBundle.cjs'))

async function main() {
  process.stdout.write('BROWSER_AGENT_STARTING\n')
  await app.whenReady()
  process.stdout.write('BROWSER_AGENT_READY\n')
  const server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><html><head><title>Browser Agent Test</title></head><body>'
      + '<div id="capture-corner" style="position:fixed;right:0;bottom:0;width:90px;height:90px;background:rgb(255,0,0);pointer-events:none"></div>'
      + '<label>Username<input id="username" aria-label="Username"></label>'
      + '<button id="submit" onclick="this.dataset.clicked = String(Number(this.dataset.clicked||0)+1)">Click me</button>'
      + '<script>console.log("ready to inspect")</script></body></html>')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const owner = new BrowserWindow({
    show: false,
    webPreferences: {
      webviewTag: true,
      preload: path.join(__dirname, 'browserAgentTabs.preload.cjs'),
    },
  })
  let requestedTab = null
  ipcMain.on('fixture-open-received', () => {})
  owner.webContents.on('did-attach-webview', (_event, contents) => {
    assert.ok(requestedTab)
    contents.once('dom-ready', () => {
      browser.registerVisibleBrowserTab({
        id: requestedTab.tabId,
        contents,
        ownerId: owner.webContents.id,
        projectPath: requestedTab.projectPath,
      })
    })
  })
  for (const name of ['fixture-preload-ready', 'fixture-open-received', 'fixture-webview-loaded']) {
    ipcMain.on(name, () => process.stdout.write(name + '\n'))
  }
  owner.webContents.on('console-message', (_event, _level, message) => {
    process.stdout.write('RENDERER_CONSOLE ' + message + '\n')
  })
  owner.webContents.on('ipc-message', (_event) => {})
  await owner.loadURL('data:text/html,<html><body style="margin:0;width:100%;height:100vh"></body></html>')
  owner.showInactive()
  process.stdout.write('BROWSER_AGENT_OWNER_CREATED\n')
  const project = path.join(root, 'workspace')
  try {
    const url = 'http://127.0.0.1:' + server.address().port + '/'
    requestedTab = { tabId: '', projectPath: project }
    // Capture the requested tab ID before the webview attaches.
    const send = owner.webContents.send.bind(owner.webContents)
    owner.webContents.send = (channel, input) => {
      if (channel === 'browser:openAgentTab') requestedTab = input
      return send(channel, input)
    }
    const { data: opened } = await browser.executeDesktopBrowserRequest({
      operation: 'open', projectPath: project, url,
    }, owner.webContents)
    process.stdout.write('BROWSER_AGENT_PAGE_OPENED\n')
    assert.ok(opened.tab_id)
    const tab = browser.resolveAgentBrowserTab(project, opened.tab_id)
    const reused = await browser.executeDesktopBrowserRequest({
      operation: 'open', projectPath: project, url,
    }, owner.webContents)
    assert.equal(reused.data.tab_id, opened.tab_id)
    assert.equal(reused.data.status, 'reused')
    assert.equal(tab.kind, 'visible')
    assert.equal(BrowserWindow.getAllWindows().length, 1, 'AI tab reuses the workspace window')
    let navigations = 0
    tab.contents.on('did-navigate', () => { navigations += 1 })
    const image = await browser.captureAgentPage(tab.contents)
    process.stdout.write('BROWSER_AGENT_SCREENSHOT\n')
    assert.equal(image.readUInt32BE(16), 1280)
    assert.equal(image.readUInt32BE(20), 720)
    const cornerPixel = nativeImage.createFromBuffer(image).toBitmap().subarray(((680 * 1280) + 1240) * 4, ((680 * 1280) + 1240) * 4 + 3)
    assert.ok(cornerPixel[2] > 190 && cornerPixel[2] > cornerPixel[0] * 2 && cornerPixel[2] > cornerPixel[1] * 2,
      'the bottom-right red marker is painted even when the user webview is smaller')
    const read = await browser.executeDesktopBrowserRequest({
      operation: 'read', projectPath: project, tabId: opened.tab_id,
      view: 'combined', offset: 0, limit: 80, conversationId: null, includeAnnotations: false,
    }, owner.webContents)
    process.stdout.write('BROWSER_AGENT_READ_VISUAL\n')
    assert.ok(read.imageBase64)
    const bridgedImage = Buffer.from(read.imageBase64, 'base64')
    assert.equal(bridgedImage.readUInt32BE(16), 1280)
    assert.equal(bridgedImage.readUInt32BE(20), 720)
    assert.equal(read.data.width, 1280)
    assert.equal(read.data.height, 720)
    assert.match(read.data.body, /Browser Agent Test/)
    await browser.executeDesktopBrowserRequest({
      operation: 'read', projectPath: project, tabId: opened.tab_id,
      view: 'structure', offset: 0, limit: 40, conversationId: null, includeAnnotations: false,
    }, owner.webContents)
    assert.equal(navigations, 0, 'repeated read does not navigate or reload the active tab')
    const structure = await browser.readBrowserStructure(tab.contents)
    process.stdout.write('BROWSER_AGENT_STRUCTURE\n')
    const button = structure.elements.find((entry) => entry.tag === 'BUTTON')
    const input = structure.elements.find((entry) => entry.tag === 'INPUT')
    assert.ok(button, JSON.stringify(structure.elements))
    assert.ok(input, JSON.stringify(structure.elements))
    assert.equal(browser.listAgentBrowserTabs(project, 1).tabs.length, 1)
    const listed = await browser.executeDesktopBrowserRequest({
      operation: 'tabs', projectPath: project, page: 1,
    }, owner.webContents)
    assert.equal(listed.data.total, 1)
    await browser.executeDesktopBrowserRequest({
      operation: 'interact', projectPath: project, tabId: opened.tab_id,
      action: { action: 'click', element_ref: button.ref },
    }, owner.webContents)
    assert.equal(await tab.contents.executeJavaScript('document.getElementById("submit").dataset.clicked'), '1')
    assert.equal(navigations, 0, 'clicking an element does not reload the active tab')
    await browser.interactWithAgentPage(tab.contents, { action: 'fill', element_ref: input.ref, text: 'TideCode' })
    assert.equal(await tab.contents.executeJavaScript('document.getElementById("username").value'), 'TideCode')
    await owner.webContents.executeJavaScript('document.querySelector("webview").style.opacity="0"')
    const backgroundImage = await Promise.race([
      browser.captureAgentPage(tab.contents),
      new Promise((_resolve, reject) => setTimeout(
        () => reject(new Error('Background tab screenshot did not complete.')), 5000,
      )),
    ])
    assert.equal(backgroundImage.readUInt32BE(16), 1280)
    assert.equal(backgroundImage.readUInt32BE(20), 720)
    await owner.webContents.executeJavaScript('document.querySelector("webview").style.opacity="1"')
    const sampleAnnotation = {
      id: 'annotation-test',
      conversationId: 'test-chat',
      projectPath: project,
      tabId: opened.tab_id,
      url,
      selector: '#submit',
      elementName: 'Click me',
      comment: 'Fix this button spacing',
      createdAt: Date.now(),
    }
    const resolved = await browser.resolveBrowserAnnotationTargets(tab.contents, [sampleAnnotation])
    assert.equal(resolved[0].status, 'resolved')
    const missing = await browser.resolveBrowserAnnotationTargets(tab.contents, [
      { ...sampleAnnotation, selector: '#does-not-exist' },
    ])
    assert.equal(missing[0].status, 'unresolved')
    await assert.rejects(() => browser.readBrowserDiagnostics(tab.contents, project, {
      action: 'evaluate', expression: 'document.title',
    }), /Developer Mode/)
    browser.setBrowserDeveloperMode(project, true)
    const evaluated = await browser.readBrowserDiagnostics(tab.contents, project, {
      action: 'evaluate', expression: 'document.title',
    })
    assert.match(evaluated.value, /Browser Agent Test/)
    const cdp = await browser.readBrowserDiagnostics(tab.contents, project, {
      action: 'cdp', method: 'Page.getNavigationHistory',
    })
    assert.equal(cdp.method, 'Page.getNavigationHistory')
    const performance = await browser.readBrowserDiagnostics(tab.contents, project, { action: 'performance' })
    assert.ok(Array.isArray(performance.metrics))
    const diagnostics = await browser.readBrowserDiagnostics(tab.contents, project, { action: 'network' })
    assert.equal(diagnostics.category, 'network')
    const { data: closed } = await browser.executeDesktopBrowserRequest({
      operation: 'terminate', projectPath: project, tabId: opened.tab_id,
    }, owner.webContents)
    assert.equal(closed.status, 'close_requested')
    const deadline = Date.now() + 5000
    while (browser.listAgentBrowserTabs(project, 1).total > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.equal(browser.listAgentBrowserTabs(project, 1).total, 0)
    process.stdout.write('BROWSER_AGENT_PASS\n')
  } finally {
    owner.destroy()
    await new Promise((resolve) => server.close(resolve))
    app.quit()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
  app.quit()
  setTimeout(() => process.exit(1), 2000)
})
