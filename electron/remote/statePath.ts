import path from 'node:path'
import { electronApp } from '../electronApp'

const REMOTE_STATE_HOME_OVERRIDE_ENV = 'TIDECODE_REMOTE_STATE_HOME'

export function getRemoteStateRoot() {
  const override = process.env[REMOTE_STATE_HOME_OVERRIDE_ENV]?.trim()
  return override ? path.resolve(override) : electronApp.getPath('userData')
}
