import { useEffect, useMemo, useState } from 'react'
import type { ResolvedTheme } from '../../../lib/theme'
import {
  createMermaidRenderCacheKey,
  getMermaidThemeVariables,
  loadMermaidModule,
  isMermaidErrorSvg,
  normalizeRenderedMermaidSvg,
} from './mermaid-utils'

const MAX_MERMAID_RENDER_CACHE_ENTRIES = 24
const MAX_CACHED_MERMAID_SVG_LENGTH = 256 * 1024
const mermaidRenderCache = new Map<string, string>()

function getCachedMermaidSvg(cacheKey: string) {
  const cachedSvg = mermaidRenderCache.get(cacheKey)
  if (!cachedSvg) return null
  mermaidRenderCache.delete(cacheKey)
  mermaidRenderCache.set(cacheKey, cachedSvg)
  return cachedSvg
}

function cacheMermaidSvg(cacheKey: string, svg: string) {
  if (svg.length > MAX_CACHED_MERMAID_SVG_LENGTH) return
  mermaidRenderCache.delete(cacheKey)
  mermaidRenderCache.set(cacheKey, svg)
  while (mermaidRenderCache.size > MAX_MERMAID_RENDER_CACHE_ENTRIES) {
    const oldestKey = mermaidRenderCache.keys().next().value
    if (typeof oldestKey !== 'string') break
    mermaidRenderCache.delete(oldestKey)
  }
}

interface UseMermaidRendererInput {
  code: string
  renderId: string
  theme: ResolvedTheme
}

interface UseMermaidRendererResult {
  error: string | null
  svg: string | null
}

export function useMermaidRenderer({ code, renderId, theme }: UseMermaidRendererInput): UseMermaidRendererResult {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const normalizedCode = useMemo(() => code.trim(), [code])
  const cacheKey = useMemo(() => createMermaidRenderCacheKey(normalizedCode, theme), [normalizedCode, theme])

  useEffect(() => {
    if (normalizedCode.length === 0) {
      setSvg(null)
      setError(null)
      return
    }

    const cachedSvg = getCachedMermaidSvg(cacheKey)
    if (cachedSvg) {
      setSvg(cachedSvg)
      setError(null)
      return
    }

    let isCancelled = false

    async function renderDiagram() {
      try {
        const mermaid = await loadMermaidModule()
        if (isCancelled) {
          return
        }

        mermaid.initialize({
          fontFamily: getMermaidThemeVariables().fontFamily,
          securityLevel: 'loose',
          startOnLoad: false,
          theme: 'base',
          themeVariables: getMermaidThemeVariables(),
        })

        const rendered = await mermaid.render(`mermaid-${renderId}`, normalizedCode)
        if (isCancelled) {
          return
        }

        const responsiveSvg = normalizeRenderedMermaidSvg(rendered.svg)
        if (isMermaidErrorSvg(responsiveSvg)) {
          setSvg(null)
          setError('Invalid Mermaid syntax.')
          return
        }

        cacheMermaidSvg(cacheKey, responsiveSvg)
        setSvg(responsiveSvg)
        setError(null)
      } catch (renderError) {
        if (isCancelled) {
          return
        }

        console.error('[WorkspaceMarkdownPreview] Failed to render Mermaid diagram', renderError)
        setSvg(null)
        setError(renderError instanceof Error ? renderError.message : 'Failed to render Mermaid diagram.')
      }
    }

    void renderDiagram()

    return () => {
      isCancelled = true
    }
  }, [cacheKey, normalizedCode, renderId])

  return {
    error,
    svg,
  }
}
