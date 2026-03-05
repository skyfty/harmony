import type { AssetIndexEntry, SceneNode, Vector3Like } from '@schema'
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
  meta?: ClipboardMetaPayload
}

export interface ClipboardEnvelope {
  formatVersion: number
  name: string
  root?: SceneNode
  roots?: SceneNode[]
  assetIndex?: Record<string, AssetIndexEntry>
  packageAssetMap?: Record<string, string>
  clipboard?: ClipboardMeta
}

export type ClipboardPrefabEnvelope = NodePrefabData & { clipboard?: ClipboardMeta }
