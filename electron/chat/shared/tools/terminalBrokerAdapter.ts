import type { WebContents } from 'electron'
import type {
  CreateTerminalSessionInput,
  ResizeTerminalSessionInput,
  TerminalBrokerOperationState,
  TerminalSessionOutputInput,
  WriteTerminalSessionInput,
} from '../../../../src/types/chat'
import { getTerminalBroker } from '../../../terminal/broker/instance'
import type { TerminalSessionSnapshot } from '../../../terminal/service'
import type { AgentToolContext } from '../toolTypes'
import type { TerminalToolDependencies } from './terminalToolShared'

interface AdapterCursorState {
  acknowledgedCursor: number
  brokerSessionId: string
  pendingEndCursor: number
  pendingOutput: string
}

function createClientId(context: AgentToolContext) {
  const runId = context.turnId?.trim()
  if (runId) return `ai:${runId}`
  const conversationId = context.conversationId?.trim()
  if (conversationId) return `ai-conversation:${conversationId}`
  return `ai-workspace:${context.workspaceRootPath}`
}

export function createTerminalBrokerToolDependencies(context: AgentToolContext): TerminalToolDependencies {
  const broker = getTerminalBroker()
  const clientId = createClientId(context)
  const cursorByLegacySessionId = new Map<number, AdapterCursorState>()

  const createSession = async (_owner: WebContents, input: CreateTerminalSessionInput) => {
    const created = await broker.createSession({
      clientId,
      cols: input.cols,
      conversationId: context.conversationId,
      cwd: input.cwd,
      label: input.label,
      ownerKind: 'ai',
      rows: input.rows,
      runId: context.turnId,
      sessionKey: input.sessionKey,
      workspaceRootPath: input.workspaceRootPath ?? context.workspaceRootPath,
    })
    cursorByLegacySessionId.set(created.legacySessionId, {
      acknowledgedCursor: created.snapshot.transcriptEndCursor,
      brokerSessionId: created.brokerSessionId,
      pendingEndCursor: created.snapshot.transcriptEndCursor,
      pendingOutput: '',
    })
    return {
      bufferedOutput: created.bufferedOutput,
      brokerSessionId: created.brokerSessionId,
      cwd: created.cwd,
      isReused: created.isReused,
      processId: created.snapshot.processId,
      sessionId: created.legacySessionId,
      shell: created.shell.label,
      shellMetadata: created.shell,
      venvName: created.venvName,
      workspaceRootPath: created.workspaceRootPath,
    }
  }

  const getSessionOutput = async (_owner: WebContents, input: TerminalSessionOutputInput): Promise<TerminalSessionSnapshot> => {
    const cursor = cursorByLegacySessionId.get(input.sessionId)
    if (!cursor) throw new Error(`Unknown broker-backed terminal session id: ${input.sessionId}`)
    const result = await broker.read({
      brokerSessionId: cursor.brokerSessionId,
      clientId,
      cursor: cursor.acknowledgedCursor,
      pollingMs: input.pollingMs,
      workspaceRootPath: input.workspaceRootPath,
    })
    cursor.pendingOutput = result.output.data
    cursor.pendingEndCursor = result.output.endCursor
    return {
      cwd: result.session.cwd,
      exitCode: result.session.exitCode,
      hasExited: ['exited', 'terminated', 'session_lost'].includes(result.session.state),
      label: result.session.label,
      outputBuffer: result.output.data,
      pendingOutputBuffer: result.output.data,
      sessionId: result.session.legacySessionId,
      shellLabel: result.session.shell.label,
      signal: result.session.signal,
    }
  }

  const consumeSessionOutput = (_owner: WebContents, input: TerminalSessionOutputInput) => {
    const cursor = cursorByLegacySessionId.get(input.sessionId)
    if (!cursor || !cursor.pendingOutput) return
    const consumeLength = input.pendingOutputLengthToConsume === undefined
      ? cursor.pendingOutput.length
      : Math.max(0, Math.min(cursor.pendingOutput.length, Math.floor(input.pendingOutputLengthToConsume)))
    cursor.acknowledgedCursor += consumeLength
    cursor.pendingOutput = cursor.pendingOutput.slice(consumeLength)
    if (!cursor.pendingOutput) cursor.acknowledgedCursor = cursor.pendingEndCursor
  }

  return {
    consumeSessionOutput,
    createOperation: async (_owner, input) => broker.createOperation({
      brokerSessionId: cursorByLegacySessionId.get(input.sessionId)?.brokerSessionId,
      clientId,
      command: input.command,
      cwd: input.cwd,
      legacySessionId: input.sessionId,
      runId: context.turnId,
      toolCallId: input.toolCallId,
      workspaceRootPath: context.workspaceRootPath,
    }),
    createSession,
    getSessionOutput,
    resizeSession: async (_owner: WebContents, input: ResizeTerminalSessionInput) => {
      const cursor = cursorByLegacySessionId.get(input.sessionId)
      await broker.resize({
        brokerSessionId: cursor?.brokerSessionId,
        clientId,
        cols: input.cols,
        legacySessionId: input.sessionId,
        rows: input.rows,
        workspaceRootPath: input.workspaceRootPath,
      })
    },
    terminateSession: (_owner, sessionId, workspaceRootPath) => {
      const cursor = cursorByLegacySessionId.get(sessionId)
      void broker.terminate({
        brokerSessionId: cursor?.brokerSessionId,
        clientId,
        legacySessionId: sessionId,
        provenance: {
          policy: 'terminate',
          reason: 'user_stop',
          requestedAt: Date.now(),
          runId: context.turnId,
          surface: 'ai',
        },
        workspaceRootPath,
      })
    },
    terminateSessionsForTurn: (_owner, turnId) => {
      void broker.applyRunCancellation(turnId, {
        policy: 'terminate',
        reason: 'unknown',
        requestedAt: Date.now(),
        runId: turnId,
        surface: 'system',
      })
    },
    transitionOperation: async (operationId, state: TerminalBrokerOperationState, update) =>
      broker.transitionOperation(operationId, state, update),
    writeToSession: async (_owner: WebContents, input: WriteTerminalSessionInput) => {
      const cursor = cursorByLegacySessionId.get(input.sessionId)
      await broker.write({
        brokerSessionId: cursor?.brokerSessionId,
        clientId,
        data: input.data,
        legacySessionId: input.sessionId,
        workspaceRootPath: input.workspaceRootPath,
      })
    },
  }
}
