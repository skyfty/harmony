import type { PlanningSceneData } from './planning-scene-data'

export const PLANNING_SCENE_PACKAGE_VERSION = 1 as const

export interface PlanningScenePackageImageEntry {
  imageId: string
  imageHash: string | null
  resourcePath: string | null
  filename?: string | null
  mimeType?: string | null
}

export interface PlanningScenePackageSidecar {
  version: typeof PLANNING_SCENE_PACKAGE_VERSION
  planningData: PlanningSceneData | null
  images: PlanningScenePackageImageEntry[]
}
