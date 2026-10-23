import { writeArrayBuffer } from 'geotiff'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerrainDemPackageSidecar } from '@schema/terrainDemPackage'
import {
  decodeDemOrthoGeoTiff,
  downsampleNorthUpOrthophotoToSouthUpRgb,
} from '../demOrthoRaster'
import {
  createProceduralLandscapeDemOrthoResolver,
  getTerrainDemOrthoFileInfo,
} from '../demOrthoTextureLoader'

function createSidecar(width: number, height: number): TerrainDemPackageSidecar {
  return {
    version: 1,
    generator: '3dtiles-viewer',
    createdAt: '2026-10-23T00:00:00.000Z',
    anchor: {
      latitudeDegrees: 39.8,
      longitudeDegrees: 118.4,
      groundElevationMeters: 80,
    },
    crs: {
      type: 'utm',
      epsg: 32650,
      zone: 50,
      hemisphere: 'north',
      geographicEpsg: 4326,
    },
    geoTransform: [500000, 1, 0, 4400000, 0, -1],
    elevationDatum: 'wgs84-ellipsoid',
    dem: {
      file: 'dem.tif',
      width,
      height,
      cellSizeMeters: 1,
      minElevationMeters: 0,
      maxElevationMeters: 1,
    },
    ortho: {
      file: 'ortho.tif',
      width,
      height,
      cellSizeMeters: 1,
      photometric: 'rgb',
    },
    stats: {
      sourceTriangleCount: 2,
      sampledCellCount: width * height,
      filledCellCount: 0,
      filledRatio: 0,
      warnings: [],
    },
  }
}

function writeOrthoTiff(
  width: number,
  height: number,
  samplesPerPixel: number,
  raster: Uint8Array,
): ArrayBuffer {
  return writeArrayBuffer(raster, {
    height,
    width,
    SamplesPerPixel: samplesPerPixel,
    BitsPerSample: Array.from({ length: samplesPerPixel }, () => 8),
    PhotometricInterpretation: 2,
    ModelPixelScale: [1, 1, 0],
    ModelTiepoint: [0, 0, 0, 500000, 4400000, 0],
    GTModelTypeGeoKey: 1,
    GTRasterTypeGeoKey: 1,
    ProjectedCSTypeGeoKey: 32650,
  })
}

