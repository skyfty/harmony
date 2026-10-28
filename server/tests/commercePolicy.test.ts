import assert from 'node:assert/strict'
import test from 'node:test'
import { isFreeOrderRecord, isFreeProductPrice, isZeroAmount } from '../src/utils/commerce'

test('zero-priced products use the free acquisition path', () => {
  assert.equal(isFreeProductPrice(0), true)
  assert.equal(isFreeProductPrice('0'), true)
  assert.equal(isFreeProductPrice(0.01), false)
  assert.equal(isFreeProductPrice(Number.NaN), false)
})

test('zero-amount and explicitly free orders are treated as non-payable acquisitions', () => {
  assert.equal(isFreeOrderRecord({ totalAmount: 0, paymentProvider: undefined }), true)
  assert.equal(isFreeOrderRecord({ totalAmount: 10, paymentProvider: 'free' }), true)
  assert.equal(isFreeOrderRecord({ totalAmount: 0.01, paymentProvider: 'wechat' }), false)
})

test('invalid amounts never qualify as free transactions', () => {
  assert.equal(isZeroAmount(undefined), false)
  assert.equal(isZeroAmount(null), false)
  assert.equal(isZeroAmount(''), false)
  assert.equal(isZeroAmount('not-a-number'), false)
})
