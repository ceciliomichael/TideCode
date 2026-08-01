import type { ToolSet } from 'ai'

export function sortToolSet(tools: ToolSet): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).sort(([leftName], [rightName]) => leftName.localeCompare(rightName)),
  ) as ToolSet
}
