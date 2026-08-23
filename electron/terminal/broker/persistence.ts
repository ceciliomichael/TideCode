import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  TerminalBrokerOperationSnapshot,
  TerminalBrokerSessionSnapshot,
} from '../../../src/types/chat'
import { ensureRunServiceDirectory, getRunServiceDirectory } from '../../runService/paths'

const TERMINAL_BROKER_STATE_SCHEMA = 'tidecode.terminal_broker_state/v1' as const
const TERMINAL_BROKER_STATE_FILE = 'terminal-broker-state.json'

export interface PersistedTerminalBrokerSession {
  output: {
    data: string
    endCursor: number
    startCursor: number
  }
  sessionKey: string | null
  snapshot: TerminalBrokerSessionSnapshot
}

export interface PersistedTerminalBrokerState {
  operations: TerminalBrokerOperationSnapshot[]
  savedAt: number
  schema: typeof TERMINAL_BROKER_STATE_SCHEMA
  sessions: PersistedTerminalBrokerSession[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPersistedState(value: unknown): value is PersistedTerminalBrokerState {
  return isRecord(value)
    && value.schema === TERMINAL_BROKER_STATE_SCHEMA
    && Array.isArray(value.sessions)
    && Array.isArray(value.operations)
}

export class TerminalBrokerPersistence {
  private saveQueue = Promise.resolve()

  private get filePath() {
    return path.join(getRunServiceDirectory(), TERMINAL_BROKER_STATE_FILE)
  }

  async load(): Promise<PersistedTerminalBrokerState | null> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as unknown
      return isPersistedState(parsed) ? parsed : null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      console.error('Unable to load terminal broker recovery state.', error)
      return null
    }
  }

  save(state: Omit<PersistedTerminalBrokerState, 'savedAt' | 'schema'>) {
    const document: PersistedTerminalBrokerState = {
      ...state,
      savedAt: Date.now(),
      schema: TERMINAL_BROKER_STATE_SCHEMA,
    }
    this.saveQueue = this.saveQueue
      .catch(() => undefined)
      .then(async () => {
        await ensureRunServiceDirectory()
        const temporaryPath = `${this.filePath}.tmp-${process.pid}-${randomUUID()}`
        await fs.writeFile(temporaryPath, JSON.stringify(document), {
          encoding: 'utf8',
          mode: 0o600,
        })
        try {
          await fs.rename(temporaryPath, this.filePath)
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (code !== 'EEXIST' && code !== 'EPERM') {
            await fs.unlink(temporaryPath).catch(() => undefined)
            throw error
          }
          const backupPath = `${this.filePath}.bak`
          await fs.unlink(backupPath).catch(() => undefined)
          await fs.rename(this.filePath, backupPath).catch((renameError: NodeJS.ErrnoException) => {
            if (renameError.code !== 'ENOENT') throw renameError
          })
          try {
            await fs.rename(temporaryPath, this.filePath)
            await fs.unlink(backupPath).catch(() => undefined)
          } catch (replacementError) {
            await fs.unlink(temporaryPath).catch(() => undefined)
            await fs.rename(backupPath, this.filePath).catch(() => undefined)
            throw replacementError
          }
        }
        if (process.platform !== 'win32') await fs.chmod(this.filePath, 0o600).catch(() => undefined)
      })
    return this.saveQueue
  }

  flush() {
    return this.saveQueue
  }
}
