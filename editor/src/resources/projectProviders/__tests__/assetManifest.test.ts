import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetManifest } from '@schema/core'

const { readServerDownloadBaseUrl } = vi.hoisted(() => ({
  readServerDownloadBaseUrl: vi.fn<() => string>(),
}))

vi.mock('@/api/serverApiConfig', () => ({ readServerDownloadBaseUrl }))
vi.mock('@/api/serverAssetTypes', () => ({
  mapServerAssetToProjectAsset: vi.fn((asset) => asset),
  normalizeServerAssetType: vi.fn(() => 'file'),
}))
vi.mock('@/stores/sceneStore', () => ({ useSceneStore: vi.fn() }))
vi.mock('@/utils/serverAssetSource', () => ({ SERVER_ASSET_PROVIDER_ID: 'server-assets' }))

import { assetProvider, invalidateAssetManifestCache } from '../asset'

function createManifest(): AssetManifest {
  return {
    format: 'harmony-asset-manifest',
    version: 2,
    generatedAt: '2026-01-01T00:00:00.000Z',
    rootDirectoryId: 'asset-root',
    directoriesById: {
      'asset-root': {
        id: 'asset-root',
        name: 'Assets',
        parentId: null,
        directoryIds: [],
        assetIds: [],
      },
    },
    assetsById: {},
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('asset manifest provider', () => {
  beforeEach(() => {
    invalidateAssetManifestCache()
    readServerDownloadBaseUrl.mockReturnValue('https://v.touchmagic.cn/uploads')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    invalidateAssetManifestCache()
  })

  it.each([
    ['without trailing slash', 'https://v.touchmagic.cn/uploads'],
    ['with trailing slash', 'https://v.touchmagic.cn/uploads/'],
  ])('fetches raw manifest JSON from the uploads URL (%s)', async (_label, baseUrl) => {
    readServerDownloadBaseUrl.mockReturnValue(baseUrl)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(createManifest()))
    vi.stubGlobal('fetch', fetchMock)

    await expect(assetProvider.load?.()).resolves.toEqual([])
    await expect(assetProvider.load?.()).resolves.toEqual([])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://v.touchmagic.cn/uploads/asset-manifest.json', expect.objectContaining({
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
    }))
    const requestOptions = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(new Headers(requestOptions.headers).get('Authorization')).toBeNull()
  })

  it('continues to normalize a raw legacy manifest response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      generatedAt: '2026-01-01T00:00:00.000Z',
      assets: [],
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(assetProvider.load?.()).resolves.toEqual([])
  })

  it('preserves terrain DEM metadata from the manifest', async () => {
    const manifest = createManifest()
    const terrainPack = {
      version: 1,
      kind: 'dem',
      packKey: 'terrain-packs/terrain-dem',
      sourceZipName: 'terrain-dem-29.64396-91.11584.zip',
      runtimeGridUrl: 'https://v.touchmagic.cn/uploads/terrain-packs/terrain-dem/runtime/dem-grid.bin',
      runtimeGridBytes: 4404019,
      demWidth: 251,
      demHeight: 251,
      demCellSizeMeters: 2,
      anchor: { latitudeDegrees: 29.64396, longitudeDegrees: 91.11584, groundElevationMeters: 3651.5 },
      crs: { epsg: 32646, zone: 46, hemisphere: 'north' },
    }
    const rootDirectory = manifest.directoriesById['asset-root']
    if (!rootDirectory) {
      throw new Error('Test manifest is missing its root directory')
    }
    rootDirectory.directoryIds = ['terrain']
    manifest.directoriesById.terrain = {
      id: 'terrain',
      name: '地形',
      parentId: 'asset-root',
      directoryIds: [],
      assetIds: ['dem-asset'],
    }
    manifest.assetsById['dem-asset'] = {
      id: 'dem-asset',
      name: '青龙山地形',
      type: 'file',
      downloadUrl: 'https://v.touchmagic.cn/uploads/terrain-packs/terrain-dem/terrain-dem.zip',
      resource: {
        kind: 'remote',
        url: 'https://v.touchmagic.cn/uploads/terrain-packs/terrain-dem/terrain-dem.zip',
      },
      thumbnailUrl: null,
      tags: [],
      tagIds: [],
      description: null,
      metadata: { terrainPack },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      size: 13023191,
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(manifest))
    vi.stubGlobal('fetch', fetchMock)

    const directories = await assetProvider.load?.()
    const demAsset = directories?.[0]?.assets?.[0]

    expect(demAsset?.metadata?.terrainPack).toEqual(terrainPack)
  })

  it('reports HTTP and invalid manifest responses as errors', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'Not found' }, 404))
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')) })
      .mockResolvedValueOnce(jsonResponse({ data: createManifest() }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(assetProvider.load?.()).rejects.toThrow('资产清单请求失败 (404)')
    await expect(assetProvider.load?.()).rejects.toThrow('资产清单格式不正确')
    await expect(assetProvider.load?.()).rejects.toThrow('资产清单格式不正确')
  })

  it('does not let a request started before invalidation overwrite the refreshed cache', async () => {
    let resolveFirst: ((response: Response) => void) | undefined
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce(jsonResponse(createManifest()))
    vi.stubGlobal('fetch', fetchMock)

    const staleLoad = assetProvider.load?.()
    invalidateAssetManifestCache()
    await expect(assetProvider.load?.()).resolves.toEqual([])
    resolveFirst?.(jsonResponse({ invalid: true }))
    await expect(staleLoad).rejects.toThrow('资产清单格式不正确')
    await expect(assetProvider.load?.()).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
