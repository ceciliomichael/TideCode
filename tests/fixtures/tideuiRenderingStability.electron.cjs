const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const path = require('node:path')

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 700,
    height: 500,
    webPreferences: { contextIsolation: false, backgroundThrottling: false, offscreen: true },
  })
  const run = (code, userGesture = false) => window.webContents.executeJavaScript(code, userGesture)
  window.webContents.on('console-message', event => console.log('renderer:', event.message))
  const settle = () => run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const append = text => run(`fixture.append(${JSON.stringify(text)})`)
  const counts = () => run('JSON.parse(JSON.stringify(window.__renders))')
  const atBottom = () => run('document.querySelector(".chat-scroll-viewport").scrollHeight - document.querySelector(".chat-scroll-viewport").clientHeight - document.querySelector(".chat-scroll-viewport").scrollTop <= 1')
  const settleFollowing = (selector = '.chat-scroll-viewport') => run(`(async () => {
    const viewport = document.querySelector(${JSON.stringify(selector)});
    for (let frame = 0; frame < 100; frame++) {
      await new Promise(requestAnimationFrame);
      if (viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 1) return;
    }
    throw new Error('Scroll following did not reach the bottom');
  })()`)
  const traceAppend = (text, selector = '.chat-scroll-viewport', action = 'append') => run(`(async () => {
    const viewport = document.querySelector(${JSON.stringify(selector)});
    const retainedContent = viewport.querySelector('.tideui-metric') ?? viewport.querySelector('.chat-markdown p');
    const sample = () => ({
      top: viewport.scrollTop,
      max: viewport.scrollHeight - viewport.clientHeight,
      contentTop: retainedContent?.getBoundingClientRect().top,
      contentConnected: retainedContent?.isConnected,
    });
    const before = sample();
    fixture[${JSON.stringify(action)}](${JSON.stringify(text)});
    const committed = sample();
    const frames = [committed];
    for (let frame = 0; frame < 100; frame++) {
      await new Promise(requestAnimationFrame);
      frames.push(sample());
      if (viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 1) break;
    }
    return { before, committed, frames };
  })()`)
  const assertImmediateTrace = (trace, label) => {
    console.log('SCROLL_TRACE', label, JSON.stringify(trace))
    assert.ok(trace.committed.max > trace.before.max + 20, `${label}: content grows enough to observe movement`)
    assert.ok(trace.committed.max - trace.committed.top <= 1, `${label}: follows immediately on commit`)
    for (let index = 1; index < trace.frames.length; index++) {
      const previous = trace.frames[index - 1]
      const current = trace.frames[index]
      if (current.top < previous.top) {
        assert.ok(current.max < previous.max && Math.abs(current.top - current.max) <= 1,
          `${label}: backwards movement is allowed only when content shrinks and clamps the viewport`)
      }
      assert.ok(current.top <= current.max + 1, `${label}: no overshoot`)
      assert.equal(current.contentConnected, true, `${label}: committed content stays mounted`)
      assert.ok(Math.abs((current.contentTop - previous.contentTop) + (current.top - previous.top)) <= 1,
        `${label}: existing components move only with the viewport`)
    }
    const final = trace.frames.at(-1)
    assert.ok(final.max - final.top <= 1, `${label}: reaches the latest content`)
  }
  try {
    await window.loadFile(path.join(process.argv[2], 'index.html'))
    await settle()
    assert.equal(await run('Boolean(window.fixture)'), true, 'fixture mounted')
    assert.equal(await atBottom(), true, 'initial transcript follows the bottom')
    assert.equal(await run('document.querySelectorAll(".tideui-card").length'), 1, 'panel appears before all its children are generated')
    assert.equal(await run('document.querySelectorAll(".tideui-chart").length'), 0)
    await run('window.initialPanel = document.querySelector(".tideui-card"); fixture.initialize()')
    assert.equal(await atBottom(), true, 'adding panel contents pins before paint without smooth scrolling')
    assert.equal(await run('initialPanel === document.querySelector(".tideui-card")'), true, 'panel shell stays mounted as children arrive')
    await run(`
      window.retained = {
        input: document.querySelector('input'),
        chart: document.querySelector('svg'),
        details: document.querySelector('details'),
      };
      retained.details.open = true;
      const input = retained.input;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'My unsent notes');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    `)
    await settle()
    assert.equal(await run('retained.input.value'), 'My unsent notes')
    assert.equal(await run('document.querySelector(".tideui-button").disabled'), true, 'send remains guarded during streaming')
    await run('retained.chart.querySelector(".tideui-chart-mark").dispatchEvent(new MouseEvent("click", { bubbles: true }))')
    await settle()
    assert.match(await run('document.querySelector(".tideui-chart-detail").textContent'), /Mon: 4.*selected/)
    const initialCounts = await counts()
    await run('fixture.pulse()')
    for (const token of ['  metric ', '"New', ' item" ', '42']) {
      await run(`fixture.append(${JSON.stringify(token)})`)
      await settle()
    }
    assert.deepEqual(await counts(), initialCounts, 'partial tokens and parent updates do not execute the UI renderer')

    await settleFollowing()
    const uiTrace = await traceAppend('\n')
    assertImmediateTrace(uiTrace, 'TideUI metric')
    const appendedCounts = await counts()
    assert.equal(appendedCounts.TideUIRenderer, initialCounts.TideUIRenderer + 1, 'completed declaration updates once')
    assert.equal(appendedCounts.TideUICharts, initialCounts.TideUICharts, 'existing chart skips sibling updates')
    assert.equal(await run('retained.input === document.querySelector("input") && retained.chart === document.querySelector("svg") && retained.details === document.querySelector("details")'), true, 'existing DOM retained')
    assert.equal(await run('retained.input.value === "My unsent notes" && retained.details.open'), true, 'control state retained')
    assert.match(await run('document.querySelector(".tideui-chart-detail").textContent'), /Mon: 4.*selected/, 'chart selection retained while streaming')

    // Each plot mounts once inside the still-streaming panel. Individual points
    // then update that same plot without changing the transcript height.
    for (const chartType of ['bar', 'line', 'pie']) {
      const chartTrace = await traceAppend(`  chart ${chartType} "Streamed ${chartType}" interactive=true\n`)
      assertImmediateTrace(chartTrace, `${chartType} chart frame insertion`)
      await run(`window.streamingFigure = Array.from(document.querySelectorAll('.tideui-figure')).at(-1);
        window.streamingPlot = streamingFigure.querySelector('svg'); void 0`)
      const plotHeight = await run('streamingFigure.getBoundingClientRect().height')
      const transcriptHeight = await run('document.querySelector(".chat-scroll-viewport").scrollHeight')
      assert.equal(await run('streamingFigure.querySelectorAll(".tideui-chart-mark").length'), 0)

      await append('    point "One" 10\n')
      await settle()
      assert.equal(await run('streamingFigure.querySelectorAll(".tideui-chart-mark").length'), 1, 'first point appears before the chart closes')
      assert.equal(await run('streamingPlot === streamingFigure.querySelector("svg")'), true, 'first point does not replace the plot')
      await run('window.firstStreamingMark = streamingFigure.querySelector(".tideui-chart-mark"); void 0')

      await append('    point "Two" ')
      await settle()
      assert.equal(await run('streamingFigure.querySelectorAll(".tideui-chart-mark").length'), 1, 'partial point stays uncommitted')
      await append('20\n')
      await settle()
      assert.equal(await run('streamingFigure.querySelectorAll(".tideui-chart-mark").length'), 2, 'second completed point appears immediately')
      assert.equal(await run('firstStreamingMark === streamingFigure.querySelector(".tideui-chart-mark")'), true, 'earlier point retains its DOM element')
      assert.equal(await run('streamingFigure.getBoundingClientRect().height'), plotHeight, 'point updates keep plot geometry stable')
      assert.equal(await run('document.querySelector(".chat-scroll-viewport").scrollHeight'), transcriptHeight, 'point updates do not move the scroll target')
      assert.equal(await run('initialPanel === document.querySelector(".tideui-card")'), true, 'panel remains independent of chart updates')
      assert.equal(await atBottom(), true)
    }

    await append('  metric "Large addition" 100\n  metric "More content" 200\n')
    await run('new Promise(requestAnimationFrame)')
    assert.equal(await atBottom(), true, 'new content follows without animated catch-up')
    await run(`document.querySelector(".chat-scroll-viewport").dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true })); document.querySelector(".chat-scroll-viewport").scrollTop -= 120`)
    await settle()
    const pausedTop = await run('document.querySelector(".chat-scroll-viewport").scrollTop')
    await append('  metric "While paused" 9\n')
    await run('new Promise(resolve => setTimeout(resolve, 250))')
    assert.equal(await run('document.querySelector(".chat-scroll-viewport").scrollTop'), pausedTop, 'upward user intent pauses following')
    await run(`document.querySelector(".chat-scroll-viewport").scrollTop = document.querySelector(".chat-scroll-viewport").scrollHeight; document.querySelector(".chat-scroll-viewport").dispatchEvent(new Event('scroll'))`)
    await settle()
    await append('  metric "Resumed" 10\n')
    await settleFollowing()
    assert.equal(await atBottom(), true, 'following resumes at the bottom')

    await append('```')
    await settle()
    const closedCounts = await counts()
    const markdownTrace = await traceAppend('\n' + Array.from({ length: 8 }, (_, index) => `Following paragraph ${index}.\n\n`).join(''))
    assertImmediateTrace(markdownTrace, 'Markdown paragraphs')
    assert.deepEqual(await counts(), closedCounts, 'closed UI blocks skip subsequent prose streaming')

    // Each content commit stays pinned without an animated catch-up, while
    // upward intent and explicit return-to-latest keep their existing behavior.
    const continuousTrace = await run(`(async () => {
      const viewport = document.querySelector('.chat-scroll-viewport');
      const frames = [];
      for (let index = 0; index < 35; index++) {
        if (index < 12) fixture.append('More streaming text.' + String.fromCharCode(10).repeat(2));
        await new Promise(requestAnimationFrame);
        frames.push({ top: viewport.scrollTop, max: viewport.scrollHeight - viewport.clientHeight });
      }
      return frames;
    })()`)
    for (let index = 1; index < continuousTrace.length; index++) {
      assert.ok(continuousTrace[index].max - continuousTrace[index].top <= 1, 'continuous stream stays pinned without animation')
      assert.ok(continuousTrace[index].top <= continuousTrace[index].max + 1, 'continuous stream never overshoots')
    }
    await settleFollowing()
    await run(`const viewport = document.querySelector('.chat-scroll-viewport'); viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true })); viewport.scrollTop -= 120; void 0`)
    await run('fixture.follow()')
    assert.equal(await atBottom(), true, 'explicit follow signal anchors immediately')
    await append('\n\nNew paragraph.\n\n')
    await run(`document.querySelector('.chat-scroll-viewport').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))`)
    assert.equal(await atBottom(), true, 'End anchors immediately')
    await run(`document.querySelector('.chat-scroll-viewport').dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true })); document.querySelector('.chat-scroll-viewport').scrollTop -= 120`)
    await run('fixture.switchChat()')
    assert.equal(await atBottom(), true, 'switching chats anchors immediately')

    window.webContents.debugger.attach('1.3')
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    })
    assert.equal(await run('matchMedia("(prefers-reduced-motion: reduce)").matches'), true)
    await append('\n\nReduced motion content.\n\n')
    await settle()
    assert.equal(await atBottom(), true, 'reduced motion follows without an animated catch-up')
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] })
    window.webContents.debugger.detach()

    await run('fixture.finish()')
    await settle()
    assert.equal(await run('retained.input === document.querySelector("input") && retained.chart === document.querySelector("svg")'), true, 'completion does not remount controls or charts')
    assert.equal(await run('retained.input.value === "My unsent notes" && retained.details.open'), true, 'completion retains state')
    assert.equal(await run('document.querySelector(".tideui-button").disabled'), false, 'completion enables send')
    await run('document.querySelector(".tideui-button").click()')
    await settle()
    assert.equal(await run('window.__sent'), 1, 'completed interface invokes its send callback')

    const htmlContent = '```tidehtml\n<strong>Stable preview';
    await run(`fixture.replace(${JSON.stringify(htmlContent)})`)
    await settle()
    assert.equal(await run('document.querySelectorAll("iframe").length'), 0, 'unfinished HTML preview stays inert')
    await append('</strong><script>window.autoStarted=true</script>\n')
    await settle()
    assert.equal(await run('document.querySelectorAll("iframe").length'), 0, 'HTML content alone cannot mount a preview')
    await append('```')
    await settle()
    assert.equal(await run('document.querySelectorAll("iframe").length'), 1, 'only the real closing fence mounts the preview')
    await run('window.retainedFrame = document.querySelector("iframe"); void 0')
    const previewCounts = await counts()
    await append('\nMore streaming text')
    await settle()
    assert.equal((await counts()).TideUIHtmlPreview, previewCounts.TideUIHtmlPreview, 'unchanged HTML preview skips rendering')
    assert.equal(await run('retainedFrame === document.querySelector("iframe")'), true, 'iframe identity retained')

    await run(`(async () => {
      for (let frame = 0; frame < 100; frame++) {
        const height = retainedFrame.getBoundingClientRect().height;
        if (height > 1 && height < 100) return;
        await new Promise(requestAnimationFrame);
      }
      throw new Error('Short HTML did not shrink to its content');
    })()`)
    const staticFrame = window.webContents.mainFrame.frames.find(frame => frame.url === 'about:srcdoc')
    assert.equal(await staticFrame.executeJavaScript('window.autoStarted === true'), true, 'optional JavaScript starts automatically after the actual closing fence')
    assert.equal(await staticFrame.executeJavaScript('customElements.get("tide-ui") === undefined'), true, 'plain HTML does not load the native widget runtime')
    await staticFrame.executeJavaScript('document.body.style.height="840px"; void 0')
    const waitForHeight = height => run(`(async () => {
      for (let frame = 0; frame < 100; frame++) {
        if (Math.abs(document.querySelector('iframe').getBoundingClientRect().height - ${height}) <= 1) return;
        await new Promise(requestAnimationFrame);
      }
      throw new Error('HTML did not fit content height ${height}: ' + document.querySelector('iframe').getBoundingClientRect().height);
    })()`)
    await waitForHeight(840)
    await staticFrame.executeJavaScript('document.body.style.height="120px"; void 0')
    await waitForHeight(120)
    assert.equal(await run('retainedFrame === document.querySelector("iframe")'), true, 'content growth and shrinkage retain the iframe')
    assert.equal(await run('getComputedStyle(document.querySelector(".tideui-html-viewport")).resize'), 'none', 'viewer chooses its size without a resize handle')
    assert.equal(await run('document.querySelector(".tideui-html-toolbar, .tideui-html-preview button, dialog.tideui-html-preview")'), null, 'static HTML has no toolbar, expand button or dialog')
    assert.equal(await run('getComputedStyle(document.querySelector(".tideui-html-preview")).borderTopWidth'), '0px', 'HTML has no outer frame')
    assert.equal(await run('getComputedStyle(document.querySelector(".tideui-html-preview")).backgroundColor'), 'rgba(0, 0, 0, 0)', 'HTML blends into chat')

    const interactive = '```tidehtml\n<style>body{min-height:2000px}</style><button id="increment">Count</button><p id="count">0</p><script>window.clicks=0;document.getElementById("increment").onclick=()=>{document.getElementById("count").textContent=++window.clicks}</script>\n```'
    await run(`fixture.replace(${JSON.stringify(interactive)})`)
    await settle()
    assert.equal(await run('document.querySelectorAll("iframe").length'), 1, 'interactive HTML mounts without Run')
    assert.equal(await run('document.querySelectorAll(".tideui-html-preview button").length'), 0, 'HTML has no host execution controls')
    const getPreviewFrame = () => window.webContents.mainFrame.frames.find(frame => frame.url === 'about:srcdoc')
    const waitForPreview = async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const frame = getPreviewFrame()
        if (frame && await frame.executeJavaScript('Boolean(document.getElementById("increment")?.onclick)')) return frame
        await settle()
      }
      throw new Error('Interactive preview did not load')
    }
    let scriptFrame = await waitForPreview()
    assert.equal(await run('document.querySelector("iframe").getAttribute("sandbox")'), 'allow-scripts allow-forms', 'interactive preview permits local form handling within its opaque sandbox')
    assert.equal(await scriptFrame.executeJavaScript('(() => { try { return typeof window.parent.fixture } catch (error) { return error.name } })()'), 'SecurityError', 'scripts cannot access the host application')
    await waitForHeight(2000)
    await scriptFrame.executeJavaScript('document.getElementById("increment").click(); void 0')
    await settle()
    assert.equal(await scriptFrame.executeJavaScript('document.getElementById("count").textContent'), '1', 'inline JavaScript interaction works')
    await run('window.retainedAppFrame = document.querySelector("iframe"); void 0')
    await append('\n\nMore text after the embedded interactive HTML.')
    await settle()
    assert.equal(await run('retainedAppFrame === document.querySelector("iframe")'), true, 'streaming retains running preview')
    assert.equal(await scriptFrame.executeJavaScript('window.clicks'), 1, 'streaming preserves script state')
    assert.equal(await scriptFrame.executeJavaScript('window.scrollY'), 0, 'HTML uses its natural height without nested page scrolling')
    await settleFollowing()
    const beforeHtmlWheel = await run('document.querySelector(".chat-scroll-viewport").scrollTop')
    const nativeScrollingAllowed = await scriptFrame.executeJavaScript('document.body.dispatchEvent(new WheelEvent("wheel", {deltaY:-120,bubbles:true,cancelable:true}))')
    assert.equal(nativeScrollingAllowed, true, 'bridge never cancels native wheel scrolling')
    await settle()
    assert.equal(await run('document.querySelector(".chat-scroll-viewport").scrollTop'), beforeHtmlWheel, 'bridge relays intent without manually moving the chat')
    // Synthetic events have no native default action. Apply the movement that
    // Chromium supplies for a real wheel, then verify intent already paused follow.
    await run('document.querySelector(".chat-scroll-viewport").scrollTop -= 120')
    const afterHtmlWheel = await run('document.querySelector(".chat-scroll-viewport").scrollTop')
    await append('\n\nText arriving after upward scrolling over HTML.\n\n')
    await settle()
    assert.equal(await run('document.querySelector(".chat-scroll-viewport").scrollTop'), afterHtmlWheel, 'HTML upward scroll pauses following instead of snapping back')
    await run('fixture.follow()')
    await settleFollowing()
    const wheelTarget = await run(`(() => {
      const frame = document.querySelector('iframe').getBoundingClientRect();
      const viewport = document.querySelector('.chat-scroll-viewport').getBoundingClientRect();
      return {x: Math.round(frame.left + frame.width / 2), y: Math.round((Math.max(frame.top, viewport.top) + Math.min(frame.bottom, viewport.bottom)) / 2)};
    })()`)
    assert.equal(await run(`document.elementFromPoint(${wheelTarget.x}, ${wheelTarget.y})?.tagName`), 'IFRAME', `native wheel targets HTML at ${JSON.stringify(wheelTarget)}`)
    const beforeNativeWheel = await run('document.querySelector(".chat-scroll-viewport").scrollTop')
    await run('window.nativeWheelSamples=[]; document.querySelector(".chat-scroll-viewport").addEventListener("wheel", event => nativeWheelSamples.push({delta:event.deltaY,trusted:event.isTrusted})); void 0')
    window.webContents.sendInputEvent({ type: 'mouseMove', ...wheelTarget })
    await run('new Promise(resolve => setTimeout(resolve, 100))')
    window.webContents.sendInputEvent({ type: 'mouseWheel', ...wheelTarget, deltaX: 0, deltaY: 120, canScroll: true })
    await run('new Promise(resolve => setTimeout(resolve, 350))')
    await settle()
    const afterNativeWheel = await run('document.querySelector(".chat-scroll-viewport").scrollTop')
    const nativeWheelSamples = await run('nativeWheelSamples')
    assert.ok(Math.abs((beforeNativeWheel - afterNativeWheel) - 120) <= 1, `native wheel moves once without teleporting: ${beforeNativeWheel} -> ${afterNativeWheel}, ${JSON.stringify(nativeWheelSamples)}`)
    await append('\n\nMore text during native wheel scrolling.\n\n')
    await settle()
    assert.equal(await run('document.querySelector(".chat-scroll-viewport").scrollTop'), afterNativeWheel, 'native upward wheel over HTML does not rebound while streaming')
    await run('fixture.replace("Replay transition")')
    await settle()
    await run(`fixture.replace(${JSON.stringify(interactive)}); fixture.finish()`)
    await settle()
    scriptFrame = await waitForPreview()
    assert.equal(await run('retainedAppFrame === document.querySelector("iframe")'), false, 'saved-message remount creates a new page')
    assert.equal(await scriptFrame.executeJavaScript('window.clicks'), 0, 'saved HTML starts its script without a Run step')
    await run('fixture.follow()')

    const quizHtml = [
      '```tidehtml\n',
      '<form id="quiz"><label><input type="radio" name="answer" value="Jupiter" required>Jupiter</label><label><input type="radio" name="answer" value="Earth">Earth</label><button type="submit">Check my score</button><button type="reset">Try again</button></form>',
      '<p id="score"></p>',
      '<form id="external" action="https://example.com/blocked" method="post"><button type="submit">Submit externally</button></form>',
      '<script>',
      'const quiz = document.getElementById("quiz");',
      'const score = document.getElementById("score");',
      'quiz.addEventListener("submit", event => { event.preventDefault(); score.textContent = new FormData(quiz).get("answer") === "Jupiter" ? "1 out of 1" : "0 out of 1"; });',
      'quiz.addEventListener("reset", () => { score.textContent = ""; });',
      'window.quizReady = true;',
      '</script>\n```',
    ].join('')
    await run(`fixture.replace(${JSON.stringify(quizHtml)}); fixture.finish()`)
    let quizFrame
    for (let attempt = 0; attempt < 100; attempt++) {
      const frame = getPreviewFrame()
      if (frame && await frame.executeJavaScript('window.quizReady === true')) {
        quizFrame = frame
        break
      }
      await settle()
    }
    assert.ok(quizFrame, 'local quiz preview loads')
    await quizFrame.executeJavaScript('document.querySelector("#quiz button[type=submit]").click(); void 0')
    assert.equal(await quizFrame.executeJavaScript('document.getElementById("score").textContent'), '', 'required answers prevent premature scoring')
    await quizFrame.executeJavaScript('document.querySelector("input[value=Jupiter]").click(); document.querySelector("#quiz button[type=submit]").click(); void 0')
    assert.equal(await quizFrame.executeJavaScript('document.getElementById("score").textContent'), '1 out of 1', 'submit handler calculates quiz score')
    await quizFrame.executeJavaScript('document.querySelector("#quiz button[type=reset]").click(); void 0')
    assert.equal(await quizFrame.executeJavaScript('document.getElementById("score").textContent'), '', 'reset clears score')
    assert.equal(await quizFrame.executeJavaScript('document.querySelector("#quiz input:checked") === null'), true, 'reset clears selected answer')
    const blockedDirective = await quizFrame.executeJavaScript(`new Promise(resolve => {
      document.addEventListener('securitypolicyviolation', event => resolve(event.effectiveDirective), { once: true });
      document.querySelector('#external button').click();
    })`)
    assert.equal(blockedDirective, 'form-action', 'CSP blocks actual form destinations even with allow-forms')
    assert.equal(quizFrame.url, 'about:srcdoc', 'blocked form submission retains the preview document')

    const actionHtml = [
      '```tidehtml\n',
      '<button id="draft" onclick="tidecode.draft(\'Selected option\').then(r=>window.result=r)">Draft</button>',
      '<button id="send" onclick="tidecode.send(\'Explain my selection\').then(r=>window.result=r)">Send</button>',
      '<button id="copy" onclick="tidecode.copy(\'Copied selection\').then(r=>window.result=r)">Copy</button>',
      '<button id="open" onclick="tidecode.open(\'https://example.com/selection\').then(r=>window.result=r)">Open</button>',
      '<button id="invalid" onclick="tidecode.open(\'javascript:alert(1)\').then(r=>window.result=r)">Invalid link</button>',
      '<button id="late" onclick="setTimeout(()=>tidecode.send(\'Unwanted deferred message\').then(r=>window.result=r),0)">Deferred send</button>',
      '<script>window.auto=tidecode.send("Unwanted load message");document.body.dataset.ready="true"</script>\n```',
    ].join('')
    await run(`fixture.replace(${JSON.stringify(actionHtml)})`)
    await settle()
    const waitForActions = async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const frame = getPreviewFrame()
        if (frame && await frame.executeJavaScript('document.body?.dataset.ready === "true"')) return frame
        await settle()
      }
      throw new Error('Action page did not load')
    }
    const actionFrame = await waitForActions()
    const sentBeforeHtmlActions = await run('window.__sent')
    assert.equal((await actionFrame.executeJavaScript('window.auto')).ok, false, 'page-load sends are blocked')
    assert.equal(await actionFrame.executeJavaScript('document.head.querySelector("script") === null'), true, 'private bootstrap is removed before generated scripts run')
    await actionFrame.executeJavaScript('document.getElementById("send").click(); void 0')
    await settle()
    assert.equal((await actionFrame.executeJavaScript('window.result')).ok, false, 'synthetic clicks cannot submit an action')
    assert.equal(await run('window.__sent'), sentBeforeHtmlActions)
    window.webContents.debugger.attach('1.3')
    const activateHtmlButton = async (frame, id) => {
      window.webContents.focus()
      await frame.executeJavaScript(`(document.getElementById(${JSON.stringify(id)}) || document.querySelector('tide-ui')?.shadowRoot?.getElementById(${JSON.stringify(id)})).focus(); window.result = null; window.actionEvents=[]; document.addEventListener('click',event=>actionEvents.push(['click',event.isTrusted]),{once:true}); document.addEventListener('keydown',event=>actionEvents.push(['key',event.key]),{once:true}); void 0`)
      await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 })
      await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await settle()
    }
    const waitForActionResult = frame => frame.executeJavaScript(`(async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (window.result) return window.result;
        await new Promise(requestAnimationFrame);
      }
      throw new Error('Action result was not delivered: ' + JSON.stringify({events:window.actionEvents,active:document.activeElement?.outerHTML,focus:document.hasFocus()}));
    })()`)
    await activateHtmlButton(actionFrame, 'send')
    assert.equal((await waitForActionResult(actionFrame)).ok, false, 'real clicks cannot send while response is streaming')
    assert.equal(await run('window.__sent'), sentBeforeHtmlActions)
    await run('window.actionIframe=document.querySelector("iframe"); fixture.finish(); void 0')
    await settle()
    assert.equal(await run('actionIframe === document.querySelector("iframe")'), true, 'enabling host actions preserves page identity')
    await activateHtmlButton(actionFrame, 'draft')
    assert.equal((await waitForActionResult(actionFrame)).ok, true, 'trusted draft click returns success')
    assert.equal(await run('window.__draft'), 'Selected option')
    await run('window.__holdSend=true')
    await activateHtmlButton(actionFrame, 'send')
    await settle()
    assert.equal(await run('window.__sent'), sentBeforeHtmlActions + 1, 'trusted HTML sends through native callback')
    await actionFrame.executeJavaScript('document.getElementById("send").click(); void 0')
    await settle()
    assert.equal(await run('window.__sent'), sentBeforeHtmlActions + 1, 'pending action cannot duplicate a submission')
    await run('window.__holdSend=false; window.__releaseSend(true); void 0')
    await settle()
    // The synthetic duplicate has its own local failure result; the original
    // callback still resolves through the same page without remounting.
    assert.equal(await run('window.__sentMessages.at(-1)'), 'Explain my selection')
    assert.equal((await waitForActionResult(actionFrame)).ok, true, 'accepted send resolves its original promise')
    assert.equal(await run('actionIframe === document.querySelector("iframe")'), true, 'action completion preserves the running page')
    await run('window.__rejectSend=true')
    await activateHtmlButton(actionFrame, 'send')
    assert.equal((await waitForActionResult(actionFrame)).ok, false, 'rejected native send returns failure to HTML')
    await run('window.__rejectSend=false')
    await run('Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async value=>{window.__copied=value}}}); void 0')
    await activateHtmlButton(actionFrame, 'copy')
    assert.equal((await waitForActionResult(actionFrame)).ok, true)
    assert.equal(await run('window.__copied'), 'Copied selection', 'copy uses the host clipboard path')
    const openedUrls = []
    window.webContents.setWindowOpenHandler(({ url }) => { openedUrls.push(url); return { action: 'deny' } })
    await activateHtmlButton(actionFrame, 'open')
    assert.equal((await waitForActionResult(actionFrame)).ok, true, 'safe link request is acknowledged')
    assert.deepEqual(openedUrls, ['https://example.com/selection'])
    await activateHtmlButton(actionFrame, 'invalid')
    assert.equal((await waitForActionResult(actionFrame)).ok, false, 'unsafe links fail at the host')
    const beforeUntrustedRequests = await run('window.__sent')
    await activateHtmlButton(actionFrame, 'late')
    assert.equal((await waitForActionResult(actionFrame)).ok, false, 'deferred scripts cannot reuse a past user click')
    const publicToken = await run('document.querySelector("iframe").srcdoc.match(/nonce="([^"]+)"/)[1]')
    await actionFrame.executeJavaScript(`window.parent.postMessage({channel:'tidecode-html-preview',token:${JSON.stringify(publicToken)},credential:'forged',type:'action',id:9999,kind:'send',value:'Forged message'},'*'); void 0`)
    await settle()
    assert.equal(await run('window.__sent'), beforeUntrustedRequests, 'untrusted action requests never reach the chat callback')

    const staticActions = '```tidehtml\n<button id="static-draft" data-tide-action="draft" data-tide-value="Static selection">Use selection</button>\n```'
    await run(`fixture.replace(${JSON.stringify(staticActions)}); fixture.finish()`)
    await settle()
    let staticActionFrame
    for (let attempt = 0; attempt < 100; attempt++) {
      staticActionFrame = getPreviewFrame()
      if (staticActionFrame && await staticActionFrame.executeJavaScript('Boolean(document.getElementById("static-draft") && window.tidecode)')) break
      await settle()
    }
    await activateHtmlButton(staticActionFrame, 'static-draft')
    await settle()
    assert.equal(await run('window.__draft'), 'Static selection', 'static HTML declarative actions work without generated scripts')
    assert.equal(await staticActionFrame.executeJavaScript('document.querySelector("[data-tide-feedback]") === null'), true, 'successful actions do not add status text')

    const dynamicFirstHtml = '```tidehtml\n<script>const widget=document.createElement("tide-ui");widget.source=\'metric "Created before runtime" 7\';document.body.append(widget)</script>\n```'
    await run(`fixture.replace(${JSON.stringify(dynamicFirstHtml)}); fixture.finish()`)
    await settle()
    const firstDynamicFrame = getPreviewFrame()
    await firstDynamicFrame.executeJavaScript(`(async () => {
      for (let frame=0; frame<200; frame++) {
        if (document.querySelector('tide-ui')?.shadowRoot?.querySelector('.tideui-metric strong')?.textContent==='7') return;
        await new Promise(requestAnimationFrame);
      }
      throw new Error('A source assigned before custom-element upgrade was lost');
    })()`)

    const mixedHtml = [
      '```tidehtml\n',
      '<style>.custom-banner{padding:16px;background:#123456;color:white}</style>',
      '<section class="custom-banner">Custom HTML remains custom</section>',
      '<button id="styled" class="tideui-button" data-tide-action="draft" data-tide-value="HTML selection">Styled HTML</button>',
      '<tide-ui id="native"><script type="text/tideui">',
      '\npanel "Native widgets"',
      '\n  input "Notes" id=notes',
      '\n  select "Priority" id=priority default=low',
      '\n    option low "Low"',
      '\n    option high "High"',
      '\n  chart bar "Activity" interactive=true',
      '\n    point "One" 10',
      '\n    point "Two" 20',
      '\n  timer "Focus" id=focus duration=1',
      '\n  table "Name" "Status"',
      '\n    row "Parser" "Ready"',
      '\n  button "Use native selection" action=draft message="Native selection"',
      '\n</script></tide-ui>\n```',
    ].join('')
    await run(`fixture.replace(${JSON.stringify(mixedHtml)}); fixture.finish()`)
    await settle()
    const widgetFrame = getPreviewFrame()
    await widgetFrame.executeJavaScript(`(async () => {
      for (let frame = 0; frame < 200; frame++) {
        if (document.querySelector('tide-ui')?.shadowRoot?.querySelector('svg')) return;
        await new Promise(requestAnimationFrame);
      }
      throw new Error('Native HTML widgets did not mount');
    })()`)
    await widgetFrame.executeJavaScript('window.nativeRoot=document.querySelector("tide-ui").shadowRoot; window.nativeInput=nativeRoot.querySelector("input"); window.nativePlot=nativeRoot.querySelector("svg"); void 0')
    assert.equal(await widgetFrame.executeJavaScript('getComputedStyle(document.querySelector(".custom-banner")).backgroundColor'), 'rgb(18, 52, 86)', 'custom CSS remains active alongside native widgets')
    assert.equal(await widgetFrame.executeJavaScript('nativeRoot.querySelectorAll(".tideui-chart-mark").length'), 2, 'real native chart renders in custom HTML')
    assert.equal(await widgetFrame.executeJavaScript('nativeRoot.querySelector("table").textContent.includes("Parser")'), true, 'native Markdown table renders without editor code')
    await widgetFrame.executeJavaScript(`
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(nativeInput,'Keep this note');
      nativeInput.dispatchEvent(new Event('input',{bubbles:true}));
      nativeRoot.querySelector('.tideui-chart-mark').dispatchEvent(new MouseEvent('click',{bubbles:true}));
      document.querySelector('.custom-banner').style.height='240px'; void 0;
    `)
    await settle()
    const priorityTop = await widgetFrame.executeJavaScript('nativeRoot.querySelector("[aria-label=Priority]").getBoundingClientRect().top')
    await run(`(() => {
      const viewport=document.querySelector('.chat-scroll-viewport');
      viewport.dispatchEvent(new WheelEvent('wheel',{deltaY:-120,bubbles:true}));
      viewport.scrollTop += document.querySelector('iframe').getBoundingClientRect().top + ${priorityTop} - (viewport.getBoundingClientRect().bottom - 55);
    })()`)
    await settle()
    await widgetFrame.executeJavaScript('nativeRoot.querySelector("[aria-label=Priority]").click(); void 0')
    await settle()
    assert.equal(await widgetFrame.executeJavaScript('Boolean(nativeRoot.querySelector("[role=listbox]"))'), true, 'shared dropdown portal stays in the widget style scope')
    assert.equal(await widgetFrame.executeJavaScript(`(() => {
      const popup=nativeRoot.querySelector('[role=listbox]').getBoundingClientRect();
      const viewport=JSON.parse(document.documentElement.dataset.tidecodeViewport);
      return popup.height>0 && popup.top>=viewport.top && popup.bottom<=viewport.bottom+1;
    })()`), true, 'dropdown fits the visible chat area within a tall iframe')
    await widgetFrame.executeJavaScript('Array.from(nativeRoot.querySelectorAll("[role=option]")).find(option=>option.textContent.includes("High")).click(); void 0')
    await settle()
    assert.match(await widgetFrame.executeJavaScript('nativeRoot.querySelector("[aria-label=Priority]").textContent'), /High/)
    await widgetFrame.executeJavaScript('nativeRoot.querySelector(".tideui-chart-mark").focus(); void 0')
    await settle()
    assert.equal(await widgetFrame.executeJavaScript('Boolean(nativeRoot.querySelector("[role=tooltip]"))'), true, 'shared chart tooltip stays inside the widget style scope')
    await widgetFrame.executeJavaScript('Array.from(nativeRoot.querySelectorAll(".tideui-timer button")).find(button=>button.textContent==="Start").click(); void 0')
    await settle()
    assert.equal(await widgetFrame.executeJavaScript('Boolean(Array.from(nativeRoot.querySelectorAll(".tideui-timer button")).find(button=>button.textContent==="Pause"))'), true, 'real native timer runs inside HTML')
    await run('window.widgetIframe=document.querySelector("iframe"); document.documentElement.dataset.theme="dark"; document.documentElement.style.setProperty("--color-action","#234567"); void 0')
    await settle()
    assert.equal(await widgetFrame.executeJavaScript('getComputedStyle(document.getElementById("styled")).backgroundColor'), 'rgb(35, 69, 103)', 'ordinary HTML uses the shared design and active theme')
    assert.equal(await widgetFrame.executeJavaScript('getComputedStyle(nativeRoot.querySelector(".tideui-button")).backgroundColor'), 'rgb(35, 69, 103)', 'native shadow widgets follow theme changes')
    await widgetFrame.executeJavaScript('document.getElementById("native").source += \'\\n  metric "Added by JavaScript" 42\\n\'; void 0')
    await settle()
    assert.equal(await widgetFrame.executeJavaScript('nativeInput===nativeRoot.querySelector("input") && nativePlot===nativeRoot.querySelector("svg")'), true, 'updating widget source retains native DOM')
    assert.equal(await widgetFrame.executeJavaScript('nativeInput.value'), 'Keep this note', 'theme and source changes preserve control state')
    assert.match(await widgetFrame.executeJavaScript('nativeRoot.querySelector(".tideui-chart-detail").textContent'), /selected/)
    await widgetFrame.executeJavaScript('Array.from(nativeRoot.querySelectorAll("button")).find(button=>button.textContent==="Use native selection").id="native-draft"; void 0')
    await activateHtmlButton(widgetFrame, 'native-draft')
    await settle()
    assert.equal(await run('window.__draft'), 'Native selection', 'native widgets use the same guarded host action bridge')
    await append('\n\nSurrounding text after mixed HTML and native widgets.')
    await settle()
    assert.equal(await run('widgetIframe===document.querySelector("iframe")'), true, 'mixed widgets retain iframe identity while prose streams')
    await widgetFrame.executeJavaScript('window.dynamicWidget=document.createElement("tide-ui"); dynamicWidget.source=\'metric "Dynamic widget" 3\'; document.body.append(dynamicWidget); void 0')
    await settle()
    assert.equal(await widgetFrame.executeJavaScript('dynamicWidget.shadowRoot.querySelector(".tideui-metric strong").textContent'), '3', 'custom JavaScript can add native widgets dynamically')
    await widgetFrame.executeJavaScript('dynamicWidget.remove(); document.body.append(dynamicWidget); void 0')
    await settle()
    assert.equal(await widgetFrame.executeJavaScript('dynamicWidget.shadowRoot.querySelector(".tideui-metric strong").textContent'), '3', 'moving a widget retains a working renderer')
    if (process.env.TIDECODE_HTML_WIDGET_SCREENSHOT) {
      window.setSize(900, 1200)
      await run('document.getElementById("root").style.cssText="width:860px;height:1160px"; document.querySelector(".chat-scroll-viewport").dispatchEvent(new WheelEvent("wheel",{deltaY:-120,bubbles:true})); document.querySelector(".chat-scroll-viewport").scrollTop=0; void 0')
      await settle()
      require('node:fs').writeFileSync(process.env.TIDECODE_HTML_WIDGET_SCREENSHOT, (await window.webContents.capturePage()).toPNG())
      window.setSize(700, 500)
      await run('document.getElementById("root").style.cssText="width:600px;height:320px"; void 0')
      await settle()
    }
    await run('document.documentElement.removeAttribute("data-theme"); document.documentElement.style.removeProperty("--color-action"); void 0')
    await run('fixture.follow()')
    window.webContents.debugger.detach()

    const textOnlyContent = Array.from({ length: 20 }, (_, index) => `Normal chat paragraph ${index}.\n\n`).join('')
    await run(`fixture.replace(${JSON.stringify(textOnlyContent)})`)
    await settleFollowing()
    assert.equal(await run('document.querySelectorAll(".tideui-root").length'), 0, 'text-only test has no generated UI')
    assertImmediateTrace(await traceAppend(' More ordinary streaming words that wrap onto additional lines.'.repeat(12)), 'Plain text wrapping')
    assertImmediateTrace(await traceAppend('\n\nA new normal paragraph.\n\nAnother normal paragraph.\n\n'), 'Plain text paragraphs')
    assertImmediateTrace(await traceAppend('| Name | Status |\n| --- | --- |\n| Parser | Ready |\n| Renderer | Ready |\n\n'), 'Markdown table')
    assertImmediateTrace(await traceAppend('```text\nFirst code line\nSecond code line\nThird code line\n```\n'), 'Markdown code block')
    await settleFollowing()

    // Reproduce the first text-to-panel transition, including partial opener
    // tokens that previously mounted a transient code preview.
    const intro = textOnlyContent + 'Here is a dashboard.\n\n'
    await run(`fixture.replace(${JSON.stringify(intro)})`)
    await settleFollowing()
    await run(`window.introMarkdown = document.querySelector('.chat-markdown');
      window.introParagraph = introMarkdown.querySelector('p'); void 0`)
    const introHeight = await run('document.querySelector(".chat-scroll-viewport").scrollHeight')
    for (const token of ['`', '`', '`', 't', 'ide', 'ui', '\n']) {
      await append(token)
      await settle()
      assert.equal(await run('introMarkdown === document.querySelector(".chat-markdown") && introParagraph.isConnected'), true, 'opening fence retains preceding markdown')
      assert.equal(await run('document.querySelectorAll("[data-code-renderer]").length'), 0, 'partial native opener never mounts a code preview')
      assert.equal(await run('document.querySelector(".chat-scroll-viewport").scrollHeight'), introHeight, 'incomplete opener does not shift the scroll target')
    }
    assertImmediateTrace(await traceAppend('panel "Initial panel"\n'), 'First panel after plain text')
    assert.equal(await run('introMarkdown === document.querySelector(".chat-markdown") && introParagraph.isConnected'), true, 'first panel does not remount the preceding text')
    await run('window.firstSpawnedPanel = document.querySelector(".tideui-card"); void 0')
    await append('  item "Standalone entry"\n  timeline "Milestones"\n    point "Today" "Started"\n')
    await settle()
    assert.equal(await run('firstSpawnedPanel === document.querySelector(".tideui-card")'), true, 'panel stays mounted while flexible entries arrive')
    assert.equal(await run('document.querySelectorAll(".tideui-error").length'), 0, 'flexible entries do not create an error panel')
    assert.equal(await atBottom(), true)

    const reasoning = Array.from({ length: 24 }, (_, index) => `Reasoning paragraph ${index}.\n\n`).join('')
    await run(`fixture.reasoning(${JSON.stringify(reasoning)})`)
    const reasoningSelector = '.chat-scroll-viewport .chat-scroll-viewport'
    await settleFollowing(reasoningSelector)
    assertImmediateTrace(await traceAppend('\nMore reasoning content.\n\nAnother reasoning paragraph.\n\n', reasoningSelector, 'appendReasoning'), 'Reasoning text')
    console.log('TIDEUI_STABILITY_PASS', JSON.stringify(await counts()))
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
}).catch(error => {
  console.error(error)
  app.exit(1)
})
