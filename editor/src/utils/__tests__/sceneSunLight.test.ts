import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { createSceneSunLightRuntime } from '@schema/sceneSunLight'

describe('scene sun light runtime', () => {
  it('adds a non-shadow directional sun and synchronizes its state', () => {
    const scene = new THREE.Scene()
    const runtime = createSceneSunLightRuntime(scene)

    expect(runtime.light.isDirectionalLight).toBe(true)
    expect(runtime.light.castShadow).toBe(false)
    expect(scene.children).toContain(runtime.light)
    expect(scene.children).toContain(runtime.light.target)

    runtime.sync(new THREE.Vector3(0, 1000, 0), 2.5, '#ffcc88')
    expect(runtime.light.position.toArray()).toEqual([0, 1000, 0])
    expect(runtime.light.intensity).toBe(2.5)
    expect(runtime.light.color.getHexString()).toBe('ffcc88')

    runtime.dispose()
    expect(scene.children).not.toContain(runtime.light)
    expect(scene.children).not.toContain(runtime.light.target)
  })
})
