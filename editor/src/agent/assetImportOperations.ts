import { inferAssetType } from '@schema/core'
import {
  HARMONY_AGENT_MAX_ASSET_IMPORT_FILE_BYTES,
  HARMONY_AGENT_MAX_ASSET_IMPORT_FILES,
  HARMONY_AGENT_MAX_ASSET_IMPORT_TOTAL_BYTES,
  type HarmonyAssetImportLocalItemResult,
  type HarmonyAssetImportLocalRequest,
  type HarmonyAssetImportLocalResult,
  type HarmonyLocalAssetImportItem,
} from '@schema/editorAgentProtocol'
import type { ProjectAsset } from '@/types/project-asset'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import type { useSceneStore } from '@/stores/sceneStore'
import type { SceneAssetCatalogSnapshot } from '@/types/scene-history-entry'
import { importLocalAssetFile } from '@/utils/localAssetImportPipeline'
import { AgentBridgeError } from '@/agent/errors'

type SceneStore = ReturnType<typeof useSceneStore>

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'])
const TEXTURE_EXTENSIONS = new Set(['ktx2'])

function inferFileName(pathValue: string): string {
  const trimmed = pathValue.trim().replace(/[\\/]+$/, '')
  const segments = trimmed.split(/[\\/]/)
  return segments[segments.length - 1] || 'Local Asset'
}

function inferMimeType(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  switch (extension) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'bmp':
      return 'image/bmp'
    case 'gif':
      return 'image/gif'
    case 'ktx2':
      return 'image/ktx2'
    case 'glb':
      return 'model/gltf-binary'
    case 'gltf':
      return 'model/gltf+json'
    case 'fbx':
      return 'application/octet-stream'
    default:
      return 'application/octet-stream'
  }
}

function decodeBase64(base64: string): Uint8Array {
  if (!base64.trim().length) {
    throw new AgentBridgeError('VALIDATION_FAILED', 'Asset payload is empty')
  }
  try {
    const binary = globalThis.atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  } catch {
    throw new AgentBridgeError('VALIDATION_FAILED', 'Asset payload is not valid base64')
  }
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.length <= bytes.length
    && signature.every((value, index) => bytes[index] === value)
}

