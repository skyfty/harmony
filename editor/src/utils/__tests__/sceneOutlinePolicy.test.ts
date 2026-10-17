import { describe, expect, it } from 'vitest'
import type { SceneNode } from '@schema/core'
import { createDefaultProceduralLandscapeProps } from '@schema/proceduralLandscape/config'
import {
  isDemTerrainSceneNode,
  shouldAttemptOutlineAssetLoad,
  shouldGenerateOutlineMeshForNode,
} from '@/utils/sceneOutlinePolicy'

function makeNode(overrides: Partial<SceneNode> = {}): SceneNode {
  return {
    id: 'node-1',
    name: 'Node 1',
    nodeType: 'Group',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    ...overrides,
  }
}

describe('scene outline policy', () => {
  it('excludes DEM terrain nodes marked in userData from outline generation', () => {
    const node = makeNode({
      sourceAssetId: 'dem-json-asset',
      userData: { proceduralLandscapeDem: true },
    })

    expect(isDemTerrainSceneNode(node)).toBe(true)
    expect(shouldGenerateOutlineMeshForNode(node, { lazyLoadMeshes: true })).toBe(false)
  })

  it('excludes DEM terrain components even when the legacy userData marker is absent', () => {
    const props = createDefaultProceduralLandscapeProps({ id: 'node-1' })
    props.dem = {
      ...props.dem,
      assetId: 'dem-json-asset',
      runtimeGridUrl: 'https://assets.example.com/terrain/dem-grid.bin',
    }
    const node = makeNode({
      sourceAssetId: 'dem-json-asset',
      components: {
        proceduralLandscape: {
          id: 'landscape-component',
          type: 'proceduralLandscape',
          enabled: true,
          props,
        },
      },
    })

    expect(isDemTerrainSceneNode(node)).toBe(true)
    expect(shouldGenerateOutlineMeshForNode(node, { lazyLoadMeshes: true })).toBe(false)
  })

  it('keeps ordinary model nodes eligible for outline generation', () => {
    const node = makeNode({ sourceAssetId: 'model-asset' })

    expect(shouldGenerateOutlineMeshForNode(node, { lazyLoadMeshes: true })).toBe(true)
  })

  it('only attempts outline loads for model or unknown extension assets', () => {
    expect(shouldAttemptOutlineAssetLoad({ extension: 'glb' })).toBe(true)
    expect(shouldAttemptOutlineAssetLoad({ extension: 'gltf' })).toBe(true)
    expect(shouldAttemptOutlineAssetLoad({ extension: 'fbx' })).toBe(true)
    expect(shouldAttemptOutlineAssetLoad({ extension: 'json' })).toBe(false)
    expect(shouldAttemptOutlineAssetLoad({ extension: 'prefab' })).toBe(false)
    expect(shouldAttemptOutlineAssetLoad({ downloadUrl: 'https://assets.example.com/dem.json' })).toBe(false)
    expect(shouldAttemptOutlineAssetLoad({})).toBe(true)
  })
})
