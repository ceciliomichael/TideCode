import { executeTideAction, validateTideAction, type TideActionRequest } from './actions'
import type { TideUIActions } from './types'

export interface TideHtmlActionResult {
  ok: boolean
  error?: string
}

export async function executeHtmlAction(
  request: unknown,
  actions: TideUIActions,
  isStreaming: boolean,
  copy: (value: string) => Promise<boolean>,
): Promise<TideHtmlActionResult> {
  if (!request || typeof request !== 'object') return { ok: false, error: 'Invalid action request.' }
  const { kind, value } = request as Record<string, unknown>
  if (typeof kind !== 'string' || !['draft', 'send', 'copy', 'open'].includes(kind) || typeof value !== 'string') {
    return { ok: false, error: 'Unsupported action or invalid value.' }
  }
  const action = { kind, value } as TideActionRequest
  const invalid = validateTideAction(action)
  if (invalid) return { ok: false, error: invalid }
  if (isStreaming) return { ok: false, error: 'This response is still generating. Try again when it finishes.' }
  try {
    if (action.kind === 'open') {
      // A noopener window.open returns null even when accepted. Dispatch a safe
      // link instead; success acknowledges the request, not remote page loading.
      const link = document.createElement('a')
      link.href = action.value
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.click()
      return { ok: true }
    }
    const ok = await executeTideAction(action, actions, copy)
    return ok ? { ok: true } : { ok: false, error: 'The action is unavailable or was not accepted.' }
  } catch {
    return { ok: false, error: 'The action could not be completed.' }
  }
}
