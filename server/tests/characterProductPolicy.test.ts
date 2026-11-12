import assert from 'node:assert/strict'
import test from 'node:test'
import { Types } from 'mongoose'
import {
  buildMiniProductVisibilityFilter,
  isProductAvailableForCharacterGender,
  isProductListable,
  resolveEffectiveCharacterGender,
} from '../src/services/characterProductPolicy'

test('player gender resolves to the two supported character genders with male fallback', () => {
  assert.equal(resolveEffectiveCharacterGender('male'), 'male')
  assert.equal(resolveEffectiveCharacterGender('female'), 'female')
  assert.equal(resolveEffectiveCharacterGender('other'), 'male')
  assert.equal(resolveEffectiveCharacterGender(undefined), 'male')
  assert.equal(resolveEffectiveCharacterGender('invalid'), 'male')
})

test('character products remain available for internal gender checks', () => {
  assert.equal(
    isProductAvailableForCharacterGender(
      { controllableType: 'character', characterGender: 'male' },
      'male',
    ),
    true,
  )
  assert.equal(
    isProductAvailableForCharacterGender(
      { controllableType: 'character', characterGender: 'female' },
      'male',
    ),
    false,
  )
})

test('character products are never public product-list entries', () => {
  assert.equal(
    isProductListable({ controllableType: 'character', characterGender: 'male' }),
    false,
  )
  assert.equal(
    isProductListable({ controllableType: 'character', characterGender: 'female' }),
    false,
  )
})

test('non-character and legacy unclassified products remain listable', () => {
  assert.equal(isProductListable({ controllableType: 'vehicle' }), true)
  assert.equal(isProductListable({}), true)
})

test('character products without a supported role gender are unavailable', () => {
  assert.equal(
    isProductAvailableForCharacterGender(
      { controllableType: 'character', characterGender: null },
      'female',
    ),
    false,
  )
})

test('catalog visibility contains only categorized non-role products', () => {
  const categoryId = new Types.ObjectId()
  const filter = buildMiniProductVisibilityFilter([categoryId])

  assert.deepEqual(filter, {
    controllableType: { $ne: 'character' },
    categoryId: { $in: [categoryId] },
  })
})
