import { jsonSchema, tool } from 'ai'
import type { AgentToolExecutionResult } from '../toolTypes'

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 120_000

const WEBFETCH_TOOL_DESCRIPTION = 'Fetch text or markdown content from a specific http/https URL.'

const BASIC_HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&gt;': '>',
  '&lt;': '<',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
}

function createToolErrorResult(summary: string): AgentToolExecutionResult {
  return {
    status: 'error',
    summary,
  }
}

function decodeHtmlEntities(text: string) {
  return text.replace(/&(amp|gt|lt|quot|#39|nbsp);/g, (entity) => BASIC_HTML_ENTITY_MAP[entity] ?? entity)
}

function stripHtmlToText(html: string) {
  const withoutNoise = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|header|footer|main|aside|nav|li|tr|table|ul|ol|h[1-6])>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<a\b[^>]*href='([^']+)'[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, ' ')

  return decodeHtmlEntities(withoutNoise).replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()
}

function htmlToMarkdown(html: string) {
  return stripHtmlToText(html)
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      headers: {
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

export function createWebFetchTool() {
  return tool({
    description: WEBFETCH_TOOL_DESCRIPTION,
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        format: {
          enum: ['text', 'markdown', 'html'],
          type: 'string',
        },
        timeout: {
          maximum: 120,
          minimum: 1,
          type: 'number',
        },
        url: {
          type: 'string',
        },
      },
      required: ['url'],
      type: 'object',
    }),
    execute: async (rawInput) => {
      const inputValue = rawInput as {
        format?: 'text' | 'markdown' | 'html'
        timeout?: number
        url?: string
      }

      const url = inputValue.url?.trim() ?? ''
      if (!url) {
        return createToolErrorResult('URL must not be empty.')
      }

      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return createToolErrorResult('URL must start with http:// or https://.')
      }

      let parsedUrl: URL
      try {
        parsedUrl = new URL(url)
      } catch {
        return createToolErrorResult('URL is not valid.')
      }

      const timeoutMs = Math.min((inputValue.timeout ?? DEFAULT_TIMEOUT_MS / 1000) * 1000, MAX_TIMEOUT_MS)
      const response = await fetchWithTimeout(parsedUrl.toString(), timeoutMs).catch((error) => {
        if (error instanceof Error && error.name === 'AbortError') {
          return null
        }

        return error
      })

      if (!response) {
        return createToolErrorResult('Web fetch timed out.')
      }

      if (response instanceof Error) {
        return createToolErrorResult(
          response.message.trim().length > 0 ? `Web fetch failed: ${response.message}` : 'Web fetch failed.',
        )
      }

      if (!response.ok) {
        return createToolErrorResult(`Web fetch failed with HTTP ${response.status}.`)
      }

      const contentType = response.headers.get('content-type') ?? ''
      const contentLength = response.headers.get('content-length')
      if (contentLength && Number(contentLength) > MAX_RESPONSE_SIZE) {
        return createToolErrorResult('Response is too large to fetch safely.')
      }

      const arrayBuffer = await response.arrayBuffer()
      if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
        return createToolErrorResult('Response is too large to fetch safely.')
      }

      const content = new TextDecoder().decode(arrayBuffer)
      const format = inputValue.format ?? 'markdown'
      const body =
        format === 'html'
          ? content
          : contentType.includes('text/html')
            ? format === 'text'
              ? stripHtmlToText(content)
              : htmlToMarkdown(content)
            : content

      return {
        body,
        status: 'success',
        summary: `Fetched ${parsedUrl.toString()}`,
      }
    },
  })
}
