import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeSceneryControllableType,
  resolveSceneryControllableSelection,
} from '../src/utils/sceneryControllableSelection.ts'

test('an explicit character URL is not replaced by a stored vehicle selection', () => {
  const result = resolveSceneryControllableSelection({
    requestedType: 'character',
    requestedIdentifier: '男人',
    storedSelections: {
      vehicle: {
        type: 'vehicle',
        identifier: '越野车',
        prefabUrl: 'vehicle.glb',
      },
    },
  })

  assert.deepEqual(result, {
    type: 'character',
    identifier: '男人',
    selectedAsset: null,
  })
})

test('a matching stored actor keeps its prefab while the URL identifier wins', () => {
  const character = {
    type: 'character' as const,
    identifier: '男人',
    prefabUrl: 'character.glb',
  }
  const result = resolveSceneryControllableSelection({
    requestedType: 'character',
    requestedIdentifier: '男人',
    storedSelections: { character },
  })

  assert.equal(result.type, 'character')
  assert.equal(result.identifier, '男人')
  assert.equal(result.selectedAsset, character)
})

test('a stale stored actor of the same type is not paired with another URL identifier', () => {
  const result = resolveSceneryControllableSelection({
    requestedType: 'character',
    requestedIdentifier: '男人',
    storedSelections: {
      character: {
        type: 'character',
        identifier: '女人',
        prefabUrl: 'other-character.glb',
      },
    },
  })

  assert.equal(result.type, 'character')
  assert.equal(result.identifier, '男人')
  assert.equal(result.selectedAsset, null)
})

test('without URL controls, the first stored actor keeps the legacy fallback order', () => {
  const vehicle = {
    type: 'vehicle' as const,
    identifier: '越野车',
    prefabUrl: 'vehicle.glb',
  }
  const result = resolveSceneryControllableSelection({
    requestedType: null,
    storedSelections: {
      vehicle,
      character: {
        type: 'character',
        identifier: '男人',
        prefabUrl: 'character.glb',
      },
    },
  })

  assert.equal(result.type, 'vehicle')
  assert.equal(result.identifier, '越野车')
  assert.equal(result.selectedAsset, vehicle)
})

test('invalid and missing URL types default to vehicle', () => {
  assert.equal(normalizeSceneryControllableType(' CHARACTER '), 'character')
  assert.equal(normalizeSceneryControllableType('unknown'), null)
  assert.deepEqual(resolveSceneryControllableSelection({
    requestedType: 'unknown',
    storedSelections: {},
  }), {
    type: 'vehicle',
    identifier: '',
    selectedAsset: null,
  })
})
