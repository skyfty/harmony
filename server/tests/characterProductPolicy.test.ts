import assert from 'node:assert/strict'
import test from 'node:test'
import { Types } from 'mongoose'
import {
  buildMiniProductVisibilityFilter,
  isProductAvailableForCharacterGender,
  resolveEffectiveCharacterGender,
} from '../src/services/characterProductPolicy'

test('player gender resolves to the two supported character genders with male fallback', () => {
  assert.equal(resolveEffectiveCharacterGender('male'), 'male')
  assert.equal(resolveEffectiveCharacterGender('female'), 'female')
  assert.equal(resolveEffectiveCharacterGender('other'), 'male')
  assert.equal(resolveEffectiveCharacterGender(undefined), 'male')
  assert.equal(resolveEffectiveCharacterGender('invalid'), 'male')
})

test('character products are visible only to the matching effective gender', () => {
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

test('non-character and legacy unclassified products remain gender-neutral', () => {
  assert.equal(
    isProductAvailableForCharacterGender({ controllableType: 'vehicle' }, 'female'),
    true,
  )
  assert.equal(isProductAvailableForCharacterGender({}, 'male'), true)
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

test('catalog visibility combines the matching role with categorized non-role products', () => {
  const categoryId = new Types.ObjectId()
  const filter = buildMiniProductVisibilityFilter('female', [categoryId]) as {
    $or: Array<Record<string, unknown>>
  }

  assert.deepEqual(filter.$or[0], {
    controllableType: 'character',
    characterGender: 'female',
  })
  assert.deepEqual(filter.$or[1], {
    controllableType: { $ne: 'character' },
    categoryId: { $in: [categoryId] },
  })
})
