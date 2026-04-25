import * as THREE from 'three'
import { getCachedModelObject } from '@schema/modelObjectCache'

export type RuntimeClipOption = {
  label: string
  value: string
}

export function resolveRuntimeAnimationClipSourceObject(runtimeObject: THREE.Object3D | null | undefined): THREE.Object3D | null {
  if (!runtimeObject) {
    return null
  }
  const instancedAssetId = runtimeObject.userData?.instancedAssetId as string | undefined
  if (!instancedAssetId) {
    return runtimeObject
  }
  return getCachedModelObject(instancedAssetId)?.object ?? runtimeObject
}

export function collectRuntimeAnimationClipOptions(runtimeObject: THREE.Object3D | null | undefined): RuntimeClipOption[] {
  const sourceObject = resolveRuntimeAnimationClipSourceObject(runtimeObject)
  if (!sourceObject) {
    return []
  }

  const clipOptions: RuntimeClipOption[] = []
  const seenValues = new Set<string>()

  const appendClip = (clip: THREE.AnimationClip | null | undefined, fallbackIndex: number) => {
    if (!clip) {
      return
    }
    const trimmed = typeof clip.name === 'string' ? clip.name.trim() : ''
    const value = trimmed
    const dedupeKey = value.length ? value : `__unnamed__:${fallbackIndex}`
    if (seenValues.has(dedupeKey)) {
      return
    }
    seenValues.add(dedupeKey)
    clipOptions.push({
      label: value.length ? value : `Clip ${fallbackIndex + 1}`,
      value,
    })
  }

  const appendUserDataNames = (object: THREE.Object3D) => {
    const names = Array.isArray((object as any)?.userData?.__animations)
      ? ((object as any).userData.__animations as string[])
      : []
    names.forEach((name) => {
      const trimmed = typeof name === 'string' ? name.trim() : ''
      if (!trimmed.length || seenValues.has(trimmed)) {
        return
      }
      seenValues.add(trimmed)
      clipOptions.push({ label: trimmed, value: trimmed })
    })
  }

  let unnamedClipIndex = 0
  const visit = (object: THREE.Object3D) => {
    const animations = (object as unknown as { animations?: THREE.AnimationClip[] })?.animations
    if (Array.isArray(animations) && animations.length) {
      animations.forEach((clip) => {
        appendClip(clip, unnamedClipIndex)
        unnamedClipIndex += 1
      })
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

  return clipOptions
}