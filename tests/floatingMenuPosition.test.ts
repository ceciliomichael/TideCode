import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveFloatingMenuCenteredLeft,
  resolveFloatingMenuHorizontalPlacement,
  resolveFloatingMenuPlacement,
  resolveFloatingMenuPointPosition,
  resolveFloatingMenuSideTop,
} from '../src/hooks/useFloatingMenuPosition'

test('centered floating menus align to the anchor and clamp to viewport margins', () => {
  assert.equal(resolveFloatingMenuCenteredLeft({
    anchorLeft: 100,
    anchorWidth: 300,
    menuWidth: 200,
    minLeft: 8,
    maxLeft: 792,
  }), 150)

  assert.equal(resolveFloatingMenuCenteredLeft({
    anchorLeft: 10,
    anchorWidth: 100,
    menuWidth: 240,
    minLeft: 8,
    maxLeft: 792,
  }), 8)
})

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

test('horizontal floating menus keep the preferred side when it has enough room', () => {
  assert.equal(resolveFloatingMenuHorizontalPlacement({
    availableLeft: 240,
    availableRight: 220,
    menuWidth: 180,
    preferredPlacement: 'right',
  }), 'right')
})

test('horizontal floating menus flip left when the right side cannot fit', () => {
  assert.equal(resolveFloatingMenuHorizontalPlacement({
    availableLeft: 260,
    availableRight: 120,
    menuWidth: 180,
    preferredPlacement: 'right',
  }), 'left')
})

test('pointer menus open at the click position and clamp to viewport margins', () => {
  const viewport = {
    menuHeight: 90,
    menuWidth: 180,
    minViewportMargin: 8,
    viewportBottom: 600,
    viewportLeft: 0,
    viewportRight: 800,
    viewportTop: 0,
  }

  assert.deepEqual(resolveFloatingMenuPointPosition({
    ...viewport,
    pointX: 120,
    pointY: 80,
  }), {
    left: 120,
    top: 80,
  })
  assert.deepEqual(resolveFloatingMenuPointPosition({
    ...viewport,
    pointX: 790,
    pointY: 590,
  }), {
    left: 612,
    top: 502,
  })
})

test('side menus align near the clicked button and open upward near the viewport edge', () => {
  assert.equal(resolveFloatingMenuSideTop({
    anchorBottom: 356,
    anchorTop: 320,
    maxTop: 292,
    menuHeight: 100,
    minTop: 8,
  }), 256)
})
