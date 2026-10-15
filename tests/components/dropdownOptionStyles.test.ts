import assert from 'node:assert/strict'
import test from 'node:test'
import { getDropdownOptionStateClassName } from '../../src/components/ui/dropdownOptionStyles'

test('selected option keeps exactly the same appearance regardless of mouse or keyboard highlight', () => {
  const selected = getDropdownOptionStateClassName(true, false)
  const highlightedSelected = getDropdownOptionStateClassName(true, true)

  assert.equal(selected, highlightedSelected)
  assert.match(selected, /bg-\[var\(--dropdown-option-active-surface\)\]/u)
  assert.doesNotMatch(selected, /hover:|shadow-sm|dropdown-option-hover-surface/u)
})

test('unselected option retains hover feedback and keyboard highlight styling', () => {
  const idle = getDropdownOptionStateClassName(false, false)
  const highlighted = getDropdownOptionStateClassName(false, true)

  assert.match(idle, /hover:bg-\[var\(--dropdown-option-hover-surface\)\]/u)
  assert.match(highlighted, /^bg-\[var\(--dropdown-option-hover-surface\)\]/u)
  assert.notEqual(idle, highlighted)
  assert.doesNotMatch(highlighted, /dropdown-option-active-surface/u)
})