function validateFileSignature(name: string, bytes: Uint8Array): void {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  if (
    IMAGE_EXTENSIONS.has(extension)
    && !TEXTURE_EXTENSIONS.has(extension)
    && !(
      (extension === 'png' && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      || ((extension === 'jpg' || extension === 'jpeg') && startsWith(bytes, [0xff, 0xd8, 0xff]))
      || (extension === 'webp' && startsWith(bytes, [0x52, 0x49, 0x46, 0x46]))
      || (extension === 'gif' && startsWith(bytes, [0x47, 0x49, 0x46, 0x38]))
      || (extension === 'bmp' && startsWith(bytes, [0x42, 0x4d]))
    )
  ) {
    throw new AgentBridgeError('VALIDATION_FAILED', `File ${name} does not match its image extension`)
  }
  if (extension === 'ktx2' && !startsWith(bytes, [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30])) {
    throw new AgentBridgeError('VALIDATION_FAILED', `File ${name} is not a valid KTX2 texture`)
  }
  if (extension === 'glb' && !startsWith(bytes, [0x67, 0x6c, 0x54, 0x46])) {
    throw new AgentBridgeError('VALIDATION_FAILED', `File ${name} is not a valid GLB model`)
  }
}

function resolveAssetType(item: HarmonyLocalAssetImportItem, name: string, mimeType: string): ProjectAsset['type'] {
  const requested = item.type && item.type !== 'auto' ? item.type : null
  if (requested) {
    return requested
  }
  return inferAssetType({
    mimeType,
    nameOrUrl: name,
    fallbackType: 'file',
  })
}

function summarizeItem(
  pathValue: string,
  asset: ProjectAsset,
  isNew: boolean,
  size: number,
): HarmonyAssetImportLocalItemResult {
  return {
    path: pathValue,
    assetId: asset.id,
    name: asset.name,
    type: asset.type,
    extension: asset.extension ?? null,
    size,
    isNew,
    imageWidth: typeof asset.imageWidth === 'number' ? asset.imageWidth : null,
    imageHeight: typeof asset.imageHeight === 'number' ? asset.imageHeight : null,
  }
}

export async function importLocalAssetsFromAgent(
  store: SceneStore,
  request: HarmonyAssetImportLocalRequest,
): Promise<HarmonyAssetImportLocalResult> {
  if (!store.isSceneReady || !store.currentSceneId) {
    throw new AgentBridgeError('SCENE_NOT_READY', 'The editor scene is not ready')
  }
  if (!Array.isArray(request.items) || request.items.length === 0) {
    throw new AgentBridgeError('VALIDATION_FAILED', 'items must contain at least one local asset')
  }
  if (request.items.length > HARMONY_AGENT_MAX_ASSET_IMPORT_FILES) {
    throw new AgentBridgeError(
      'VALIDATION_FAILED',
      `At most ${HARMONY_AGENT_MAX_ASSET_IMPORT_FILES} local assets may be imported at once`,
    )
  }
  if (
    typeof request.expectedRevision === 'number'
    && request.expectedRevision !== store.sceneRevision
  ) {
    throw new AgentBridgeError(
      'STALE_REVISION',
      `Expected scene revision ${request.expectedRevision}, current revision is ${store.sceneRevision}`,
      { expectedRevision: request.expectedRevision, currentRevision: store.sceneRevision },
    )
  }

  const decoded: Array<{
    item: HarmonyLocalAssetImportItem
    name: string
    mimeType: string
    type: ProjectAsset['type']
    bytes: Uint8Array
    file: File
  }> = []
  let totalBytes = 0

  for (const [index, item] of request.items.entries()) {
    if (!item || typeof item.path !== 'string' || !item.path.trim()) {
      throw new AgentBridgeError('VALIDATION_FAILED', `items[${index}].path must be a non-empty string`)
    }
    if (typeof item.base64 !== 'string' || !item.base64.length) {
      throw new AgentBridgeError('VALIDATION_FAILED', `items[${index}].base64 is required`)
    }
    const name = item.name?.trim() || inferFileName(item.path)
    const mimeType = item.mimeType?.trim() || inferMimeType(name)
    const bytes = decodeBase64(item.base64)
    if (bytes.byteLength > HARMONY_AGENT_MAX_ASSET_IMPORT_FILE_BYTES) {
      throw new AgentBridgeError(
        'VALIDATION_FAILED',
        `Asset ${name} exceeds the ${HARMONY_AGENT_MAX_ASSET_IMPORT_FILE_BYTES}-byte file limit`,
      )
    }
    if (typeof item.size === 'number' && item.size !== bytes.byteLength) {
      throw new AgentBridgeError(
        'VALIDATION_FAILED',
        `Asset ${name} decoded to ${bytes.byteLength} bytes but declared ${item.size}`,
      )
    }
    totalBytes += bytes.byteLength
    if (totalBytes > HARMONY_AGENT_MAX_ASSET_IMPORT_TOTAL_BYTES) {
      throw new AgentBridgeError(
        'VALIDATION_FAILED',
        `The asset batch exceeds the ${HARMONY_AGENT_MAX_ASSET_IMPORT_TOTAL_BYTES}-byte total limit`,
      )
    }
    validateFileSignature(name, bytes)
    const fileBuffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(fileBuffer).set(bytes)
    decoded.push({
      item,
      name,
      mimeType,
      type: resolveAssetType(item, name, mimeType),
      bytes,
      file: new File([fileBuffer], name, { type: mimeType }),
    })
  }

  const beforeSnapshot: SceneAssetCatalogSnapshot = store.snapshotAssetCatalog()
  const beforeRevision = store.sceneRevision
  const beforeAssetIds = new Set(store.collectCatalogAssetMap().keys())
  const results: HarmonyAssetImportLocalItemResult[] = []

  try {
    for (const entry of decoded) {
      const imported = await importLocalAssetFile(store, entry.file, {
        displayName: entry.name,
        type: entry.type,
        description: entry.name,
        directoryId: request.directoryId,
        autoSave: false,
      })
      results.push(summarizeItem(entry.item.path, imported.asset, imported.isNew, entry.bytes.byteLength))
    }

    const newCount = results.filter((entry) => entry.isNew).length
    if (newCount > 0) {
      store.commitAssetCatalogImport(beforeSnapshot)
    }
    if (request.select !== false && results.length) {
      store.selectedAssetId = results[results.length - 1]!.assetId
      store.ensureActiveDirectoryAndSelectionValid()
    }

    let saved = true
    if (newCount > 0) {
      const document = await store.flushPendingSceneAutoSave({ force: true })
      saved = Boolean(document)
    }
    return {
      beforeRevision,
      afterRevision: store.sceneRevision,
      saved,
      importedCount: newCount,
      reusedCount: results.length - newCount,
      items: results,
    }
  } catch (error) {
    store.restoreAssetCatalogSnapshot(beforeSnapshot)
    results
      .filter((entry) => entry.isNew && !beforeAssetIds.has(entry.assetId))
      .forEach((entry) => useAssetCacheStore().removeCache(entry.assetId))
    try {
      await store.flushPendingSceneAutoSave({ force: true })
    } catch {
      // Preserve the original import error.
    }
    throw error
  }
}
