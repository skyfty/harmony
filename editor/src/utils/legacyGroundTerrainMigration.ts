import {
  type GroundDynamicMesh,
  type SceneNode,
} from '@schema'
import { resolveGroundCreationProfile } from '@/stores/groundUtils'
import type { StoredSceneDocument } from '@/types/stored-scene-document'

type LegacyGroundTerrainUpgradeResult = {
  converted: boolean
  convertedGroundCount: number
}

function isLegacyGroundNode(dynamicMesh: { type?: unknown } | null | undefined): dynamicMesh is GroundDynamicMesh {
  const candidate = dynamicMesh as Record<string, unknown> | null | undefined
  return Boolean(
    dynamicMesh
    && dynamicMesh.type === 'Ground'
    && (
      candidate?.editTileSizeMeters === undefined
      || candidate?.editTileResolution === undefined
    ),
  )
}

function upgradeGroundNodeTerrainMetadata(
  node: SceneNode,
): boolean {
  const dynamicMesh = node.dynamicMesh
  if (!isLegacyGroundNode(dynamicMesh)) {
    return false
  }

  const nextDynamicMesh = dynamicMesh as GroundDynamicMesh & Record<string, unknown>
  if (nextDynamicMesh.editTileSizeMeters === undefined) {
    const creationProfile = resolveGroundCreationProfile(0, 0, dynamicMesh.cellSize)
    nextDynamicMesh.editTileSizeMeters = creationProfile.editTileSizeMeters
  }
  if (nextDynamicMesh.editTileResolution === undefined) {
    const creationProfile = resolveGroundCreationProfile(0, 0, dynamicMesh.cellSize)
    nextDynamicMesh.editTileResolution = creationProfile.editTileResolution
  }
  return true
}

export function migrateLegacyGroundTerrainDocument(
  document: StoredSceneDocument,
  options: { hasLegacyHeightSidecar?: boolean } = {},
): LegacyGroundTerrainUpgradeResult {
  if (!document || !Array.isArray(document.nodes)) {
    return { converted: false, convertedGroundCount: 0 }
  }

  let convertedGroundCount = 0
  for (const node of document.nodes) {
    if (!node || node.dynamicMesh?.type !== 'Ground') {
      continue
    }
    const converted = upgradeGroundNodeTerrainMetadata(node)
    if (converted) {
      convertedGroundCount += 1
    }
  }

  return {
    converted: convertedGroundCount > 0,
    convertedGroundCount,
  }
}