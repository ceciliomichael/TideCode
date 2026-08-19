import {
  REMOTE_EVENT_CHANNELS,
  isRemoteRpcNamespace,
  type RemoteBridgeRequest,
  type TideCodeRemoteHostBridgeApi,
} from './protocol'

let installed = false

declare global {
  interface Window {
    __tidecodeRemoteDispatch?: (request: RemoteBridgeRequest) => Promise<unknown>
  }
}

function getRemoteHostBridge() {
  return (window as Window & { tidecodeRemoteHost?: TideCodeRemoteHostBridgeApi }).tidecodeRemoteHost
}

function getRemoteNamespace(namespace: string): Record<string, unknown> | null {
  if (!isRemoteRpcNamespace(namespace)) return null
  const value = (window as unknown as Record<string, unknown>)[namespace]
  if (!value || typeof value !== 'object') return null
  return value as Record<string, unknown>
}

async function dispatchRemoteRequest(request: RemoteBridgeRequest) {
  if (request.method.startsWith('on')) {
    throw new Error('Event subscription methods are transported as remote events.')
  }

  const namespace = getRemoteNamespace(request.namespace)
  if (!namespace) throw new Error(`Remote namespace is unavailable: ${request.namespace}`)
  if (!Object.prototype.hasOwnProperty.call(namespace, request.method)) {
    throw new Error(`Remote method is unavailable: ${request.namespace}.${request.method}`)
  }
  const method = namespace[request.method]
  if (typeof method !== 'function') {
    throw new Error(`Remote method is unavailable: ${request.namespace}.${request.method}`)
  }
  return Reflect.apply(method, namespace, request.args)
}

export function installDesktopRemoteBridge() {
  if (installed) return
  const bridge = getRemoteHostBridge()
  if (!bridge) return
  installed = true
  window.__tidecodeRemoteDispatch = dispatchRemoteRequest

  const emit = (channel: Parameters<typeof bridge.emitEvent>[0]['channel'], payload: unknown) => {
    bridge.emitEvent({ channel, payload })
  }

  window.tidecodeApp.onLaunchRequest((payload) => emit(REMOTE_EVENT_CHANNELS.appLaunchRequest, payload))
  window.tidecodeChat.onStreamEvent((payload) => emit(REMOTE_EVENT_CHANNELS.chatStream, payload))
  window.tidecodeGit.onSourceControlChange((payload) => emit(REMOTE_EVENT_CHANNELS.gitSourceControl, payload))
  window.tidecodeHistory.onProjectFolderPruned((payload) => emit(REMOTE_EVENT_CHANNELS.historyProjectFolderPruned, payload))
  window.tidecodeKanban.onBoardChange((payload) => emit(REMOTE_EVENT_CHANNELS.kanbanChanged, payload))
  window.tidecodeMcp.onStateChange((payload) => emit(REMOTE_EVENT_CHANNELS.mcpState, payload))
  window.tidecodeProviders.onStateChange(() => emit(REMOTE_EVENT_CHANNELS.providersState, null))
  window.tidecodeRuns.onEvent((payload) => emit(REMOTE_EVENT_CHANNELS.runsEvent, payload))
  window.tidecodeTerminal.onData((payload) => emit(REMOTE_EVENT_CHANNELS.terminalData, payload))
  window.tidecodeTerminal.onExit((payload) => emit(REMOTE_EVENT_CHANNELS.terminalExit, payload))
  window.tidecodeUpdates.onUpdateState((payload) => emit(REMOTE_EVENT_CHANNELS.updatesState, payload))
  window.tidecodeWorkspace.onExplorerChange((payload) => emit(REMOTE_EVENT_CHANNELS.workspaceExplorer, payload))
}
