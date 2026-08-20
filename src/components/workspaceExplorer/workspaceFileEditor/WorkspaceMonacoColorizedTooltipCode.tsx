import { useEffect, useState } from 'react'
import type { Monaco } from '@monaco-editor/react'

interface WorkspaceMonacoColorizedTooltipCodeProps {
  languageId: string
  monaco: Monaco
  text: string
}

export function WorkspaceMonacoColorizedTooltipCode({
  languageId,
  monaco,
  text,
}: WorkspaceMonacoColorizedTooltipCodeProps) {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    setHtml(null)

    void monaco.editor.colorize(text, languageId, { tabSize: 2 })
.then((nextHtml: string) => {
        if (!disposed) setHtml(nextHtml)
      })
      .catch(() => {
        if (!disposed) setHtml(null)
      })

    return () => {
      disposed = true
    }
  }, [languageId, monaco, text])

  if (!html) return <>{text}</>

  return (
    <span
      className="workspace-monaco-tooltip-code"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
