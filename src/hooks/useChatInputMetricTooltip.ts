import { useCallback, useEffect, useRef, useState } from 'react'

type ChatInputMetricTooltipPosition = 'above' | 'below'

interface UseChatInputMetricTooltipInput {
  disabled?: boolean
  closeDelayMs?: number
  hoverKey: string
  minimumTopSpace?: number
}

const CHAT_INPUT_METRIC_TOOLTIP_EVENT = 'tidecode:chat-input-metric-tooltip-hover'

export function useChatInputMetricTooltip({
  disabled = false,
  closeDelayMs = 160,
  hoverKey,
  minimumTopSpace = 220,
}: UseChatInputMetricTooltipInput) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const closeTimeoutRef = useRef<number | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isTopTooltip, setIsTopTooltip] = useState(false)
  const [tooltipPosition, setTooltipPosition] = useState<ChatInputMetricTooltipPosition>('above')

  const clearCloseTimeout = useCallback(() => {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
  }, [])

  const calculatePosition = useCallback((): ChatInputMetricTooltipPosition => {
    const buttonRect = buttonRef.current?.getBoundingClientRect()
    if (!buttonRect) {
      return 'above'
    }

    return buttonRect.top < minimumTopSpace ? 'below' : 'above'
  }, [minimumTopSpace])

  const openTooltip = useCallback(() => {
    if (disabled) {
      return
    }

    clearCloseTimeout()
    window.dispatchEvent(new CustomEvent<string>(CHAT_INPUT_METRIC_TOOLTIP_EVENT, { detail: hoverKey }))
    setTooltipPosition(calculatePosition())
    setIsOpen(true)
  }, [calculatePosition, clearCloseTimeout, disabled, hoverKey])

  const scheduleClose = useCallback(() => {
    clearCloseTimeout()
    closeTimeoutRef.current = window.setTimeout(() => {
      setIsOpen(false)
      closeTimeoutRef.current = null
    }, closeDelayMs)
  }, [clearCloseTimeout, closeDelayMs])

  const closeImmediately = useCallback(() => {
    clearCloseTimeout()
    setIsOpen(false)
  }, [clearCloseTimeout])

  const handleBlur = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      if (event.relatedTarget instanceof Node && containerRef.current?.contains(event.relatedTarget)) {
        return
      }

      scheduleClose()
    },
    [scheduleClose],
  )

  useEffect(
    () => () => {
      clearCloseTimeout()
    },
    [clearCloseTimeout],
  )

  useEffect(() => {
    function handleTooltipHover(event: Event) {
      const customEvent = event as CustomEvent<string>
      setIsTopTooltip(customEvent.detail === hoverKey)
    }

    window.addEventListener(CHAT_INPUT_METRIC_TOOLTIP_EVENT, handleTooltipHover as EventListener)
    return () => {
      window.removeEventListener(CHAT_INPUT_METRIC_TOOLTIP_EVENT, handleTooltipHover as EventListener)
    }
  }, [hoverKey])

  return {
    buttonRef,
    closeImmediately,
    containerRef,
    handleBlur,
    isOpen,
    isTopTooltip,
    openTooltip,
    scheduleClose,
    tooltipPosition,
  }
}
