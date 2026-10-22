import { describe, expect, it } from 'vitest'
import type { SceneAssetServerEntry, SceneJsonExportDocument } from '@schema/core'
import { mergeRuntimePrefabAssetRegistry } from '@schema/runtimePrefabAssetRegistry'

function createAsset(url: string): SceneAssetServerEntry {
  return {
    sourceType: 'server',
    fileKey: url.split('/').pop() ?? null,
    resolvedUrl: url,
    assetType: 'model',
  }
}

function createDocument(
  assetRegistry: Record<string, SceneAssetServerEntry> = {},
): SceneJsonExportDocument {
  return {
    id: 'scene',
    nodes: [],
    assetRegistry,
  } as unknown as SceneJsonExportDocument
}

describe('mergeRuntimePrefabAssetRegistry', () => {
  it('keeps the scene document unchanged when the prefab has no registry entries', () => {
    const document = createDocument({ existing: createAsset('https://cdn.example/existing.glb') })

    const result = mergeRuntimePrefabAssetRegistry(document, null)

    expect(result).toBe(document)
    expect(Object.keys(document.assetRegistry ?? {})).toEqual(['existing'])
  })

  it('preserves scene entries and adds the prefab assets', () => {
    const document = createDocument({ existing: createAsset('https://cdn.example/existing.glb') })

    mergeRuntimePrefabAssetRegistry(document, {
      assetRegistry: {
        body: createAsset('https://cdn.example/body.glb'),
        wheel: createAsset('https://cdn.example/wheel.glb'),
      },
    })

    expect(Object.keys(document.assetRegistry ?? {}).sort()).toEqual(['body', 'existing', 'wheel'])
  })

  it('uses the prefab entry when both documents contain the same asset key', () => {
    const document = createDocument({ shared: createAsset('https://cdn.example/old.glb') })

    mergeRuntimePrefabAssetRegistry(document, {
      assetRegistry: {
        shared: createAsset('https://cdn.example/new.glb'),
      },
    })

    const shared = document.assetRegistry?.shared
    expect(shared?.sourceType).toBe('server')
    if (shared?.sourceType === 'server') {
      expect(shared.resolvedUrl).toBe('https://cdn.example/new.glb')
    }
  })
})
