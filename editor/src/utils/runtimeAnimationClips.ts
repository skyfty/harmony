import type { Object3D } from 'three'
import {
  collectAnimationClipCatalog,
  resolveRuntimeAnimationClipSourceObject,
} from '@schema/runtimeAnimationCatalog'

export type RuntimeClipOption = {
  label: string
  value: string
}

export { resolveRuntimeAnimationClipSourceObject }

export function collectRuntimeAnimationClipOptions(runtimeObject: Object3D | null | undefined): RuntimeClipOption[] {
  return collectAnimationClipCatalog(runtimeObject)
}
