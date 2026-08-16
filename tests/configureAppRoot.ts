import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { configureTideCodeRuntimeRoot } from '../electron/runtime/runtimeRoot'

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.env.APP_ROOT = workspaceRoot
configureTideCodeRuntimeRoot(workspaceRoot)
