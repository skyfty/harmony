import { decode, encode } from '@msgpack/msgpack'
import type { SceneJsonExportDocument } from './index'

export function encodeScenePackageSceneDocument(document: SceneJsonExportDocument): Uint8Array {
  return encode(document)
}

export function decodeScenePackageSceneDocument(payload: ArrayBuffer | Uint8Array): SceneJsonExportDocument {
  const decoded = decode(payload instanceof Uint8Array ? payload : new Uint8Array(payload)) as unknown
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new Error('Invalid binary scene document payload')
  }
  const document = decoded as Partial<SceneJsonExportDocument>
  if (typeof document.id !== 'string' || !Array.isArray(document.nodes)) {
    throw new Error('Invalid binary scene document payload')
  }
  return decoded as SceneJsonExportDocument
}