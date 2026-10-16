/**
 * Publish/library rules for terrain resource packs: geometry packs must keep
 * their server URL (runtime texture streaming resolves `textures/*` next to
 * `scene.glb`), DEM packs must be selectable from the resource library.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ProjectAsset } from '@/types/project-asset'
import {
  applyTerrainPackExternalRegistryEntries,
  buildTerrainPackExternalRegistryEntry,
  isTerrainGeometryPackAsset,
  resolveTerrainPackExternalAssetUrl,
  shouldSkipTerrainPackEmbedding,
} from '@/utils/terrainPackPublish'
import {
  isTerrainDemPackAsset,
  loadTerrainDemPackFileFromAsset,
  readTerrainDemPackSummary,
} from '@/utils/terrainPackLibrary'

const SERVER_BASE = 'https://assets.example.com/uploads/'

beforeAll(() => {
  // Pin the runtime download base so URL resolution is deterministic in tests.
  vi.stubGlobal('window', {
    __HARMONY_RUNTIME_CONFIG__: {
      serverDownloadBaseUrl: SERVER_BASE.replace(/\/$/, ''),
    },
  })
})

function createAsset(overrides: Partial<ProjectAsset> = {}): ProjectAsset {
  return {
    id: 'asset-1',
    name: 'terrain-29.64396-91.11584',
    type: 'model',
    downloadUrl: `${SERVER_BASE}terrain-abc/scene.glb`,
    fileKey: 'terrain-abc/scene.glb',
    previewColor: '#26c6da',
    gleaned: false,
    metadata: {
      terrainPack: {
        version: 1,
        kind: 'geometry',
        packKey: 'terrain-abc',
        sourceZipName: 'terrain-29.64396-91.11584.zip',
        sourceZipHash: 'deadbeef',
        sourceZipHashAlgorithm: 'sha256',
        glbFile: 'scene.glb',
        manifestFile: 'textures.json',
      },
    },
    ...overrides,
  } as ProjectAsset
}

function createDemAsset(): ProjectAsset {
  return createAsset({
    id: 'asset-dem',
    name: 'terrain-dem-29.64396-91.11584',
    type: 'file',
    downloadUrl: `${SERVER_BASE}terrain-def/terrain-dem.zip`,
    fileKey: 'terrain-def/terrain-dem.zip',
    metadata: {
      terrainPack: {
        version: 1,
        kind: 'dem',
        packKey: 'terrain-def',
        sourceZipName: 'terrain-dem-29.64396-91.11584.zip',
        sourceZipHash: 'cafebabe',
        sourceZipHashAlgorithm: 'sha256',
        sidecarFile: 'dem.json',
        crs: { epsg: 32646, zone: 46, hemisphere: 'north' },
      },
    },
  })
}

describe('terrain pack publish rules', () => {
  it('recognizes geometry packs only', () => {
    expect(isTerrainGeometryPackAsset(createAsset())).toBe(true)
    expect(isTerrainGeometryPackAsset(createDemAsset())).toBe(false)
    expect(isTerrainGeometryPackAsset(null)).toBe(false)
  })

  it('resolves the external GLB url and rewrites the registry entry', () => {
    const asset = createAsset()
    expect(resolveTerrainPackExternalAssetUrl(asset)).toBe(`${SERVER_BASE}terrain-abc/scene.glb`)
    const entry = buildTerrainPackExternalRegistryEntry(
      { sourceType: 'package', zipPath: 'resources/abc.glb', assetType: 'model', name: 'scene.glb', bytes: 10 },
      `${SERVER_BASE}terrain-abc/scene.glb`,
    )
    expect(entry).toEqual({
      sourceType: 'url',
      url: `${SERVER_BASE}terrain-abc/scene.glb`,
      assetType: 'model',
      name: 'scene.glb',
      bytes: 10,
    })
  })

  it('marks geometry packs as embed-excluded and patches the published registry', () => {
    const geometryAsset = createAsset()
    const ordinaryAsset = createAsset({
      id: 'asset-2',
      name: 'tree',
      downloadUrl: `${SERVER_BASE}tree.glb`,
      fileKey: 'tree.glb',
      metadata: null,
    })
    expect(shouldSkipTerrainPackEmbedding(geometryAsset)).toBe(true)
    expect(shouldSkipTerrainPackEmbedding(ordinaryAsset)).toBe(false)
    expect(shouldSkipTerrainPackEmbedding(createDemAsset())).toBe(false)

    const document = {
      assetCatalog: { 'cat-1': [geometryAsset, ordinaryAsset] },
      assetRegistry: {
        [geometryAsset.id]: {
          sourceType: 'package',
          zipPath: 'resources/hash.glb',
          assetType: 'model',
          name: 'scene.glb',
        },
        [ordinaryAsset.id]: {
          sourceType: 'package',
          zipPath: 'resources/tree.glb',
          assetType: 'model',
          name: 'tree.glb',
        },
      },
    } as unknown as Parameters<typeof applyTerrainPackExternalRegistryEntries>[0]

    expect(applyTerrainPackExternalRegistryEntries(document)).toBe(1)
    const registry = document.assetRegistry!
    expect(registry[geometryAsset.id]).toEqual({
      sourceType: 'url',
      url: `${SERVER_BASE}terrain-abc/scene.glb`,
      assetType: 'model',
      name: 'scene.glb',
    })
    expect(registry[ordinaryAsset.id]).toEqual({
      sourceType: 'package',
      zipPath: 'resources/tree.glb',
      assetType: 'model',
      name: 'tree.glb',
    })
  })
})

describe('DEM pack library helpers', () => {
  it('detects DEM packs and summarizes their sidecar', () => {
    const asset = createDemAsset()
    expect(isTerrainDemPackAsset(asset)).toBe(true)
    expect(isTerrainDemPackAsset(createAsset())).toBe(false)
    expect(readTerrainDemPackSummary(asset).crsLabel).toBe('EPSG:32646 · UTM 46N')
  })

  it('downloads the pack through the asset cache and rejects foreign assets', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'terrain-dem.zip', { type: 'application/zip' })
    const ensureAssetFile = vi.fn(async () => file)
    const loaded = await loadTerrainDemPackFileFromAsset({ asset: createDemAsset(), ensureAssetFile })
    expect(loaded).toBe(file)
    expect(ensureAssetFile).toHaveBeenCalledWith('asset-dem', { asset: expect.objectContaining({ id: 'asset-dem' }) })

    await expect(loadTerrainDemPackFileFromAsset({ asset: createAsset(), ensureAssetFile }))
      .rejects.toThrow(/不是 DEM 地形资源包/)
  })

  it('reports a readable error when the download yields nothing', async () => {
    await expect(loadTerrainDemPackFileFromAsset({
      asset: createDemAsset(),
      ensureAssetFile: async () => null,
    })).rejects.toThrow(/无法下载/)
  })
})
