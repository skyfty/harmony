import { describe, expect, it, vi } from 'vitest'
import { resolveSceneNodeMaterialSlots } from '@schema/material'
import type { SceneNodeMaterial } from '@schema/core'

function createMaterial(): SceneNodeMaterial {
  return {
    id: 'slot-1',
    type: 'MeshStandardMaterial',
    color: '#ffffff',
    transparent: false,
    opacity: 1,
    side: 'front',
    wireframe: false,
    metalness: 0.1,
    roughness: 0.8,
    emissive: '#000000',
    emissiveIntensity: 0,
    aoStrength: 1,
    envMapIntensity: 1,
    textures: { albedo: { assetId: 'default-texture' } },
    deviceProfileId: null,
  }
}

describe('device-specific material slot selection', () => {
  it('selects exactly one material slot assigned to the active profile', () => {
    const fallback = createMaterial()
    const low = { ...createMaterial(), id: 'slot-low', deviceProfileId: 'profile-low', color: '#ff0000' }
    const high = { ...createMaterial(), id: 'slot-high', deviceProfileId: 'profile-high', color: '#00ff00' }

    expect(resolveSceneNodeMaterialSlots([fallback, low, high], 'profile-low')).toEqual([low])
    expect(resolveSceneNodeMaterialSlots([fallback, low, high], 'profile-high')).toEqual([high])
  })

  it('uses the unassigned fallback slot when no profile matches', () => {
    const fallback = createMaterial()
    const low = { ...createMaterial(), id: 'slot-low', deviceProfileId: 'profile-low' }

    expect(resolveSceneNodeMaterialSlots([fallback, low], null)).toEqual([fallback])
    expect(resolveSceneNodeMaterialSlots([fallback, low], 'unknown')).toEqual([fallback])
  })

  it('uses the first slot defensively when an alternative set has no fallback', () => {
    const first = { ...createMaterial(), id: 'slot-first', deviceProfileId: 'profile-low' }
    const second = { ...createMaterial(), id: 'slot-second', deviceProfileId: 'profile-high' }
    const warn = vi.fn()

    expect(resolveSceneNodeMaterialSlots([first, second], 'unknown', warn)).toEqual([first])
    expect(warn).toHaveBeenCalledOnce()
  })

  it('preserves every slot for ordinary multi-material groups', () => {
    const first = createMaterial()
    const second = { ...createMaterial(), id: 'slot-2' }

    expect(resolveSceneNodeMaterialSlots([first, second], 'profile-low')).toEqual([first, second])
  })

  it('chooses the first matching slot and reports legacy duplicate profile assignments', () => {
    const first = { ...createMaterial(), id: 'slot-first', deviceProfileId: 'profile-low' }
    const second = { ...createMaterial(), id: 'slot-second', deviceProfileId: 'profile-low' }
    const warn = vi.fn()

    expect(resolveSceneNodeMaterialSlots([first, second], 'profile-low', warn)).toEqual([first])
    expect(warn).toHaveBeenCalledOnce()
  })
})
