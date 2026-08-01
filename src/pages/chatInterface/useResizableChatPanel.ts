import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

const MIN_CHAT_PANEL_VIEWPORT_RATIO = 0.2
const MAX_CHAT_PANEL_VIEWPORT_RATIO = 0.35

function getChatPanelBounds() {
  return {
    maxWidth: Math.round(window.innerWidth * MAX_CHAT_PANEL_VIEWPORT_RATIO),
    minWidth: Math.round(window.innerWidth * MIN_CHAT_PANEL_VIEWPORT_RATIO),
  }
}

function clampChatPanelWidth(width: number) {
  const { maxWidth, minWidth } = getChatPanelBounds()
  return Math.min(maxWidth, Math.max(minWidth, Math.round(width)))
}

export function useResizableChatPanel() {
  const initialBounds = getChatPanelBounds()
  const [chatPanelWidth, setChatPanelWidth] = useState(initialBounds.maxWidth)
  const chatPanelWidthRef = useRef(chatPanelWidth)
  const chatResizeDragStateRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const chatResizeRafRef = useRef<number | null>(null)
  const chatPanelRef = useRef<HTMLDivElement | null>(null)
  const isChatResizingRef = useRef(false)

  useEffect(() => {
    function handleWindowResize() {
      if (isChatResizingRef.current) return
      setChatPanelWidth((width) => clampChatPanelWidth(width))
    }

    window.addEventListener('resize', handleWindowResize)
    return () => window.removeEventListener('resize', handleWindowResize)
  }, [])

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const drag = chatResizeDragStateRef.current
      if (!drag) return

      chatPanelWidthRef.current = clampChatPanelWidth(drag.startWidth + (event.clientX - drag.startX))
      if (chatResizeRafRef.current !== null) return

      chatResizeRafRef.current = window.requestAnimationFrame(() => {
        chatResizeRafRef.current = null
        if (chatPanelRef.current) {
          chatPanelRef.current.style.width = `${chatPanelWidthRef.current}px`
        }
      })
    }

    function handlePointerUp(event: PointerEvent) {
      const drag = chatResizeDragStateRef.current
      if (!drag || drag.pointerId !== event.pointerId) return

      chatResizeDragStateRef.current = null
      isChatResizingRef.current = false
      if (chatResizeRafRef.current !== null) {
        window.cancelAnimationFrame(chatResizeRafRef.current)
        chatResizeRafRef.current = null
      }
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setChatPanelWidth(chatPanelWidthRef.current)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      if (chatResizeRafRef.current !== null) {
        window.cancelAnimationFrame(chatResizeRafRef.current)
        chatResizeRafRef.current = null
      }
    }
  }, [])

  function handleChatResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return

    chatPanelWidthRef.current = chatPanelRef.current?.offsetWidth ?? chatPanelWidth
    chatResizeDragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: chatPanelWidthRef.current,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    isChatResizingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  return {
    chatPanelMaxWidth: initialBounds.maxWidth,
    chatPanelMinWidth: initialBounds.minWidth,
    chatPanelRef,
    chatPanelWidth,
    handleChatResizePointerDown,
  }
}
