import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createLandscapeDiagnosticsLogger,
  type LandscapeDiagnosticsContext,
  type LandscapeDiagnosticsLogger,
} from '../../../../scenery/common/utils/landscapeDiagnostics'

const LANDSCAPE_PROPS = {
  seed: 1,
  generationRevision: 0,
  quality: 'auto',
  sampling: { sampleCellSize: 2, maxSampleGridSize: 2048 },
  dem: {
    assetId: 'dem',
    runtimeGridUrl: 'https://example.test/dem-grid.bin',
    runtimeGridBytes: 1024,
    sampleStep: 'auto',
    sourceZipName: 'dem.zip',
    width: 1422,
    height: 1308,
    cellSizeMeters: 30,
    minElevation: 0,
    maxElevation: 1900,
    anchor: null,
    crs: null,
  },
  surface: {
    enabled: true,
    textures: true,
    blendStrength: 1,
    uvScale: 10,
    grassTint: '#ffffff',
    forestTint: '#ffffff',
    roadTint: '#ffffff',
    gravelTint: '#ffffff',
    rockSlopeThreshold: 0.35,
    baseMapMode: 'replace',
    baseMapBlend: 0.5,
    viewDistanceScale: null,
  },
  road: { enabled: true },
  forest: {
    coverage: 1,
    scale: 600,
    seedOffset: 0,
    density: 1,
    minHeight: null,
    maxSlope: 0.45,
    roadClearance: 2,
    minScale: 5,
    maxScale: 12,
    nearDistance: 190,
    nearTreeRadius: 90,
  },
  grass: { enabled: true, density: 1 },
  bushes: { enabled: true, density: 0.6 },
  canopy: { enabled: true },
  water: { enabled: true, levelOffset: 0 },
  walls: {
    drystone: { enabled: true, density: 1 },
    fence: { enabled: true },
    barrier: { enabled: true },
    seaWall: { enabled: true },
  },
  wind: { enabled: true, strength: 1 },
  debug: { showRoadPath: false, showChunks: false },
}

function parseLine(line: string): Record<string, any> {
  const separator = line.indexOf(' ')
  expect(separator).toBeGreaterThan(0)
  return JSON.parse(line.slice(separator + 1)) as Record<string, any>
}

