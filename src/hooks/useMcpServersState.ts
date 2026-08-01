import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { McpAddServerInput, McpState } from '../types/mcp'

interface UseMcpServersStateResult {
  activeOperation: string | null
  addServer: (input: McpAddServerInput) => Promise<boolean>
  connectServer: (serverId: string) => Promise<boolean>
  disconnectServer: (serverId: string) => Promise<boolean>
  errorMessage: string | null
  isLoading: boolean
  removeServer: (serverId: string) => Promise<boolean>
  refreshServer: (serverId: string) => Promise<boolean>
  state: McpState | null
  updateServer: (serverId: string, input: McpAddServerInput) => Promise<boolean>
  toggleTool: (serverId: string, toolName: string, enabled: boolean) => Promise<boolean>
}

function normalizeWorkspacePath(workspacePath?: string | null) {
  const trimmed = workspacePath?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function getMcpApi() {
  return typeof window !== 'undefined' ? window.tidecodeMcp : null
}

function getErrorMessage(error: unknown, fallbackMessage: string) {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallbackMessage
}

export function useMcpServersState(workspacePath?: string | null): UseMcpServersStateResult {
  const normalizedWorkspacePath = useMemo(() => normalizeWorkspacePath(workspacePath), [workspacePath])
  const [state, setState] = useState<McpState | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [activeOperation, setActiveOperation] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const workspacePathRef = useRef<string | null>(normalizedWorkspacePath)

  useEffect(() => {
    workspacePathRef.current = normalizedWorkspacePath
  }, [normalizedWorkspacePath])

  useEffect(() => {
    const api = getMcpApi()
    if (!api) {
      setState(null)
      setIsLoading(false)
      setErrorMessage('MCP is unavailable in this renderer.')
      return
    }

    let isActive = true
    setIsLoading(true)
    setErrorMessage(null)
    setState(null)

    void api
      .getState(normalizedWorkspacePath)
      .then((nextState) => {
        if (!isActive) {
          return
        }

        setState(nextState)
        setErrorMessage(nextState.errorMessage ?? null)
      })
      .catch((error) => {
        if (!isActive) {
          return
        }

        setErrorMessage(getErrorMessage(error, 'Unable to load MCP servers.'))
      })
      .finally(() => {
        if (isActive) {
          setIsLoading(false)
        }
      })

    return () => {
      isActive = false
    }
  }, [normalizedWorkspacePath])

  useEffect(() => {
    const api = getMcpApi()
    if (!api) {
      return
    }

    return api.onStateChange((payload) => {
      if (payload.workspacePath !== workspacePathRef.current) {
        return
      }

      setState(payload.state)
      setErrorMessage(payload.state.errorMessage)
      setIsLoading(false)
    })
  }, [])

  const runOperation = useCallback(
    async (operationName: string, runner: () => Promise<McpState>) => {
      const api = getMcpApi()
      if (!api) {
        setErrorMessage('MCP is unavailable in this renderer.')
        return false
      }

      setActiveOperation(operationName)
      setErrorMessage(null)

      try {
        const nextState = await runner()
        setState(nextState)
        setErrorMessage(nextState.errorMessage ?? null)
        return true
      } catch (error) {
        setErrorMessage(getErrorMessage(error, 'Unable to update MCP servers.'))
        return false
      } finally {
        setActiveOperation((currentOperation) => (currentOperation === operationName ? null : currentOperation))
      }
    },
    [],
  )

  const connectServer = useCallback(
    async (serverId: string) =>
      runOperation(`connect:${serverId}`, async () => {
        const api = getMcpApi()
        if (!api) {
          throw new Error('MCP is unavailable in this renderer.')
        }

        return api.connectServer(serverId, normalizedWorkspacePath)
      }),
    [normalizedWorkspacePath, runOperation],
  )

  const disconnectServer = useCallback(
    async (serverId: string) =>
      runOperation(`disconnect:${serverId}`, async () => {
        const api = getMcpApi()
        if (!api) {
          throw new Error('MCP is unavailable in this renderer.')
        }

        return api.disconnectServer(serverId, normalizedWorkspacePath)
      }),
    [normalizedWorkspacePath, runOperation],
  )

  const removeServer = useCallback(
    async (serverId: string) =>
      runOperation(`remove:${serverId}`, async () => {
        const api = getMcpApi()
        if (!api) {
          throw new Error('MCP is unavailable in this renderer.')
        }

        return api.removeServer(serverId, normalizedWorkspacePath)
      }),
    [normalizedWorkspacePath, runOperation],
  )

  const refreshServer = useCallback(
    async (serverId: string) =>
      runOperation(`refresh:${serverId}`, async () => {
        const api = getMcpApi()
        if (!api) {
          throw new Error('MCP is unavailable in this renderer.')
        }

        return api.refreshServer(serverId, normalizedWorkspacePath)
      }),
    [normalizedWorkspacePath, runOperation],
  )

  const toggleTool = useCallback(
    async (serverId: string, toolName: string, enabled: boolean) =>
      runOperation(`toggle:${serverId}:${toolName}`, async () => {
        const api = getMcpApi()
        if (!api) {
          throw new Error('MCP is unavailable in this renderer.')
        }

        return api.toggleTool(serverId, toolName, enabled, normalizedWorkspacePath)
      }),
    [normalizedWorkspacePath, runOperation],
  )

  const addServer = useCallback(
    async (input: McpAddServerInput) =>
      runOperation(`add:${input.serverName}`, async () => {
        const api = getMcpApi()
        if (!api) {
          throw new Error('MCP is unavailable in this renderer.')
        }

        return api.addServer(input, normalizedWorkspacePath)
      }),
    [normalizedWorkspacePath, runOperation],
  )

  const updateServer = useCallback(
    async (serverId: string, input: McpAddServerInput) =>
      runOperation(`update:${serverId}`, async () => {
        const api = getMcpApi()
        if (!api) {
          throw new Error('MCP is unavailable in this renderer.')
        }

        return api.updateServer(serverId, input, normalizedWorkspacePath)
      }),
    [normalizedWorkspacePath, runOperation],
  )

  return {
    activeOperation,
    addServer,
    connectServer,
    disconnectServer,
    errorMessage,
    isLoading,
    removeServer,
    refreshServer,
    state,
    updateServer,
    toggleTool,
  }
}
