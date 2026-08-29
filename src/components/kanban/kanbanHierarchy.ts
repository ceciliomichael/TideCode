import type { DropdownOption } from '../ui/DropdownField'
import { KANBAN_COLUMNS } from './kanbanDefaults'
import { doesKanbanCardMatchQuery } from './kanbanPresentation'
import type { KanbanCard, KanbanColumnId, KanbanPriority } from './kanbanTypes'

export interface KanbanCardDisplayMeta {
  childCount: number
  doneChildCount: number
  isChild: boolean
  parentTitle: string | undefined
}

export interface KanbanBoardDisplayData {
  cardMetaById: Map<string, KanbanCardDisplayMeta>
  orderedCardsByColumn: Record<KanbanColumnId, KanbanCard[]>
}

interface KanbanBoardDisplayFilters {
  priority: KanbanPriority | 'all'
  query: string
}

function createEmptyColumnCardMap() {
  return KANBAN_COLUMNS.reduce(
    (accumulator, column) => {
      accumulator[column.id] = []
      return accumulator
    },
    {} as Record<KanbanColumnId, KanbanCard[]>,
  )
}

export function buildKanbanBoardDisplayData(
  cards: readonly KanbanCard[],
  filters: KanbanBoardDisplayFilters = { priority: 'all', query: '' },
): KanbanBoardDisplayData {
  const cardsById = new Map(cards.map((card) => [card.id, card] as const))
  const childCardsByParentId = new Map<string, KanbanCard[]>()

  for (const card of cards) {
    if (!card.parentCardId) {
      continue
    }

    const nextChildren = childCardsByParentId.get(card.parentCardId) ?? []
    nextChildren.push(card)
    childCardsByParentId.set(card.parentCardId, nextChildren)
  }

  const cardMetaById = new Map<string, KanbanCardDisplayMeta>()
  for (const card of cards) {
    const directChildren = childCardsByParentId.get(card.id) ?? []
    const doneChildCount = directChildren.filter((child) => child.columnId === 'done').length
    cardMetaById.set(card.id, {
      childCount: directChildren.length,
      doneChildCount,
      isChild: card.parentCardId !== undefined,
      parentTitle: card.parentCardId ? cardsById.get(card.parentCardId)?.title : undefined,
    })
  }

  const orderedCardsByColumn = createEmptyColumnCardMap()
  for (const column of KANBAN_COLUMNS) {
    const cardsInColumn = cards
      .filter((card) => card.parentCardId === undefined)
      .filter((card) => card.columnId === column.id)
      .filter((card) => filters.priority === 'all' || card.priority === filters.priority)
      .filter((card) => {
        if (doesKanbanCardMatchQuery(card, filters.query)) {
          return true
        }
        return (childCardsByParentId.get(card.id) ?? []).some((child) =>
          doesKanbanCardMatchQuery(child, filters.query),
        )
      })
      .sort((left, right) => left.position - right.position || left.createdAt - right.createdAt)
    orderedCardsByColumn[column.id].push(...cardsInColumn)
  }

  return {
    cardMetaById,
    orderedCardsByColumn,
  }
}

export function getKanbanParentCardOptions(cards: readonly KanbanCard[], currentCardId?: string): readonly DropdownOption[] {
  return cards
    .filter((card) => card.parentCardId === undefined)
    .filter((card) => card.id !== currentCardId)
    .map((card) => {
      const columnTitle = KANBAN_COLUMNS.find((column) => column.id === card.columnId)?.title
      return {
        label: columnTitle ? `${card.title} · ${columnTitle}` : card.title,
        value: card.id,
      }
    })
}