describe('landscape diagnostics', () => {
  let logger: LandscapeDiagnosticsLogger | null = null

  afterEach(() => {
    logger?.dispose()
    logger = null
    vi.useRealTimers()
    delete (globalThis as typeof globalThis & { __HARMONY_PL_DIAG__?: unknown }).__HARMONY_PL_DIAG__
  })

  it('emits compact, parseable boot/core/texture snapshots with bounded data', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-18T00:00:00.000Z'))

    const lines: string[] = []
    let pendingDownloads = 1
    let extraWarning = ''
    const texture = {
      id: 'spring_trees_0.aee94219',
      width: 2048,
      height: 512,
      estimatedBytes: 16 * 1024 * 1024,
      anisotropy: 1,
      generateMipmaps: true,
    }
    const assetStore = {
      stats: () => ({
        textureCount: pendingDownloads > 0 ? 0 : 1,
        residentBytes: pendingDownloads > 0 ? 0 : 16 * 1024 * 1024,
        downloadedBytes: 24 * 1024 * 1024,
        pendingDownloads,
        variant: 'full' as const,
        warnings: ['warn-b', 'asset:file-failed'],
      }),
      textureDiagnostics: () => pendingDownloads > 0 ? [] : [texture],
    }
    const stats = {
      nodeId: 'terrain',
      phase: 'streaming',
      progress: 0.8,
      warnings: ['warn-b', 'tree-instance-budget-reached'],
      quality: 'low',
      treeInstances: 6000,
      grassInstances: 12000,
      bushInstances: 500,
      batchCount: 8,
      treeChunkCount: 3,
      roadChunkCount: 1,
      cameraGrassChunkCount: 2,
      gridCols: 356,
      gridRows: 328,
      gridCellSize: 120,
      averageEdgeLength: 120,
      memoryBytes: 5 * 1024 * 1024,
      roadLength: 800,
      roadNodeCount: 100,
      roadComplete: true,
      roadFailureReason: null,
      season: 'spring',
      seasonAssetsReady: true,
      nearTreeInstances: 6000,
      assetTextureCount: 1,
      assetResidentBytes: 16 * 1024 * 1024,
      assetDownloadedBytes: 24 * 1024 * 1024,
      assetVariant: 'full',
      barrierInstances: 10,
      wallSegmentCount: 20,
      farTreeInstances: 0,
      farForestRadius: 0,
      worldForestInstances: 150000,
      worldForestBuildMs: 900,
      roadbedHalfWidth: 0,
      roadbedSideWidth: 0,
      roadbedCutProx: 0,
      roadbedMaxCutFill: 0,
      roadbedCrossSlopeMax: 0,
      roadbedOuterError: 0,
      roadbedOcclusionCount: 0,
      roadbedAuditSamples: 0,
      roadbedTriangleCount: 0,
      waterEnabled: false,
      waterLevel: 0,
      waterFloodedFraction: 0,
      viewDistanceScale: 2,
      demStatus: 'ready',
      demSourceBytes: 4402595,
      demSampleStep: 4,
      demBuildMs: 120,
      demError: null,
      demOrthoStatus: 'ready',
      demOrthoBytes: 3 * 1024 * 1024,
      demOrthoWidth: 1024,
      demOrthoHeight: 1024,
      demOrthoError: null,
      demTransformWarning: null,
      demMeshBytes: 10 * 1024 * 1024,
    }
    const document = {
      id: 'scene',
      name: 'diagnostic',
      nodes: [
        {
          id: 'terrain',
          name: 'terrain-dem',
          nodeType: 'Group',
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          components: {
            proceduralLandscape: {
              id: 'component',
              type: 'proceduralLandscape',
              enabled: true,
              props: LANDSCAPE_PROPS,
            },
          },
        },
      ],
    }
    const renderer = {
      info: {
        render: { calls: 14, triangles: 2_600_000 },
        memory: { textures: 21, geometries: 40 },
        programs: new Array(8).fill(null),
      },
      capabilities: {
        maxTextureSize: 4096,
        maxTextures: 16,
        isWebGL2: false,
        getMaxAnisotropy: () => 8,
      },
      getPixelRatio: () => 3,
    }
    const context: LandscapeDiagnosticsContext = {
      getDocument: () => document as any,
      getRenderer: () => renderer,
      getCanvasSize: () => ({ width: 390, height: 844 }),
      getWarnings: () => extraWarning
        ? ['warn-a', 'warn-a', 'warn-b', extraWarning]
        : ['warn-a', 'warn-a', 'warn-b'],
      getMemoryGuard: () => ({
        state: 'normal',
        extreme: false,
        warningCount: 0,
        deviceMemoryMb: 6144,
        deviceBenchmarkLevel: 20,
      }),
      getAssetCacheBytes: () => 2 * 1024 * 1024,
      getEnvironment: () => ({ season: 'spring', timeOfDay: 'day', weather: 'clear' }),
      getCameraPosition: () => ({ x: 1, y: 2, z: 3 }),
      getLandscapeStats: (nodeId) => nodeId === 'terrain' ? stats as any : null,
      getAssetStore: () => assetStore,
      log: (line) => lines.push(line),
      now: () => Date.now(),
    }

    logger = createLandscapeDiagnosticsLogger(context)
    logger.start()
    for (let index = 0; index < 60; index += 1) {
      logger.tick(1 / 60)
    }

    expect(lines).toHaveLength(0)
    vi.advanceTimersByTime(2000)
    expect(lines.some((line) => line.startsWith('[PL-DIAG-BOOT] '))).toBe(true)
    expect(lines.some((line) => line.startsWith('[PL-DIAG-TEX] '))).toBe(true)

    const boot = parseLine(lines.find((line) => line.startsWith('[PL-DIAG-BOOT] '))!)
    expect(boot.scene).toEqual({ id: 'scene', name: 'diagnostic' })
    expect(boot.renderer.maxTextureSize).toBe(4096)
    expect(boot.renderer.maxAnisotropy).toBe(8)
    expect(boot.assets.variant).toBe('full')
    expect(boot.landscape[0].props.nearTreeRadius).toBe(90)

    pendingDownloads = 0
    for (let index = 0; index < 60; index += 1) {
      logger.tick(1 / 60)
    }
    vi.advanceTimersByTime(8000)

    const coreLine = lines.find((line) => line.startsWith('[PL-DIAG] '))
    expect(coreLine).toBeTruthy()
    const core = parseLine(coreLine!)
    expect(core.type).toBe('core')
    expect(core.reason).toBe('periodic')
    expect(Number.isFinite(core.fps)).toBe(true)
    expect(Number.isFinite(core.frameMs)).toBe(true)
    expect(core.renderer.tris).toBe(2_600_000)
    expect(core.camera).toEqual({ x: 1, y: 2, z: 3 })
    expect(core.assets.variant).toBe('full')
    expect(core.assets.pendingDownloads).toBe(0)
    expect(core.landscape[0].stats.worldForestInstances).toBe(150000)
    expect(core.landscape[0].stats.demStatus).toBe('ready')
    expect(core.landscape[0].stats.seasonAssetsReady).toBe(true)
    expect(core.warnings).toEqual(['warn-a', 'warn-b', 'tree-instance-budget-reached', 'asset:file-failed'])
    expect(JSON.stringify(core)).not.toContain('NaN')
    expect(JSON.stringify(core)).not.toContain('Infinity')

    const textureLine = [...lines].reverse().find((line) => line.startsWith('[PL-DIAG-TEX] '))
    expect(textureLine).toBeTruthy()
    const texturePayload = parseLine(textureLine!)
    expect(texturePayload.reason).toBe('loaded')
    expect(texturePayload.textures).toEqual([
      { id: 'spring_trees_0.aee94219', w: 2048, h: 512, mb: 16, aniso: 1, mip: true },
    ])

    const beforeDump = lines.length
    logger.dump()
    expect(lines.length).toBe(beforeDump + 2)
    expect(parseLine(lines[beforeDump]).reason).toBe('manual')

    extraWarning = 'warn-c'
    logger.tick(1 / 60)
    expect(lines.some((line) => line.includes('"reason":"warning"'))).toBe(true)
  })

  it('stops logging after dispose', () => {
    vi.useFakeTimers()
    const lines: string[] = []
    const context: LandscapeDiagnosticsContext = {
      getDocument: () => null,
      getRenderer: () => null,
      getCanvasSize: () => null,
      getWarnings: () => [],
      getMemoryGuard: () => null,
      getAssetCacheBytes: () => 0,
      getEnvironment: () => null,
      getCameraPosition: () => null,
      getLandscapeStats: () => null,
      getAssetStore: () => null,
      log: (line) => lines.push(line),
    }

    logger = createLandscapeDiagnosticsLogger(context)
    logger.start()
    vi.advanceTimersByTime(2000)
    expect(lines.length).toBeGreaterThan(0)
    logger.dispose()
    const stoppedAt = lines.length
    vi.advanceTimersByTime(60_000)
    logger.tick(1 / 60)
    expect(lines.length).toBe(stoppedAt)
    expect((globalThis as typeof globalThis & { __HARMONY_PL_DIAG__?: unknown }).__HARMONY_PL_DIAG__).toBeUndefined()
  })
})
