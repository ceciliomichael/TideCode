import { useMemo } from 'react'
import { Globe, ExternalLink, Search } from 'lucide-react'
import type { ToolInvocationTrace } from '../../types/chat'
import { parseStructuredToolResultContent } from '../../lib/toolResultContent'
import { MarkdownRenderer } from './MarkdownRenderer'

interface WebToolResultProps {
  invocation: ToolInvocationTrace
  isStreaming?: boolean
}

function parseUrlFromTarget(invocation: ToolInvocationTrace, summary: string | null): string | null {
  try {
    const args = JSON.parse(invocation.argumentsText)
    if (typeof args.url === 'string' && args.url.startsWith('http')) {
      return args.url
    }
  } catch {}

  if (summary && summary.startsWith('Fetched ')) {
    const candidate = summary.slice('Fetched '.length).trim()
    if (candidate.startsWith('http')) return candidate
  }

  return null
}

function extractDomain(urlStr: string): string {
  try {
    const url = new URL(urlStr)
    return url.hostname.replace(/^www\./, '')
  } catch {
    return 'Web Content'
  }
}

export function WebToolResult({ invocation, isStreaming = false }: WebToolResultProps) {
  const structured = invocation.resultContent ? parseStructuredToolResultContent(invocation.resultContent) : null
  const content = structured?.body ?? invocation.resultContent ?? ''
  const summary = structured?.metadata?.summary ?? null
  const isSearch = invocation.toolName === 'web_search'

  const targetUrl = useMemo(() => parseUrlFromTarget(invocation, summary), [invocation, summary])
  const domain = useMemo(() => (targetUrl ? extractDomain(targetUrl) : 'Web Content'), [targetUrl])

  return (
    <div className="space-y-2 rounded-xl border border-border/70 bg-surface/80 p-3 shadow-xs">
      <div className="flex items-center justify-between border-b border-border/40 pb-2 text-[12px] font-medium text-muted-foreground">
        <div className="flex items-center gap-1.5 min-w-0">
          {isSearch ? (
            <Search className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
          ) : (
            <Globe className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          )}
          <span className="font-semibold text-foreground/90 truncate">
            {isSearch ? 'Web Search Results' : domain}
          </span>
        </div>

        {targetUrl ? (
          <a
            href={targetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md bg-secondary/60 hover:bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground transition-colors shrink-0"
          >
            <span>Open Link</span>
            <ExternalLink className="h-2.5 w-2.5 opacity-80" />
          </a>
        ) : null}
      </div>

      <div className="max-h-72 overflow-y-auto pr-1">
        <MarkdownRenderer
          content={content}
          className="text-xs text-foreground/90 leading-relaxed font-sans"
          isStreaming={isStreaming}
        />
      </div>
    </div>
  )
}
