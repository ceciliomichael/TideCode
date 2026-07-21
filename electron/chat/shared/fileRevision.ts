import { createHash } from 'node:crypto'

export function createFileRevision(content: string | Buffer) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}
