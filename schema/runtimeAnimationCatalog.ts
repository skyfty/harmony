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
