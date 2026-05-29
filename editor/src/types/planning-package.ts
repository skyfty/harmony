import {
  decode,
  encode,
  isPlainObject,
  normalizeString,
} from '@schema/core'
import type { PlanningSceneData } from './planning-scene-data'

export const PLANNING_SCENE_PACKAGE_VERSION = 1 as const

export interface PlanningScenePackageImageEntry {
  imageId: string
  imageHash: string | null
  resourcePath: string | null
  filename?: string | null
  mimeType?: string | null
}

export interface PlanningScenePackageOrthophotoEntry {
  sourceFileHash: string | null
  resourcePath: string | null
  filename?: string | null
  mimeType?: string | null
}

export interface PlanningScenePackageSidecar {
  version: typeof PLANNING_SCENE_PACKAGE_VERSION
  planningData: PlanningSceneData | null
  images: PlanningScenePackageImageEntry[]
  orthophoto?: PlanningScenePackageOrthophotoEntry | null
}

function normalizePlanningPackageImageEntry(raw: unknown): PlanningScenePackageImageEntry | null {
  if (!isPlainObject(raw)) {
    return null
  }
  const imageId = normalizeString(raw.imageId).trim()
  if (!imageId) {
    return null
  }
  const imageHash = normalizeString(raw.imageHash).trim()
  const resourcePath = normalizeString(raw.resourcePath).trim()
  return {
    imageId,
    imageHash: imageHash.length ? imageHash : null,
    resourcePath: resourcePath.length ? resourcePath : null,
    filename: typeof raw.filename === 'string' ? raw.filename : null,
    mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : null,
  }
}

export function normalizePlanningScenePackageSidecar(raw: unknown): PlanningScenePackageSidecar | null {
  if (!isPlainObject(raw)) {
    return null
  }
  const version = Number(raw.version)
  if (version !== PLANNING_SCENE_PACKAGE_VERSION) {
    return null
  }
  const planningData = isPlainObject(raw.planningData) ? (raw.planningData as unknown as PlanningSceneData) : null
  const images = Array.isArray(raw.images)
    ? raw.images.map((entry) => normalizePlanningPackageImageEntry(entry)).filter((entry): entry is PlanningScenePackageImageEntry => !!entry)
    : []
  return {
    version: PLANNING_SCENE_PACKAGE_VERSION,
    planningData,
    images,
    orthophoto: isPlainObject(raw.orthophoto)
      ? {
          sourceFileHash: (() => {
            const value = normalizeString(raw.orthophoto.sourceFileHash).trim()
            return value.length ? value : null
          })(),
          resourcePath: (() => {
            const value = normalizeString(raw.orthophoto.resourcePath).trim()
            return value.length ? value : null
          })(),
          filename: typeof raw.orthophoto.filename === 'string' ? raw.orthophoto.filename : null,
          mimeType: typeof raw.orthophoto.mimeType === 'string' ? raw.orthophoto.mimeType : null,
        }
      : null,
  }
}

export function serializePlanningScenePackageSidecar(sidecar: PlanningScenePackageSidecar): Uint8Array {
  return encode(sidecar)
}

export function deserializePlanningScenePackageSidecar(payload: ArrayBuffer | Uint8Array): PlanningScenePackageSidecar | null {
  try {
    const decoded = decode(payload instanceof Uint8Array ? payload : new Uint8Array(payload)) as unknown
    return normalizePlanningScenePackageSidecar(decoded)
  } catch (_error) {
    return null
  }
}
