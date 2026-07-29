import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import { useFloatingMenuPosition } from './useFloatingMenuPosition'
import { getPathBasename } from '../lib/pathPresentation'
import { getCaretBoundingRect } from '../lib/caretPosition'
import {
  expandChatMentions,
  findChatMentionMatches,
  getChatMentionTriggerState,
  insertChatMention,
} from '../lib/chatMentions'
import type { WorkspaceExplorerEntry } from '../types/chat'
import type { ChatMentionMenuItem, ChatMentionMenuType } from '../components/chat/ChatMentionMenu'

interface ChatFileMentionIndex {
  basenameCounts: Map<string, number>
  entries: ChatMentionMenuItem[]
  workspaceRootPath: string
}

interface UseChatFileMentionMenuInput {
  disabled?: boolean
  initialMentionPathMap?: ReadonlyMap<string, string> | null
  textareaRef: RefObject<HTMLTextAreaElement | null>
  value: string
  workspaceRootPath: string | null | undefined
  onValueChange: (value: string) => void
}

const MAX_MENTION_RESULTS = 8
const MAX_SCANNED_FILES = 10000
const MAX_SCANNED_DIRECTORIES = 1000
const ROOT_MENU_OPTION_COUNT = 3

function normalizeRelativePath(relativePath: string) {
  return relativePath.replace(/\\/g, '/')
}

function buildLabelCounts(entries: readonly WorkspaceExplorerEntry[]) {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    if (entry.isDirectory) {
      continue
    }

    const basename = getPathBasename(entry.relativePath)
    counts.set(basename, (counts.get(basename) ?? 0) + 1)
  }

  return counts
}

function toMentionLabel(relativePath: string) {
  return getPathBasename(relativePath)
}

function normalizeMentionSearchValue(value: string) {
  return normalizeRelativePath(value).toLowerCase()
}

function compactSearchValue(value: string) {
  return normalizeMentionSearchValue(value).replace(/[.\s_-]+/gu, '')
}

function scoreMentionResult(relativePath: string, query: string) {
  const normalizedPath = normalizeMentionSearchValue(relativePath)
  const normalizedBasename = getPathBasename(relativePath).toLowerCase()
  const pathWithoutExtension = normalizedPath.replace(/\.[^./\\]+$/u, '')
  const compactQuery = compactSearchValue(query)
  const compactBasename = compactSearchValue(pathWithoutExtension.split('/').pop() ?? normalizedBasename)
  const compactPath = compactSearchValue(pathWithoutExtension)

  if (query.length === 0) {
    return [0, normalizedPath.length] as const
  }

  if (normalizedBasename === query) {
    return [1, normalizedPath.length] as const
  }

  if (normalizedBasename.startsWith(query)) {
    return [2, normalizedPath.length] as const
  }

  if (compactQuery.length > 0 && compactBasename === compactQuery) {
    return [2, normalizedPath.length] as const
  }

  if (compactQuery.length > 0 && compactBasename.startsWith(compactQuery)) {
    return [3, normalizedPath.length] as const
  }

  if (normalizedPath.endsWith(`/${query}`)) {
    return [3, normalizedPath.length] as const
  }

  if (normalizedPath.includes(query)) {
    return [4, normalizedPath.length] as const
  }

  if (compactQuery.length > 0 && compactPath.includes(compactQuery)) {
    return [5, normalizedPath.length] as const
  }

  return null
}

