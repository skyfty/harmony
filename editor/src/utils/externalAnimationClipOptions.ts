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

/**
 * 收集模型自带（内置）动画的 clip 选项。
 * 优先从运行时对象读取；若运行时对象尚未就绪（预览未构建/懒加载中），
 * 则直接解析节点引用的模型资产作为兜底，保证内置动画列表始终可展示。
 */
export async function collectBuiltInAnimationClipOptions(
  runtimeObject: Object3D | null | undefined,
  fallbackAssetId: string | null | undefined,
): Promise<AnimationClipOption[]> {
  const fromObject = collectAnimationClipCatalog(runtimeObject)
  if (fromObject.length) {
    return fromObject
  }
  if (!fallbackAssetId) {
    return []
  }
  const object = await getOrLoadExternalAnimationObject(
    fallbackAssetId,
    () => loadExternalAnimationObject(fallbackAssetId),
  )
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
  builtInFallbackAssetId?: string | null | undefined,
): Promise<AnimationClipOption[]> {
  const builtIn = await collectBuiltInAnimationClipOptions(runtimeObject, builtInFallbackAssetId)
  const external = externalAssetId ? await collectExternalAnimationClipOptions(externalAssetId) : []
  return mergeAnimationClipOptions(external, builtIn)
}
