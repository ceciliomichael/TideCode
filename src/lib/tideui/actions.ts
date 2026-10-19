import type { TideUIActions } from './types'
import { isSafeTideUrl } from './assetPolicy'

export interface TideActionRequest {
  kind: 'copy' | 'draft' | 'send' | 'open'
  value: string
}

export function validateTideAction(request: TideActionRequest): string | null {
  if (!request.value.trim() || request.value.length > 4000) {
    return 'Action value must contain between 1 and 4000 characters'
  }
  if (request.kind === 'open' && !isSafeTideUrl(request.value)) {
    return 'Only HTTP and HTTPS links may be opened'
  }
  return null
}

export async function executeTideAction(
  request: TideActionRequest,
  actions: TideUIActions,
  copy: (value: string) => Promise<boolean>,
): Promise<boolean> {
  if (validateTideAction(request)) return false
  if (request.kind === 'copy') return actions.onCopy ? actions.onCopy(request.value) : copy(request.value)
  if (request.kind === 'draft') {
    if (!actions.onDraft) return false
    return await actions.onDraft(request.value) !== false
  }
  if (request.kind === 'send') {
    if (!actions.onSend) return false
    return await actions.onSend(request.value)
  }
  if (request.kind === 'open') {
    if (actions.onOpen) return actions.onOpen(request.value)
    return Boolean(window.open(request.value, '_blank', 'noopener,noreferrer'))
  }
  return false
}
