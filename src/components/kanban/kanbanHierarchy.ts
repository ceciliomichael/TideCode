import type { DropdownOption } from '../ui/DropdownField'
import { KANBAN_COLUMNS } from './kanbanDefaults'
import type { KanbanCard, KanbanColumnId } from './kanbanTypes'

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

function createEmptyColumnCardMap() {
  return KANBAN_COLUMNS.reduce(
    (accumulator, column) => {
      accumulator[column.id] = []
      return accumulator
    },
    {} as Record<KanbanColumnId, KanbanCard[]>,
  )
}

export function buildKanbanBoardDisplayData(cards: readonly KanbanCard[]): KanbanBoardDisplayData {
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
    const cardsInColumn = cards.filter((card) => card.columnId === column.id)
    const topLevelCards = cardsInColumn.filter((card) => card.parentCardId === undefined)
    const childCardsInColumn = cardsInColumn.filter((card) => card.parentCardId !== undefined)
    const appendedCardIds = new Set<string>()

    for (const card of topLevelCards) {
      orderedCardsByColumn[column.id].push(card)
      appendedCardIds.add(card.id)

      for (const childCard of childCardsByParentId.get(card.id) ?? []) {
        if (childCard.columnId !== column.id) {
          continue
        }

        orderedCardsByColumn[column.id].push(childCard)
        appendedCardIds.add(childCard.id)
      }
    }

    for (const card of childCardsInColumn) {
      if (!appendedCardIds.has(card.id)) {
        orderedCardsByColumn[column.id].push(card)
      }
    }
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
