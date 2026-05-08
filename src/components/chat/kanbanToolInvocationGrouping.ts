function pluralize(count: number, singular: string) {
  if (count === 1) {
    return `${count} ${singular}`
  }

  return `${count} ${singular}s`
}

export function buildKanbanToolInvocationGroupSummary(count: number) {
  return `ran ${pluralize(count, 'kanban tool')}`
}
