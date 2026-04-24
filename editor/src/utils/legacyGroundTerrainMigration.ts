import {
  GROUND_TERRAIN_PACKAGE_FORMAT,
  GROUND_TERRAIN_PACKAGE_VERSION,
  buildGroundTerrainTileEntries,
  type GroundDynamicMesh,
  type GroundTerrainPackageManifest,
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
      candidate?.storageMode === undefined
      || candidate?.tileResolution === undefined
      || candidate?.globalLodCellSize === undefined
      || candidate?.activeEditWindowRadius === undefined
      || candidate?.collisionMode === undefined
    ),
  )
}

function buildLegacyGroundTerrainManifest(
  sceneId: string,
  mesh: GroundDynamicMesh,
  coarseTerrainPath: string | null,
): GroundTerrainPackageManifest {
  const creationProfile = resolveGroundCreationProfile(mesh.width, mesh.depth, mesh.cellSize)
  const tileResolution = Math.max(1, Math.trunc(mesh.tileResolution ?? creationProfile.tileResolution))
  const terrainTilesRootPath = `scenes/${encodeURIComponent(sceneId)}/ground-tiles/`
  const collisionManifestPath = `scenes/${encodeURIComponent(sceneId)}/ground-collision.json`
  return {
    format: GROUND_TERRAIN_PACKAGE_FORMAT,
    version: GROUND_TERRAIN_PACKAGE_VERSION,
    scenePath: `scenes/${encodeURIComponent(sceneId)}/scene.bin`,
    storageMode: 'tiled',
    width: mesh.width,
    depth: mesh.depth,
    rows: mesh.rows,
    columns: mesh.columns,
    cellSize: mesh.cellSize,
    tileSizeMeters: Math.max(128, Math.round(mesh.tileSizeMeters ?? creationProfile.tileSizeMeters)),
    tileResolution,
    globalLodCellSize: Math.max(1, Math.round(mesh.globalLodCellSize ?? creationProfile.globalLodCellSize)),
    activeEditWindowRadius: Math.max(1, Math.round(mesh.activeEditWindowRadius ?? creationProfile.activeEditWindowRadius)),
    collisionMode: mesh.collisionMode ?? creationProfile.collisionMode,
    coarseTerrainPath,
    terrainTilesRootPath,
    collisionManifestPath,
    tiles: buildGroundTerrainTileEntries({
      rows: mesh.rows,
      columns: mesh.columns,
      tileResolution,
      terrainTilesRootPath,
      collisionRootPath: `scenes/${encodeURIComponent(sceneId)}/ground-collision/`,
    }) as GroundTerrainPackageManifest['tiles'],
  }
}

function upgradeGroundNodeTerrainMetadata(
  sceneId: string,
  node: SceneNode,
  options: { hasLegacyHeightSidecar?: boolean } = {},
): boolean {
  const dynamicMesh = node.dynamicMesh
  if (!isLegacyGroundNode(dynamicMesh)) {
    return false
  }

  const creationProfile = resolveGroundCreationProfile(dynamicMesh.width, dynamicMesh.depth, dynamicMesh.cellSize)
  const nextDynamicMesh = dynamicMesh as GroundDynamicMesh & Record<string, unknown>
  if (nextDynamicMesh.storageMode === undefined) {
    nextDynamicMesh.storageMode = creationProfile.storageMode
  }
  if (nextDynamicMesh.tileSizeMeters === undefined) {
    nextDynamicMesh.tileSizeMeters = creationProfile.tileSizeMeters
  }
  if (nextDynamicMesh.tileResolution === undefined) {
    nextDynamicMesh.tileResolution = creationProfile.tileResolution
  }
  if (nextDynamicMesh.globalLodCellSize === undefined) {
    nextDynamicMesh.globalLodCellSize = creationProfile.globalLodCellSize
  }
  if (nextDynamicMesh.activeEditWindowRadius === undefined) {
    nextDynamicMesh.activeEditWindowRadius = creationProfile.activeEditWindowRadius
  }
  if (nextDynamicMesh.collisionMode === undefined) {
    nextDynamicMesh.collisionMode = creationProfile.collisionMode
  }
  if (nextDynamicMesh.chunkStreamingEnabled === undefined) {
    nextDynamicMesh.chunkStreamingEnabled = creationProfile.storageMode === 'tiled'
  }

  const existingUserData = node.userData && typeof node.userData === 'object'
    ? (node.userData as Record<string, unknown>)
    : {}
  const hasExistingTerrainManifest = Boolean(existingUserData.groundTerrainPackageManifest) || typeof existingUserData.groundTerrainManifestPath === 'string'

  if (creationProfile.storageMode !== 'tiled' || hasExistingTerrainManifest) {
    return true
  }

  const coarseTerrainPath = options.hasLegacyHeightSidecar ? `scenes/${encodeURIComponent(sceneId)}/ground-heightmaps.bin` : null
  const manifest = buildLegacyGroundTerrainManifest(sceneId, nextDynamicMesh, coarseTerrainPath)
  node.userData = {
    ...existingUserData,
    groundTerrainPackageManifest: manifest,
    groundTerrainManifestPath: `scenes/${encodeURIComponent(sceneId)}/ground-terrain.json`,
    groundTerrainTilesRootPath: manifest.terrainTilesRootPath,
    groundCollisionPath: manifest.collisionManifestPath,
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
    const converted = upgradeGroundNodeTerrainMetadata(document.id, node, options)
    if (converted) {
      convertedGroundCount += 1
    }
  }

  return {
    converted: convertedGroundCount > 0,
    convertedGroundCount,
  }
}