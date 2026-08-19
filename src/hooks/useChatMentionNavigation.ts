import { useCallback, type FormEvent as ReactFormEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import {
  findChatMentionForDeletion,
  getChatMentionAtPosition,
  getChatMentionBeforePosition,
  findChatMentionMatches,
} from '../lib/chatMentions'

interface UseChatMentionNavigationInput {
  onMentionBoundaryJump?: () => void
  mentionPathMap?: ReadonlyMap<string, string>
  onValueChange: (value: string) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
  value: string
}

function setTextareaCursor(textarea: HTMLTextAreaElement, cursorPosition: number) {
  window.requestAnimationFrame(() => {
    textarea.focus()
    textarea.setSelectionRange(cursorPosition, cursorPosition)
  })
}

export function useChatMentionNavigation({
  onMentionBoundaryJump,
  mentionPathMap,
  onValueChange,
  textareaRef,
  value,
}: UseChatMentionNavigationInput) {
  const handleMentionDeletion = useCallback(
    (direction: 'backward' | 'forward', preventDefault: () => void) => {
      const textarea = textareaRef.current
      if (!textarea) {
        return false
      }

      const cursorPosition = textarea.selectionStart ?? 0
      const selectionEnd = textarea.selectionEnd ?? cursorPosition
      const validationMap = mentionPathMap && mentionPathMap.size > 0 ? mentionPathMap : undefined
      const mention = findChatMentionForDeletion({
        direction,
        knownMentionLabels: validationMap,
        selectionEnd,
        selectionStart: cursorPosition,
        text: value,
      })
      if (!mention) {
        return false
      }

      preventDefault()
      onValueChange(`${value.slice(0, mention.start)}${value.slice(mention.end)}`)
      setTextareaCursor(textarea, mention.start)
      return true
    },
    [mentionPathMap, onValueChange, textareaRef, value],
  )

  const handleBeforeInput = useCallback(
    (event: ReactFormEvent<HTMLTextAreaElement>) => {
      const inputType = (event.nativeEvent as InputEvent).inputType
      if (inputType === 'deleteContentBackward') {
        return handleMentionDeletion('backward', () => event.preventDefault())
      }
      if (inputType === 'deleteContentForward') {
        return handleMentionDeletion('forward', () => event.preventDefault())
      }
      return false
    },
    [handleMentionDeletion],
  )

const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      const textarea = textareaRef.current
      if (!textarea) {
        return false
      }

      if (event.key === 'Backspace' && handleMentionDeletion('backward', () => event.preventDefault())) {
        return true
      }

      if (event.key === 'Delete' && handleMentionDeletion('forward', () => event.preventDefault())) {
        return true
      }

      const cursorPosition = textarea.selectionStart ?? 0
      const selectionEnd = textarea.selectionEnd ?? cursorPosition
      const hasSelection = cursorPosition !== selectionEnd
      const validationMap = mentionPathMap && mentionPathMap.size > 0 ? mentionPathMap : undefined

      if (event.key === 'ArrowLeft' && !hasSelection && !event.shiftKey) {
        const mentionBefore = getChatMentionBeforePosition(value, cursorPosition, validationMap)
        if (mentionBefore) {
          event.preventDefault()
          onMentionBoundaryJump?.()
          textarea.setSelectionRange(mentionBefore.start, mentionBefore.start)
          return true
        }

        const mentionAt = getChatMentionAtPosition(value, cursorPosition, validationMap)
        if (mentionAt) {
          event.preventDefault()
          onMentionBoundaryJump?.()
          textarea.setSelectionRange(mentionAt.start, mentionAt.start)
          return true
        }
      }

      if (event.key === 'ArrowRight' && !hasSelection && !event.shiftKey) {
        const mentionAt = getChatMentionAtPosition(value, cursorPosition, validationMap)
        if (mentionAt && cursorPosition >= mentionAt.start && cursorPosition < mentionAt.end) {
          event.preventDefault()
          onMentionBoundaryJump?.()
          textarea.setSelectionRange(mentionAt.end, mentionAt.end)
          return true
        }
      }

      return false
    },
    [handleMentionDeletion, mentionPathMap, onMentionBoundaryJump, textareaRef, value],
  )

  const handleClick = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }

    if (textarea.selectionStart !== textarea.selectionEnd) {
      return
    }

    const cursorPosition = textarea.selectionStart ?? 0
    const validationMap = mentionPathMap && mentionPathMap.size > 0 ? mentionPathMap : undefined
    const mention = findChatMentionMatches(value, validationMap).find(
      (match) => cursorPosition >= match.start && cursorPosition <= match.end,
    )
    if (!mention) {
      return
    }

    if (cursorPosition >= mention.start && cursorPosition <= mention.end) {
      onMentionBoundaryJump?.()
      textarea.setSelectionRange(mention.end, mention.end)
    }
  },
    [mentionPathMap, onMentionBoundaryJump, textareaRef, value],
  )

  return {
    handleBeforeInput,
    handleClick,
    handleKeyDown,
  }
}
