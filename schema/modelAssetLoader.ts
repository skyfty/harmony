import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type ResourceCache from './ResourceCache'
import type { AssetCacheEntry } from './assetCache'
import { Semaphore, withSemaphoreYielding } from './concurrency'
import type { SceneNodeImportMetadata } from './core'
import { getExtensionFromMimeType, getLastExtensionFromFilenameOrUrl } from './assetTypeConversion'

// GLB/FBX parsing (GLTFLoader.parse + geometry/material construction) is CPU
// bound and runs on the render main thread. Serialize parses so a burst of LOD
// switches cannot stack several synchronous parses back-to-back in one frame.
const modelParseSemaphore = new Semaphore(1)

let assetImportModulePromise: Promise<typeof import('./assetImport')> | null = null

async function loadAssetImportModule(): Promise<typeof import('./assetImport')> {
  if (!assetImportModulePromise) {
    assetImportModulePromise = import('./assetImport')
  }
  return assetImportModulePromise
}

function cloneImportedObject(source: THREE.Object3D): THREE.Object3D {
  const cloned = cloneSkinned(source)
  const sourceAnimations = (source as unknown as { animations?: THREE.AnimationClip[] })?.animations ?? []

  if (sourceAnimations.length) {
    const animations = sourceAnimations.map((clip) => clip.clone())
    ;(cloned as unknown as { animations?: THREE.AnimationClip[] }).animations = animations
    cloned.userData = cloned.userData ?? {}
    cloned.userData.__animations = animations.map((clip) => clip.name)
    return cloned
  }

  const userDataAnimationNames = Array.isArray((source as any)?.userData?.__animations)
    ? ((source as any).userData.__animations as string[]).filter((name) => typeof name === 'string' && name.trim().length)
    : []
  if (userDataAnimationNames.length) {
    cloned.userData = cloned.userData ?? {}
    cloned.userData.__animations = [...userDataAnimationNames]
  }

  return cloned
}

export function createFileFromEntry(assetId: string, entry: AssetCacheEntry): File | null {
  const filename = inferEntryFilename(assetId, entry)
  const mimeType = entry.mimeType ?? 'application/octet-stream'

  if (entry.blob instanceof File) {
    return entry.blob
  }

  if (entry.blob) {
    try {
      return new File([entry.blob], filename, { type: mimeType })
    } catch (_error) {
      /* noop */
    }
  }

  return null
}

function inferEntryFilename(assetId: string, entry: AssetCacheEntry): string {
  const explicitFilename = entry.filename?.trim()
  if (explicitFilename) {
    return explicitFilename
  }
  const extension =
    getLastExtensionFromFilenameOrUrl(entry.downloadUrl) ??
    getExtensionFromMimeType(entry.mimeType) ??
    'glb'
  return `${assetId}.${extension}`
}

export async function loadAssetObject(resourceCache: ResourceCache, assetId: string): Promise<THREE.Object3D | null> {
  if (!assetId) {
    return null
  }
  const entry = await resourceCache.acquireAssetEntry(assetId)
  if (!entry) {
    return null
  }
  const filename = inferEntryFilename(assetId, entry)
  const ext = filename.split('.').pop()?.toLowerCase()

  try {
    const { loadObjectFromBuffer, loadObjectFromFile } = await loadAssetImportModule()

    // Preferred path: parse straight from the bytes the downloader produced.
    // Wrapping them in a File and reading them back through FileReader adds a
    // full buffered copy, which is exactly the kind of main-thread work that
    // stalls the render loop on mini-program runtimes. The bytes are released
    // right after the parse so the cache keeps only the blob again.
    const bytes = resourceCache.getAssetBytes(assetId)
    if (bytes && bytes.byteLength > 0) {
      try {
        return await withSemaphoreYielding(modelParseSemaphore, () =>
          loadObjectFromBuffer(bytes, ext, { filename }),
        )
      } finally {
        resourceCache.releaseAssetBytes(assetId)
      }
    }

    const file = createFileFromEntry(assetId, entry)
    if (!file) {
      return null
    }
    const object = await withSemaphoreYielding(modelParseSemaphore, () => loadObjectFromFile(file, ext))
    return object
  } catch (error) {
    console.warn('[ModelAssetLoader] Failed to parse asset object', assetId, error)
    return null
  }
}

