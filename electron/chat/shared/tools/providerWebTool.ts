import { openai } from '@ai-sdk/openai'
import type { ChatProviderId } from '../../../../src/types/chat'
import { createWebFetchTool } from './webfetchTool'

export function createProviderWebTool(providerId: ChatProviderId | undefined) {
  return providerId === 'codex'
    ? { name: 'web_search', tool: openai.tools.webSearch() }
    : { name: 'webfetch', tool: createWebFetchTool() }
}
