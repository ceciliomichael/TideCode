import type { Readable } from 'node:stream'

export const PIPED_STDIN_DETECTION_WINDOW_MS = 40

export type CliInputStream = Readable & {
  readonly isTTY?: boolean
}

type InputReadiness = 'readable' | 'ended' | 'timeout'

function normalizePromptText(value: string): string | null {
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

async function waitForInputReadiness(
  input: CliInputStream,
  detectionWindowMs: number,
): Promise<InputReadiness> {
  if (input.readableLength > 0) return 'readable'
  if (input.readableEnded || input.destroyed) return 'ended'

  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      input.removeListener('readable', onReadable)
      input.removeListener('end', onEnded)
      input.removeListener('error', onError)
    }
    const settle = (result: InputReadiness) => {
      cleanup()
      resolve(result)
    }
    const onReadable = () => settle('readable')
    const onEnded = () => settle('ended')
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }

    input.once('readable', onReadable)
    input.once('end', onEnded)
    input.once('error', onError)
    timer = setTimeout(() => settle('timeout'), Math.max(0, detectionWindowMs))
  })
}

export async function readPipedPrompt(
  input: CliInputStream,
  detectionWindowMs = PIPED_STDIN_DETECTION_WINDOW_MS,
): Promise<string | null> {
  if (input.isTTY === true) return null

  const readiness = await waitForInputReadiness(input, detectionWindowMs)
  if (readiness !== 'readable') return null

  input.setEncoding('utf8')
  let pipedData = ''
  for await (const chunk of input) {
    pipedData += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
  }

  return normalizePromptText(pipedData)
}

export function resolveHeadlessPrompt(
  explicitPrompt: string | undefined,
  pipedPrompt: string | null,
): string | null {
  return normalizePromptText(explicitPrompt ?? '') ?? pipedPrompt
}
