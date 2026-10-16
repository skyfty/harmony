/**
 * Contract tests for the shared terrain pack validation used by the admin
 * resource upload, the editor publish rule and the runtime texture stream.
 */
import { describe, expect, it } from 'vitest'
import {
  TERRAIN_GEOMETRY_PACK_GLB,
  TERRAIN_GEOMETRY_PACK_MANIFEST,
  detectTerrainPackKind,
  parseTerrainTextureManifest,
  readTerrainPackAssetMetadata,
  readTerrainPackDependencyMetadata,
  summarizeTerrainPack,
  type TerrainPackEntry,
} from '@schema/terrainPack'
import { TERRAIN_DEM_PACKAGE_VERSION } from '@schema/terrainDemPackage'

function entry(path: string, bytes = 1024): TerrainPackEntry {
  return { path, bytes }
}

function createManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    glb: TERRAIN_GEOMETRY_PACK_GLB,
    textures: [
      { id: 'tex-1', image: 'textures/tex-1.jpg', width: 2048, height: 2048, bytes: 300000, mimeType: 'image/jpeg' },
      { id: 'tex-2', image: 'textures/tex-2.jpg', ktx2: 'textures/tex-2.ktx2' },
    ],
    ...overrides,
  }
}

function createDemSidecar(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: TERRAIN_DEM_PACKAGE_VERSION,
    generator: '3dtiles-viewer',
    createdAt: '2026-10-16T00:00:00.000Z',
    anchor: { latitudeDegrees: 29.6439555556, longitudeDegrees: 91.1158416667, groundElevationMeters: 3651.5 },
    crs: { type: 'utm', epsg: 32646, zone: 46, hemisphere: 'north', geographicEpsg: 4326 },
    geoTransform: [500000, 2, 0, 3280000, 0, -2],
    elevationDatum: 'wgs84-ellipsoid',
    dem: { file: 'dem.tif', width: 251, height: 251, cellSizeMeters: 2, minElevationMeters: 3640, maxElevationMeters: 3700 },
    ortho: null,
    stats: {
      sourceTriangleCount: 1000,
      sampledCellCount: 63001,
      filledCellCount: 12,
      filledRatio: 0.0002,
      warnings: [],
    },
    ...overrides,
  }
}

describe('detectTerrainPackKind', () => {
  it('detects geometry packs, DEM packs and foreign zips', () => {
    expect(detectTerrainPackKind([TERRAIN_GEOMETRY_PACK_GLB, TERRAIN_GEOMETRY_PACK_MANIFEST])).toBe('geometry')
    expect(detectTerrainPackKind(['dem.tif', 'dem.json'])).toBe('dem')
    expect(detectTerrainPackKind(['readme.txt', 'model.fbx'])).toBeNull()
    expect(detectTerrainPackKind(['scene.glb'])).toBeNull()
  })

  it('accepts nested folders and backslashes', () => {
    expect(detectTerrainPackKind(['terrain-x\\scene.glb', 'terrain-x/textures.json'])).toBe('geometry')
  })
})

