import { openai } from '@ai-sdk/openai'
import type { ChatProviderId } from '../../../../src/types/chat'

export function createProviderWebTool(providerId: ChatProviderId | undefined) {
  return providerId === 'codex' || providerId === 'openai'
    ? { name: 'web_search', tool: openai.tools.webSearch() }
    : null
}