async function loadWorkspaceMentionIndex(workspaceRootPath: string) {
  const seenDirectoryPaths = new Set<string>()
  const discoveredEntries: WorkspaceExplorerEntry[] = []
  let fileCount = 0
  let directoryCount = 0

  async function visitDirectory(relativePath?: string) {
    if (fileCount >= MAX_SCANNED_FILES || directoryCount >= MAX_SCANNED_DIRECTORIES) {
      return
    }

    const directoryKey = normalizeRelativePath(relativePath?.trim() ?? '.')
    if (seenDirectoryPaths.has(directoryKey)) {
      return
    }

    seenDirectoryPaths.add(directoryKey)
    if (directoryKey !== '.') {
      directoryCount += 1
    }

    const entries = await window.echosphereWorkspace.listDirectory({
      relativePath: directoryKey === '.' ? undefined : directoryKey,
      workspaceRootPath,
    })

    for (const entry of entries) {
      if (fileCount >= MAX_SCANNED_FILES || directoryCount >= MAX_SCANNED_DIRECTORIES) {
        return
      }

      if (entry.isDirectory) {
        discoveredEntries.push(entry)
        await visitDirectory(entry.relativePath)
        continue
      }

      discoveredEntries.push(entry)
      fileCount += 1
    }
  }

  await visitDirectory()
  const basenameCounts = buildLabelCounts(discoveredEntries)
  const fileAndFolderEntries = discoveredEntries
    .map((entry) => {
      const normalizedRelativePath = normalizeRelativePath(entry.relativePath)
      return {
        description: normalizedRelativePath,
        kind: entry.isDirectory ? ('folder' as const) : ('file' as const),
        label: toMentionLabel(entry.relativePath),
        relativePath: entry.isDirectory ? `list:${normalizedRelativePath}` : `read:${normalizedRelativePath}`,
      }
    })

  const skillEntries: ChatMentionMenuItem[] = []
  if (typeof window !== 'undefined' && window.echosphereSkills) {
    try {
      const [skillsState, settings] = await Promise.all([
        window.echosphereSkills.listSkills(workspaceRootPath),
        window.echosphereSettings ? window.echosphereSettings.getSettings() : Promise.resolve(null),
      ])

      const disabledSkillsByPath = settings?.disabledSkillsByPath ?? {}
      const enabledSkills = skillsState.skills.filter(
        (skill) => disabledSkillsByPath[skill.location] !== true,
      )

      for (const skill of enabledSkills) {
        skillEntries.push({
          description: skill.description || 'Skill pack',
          kind: 'skill',
          label: skill.name,
          relativePath: `load_skill:${skill.name}`,
        })
      }
    } catch (error) {
      console.error('Failed to load skills for mention menu index', error)
    }
  }

  const entries = [...fileAndFolderEntries, ...skillEntries].sort((left, right) =>
    left.description.localeCompare(right.description, undefined, { sensitivity: 'base' }),
  )

  return {
    basenameCounts,
    entries,
    workspaceRootPath,
  } satisfies ChatFileMentionIndex
}

