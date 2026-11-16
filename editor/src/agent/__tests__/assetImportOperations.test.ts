import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectAsset } from '@/types/project-asset'
import type { SceneAssetCatalogSnapshot } from '@/types/scene-history-entry'
import { importLocalAssetsFromAgent } from '@/agent/assetImportOperations'
import { importLocalAssetFile } from '@/utils/localAssetImportPipeline'
import { useAssetCacheStore } from '@/stores/assetCacheStore'

vi.mock('@/utils/localAssetImportPipeline', () => ({
  importLocalAssetFile: vi.fn(),
}))

vi.mock('@/stores/assetCacheStore', () => ({
  useAssetCacheStore: vi.fn(() => ({
    removeCache: vi.fn(),
  })),
}))

const mockedImportLocalAssetFile = vi.mocked(importLocalAssetFile)
const mockedUseAssetCacheStore = vi.mocked(useAssetCacheStore)

function createAsset(id: string, name: string): ProjectAsset {
  return {
    id,
    name,
    type: 'image',
    downloadUrl: name,
    previewColor: '#ffffff',
    thumbnail: null,
    description: name,
    extension: 'png',
    imageWidth: 1024,
    imageHeight: 1024,
    gleaned: true,
    source: { type: 'local' },
  }
}

function pngBase64(payload = [0]): string {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...payload]).toString('base64')
}

function createStore(overrides: Record<string, unknown> = {}) {
  const snapshot: SceneAssetCatalogSnapshot = {
    assetCatalog: { 'dir-assets-root': [] },
    assetManifest: null,
    assetRegistry: {},
    activeDirectoryId: 'dir-assets-root',
    selectedAssetId: null,
  }
  const store = {
    isSceneReady: true,
    currentSceneId: 'asset-import-test',
    sceneRevision: 7,
    selectedAssetId: null,
    collectCatalogAssetMap: vi.fn(() => new Map()),
    snapshotAssetCatalog: vi.fn(() => snapshot),
    restoreAssetCatalogSnapshot: vi.fn(),
    commitAssetCatalogImport: vi.fn(function (this: { sceneRevision: number }) {
      this.sceneRevision += 1
    }),
    flushPendingSceneAutoSave: vi.fn(async () => ({ id: 'asset-import-test' })),
    ensureActiveDirectoryAndSelectionValid: vi.fn(),
    ...overrides,
  }
  return store
}

describe('Agent local asset import', () => {
  beforeEach(() => {
    mockedImportLocalAssetFile.mockReset()
    const cache = { removeCache: vi.fn() }
    mockedUseAssetCacheStore.mockReturnValue(cache as never)
  })

  it('imports a valid PNG as one revision and selects the last asset', async () => {
    const store = createStore()
    const asset = createAsset('sha256-a', 'roof.png')
    mockedImportLocalAssetFile.mockResolvedValue({ asset, isNew: true })

    const result = await importLocalAssetsFromAgent(store as never, {
      expectedRevision: 7,
      items: [{
        path: 'C:\\textures\\roof.png',
        name: 'roof.png',
        type: 'image',
        mimeType: 'image/png',
        base64: pngBase64([1, 2, 3]),
        size: 11,
      }],
    })

    expect(result).toMatchObject({
      beforeRevision: 7,
      afterRevision: 8,
      importedCount: 1,
      reusedCount: 0,
      saved: true,
    })
    expect(result.items[0]).toMatchObject({
      assetId: 'sha256-a',
      name: 'roof.png',
      imageWidth: 1024,
      imageHeight: 1024,
      isNew: true,
    })
    expect(store.commitAssetCatalogImport).toHaveBeenCalledOnce()
    expect(store.selectedAssetId).toBe('sha256-a')
    expect(store.flushPendingSceneAutoSave).toHaveBeenCalledOnce()
  })

  it('rejects a stale scene revision before decoding or importing files', async () => {
    const store = createStore()
    await expect(importLocalAssetsFromAgent(store as never, {
      expectedRevision: 6,
      items: [{
        path: 'C:\\textures\\roof.png',
        base64: pngBase64(),
      }],
    })).rejects.toMatchObject({ code: 'STALE_REVISION' })

    expect(mockedImportLocalAssetFile).not.toHaveBeenCalled()
    expect(store.commitAssetCatalogImport).not.toHaveBeenCalled()
  })

  it('restores catalog state and clears newly cached assets when a later file fails', async () => {
    const store = createStore()
    mockedImportLocalAssetFile
      .mockResolvedValueOnce({ asset: createAsset('sha256-a', 'roof.png'), isNew: true })
      .mockRejectedValueOnce(new Error('forced import failure'))

    await expect(importLocalAssetsFromAgent(store as never, {
      expectedRevision: 7,
      items: [
        { path: 'C:\\textures\\roof.png', base64: pngBase64([1]) },
        { path: 'C:\\textures\\wall.png', base64: pngBase64([2]) },
      ],
    })).rejects.toThrow('forced import failure')

    expect(store.restoreAssetCatalogSnapshot).toHaveBeenCalledOnce()
    expect(store.commitAssetCatalogImport).not.toHaveBeenCalled()
    const cache = mockedUseAssetCacheStore.mock.results[0]?.value as { removeCache: ReturnType<typeof vi.fn> }
    expect(cache.removeCache).toHaveBeenCalledWith('sha256-a')
  })

  it('returns existing assets without creating another revision', async () => {
    const store = createStore()
    mockedImportLocalAssetFile.mockResolvedValue({
      asset: createAsset('sha256-existing', 'roof.png'),
      isNew: false,
    })

    const result = await importLocalAssetsFromAgent(store as never, {
      expectedRevision: 7,
      select: false,
      items: [{ path: 'C:\\textures\\roof.png', base64: pngBase64() }],
    })

    expect(result.afterRevision).toBe(7)
    expect(result.importedCount).toBe(0)
    expect(result.reusedCount).toBe(1)
    expect(store.commitAssetCatalogImport).not.toHaveBeenCalled()
    expect(store.selectedAssetId).toBeNull()
  })

  it('rejects a file whose bytes do not match its image extension', async () => {
    const store = createStore()
    await expect(importLocalAssetsFromAgent(store as never, {
      expectedRevision: 7,
      items: [{
        path: 'C:\\textures\\fake.png',
        name: 'fake.png',
        mimeType: 'image/png',
        base64: Buffer.from('not-a-png').toString('base64'),
      }],
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    expect(mockedImportLocalAssetFile).not.toHaveBeenCalled()
  })
})
