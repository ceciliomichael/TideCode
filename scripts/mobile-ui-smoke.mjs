/* eslint-env node */
import http from 'node:http'
import WebSocket from 'ws'

const cdpPort = Number.parseInt(process.env.TIDECODE_CDP_PORT ?? '9223', 10)
const targetUrl = process.env.TIDECODE_REMOTE_URL ?? 'http://127.0.0.1:38573/'
const workspacePath = process.env.TIDECODE_SMOKE_WORKSPACE ?? 'C:/Users/Admin/Desktop/tidecode'
const viewport = { width: 390, height: 844 }

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (error) {
          reject(error)
        }
      })
    })
    request.on('error', reject)
  })
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const targets = await getJson(`http://127.0.0.1:${cdpPort}/json`)
const target = targets.find((entry) => entry.type === 'page' && entry.url.startsWith(targetUrl))
if (!target?.webSocketDebuggerUrl) {
  throw new Error(`No Chrome page found for ${targetUrl}`)
}

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.once('open', resolve)
  socket.once('error', reject)
})

let requestId = 0
const pending = new Map()
const consoleErrors = []

socket.on('message', (raw) => {
  const message = JSON.parse(raw.toString())
  if (message.id) {
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    if (message.error) waiter.reject(new Error(message.error.message))
    else waiter.resolve(message.result)
    return
  }
  if (message.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(message.params?.exceptionDetails?.text ?? 'Runtime exception')
  }
})

function send(method, params = {}) {
  requestId += 1
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject })
    socket.send(JSON.stringify({ id: requestId, method, params }))
  })
}

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
  }
  return response.result?.value
}

async function waitFor(expression, description, timeoutMs = 10_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(expression)) return
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${description}`)
}

async function clickButton(label) {
  const clicked = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')].filter((button) => {
      const rect = button.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && getComputedStyle(button).visibility !== 'hidden'
    })
    const button = buttons.find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)})
      ?? buttons.find((candidate) => candidate.textContent?.includes(${JSON.stringify(label)}))
    if (!button) return false
    button.click()
    return true
  })()`)
  assert(clicked, `Could not find visible button: ${label}`)
  await delay(150)
}

