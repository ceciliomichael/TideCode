import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import { build } from 'esbuild'
import type { TerminalDataEvent, TerminalExitEvent, WriteTerminalSessionInput } from '../../src/types/chat'
import type { TerminalTabState } from '../../src/components/chat/workspaceTerminalPanel/workspaceTerminalPanelTypes'

// Exercise the real input and event handlers. Replace only the xterm/React/DOM
// boundaries so errors and late completions can be delivered deterministically.
const compiled = await build({
  stdin: {
    contents: `export { createTerminalInstance } from '../../src/components/chat/workspaceTerminalPanel/terminalInstance'; export { useTerminalSessionEvents } from '../../src/components/chat/workspaceTerminalPanel/useTerminalSessionEvents'; export { useWorkspaceTerminalSessionState } from '../../src/components/chat/workspaceTerminalPanel/useWorkspaceTerminalSessionState'`,
    resolveDir: import.meta.dirname,
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', loader: { '.css': 'empty' },
})

class TestTerminal {
  input: (data: string) => void = () => {}
  keyHandler: (event: KeyboardEvent) => boolean = () => true
  writes: string[] = []
  options = {}
  cols = 80
  rows = 24
  dispose() {}
  focus() {}
  loadAddon() {}
  open() {}
  clearSelection() {}
  attachCustomKeyEventHandler(callback: TestTerminal['keyHandler']) { this.keyHandler = callback }
  onData(callback: TestTerminal['input']) { this.input = callback; return { dispose() {} } }
  onResize() { return { dispose() {} } }
  write(data: string) { this.writes.push(data) }
  writeln(data: string) { this.writes.push(data) }
}

const require = createRequire(import.meta.url)
function loadHandlers(reactMock = { useEffect: (effect: () => void) => effect() }) {
  const module = { exports: {} as {
    useWorkspaceTerminalSessionState: typeof import('../../src/components/chat/workspaceTerminalPanel/useWorkspaceTerminalSessionState').useWorkspaceTerminalSessionState
    createTerminalInstance: typeof import('../../src/components/chat/workspaceTerminalPanel/terminalInstance').createTerminalInstance
    useTerminalSessionEvents: typeof import('../../src/components/chat/workspaceTerminalPanel/useTerminalSessionEvents').useTerminalSessionEvents
  } }
  vm.runInThisContext(`(function(module, require) { ${compiled.outputFiles[0].text}\n })`)(module, (name: string) => {
    if (name.endsWith('.css')) {
      return {}
    }
    if (name === '@xterm/xterm') {
      return { Terminal: TestTerminal }
    }
    if (name === '@xterm/addon-fit') {
      return { FitAddon: class { proposeDimensions() { return { cols: 80, rows: 24 } } fit() {} } }
    }
    if (name === '@xterm/addon-web-links') {
      return { WebLinksAddon: class {} }
    }
    if (name === 'react') {
      return reactMock
    }
    return require(name)
  })
  return module.exports
}

function makeTab(brokerSessionId = 'old-broker'): TerminalTabState {
  return {
    key: 'workspace::terminal-tab-1', brokerSessionId, sessionId: 7, label: 'Terminal',
    status: 'ready', errorMessage: null, exitCode: null, workspaceRootPath: '/workspace',
  }
}

test('the terminal state hook restarts a lost session, reports creation failure, and can restart again', async (t) => {
  const originals = ['window', 'document'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const)
  t.after(() => {
    for (const [name, descriptor] of originals) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor)
      } else {
        Reflect.deleteProperty(globalThis, name)
      }
    }
  })
  const values: unknown[] = []
  let cursor = 0
  let effects: Array<() => void> = []
  const state = (initial: unknown) => {
    const index = cursor++
    if (!(index in values)) {
      values[index] = typeof initial === 'function' ? initial() : initial
    }
    return [values[index], (update: unknown) => {
      values[index] = typeof update === 'function' ? update(values[index]) : update
    }] as const
  }
  const memo = (calculate: () => unknown, dependencies: unknown[]) => {
    const index = cursor++
    const previous = values[index] as { dependencies: unknown[]; value: unknown } | undefined
    if (!previous || dependencies.some((value, offset) => !Object.is(value, previous.dependencies[offset]))) {
      values[index] = { dependencies, value: calculate() }
    }
    return (values[index] as { value: unknown }).value
  }
  const reactMock = {
    useState: state,
    useRef: (initial: unknown) => state(() => ({ current: initial }))[0],
    useMemo: memo,
    useCallback: (callback: unknown, dependencies: unknown[]) => memo(() => callback, dependencies),
    useEffect: (effect: () => void, dependencies: unknown[]) => {
      memo(() => { effects.push(effect) }, dependencies)
    },
  }
  let sequence = 0
  let failCreation = false
  const keys: string[] = []
  const closeRequests: Array<{ brokerSessionId?: string }> = []
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    tidecodeTerminal: {
      onData: () => () => {}, onExit: () => () => {}, onTabClosed: () => () => {},
      resizeSession: async () => {},
      closeSession: async (input: { brokerSessionId?: string }) => {
        closeRequests.push(input)
        throw new Error('Unknown terminal broker session id: lost-session')
      },
      createSession: async (input: { sessionKey: string }) => {
        keys.push(input.sessionKey)
        if (failCreation) {
          throw new Error('Unable to create test shell')
        }
        sequence += 1
        return { sessionId: sequence, brokerSessionId: `broker-${sequence}`, bufferedOutput: '', workspaceRootPath: '/workspace' }
      },
    },
  } })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    body: {}, createElement: () => ({ style: {}, addEventListener() {}, remove() {} }),
  } })
  const { useWorkspaceTerminalSessionState: renderSessionState } = loadHandlers(reactMock)
  const render = () => {
    cursor = 0
    effects = []
    const result = renderSessionState({
      workspaceKey: 'workspace', workspacePath: '/workspace', resolvedTheme: 'dark',
      isOpen: false, isResizing: false, onClose: () => {},
    })
    effects.forEach((effect) => effect())
    return result
  }
  let controller = render()
  await controller.openTerminalTab()
  controller = render()
  assert.equal(controller.activeTerminalTab?.brokerSessionId, 'broker-1')
  const tabKey = controller.activeTerminalTab!.key
  await controller.restartTerminalTab(tabKey)
  controller = render()
  assert.equal(closeRequests[0].brokerSessionId, 'broker-1')
  assert.equal(controller.activeTerminalTab?.brokerSessionId, 'broker-2')
  assert.equal(controller.activeTerminalTab?.status, 'ready')
  assert.notEqual(keys[0], keys[1], 'Restart cannot reuse an older creation attempt')
  failCreation = true
  const originalError = console.error
  console.error = () => {}
  try {
    await controller.restartTerminalTab(tabKey)
  } finally {
    console.error = originalError
  }
  controller = render()
  assert.equal(controller.activeTerminalTab?.status, 'error')
  assert.match(controller.activeTerminalTab?.errorMessage ?? '', /Unable to create test shell/)
  failCreation = false
  await controller.restartTerminalTab(tabKey)
  controller = render()
  assert.equal(controller.activeTerminalTab?.brokerSessionId, 'broker-3')
  assert.equal(controller.activeTerminalTab?.status, 'ready')
})

