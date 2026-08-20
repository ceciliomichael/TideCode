import type { ModelMessage } from 'ai'
import type { ChatProviderId, ReasoningEffort } from '../../src/types/chat'

export interface GitModelSelection {
  modelId: string
  providerId: ChatProviderId
  reasoningEffort: ReasoningEffort
}

interface GenerateGitModelTextInput {
  promptText: string
  selection: GitModelSelection
  systemPrompt: string
}

async function readTextFromStream(stream: { fullStream: AsyncIterable<{ [key: string]: unknown; type: string }> }) {
  let generatedText = ''

  for await (const part of stream.fullStream) {
    if (part.type === 'text-delta' && typeof part.text === 'string') {
      generatedText += part.text
    }
  }

  return generatedText.trim()
}

export async function generateGitModelText(input: GenerateGitModelTextInput) {
  const messages: ModelMessage[] = [
    {
      content: input.promptText,
      role: 'user',
    },
  ]

  if (input.selection.providerId === 'codex') {
    const { createCodexClient } = await import('../chat/codex/client')
    const client = createCodexClient()
    const stream = await client.chat.completions.create({
      messages,
      model: input.selection.modelId,
      reasoningEffort: input.selection.reasoningEffort,
      system: input.systemPrompt,
    })

    return readTextFromStream(stream)
  }

  const { readApiKeyChatProviderConfig } = await import('../chat/apiKey/config')
  const { createApiKeyChatClient } = await import('../chat/apiKey/client')
  const providerConfig = await readApiKeyChatProviderConfig(input.selection.providerId)
  const client = createApiKeyChatClient(providerConfig)
  const stream = await client.chat.completions.create({
    messages,
    model: input.selection.modelId,
    reasoningEffort: input.selection.reasoningEffort,
    system: input.systemPrompt,
  })

  return readTextFromStream(stream)
}
