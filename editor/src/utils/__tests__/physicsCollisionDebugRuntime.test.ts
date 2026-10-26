import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { createGroundCollisionRuntimeBridgeDeps } from '@schema/groundCollisionRuntimeBridge'
import {
  DEFAULT_PHYSICS_COLLISION_DEBUG_VISIBLE,
  PHYSICS_COLLISION_DEBUG_COLORS,
  ScenePreviewPhysicsCollisionDebugRuntime,
  resolvePhysicsCollisionDebugCategory,
} from '@/physics/collisionDebugRuntime'

describe('physics collision debug runtime', () => {
  it('defaults to hidden because full terrain collision wireframes are expensive', () => {
    const runtime = new ScenePreviewPhysicsCollisionDebugRuntime()

    expect(DEFAULT_PHYSICS_COLLISION_DEBUG_VISIBLE).toBe(false)
    expect(runtime.root.visible).toBe(false)
    runtime.destroy()
  })

  it('can be toggled on and off explicitly', () => {
    const runtime = new ScenePreviewPhysicsCollisionDebugRuntime()

    runtime.setVisible(true)
    expect(runtime.root.visible).toBe(true)

    runtime.setVisible(false)
    expect(runtime.root.visible).toBe(false)
    runtime.destroy()
  })

  it('classifies collision bodies by their owning source', () => {
    const cases = [
      ['terrain-collision:terrain:ground-patch:0', 'groundPatch'],
      ['terrain-collision:terrain:roadbed:12:18:roadbed:4', 'roadbed'],
      ['terrain-collision:terrain:dem-terrain:12:18:dem-terrain:4', 'demTerrain'],
      ['terrain-collision:terrain:mesh:wall', 'other'],
      ['infinite-ground:terrain:box:12:18', 'baseGround'],
      ['compiled-ground:terrain:tile-r0-c0', 'baseGround'],
      ['road-collision:road:curve:0:tile:1', 'other'],
    ] as const

    cases.forEach(([name, expected]) => {
      expect(resolvePhysicsCollisionDebugCategory({ name })).toBe(expected)
    })
  })

  it('keeps the legend colors aligned with the debug material colors', () => {
    expect(PHYSICS_COLLISION_DEBUG_COLORS).toEqual({
      groundPatch: '#22ff88',
      roadbed: '#ff9f1c',
      baseGround: '#38bdf8',
      demTerrain: '#4ea1ff',
      other: '#cbd5e1',
    })
  })

  it('propagates collision body names into the physics runtime descriptor', () => {
    let nextRuntimeId = 1
    const deps = createGroundCollisionRuntimeBridgeDeps({
      enabled: true,
      sceneLoaded: true,
      getPhysicsBridge: () => null,
      runtimeBodyIds: new Set<number>(),
      nextRuntimeId: () => nextRuntimeId++,
      enqueueMutation: () => {},
    })
    const bodyName = 'terrain-collision:terrain:ground-patch:0'
    const result = deps?.createBody(null, null, {
      kind: 'static-mesh',
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
    }, new THREE.Object3D(), bodyName)
    const entry = (result?.body as unknown as {
      __runtimeBodyEntry?: { body?: { name?: string } }
    } | null)?.__runtimeBodyEntry

    expect(entry?.body?.name).toBe(bodyName)
  })
})
