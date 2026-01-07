import type { Vector3Like } from '@harmony/schema'
import type { NodePrefabData } from '@/types/node-prefab'

export type ClipboardMode = 'copy' | 'cut'

export interface QuaternionJson {
  x: number
  y: number
  z: number
  w: number
}

export interface ClipboardMetaPayload {
  pivotWorldPosition?: Vector3Like

  rootWorldPosition?: Vector3Like
  rootWorldRotation?: QuaternionJson
  rootWorldScale?: Vector3Like
}

export interface ClipboardMeta {
  mode?: ClipboardMode
  multiRoot?: boolean
  rootChildIds?: string[]
  meta?: ClipboardMetaPayload
}

export type ClipboardEnvelope = NodePrefabData & { clipboard?: ClipboardMeta }
