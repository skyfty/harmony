import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveFloorShape, resolveRegionShape, MIN_PLANAR_COLLISION_THICKNESS } from '../physicsShapeResolvers'

test('builds a thin floor collider when thickness is zero', () => {
  const result = resolveFloorShape(
    { id: 'floor-test' } as any,
    {
      type: 'Floor',
      vertices: [[0, 0], [10, 0], [10, 10], [0, 10]],
      smooth: 0,
      thickness: 0,
    } as any,
    new Map(),
  )

  assert.ok(result)
  assert.ok(result.segments.length > 0)
  const shape = result.segments[0]!.shape
  assert.equal(shape.vertices[3]![1] - shape.vertices[0]![1], MIN_PLANAR_COLLISION_THICKNESS)
})

test('builds a thin collider from a region polygon', () => {
  const result = resolveRegionShape(
    { id: 'region-test' } as any,
    {
      type: 'Region',
      vertices: [[0, 0], [10, 0], [10, 10], [0, 10]],
    },
    new Map(),
  )

  assert.ok(result)
  assert.ok(result.segments.length > 0)
  const shape = result.segments[0]!.shape
  assert.equal(shape.vertices[3]![1] - shape.vertices[0]![1], MIN_PLANAR_COLLISION_THICKNESS)
})

test('does not build a collider for an invalid region polygon', () => {
  const result = resolveRegionShape(
    { id: 'invalid-region-test' } as any,
    { type: 'Region', vertices: [[0, 0], [1, 1]] },
    new Map(),
  )

  assert.equal(result, null)
})
