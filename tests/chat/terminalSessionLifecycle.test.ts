import { createTerminalTabKey, getWorkspaceKeyFromTerminalTabKey, isCurrentTerminalTabGeneration, isTerminalTransportDisconnected, nextTerminalTabGeneration } from '../../src/components/chat/workspaceTerminalPanel/workspaceTerminalPanelUtils'
import assert from 'node:assert/strict'
import test from 'node:test'
import { startTerminalSession } from '../../src/components/chat/workspaceTerminalPanel/terminalSessionLifecycle'
import type { TerminalTabState } from '../../src/components/chat/workspaceTerminalPanel/workspaceTerminalPanelTypes'
import type { CloseTerminalSessionInput, CreateTerminalSessionResult } from '../../src/types/chat'

const tab: TerminalTabState = {
  brokerSessionId: 'old-broker', sessionId: 7, key: 'project::terminal-tab-1', label: 'Terminal',
  status: 'error', errorMessage: 'Session lost', exitCode: null, workspaceRootPath: '/workspace',
}
const session: CreateTerminalSessionResult = {
  brokerSessionId: 'new-broker', sessionId: 8, bufferedOutput: 'ready', cwd: '/workspace',
  isReused: false, shell: 'test', workspaceRootPath: '/workspace',
}

test('restart creates a fresh session after the old broker reference disappears', async () => {
  const calls: string[] = []
  let ready: CreateTerminalSessionResult | undefined
  await startTerminalSession({
    tab,
    sessionKey: 'replacement-attempt',
    api: {
      closeSession: async (input) => {
        assert.equal(input.brokerSessionId, 'old-broker')
        calls.push('close')
        throw new Error('Unknown terminal broker session id: old-broker')
      },
      createSession: async (input) => {
        calls.push('create')
        assert.equal(input.sessionKey, 'replacement-attempt')
        assert.equal(input.workspaceRootPath, tab.workspaceRootPath)
        return session
      },
    },
    isCurrent: () => true,
    prepareTerminal: () => {
      calls.push('prepare')
      return { cols: 80, rows: 24 }
    },
    onReady: (result) => { ready = result },
    onError: (error) => { assert.fail(String(error)) },
  })
  assert.equal(ready, session)
  assert.deepEqual(calls, ['close', 'prepare', 'create'])
})

test('local terminal setup and service creation failures both leave a recoverable error', async () => {
  for (const failure of ['prepare', 'create'] as const) {
    const expected = new Error(`${failure} failed`)
    let received: unknown
    await startTerminalSession({
      tab: { ...tab, sessionId: null, brokerSessionId: null },
      sessionKey: 'replacement-attempt',
      api: {
        closeSession: async () => {},
        createSession: async () => { throw expected },
      },
      isCurrent: () => true,
      prepareTerminal: () => {
        if (failure === 'prepare') {
          throw expected
        }
        return { cols: 80, rows: 24 }
      },
      onReady: () => { assert.fail('failed sessions cannot become ready') },
      onError: (error) => { received = error },
    })
    assert.equal(received, expected)
  }
})

test('a stale creation completion closes its own broker session without replacing the current tab', async () => {
  let current = true
  const closed: CloseTerminalSessionInput[] = []
  await startTerminalSession({
    tab: { ...tab, sessionId: null, brokerSessionId: null },
    sessionKey: 'replacement-attempt',
    api: {
      closeSession: async (input) => { closed.push(input) },
      createSession: async () => {
        current = false
        return session
      },
    },
    isCurrent: () => current,
    prepareTerminal: () => ({ cols: 80, rows: 24 }),
    onReady: () => { assert.fail('stale result must not update the tab') },
    onError: () => { assert.fail('stale errors must not update the tab') },
  })
  assert.deepEqual(closed, [{ brokerSessionId: 'new-broker', sessionId: 8, workspaceRootPath: '/workspace' }])
})

test('workspace ownership errors stop restart instead of silently bypassing the failed close', async () => {
  let error: unknown
  await startTerminalSession({
    tab,
    sessionKey: 'replacement-attempt',
    api: {
      closeSession: async () => { throw new Error('Terminal session does not belong to the requested workspace.') },
      createSession: async () => { assert.fail('must not bypass workspace validation') },
    },
    isCurrent: () => true,
    prepareTerminal: () => { assert.fail('must not prepare a replacement') },
    onReady: () => { assert.fail('must not become ready') },
    onError: (received) => { error = received },
  })
  assert.match(String(error), /does not belong/)
})

test("stale terminal creation and restart responses are rejected by generation", () => {
  const generations = new Map<string, number>();
  const tab = createTerminalTabKey("project A", 1);
  const first = nextTerminalTabGeneration(generations, tab);
  assert.equal(isCurrentTerminalTabGeneration(generations, tab, first), true);

  const restarted = nextTerminalTabGeneration(generations, tab);
  assert.equal(isCurrentTerminalTabGeneration(generations, tab, first), false);
  assert.equal(isCurrentTerminalTabGeneration(generations, tab, restarted), true);

  nextTerminalTabGeneration(generations, tab); // Closing the tab invalidates pending work.
  assert.equal(isCurrentTerminalTabGeneration(generations, tab, restarted), false);
});

test("run-service pipe failures are distinguished from terminal command errors", () => {
  assert.equal(isTerminalTransportDisconnected(
    "Error invoking remote method: connect ENOENT \\\\.\\pipe\\tidecode-run-service-v14",
  ), true);
  assert.equal(isTerminalTransportDisconnected("Tidecode run service disconnected."), true);
  assert.equal(isTerminalTransportDisconnected("write EPIPE"), true);
  assert.equal(isTerminalTransportDisconnected("Unknown terminal session id"), false);
});

test("terminal generations are independent across tabs and workspace keys are decoded", () => {
  const generations = new Map<string, number>();
  const firstTab = createTerminalTabKey("C:\\repo A", 1);
  const secondTab = createTerminalTabKey("C:\\repo B", 1);
  const firstGeneration = nextTerminalTabGeneration(generations, firstTab);
  nextTerminalTabGeneration(generations, secondTab);
  nextTerminalTabGeneration(generations, secondTab);

  assert.equal(isCurrentTerminalTabGeneration(generations, firstTab, firstGeneration), true);
  assert.equal(getWorkspaceKeyFromTerminalTabKey(firstTab), "C:\\repo A");
  assert.equal(getWorkspaceKeyFromTerminalTabKey(secondTab), "C:\\repo B");
});
