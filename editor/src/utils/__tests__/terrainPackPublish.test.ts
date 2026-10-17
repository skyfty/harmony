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
  isLegacyTerrainDemPackAsset,
  isTerrainDemPackAsset,
  loadTerrainDemAssetContents,
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
    downloadUrl: `${SERVER_BASE}terrain-def/dem.json`,
    fileKey: 'terrain-def/dem.json',
    metadata: {
      terrainPack: {
        version: 1,
        kind: 'dem',
        storageLayout: 'extracted-v2',
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

function createDemSidecar() {
  return {
    version: 1,
    generator: '3dtiles-viewer',
    createdAt: '2026-10-17T00:00:00.000Z',
    anchor: {
      latitudeDegrees: 29.64396,
      longitudeDegrees: 91.11584,
      groundElevationMeters: 3651.5,
    },
    crs: { type: 'utm', epsg: 32646, zone: 46, hemisphere: 'north', geographicEpsg: 4326 },
    geoTransform: [500000, 2, 0, 3280000, 0, -2],
    elevationDatum: 'wgs84-ellipsoid',
    dem: {
      file: 'dem.tif',
      width: 251,
      height: 251,
      cellSizeMeters: 2,
      minElevationMeters: 3640,
      maxElevationMeters: 3700,
    },
    ortho: {
      file: 'ortho.tif',
      width: 251,
      height: 251,
      cellSizeMeters: 2,
      photometric: 'rgb',
    },
    stats: {
      sourceTriangleCount: 1000,
      sampledCellCount: 63001,
      filledCellCount: 12,
      filledRatio: 0.0002,
      warnings: [],
    },
  }
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
    expect(shouldSkipTerrainPackEmbedding(createDemAsset())).toBe(true)

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
    expect(isLegacyTerrainDemPackAsset(asset)).toBe(false)
    expect(readTerrainDemPackSummary(asset).crsLabel).toBe('EPSG:32646 · UTM 46N')
  })

  it('rejects legacy zip-era DEM metadata without extracted-v2 storage', () => {
    const legacy = createDemAsset()
    legacy.metadata = {
      terrainPack: {
        ...(legacy.metadata?.terrainPack as Record<string, unknown>),
        storageLayout: undefined,
      },
    }

    expect(isTerrainDemPackAsset(legacy)).toBe(false)
    expect(isLegacyTerrainDemPackAsset(legacy)).toBe(true)
  })

  it('loads dem.json first and resolves private TIF files from its relative paths', async () => {
    const asset = createDemAsset()
    const sidecarFile = new File([JSON.stringify(createDemSidecar())], 'dem.json', { type: 'application/json' })
    const demFile = new File([new Uint8Array([1, 2, 3])], 'dem.tif', { type: 'image/tiff' })
    const orthoFile = new File([new Uint8Array([4, 5, 6])], 'ortho.tif', { type: 'image/tiff' })
    const ensureAssetFile = vi.fn(async () => sidecarFile)
    const ensureCachedFile = vi.fn(async (_cacheId: string, url: string, name: string) => {
      return url.endsWith('/dem.tif') ? demFile : name === 'ortho.tif' ? orthoFile : null
    })

    const loaded = await loadTerrainDemAssetContents({ asset, ensureAssetFile, ensureCachedFile })

    expect(loaded.sidecar.dem.file).toBe('dem.tif')
    expect(loaded.dem.file).toBe(demFile)
    expect(loaded.ortho?.file).toBe(orthoFile)
    expect(ensureAssetFile).toHaveBeenCalledWith('asset-dem', { asset: expect.objectContaining({ id: 'asset-dem' }) })
    expect(ensureCachedFile).toHaveBeenNthCalledWith(
      1,
      'terrain-dem:asset-dem:dem',
      `${SERVER_BASE}terrain-def/dem.tif`,
      'dem.tif',
    )
    expect(ensureCachedFile).toHaveBeenNthCalledWith(
      2,
      'terrain-dem:asset-dem:ortho',
      `${SERVER_BASE}terrain-def/ortho.tif`,
      'ortho.tif',
    )

    await expect(loadTerrainDemAssetContents({
      asset: createAsset(),
      ensureAssetFile,
      ensureCachedFile,
    })).rejects.toThrow(/不是 DEM 地形资源包/)
  })

  it('reports a readable error when dem.json or a referenced raster is unavailable', async () => {
    await expect(loadTerrainDemAssetContents({
      asset: createDemAsset(),
      ensureAssetFile: async () => null,
      ensureCachedFile: async () => null,
    })).rejects.toThrow(/dem\.json/)

    await expect(loadTerrainDemAssetContents({
      asset: createDemAsset(),
      ensureAssetFile: async () => new File([JSON.stringify(createDemSidecar())], 'dem.json'),
      ensureCachedFile: async () => null,
    })).rejects.toThrow(/DEM 栅格/)
  })
})
