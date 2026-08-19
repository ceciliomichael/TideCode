import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveFloatingMenuPlacement } from '../src/hooks/useFloatingMenuPosition'

test('floating menus keep the preferred side when it has enough room', () => {
  assert.equal(resolveFloatingMenuPlacement({
    availableAbove: 220,
    availableBelow: 320,
    menuHeight: 180,
    preferredPlacement: 'above',
  }), 'above')
})

test('floating menus flip below when above cannot fit and below has more room', () => {
  assert.equal(resolveFloatingMenuPlacement({
    availableAbove: 90,
    availableBelow: 210,
    menuHeight: 180,
    preferredPlacement: 'above',
  }), 'below')
})

test('floating menus choose the roomier side when neither side can fully fit', () => {
  assert.equal(resolveFloatingMenuPlacement({
    availableAbove: 140,
    availableBelow: 80,
    menuHeight: 220,
    preferredPlacement: 'below',
  }), 'above')
})