async function clickAria(label) {
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) => {
      if (candidate.getAttribute('aria-label') !== ${JSON.stringify(label)}) return false
      const rect = candidate.getBoundingClientRect()
      const style = getComputedStyle(candidate)
      if (rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return false
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return Boolean(hit && candidate.contains(hit))
    })
    if (!button) return false
    button.click()
    return true
  })()`)
  assert(clicked, `Could not find visible aria button: ${label}`)
  await delay(150)
}

async function measure(label) {
  const metrics = await evaluate(`(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    }
    const overflowing = [...document.querySelectorAll('body *')].filter((element) => {
      if (!visible(element)) return false
      const rect = element.getBoundingClientRect()
      return rect.left < -1 || rect.right > window.innerWidth + 1
    }).slice(0, 8).map((element) => ({
      tag: element.tagName,
      aria: element.getAttribute('aria-label'),
      text: element.textContent?.trim().slice(0, 60) ?? '',
      left: Math.round(element.getBoundingClientRect().left),
      right: Math.round(element.getBoundingClientRect().right),
    }))
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      overflowing,
    }
  })()`)
  assert(metrics.width === viewport.width, `${label}: expected width ${viewport.width}, got ${metrics.width}`)
  assert(metrics.scrollWidth <= metrics.width + 1, `${label}: document horizontally overflows (${metrics.scrollWidth} > ${metrics.width})`)
  assert(metrics.overflowing.length === 0, `${label}: visible elements overflow viewport: ${JSON.stringify(metrics.overflowing)}`)
  return { label, ...metrics }
}

const checkpoints = []
const smokeTaskTitle = `Mobile smoke task ${Date.now()}`
const smokeTaskCardSelector = `article[aria-label=${JSON.stringify('Open task ' + smokeTaskTitle)}]`
try {
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 2,
    mobile: true,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  })
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await send('Page.reload', { ignoreCache: true })

  await waitFor(
    `Boolean(window.tidecodeHistory && document.querySelector('nav[aria-label="Mobile workspace navigation"]'))`,
    'mobile TideCode shell',
  )
  checkpoints.push(await measure('Chat'))

  const seed = await evaluate(`(async () => {
    const normalizePath = (value) => value.split(String.fromCharCode(92)).join('/').toLowerCase()
    const folders = await window.tidecodeHistory.listFolders()
    let folder = folders.find((candidate) => normalizePath(candidate.path) === normalizePath(${JSON.stringify(workspacePath)}))
    if (!folder) {
      folder = await window.tidecodeHistory.createFolderFromPath(${JSON.stringify(workspacePath)})
    }
    const conversation = await window.tidecodeHistory.createConversation({ folderId: folder.id })
    await window.tidecodeSettings.updateSettings({
      lastActiveConversationId: conversation.id,
      lastActiveDraftFolderId: folder.id,
      selectedProjectId: folder.id,
      selectedProjectName: folder.name,
    })
    return { folder, conversationId: conversation.id }
  })()`)
  assert(seed?.folder?.id, 'Failed to seed a temporary workspace')

  await send('Page.reload', { ignoreCache: true })
  await waitFor(
    `Boolean(window.tidecodeHistory && document.querySelector('nav[aria-label="Mobile workspace navigation"]'))`,
    'seeded mobile shell',
  )
  await clickButton('Chat')
  await waitFor(`Boolean(document.querySelector('.chat-input-shell textarea'))`, 'mobile chat composer')
  const composerMetrics = await evaluate(`(() => {
    const controls = document.querySelector('[data-mobile-runtime-controls="true"]')
    if (!(controls instanceof HTMLElement)) return null
    const rect = controls.getBoundingClientRect()
    const modelButton = [...controls.querySelectorAll('button')].find((button) => button.getAttribute('aria-haspopup') === 'listbox' && button.textContent?.includes('gpt'))
    const modelRect = modelButton instanceof HTMLElement ? modelButton.getBoundingClientRect() : null
    const modelLabel = modelButton?.querySelector('.chat-runtime-control-label')
    const modelLabelRect = modelLabel instanceof HTMLElement ? modelLabel.getBoundingClientRect() : null
    const sendButton = [...document.querySelectorAll('button')].find((button) => ['Send message', 'Stop generating', 'Queue message', 'Steer message'].includes(button.getAttribute('aria-label') ?? ''))
    const sendRect = sendButton instanceof HTMLElement ? sendButton.getBoundingClientRect() : null
    const contextButton = [...document.querySelectorAll('button')].find((button) => (button.getAttribute('aria-label') ?? '').startsWith('Estimated context usage'))
    const children = [...controls.children].map((child) => child.getBoundingClientRect())
    return {
      left: rect.left,
      right: rect.right,
      centerY: rect.top + rect.height / 2,
      sendCenterY: sendRect ? sendRect.top + sendRect.height / 2 : null,
      modelWidth: modelRect?.width ?? null,
      modelLabelWidth: modelLabelRect?.width ?? null,
      contextVisible: contextButton instanceof HTMLElement && contextButton.getBoundingClientRect().width > 0,
      childBounds: children.map((child) => ({ left: child.left, right: child.right })),
    }
  })()` )
  assert(composerMetrics, 'Mobile chat runtime controls are missing')
  assert(composerMetrics.childBounds.every((child) => child.left >= composerMetrics.left - 1 && child.right <= composerMetrics.right + 1), 'Mobile chat runtime selectors overflow the composer')
  if (composerMetrics.modelWidth !== null) assert(composerMetrics.modelWidth <= 86, 'Mobile model selector is too wide')
  if (composerMetrics.modelLabelWidth !== null) assert(composerMetrics.modelLabelWidth <= 61, 'Mobile model label is not tightly truncated')
  assert(composerMetrics.sendCenterY !== null && Math.abs(composerMetrics.sendCenterY - composerMetrics.centerY) < 4, 'Mobile send button is not aligned with runtime selectors')
  assert(composerMetrics.contextVisible, 'Mobile context indicator is missing')

  const tooltipSuppressed = await evaluate(`(async () => {
    const attachButton = document.querySelector('button[aria-label="Attach files"]')
    if (!(attachButton instanceof HTMLElement)) return false
    attachButton.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    attachButton.focus()
    await new Promise((resolve) => setTimeout(resolve, 200))
    return !document.querySelector('[role="tooltip"]')
  })()` )
  assert(tooltipSuppressed, 'Mobile UI still renders tooltips')

  const remoteMentionFiles = await evaluate(`window.tidecodeWorkspace.listDirectory({
    recursive: true,
    workspaceRootPath: ${JSON.stringify(workspacePath)},
  })`)
  assert(Array.isArray(remoteMentionFiles), 'Remote workspace recursive listing is unavailable for file mentions')
  assert(remoteMentionFiles.some((entry) => !entry.isDirectory && entry.name === 'package.json'), 'Remote workspace recursive listing did not return package.json for file mentions')
  checkpoints.push(await measure('Chat with workspace'))

  const desktopControlsVisible = await evaluate(`(() => {
    const labels = ['Open Kanban board', 'Open terminal panel', 'Commit changes', 'Toggle Source Control panel', 'Toggle Diff panel', 'Toggle explorer panel']
    return [...document.querySelectorAll('button')].some((button) => {
      const rect = button.getBoundingClientRect()
      const title = button.getAttribute('aria-label') ?? button.textContent ?? ''
      return rect.width > 0 && rect.height > 0 && labels.some((label) => title.includes(label))
    })
  })()`)
  assert(!desktopControlsVisible, 'Desktop workspace panel controls are visible on mobile')

  await clickAria('Open history')
  await waitFor(`Boolean(document.querySelector('[data-sidebar-root="true"]'))`, 'mobile navigation menu')
  const sidebarRect = await evaluate(`(() => {
    const rect = document.querySelector('[data-sidebar-root="true"]')?.getBoundingClientRect()
    return rect ? { width: rect.width, height: rect.height, left: rect.left, top: rect.top } : null
  })()`)
  assert(sidebarRect && sidebarRect.width >= viewport.width - 1, 'Mobile sidebar is not full-width')
  assert(sidebarRect && sidebarRect.height >= viewport.height - 1, 'Mobile sidebar is not full-height')
  const sidebarNavigation = await evaluate(`(() => {
    const root = document.querySelector('[data-sidebar-root="true"]')
    const closeMenu = root?.querySelector('button[aria-label="Close history"]')
    const hasNavigationTitle = [...(root?.querySelectorAll('p') ?? [])].some((element) => element.textContent?.trim() === 'Navigation')
    return { closeMenuActive: closeMenu?.getAttribute('aria-current') === 'page', hasNavigationTitle }
  })()`)
  assert(sidebarNavigation?.closeMenuActive, 'Open History does not show the bottom History item as active')
  assert(!sidebarNavigation?.hasNavigationTitle, 'Open mobile menu still renders the Navigation title')
  const settingsPlacement = await evaluate(`(() => {
    const root = document.querySelector('[data-sidebar-root="true"]')
    const visibleSettings = [...(root?.querySelectorAll('button') ?? [])].filter((button) => {
      if (button.textContent?.trim() !== 'Settings') return false
      const rect = button.getBoundingClientRect()
      const style = getComputedStyle(button)
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    })
    return {
      count: visibleSettings.length,
      allInBottomNav: visibleSettings.every((button) => Boolean(button.closest('nav[aria-label="Mobile workspace navigation"]'))),
    }
  })()`)
  assert(settingsPlacement?.count === 1 && settingsPlacement.allInBottomNav, 'Settings still appears inside the main mobile menu instead of only in bottom navigation')
  checkpoints.push(await measure('Full-screen sidebar'))

  await clickAria('Start new thread')
  await waitFor(`Boolean(document.querySelector('[aria-label="Commands, projects, and threads"]'))`, 'New Thread dialog')
  const newThreadModal = await evaluate(`(() => {
    const dialog = document.querySelector('[aria-label="Commands, projects, and threads"]')
    const rect = dialog?.getBoundingClientRect()
    return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null
  })()`)
  assert(newThreadModal && newThreadModal.left > 0 && newThreadModal.right < viewport.width, 'New Thread dialog is not inset on mobile')
  assert(newThreadModal && newThreadModal.top > 0 && newThreadModal.bottom < viewport.height, 'New Thread dialog exceeds mobile viewport')
  checkpoints.push(await measure('New Thread dialog'))
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await waitFor(`!document.querySelector('[aria-label="Commands, projects, and threads"]')`, 'New Thread dialog close')

  await clickAria('Close history')

  await clickButton('Terminal')
  await waitFor(`Boolean(document.querySelector('button[aria-label="New terminal tab"]'))`, 'terminal surface')
  await waitFor(`document.body.textContent?.includes('No terminal sessions') ?? false`, 'empty mobile terminal state')
  const terminalBeforeCreate = await evaluate(`(() => ({
    hasMenu: Boolean(document.querySelector('button[aria-label="Open history"]')),
    tabCount: document.querySelectorAll('.workspace-tabs-scroll-viewport > *').length,
    hasNewTerminalAction: [...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'New terminal'),
  }))()`)
  assert(terminalBeforeCreate?.hasMenu, 'History is not reachable from Terminal')
  assert(terminalBeforeCreate?.tabCount === 0, 'Opening mobile Terminal automatically created a terminal tab')
  assert(terminalBeforeCreate?.hasNewTerminalAction, 'Mobile Terminal empty state does not expose New terminal')
  checkpoints.push(await measure('Terminal empty state'))
  await clickButton('New terminal')
  await waitFor(`Boolean(document.querySelector('.workspace-tabs-scroll-viewport button'))`, 'explicit mobile terminal creation')
  const terminalTabLeft = await evaluate(`document.querySelector('.workspace-tabs-scroll-viewport button')?.getBoundingClientRect().left ?? null`)
  assert(typeof terminalTabLeft === 'number' && terminalTabLeft < 8, 'Terminal header still reserves the old mobile menu gutter')
  checkpoints.push(await measure('Terminal'))

  await clickButton('Board')
  await waitFor(`document.body.textContent?.includes('Work board') ?? false`, 'board surface')
  const boardMetrics = await evaluate(`(() => {
    const hasMenu = Boolean(document.querySelector('button[aria-label="Open history"]'))
    const heading = [...document.querySelectorAll('h1')].find((element) => element.textContent?.trim() === 'Work board')
    const left = heading instanceof HTMLElement ? heading.getBoundingClientRect().left : null
    return { hasMenu, left }
  })()`)
  assert(boardMetrics?.hasMenu, 'History is not reachable from Board')
  assert(typeof boardMetrics?.left === 'number' && boardMetrics.left < 24, 'Board header still reserves the old mobile menu gutter')
  const boardLayoutMetrics = await evaluate(`(() => {
    const nav = document.querySelector('nav[aria-label="Board columns"]')
    const buttons = nav ? [...nav.querySelectorAll('button')] : []
    const widths = buttons.map((button) => button.getBoundingClientRect().width)
    const cardScroll = document.querySelector('[data-kanban-card-scroll="true"]')
    const scrollStyle = cardScroll instanceof HTMLElement ? getComputedStyle(cardScroll) : null
    const scrollRect = cardScroll instanceof HTMLElement ? cardScroll.getBoundingClientRect() : null
    return { widths, overflowY: scrollStyle?.overflowY ?? null, height: scrollRect?.height ?? 0 }
  })()` )
  assert(boardLayoutMetrics?.widths.length === 4, 'Board does not expose four mobile column filters')
  assert(Math.max(...boardLayoutMetrics.widths) - Math.min(...boardLayoutMetrics.widths) < 1, 'Board mobile column filters are not equal width')
  assert(boardLayoutMetrics.overflowY === 'auto' && boardLayoutMetrics.height > 0, 'Board card list is not independently scrollable')
  checkpoints.push(await measure('Board'))

  await waitFor(`Boolean(document.querySelector('button[aria-label="Add task to Backlog"]'))`, 'Board task controls')
  await clickAria('Add task to Backlog')
  await waitFor(`Boolean(document.querySelector('[aria-labelledby="kanban-task-dialog-title"]'))`, 'task composer modal')
  const taskModal = await evaluate(`(() => {
    const dialog = document.querySelector('[aria-labelledby="kanban-task-dialog-title"]')
    const rect = dialog?.getBoundingClientRect()
    return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, radius: getComputedStyle(dialog).borderRadius } : null
  })()`)
  assert(taskModal && taskModal.left > 0 && taskModal.right < viewport.width, 'Board task composer is not an inset modal')
  assert(taskModal && taskModal.top > 0 && taskModal.bottom < viewport.height, 'Board task composer exceeds the mobile viewport')
  checkpoints.push(await measure('Board task modal'))

  const titleSet = await evaluate(`(() => {
    const input = document.querySelector('#kanban-task-title')
    if (!(input instanceof HTMLInputElement)) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, ${JSON.stringify(smokeTaskTitle)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return input.value === ${JSON.stringify(smokeTaskTitle)}
  })()`)
  assert(titleSet, 'Could not populate Board task title')
  await clickButton('Create task')
  await waitFor(`!document.querySelector('[aria-labelledby="kanban-task-dialog-title"]')`, 'Board task creation')
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(smokeTaskCardSelector)}))`, 'new Board task card')
  checkpoints.push(await measure('Board after task creation'))

  const taskOpened = await evaluate(`(() => {
    const card = document.querySelector(${JSON.stringify(smokeTaskCardSelector)})
    if (!(card instanceof HTMLElement)) return false
    card.click()
    return true
  })()`)
  assert(taskOpened, 'Could not open Board task details')
  await waitFor(`Boolean(document.querySelector('[aria-labelledby="kanban-details-title"]'))`, 'Board task details')
  checkpoints.push(await measure('Board task details'))
  await clickAria('Close task details')

  await clickButton('Settings')
  await waitFor(`Boolean(document.querySelector('nav[aria-label="Settings navigation"]'))`, 'Settings mobile navigation')
  checkpoints.push(await measure('Settings navigation'))

  const settingsSidebarRect = await evaluate(`(() => {
    const sidebar = document.querySelector('nav[aria-label="Settings navigation"]')?.closest('aside')
    const root = sidebar?.closest('[data-sidebar-root="true"]')
    const rect = root?.getBoundingClientRect()
    return rect ? { width: rect.width, height: rect.height } : null
  })()`)
  assert(settingsSidebarRect && settingsSidebarRect.width >= viewport.width - 1, 'Settings sidebar is not full-width')
  const settingsOpenControls = await evaluate(`(() => {
    const backButton = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Back to app')
    const collapseButton = document.querySelector('button[aria-label="Collapse sidebar"]')
    const isTopmost = (element) => {
      if (!(element instanceof HTMLElement)) return false
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return false
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return Boolean(hit && element.contains(hit))
    }
    return { backToAppVisible: isTopmost(backButton), collapseVisible: isTopmost(collapseButton) }
  })()`)
  assert(settingsOpenControls?.backToAppVisible, 'Settings mobile navigation does not expose Back to app')
  assert(!settingsOpenControls?.collapseVisible, 'Settings mobile navigation still exposes the top X/collapse control')

  const settingsPages = ['General', 'Providers', 'Models', 'MCP Servers', 'Skills', 'Configuration', 'Updates']
  for (const page of settingsPages) {
    if (!(await evaluate(`Boolean(document.querySelector('nav[aria-label="Settings navigation"]'))`))) {
      await clickAria('Open sidebar')
      await waitFor(`Boolean(document.querySelector('nav[aria-label="Settings navigation"]'))`, 'Settings navigation reopen')
    }
    await clickButton(page)
    await waitFor(`!document.querySelector('nav[aria-label="Settings navigation"]')`, `${page} settings content`)
    const mobilePageTitle = await evaluate(`document.querySelector('[data-mobile-page-title="true"]')?.textContent?.trim() === ${JSON.stringify(page)}`)
    assert(mobilePageTitle, `${page}: active Settings page title is not shown beside the menu control`)
    if (page === 'Updates') {
      const toggleMetrics = await evaluate(`(() => {
        const group = document.querySelector('[role="group"][aria-label="Check for updates at launch"]')
        if (!(group instanceof HTMLElement)) return null
        const buttons = [...group.querySelectorAll('button')]
        const groupRect = group.getBoundingClientRect()
        return {
          groupWidth: groupRect.width,
          buttonWidths: buttons.map((button) => button.getBoundingClientRect().width),
        }
      })()`)
      assert(toggleMetrics?.buttonWidths?.length === 2, 'Updates segmented toggle does not have two options')
      assert(Math.abs(toggleMetrics.buttonWidths[0] - toggleMetrics.buttonWidths[1]) < 1, 'Updates segmented toggle options are not equal width')
      assert(toggleMetrics.buttonWidths[0] + toggleMetrics.buttonWidths[1] > toggleMetrics.groupWidth * 0.85, 'Updates segmented toggle options do not fill the mobile control')
    }
    checkpoints.push(await measure(`Settings: ${page}`))
  }

  await clickAria('Open sidebar')
  await clickButton('Providers')
  await waitFor(`!document.querySelector('nav[aria-label="Settings navigation"]')`, 'Providers settings')
  const configureExists = await evaluate(`[...document.querySelectorAll('button')].some((button) => button.textContent?.includes('Configure'))`)
  if (configureExists) {
    await clickButton('Configure')
    await waitFor(`Boolean(document.querySelector('[aria-labelledby="provider-dialog-title"]'))`, 'provider modal')
    const providerModal = await evaluate(`(() => {
      const rect = document.querySelector('[aria-labelledby="provider-dialog-title"]')?.getBoundingClientRect()
      return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null
    })()`)
    assert(providerModal && providerModal.left > 0 && providerModal.right < viewport.width, 'Provider setup is not an inset modal')
    assert(providerModal && providerModal.top > 0 && providerModal.bottom < viewport.height, 'Provider modal exceeds the mobile viewport')
    checkpoints.push(await measure('Provider modal'))
    await clickAria('Close provider dialog')
  }

  await clickAria('Open sidebar')
  await clickButton('Models')
  await clickButton('Add model')
  await waitFor(`Boolean(document.querySelector('[aria-labelledby="user-model-dialog-title"]'))`, 'model modal')
  checkpoints.push(await measure('Model modal'))
  await clickAria('Close model dialog')

  await clickAria('Open sidebar')
  await clickButton('MCP Servers')
  await clickButton('Add MCP')
  await waitFor(`Boolean(document.querySelector('[aria-labelledby="mcp-server-dialog-title"]'))`, 'MCP modal')
  checkpoints.push(await measure('MCP modal'))
  await clickAria('Close Add MCP dialog')

  await clickAria('Open sidebar')
  await clickButton('Skills')
  await clickButton('Add Skill')
  await waitFor(`Boolean(document.querySelector('input#skill-name'))`, 'Skill modal')
  checkpoints.push(await measure('Skill modal'))

  assert(consoleErrors.length === 0, `Runtime exceptions: ${consoleErrors.join('; ')}`)
  console.log(JSON.stringify({ ok: true, viewport, seed, checkpoints }, null, 2))
} finally {
  socket.close()
}
