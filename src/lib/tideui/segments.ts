export interface TideFence {
  kind: 'tideui' | 'tidehtml'
  source: string
  closed: boolean
  start: number
  end: number
}

/** A streamed native opener must not briefly mount an ordinary code preview. */
export function findIncompleteTideFenceStart(content: string): number | null {
  const lineStart = content.lastIndexOf('\n') + 1
  const lastLine = content.slice(lineStart).replace(/\r$/u, '')
  const openers = ['```tideui', '```tidehtml']
  if (!lastLine || !openers.some(opener => opener.startsWith(lastLine))) {
    return null
  }
  let insideFence = false
  for (const line of content.slice(0, lineStart).split('\n')) {
    if (/^\x60{3}(?:[^\x60\s].*)?$/u.test(line.replace(/\r$/u, ''))) {
      insideFence = !insideFence
    }
  }
  return insideFence ? null : lineStart
}

/** Ignore TideUI-like markers inside ordinary fenced code blocks. */
export function findTideFences(content: string): TideFence[] {
  const fences: TideFence[] = []
  const lines = content.split('\n')
  let position = 0
  let active: { kind: TideFence['kind']; start: number; bodyStart: number } | null = null
  let ordinaryFence = false
  for (const [index, line] of lines.entries()) {
    const trimmed = line.replace(/\r$/u, '')
    const start = /^\x60{3}(tideui|tidehtml)(?:[ \t]+[^\r\n]*)?$/u.exec(trimmed)
    const isAnyFence = /^\x60{3}(?:[^\x60\s].*)?$/u.test(trimmed)
    const isClosingFence = /^\x60{3}[ \t]*$/u.test(trimmed)
    if (active) {
      if (isClosingFence) {
        fences.push({
          kind: active.kind,
          source: content.slice(active.bodyStart, position),
          closed: true,
          start: active.start,
          end: position + line.length,
        })
        active = null
      }
    } else if (ordinaryFence) {
      if (isClosingFence) ordinaryFence = false
    } else if (start) {
      active = { kind: start[1] as TideFence['kind'], start: position, bodyStart: Math.min(content.length, position + line.length + 1) }
    } else if (isAnyFence) {
      ordinaryFence = true
    }
    position += line.length + (index < lines.length - 1 ? 1 : 0)
  }
  if (active) {
    fences.push({
      kind: active.kind,
      source: content.slice(active.bodyStart),
      closed: false,
      start: active.start,
      end: content.length,
    })
  }
  return fences
}