test('input and key shortcuts use broker identity; session loss recovers without replay and ignores stale failures', async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  t.after(() => {
    for (const [name, descriptor] of [['window', originalWindow], ['document', originalDocument]] as const) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor)
      } else {
        Reflect.deleteProperty(globalThis, name)
      }
    }
  })
  const requests: WriteTerminalSessionInput[] = []
  const pending: Array<(error: Error) => void> = []
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    getSelection: () => null,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    tidecodeTerminal: { writeToSession: (input: WriteTerminalSessionInput) => {
      requests.push(input)
      return new Promise<void>((_resolve, reject) => { pending.push(reject) })
    } },
  } })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    body: {}, createElement: () => ({ style: {}, addEventListener() {} }),
  } })
  const terminalTabsRef = { current: [makeTab()] }
  let restarts = 0
  const { createTerminalInstance } = loadHandlers()
  const instance = createTerminalInstance({
    activeTabKey: makeTab().key, tabKey: makeTab().key, hostElement: null, resolvedTheme: 'dark',
    getWorkspaceRootPath: () => '/workspace', terminalTabsRef,
    sendTerminalSize: () => {}, setTerminalTabs: () => {},
    restartTab: () => {
      restarts += 1
      terminalTabsRef.current = [{ ...makeTab(), sessionId: null, brokerSessionId: null, status: 'connecting' }]
    },
  })
  const terminal = instance.terminal as unknown as TestTerminal
  terminal.input('first command\r')
  terminal.keyHandler({ type: 'keydown', key: 'Enter', shiftKey: true } as KeyboardEvent)
  assert.equal(requests.length, 2)
  assert.ok(requests.every((input) => input.brokerSessionId === 'old-broker'))
  pending[0](new Error("Error invoking remote method 'terminal:writeToSession': Error: A terminal session reference is required."))
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(restarts, 1)
  assert.equal(requests.length, 2, 'failed commands are not replayed')
  terminalTabsRef.current = [makeTab('replacement-broker')]
  pending[1](new Error('Unknown terminal broker session id: old-broker'))
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(restarts, 1, 'late failure cannot restart the replacement session')
  assert.equal(terminalTabsRef.current[0].status, 'ready')
})

