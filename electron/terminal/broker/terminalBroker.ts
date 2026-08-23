import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type {
  CreateTerminalSessionInput,
  TerminalBrokerAttachInput,
  TerminalBrokerAttachResult,
  TerminalBrokerCreateSessionInput,
  TerminalBrokerCreateSessionResult,
  TerminalBrokerEvent,
  TerminalBrokerOperationSnapshot,
  TerminalBrokerOperationState,
  TerminalBrokerReadInput,
  TerminalBrokerResizeInput,
  TerminalBrokerSessionReference,
  TerminalBrokerSessionSnapshot,
  TerminalBrokerShellMetadata,
  TerminalBrokerTerminateInput,
  TerminalBrokerWriteInput,
  TerminalCancellationProvenance,
  TerminalDataEvent,
  TerminalExitEvent,
} from '../../../src/types/chat'
import {
  createTerminalSessionForWebContents,
  getTerminalSessionOutputForWebContents,
  resizeTerminalSessionForWebContents,
  terminateSessionForWebContents,
  writeToTerminalSessionForWebContents,
} from '../service'
import type { TerminalProcessTerminationResult } from './processTermination'
import { resolveTerminalShellSpec, type TerminalShellSpec } from '../configuration'
import { TerminalBrokerOutputStore } from './outputStore'
import {
  TerminalBrokerPersistence,
  type PersistedTerminalBrokerState,
} from './persistence'
import {
  isTerminalOperationFinal,
  transitionTerminalOperationState,
  transitionTerminalSessionState,
} from './stateMachine'

const DEFAULT_REAPER_INTERVAL_MS = 2_000
const DEFAULT_RECORD_RETENTION_MS = 5 * 60_000
const DEFAULT_DISCONNECTED_CLIENT_GRACE_MS = 60_000
const TERMINAL_DATA_CHANNEL = 'terminal:session:data'
const TERMINAL_EXIT_CHANNEL = 'terminal:session:exit'
const PERSISTENCE_DEBOUNCE_MS = 250

interface BrokerOperationRecord {
  snapshot: TerminalBrokerOperationSnapshot
}

interface BrokerSessionRecord {
  owner: WebContents
  output: TerminalBrokerOutputStore
  sessionKey: string | null
  snapshot: TerminalBrokerSessionSnapshot
  terminationAttempts: number
}

export interface TerminalBrokerOptions {
  disconnectedClientGraceMs?: number
  now?: () => number
  reaperIntervalMs?: number
  recordRetentionMs?: number
}

