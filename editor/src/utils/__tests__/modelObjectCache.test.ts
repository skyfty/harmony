import {
  AnimationClip,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
} from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getOrLoadModelObject,
  invalidateModelObject,
} from '@schema/modelObjectCache'

const loadedAssetIds = new Set<string>()

afterEach(() => {
  loadedAssetIds.forEach((assetId) => invalidateModelObject(assetId))
  loadedAssetIds.clear()
})

async function loadGroup(assetId: string, object: Group) {
  loadedAssetIds.add(assetId)
  return getOrLoadModelObject(assetId, async () => object)
}

describe('model object cache instancing eligibility', () => {
  it('keeps a static mesh on the instanced path', async () => {
    const root = new Group()
    root.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()))

    const group = await loadGroup('static-model', root)

    expect(group.staticInstancingEligible).toBe(true)
    expect(group.hasSkinnedMesh).toBe(false)
    expect(group.hasAnimations).toBe(false)
    expect(group.meshes).toHaveLength(1)
  })

  it('keeps a skinned mesh on the real object path', async () => {
    const root = new Group()
    const skinnedMesh = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshBasicMaterial(),
    )
    ;(skinnedMesh as Mesh & { isSkinnedMesh: boolean }).isSkinnedMesh = true
    root.add(skinnedMesh)

    const group = await loadGroup('skinned-model', root)

    expect(group.staticInstancingEligible).toBe(false)
    expect(group.hasSkinnedMesh).toBe(true)
    expect(group.hasAnimations).toBe(false)
    expect(group.meshes).toHaveLength(0)
  })

  it('keeps an animated model on the real object path and exposes clip names', async () => {
    const root = new Group()
    ;(root as Group & { animations?: AnimationClip[] }).animations = [
      new AnimationClip('Action', 1, []),
    ]
    root.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()))

    const group = await loadGroup('animated-model', root)

    expect(group.staticInstancingEligible).toBe(false)
    expect(group.hasSkinnedMesh).toBe(false)
    expect(group.hasAnimations).toBe(true)
    expect(group.animationClipNames).toEqual(['Action'])
    expect(group.meshes).toHaveLength(0)
  })
})
