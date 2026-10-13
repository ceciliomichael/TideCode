import type { GitHistoryEntry } from '../../types/chat'

const GRAPH_LANE_COLORS = ['#FFB000', '#DC267F', '#994F00', '#40B0A6', '#B66DFF', '#4ea1ff'] as const
const SWIMLANE_WIDTH = 11

function rot(index: number, total: number) {
  return ((index % total) + total) % total
}

export interface GraphNode {
  id: string
  color: string
}

export interface HistoryItemViewModel {
  entry: GitHistoryEntry
  inputSwimlanes: GraphNode[]
  outputSwimlanes: GraphNode[]
  kind: 'HEAD' | 'node'
}

export function computeSwimlanes(entries: GitHistoryEntry[]): HistoryItemViewModel[] {
  let colorIndex = -1
  const viewModels: HistoryItemViewModel[] = []

  for (const entry of entries) {
    const kind: 'HEAD' | 'node' = entry.isHead ? 'HEAD' : 'node'
    const inputSwimlanes = (viewModels.at(-1)?.outputSwimlanes ?? []).map((node) => ({ ...node }))
    const activeIndex = inputSwimlanes.findIndex((node) => node.id === entry.hash)
    const activeColor = activeIndex === -1 ? null : inputSwimlanes[activeIndex].color
    const outputSwimlanes = inputSwimlanes.filter((node) => node.id !== entry.hash)

    for (const [parentIndex, parentId] of entry.parentIds.entries()) {
      // A parent may already be on another lane (notably for Git stash commits).
      // Reuse that lane instead of drawing two independent copies of the same commit.
      if (outputSwimlanes.some((node) => node.id === parentId)) {
        continue
      }

      let color: string
      if (parentIndex === 0 && activeColor !== null) {
        color = activeColor
      } else {
        colorIndex = rot(colorIndex + 1, GRAPH_LANE_COLORS.length)
        color = GRAPH_LANE_COLORS[colorIndex]
      }

      const nextNode = { id: parentId, color }
      if (parentIndex === 0 && activeIndex !== -1) {
        outputSwimlanes.splice(activeIndex, 0, nextNode)
      } else {
        outputSwimlanes.push(nextNode)
      }
    }

    viewModels.push({ entry, kind, inputSwimlanes, outputSwimlanes })
  }

  return viewModels
}

export function getSwimlaneIndentPx(columns: number) {
  return Math.max(24, Math.max(1, columns) * SWIMLANE_WIDTH + 8)
}