function requireNonEmpty(value: string, label: string) {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label} is required.`)
  return normalized
}

function classifyShell(label: string, resolved?: TerminalShellSpec): TerminalBrokerShellMetadata {
  const normalized = label.toLowerCase()
  const kind = normalized.includes('powershell') || normalized.includes('pwsh')
    ? 'powershell'
    : normalized.includes('command prompt') || normalized === 'cmd' || normalized.includes('cmd.exe')
      ? 'command-prompt'
      : normalized.includes('bash') || normalized.includes('zsh') || normalized.includes('sh')
        ? 'posix'
        : 'other'
  return {
    args: resolved ? [...resolved.args] : [],
    command: resolved?.command ?? label,
    kind,
    label,
    resolutionSource: resolved ? 'system' : 'unknown',
    version: null,
  }
}

function cloneSession(snapshot: TerminalBrokerSessionSnapshot): TerminalBrokerSessionSnapshot {
  return {
    ...snapshot,
    attachedClientIds: [...snapshot.attachedClientIds],
    operationIds: [...snapshot.operationIds],
    shell: { ...snapshot.shell, args: [...snapshot.shell.args] },
    termination: snapshot.termination ? { ...snapshot.termination } : null,
  }
}

function cloneOperation(snapshot: TerminalBrokerOperationSnapshot): TerminalBrokerOperationSnapshot {
  return {
    ...snapshot,
    termination: snapshot.termination ? { ...snapshot.termination } : null,
  }
}

export class TerminalBroker {
  private readonly sessions = new Map<string, BrokerSessionRecord>()
  private readonly operations = new Map<string, BrokerOperationRecord>()
  private readonly brokerSessionIdByLegacyId = new Map<number, string>()
  private readonly brokerSessionIdByReuseKey = new Map<string, string>()
  private readonly listeners = new Set<(event: TerminalBrokerEvent) => void>()
  private readonly now: () => number
  private readonly recordRetentionMs: number
  private readonly disconnectedClientGraceMs: number
  private readonly disconnectedClientExpiryById = new Map<string, number>()
  private readonly reaperTimer: NodeJS.Timeout
  private readonly persistence = new TerminalBrokerPersistence()
  private persistenceTimer: NodeJS.Timeout | null = null
  private started = false
  private nextOwnerId = -100_000

  constructor(options: TerminalBrokerOptions = {}) {
    this.now = options.now ?? Date.now
    this.recordRetentionMs = options.recordRetentionMs ?? DEFAULT_RECORD_RETENTION_MS
    this.disconnectedClientGraceMs = options.disconnectedClientGraceMs ?? DEFAULT_DISCONNECTED_CLIENT_GRACE_MS
    this.reaperTimer = setInterval(
      () => this.reap().catch((error) => console.error('Terminal broker reaper failed.', error)),
      options.reaperIntervalMs ?? DEFAULT_REAPER_INTERVAL_MS,
    )
    this.reaperTimer.unref()
  }

  onEvent(listener: (event: TerminalBrokerEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  touchClient(clientId: string) {
    this.disconnectedClientExpiryById.delete(requireNonEmpty(clientId, 'Terminal client id'))
  }

  disconnectClient(clientId: string) {
    const normalizedClientId = requireNonEmpty(clientId, 'Terminal client id')
    this.disconnectedClientExpiryById.set(normalizedClientId, this.now() + this.disconnectedClientGraceMs)
  }

  async start() {
    if (this.started) return
    resolveTerminalShellSpec()
    this.started = true
    const persisted = await this.persistence.load()
    if (!persisted) return
    this.restore(persisted)
  }

  async createSession(input: TerminalBrokerCreateSessionInput): Promise<TerminalBrokerCreateSessionResult> {
    const clientId = requireNonEmpty(input.clientId, 'Terminal client id')
    const workspaceRootPath = requireNonEmpty(
      input.workspaceRootPath ?? input.cwd ?? '',
      'Terminal workspace root path',
    )
    const reuseKey = this.createReuseKey(clientId, workspaceRootPath, input.sessionKey)
    const reusableId = reuseKey ? this.brokerSessionIdByReuseKey.get(reuseKey) : null
    const reusable = reusableId ? this.sessions.get(reusableId) : null
    if (reusable && !['terminated', 'session_lost'].includes(reusable.snapshot.state)) {
      this.attachClient(reusable, clientId)
      return this.buildCreateResult(reusable, true)
    }

    const brokerSessionId = randomUUID()
    const owner = this.createOwner(brokerSessionId)
    const resolvedShell = resolveTerminalShellSpec()
    const serviceInput: CreateTerminalSessionInput = {
      aiTurnId: input.ownerKind === 'ai' ? input.runId ?? null : null,
      cols: input.cols,
      cwd: input.cwd,
      isAiSession: input.ownerKind === 'ai',
      label: input.label,
      rows: input.rows,
      sessionKey: brokerSessionId,
      workspaceRootPath,
    }
    const created = await createTerminalSessionForWebContents(owner, serviceInput)
    const createdAt = this.now()
    const output = new TerminalBrokerOutputStore()
    if (created.bufferedOutput) output.append(brokerSessionId, created.bufferedOutput)
    const cursors = output.cursors
    const snapshot: TerminalBrokerSessionSnapshot = {
      attachedClientIds: [clientId],
      brokerSessionId,
      cols: input.cols,
      conversationId: input.conversationId?.trim() || null,
      createdAt,
      createdByClientId: clientId,
      cwd: created.cwd,
      exitCode: null,
      label: input.label?.trim() || null,
      lastActivityAt: createdAt,
      legacySessionId: created.sessionId,
      operationIds: [],
      ownerKind: input.ownerKind,
      processId: created.processId ?? null,
      rows: input.rows,
      runId: input.runId?.trim() || null,
      shell: created.shellMetadata ?? classifyShell(created.shell, resolvedShell),
      signal: null,
      state: 'ready',
      termination: null,
      transcriptEndCursor: cursors.endCursor,
      transcriptStartCursor: cursors.startCursor,
      workspaceRootPath: created.workspaceRootPath ?? workspaceRootPath,
    }
    const record: BrokerSessionRecord = {
      owner,
      output,
      sessionKey: input.sessionKey?.trim() || null,
      snapshot,
      terminationAttempts: 0,
    }
    this.sessions.set(brokerSessionId, record)
    this.brokerSessionIdByLegacyId.set(created.sessionId, brokerSessionId)
    if (reuseKey) this.brokerSessionIdByReuseKey.set(reuseKey, brokerSessionId)
    this.emitSession(record)
    return this.buildCreateResult(record, false, created.venvName ?? null)
  }

  attach(input: TerminalBrokerAttachInput): TerminalBrokerAttachResult {
    const record = this.resolveSession(input)
    this.attachClient(record, input.clientId)
    return {
      output: record.output.read(record.snapshot.brokerSessionId, input.cursor),
      session: cloneSession(record.snapshot),
    }
  }

  detach(input: TerminalBrokerSessionReference) {
    const record = this.resolveSession(input)
    const clientId = requireNonEmpty(input.clientId, 'Terminal client id')
    record.snapshot.attachedClientIds = record.snapshot.attachedClientIds.filter((id) => id !== clientId)
    record.snapshot.lastActivityAt = this.now()
    this.emitSession(record)
    return cloneSession(record.snapshot)
  }

  listSessions(clientId?: string) {
    const normalizedClientId = clientId?.trim() || null
    return Array.from(this.sessions.values())
      .filter((record) => !normalizedClientId || record.snapshot.attachedClientIds.includes(normalizedClientId))
      .map((record) => cloneSession(record.snapshot))
  }

  getSession(input: TerminalBrokerSessionReference) {
    return cloneSession(this.resolveSession(input).snapshot)
  }

  async read(input: TerminalBrokerReadInput) {
    const record = this.resolveAttachedSession(input)
    if ((input.pollingMs ?? 0) > 0 && !['exited', 'terminated', 'session_lost'].includes(record.snapshot.state)) {
      await getTerminalSessionOutputForWebContents(record.owner, {
        pollingMs: input.pollingMs,
        sessionId: record.snapshot.legacySessionId,
        workspaceRootPath: record.snapshot.workspaceRootPath,
      })
    }
    return {
      output: record.output.read(record.snapshot.brokerSessionId, input.cursor),
      session: cloneSession(record.snapshot),
    }
  }

  async write(input: TerminalBrokerWriteInput) {
    const record = this.resolveAttachedSession(input)
    if (record.snapshot.state === 'exited' || record.snapshot.state === 'terminated') {
      throw new Error(`Terminal session ${record.snapshot.brokerSessionId} has exited.`)
    }
    await writeToTerminalSessionForWebContents(record.owner, {
      data: input.data,
      sessionId: record.snapshot.legacySessionId,
      workspaceRootPath: record.snapshot.workspaceRootPath,
    })
    record.snapshot.lastActivityAt = this.now()
  }

  async resize(input: TerminalBrokerResizeInput) {
    const record = this.resolveAttachedSession(input)
    await resizeTerminalSessionForWebContents(record.owner, {
      cols: input.cols,
      rows: input.rows,
      sessionId: record.snapshot.legacySessionId,
      workspaceRootPath: record.snapshot.workspaceRootPath,
    })
    record.snapshot.cols = input.cols
    record.snapshot.rows = input.rows
    record.snapshot.lastActivityAt = this.now()
    this.emitSession(record)
  }

  createOperation(input: TerminalBrokerSessionReference & {
    command: string
    cwd: string
    runId?: string | null
    toolCallId?: string | null
  }) {
    const record = this.resolveAttachedSession(input)
    const operationId = randomUUID()
    const now = this.now()
    const operation: TerminalBrokerOperationSnapshot = {
      brokerSessionId: record.snapshot.brokerSessionId,
      command: input.command,
      completedAt: null,
      createdAt: now,
      cwd: input.cwd,
      endCursor: null,
      exitCode: null,
      operationId,
      runId: input.runId?.trim() || record.snapshot.runId,
      startCursor: record.output.cursors.endCursor,
      startedAt: null,
      state: 'queued',
      termination: null,
      toolCallId: input.toolCallId?.trim() || null,
    }
    this.operations.set(operationId, { snapshot: operation })
    record.snapshot.operationIds.push(operationId)
    this.emitOperation(operation)
    this.emitSession(record)
    return cloneOperation(operation)
  }

  transitionOperation(
    operationId: string,
    state: TerminalBrokerOperationState,
    update: Partial<Pick<TerminalBrokerOperationSnapshot, 'endCursor' | 'exitCode' | 'termination'>> = {},
  ) {
    const record = this.operations.get(operationId)
    if (!record) throw new Error(`Unknown terminal operation id: ${operationId}`)
    record.snapshot.state = transitionTerminalOperationState(record.snapshot.state, state)
    Object.assign(record.snapshot, update)
    const now = this.now()
    if (state === 'running' && record.snapshot.startedAt === null) record.snapshot.startedAt = now
    if (isTerminalOperationFinal(state)) record.snapshot.completedAt = now
    const session = this.sessions.get(record.snapshot.brokerSessionId)
    if (session) {
      if (state === 'running') session.snapshot.state = transitionTerminalSessionState(session.snapshot.state, 'busy')
      if (state === 'needs_interaction') {
        session.snapshot.state = transitionTerminalSessionState(session.snapshot.state, 'needs_interaction')
      }
      if (isTerminalOperationFinal(state) && ['busy', 'needs_interaction'].includes(session.snapshot.state)) {
        session.snapshot.state = transitionTerminalSessionState(session.snapshot.state, 'ready')
      }
      session.snapshot.lastActivityAt = now
      this.emitSession(session)
    }
    this.emitOperation(record.snapshot)
    return cloneOperation(record.snapshot)
  }

  getOperation(operationId: string) {
    const record = this.operations.get(operationId)
    if (!record) throw new Error(`Unknown terminal operation id: ${operationId}`)
    return cloneOperation(record.snapshot)
  }

  async terminate(input: TerminalBrokerTerminateInput) {
    const record = this.resolveSession(input)
    if (!record.snapshot.attachedClientIds.includes(input.clientId)) {
      throw new Error('Terminal client is not attached to this session.')
    }
    return this.terminateRecord(record, input.provenance)
  }

  async applyRunCancellation(runId: string, provenance: TerminalCancellationProvenance) {
    const normalizedRunId = requireNonEmpty(runId, 'Run id')
    const matching = Array.from(this.sessions.values()).filter((record) => record.snapshot.runId === normalizedRunId)
    if (provenance.policy === 'detach') {
      for (const record of matching) {
        record.snapshot.attachedClientIds = []
        record.snapshot.termination = { ...provenance }
        this.emitSession(record)
      }
      return matching.map((record) => cloneSession(record.snapshot))
    }
    return Promise.all(matching.map((record) => this.terminateRecord(record, provenance)))
  }

  async shutdown() {
    clearInterval(this.reaperTimer)
    const provenance: TerminalCancellationProvenance = {
      policy: 'terminate',
      reason: 'service_shutdown',
      requestedAt: this.now(),
      surface: 'system',
    }
    await Promise.allSettled(Array.from(this.sessions.values()).map((record) => this.terminateRecord(record, provenance)))
    await this.persistNow()
    await this.persistence.flush()
  }

  private async terminateRecord(record: BrokerSessionRecord, provenance: TerminalCancellationProvenance) {
    if (record.snapshot.state === 'terminated' || record.snapshot.state === 'session_lost') {
      return cloneSession(record.snapshot)
    }
    if (record.snapshot.state === 'exited') {
      terminateSessionForWebContents(
        record.owner,
        record.snapshot.legacySessionId,
        record.snapshot.workspaceRootPath,
      )
      record.snapshot.state = transitionTerminalSessionState(record.snapshot.state, 'terminated')
      record.snapshot.termination = { ...provenance }
      record.snapshot.lastActivityAt = this.now()
      this.emitSession(record)
      return cloneSession(record.snapshot)
    }
    if (record.snapshot.state !== 'terminating') {
      record.snapshot.state = transitionTerminalSessionState(record.snapshot.state, 'terminating')
    }
    record.snapshot.termination = { ...provenance }
    record.snapshot.lastActivityAt = this.now()
    record.terminationAttempts += 1
    const terminatingOperations = record.snapshot.operationIds
      .map((operationId) => this.operations.get(operationId))
      .filter((operation): operation is BrokerOperationRecord => Boolean(
        operation && !isTerminalOperationFinal(operation.snapshot.state),
      ))
    for (const operation of terminatingOperations) {
      if (!['cancel_requested', 'terminating', 'termination_failed'].includes(operation.snapshot.state)) {
        operation.snapshot.state = transitionTerminalOperationState(
          operation.snapshot.state,
          'cancel_requested',
        )
      }
      if (operation.snapshot.state !== 'terminating') {
        operation.snapshot.state = transitionTerminalOperationState(operation.snapshot.state, 'terminating')
      }
      operation.snapshot.termination = { ...provenance }
      this.emitOperation(operation.snapshot)
    }
    this.emitSession(record)

    const result = terminateSessionForWebContents(
      record.owner,
      record.snapshot.legacySessionId,
      record.snapshot.workspaceRootPath,
    ) as TerminalProcessTerminationResult | undefined
    if (result?.terminated) {
      record.snapshot.state = transitionTerminalSessionState(record.snapshot.state, 'terminated')
      record.snapshot.exitCode ??= -1
      record.snapshot.lastActivityAt = this.now()
      for (const operation of terminatingOperations) {
        operation.snapshot.state = transitionTerminalOperationState(operation.snapshot.state, 'terminated')
        operation.snapshot.completedAt = this.now()
        operation.snapshot.endCursor = record.output.cursors.endCursor
        this.emitOperation(operation.snapshot)
      }
      this.emitSession(record)
      return cloneSession(record.snapshot)
    }

    record.snapshot.state = transitionTerminalSessionState(record.snapshot.state, 'orphaned')
    for (const operation of terminatingOperations) {
      operation.snapshot.state = transitionTerminalOperationState(operation.snapshot.state, 'termination_failed')
      this.emitOperation(operation.snapshot)
    }
    const error = result?.attempts.map((attempt) => attempt.error).filter(Boolean).join(' ') || 'Process exit could not be verified.'
    this.emit({
      clientIds: [...record.snapshot.attachedClientIds],
      error,
      session: cloneSession(record.snapshot),
      type: 'terminal_cleanup_failed',
    })
    return cloneSession(record.snapshot)
  }

  private async reap() {
    const now = this.now()
    for (const [clientId, expiresAt] of this.disconnectedClientExpiryById) {
      if (expiresAt > now) continue
      this.disconnectedClientExpiryById.delete(clientId)
      for (const record of this.sessions.values()) {
        if (!record.snapshot.attachedClientIds.includes(clientId)) continue
        record.snapshot.attachedClientIds = record.snapshot.attachedClientIds.filter((id) => id !== clientId)
        record.snapshot.lastActivityAt = now
        this.emitSession(record)
        if (
          record.snapshot.ownerKind !== 'ai'
          && record.snapshot.attachedClientIds.length === 0
          && !['exited', 'terminated', 'session_lost'].includes(record.snapshot.state)
        ) {
          await this.terminateRecord(record, {
            policy: 'terminate',
            reason: 'surface_shutdown',
            requestedAt: now,
            surface: 'system',
          })
        }
      }
    }
    for (const record of this.sessions.values()) {
      if (record.snapshot.state === 'orphaned' || record.snapshot.state === 'termination_failed') {
        const provenance = record.snapshot.termination ?? {
          policy: 'terminate' as const,
          reason: 'unknown' as const,
          requestedAt: now,
          surface: 'system' as const,
        }
        await this.terminateRecord(record, provenance)
        continue
      }

      if (
        ['terminated', 'session_lost'].includes(record.snapshot.state)
        && now - record.snapshot.lastActivityAt >= this.recordRetentionMs
      ) {
        this.releaseRecord(record)
      }
    }
  }

  private releaseRecord(record: BrokerSessionRecord) {
    const { brokerSessionId, legacySessionId, workspaceRootPath, createdByClientId } = record.snapshot
    this.sessions.delete(brokerSessionId)
    this.brokerSessionIdByLegacyId.delete(legacySessionId)
    const reuseKey = this.createReuseKey(createdByClientId, workspaceRootPath, record.sessionKey)
    if (reuseKey && this.brokerSessionIdByReuseKey.get(reuseKey) === brokerSessionId) {
      this.brokerSessionIdByReuseKey.delete(reuseKey)
    }
    for (const operationId of record.snapshot.operationIds) this.operations.delete(operationId)
    this.schedulePersistence()
  }

  private resolveAttachedSession(input: TerminalBrokerSessionReference) {
    const record = this.resolveSession(input)
    const clientId = requireNonEmpty(input.clientId, 'Terminal client id')
    if (!record.snapshot.attachedClientIds.includes(clientId)) {
      throw new Error('Terminal client is not attached to this session.')
    }
    return record
  }

  private resolveSession(input: TerminalBrokerSessionReference) {
    const brokerSessionId = input.brokerSessionId?.trim()
      || (typeof input.legacySessionId === 'number'
        ? this.brokerSessionIdByLegacyId.get(input.legacySessionId)
        : null)
    if (!brokerSessionId) throw new Error('A terminal session reference is required.')
    const record = this.sessions.get(brokerSessionId)
    if (!record) throw new Error(`Unknown terminal broker session id: ${brokerSessionId}`)
    if (
      input.workspaceRootPath?.trim()
      && record.snapshot.workspaceRootPath.toLowerCase() !== input.workspaceRootPath.trim().toLowerCase()
    ) {
      throw new Error('Terminal session does not belong to the requested workspace.')
    }
    return record
  }

  private attachClient(record: BrokerSessionRecord, clientId: string) {
    const normalizedClientId = requireNonEmpty(clientId, 'Terminal client id')
    this.touchClient(normalizedClientId)
    if (!record.snapshot.attachedClientIds.includes(normalizedClientId)) {
      record.snapshot.attachedClientIds.push(normalizedClientId)
      record.snapshot.lastActivityAt = this.now()
      this.emitSession(record)
    }
  }

  private createOwner(brokerSessionId: string) {
    const owner = {
      id: this.nextOwnerId--,
      isDestroyed: () => false,
      once: () => owner,
      send: (channel: string, payload: unknown) => {
        if (channel === TERMINAL_DATA_CHANNEL) {
          this.handleTerminalData(brokerSessionId, payload as TerminalDataEvent)
        } else if (channel === TERMINAL_EXIT_CHANNEL) {
          this.handleTerminalExit(brokerSessionId, payload as TerminalExitEvent)
        }
      },
    } as unknown as WebContents
    return owner
  }

  private handleTerminalData(brokerSessionId: string, event: TerminalDataEvent) {
    const record = this.sessions.get(brokerSessionId)
    if (!record) return
    const output = record.output.append(brokerSessionId, event.data)
    const cursors = record.output.cursors
    record.snapshot.transcriptStartCursor = cursors.startCursor
    record.snapshot.transcriptEndCursor = cursors.endCursor
    record.snapshot.lastActivityAt = this.now()
    this.emit({
      clientIds: [...record.snapshot.attachedClientIds],
      legacySessionId: record.snapshot.legacySessionId,
      output,
      type: 'terminal_output',
    })
    this.schedulePersistence()
  }

  private handleTerminalExit(brokerSessionId: string, event: TerminalExitEvent) {
    const record = this.sessions.get(brokerSessionId)
    if (!record) return
    record.snapshot.exitCode = event.exitCode
    record.snapshot.signal = event.signal
    record.snapshot.lastActivityAt = this.now()
    if (!['terminated', 'session_lost'].includes(record.snapshot.state)) {
      record.snapshot.state = ['terminating', 'termination_failed', 'orphaned'].includes(record.snapshot.state)
        ? transitionTerminalSessionState(record.snapshot.state, 'terminated')
        : transitionTerminalSessionState(record.snapshot.state, 'exited')
    }
    if (!record.snapshot.termination) {
      for (const operationId of record.snapshot.operationIds) {
        const operation = this.operations.get(operationId)
        if (!operation || isTerminalOperationFinal(operation.snapshot.state)) continue
        operation.snapshot.state = 'session_lost'
        operation.snapshot.completedAt = this.now()
        operation.snapshot.endCursor = record.output.cursors.endCursor
        this.emitOperation(operation.snapshot)
      }
    }
    this.emitSession(record)
  }

  private buildCreateResult(record: BrokerSessionRecord, isReused: boolean, venvName: string | null = null) {
    return {
      bufferedOutput: record.output.retainedData,
      brokerSessionId: record.snapshot.brokerSessionId,
      cwd: record.snapshot.cwd,
      isReused,
      legacySessionId: record.snapshot.legacySessionId,
      shell: { ...record.snapshot.shell, args: [...record.snapshot.shell.args] },
      snapshot: cloneSession(record.snapshot),
      venvName,
      workspaceRootPath: record.snapshot.workspaceRootPath,
    }
  }

  private createReuseKey(clientId: string, workspaceRootPath: string, sessionKey?: string | null) {
    const normalizedSessionKey = sessionKey?.trim()
    if (!normalizedSessionKey) return null
    return `${clientId.trim()}::${workspaceRootPath.trim().toLowerCase()}::${normalizedSessionKey}`
  }

  private emitSession(record: BrokerSessionRecord) {
    this.emit({
      clientIds: [...record.snapshot.attachedClientIds],
      session: cloneSession(record.snapshot),
      type: 'terminal_session_changed',
    })
    this.schedulePersistence()
  }

  private emitOperation(operation: TerminalBrokerOperationSnapshot) {
    const session = this.sessions.get(operation.brokerSessionId)
    this.emit({
      clientIds: session ? [...session.snapshot.attachedClientIds] : [],
      operation: cloneOperation(operation),
      type: 'terminal_operation_changed',
    })
    this.schedulePersistence()
  }

  private emit(event: TerminalBrokerEvent) {
    for (const listener of this.listeners) listener(event)
  }

  private schedulePersistence() {
    if (!this.started || this.persistenceTimer) return
    this.persistenceTimer = setTimeout(() => {
      this.persistenceTimer = null
      void this.persistNow().catch((error) => console.error('Unable to persist terminal broker state.', error))
    }, PERSISTENCE_DEBOUNCE_MS)
    this.persistenceTimer.unref()
  }

  private persistNow() {
    if (this.persistenceTimer) {
      clearTimeout(this.persistenceTimer)
      this.persistenceTimer = null
    }
    return this.persistence.save({
      operations: Array.from(this.operations.values()).map((record) => cloneOperation(record.snapshot)),
      sessions: Array.from(this.sessions.values()).map((record) => ({
        output: {
          data: record.output.retainedData,
          ...record.output.cursors,
        },
        sessionKey: record.sessionKey,
        snapshot: cloneSession(record.snapshot),
      })),
    })
  }

  private restore(persisted: PersistedTerminalBrokerState) {
    for (const persistedSession of persisted.sessions) {
      const snapshot = cloneSession(persistedSession.snapshot)
      if (!['terminated', 'session_lost'].includes(snapshot.state)) {
        snapshot.state = 'session_lost'
        snapshot.lastActivityAt = this.now()
      }
      snapshot.attachedClientIds = []
      const output = new TerminalBrokerOutputStore()
      output.restore(persistedSession.output)
      snapshot.transcriptStartCursor = output.cursors.startCursor
      snapshot.transcriptEndCursor = output.cursors.endCursor
      this.sessions.set(snapshot.brokerSessionId, {
        owner: this.createOwner(snapshot.brokerSessionId),
        output,
        sessionKey: persistedSession.sessionKey,
        snapshot,
        terminationAttempts: 0,
      })
    }
    for (const persistedOperation of persisted.operations) {
      const snapshot = cloneOperation(persistedOperation)
      if (!isTerminalOperationFinal(snapshot.state)) {
        snapshot.state = 'session_lost'
        snapshot.completedAt = this.now()
      }
      if (this.sessions.has(snapshot.brokerSessionId)) {
        this.operations.set(snapshot.operationId, { snapshot })
      }
    }
  }
}