export function useChatFileMentionMenu({
  disabled = false,
  initialMentionPathMap = null,
  onValueChange,
  textareaRef,
  value,
  workspaceRootPath,
}: UseChatFileMentionMenuInput) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [selectedMenuType, setSelectedMenuType] = useState<ChatMentionMenuType | null>(null)
  const [isIndexLoading, setIsIndexLoading] = useState(false)
  const [workspaceMentionIndex, setWorkspaceMentionIndex] = useState<ChatFileMentionIndex | null>(null)
  const [workspaceMentionIndexLoadedKey, setWorkspaceMentionIndexLoadedKey] = useState(0)
  const [workspaceMentionIndexRefreshKey, setWorkspaceMentionIndexRefreshKey] = useState(0)
  const [mentionPathMap, setMentionPathMap] = useState<Map<string, string>>(
    () => (initialMentionPathMap ? new Map(initialMentionPathMap) : new Map()),
  )
  const mentionPathMapRef = useRef(mentionPathMap)
  const suppressNextTriggerUpdateRef = useRef(false)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  mentionPathMapRef.current = mentionPathMap

  const getAnchorRect = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea || !isOpen) {
      return null
    }

    const cursorPosition = textarea.selectionStart ?? value.length
    const triggerState = getChatMentionTriggerState(value, cursorPosition)
    const targetIndex = triggerState ? triggerState.start : cursorPosition

    return getCaretBoundingRect(textarea, targetIndex)
  }, [isOpen, textareaRef, value])

  const menuStyle = useFloatingMenuPosition({
    anchorRef,
    getAnchorRect,
    isOpen,
    matchAnchorWidth: false,
    menuRef,
    preferredPlacement: 'above',
  })

  const markTriggerUpdateSuppressed = useCallback(() => {
    suppressNextTriggerUpdateRef.current = true
  }, [])

  function resetTriggerText(nextValue: string, cursorPosition: number) {
    const triggerState = getChatMentionTriggerState(nextValue, cursorPosition)
    if (!triggerState) {
      return {
        nextCursorPosition: cursorPosition,
        nextValue,
      }
    }

    const beforeTrigger = nextValue.slice(0, triggerState.start)
    const afterCursor = nextValue.slice(cursorPosition).replace(/^[^\s]*/u, '')
    return {
      nextCursorPosition: beforeTrigger.length + 1,
      nextValue: `${beforeTrigger}@${afterCursor}`,
    }
  }

  useEffect(() => {
    if (!workspaceRootPath) {
      setWorkspaceMentionIndex(null)
      setWorkspaceMentionIndexLoadedKey(0)
      setWorkspaceMentionIndexRefreshKey(0)
      setIsIndexLoading(false)
      return
    }

    setWorkspaceMentionIndex(null)
    setWorkspaceMentionIndexLoadedKey(0)
    setWorkspaceMentionIndexRefreshKey(0)
    setIsIndexLoading(false)
  }, [workspaceRootPath])

  useEffect(() => {
    if (!workspaceRootPath) {
      return
    }

    let isDisposed = false
    const unsubscribeWorkspaceChanges = window.echosphereWorkspace.onExplorerChange((event) => {
      if (isDisposed || event.workspaceRootPath !== workspaceRootPath) {
        return
      }

      setWorkspaceMentionIndexRefreshKey((currentValue) => currentValue + 1)
    })

    void window.echosphereWorkspace.watchExplorerChanges({
      workspaceRootPath,
    }).catch((error) => {
      console.error('Failed to watch workspace explorer changes for mention suggestions', error)
    })

    return () => {
      isDisposed = true
      unsubscribeWorkspaceChanges()
      void window.echosphereWorkspace.unwatchExplorerChanges({
        workspaceRootPath,
      }).catch((error) => {
        console.error('Failed to unwatch workspace explorer changes for mention suggestions', error)
      })
    }
  }, [workspaceRootPath])

  useEffect(() => {
    if (!isOpen || !workspaceRootPath) {
      return
    }

    if (
      workspaceMentionIndex?.workspaceRootPath === workspaceRootPath &&
      workspaceMentionIndexLoadedKey === workspaceMentionIndexRefreshKey
    ) {
      return
    }

    let isCancelled = false
    const nextRefreshKey = workspaceMentionIndexRefreshKey
    setIsIndexLoading(true)

    void loadWorkspaceMentionIndex(workspaceRootPath)
      .then((index) => {
        if (isCancelled) {
          return
        }

        setWorkspaceMentionIndex(index)
        setWorkspaceMentionIndexLoadedKey(nextRefreshKey)
      })
      .catch((error) => {
        if (!isCancelled) {
          console.error('Failed to build file mention index', error)
          setWorkspaceMentionIndex({
            basenameCounts: new Map(),
            entries: [],
            workspaceRootPath,
          })
          setWorkspaceMentionIndexLoadedKey(nextRefreshKey)
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsIndexLoading(false)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [isOpen, workspaceMentionIndex?.workspaceRootPath, workspaceMentionIndexLoadedKey, workspaceMentionIndexRefreshKey, workspaceRootPath])

  const searchResults = useMemo(() => {
    if (!workspaceMentionIndex) {
      return [] as ChatMentionMenuItem[]
    }

    const normalizedQuery = searchQuery.trim().toLowerCase()
    const scoredResults = workspaceMentionIndex.entries.filter((item) =>
      selectedMenuType === null ? true : item.kind === selectedMenuType,
    )
      .map((item) => {
        const score = scoreMentionResult(item.relativePath, normalizedQuery)
        return score
          ? {
              item,
              score,
            }
          : null
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((left, right) => {
        if (left.score[0] !== right.score[0]) {
          return left.score[0] - right.score[0]
        }

        if (left.score[1] !== right.score[1]) {
          return left.score[1] - right.score[1]
        }

        return left.item.description.localeCompare(right.item.description, undefined, {
          sensitivity: 'base',
        })
      })

    return scoredResults.slice(0, MAX_MENTION_RESULTS).map(({ item }) => ({
      ...item,
      label: item.label,
    }))
  }, [searchQuery, selectedMenuType, workspaceMentionIndex])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    setHighlightedIndex(selectedIndex)
  }, [isOpen, searchResults, selectedIndex, selectedMenuType])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }

      if (anchorRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return
      }

      setIsOpen(false)
      setHighlightedIndex(0)
      setSelectedMenuType(null)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const menuElement = menuRef.current
    if (!menuElement) {
      return
    }

    const selectedElement = menuElement.querySelector<HTMLElement>(`[data-mention-index="${highlightedIndex}"]`)
    selectedElement?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex, isOpen, searchResults, selectedMenuType])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    if (value.trim().length === 0 && mentionPathMap.size > 0) {
      setMentionPathMap(new Map())
    }
  }, [isOpen, mentionPathMap.size, value])

  const closeMenu = useCallback(() => {
    setIsOpen(false)
    setSearchQuery('')
    setSelectedIndex(0)
    setHighlightedIndex(0)
    setSelectedMenuType(null)
  }, [])

  useEffect(() => {
    if (!isOpen || isIndexLoading) {
      return
    }

    if (searchQuery.includes(' ') && searchResults.length === 0) {
      closeMenu()
    }
  }, [closeMenu, isIndexLoading, isOpen, searchQuery, searchResults.length])

  const handleSelectCategory = useCallback(
    (nextType: ChatMentionMenuType) => {
      const textarea = textareaRef.current
      const cursorPosition = textarea?.selectionStart ?? value.length
      const { nextCursorPosition, nextValue } = resetTriggerText(value, cursorPosition)

      onValueChange(nextValue)
      setSelectedMenuType(nextType)
      setSearchQuery('')
      setSelectedIndex(0)
      setHighlightedIndex(0)
      setIsOpen(true)

      window.requestAnimationFrame(() => {
        const nextTextarea = textareaRef.current
        if (!nextTextarea) {
          return
        }

        nextTextarea.focus()
        nextTextarea.setSelectionRange(nextCursorPosition, nextCursorPosition)
      })
    },
    [onValueChange, textareaRef, value],
  )

  const updateTriggerState = useCallback(
    (nextValue: string, cursorPosition: number) => {
      if (suppressNextTriggerUpdateRef.current) {
        suppressNextTriggerUpdateRef.current = false
        closeMenu()
        return
      }

      if (disabled) {
        closeMenu()
        return
      }

      if (!workspaceRootPath?.trim()) {
        closeMenu()
        return
      }

      const validationMap = mentionPathMapRef.current.size > 0 ? mentionPathMapRef.current : undefined
      const matches = findChatMentionMatches(nextValue, validationMap)
      const activeMention = matches.find(
        (match) => cursorPosition >= match.start && cursorPosition <= match.end,
      )
      if (activeMention) {
        closeMenu()
        return
      }

      const triggerState = getChatMentionTriggerState(nextValue, cursorPosition, validationMap)
      if (!triggerState) {
        closeMenu()
        return
      }

      setIsOpen(true)
      setSearchQuery(triggerState.query)
      setSelectedIndex(0)
    },
    [closeMenu, disabled, workspaceRootPath],
  )

  const handleValueChange = useCallback(
    (nextValue: string) => {
      onValueChange(nextValue)
      const cursorPosition = textareaRef.current?.selectionStart ?? nextValue.length
      updateTriggerState(nextValue, cursorPosition)
    },
    [onValueChange, textareaRef, updateTriggerState],
  )

  const handleSelectMention = useCallback(
    (item: ChatMentionMenuItem) => {
      const textarea = textareaRef.current
      const cursorPosition = textarea?.selectionStart ?? value.length
      const nextMentionMap = new Map(mentionPathMapRef.current)
      nextMentionMap.set(item.label, item.relativePath)
      mentionPathMapRef.current = nextMentionMap
      setMentionPathMap(nextMentionMap)

      const { nextCursorPosition, nextValue } = insertChatMention(value, cursorPosition, item.label)
      onValueChange(nextValue)
      closeMenu()

      window.requestAnimationFrame(() => {
        const nextTextarea = textareaRef.current
        if (!nextTextarea) {
          return
        }

        nextTextarea.focus()
        nextTextarea.setSelectionRange(nextCursorPosition, nextCursorPosition)
      })
    },
    [closeMenu, onValueChange, textareaRef, value],
  )

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (!isOpen) {
        return false
      }

      const hasSearchQuery = searchQuery.trim().length > 0

      if (event.key === 'Escape') {
        event.preventDefault()
        closeMenu()
        return true
      }

      if (selectedMenuType === null && !hasSearchQuery) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const direction = event.key === 'ArrowDown' ? 1 : -1
          setSelectedIndex((currentValue) => {
            const nextIndex = (currentValue + direction + ROOT_MENU_OPTION_COUNT) % ROOT_MENU_OPTION_COUNT
            setHighlightedIndex(nextIndex)
            return nextIndex
          })
          return true
        }

        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault()
          handleSelectCategory(selectedIndex === 2 ? 'skill' : selectedIndex === 1 ? 'folder' : 'file')
          return true
        }

        return false
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (searchResults.length === 0) {
          return true
        }

        const direction = event.key === 'ArrowDown' ? 1 : -1
        setSelectedIndex((currentValue) => {
          const nextIndex = (currentValue + direction + searchResults.length) % searchResults.length
          setHighlightedIndex(nextIndex)
          return nextIndex
        })
        return true
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        const selectedItem = searchResults[selectedIndex]
        if (!selectedItem) {
          closeMenu()
          return false
        }

        event.preventDefault()
        handleSelectMention(selectedItem)
        return true
      }

      return false
    },
    [closeMenu, handleSelectCategory, handleSelectMention, isOpen, searchQuery, searchResults, selectedIndex, selectedMenuType],
  )

  const handleBlur = useCallback(() => {
    window.setTimeout(() => {
      if (!menuRef.current || document.activeElement === menuRef.current) {
        return
      }

      closeMenu()
    }, 0)
  }, [closeMenu])

  const handleFocus = useCallback(() => {
    const textarea = textareaRef.current
    const cursorPosition = textarea?.selectionStart ?? value.length
    updateTriggerState(value, cursorPosition)
  }, [textareaRef, updateTriggerState, value])

  const expandValueForSend = useCallback(
    (nextValue: string) => expandChatMentions(nextValue, mentionPathMapRef.current),
    [],
  )

  const clearMentionPathMap = useCallback(() => {
    const nextMap = new Map<string, string>()
    mentionPathMapRef.current = nextMap
    setMentionPathMap(nextMap)
  }, [])

  return {
    anchorRef,
    clearMentionPathMap,
    expandValueForSend,
    closeMenu,
    handleBlur,
    handleFocus,
    handleKeyDown,
    handleSelectMention,
    handleSelectCategory,
    handleValueChange,
    markTriggerUpdateSuppressed,
    isIndexLoading,
    isOpen,
    menuRef,
    menuStyle,
    highlightedIndex,
    mentionPathMap,
    mentionPathMapRef,
    selectedMenuType,
    searchQuery,
    selectedIndex,
    searchResults,
    setSelectedIndex,
    setHighlightedIndex,
    updateTriggerState,
    workspaceRootAvailable: Boolean(workspaceRootPath?.trim()),
  }
}
