export function cycleSelectionSectionIndex(currentIndex: number, direction: -1 | 1, sectionCount: number): number {
  if (sectionCount <= 0) return 0
  return (currentIndex + direction + sectionCount) % sectionCount
}
