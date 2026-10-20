import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import { parseStreamingTideUI } from '../../lib/tideui/streaming'
import type { TideNode, TideUIActions } from '../../lib/tideui/types'
import { reconcileTideNodes } from '../../lib/tideui/reconcileNodes'
import { TideUIRenderer } from './TideUIRenderer'
import { AppNoticeSurface } from '../ui/AppNoticeSurface'

const STREAMING_ACTIONS: TideUIActions = {}

export const TideUIBlock = memo(function TideUIBlock({ source, actions, isStreaming = false, isBlockComplete = false }: {
  source: string
  actions: TideUIActions
  isStreaming?: boolean
  isBlockComplete?: boolean
}) {
  // Tokens within the current line cannot change visible UI. Revalidate only
  // when the model completes a new declaration, keeping React node identities
  // and local control state stable as tokens continue arriving.
  const completedSource = isStreaming && !isBlockComplete
    ? source.slice(0, source.lastIndexOf('\n') + 1)
    : source
  const document = useMemo(
    () => parseStreamingTideUI(completedSource, { blockComplete: isBlockComplete || !isStreaming }),
    [completedSource, isBlockComplete, isStreaming],
  )
  const committedNodes = useRef<TideNode[]>([])
  const nodes = useMemo(() => reconcileTideNodes(committedNodes.current, document.nodes), [document.nodes])
  useLayoutEffect(() => {
    committedNodes.current = nodes
  }, [nodes])
  if (document.errors.length) return <div className="tideui-root">
    <AppNoticeSurface title="Generated interface unavailable" message="This generated interface could not be displayed." fallbackMessage="This generated interface could not be displayed.">
      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer">Show technical details</summary>
        <pre className="tideui-code mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words">{document.errors.join('\n')}{'\n'}{source}</pre>
      </details>
    </AppNoticeSurface>
  </div>
  if (document.nodes.length === 0) {
    return null
  }
  return <TideUIRenderer nodes={nodes} actions={isStreaming ? STREAMING_ACTIONS : actions} isStreaming={isStreaming} />
})