describe('Procedural Landscape ortho.tif decoding', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('decodes RGB TIFF values and flips north-up rows to south-up', async () => {
    const buffer = writeOrthoTiff(2, 2, 3, new Uint8Array([
      10, 20, 30,
      40, 50, 60,
      70, 80, 90,
      100, 110, 120,
    ]))
    const decoded = await decodeDemOrthoGeoTiff({
      buffer,
      sidecar: createSidecar(2, 2),
      maxSize: 2048,
    })
    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(2)
    expect(Array.from(decoded.rgb)).toEqual([
      70, 80, 90,
      100, 110, 120,
      10, 20, 30,
      40, 50, 60,
    ])
  })

  it('supports RGBA and grayscale TIFF channels', async () => {
    const rgba = await decodeDemOrthoGeoTiff({
      buffer: writeOrthoTiff(1, 1, 4, new Uint8Array([12, 34, 56, 7])),
      sidecar: createSidecar(1, 1),
      maxSize: 2048,
    })
    expect(Array.from(rgba.rgb)).toEqual([12, 34, 56])

    const gray = await decodeDemOrthoGeoTiff({
      buffer: writeOrthoTiff(1, 1, 1, new Uint8Array([99])),
      sidecar: createSidecar(1, 1),
      maxSize: 2048,
    })
    expect(Array.from(gray.rgb)).toEqual([99, 99, 99])
  })

  it('downsamples to the requested maximum size', async () => {
    const sidecar = createSidecar(4, 2)
    const buffer = writeOrthoTiff(4, 2, 3, new Uint8Array(4 * 2 * 3).fill(50))
    const decoded = await decodeDemOrthoGeoTiff({ buffer, sidecar, maxSize: 2 })
    expect([decoded.width, decoded.height]).toEqual([2, 1])
    expect(decoded.rgb).toHaveLength(2 * 1 * 3)
  })

  it('rejects invalid dimensions, missing ortho metadata and corrupt TIFF data', async () => {
    const sidecar = createSidecar(2, 2)
    await expect(decodeDemOrthoGeoTiff({
      buffer: writeOrthoTiff(1, 1, 3, new Uint8Array([1, 2, 3])),
      sidecar,
      maxSize: 2048,
    })).rejects.toThrow(/尺寸不一致/)

    const noOrtho = { ...sidecar, ortho: null }
    await expect(decodeDemOrthoGeoTiff({
      buffer: writeOrthoTiff(2, 2, 3, new Uint8Array(12)),
      sidecar: noOrtho,
      maxSize: 2048,
    })).rejects.toThrow(/未声明 ortho\.tif/)
    await expect(decodeDemOrthoGeoTiff({
      buffer: new Uint8Array([1, 2, 3]).buffer,
      sidecar,
      maxSize: 2048,
    })).rejects.toThrow()
  })

  it('detects raw ortho availability from DEM asset metadata', () => {
    const asset = {
      id: 'asset-dem',
      name: 'DEM',
      type: 'file',
      downloadUrl: 'https://example.test/terrain-def/dem.json',
      previewColor: '#fff',
      gleaned: false,
      metadata: {
        terrainPack: {
          version: 1,
          kind: 'dem',
          storageLayout: 'extracted-v2',
          packKey: 'terrain/test',
          sourceZipName: 'terrain.zip',
          sourceZipHash: 'hash',
          sourceZipHashAlgorithm: 'sha256',
          orthoFile: 'ortho.tif',
        },
      },
    } as const
    expect(getTerrainDemOrthoFileInfo(asset as never)?.file).toBe('ortho.tif')
    const resolver = createProceduralLandscapeDemOrthoResolver({
      getAsset: () => asset as never,
      ensureAssetFile: async () => null,
      ensureCachedFile: async () => null,
    })
    expect(resolver.canResolve('asset-dem')).toBe(true)
  })

  it('downloads dem.json and ortho.tif without requesting a runtime ortho file', async () => {
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null

      postMessage(message: { requestId: number }) {
        queueMicrotask(() => {
          this.onmessage?.({
            data: {
              kind: 'decode-dem-ortho-result',
              requestId: message.requestId,
              width: 1,
              height: 1,
              sourceWidth: 1,
              sourceHeight: 1,
              rgb: new Uint8Array([1, 2, 3]).buffer,
            },
          } as MessageEvent)
        })
      }

      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker)

    const sidecar = createSidecar(2, 2)
    const asset = {
      id: 'asset-dem',
      name: 'DEM',
      type: 'file',
      downloadUrl: 'https://example.test/terrain-def/dem.json',
      previewColor: '#fff',
      gleaned: false,
      updatedAt: '2026-10-23T00:00:00.000Z',
      metadata: {
        terrainPack: {
          version: 1,
          kind: 'dem',
          storageLayout: 'extracted-v2',
          packKey: 'terrain/test',
          sourceZipName: 'terrain.zip',
          sourceZipHash: 'hash',
          sourceZipHashAlgorithm: 'sha256',
          orthoFile: 'ortho.tif',
        },
      },
    } as const
    const ensureAssetFile = vi.fn(async (_assetId: string, _options: { asset: unknown }) => new File(
      [JSON.stringify(sidecar)],
      'dem.json',
      { type: 'application/json' },
    ))
    const ensureCachedFile = vi.fn(async (_cacheId: string, _url: string, _name: string) => new File(
      [new Uint8Array([1, 2, 3])],
      'ortho.tif',
      { type: 'image/tiff' },
    ))
    const resolver = createProceduralLandscapeDemOrthoResolver({
      getAsset: () => asset as never,
      ensureAssetFile,
      ensureCachedFile,
    })

    const loaded = await resolver.load('asset-dem')
    expect(Array.from(loaded.rgb)).toEqual([1, 2, 3])
    expect(ensureAssetFile).toHaveBeenCalledOnce()
    expect(ensureCachedFile).toHaveBeenCalledWith(
      'terrain-dem:asset-dem|2026-10-23T00:00:00.000Z||hash:ortho-tif',
      'https://example.test/terrain-def/ortho.tif',
      'ortho.tif',
    )
    expect(ensureCachedFile.mock.calls.some(([url]) => String(url).includes('runtime/ortho-rgb.bin'))).toBe(false)
  })

  it('keeps the south-up downsample orientation stable', () => {
    const rgb = downsampleNorthUpOrthophotoToSouthUpRgb({
      raster: new Uint8Array([
        1, 2, 3,
        4, 5, 6,
      ]),
      sourceWidth: 1,
      sourceHeight: 2,
      samplesPerPixel: 3,
      targetWidth: 1,
      targetHeight: 2,
    })
    expect(Array.from(rgb)).toEqual([4, 5, 6, 1, 2, 3])
  })
})
