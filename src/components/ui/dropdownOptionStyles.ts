/** Keep the selected surface stable while pointer/keyboard highlight moves. */
export function getDropdownOptionStateClassName(isSelected: boolean, isHighlighted: boolean): string {
  if (isSelected) {
    return 'bg-[var(--dropdown-option-active-surface)] text-foreground'
  }

  return isHighlighted
    ? 'bg-[var(--dropdown-option-hover-surface)] text-foreground'
    : 'text-foreground hover:bg-[var(--dropdown-option-hover-surface)]'
}
