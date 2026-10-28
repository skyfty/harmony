import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveHorizontalDragScrollLeft,
  resolveHorizontalScrollDelta,
} from '../common/utils/horizontalScroll.ts'

test('vertical mouse wheel scrolls the waypoint strip horizontally', () => {
  assert.equal(resolveHorizontalScrollDelta({
    deltaMode: 0,
    deltaX: 0,
    deltaY: 120,
    viewportWidth: 360,
  }), 120)
})

test('trackpad horizontal intent wins over vertical wheel noise', () => {
  assert.equal(resolveHorizontalScrollDelta({
    deltaMode: 0,
    deltaX: -80,
    deltaY: 12,
    viewportWidth: 360,
  }), -80)
})

test('line and page wheel modes are normalized to usable horizontal pixels', () => {
  assert.equal(resolveHorizontalScrollDelta({
    deltaMode: 1,
    deltaX: 0,
    deltaY: 3,
    viewportWidth: 360,
  }), 48)
  assert.equal(resolveHorizontalScrollDelta({
    deltaMode: 2,
    deltaX: 0,
    deltaY: -1,
    viewportWidth: 360,
  }), -360)
})

test('dragging the strip left moves its content right', () => {
  assert.equal(resolveHorizontalDragScrollLeft({
    startScrollLeft: 40,
    startX: 200,
    currentX: 120,
    maxScrollLeft: 600,
  }), 120)
})

test('dragging the strip clamps scroll position to its real bounds', () => {
  assert.equal(resolveHorizontalDragScrollLeft({
    startScrollLeft: 10,
    startX: 40,
    currentX: 160,
    maxScrollLeft: 600,
  }), 0)
  assert.equal(resolveHorizontalDragScrollLeft({
    startScrollLeft: 590,
    startX: 160,
    currentX: 40,
    maxScrollLeft: 600,
  }), 600)
})
