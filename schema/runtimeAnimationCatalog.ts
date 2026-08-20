import * as THREE from 'three'
import { getCachedModelObject } from './modelObjectCache'

export type AnimationClipCatalogEntry = {
  label: string
  value: string
}

export function sanitizeAnimationClipName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export function resolveRuntimeAnimationClipSourceObject(runtimeObject: THREE.Object3D | null | undefined): THREE.Object3D | null {
  if (!runtimeObject) {
    return null
  }
  const instancedAssetId = runtimeObject.userData?.instancedAssetId as string | undefined
  if (instancedAssetId) {
    return getCachedModelObject(instancedAssetId)?.object ?? runtimeObject
  }
  const sourceAssetId = runtimeObject.userData?.sourceAssetId as string | undefined
  if (sourceAssetId) {
    return getCachedModelObject(sourceAssetId)?.object ?? runtimeObject
  }
  return runtimeObject
}

export function collectAnimationClips(runtimeObject: THREE.Object3D | null | undefined): THREE.AnimationClip[] {
  const sourceObject = resolveRuntimeAnimationClipSourceObject(runtimeObject)
  if (!sourceObject) {
    return []
  }

  const clips: THREE.AnimationClip[] = []
  const seen = new Set<THREE.AnimationClip>()

  const visit = (object: THREE.Object3D) => {
    const animations = (object as unknown as { animations?: THREE.AnimationClip[] })?.animations
    if (!Array.isArray(animations) || !animations.length) {
      return
    }
    animations.forEach((clip) => {
      if (!clip || seen.has(clip)) {
        return
      }
      seen.add(clip)
      clips.push(clip)
    })
  }

  visit(sourceObject)
  sourceObject.traverse((child) => {
    if (child === sourceObject) {
      return
    }
    visit(child)
  })

  return clips
}

export function collectAnimationClipCatalog(runtimeObject: THREE.Object3D | null | undefined): AnimationClipCatalogEntry[] {
  const sourceObject = resolveRuntimeAnimationClipSourceObject(runtimeObject)
  if (!sourceObject) {
    return []
  }

  const entries: AnimationClipCatalogEntry[] = []
  const seenValues = new Set<string>()

  const appendNamedClip = (clip: THREE.AnimationClip | null | undefined) => {
    const value = sanitizeAnimationClipName(clip?.name)
    if (!value || seenValues.has(value)) {
      return
    }
    seenValues.add(value)
    entries.push({ label: value, value })
  }

  const appendUserDataNames = (object: THREE.Object3D) => {
    const names = Array.isArray((object as any)?.userData?.__animations)
      ? ((object as any).userData.__animations as string[])
      : []
    names.forEach((name) => {
      const value = sanitizeAnimationClipName(name)
      if (!value || seenValues.has(value)) {
        return
      }
      seenValues.add(value)
      entries.push({ label: value, value })
    })
  }

  const visit = (object: THREE.Object3D) => {
    const animations = (object as unknown as { animations?: THREE.AnimationClip[] })?.animations
    if (Array.isArray(animations) && animations.length) {
      animations.forEach((clip) => appendNamedClip(clip))
    }
    appendUserDataNames(object)
  }

  visit(sourceObject)
  sourceObject.traverse((child) => {
    if (child === sourceObject) {
      return
    }
    visit(child)
  })

  return entries
}

/**
 * 合并内置与外部动画片段：同名 clip 以外部为准；外部独有的片段追加；
 * 没有外部片段时完全回退到内置动画。
 */
export function mergeAnimationClipsWithExternalPrecedence(
  builtInClips: THREE.AnimationClip[],
  externalClips: THREE.AnimationClip[],
): THREE.AnimationClip[] {
  const builtIn = Array.isArray(builtInClips) ? builtInClips : []
  const external = Array.isArray(externalClips) ? externalClips : []
  if (!external.length) {
    return [...builtIn]
  }
  if (!builtIn.length) {
    return [...external]
  }

  const byName = new Map<string, THREE.AnimationClip>()
  const unnamed: THREE.AnimationClip[] = []
  const remember = (clip: THREE.AnimationClip): void => {
    const name = sanitizeAnimationClipName(clip?.name)
    if (name) {
      // 后写入的（外部）覆盖先写入的（内置）。
      byName.set(name, clip)
    } else {
      unnamed.push(clip)
    }
  }

  builtIn.forEach(remember)
  external.forEach(remember)

  const merged: THREE.AnimationClip[] = []
  const seenNames = new Set<string>()
  builtIn.forEach((clip) => {
    const name = sanitizeAnimationClipName(clip?.name)
    if (name && !seenNames.has(name)) {
      seenNames.add(name)
      merged.push(byName.get(name) ?? clip)
    }
  })
  external.forEach((clip) => {
    const name = sanitizeAnimationClipName(clip?.name)
    if (name && !seenNames.has(name)) {
      seenNames.add(name)
      merged.push(clip)
    }
  })
  unnamed.forEach((clip) => {
    if (!merged.includes(clip)) {
      merged.push(clip)
    }
  })
  return merged
}

export function findAnimationClipByName(
  clips: THREE.AnimationClip[],
  clipName: string | null | undefined,
): THREE.AnimationClip | null {
  const normalizedName = sanitizeAnimationClipName(clipName)
  if (!normalizedName) {
    return null
  }
  return clips.find((clip) => sanitizeAnimationClipName(clip.name) === normalizedName) ?? null
}
