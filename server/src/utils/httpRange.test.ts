import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSingleByteRange } from './httpRange'

test('parses bounded and open-ended byte ranges', () => {
  assert.deepEqual(parseSingleByteRange('bytes=2-5', 10), { start: 2, end: 5 })
  assert.deepEqual(parseSingleByteRange('bytes=7-', 10), { start: 7, end: 9 })
})

test('parses suffix ranges and clamps their start', () => {
  assert.deepEqual(parseSingleByteRange('bytes=-3', 10), { start: 7, end: 9 })
  assert.deepEqual(parseSingleByteRange('bytes=-20', 10), { start: 0, end: 9 })
})

test('returns null for a full response and rejects invalid or unsatisfiable ranges', () => {
  assert.equal(parseSingleByteRange(undefined, 10), null)
  assert.equal(parseSingleByteRange('bytes=0-0,2-3', 10), 'invalid')
  assert.equal(parseSingleByteRange('bytes=10-', 10), 'invalid')
  assert.equal(parseSingleByteRange('bytes=4-2', 10), 'invalid')
  assert.equal(parseSingleByteRange('bytes=-0', 10), 'invalid')
  assert.equal(parseSingleByteRange('bytes=0-0', 0), 'invalid')
  assert.deepEqual(parseSingleByteRange('bytes=0-0 ', 10), { start: 0, end: 0 })
})