describe('summarizeTerrainPack', () => {
  it('summarizes a geometry pack with external textures', () => {
    const summary = summarizeTerrainPack([
      entry('scene.glb', 5_000_000),
      entry('textures/tex-1.jpg'),
      entry('textures/tex-2.jpg'),
      entry('textures/tex-2.ktx2'),
      entry(TERRAIN_GEOMETRY_PACK_MANIFEST, 512),
    ], { manifest: parseTerrainTextureManifest(createManifest()) })

    expect(summary.kind).toBe('geometry')
    expect(summary.glbFile).toBe('scene.glb')
    expect(summary.manifestFile).toBe(TERRAIN_GEOMETRY_PACK_MANIFEST)
    expect(summary.textures).toHaveLength(2)
    expect(summary.textures[1]?.ktx2File).toBe('textures/tex-2.ktx2')
    expect(summary.totalBytes).toBe(5_000_000 + 3 * 1024 + 512)
    expect(summary.warnings).toEqual([])
  })

  it('rejects geometry packs without the required files', () => {
    expect(() => summarizeTerrainPack([entry('textures.json')], { manifest: parseTerrainTextureManifest(createManifest()) }))
      .toThrow(/scene\.glb/)
    expect(() => summarizeTerrainPack([entry('scene.glb')], { manifest: parseTerrainTextureManifest(createManifest()) }))
      .toThrow(/textures\.json/)
  })

  it('warns about missing or unlisted texture files', () => {
    const summary = summarizeTerrainPack([
      entry('scene.glb'),
      entry('textures/tex-1.jpg'),
      entry('textures/orphan.jpg'),
      entry('notes.txt'),
      entry(TERRAIN_GEOMETRY_PACK_MANIFEST),
    ], { manifest: parseTerrainTextureManifest(createManifest()) })

    expect(summary.warnings.join('\n')).toContain('textures/tex-2.jpg')
    expect(summary.warnings.join('\n')).toContain('textures/tex-2.ktx2')
    expect(summary.warnings.join('\n')).toContain('textures/orphan.jpg')
    expect(summary.warnings.join('\n')).toContain('notes.txt')
  })

  it('summarizes a DEM pack and validates its sidecar', () => {
    const summary = summarizeTerrainPack([
      entry('dem.tif', 4096),
      entry('ortho.tif', 8192),
      entry('dem.json', 2048),
    ], { sidecar: createDemSidecar({ ortho: { file: 'ortho.tif', width: 251, height: 251, cellSizeMeters: 2, photometric: 'rgb' } }) })

    expect(summary.kind).toBe('dem')
    expect(summary.demFile).toBe('dem.tif')
    expect(summary.orthoFile).toBe('ortho.tif')
    expect(summary.sidecarFile).toBe('dem.json')
    expect(summary.textures).toEqual([])
  })

  it('rejects DEM packs with a mismatched sidecar', () => {
    expect(() => summarizeTerrainPack([entry('dem.tif'), entry('dem.json')], {
      sidecar: createDemSidecar({ version: 2 }),
    })).toThrow(/版本/)
    expect(() => summarizeTerrainPack([entry('dem.json')], { sidecar: createDemSidecar() }))
      .toThrow(/dem\.tif/)
  })

  it('flags a recorded ortho raster that is missing from the archive', () => {
    const summary = summarizeTerrainPack([entry('dem.tif'), entry('dem.json')], {
      sidecar: createDemSidecar({ ortho: { file: 'ortho.tif', width: 251, height: 251, cellSizeMeters: 2, photometric: 'rgb' } }),
    })
    expect(summary.warnings.join('\n')).toContain('ortho.tif')
  })

  it('rejects foreign archives with a readable message', () => {
    expect(() => summarizeTerrainPack([entry('a.txt'), entry('b.png')])).toThrow(/无法识别的资源包/)
  })
})

describe('terrain pack metadata readers', () => {
  it('reads asset metadata produced by the admin upload', () => {
    const metadata = readTerrainPackAssetMetadata({
      version: 1,
      kind: 'geometry',
      packKey: 'terrain-abc',
      sourceZipName: 'terrain-29.64396-91.11584.zip',
      sourceZipHash: 'deadbeef',
      sourceZipHashAlgorithm: 'sha256',
      glbFile: 'scene.glb',
      manifestFile: 'textures.json',
      textures: [],
      files: [],
      totalBytes: 10,
    })
    expect(metadata?.kind).toBe('geometry')
    expect(metadata?.packKey).toBe('terrain-abc')
  })

  it('ignores unrelated or malformed metadata', () => {
    expect(readTerrainPackAssetMetadata(null)).toBeNull()
    expect(readTerrainPackAssetMetadata({ kind: 'geometry' })).toBeNull()
    expect(readTerrainPackAssetMetadata({ version: 1, kind: 'other', packKey: 'x' })).toBeNull()
    expect(readTerrainPackDependencyMetadata({ version: 1, relativePath: 'textures/a.jpg', role: 'texture' })?.role).toBe('texture')
    expect(readTerrainPackDependencyMetadata({ version: 1, relativePath: 'x', role: 'nope' })).toBeNull()
  })
})
