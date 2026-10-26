import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveHorizontalScrollDelta } from '../common/utils/horizontalScroll.ts'

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