export function findObjectByPath(root: THREE.Object3D, path: number[] | null | undefined): THREE.Object3D | null {
  if (!Array.isArray(path) || !path.length) {
    return root
  }
  let current: THREE.Object3D | undefined = root
  for (const segment of path) {
    if (!current) {
      return null
    }
    const index = Number.isInteger(segment) ? segment : Number.NaN
    if (!Number.isFinite(index) || index < 0 || index >= current.children.length) {
      return null
    }
    current = current.children[index]
  }
  return current ?? null
}

/**
 * Drops every child object while keeping the object's own transform.
 *
 * Expanded lightweight import nodes render exactly one asset node each: the
 * asset children of that node are represented by scene child nodes, so keeping
 * them here would render them twice.
 */
export function stripObjectChildren(object: THREE.Object3D): THREE.Object3D {
  const children = object.children.slice()
  for (const child of children) {
    object.remove(child)
  }
  return object
}

export function cloneImportedObjectSelfOnly(source: THREE.Object3D): THREE.Object3D {
  return stripObjectChildren(cloneImportedObject(source))
}

/**
 * Clones one asset node (self only) out of an already parsed asset object.
 * Used when the asset is parsed once and many lightweight nodes reference
 * different nodes inside it.
 */
export function cloneAssetNodeSelfOnly(
  base: THREE.Object3D,
  path: number[] | null | undefined,
): THREE.Object3D | null {
  const target = findObjectByPath(base, path)
  if (!target) {
    return null
  }
  return cloneImportedObjectSelfOnly(target)
}

/**
 * Clones one asset node together with its asset children.
 *
 * Used for indivisible lightweight nodes (skinned subtrees): the skinned mesh
 * and its bones must stay in one clone, because `SkeletonUtils.clone` rebinds a
 * skeleton by looking the bones up inside the cloned tree.
 */
export function cloneAssetNodeSubtree(
  base: THREE.Object3D,
  path: number[] | null | undefined,
): THREE.Object3D | null {
  const target = findObjectByPath(base, path)
  if (!target) {
    return null
  }
  return cloneImportedObject(target)
}

/**
 * Loads a single asset node (no asset children) for a lightweight import node.
 * Geometry and materials stay shared with the cached asset object.
 */
export async function loadLightweightNodeObject(
  resourceCache: ResourceCache,
  assetId: string,
  metadata?: SceneNodeImportMetadata | null,
): Promise<THREE.Object3D | null> {
  if (!assetId) {
    return null
  }
  const base = await loadAssetObject(resourceCache, assetId)
  if (!base) {
    return null
  }
  const target = findObjectByPath(base, metadata?.objectPath)
  if (!target) {
    return null
  }
  return cloneImportedObjectSelfOnly(target)
}

export async function loadNodeObject(
  resourceCache: ResourceCache,
  assetId: string,
  metadata?: SceneNodeImportMetadata | null,
): Promise<THREE.Object3D | null> {
  const base = await loadAssetObject(resourceCache, assetId)
  if (!base) {
    return null
  }
  const target = findObjectByPath(base, metadata?.objectPath)
  if (!target) {
    return null
  }
  const cloned = cloneImportedObject(target)
  const sourceAnimations = (base as unknown as { animations?: THREE.AnimationClip[] })?.animations ?? []
  if (sourceAnimations.length && !(cloned as unknown as { animations?: THREE.AnimationClip[] })?.animations?.length) {
    const animations = sourceAnimations.map((clip) => clip.clone())
    ;(cloned as unknown as { animations?: THREE.AnimationClip[] }).animations = animations
    cloned.userData = cloned.userData ?? {}
    cloned.userData.__animations = animations.map((clip) => clip.name)
    console.info('[ModelAssetLoader] Applied asset animations to node object', {
      assetId,
      objectPath: metadata?.objectPath ?? null,
      targetName: target.name ?? null,
      animationNames: animations.map((clip) => clip.name),
    })
  }
  return cloned
}
