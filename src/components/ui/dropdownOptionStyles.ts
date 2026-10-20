/** Keep the active surface on the highlighted option; selection remains indicated separately. */
export function getDropdownOptionStateClassName(isHighlighted: boolean): string {
  if (isHighlighted) {
    return 'bg-[var(--dropdown-option-active-surface)] text-foreground shadow-sm'
  }

  return 'text-foreground hover:bg-[var(--dropdown-option-active-surface)]'
}
