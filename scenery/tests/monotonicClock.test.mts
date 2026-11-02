import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveMonotonicNowMs } from '../common/utils/monotonicClock.ts'

test('falls back to wall-clock time when performance is unavailable', () => {
  assert.equal(resolveMonotonicNowMs(null, () => 1234), 1234)
})

test('uses the monotonic performance clock when it returns a finite timestamp', () => {
  assert.equal(resolveMonotonicNowMs({ now: () => 42.5 }, () => 1234), 42.5)
})

test('falls back when the performance clock is invalid or throws', () => {
  assert.equal(resolveMonotonicNowMs({ now: () => Number.NaN }, () => 1234), 1234)
  assert.equal(resolveMonotonicNowMs({
    now: () => {
      throw new Error('clock unavailable')
    },
  }, () => 5678), 5678)
})
