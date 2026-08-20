import type { Object3D } from 'three'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { useSceneStore } from '@/stores/sceneStore'
import { createFileFromEntry } from '@schema/modelAssetLoader'
import { loadObjectFromFile } from '@schema/assetImport'
import { getOrLoadExternalAnimationObject } from '@schema/externalAnimationAssetCache'
import {
  collectAnimationClipCatalog,
  collectAnimationClips,
  sanitizeAnimationClipName,
} from '@schema/runtimeAnimationCatalog'

export type AnimationClipOption = { label: string; value: string }

/**
 * 合并内置与外部动画的 clip 选项：外部优先展示，同名去重（外部覆盖内置）。
 */
export function mergeAnimationClipOptions(
  external: AnimationClipOption[],
  builtIn: AnimationClipOption[],
): AnimationClipOption[] {
  const merged: AnimationClipOption[] = []
  const seen = new Set<string>()
  external.forEach((entry) => {
    if (entry.value && !seen.has(entry.value)) {
      seen.add(entry.value)
      merged.push(entry)
    }
  })
  builtIn.forEach((entry) => {
    if (entry.value && !seen.has(entry.value)) {
      seen.add(entry.value)
      merged.push(entry)
    }
  })
  return merged
}

export async function loadExternalAnimationObject(assetId: string): Promise<Object3D | null> {
  const assetCacheStore = useAssetCacheStore()
  const sceneStore = useSceneStore()
  const asset = sceneStore.collectCatalogAssetMap().get(assetId) ?? null
  const entry = await assetCacheStore.ensureAssetEntry(assetId, {
    asset: asset ?? undefined,
    contentHash: asset?.contentHash ?? assetId,
  })
  if (!entry) {
    return null
  }
  const file = createFileFromEntry(assetId, entry)
  if (!file) {
    return null
  }
  const ext = file.name.split('.').pop()?.toLowerCase()
  return loadObjectFromFile(file, ext)
}

export async function collectExternalAnimationClipOptions(assetId: string): Promise<AnimationClipOption[]> {
  const object = await getOrLoadExternalAnimationObject(assetId, () => loadExternalAnimationObject(assetId))
  if (!object) {
    return []
  }
  return collectAnimationClips(object)
    .map((clip) => {
      const value = sanitizeAnimationClipName(clip.name)
      return value ? { label: value, value } : null
    })
    .filter((entry): entry is AnimationClipOption => Boolean(entry))
}

export async function collectAnimationClipOptionsWithExternalAsset(
  runtimeObject: Object3D | null | undefined,
  externalAssetId: string | null | undefined,
): Promise<AnimationClipOption[]> {
  const builtIn = collectAnimationClipCatalog(runtimeObject)
  const external = externalAssetId ? await collectExternalAnimationClipOptions(externalAssetId) : []
  return mergeAnimationClipOptions(external, builtIn)
}
