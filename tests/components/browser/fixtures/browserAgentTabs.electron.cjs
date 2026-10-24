const assert = require('node:assert/strict')
const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow, ipcMain, nativeImage, webContents } = require('electron')

const root = process.argv[2]
app.setPath('userData', path.join(root, 'user-data'))
const browser = require(path.join(root, 'agentBundle.cjs'))

async function within(promise, milliseconds, message) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function restoredPageWidth(owner, contents) {
  // Host layout and guest resize messages settle on separate renderer frames.
  await owner.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  return contents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => resolve(innerWidth)))')
}

async function main() {
  process.stdout.write('BROWSER_AGENT_STARTING\n')
  await app.whenReady()
  process.stdout.write('BROWSER_AGENT_READY\n')
  let slowResponse = null
  let documentRequests = 0
  const originalPage = process.env.TIDECODE_BROWSER_REPRO_FILE
    ? fs.readFileSync(process.env.TIDECODE_BROWSER_REPRO_FILE, 'utf8')
    : null
  const server = http.createServer((request, response) => {
    if (request.url === '/original' && originalPage) {
      response.setHeader('Content-Type', 'text/html')
      response.end(originalPage)
      return
    }
    if (request.url === '/slow-image') {
      slowResponse = response
      return
    }
    if (request.url === '/') documentRequests += 1
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><html><head><title>Browser Agent Test</title></head><body>'
      + '<div id="capture-corner" style="position:fixed;right:0;bottom:0;width:90px;height:90px;background:rgb(255,0,0);pointer-events:none"></div>'
      + '<style>html{scroll-behavior:smooth}body{margin:0}#far-controls{margin-top:1800px}#capture-corner{z-index:100}</style>'
      + '<img src="/slow-image" width="1" height="1">'
      + '<label>Username<input id="username" aria-label="Username"></label>'
      + '<button id="submit" onclick="this.dataset.clicked = String(Number(this.dataset.clicked||0)+1)">Click me</button>'
      + '<button id="viewport-target" aria-label="Viewport target" style="position:fixed;right:120px;bottom:100px;width:100px;height:40px" onclick="this.dataset.viewport=innerWidth+\'x\'+innerHeight;this.dataset.mobile=String(matchMedia(\'(max-width:600px)\').matches)">Viewport target</button>'
      + '<button disabled aria-label="Disabled button">Disabled</button>'
      + '<button style="display:none" aria-label="Hidden button">Hidden</button>'
      + '<div id="far-controls"><label>Far input<input id="far-input" aria-label="Far input"></label>'
      + '<button id="far-button" onclick="this.dataset.clicked = String(Number(this.dataset.clicked||0)+1)">Far button</button></div>'
      + '<script>window.documentIdentity = Math.random();console.log("ready to inspect")</script></body></html>')
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
    const styleBefore = await owner.webContents.executeJavaScript('document.querySelector("webview").style.cssText')
    const firstReadStarted = Date.now()
    const firstRead = await within(browser.executeDesktopBrowserRequest({
      operation: 'read', projectPath: project, tabId: opened.tab_id,
      view: 'combined', offset: 0, limit: 80, conversationId: null, includeAnnotations: false,
    }, owner.webContents), 5000, 'First hidden combined read stalled while a resource is loading.')
    const image = Buffer.from(firstRead.imageBase64, 'base64')
    process.stdout.write('FIRST_HIDDEN_COMBINED_MS ' + (Date.now() - firstReadStarted) + '\n')
    assert.ok(tab.contents.isLoading(), 'first combined read must finish before the delayed resource')
    assert.equal(await owner.webContents.executeJavaScript('document.querySelector("webview").style.cssText'), styleBefore)
    slowResponse?.end()
    const identity = await tab.contents.executeJavaScript('window.documentIdentity')
    const originalWidth = await tab.contents.executeJavaScript('innerWidth')
    assert.equal(originalWidth, 440, 'viewport override is cleared')
    // A real transient animation must be captured before it returns to its starting position.
    await tab.contents.executeJavaScript(`(() => {
      const character = document.createElement('div');
      character.id = 'jump-character';
      character.style.cssText = 'position:fixed;left:30px;top:200px;width:40px;height:40px;background:rgb(0,255,0);z-index:1000';
      const jump = document.createElement('button');
      jump.textContent = 'Jump character';
      jump.style.cssText = 'position:fixed;left:100px;top:200px;z-index:1000';
      jump.onclick = () => character.animate([
        {transform:'translateY(0)'},
        {transform:'translateY(-100px)',offset:0.2},
        {transform:'translateY(-100px)',offset:0.7},
        {transform:'translateY(0)'}
      ], {duration:900});
      document.body.append(character, jump);
    })()`)
    const jumpStructure = await browser.readBrowserStructure(tab.contents)
    const jumpButton = jumpStructure.elements.find((entry) => entry.name === 'Jump character')
    assert.ok(jumpButton)
    const sequence = await browser.executeDesktopBrowserRequest({
      operation: 'sequence', projectPath: project, tabId: opened.tab_id,
      steps: [
        { action: 'read', view: 'visual', label: 'Before jump' },
        { action: 'click', element_ref: jumpButton.ref },
        { action: 'wait', duration_ms: 150 },
        { action: 'read', view: 'visual', label: 'Airborne' },
        { action: 'wait', duration_ms: 1000 },
        { action: 'read', view: 'combined', label: 'Landed' },
      ],
    }, owner.webContents)
    assert.equal(sequence.data.error, undefined, JSON.stringify(sequence.data))
    assert.equal(sequence.data.completed_steps, 6)
    assert.equal(sequence.captures.length, 3)
    const characterCenters = sequence.captures.map((capture) => {
      const png = Buffer.from(capture.imageBase64, 'base64')
      assert.equal(png.readUInt32BE(16), 1280)
      assert.equal(png.readUInt32BE(20), 720)
      const pixels = nativeImage.createFromBuffer(png).toBitmap()
      const greenRows = []
      for (let y = 50; y < 260; y += 1) {
        const offset = (y * 1280 + 50) * 4
        if (pixels[offset + 1] > 190 && pixels[offset + 1] > pixels[offset] * 2 && pixels[offset + 1] > pixels[offset + 2] * 2) {
          greenRows.push(y)
        }
      }
      assert.ok(greenRows.length > 20, 'character is visible in each captured frame')
      assert.ok(capture.completed_ms >= capture.started_ms)
      return greenRows.reduce((sum, y) => sum + y, 0) / greenRows.length
    })
    assert.ok(characterCenters[0] > 200)
    assert.ok(characterCenters[1] < 160, 'intermediate screenshot shows the character airborne')
    assert.equal(characterCenters[2], characterCenters[0], 'final screenshot shows landing at the starting position')
    assert.match(sequence.captures[2].body, /Jump character/)
    assert.equal(await restoredPageWidth(owner, tab.contents), originalWidth)
    assert.equal(await owner.webContents.executeJavaScript('document.querySelector("webview").style.cssText'), styleBefore)
    assert.equal(await tab.contents.executeJavaScript('window.documentIdentity'), identity)
    process.stdout.write('BROWSER_SEQUENCE_JUMP_PASS ' + JSON.stringify({ centers: characterCenters, elapsed_ms: sequence.data.elapsed_ms }) + '\n')
    await tab.contents.executeJavaScript('document.querySelector("#jump-character").remove();Array.from(document.querySelectorAll("button")).find(node => node.textContent === "Jump character").remove()')
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
    for (const viewport of [{ width: 390, height: 844 }, { width: 1920, height: 1080 }, { width: 4096, height: 4096 }]) {
      process.stdout.write('RESPONSIVE_READ ' + viewport.width + 'x' + viewport.height + '\n')
      const custom = await browser.executeDesktopBrowserRequest({
        operation: 'read', projectPath: project, tabId: opened.tab_id,
        view: 'combined', offset: 0, limit: 80, conversationId: null, includeAnnotations: false,
        ...viewport,
      }, owner.webContents)
      const customImage = Buffer.from(custom.imageBase64, 'base64')
      process.stdout.write('RESPONSIVE_CAPTURED ' + viewport.width + '\n')
      assert.equal(customImage.readUInt32BE(16), viewport.width)
      assert.equal(customImage.readUInt32BE(20), viewport.height)
      assert.equal(custom.data.width, viewport.width)
      assert.equal(custom.data.height, viewport.height)
      assert.ok(custom.data.body.includes('Viewport: ' + viewport.width + 'x' + viewport.height))
      const markerIndex = ((viewport.height - 40) * viewport.width + viewport.width - 40) * 4
      const markerPixel = nativeImage.createFromBuffer(customImage).toBitmap().subarray(markerIndex, markerIndex + 3)
      assert.ok(markerPixel[2] > 190 && markerPixel[2] > markerPixel[0] * 2, 'custom screenshot includes the actual viewport corner: ' + JSON.stringify({ viewport, pixel: [...markerPixel] }))
      const target = custom.data.body.match(/\|\s*(el-[^\s|]+)\s*\|[^|]*\|\s*Viewport target\s*\|\s*(\d+),(\d+)\s*\|/)
      assert.ok(target, custom.data.body)
      const x = Number(target[2])
      const y = Number(target[3])
      assert.ok(y > 720, 'target is beyond the old default height')
      if (viewport.width > 1280) {
        assert.ok(x > 1280, 'desktop target is beyond the old default width')
      }
      await browser.executeDesktopBrowserRequest({
        operation: 'interact', projectPath: project, tabId: opened.tab_id,
        action: { action: 'click', element_ref: target[1] },
      }, owner.webContents)
      assert.equal(await tab.contents.executeJavaScript('document.getElementById("viewport-target").dataset.viewport'), viewport.width + 'x' + viewport.height)
      assert.equal(await tab.contents.executeJavaScript('document.getElementById("viewport-target").dataset.mobile'), String(viewport.width <= 600))
      await assert.rejects(browser.executeDesktopBrowserRequest({
        operation: 'interact', projectPath: project, tabId: opened.tab_id,
        action: { action: 'click', x, y },
      }, owner.webContents), /clicks require an element_ref/)
      await assert.rejects(browser.executeDesktopBrowserRequest({
        operation: 'interact', projectPath: project, tabId: opened.tab_id,
        action: { action: 'click', element_ref: target[1], x, y },
      }, owner.webContents), /do not accept x or y/)
      await assert.rejects(browser.executeDesktopBrowserRequest({
        operation: 'read', projectPath: project, tabId: opened.tab_id,
        view: 'visual', width: 0, height: viewport.height,
      }, owner.webContents), /viewport width/)
      const retained = await browser.captureAgentPage(tab.contents)
      process.stdout.write('RESPONSIVE_RETAINED ' + viewport.width + '\n')
      assert.equal(retained.readUInt32BE(16), viewport.width, 'failed read preserves the last successful viewport')
      assert.equal(await restoredPageWidth(owner, tab.contents), originalWidth, 'custom capture restores the visible panel')
      assert.equal(await owner.webContents.executeJavaScript('document.querySelector("webview").style.cssText'), styleBefore)
      assert.equal(await tab.contents.executeJavaScript('window.documentIdentity'), identity)
    }
    const defaultRead = await browser.executeDesktopBrowserRequest({
      operation: 'read', projectPath: project, tabId: opened.tab_id,
      view: 'visual', offset: 0, limit: 80, conversationId: null, includeAnnotations: false,
    }, owner.webContents)
    assert.equal(defaultRead.data.width, 1280)
    assert.equal(defaultRead.data.height, 720)
    assert.equal(Buffer.from(defaultRead.imageBase64, 'base64').readUInt32BE(16), 1280, 'omitted dimensions reset to the default')
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
    const farButton = structure.elements.find((entry) => entry.name === 'Far button')
    const farInput = structure.elements.find((entry) => entry.name === 'Far input' && entry.tag === 'INPUT')
    assert.ok(farButton)
    assert.ok(farInput)
    await browser.interactWithAgentPage(tab.contents, { action: 'click', element_ref: farButton.ref })
    assert.equal(await tab.contents.executeJavaScript('document.getElementById("far-button").dataset.clicked'), '1')
    await browser.interactWithAgentPage(tab.contents, { action: 'fill', element_ref: farInput.ref, text: 'Off-screen works' })
    assert.equal(await tab.contents.executeJavaScript('document.getElementById("far-input").value'), 'Off-screen works')
    await assert.rejects(browser.interactWithAgentPage(tab.contents, { action: 'fill', element_ref: farButton.ref, text: 'not a field' }), /not an editable field/)
    assert.equal(await tab.contents.executeJavaScript('document.getElementById("far-button").dataset.clicked'), '1', 'invalid fill must not click')
    await assert.rejects(browser.interactWithAgentPage(tab.contents, { action: 'fill', element_ref: farInput.ref, text: 'x'.repeat(20001) }), /20,000/)
    assert.equal(await tab.contents.executeJavaScript('document.getElementById("far-input").value'), 'Off-screen works')
    const disabled = structure.elements.find((entry) => entry.name === 'Disabled button')
    const hidden = structure.elements.find((entry) => entry.name === 'Hidden button')
    await assert.rejects(browser.interactWithAgentPage(tab.contents, { action: 'click', element_ref: disabled.ref }), /cannot be interacted/)
    await assert.rejects(browser.interactWithAgentPage(tab.contents, { action: 'click', element_ref: hidden.ref }), /not actionable/)
    await browser.withAgentViewport(tab.contents, async (send) => {
      await send('Runtime.evaluate', {
        expression: 'document.getElementById("far-input").scrollIntoView({behavior:"instant",block:"center"})',
      })
      const visible = await browser.readBrowserStructureInViewport(tab.contents, send)
      const listedInput = visible.elements.find((entry) => entry.name === 'Far input' && entry.tag === 'INPUT')
      const measured = await send('Runtime.evaluate', {
        expression: '(() => { const r = document.getElementById("far-input").getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()',
        returnByValue: true,
      })
      assert.ok(Math.abs(listedInput.x - measured.result.value.x) < 2, JSON.stringify({ listedInput, measured }))
      assert.ok(Math.abs(listedInput.y - measured.result.value.y) < 2, 'DOM positions account for scroll offset')
    })
    const retainedScroll = await tab.contents.executeJavaScript('scrollY')
    await owner.webContents.executeJavaScript('document.querySelector("webview").style.opacity="0"')
    const backgroundImage = await within(browser.captureAgentPage(tab.contents), 5000, 'Background tab screenshot did not complete.')
    assert.equal(backgroundImage.readUInt32BE(16), 1280)
    assert.equal(backgroundImage.readUInt32BE(20), 720)
    assert.equal(await tab.contents.executeJavaScript('scrollY'), retainedScroll, 'read preserves scroll position')
    assert.equal(await tab.contents.executeJavaScript('window.documentIdentity'), identity, 'read preserves JavaScript state')
    assert.equal(await tab.contents.executeJavaScript('document.getElementById("username").value'), 'TideCode', 'read preserves form values')
    assert.equal(await restoredPageWidth(owner, tab.contents), originalWidth)
    assert.equal(documentRequests, 1, 'reads and interactions never request the document again')
    await assert.rejects(browser.interactWithAgentPage(tab.contents, { action: 'click', element_ref: farButton.ref }), /stale element reference/)
    const guardStructure = await browser.readBrowserStructure(tab.contents)
    const guardedButton = guardStructure.elements.find((entry) => entry.name === 'Far button')
    await tab.contents.executeJavaScript(`(() => {
      const overlay = document.createElement('div');
      overlay.id = 'test-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:200;background:white';
      document.body.appendChild(overlay);
    })()`)
    await assert.rejects(browser.interactWithAgentPage(tab.contents, { action: 'click', element_ref: guardedButton.ref }), /obscured/)
    assert.equal(await tab.contents.executeJavaScript('document.getElementById("far-button").dataset.clicked'), '1')
    await tab.contents.executeJavaScript('document.getElementById("test-overlay").remove();document.getElementById("far-button").remove()')
    await assert.rejects(browser.interactWithAgentPage(tab.contents, { action: 'click', element_ref: guardedButton.ref }), /attached|node|Node/)
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
    const recoveryStarted = Date.now()
    const stalledRead = browser.withAgentBrowserTab(project, opened.tab_id, (current) =>
      browser.withAgentViewport(current.contents, (send) => send('Runtime.evaluate', {
        expression: 'new Promise(() => {})', awaitPromise: true,
      })))
    const afterStall = browser.executeDesktopBrowserRequest({
      operation: 'read', projectPath: project, tabId: opened.tab_id,
      view: 'combined', offset: 0, limit: 80, conversationId: null, includeAnnotations: false,
    }, owner.webContents)
    await assert.rejects(stalledRead, /timed out during Runtime.evaluate/)
    assert.ok((await afterStall).imageBase64, 'a timed-out native command does not block the next read')
    assert.equal(await tab.contents.executeJavaScript('window.documentIdentity'), identity)
    assert.equal(await owner.webContents.executeJavaScript('document.querySelector("webview").style.width'), '440px')
    process.stdout.write('PROTOCOL_RECOVERY_MS ' + (Date.now() - recoveryStarted) + '\n')
    if (originalPage) {
      const { data: originalTab } = await browser.executeDesktopBrowserRequest({
        operation: 'open', projectPath: project, url: url + 'original',
      }, owner.webContents)
      const originalStarted = Date.now()
      const observed = await browser.executeDesktopBrowserRequest({
        operation: 'read', projectPath: project, tabId: originalTab.tab_id,
        view: 'combined', offset: 0, limit: 80, conversationId: null, includeAnnotations: false,
      }, owner.webContents)
      assert.ok(observed.imageBase64)
      process.stdout.write('ORIGINAL_PAGE_COMBINED_MS ' + (Date.now() - originalStarted) + '\n')
      const originalContents = browser.resolveAgentBrowserTab(project, originalTab.tab_id).contents
      const originalStructure = await browser.readBrowserStructure(originalContents)
      const addButton = originalStructure.elements.find((entry) => entry.tag === 'BUTTON' && entry.name.startsWith('Add Monstera'))
      const emailInput = originalStructure.elements.find((entry) => entry.tag === 'INPUT' && entry.name === 'Your email address')
      assert.ok(addButton)
      assert.ok(emailInput)
      await browser.interactWithAgentPage(originalContents, { action: 'click', element_ref: addButton.ref })
      await browser.interactWithAgentPage(originalContents, { action: 'fill', element_ref: emailInput.ref, text: 'browser-test@example.com' })
      const submitButton = originalStructure.elements.find((entry) => entry.tag === 'BUTTON' && entry.name === 'Count me in')
      assert.ok(submitButton)
      await browser.interactWithAgentPage(originalContents, { action: 'click', element_ref: submitButton.ref })
      await browser.withBrowserProtocol(originalContents, async (send) => {
        const state = await send('Runtime.evaluate', {
          expression: '({count:document.querySelector(".cart-count").textContent,message:document.querySelector(".form-message").textContent})',
          returnByValue: true,
        })
        assert.equal(state.result.value.count, '1')
        assert.ok(state.result.value.message.includes('browser-test@example.com'))
      })
      process.stdout.write('ORIGINAL_PAGE_INTERACTIONS_PASS\n')
      await browser.executeDesktopBrowserRequest({ operation: 'terminate', projectPath: project, tabId: originalTab.tab_id }, owner.webContents)
    }
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
    slowResponse?.end()
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
