import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PHYSICS_COLLISION_DEBUG_VISIBLE,
  ScenePreviewPhysicsCollisionDebugRuntime,
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
})