test('late output and exits cannot affect a replacement with a reused numeric ID or another tab', (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  t.after(() => {
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', originalWindow)
    } else {
      Reflect.deleteProperty(globalThis, 'window')
    }
  })
  let onData: (event: TerminalDataEvent) => void = () => {}
  let onExit: (event: TerminalExitEvent) => void = () => {}
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { tidecodeTerminal: {
    onData: (callback: typeof onData) => { onData = callback; return () => {} },
    onExit: (callback: typeof onExit) => { onExit = callback; return () => {} },
  } } })
  const terminalTabsRef = { current: [makeTab('replacement-broker'), { ...makeTab('other-broker'), key: 'workspace::terminal-tab-2', sessionId: 8 }] }
  const buffers = new Map<string, string>()
  const mapping = new Map([[7, makeTab().key], [8, 'workspace::terminal-tab-2']])
  loadHandlers().useTerminalSessionEvents({
    activeWorkspaceKeyRef: { current: 'workspace' }, terminalTabsRef,
    sessionIdToTabKeyRef: { current: mapping }, tabBuffersRef: { current: buffers },
    tabInstancesRef: { current: new Map() }, terminalWorkspaceStateRef: { current: {} },
    setTerminalTabs: () => {},
  })
  onData({ sessionId: 7, brokerSessionId: 'old-broker', data: 'stale output' })
  onExit({ sessionId: 7, brokerSessionId: 'old-broker', exitCode: 1, signal: null })
  assert.equal(buffers.size, 0)
  assert.equal(mapping.get(7), makeTab().key)
  assert.ok(terminalTabsRef.current.every((tab) => tab.status === 'ready'))
  onData({ sessionId: 7, brokerSessionId: 'replacement-broker', data: 'current output' })
  assert.equal(buffers.get(makeTab().key), 'current output')
  onExit({ sessionId: 7, brokerSessionId: 'replacement-broker', exitCode: 0, signal: null })
  assert.equal(terminalTabsRef.current[0].status, 'exited')
  assert.equal(terminalTabsRef.current[0].sessionId, null)
  assert.equal(terminalTabsRef.current[1].status, 'ready')
})
