import {
  AssetCache,
  createIndexedDbPersistentAssetStorage,
  createNoopPersistentAssetStorage,
  isIndexedDbPersistentAssetStorageSupported,
  type PersistentAssetStorage,
} from '@schema'

let editorPersistentAssetStorage: PersistentAssetStorage | null = null

export function getEditorPersistentAssetStorage(): PersistentAssetStorage {
  if (!editorPersistentAssetStorage) {
    editorPersistentAssetStorage = isIndexedDbPersistentAssetStorageSupported()
      ? createIndexedDbPersistentAssetStorage()
      : createNoopPersistentAssetStorage()
  }
  return editorPersistentAssetStorage
}

export function createEditorRuntimeAssetCache(): AssetCache {
  return new AssetCache({
    persistentStorage: getEditorPersistentAssetStorage(),
  })
}