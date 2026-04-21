import { isPlanningImageConversionNode } from '@/utils/planningToScene'

import { watch, type WatchStopHandle } from 'vue'
import * as THREE from 'three'
import { defineStore } from 'pinia'
import {
  Matrix4,
  Quaternion,
  Vector3,
  Euler,
  Box3,
  MathUtils,
  Color,
  PerspectiveCamera,
  OrthographicCamera,
  BackSide,
  DoubleSide,
  Object3D,
  type Texture,
  type Material,
  type Light,
} from 'three'
import type { EnvironmentSettings, EnvironmentSettingsPatch } from '@/types/environment'
import {
  GROUND_NODE_ID,
  ENVIRONMENT_NODE_ID,
  MULTIUSER_NODE_ID,
  PROTAGONIST_NODE_ID,
  createPrimitiveMesh,
  resolveServerAssetDownloadUrl,
  WATER_SURFACE_MESH_USERDATA_KEY,
  cloneWaterSurfaceMeshMetadata,
  createWaterSurfaceRuntimeMesh,
  extractWaterSurfaceMeshMetadataFromUserData,
  normalizeWaterSurfaceMeshInput,
} from '@schema'
import { DEFAULT_COLOR, DEFAULT_INTENSITY } from '@schema/lightDefaults'
import type {
  AssetSourceMetadata,
  BehaviorComponentProps,
  BehaviorEventType,
  CameraNodeProperties,
  GroundDynamicMesh,
  GroundGenerationSettings,
  GroundSettings,
  LightNodeProperties,
  LightNodeType,
  NodeComponentType,
  SceneBehavior,
  SceneDynamicMesh,
  SceneNode,
  SceneNodeComponentMap,
  SceneNodeComponentState,
  SceneNodeEditorFlags,
  SceneNodeInstanceLayout,
  SceneNodeType,
  SceneAssetOverrideEntry,
  SceneAssetRegistryEntry,
  Vector2Like,
  Vector3Like,
  WallDynamicMesh,
  RoadDynamicMesh,
  FloorDynamicMesh,
  LandformDynamicMesh,
  GuideRouteDynamicMesh,
  RegionDynamicMesh,
} from '@schema'
import { normalizeNodeComponents } from './normalizeNodeComponentsUtils'
import { stableSerialize } from '@schema/stableSerialize'
import { normalizeLightNodeType } from '@/types/light'
import lightUtils from './lightUtils'
import type { NodePrefabData } from '@/types/node-prefab'
import type { ClipboardEnvelope, ClipboardMeta, QuaternionJson } from '@/types/prefab'
import type { DetachResult } from '@/types/detach-result'
import type { DuplicateContext } from '@/types/duplicate-context'
import type { EditorTool } from '@/types/editor-tool'
import type { EnsureSceneAssetsOptions } from '@/types/ensure-scene-assets-options'
import type { PanelVisibilityState } from '@/types/panel-visibility-state'
import type { PanelPlacementState, PanelPlacement } from '@/types/panel-placement-state'
import type { HierarchyTreeItem } from '@/types/hierarchy-tree-item'
import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import { resourceProviders } from '@/resources/projectProviders'
import { getExtensionFromMimeType } from '@schema'
import type { SceneCameraState } from '@/types/scene-camera-state'
import type {
  SceneHistoryEntry,
  SceneHistoryNodeLocation,
  SceneHistoryNodeStructureOp,
  SceneHistoryTransformSnapshot,
} from '@/types/scene-history-entry'
import type { SceneState } from '@/types/scene-state'
import type { StoredSceneDocument } from '@/types/stored-scene-document'
import type { PlanningSceneData } from '@/types/planning-scene-data'
import { useProjectsStore } from '@/stores/projectsStore'
import type { TransformUpdatePayload } from '@/types/transform-update-payload'
import type { SceneViewportSettings, SceneViewportSnapMode } from '@/types/scene-viewport-settings'
import type {
  AssetManifest,
  AssetManifestAsset,
  AssetManifestDirectory,
  ClipboardEntry,
  SceneMaterialTextureSlot,
  CameraControlMode,
  CameraProjection,
  SceneResourceSummary,
  SceneResourceSummaryEntry,
} from '@schema'
import {
  deleteTerrainScatterStore,
  getTerrainScatterStore,
  type TerrainScatterStoreSnapshot,
} from '@schema/terrain-scatter'
import builtinWaterNormalUrl from '@schema/waternormal.jpg'
import {
  BUILTIN_WATER_NORMAL_ASSET_ID,
  BUILTIN_WATER_NORMAL_FILENAME,
  isBuiltinWaterNormalAsset,
} from '@/constants/builtinAssets'

export { GROUND_NODE_ID, ENVIRONMENT_NODE_ID, MULTIUSER_NODE_ID, PROTAGONIST_NODE_ID }

import { normalizeDynamicMeshType } from '@/types/dynamic-mesh'
import {
  buildAssetDependencySubset,
  sanitizeSceneAssetRegistry,
  shouldAssetDefaultToEditorOnly,
  shouldHideDependantAssetInEditor,
  shouldExcludeAssetFromRuntimeExport,
} from '@/utils/assetDependencySubset'
import {
  normalizeAssetIdWithRegistry,
  normalizeAssetIdsWithRegistry,
} from '@/utils/assetRegistryIdNormalization'
import { createServerAssetSource, isServerBackedProviderId, SERVER_ASSET_PROVIDER_ID } from '@/utils/serverAssetSource'
import { createFloorNodeMaterials } from '@/utils/floorNodeMaterials'
import { createLandformNodeMaterials } from '@/utils/landformNodeMaterials'
import { readServerDownloadBaseUrl } from '@/api/serverApiConfig'
import {
  buildFloorDynamicMeshPresetPatch,
  buildFloorNodeMaterialsFromPreset,
} from '@/utils/floorPresetNodeMaterials'
import { buildRoadNodeMaterialsFromPreset } from '@/utils/roadPresetNodeMaterials'
import { createWallNodeMaterials } from '@/utils/wallNodeMaterials'
import type {
  SceneMaterial,
  SceneMaterialProps,
  SceneMaterialTextureRef,
  SceneMaterialType,
  SceneNodeMaterial,
} from '@/types/material'

import {
  cloneTextureSettings,
  DEFAULT_SCENE_MATERIAL_ID,
  DEFAULT_SCENE_MATERIAL_TYPE,
  MATERIAL_TEXTURE_SLOTS,
} from '@/types/material'
import { createBehaviorSequenceId } from '@schema/behaviors/definitions'
import { findObjectByPath } from '@schema/modelAssetLoader'

import { useAssetCacheStore } from './assetCacheStore'
import { useGroundHeightmapStore, type GroundRuntimeDynamicMesh } from './groundHeightmapStore'
import { attachGroundScatterRuntimeToNode, useGroundScatterStore } from './groundScatterStore'
import { attachGroundPaintRuntimeToNode, useGroundPaintStore } from './groundPaintStore'
import { useUiStore } from './uiStore'
import { useScenesStore, type SceneWorkspaceType } from './scenesStore'
import { updateSceneAssets } from './ensureSceneAssetsReady'
import { useClipboardStore } from './clipboardStore'
import { loadObjectFromFile } from '@schema/assetImport'
import { markGroundOptimizedMeshReady, sampleGroundHeight } from '@schema/groundMesh'
import { generateUuid } from '@/utils/uuid'
import {
  computeInstanceLayoutGridCenterOffsetLocal,
  resolveInstanceLayoutTemplateAssetId,
} from '@schema/instanceLayout'
import {
  getCachedModelObject,
  getOrLoadModelObject,
  allocateModelInstance,
  releaseModelInstance,
  updateModelInstanceMatrix,
  ensureInstancedMeshesRegistered,
  type ModelInstanceGroup,
} from '@schema/modelObjectCache'
import { createWallGroup, updateWallGroup } from '@schema/wallMesh'
import { createRoadGroup, resolveRoadLocalHeightSampler } from '@schema/roadMesh'
import { createFloorGroup, updateFloorGroup } from '@schema/floorMesh'
import { createLandformGroup, updateLandformGroup } from '@schema/landformMesh'
import { createGuideRouteGroup } from '@schema/guideRouteMesh'
import { buildRegionDynamicMeshFromLocalVertices, buildRegionDynamicMeshFromWorldPoints } from '@schema/regionUtils'
import { computeBlobHash, blobToDataUrl, extractExtension } from '@/utils/blob'
import { ASSET_THUMBNAIL_HEIGHT, ASSET_THUMBNAIL_WIDTH } from '@/utils/assetThumbnail'
import type { BehaviorPrefabData } from '@/utils/behaviorPrefab'
import {
  buildMaterialAssetFilename,
  collectMaterialAssetDependencyIds,
  createMaterialAssetTextureResolver,
  parseMaterialAssetDocument,
  renderMaterialThumbnailDataUrl,
  serializeMaterialAsset,
} from '@/utils/materialAsset'
import {
  type LodPresetData,
} from '@/utils/lodPreset'
import { createLodPresetActions } from './lodPresetActions'
import { type WallPresetData } from '@/utils/wallPreset'
import { type FloorPresetData } from '@/utils/floorPreset'
import { type LandformPresetData } from '@/utils/landformPreset'
import { type RoadPresetData, buildRoadComponentPatchFromPreset } from '@/utils/roadPreset'
import {
  BUILTIN_WALL_PRESET_ASSETS,
  buildWallComponentPropsPatchFromPreset,
  createWallPresetActions,
} from './wallPresetActions'
import { createFloorPresetActions } from './floorPresetActions'
import { createLandformPresetActions } from './landformPresetActions'
import { createRoadPresetActions } from './roadPresetActions'
import { createSceneStoreFloorHelpers } from './sceneStoreFloor'
import { createSceneStoreLandformHelpers } from './sceneStoreLandform'
import { visitExplicitComponentAssetReferences } from '../utils/sceneExplicitAssetReferences'
import { createSceneStoreWallHelpers } from './sceneStoreWall'
import { mergeUserDataWithWaterBuildShape, isWaterSurfaceNode } from '@/utils/waterBuildShapeUserData'
import type { WaterBuildShape } from '@/types/water-build-shape'
import {
  createNodePrefabHelpers,
  createPrefabActions,
  normalizePrefabName,
  stopPrefabPlaceholderWatcher,
  type PrefabActionsDeps,
  type PrefabStoreLike,
} from './prefabActions'
import {
  collectDirectSceneAssetReferenceIds,
  collectRuntimeRequiredConfigAssetIds,
  collectSceneAssetReferences,
  collectEditorOnlyConfigAssetIdsFromCatalog,
  collectRetainedAssetIdsForSceneCleanup,
  pruneAssetCatalogByRetainedIds,
  collectTransitiveConfigDependencyAssetIds,
} from './sceneAssetCleanup'
import {
  AI_MODEL_MESH_USERDATA_KEY,
  createBufferGeometryFromMetadata,
  extractAiModelMeshMetadataFromUserData,
  normalizeAiModelMeshInput,
  type AiModelMeshMetadata,
} from '@/utils/aiModelMesh'

import {
  ASSET_CATEGORY_CONFIG,
  cloneAssetList,
  cloneProjectTree,
  createEmptyAssetCatalog,
  createProjectTreeFromCache,
  defaultDirectoryId,
  determineAssetCategoryId,
  isPackageDirectoryPath,
  normalizePackageProviderDirectories,
  ASSETS_ROOT_DIRECTORY_ID,
  PACKAGES_ROOT_DIRECTORY_ID,
} from './assetCatalog'
import { rebuildProceduralRuntimeObjects } from '@/utils/proceduralRuntime'
import { resetScatterInstanceBinding } from '@/utils/terrainScatterRuntime'
import { loadStoredScenesFromScenePackage } from '@/utils/scenePackageImport'
import { persistPlanningImageLayersToIndexedDB } from '@/utils/planningImageStorage'
import { installPlanningImagesResolver } from '@/utils/planningImageComponentResolver'
import { rebuildOptimizedGroundMeshForDefinition } from '@/utils/groundOptimizedMeshExport'
import type {
  BillboardComponentProps,
  DisplayBoardComponentProps,
  EffectComponentProps,
  GuideRouteComponentProps,
  GuideRouteWaypoint,
  GuideboardComponentProps,
  NominateComponentProps,
  OnlineComponentProps,
  ProtagonistComponentProps,
  RigidbodyComponentProps,
  AutoTourComponentProps,
  VehicleComponentProps,
  VehicleWheelProps,
  ViewPointComponentProps,
  WallComponentProps,
  RoadComponentProps,
  FloorComponentProps,
  LandformComponentProps,
  PlanningImagesComponentProps,
  WarpGateComponentProps,
  WaterComponentProps,
} from '@schema/components'
import {
  WALL_COMPONENT_TYPE,
  ROAD_COMPONENT_TYPE,
  GUIDE_ROUTE_COMPONENT_TYPE,
  GUIDEBOARD_COMPONENT_TYPE,
  VIEW_POINT_COMPONENT_TYPE,
  WARP_GATE_COMPONENT_TYPE,
  DISPLAY_BOARD_COMPONENT_TYPE,
  BILLBOARD_COMPONENT_TYPE,
  EFFECT_COMPONENT_TYPE,
  PROTAGONIST_COMPONENT_TYPE,
  ONLINE_COMPONENT_TYPE,
  BEHAVIOR_COMPONENT_TYPE,
  RIGIDBODY_COMPONENT_TYPE,
  VEHICLE_COMPONENT_TYPE,
  AUTO_TOUR_COMPONENT_TYPE,
  WALL_DEFAULT_HEIGHT,
  WALL_DEFAULT_REPEAT_INSTANCE_STEP,
  WALL_DEFAULT_THICKNESS,
  WALL_DEFAULT_WIDTH,
  clampWallProps,
  cloneWallComponentProps,
  ROAD_DEFAULT_WIDTH,
  ROAD_MIN_WIDTH,
  resolveRoadComponentPropsFromMesh,
  clampRoadProps,
  cloneRoadComponentProps,
  buildGuideRouteWaypointsFromPositions,
  clampDisplayBoardComponentProps,
  cloneDisplayBoardComponentProps,
  clampBillboardComponentProps,
  cloneBillboardComponentProps,
  clampWarpGateComponentProps,
  cloneWarpGateComponentProps,
  clampEffectComponentProps,
  cloneEffectComponentProps,
  clampRigidbodyComponentProps,
  cloneRigidbodyComponentProps,
  clampVehicleComponentProps,
  cloneVehicleComponentProps,
  componentManager,
  resolveWallComponentPropsFromMesh,
  FLOOR_COMPONENT_TYPE,
  clampFloorComponentProps,
  cloneFloorComponentProps,
  resolveFloorComponentPropsFromMesh,
  FLOOR_DEFAULT_SMOOTH,
  FLOOR_DEFAULT_THICKNESS,
  FLOOR_DEFAULT_SIDE_UV_SCALE,
  FLOOR_MAX_THICKNESS,
  FLOOR_MIN_THICKNESS,
  LANDFORM_COMPONENT_TYPE,
  clampLandformComponentProps,
  cloneLandformComponentProps,
  resolveLandformComponentPropsFromMesh,
  
  WATER_COMPONENT_TYPE,
  clampWaterComponentProps,
  cloneWaterComponentProps,
  PLANNING_IMAGES_COMPONENT_TYPE,
  clampPlanningImagesComponentProps,
  clonePlanningImagesComponentProps,
  NOMINATE_COMPONENT_TYPE,
  clampNominateComponentProps,
  cloneNominateComponentProps,
} from '@schema/components'
import {
  LOD_COMPONENT_TYPE,
  type LodComponentProps,
} from '@schema/components'

export {
  ASSETS_ROOT_DIRECTORY_ID,
  buildPackageDirectoryId,
  extractProviderIdFromPackageDirectoryId,
  getSingleVisiblePackageProviderId,
} from './assetCatalog'

export type EditorPanel = 'hierarchy' | 'inspector' | 'project'

export type HierarchyDropPosition = 'before' | 'after' | 'inside'

type NodeComponentPropsByType = {
  [WALL_COMPONENT_TYPE]: WallComponentProps
  [ROAD_COMPONENT_TYPE]: RoadComponentProps
  [FLOOR_COMPONENT_TYPE]: FloorComponentProps
  [LANDFORM_COMPONENT_TYPE]: LandformComponentProps
  [WATER_COMPONENT_TYPE]: WaterComponentProps
  [GUIDE_ROUTE_COMPONENT_TYPE]: GuideRouteComponentProps
  [GUIDEBOARD_COMPONENT_TYPE]: GuideboardComponentProps
  [VIEW_POINT_COMPONENT_TYPE]: ViewPointComponentProps
  [WARP_GATE_COMPONENT_TYPE]: WarpGateComponentProps
  [DISPLAY_BOARD_COMPONENT_TYPE]: DisplayBoardComponentProps
  [BILLBOARD_COMPONENT_TYPE]: BillboardComponentProps
  [PLANNING_IMAGES_COMPONENT_TYPE]: PlanningImagesComponentProps
  [EFFECT_COMPONENT_TYPE]: EffectComponentProps
  [PROTAGONIST_COMPONENT_TYPE]: ProtagonistComponentProps
  [ONLINE_COMPONENT_TYPE]: OnlineComponentProps
  [BEHAVIOR_COMPONENT_TYPE]: BehaviorComponentProps
  [RIGIDBODY_COMPONENT_TYPE]: RigidbodyComponentProps
  [VEHICLE_COMPONENT_TYPE]: VehicleComponentProps
  [AUTO_TOUR_COMPONENT_TYPE]: AutoTourComponentProps
  [LOD_COMPONENT_TYPE]: LodComponentProps
  [NOMINATE_COMPONENT_TYPE]: NominateComponentProps
}

type NodeComponentPropsOf<T extends NodeComponentType> = T extends keyof NodeComponentPropsByType
  ? NodeComponentPropsByType[T]
  : Record<string, unknown>

type AddNodeComponentResult<T extends NodeComponentType> = {
  component: SceneNodeComponentState<NodeComponentPropsOf<T>>
  created: boolean
}

type ResolvedPlaceableAsset = {
  requestedAsset: ProjectAsset
  modelAsset: ProjectAsset
  lodPresetAssetId: string | null
  lodPresetData: LodPresetData | null
}

type PreparedLodAssetResult = {
  requestedAsset: ProjectAsset
  modelAsset: ProjectAsset
  preset: LodPresetData
}

installPlanningImagesResolver()

function inferVehicleWheelsFromNode(
  chassisNode: SceneNode,
  axisIndexForward: number,
): Array<Partial<VehicleWheelProps>> {
  return vehicleUtils.inferVehicleWheelsFromNodeWithDeps({ generateUuid }, chassisNode, axisIndexForward) as Array<Partial<VehicleWheelProps>>
}

export const SCENE_BUNDLE_FORMAT_VERSION = 1

export interface SceneBundleExportPayload {
  formatVersion: number
  exportedAt: string
  scenes: StoredSceneDocument[]
}

export interface SceneBundleExportOptions {
  embedResources: boolean
}

export interface SceneBundleImportScene {
  [key: string]: unknown
}

export interface SceneBundleImportPayload {
  formatVersion: number
  scenes: SceneBundleImportScene[]
}

export interface SceneImportResult {
  importedSceneIds: string[]
  renamedScenes: Array<{ originalName: string; renamedName: string }>
}

export const IMPORT_TEXTURE_SLOT_MAP: Array<{ slot: SceneMaterialTextureSlot; key: string }> = [
  { slot: 'albedo', key: 'map' },
  { slot: 'normal', key: 'normalMap' },
  { slot: 'metalness', key: 'metalnessMap' },
  { slot: 'roughness', key: 'roughnessMap' },
  { slot: 'ao', key: 'aoMap' },
  { slot: 'emissive', key: 'emissiveMap' },
  { slot: 'displacement', key: 'displacementMap' },
]

const HISTORY_LIMIT = 50
const MATERIAL_EDIT_HISTORY_WINDOW_MS = 400

// Used to suppress history snapshot creation during bulk operations.
// Module-scoped because the editor typically has a single scene store instance.
let historyCaptureSuppressionDepth = 0

// Used to suppress scene patch version bumps during bulk operations.
// Prevents repeated viewport refreshes when creating/moving many nodes.
let scenePatchSuppressionDepth = 0
let pendingSceneGraphStructureVersionBump = false
let pendingSceneNodePropertyVersionBump = false
let pendingSuppressedScenePatchRequiresFullSync = false
const activeMaterialEditHistoryKeys = new Set<string>()
const materialEditHistoryTimers = new Map<string, ReturnType<typeof setTimeout>>()

const PLANNING_CONVERSION_ROOT_TAG = 'planningConversionRoot'

const LOCAL_EMBEDDED_ASSET_PREFIX = 'local::'

function isExportablePackageProviderId(providerId: string | null | undefined): boolean {
  const normalizedProviderId = typeof providerId === 'string' ? providerId.trim() : ''
  if (!normalizedProviderId) {
    return false
  }
  if (normalizedProviderId === 'builtin') {
    return false
  }
  return true
}

function isExportablePackageZipPath(zipPath: string | null | undefined): boolean {
  const normalizedZipPath = typeof zipPath === 'string' ? zipPath.trim() : ''
  if (!normalizedZipPath) {
    return false
  }
  if (normalizedZipPath.startsWith(LOCAL_EMBEDDED_ASSET_PREFIX)) {
    return true
  }
  const inferred = inferPackageSourceFromAssetId(normalizedZipPath)
  if (!inferred || inferred.type !== 'package') {
    return false
  }
  return isExportablePackageProviderId(inferred.providerId)
}

function shouldReuseExistingRegistryEntryForExport(
  entry: SceneAssetRegistryEntry | null | undefined,
): entry is SceneAssetRegistryEntry {
  if (!entry || typeof entry !== 'object') {
    return false
  }
  if (entry.sourceType !== 'package') {
    return true
  }
  return isExportablePackageZipPath(entry.zipPath)
}

function inferPackageSourceFromAssetId(assetId: string): AssetSourceMetadata | undefined {
  const normalizedAssetId = typeof assetId === 'string' ? assetId.trim() : ''
  if (!normalizedAssetId || normalizedAssetId.startsWith(LOCAL_EMBEDDED_ASSET_PREFIX)) {
    return undefined
  }
  const delimiterIndex = normalizedAssetId.indexOf('::')
  if (delimiterIndex <= 0 || delimiterIndex >= normalizedAssetId.length - 2) {
    return undefined
  }
  const providerId = normalizedAssetId.slice(0, delimiterIndex).trim()
  const originalAssetId = normalizedAssetId.slice(delimiterIndex + 2).trim()
  if (!providerId || !originalAssetId) {
    return undefined
  }
  if (!isExportablePackageProviderId(providerId)) {
    return undefined
  }
  return {
    type: 'package',
    providerId,
    originalAssetId,
  }
}

function inferPackageSourceFromRegistryEntry(
  entry: SceneAssetRegistryEntry | null | undefined,
): AssetSourceMetadata | undefined {
  if (!entry || entry.sourceType !== 'package') {
    return undefined
  }
  const zipPath = typeof entry.zipPath === 'string' ? entry.zipPath.trim() : ''
  if (!zipPath || zipPath.startsWith(LOCAL_EMBEDDED_ASSET_PREFIX)) {
    return undefined
  }
  return inferPackageSourceFromAssetId(zipPath)
}

function inferPackageSourceFromSceneProvider(
  assetId: string,
  providerId: string | null | undefined,
): AssetSourceMetadata | undefined {
  const normalizedAssetId = typeof assetId === 'string' ? assetId.trim() : ''
  const normalizedProviderId = typeof providerId === 'string' ? providerId.trim() : ''
  if (!normalizedAssetId || !normalizedProviderId) {
    return undefined
  }
  if (!isExportablePackageProviderId(normalizedProviderId)) {
    return undefined
  }
  if (normalizedAssetId.startsWith(LOCAL_EMBEDDED_ASSET_PREFIX)) {
    return undefined
  }
  if (normalizedAssetId.includes('://')) {
    return undefined
  }
  if (normalizedAssetId.includes('::')) {
    return undefined
  }
  return {
    type: 'package',
    providerId: normalizedProviderId,
    originalAssetId: normalizedAssetId,
  }
}
let builtinWaterNormalBlobPromise: Promise<Blob> | null = null

function buildMaterialEditHistoryKey(nodeId: string, nodeMaterialId: string): string {
  const normalizedNodeId = typeof nodeId === 'string' ? nodeId.trim() : ''
  const normalizedMaterialId = typeof nodeMaterialId === 'string' ? nodeMaterialId.trim() : ''
  return `${normalizedNodeId}:${normalizedMaterialId}`
}

function clearMaterialEditHistoryWindow(key: string): void {
  const timer = materialEditHistoryTimers.get(key)
  if (timer) {
    clearTimeout(timer)
    materialEditHistoryTimers.delete(key)
  }
  activeMaterialEditHistoryKeys.delete(key)
}

function scheduleMaterialEditHistoryWindowReset(key: string): void {
  const existingTimer = materialEditHistoryTimers.get(key)
  if (existingTimer) {
    clearTimeout(existingTimer)
  }
  const timer = setTimeout(() => {
    clearMaterialEditHistoryWindow(key)
  }, MATERIAL_EDIT_HISTORY_WINDOW_MS)
  materialEditHistoryTimers.set(key, timer)
}

function loadBuiltinWaterNormalBlob(): Promise<Blob> {
  if (!builtinWaterNormalBlobPromise) {
    builtinWaterNormalBlobPromise = fetch(builtinWaterNormalUrl, { method: 'GET', cache: 'force-cache' }).then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load built-in water normal map (${response.status})`)
      }
      return response.blob()
    })
  }
  return builtinWaterNormalBlobPromise
}

function isPrefabDependencyPlaceholderAsset(asset: ProjectAsset): boolean {
  if (!asset) {
    return false
  }
  const name = typeof asset.name === 'string' ? asset.name : ''
  const id = typeof asset.id === 'string' ? asset.id : ''
  const nameLooksPlaceholder = name === id || name.trim().length === 0
  const missingVisuals = !asset.thumbnail
  return Boolean(asset.gleaned && nameLooksPlaceholder && missingVisuals)
}

type AssetRegistrationOptions = {
  categoryIdForAsset: (asset: ProjectAsset) => string
  sourceForAsset: (asset: ProjectAsset) => AssetSourceMetadata | undefined
  internalForAsset: (asset: ProjectAsset) => boolean | undefined
  editorOnlyForAsset: (asset: ProjectAsset) => boolean | undefined
}

function resolveServerAssetIdFromSource(
  assetId: string,
  source: AssetSourceMetadata | undefined,
): string {
  if (source?.type === 'server') {
    const explicitServerAssetId = typeof source.serverAssetId === 'string' ? source.serverAssetId.trim() : ''
    if (explicitServerAssetId.length) {
      return explicitServerAssetId
    }
  }

  if (source?.type === 'package' && isServerBackedProviderId(source.providerId)) {
    const originalAssetId = typeof source.originalAssetId === 'string' ? source.originalAssetId.trim() : ''
    if (originalAssetId.length) {
      return originalAssetId
    }
  }

  return assetId
}

function buildServerRegistryEntry(
  assetId: string,
  asset: ProjectAsset | null,
  source: AssetSourceMetadata | undefined,
  options: {
    bytes?: number
    assetType?: ProjectAsset['type']
    name?: string
  } = {},
): SceneAssetRegistryEntry {
  const entry: SceneAssetRegistryEntry = {
    sourceType: 'server',
    serverAssetId: resolveServerAssetIdFromSource(assetId, source),
    fileKey: asset?.fileKey ?? null,
    resolvedUrl: resolveAssetDownloadUrl(asset) ?? null,
    bytes: options.bytes,
    assetType: options.assetType,
    name: options.name,
  }
  return entry
}

function buildRegistryEntryFromSource(
  asset: ProjectAsset,
  source: AssetSourceMetadata | undefined,
): SceneAssetRegistryEntry | null {
  const assetId = typeof asset?.id === 'string' ? asset.id.trim() : ''
  if (!assetId) {
    return null
  }

  const assetType = asset.type
  const name = typeof asset.name === 'string' ? asset.name : undefined
  const remoteCandidate =
    normalizeRemoteCandidate(asset.downloadUrl)
    ?? normalizeRemoteCandidate(asset.description)
    ?? normalizeRemoteCandidate(asset.thumbnail)

  if (source?.type === 'local') {
    return {
      sourceType: 'package',
      zipPath: `${LOCAL_EMBEDDED_ASSET_PREFIX}${assetId}`,
      assetType,
      name,
    }
  }

  if (source?.type === 'server' || (source?.type === 'package' && isServerBackedProviderId(source.providerId))) {
    return buildServerRegistryEntry(assetId, asset, source, { assetType, name })
  }

  if (source?.type === 'package' && source.providerId) {
    return {
      sourceType: 'package',
      zipPath: `${source.providerId}::${source.originalAssetId ?? assetId}`,
      assetType,
      name,
    }
  }

  if (source?.type === 'url' && remoteCandidate) {
    return {
      sourceType: 'url',
      url: remoteCandidate,
      assetType,
      name,
    }
  }

  if (remoteCandidate) {
    return {
      sourceType: 'url',
      url: remoteCandidate,
      assetType,
      name,
    }
  }

  if (source?.type === 'url') {
    return buildServerRegistryEntry(assetId, asset, source, { assetType, name })
  }

  return null
}

function filterAssetRegistryByCatalog(
  assetRegistry: Record<string, SceneAssetRegistryEntry>,
  assetCatalog: Record<string, ProjectAsset[]>,
): Record<string, SceneAssetRegistryEntry> {
  const retainedIds = new Set<string>()
  Object.values(assetCatalog).forEach((list) => {
    list.forEach((asset) => {
      if (asset?.id) {
        retainedIds.add(asset.id)
      }
    })
  })

  const nextRegistry: Record<string, SceneAssetRegistryEntry> = {}
  Object.entries(assetRegistry).forEach(([assetId, entry]) => {
    if (!retainedIds.has(assetId) || !entry) {
      return
    }
    nextRegistry[assetId] = { ...entry }
  })
  return nextRegistry
}

function areSceneAssetRegistriesEqual(
  left: Record<string, SceneAssetRegistryEntry>,
  right: Record<string, SceneAssetRegistryEntry>,
): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) {
    return false
  }
  for (const assetId of leftKeys) {
    const leftEntry = left[assetId]
    const rightEntry = right[assetId]
    if (!leftEntry || !rightEntry) {
      return false
    }
    if (JSON.stringify(leftEntry) !== JSON.stringify(rightEntry)) {
      return false
    }
  }
  return true
}

function upsertAssetsIntoCatalogAndIndex(
  currentCatalog: Record<string, ProjectAsset[]>,
  currentAssetRegistry: Record<string, SceneAssetRegistryEntry>,
  assets: ProjectAsset[],
  options: AssetRegistrationOptions,
): {
  nextCatalog: Record<string, ProjectAsset[]>
  nextAssetRegistry: Record<string, SceneAssetRegistryEntry>
  registeredAssets: ProjectAsset[]
} {
  const nextCatalog: Record<string, ProjectAsset[]> = { ...currentCatalog }
  const nextAssetRegistry: Record<string, SceneAssetRegistryEntry> = { ...currentAssetRegistry }
  const registeredAssets: ProjectAsset[] = []

  const seen = new Set<string>()
  assets.forEach((asset) => {
    const assetId = typeof asset?.id === 'string' ? asset.id.trim() : ''
    if (!assetId || seen.has(assetId)) {
      return
    }
    seen.add(assetId)

    const categoryId = options.categoryIdForAsset(asset)
    const existingAsset = getAssetFromCatalog(currentCatalog, assetId)
    let existingCategoryId: string | null = null
    for (const [candidateCategoryId, list] of Object.entries(currentCatalog)) {
      if ((list ?? []).some((item) => item.id === assetId)) {
        existingCategoryId = candidateCategoryId
        break
      }
    }
    const source = options.sourceForAsset(asset)
    const internal = options.internalForAsset(asset) ?? existingAsset?.internal
    const isEditorOnly = options.editorOnlyForAsset(asset) ?? existingAsset?.isEditorOnly
    if (existingCategoryId && nextCatalog[existingCategoryId]) {
      nextCatalog[existingCategoryId] = nextCatalog[existingCategoryId]!.filter((item) => item.id !== assetId)
    }

    const registeredAsset: ProjectAsset = { ...asset, id: assetId }
    registeredAsset.categoryId = categoryId
    if (source) {
      registeredAsset.source = { ...source }
    } else {
      delete (registeredAsset as Partial<ProjectAsset>).source
    }
    if (internal === true) {
      registeredAsset.internal = true
    } else {
      delete (registeredAsset as Partial<ProjectAsset>).internal
    }
    if (isEditorOnly === true) {
      registeredAsset.isEditorOnly = true
    } else {
      delete (registeredAsset as Partial<ProjectAsset>).isEditorOnly
    }
    const currentList = nextCatalog[categoryId] ?? []
    nextCatalog[categoryId] = [...currentList.filter((item) => item.id !== assetId), registeredAsset]

    const nextRegistryEntry = buildRegistryEntryFromSource(registeredAsset, source)
    if (nextRegistryEntry) {
      nextAssetRegistry[assetId] = nextRegistryEntry
    }

    registeredAssets.push(registeredAsset)
  })

  return { nextCatalog, nextAssetRegistry, registeredAssets }
}

function buildVisibleAssetCatalog(
  catalog: Record<string, ProjectAsset[]>,
): Record<string, ProjectAsset[]> {
  const next: Record<string, ProjectAsset[]> = {}
  Object.entries(catalog).forEach(([categoryId, list]) => {
    next[categoryId] = (list ?? []).filter((asset) => {
      const hiddenInternal = asset.internal === true
      const hiddenDependant = shouldHideDependantAssetInEditor(asset)
      if (hiddenInternal && !isBuiltinWaterNormalAsset(asset.id)) {
        return false
      }
      return !hiddenDependant
    })
  })
  return next
}

function mergeCatalogAssetMetadataFromIndex(
  catalog: Record<string, ProjectAsset[]>,
): Record<string, ProjectAsset[]> {
  const nextCatalog: Record<string, ProjectAsset[]> = {}
  Object.entries(catalog).forEach(([categoryId, list]) => {
    nextCatalog[categoryId] = (list ?? []).map((asset) => {
      const nextAsset: ProjectAsset = {
        ...asset,
        categoryId,
        source: asset.source ? { ...asset.source } : undefined,
        internal: asset.internal === true ? true : undefined,
        isEditorOnly: asset.isEditorOnly === true || shouldAssetDefaultToEditorOnly(asset) ? true : undefined,
      }
      return nextAsset
    })
  })
  return nextCatalog
}

function normalizeRemoteCandidate(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed.length) {
    return null
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
    return trimmed
  }
  return null
}

export const PREFAB_SOURCE_METADATA_KEY = '__prefabAssetId'

const BEHAVIOR_PREFAB_PREVIEW_COLOR = '#4DB6AC'
const NODE_PREFAB_FORMAT_VERSION = 1
const NODE_PREFAB_PREVIEW_COLOR = '#7986CB'
const LOD_PRESET_PREVIEW_COLOR = NODE_PREFAB_PREVIEW_COLOR
const WALL_PRESET_PREVIEW_COLOR = NODE_PREFAB_PREVIEW_COLOR
const FLOOR_PRESET_PREVIEW_COLOR = NODE_PREFAB_PREVIEW_COLOR
const LANDFORM_PRESET_PREVIEW_COLOR = NODE_PREFAB_PREVIEW_COLOR
const ROAD_PRESET_PREVIEW_COLOR = NODE_PREFAB_PREVIEW_COLOR
const PREFAB_PLACEMENT_EPSILON = 1e-3

const GRID_CELL_SIZE = 1
const DEFAULT_SPAWN_RADIUS = GRID_CELL_SIZE * 0.75

const wallPresetActions = createWallPresetActions({
  WALL_PRESET_PREVIEW_COLOR,
  generateUuid,
  normalizePrefabName,
  findNodeById,
  nodeSupportsMaterials,
  extractMaterialProps,
  materialUpdateToProps,
  mergeMaterialProps,
  createMaterialProps,
  createNodeMaterial,
  DEFAULT_SCENE_MATERIAL_TYPE,
})

const floorPresetActions = createFloorPresetActions({
  FLOOR_PRESET_PREVIEW_COLOR,
  generateUuid,
  normalizePrefabName,
  findNodeById,
  nodeSupportsMaterials,
  extractMaterialProps,
  materialUpdateToProps,
  mergeMaterialProps,
  createMaterialProps,
  createNodeMaterial,
  DEFAULT_SCENE_MATERIAL_TYPE,
})

const landformPresetActions = createLandformPresetActions({
  LANDFORM_PRESET_PREVIEW_COLOR,
  generateUuid,
  normalizePrefabName,
  findNodeById,
  nodeSupportsMaterials,
  extractMaterialProps,
  materialUpdateToProps,
  mergeMaterialProps,
  createNodeMaterial,
  DEFAULT_SCENE_MATERIAL_TYPE,
})

const roadPresetActions = createRoadPresetActions({
  ROAD_PRESET_PREVIEW_COLOR,
  generateUuid,
  normalizePrefabName,
  findNodeById,
  nodeSupportsMaterials,
  extractMaterialProps,
})

const lodPresetActions = createLodPresetActions({
  LOD_PRESET_PREVIEW_COLOR,
  findNodeById,
})

const prefabDeps: PrefabActionsDeps = {
  PREFAB_SOURCE_METADATA_KEY,
  NODE_PREFAB_FORMAT_VERSION,
  NODE_PREFAB_PREVIEW_COLOR,
  BEHAVIOR_PREFAB_PREVIEW_COLOR,

  ENVIRONMENT_NODE_ID,

  PREFAB_PLACEMENT_EPSILON,
  DEFAULT_SPAWN_RADIUS,
  LOCAL_EMBEDDED_ASSET_PREFIX,

  generateUuid,

  findNodeById,
  allowsChildNodes,
  buildParentMap,
  findAssetInTree,

  isGroundNode,
  isPrefabDependencyPlaceholderAsset,

  cloneNode,
  createVector,
  composeNodeMatrix,
  computeWorldMatrixForNode,
  resolveSpawnPosition,
  toPlainVector,
  insertNodeMutable,
  findNodeLocationInTree,
  getRuntimeObject,

  isPlainRecord,
  clonePlainRecord,

  duplicateNodeTree,
  syncNode: (node) => componentManager.syncNode(node),

  commitSceneSnapshot,
}

const prefabActions = createPrefabActions(prefabDeps)
const nodePrefabHelpers = createNodePrefabHelpers(prefabDeps)

const floorHelpers = createSceneStoreFloorHelpers({
  createFloorNodeMaterials,
  createNodeMaterial,
  getRuntimeObject,
  updateFloorGroup,
})

const landformHelpers = createSceneStoreLandformHelpers({
  createLandformNodeMaterials,
  createNodeMaterial,
  getRuntimeObject,
  updateLandformGroup,
})

const wallHelpers = createSceneStoreWallHelpers({
  createWallNodeMaterials,
  createNodeMaterial,
})

const DEFAULT_WALL_HEIGHT = WALL_DEFAULT_HEIGHT
const DEFAULT_WALL_WIDTH = WALL_DEFAULT_WIDTH
const DEFAULT_WALL_THICKNESS = WALL_DEFAULT_THICKNESS
const CAMERA_NEAR = 0.1
const CAMERA_FAR = 500
const CAMERA_DISTANCE_EPSILON = 1e-6
const MAX_SPAWN_ATTEMPTS = 64
const COLLISION_MARGIN = 0.35
const GROUND_CONTACT_EPSILON = 1e-4
// Ground constants moved to groundUtils
const SEMI_TRANSPARENT_OPACITY = 0.35
const WALL_DIMENSION_EPSILON = 1e-4

export type ScenePatchField =
  | 'transform'
  | 'visibility'
  | 'materials'
  | 'components'
  | 'dynamicMesh'
  | 'light'
  | 'runtime'
  | 'userData'
  | 'mirror'
  | 'instanceLayout'
  | 'name'
  | 'groupExpanded'
  | 'download'
  | 'lock'

export type ScenePatch =
  | { type: 'structure'; reason?: string }
  | { type: 'remove'; ids: string[]; reason?: string }
  | { type: 'node'; id: string; fields: ScenePatchField[] }

declare module '@/types/scene-state' {
  interface SceneState {
    panelPlacement: PanelPlacementState
    workspaceId: string
    workspaceType: SceneWorkspaceType
    workspaceLabel: string

    sceneGraphStructureVersion: number
    sceneNodePropertyVersion: number
    pendingScenePatches: ScenePatch[]

    prefabAssetDownloadProgress: Record<
      string,
      { active: boolean; progress: number; error: string | null; assetIds: string[] }
    >
  }
}
const OPACITY_EPSILON = 1e-3

let workspaceScopeStopHandle: WatchStopHandle | null = null

type MaterialTextureMap = Partial<Record<SceneMaterialTextureSlot, SceneMaterialTextureRef | null>>

const DEFAULT_MATERIAL_PROPS: SceneMaterialProps = {
  color: '#ffffff',
  transparent: false,
  opacity: 1,
  side: 'front',
  wireframe: false,
  metalness: 0.1,
  roughness: 1.0,
  emissive: '#000000',
  emissiveIntensity: 0,
  aoStrength: 1,
  envMapIntensity: 1,
  textures: Object.freeze(createEmptyTextureMap()) as MaterialTextureMap,
}

function cloneTextureRef(ref?: SceneMaterialTextureRef | null): SceneMaterialTextureRef | null {
  if (!ref) {
    return null
  }
  return {
    assetId: ref.assetId,
    name: ref.name,
    settings: ref.settings ? cloneTextureSettings(ref.settings) : undefined,
  }
}

function optionalNumberEquals(a?: number, b?: number, epsilon = 1e-6): boolean {
  const aValid = typeof a === 'number' && Number.isFinite(a)
  const bValid = typeof b === 'number' && Number.isFinite(b)
  if (!aValid && !bValid) {
    return true
  }
  if (aValid !== bValid) {
    return false
  }
  return Math.abs((a as number) - (b as number)) <= epsilon
}

type MediaDimensions = { width: number; height: number }

const IMAGE_EXTENSION_PATTERN = /\.(apng|avif|bmp|gif|jpe?g|png|tiff?|webp|heic|heif|ico|svg|hdr|hdri|rgbe)$/i
const CAN_MEASURE_MEDIA =
  typeof window !== 'undefined' &&
  typeof Image !== 'undefined' &&
  typeof URL !== 'undefined' &&
  typeof URL.createObjectURL === 'function'

async function ensureAssetFileForMeasurement(assetId: string, asset: ProjectAsset | null): Promise<File | null> {
  const assetCache = useAssetCacheStore()
  try {
    return await assetCache.ensureAssetFile(assetId, { asset })
  } catch (error) {
    console.warn('Failed to download asset for measurement', assetId, error)
    return null
  }
}

async function ensureModelAssetCached(assetCache: ReturnType<typeof useAssetCacheStore>, asset: ProjectAsset): Promise<void> {
  const entry = await assetCache.ensureAssetEntry(asset.id, { asset })
  if (!entry || entry.status !== 'cached') {
    throw new Error('Model asset is not ready')
  }
}

function isImageLikeAsset(asset: ProjectAsset | null, file: File | null): boolean {
  if (file?.type?.startsWith('image/')) {
    return true
  }
  if (asset?.type === 'image' || asset?.type === 'texture') {
    return true
  }
  const name = file?.name ?? asset?.name ?? asset?.downloadUrl ?? asset?.description ?? ''
  return IMAGE_EXTENSION_PATTERN.test(name)
}

async function measureImageDimensionsFromFile(file: File): Promise<MediaDimensions | null> {
  if (!CAN_MEASURE_MEDIA) {
    return null
  }
  return new Promise<MediaDimensions | null>((resolve) => {
    let revoked = false
    const objectUrl = URL.createObjectURL(file)
    const cleanup = () => {
      if (!revoked) {
        URL.revokeObjectURL(objectUrl)
        revoked = true
      }
    }
    const image = new Image()
    image.onload = () => {
      cleanup()
      const width = image.naturalWidth || image.width || 0
      const height = image.naturalHeight || image.height || 0
      if (width > 0 && height > 0) {
        resolve({ width, height })
      } else {
        resolve(null)
      }
    }
    image.onerror = () => {
      cleanup()
      resolve(null)
    }
    image.src = objectUrl
  })
}

async function measureAssetImageDimensions(assetId: string, asset: ProjectAsset | null): Promise<MediaDimensions | null> {
  if (!CAN_MEASURE_MEDIA) {
    return null
  }
  const file = await ensureAssetFileForMeasurement(assetId, asset)
  if (!file) {
    return null
  }
  if (!isImageLikeAsset(asset, file)) {
    return null
  }
  try {
    return await measureImageDimensionsFromFile(file)
  } catch (error) {
    console.warn('Failed to measure image asset dimensions', assetId, error)
    return null
  }
}

function nodeSupportsMaterials(node: SceneNode | null | undefined): boolean {
  if (!node) {
    return false
  }
  if (isProtagonistNode(node)) {
    return false
  }
  if (node.dynamicMesh?.type === 'Region') {
    return false
  }
  const type = node.nodeType ?? (node.light ? 'Light' : 'Mesh')
  return sceneNodeTypeSupportsMaterials(type)
}

// Floor helper functions moved to ./sceneStoreFloor.ts

function createEmptyTextureMap(input?: MaterialTextureMap | null): MaterialTextureMap {
  const map: MaterialTextureMap = {}
  MATERIAL_TEXTURE_SLOTS.forEach((slot) => {
    const value = input?.[slot] ?? null
    map[slot] = cloneTextureRef(value)
  })
  return map
}

function cloneTextureMap(input?: MaterialTextureMap | null): MaterialTextureMap {
  return createEmptyTextureMap(input)
}

// `normalizeNodeComponents` is provided by `normalizeNodeComponentsUtils`.

function listComponentEntries(
  components?: SceneNodeComponentMap,
): Array<[NodeComponentType, SceneNodeComponentState<any>]> {
  if (!components) {
    return []
  }
  return Object.entries(components)
    .filter((entry): entry is [string, SceneNodeComponentState<any>] => Boolean(entry[1]))
    .map(([type, state]) => [type as NodeComponentType, state])
}

function componentCount(components?: SceneNodeComponentMap): number {
  return components ? Object.keys(components).length : 0
}

function findComponentEntryById(
  components: SceneNodeComponentMap | undefined,
  componentId: string,
): [NodeComponentType, SceneNodeComponentState<any>] | null {
  if (!components || !componentId) {
    return null
  }
  for (const [type, state] of listComponentEntries(components)) {
    if (state.id === componentId) {
      return [type, state]
    }
  }
  return null
}

function mergeMaterialProps(base: SceneMaterialProps, overrides?: Partial<SceneMaterialProps> | null): SceneMaterialProps {
  if (!overrides) {
    return {
      ...base,
      textures: cloneTextureMap(base.textures),
    }
  }
  const next: SceneMaterialProps = {
    ...base,
    ...overrides,
    textures: cloneTextureMap(base.textures),
  }
  if (overrides.textures) {
    MATERIAL_TEXTURE_SLOTS.forEach((slot) => {
      if (slot in overrides.textures!) {
        const value = overrides.textures?.[slot] ?? null
        next.textures![slot] = cloneTextureRef(value)
      }
    })
  }
  return next
}

function createMaterialProps(overrides?: Partial<SceneMaterialProps> | null): SceneMaterialProps {
  return mergeMaterialProps({
    ...DEFAULT_MATERIAL_PROPS,
    textures: cloneTextureMap(DEFAULT_MATERIAL_PROPS.textures),
  }, overrides)
}

function cloneMaterialProps(props: SceneMaterialProps): SceneMaterialProps {
  return mergeMaterialProps({
    ...DEFAULT_MATERIAL_PROPS,
    ...props,
    textures: cloneTextureMap(props.textures),
  })
}

function createSceneMaterial(
  name = 'New Material',
  props?: Partial<SceneMaterialProps>,
  options: { type?: SceneMaterialType; id?: string } = {},
): SceneMaterial {
  const now = new Date().toISOString()
  const resolvedName = name.trim() || 'New Material'
  const resolvedProps = createMaterialProps(props)
  return {
    id: options.id ?? generateUuid(),
    name: resolvedName,
    description: undefined,
    type: options.type ?? 'MeshStandardMaterial',
    createdAt: now,
    updatedAt: now,
    ...resolvedProps,
  }
}

function buildLocalMaterialProjectAsset(
  material: SceneMaterial,
  options: {
    existingAsset?: ProjectAsset | null
    thumbnail?: string | null
  } = {},
): ProjectAsset {
  const previewColor = typeof material.color === 'string' && material.color.trim().length ? material.color : '#607d8b'
  const existingAsset = options.existingAsset ?? null
  return {
    ...(existingAsset ?? {}),
    id: material.id,
    name: material.name,
    type: 'material',
    downloadUrl: existingAsset?.downloadUrl ?? `material://${material.id}.material`,
    previewColor,
    thumbnail: options.thumbnail ?? existingAsset?.thumbnail ?? null,
    description: material.description,
    gleaned: true,
    extension: 'material',
  }
}

function upsertAssetRegistryEntries(
  currentAssetRegistry: Record<string, SceneAssetRegistryEntry>,
  updates: Record<string, SceneAssetRegistryEntry>,
): Record<string, SceneAssetRegistryEntry> {
  let changed = false
  const nextAssetRegistry = { ...currentAssetRegistry }
  Object.entries(updates).forEach(([assetId, entry]) => {
    const previous = nextAssetRegistry[assetId]
    if (previous && JSON.stringify(previous) === JSON.stringify(entry)) {
      return
    }
    nextAssetRegistry[assetId] = entry
    changed = true
  })
  return changed ? nextAssetRegistry : currentAssetRegistry
}

function cloneSceneMaterial(material: SceneMaterial): SceneMaterial {
  return {
    ...material,
    ...cloneMaterialProps(material),
    id: material.id,
    name: material.name,
    description: material.description,
    type: material.type,
    createdAt: material.createdAt,
    updatedAt: material.updatedAt,
  }
}

function cloneSceneMaterials(materials: SceneMaterial[]): SceneMaterial[] {
  return materials.map((material) => cloneSceneMaterial(material))
}

function findDefaultSceneMaterial(materials: SceneMaterial[]): SceneMaterial | null {
  return materials.find((material) => material.id === DEFAULT_SCENE_MATERIAL_ID) ?? null
}

function createNodeMaterial(
  props: SceneMaterialProps,
  options: { id?: string; name?: string; type?: SceneMaterialType } = {},
): SceneNodeMaterial {
  return {
    id: options.id ?? generateUuid(),
    name: options.name,
    type: options.type ?? 'MeshStandardMaterial',
    ...cloneMaterialProps(props),
  }
}

function cloneNodeMaterial(material: SceneNodeMaterial): SceneNodeMaterial {
  return createNodeMaterial(material, {
    id: material.id,
    name: material.name,
    type: material.type ?? 'MeshStandardMaterial',
  })
}

function cloneNodeMaterials(materials?: SceneNodeMaterial[] | null): SceneNodeMaterial[] {
  return (materials ?? []).map((material) => cloneNodeMaterial(material))
}

const LEGACY_NODE_TYPE_MAP: Record<string, SceneNodeType> = {
  mesh: 'Mesh',
  light: 'Light',
  group: 'Group',
  camera: 'Camera',
  guideboard: 'Guideboard',
}

function normalizeSceneNodeType(input: SceneNodeType | string | null | undefined): SceneNodeType {
  if (!input) {
    return 'Mesh'
  }
  if (typeof input === 'string') {
    const legacy = LEGACY_NODE_TYPE_MAP[input]
    if (legacy) {
      return legacy
    }
    return input as SceneNodeType
  }
  return input
}

function sceneNodeTypeSupportsMaterials(nodeType: SceneNodeType | string | null | undefined): boolean {
  const normalized = normalizeSceneNodeType(nodeType)
  return (
    normalized !== 'Light'
    && normalized !== 'Group'
    && normalized !== 'Camera'
    && normalized !== 'WarpGate'
    && normalized !== 'Guideboard'
  )
}

function extractMaterialProps(material: SceneNodeMaterial | undefined | null): SceneMaterialProps {
  if (!material) {
    return createMaterialProps()
  }
  const partial: Partial<SceneMaterialProps> = {
    color: material.color,
    transparent: material.transparent,
    opacity: material.opacity,
    side: material.side,
    wireframe: material.wireframe,
    metalness: material.metalness,
    roughness: material.roughness,
    emissive: material.emissive,
    emissiveIntensity: material.emissiveIntensity,
    aoStrength: material.aoStrength,
    envMapIntensity: material.envMapIntensity,
    textures: material.textures,
  }
  return createMaterialProps(partial)
}

function resolveSceneNodeTypeFromObject(object: Object3D | null | undefined, fallback: SceneNodeType = 'Mesh'): SceneNodeType {
  if (!object) {
    return fallback
  }
  const { type } = object
  if (type === 'Group') {
    return 'Group'
  }
  if (type === 'Mesh') {
    return 'Mesh'
  }
  if (typeof type === 'string') {
    if (type === 'Light' || type.endsWith('Light')) {
      return 'Light'
    }
    if (type === 'Camera' || type.endsWith('Camera')) {
      return 'Camera'
    }
  }
  return fallback
}

function materialUpdateToProps(update: Partial<SceneNodeMaterial> | Partial<SceneMaterialProps>): Partial<SceneMaterialProps> {
  if (!update) {
    return {}
  }
  const result: Partial<SceneMaterialProps> = {}
  if (update.color !== undefined) result.color = update.color
  if (update.transparent !== undefined) result.transparent = update.transparent
  if (update.opacity !== undefined) result.opacity = update.opacity
  if (update.side !== undefined) result.side = update.side
  if (update.wireframe !== undefined) result.wireframe = update.wireframe
  if (update.metalness !== undefined) result.metalness = update.metalness
  if (update.roughness !== undefined) result.roughness = update.roughness
  if (update.emissive !== undefined) result.emissive = update.emissive
  if (update.emissiveIntensity !== undefined) result.emissiveIntensity = update.emissiveIntensity
  if (update.aoStrength !== undefined) result.aoStrength = update.aoStrength
  if (update.envMapIntensity !== undefined) result.envMapIntensity = update.envMapIntensity
  if (update.textures) {
    result.textures = {}
    MATERIAL_TEXTURE_SLOTS.forEach((slot) => {
      if (slot in update.textures!) {
        const value = update.textures?.[slot] ?? null
        result.textures![slot] = cloneTextureRef(value)
      }
    })
  }
  return result
}

function getPrimaryNodeMaterial(node: SceneNode | null | undefined): SceneNodeMaterial | null {
  if (!node?.materials || !node.materials.length) {
    return null
  }
  return node.materials[0] ?? null
}

function createVector(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z)
}

function computeForwardVector(position: Vector3Like, target: Vector3Like): THREE.Vector3 {
  const dx = target.x - position.x
  const dy = target.y - position.y
  const dz = target.z - position.z
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (!Number.isFinite(length) || length <= 1e-6) {
    return createVector(0, 0, -1)
  }
  return createVector(dx / length, dy / length, dz / length)
}

type LightNodeExtras = Partial<Omit<LightNodeProperties, 'type' | 'color' | 'intensity' | 'target'>>

function cloneDynamicMeshVector3(vec: Vector3Like): Vector3Like {
  const x = Number.isFinite(vec.x) ? vec.x : 0
  const y = Number.isFinite(vec.y) ? vec.y : 0
  const z = Number.isFinite(vec.z) ? vec.z : 0
  return { x, y, z }
}

function cloneGroundGenerationSettings(settings?: GroundGenerationSettings | null): GroundGenerationSettings | undefined {
  if (!settings) {
    return undefined
  }
  return {
    seed: settings.seed,
    noiseScale: settings.noiseScale,
    noiseAmplitude: settings.noiseAmplitude,
    detailScale: settings.detailScale,
    detailAmplitude: settings.detailAmplitude,
    chunkSize: settings.chunkSize,
    chunkResolution: settings.chunkResolution,
    worldWidth: settings.worldWidth,
    worldDepth: settings.worldDepth,
    edgeFalloff: settings.edgeFalloff,
    mode: settings.mode,
  }
}

function manualDeepClone<T>(source: T): T {
  if (Array.isArray(source)) {
    return source.map((entry) => manualDeepClone(entry)) as unknown as T
  }
  if (source && typeof source === 'object') {
    const target: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      if (typeof value === 'function' || key === 'binding') {
        continue
      }
      target[key] = manualDeepClone(value as unknown)
    }
    return target as T
  }
  return source
}

function cloneGroundDynamicMesh(definition: GroundDynamicMesh): GroundDynamicMesh {
  const planningMetadata = manualDeepClone(definition.planningMetadata)
  const result: GroundDynamicMesh = {
    type: 'Ground',
    width: definition.width,
    depth: definition.depth,
    rows: definition.rows,
    columns: definition.columns,
    cellSize: definition.cellSize,
    chunkStreamingEnabled: definition.chunkStreamingEnabled,
    surfaceRevision: Number.isFinite(definition.surfaceRevision) ? Math.max(0, Math.trunc(definition.surfaceRevision as number)) : 0,
    heightComposition: { ...(definition.heightComposition ?? { mode: 'planning_plus_manual' }) },
    planningMetadata: planningMetadata ?? null,
    terrainScatterInstancesUpdatedAt: definition.terrainScatterInstancesUpdatedAt,
    textureDataUrl: definition.textureDataUrl ?? null,
    textureName: definition.textureName ?? null,
    generation: cloneGroundGenerationSettings(definition.generation) ?? null,
  }
  if (definition.optimizedMesh !== undefined) {
    result.optimizedMesh = manualDeepClone(definition.optimizedMesh)
  }
  if (definition.castShadow !== undefined) {
    result.castShadow = definition.castShadow
  }
  return result
}

function normalizeGroundSurfaceRevision(value: unknown): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.trunc(value as number))
}

function shouldBumpGroundSurfaceRevision(incoming: Record<string, any>): boolean {
  return Object.prototype.hasOwnProperty.call(incoming, 'generation')
    || Object.prototype.hasOwnProperty.call(incoming, 'heightComposition')
}

function prepareGroundDynamicMeshRevision(existing: Record<string, any> | null, incoming: Record<string, any>): number {
  const currentRevision = normalizeGroundSurfaceRevision(existing?.surfaceRevision)
  const incomingRevision = normalizeGroundSurfaceRevision(incoming.surfaceRevision)
  const shouldBump = shouldBumpGroundSurfaceRevision(incoming)
  const nextRevision = shouldBump
    ? Math.max(currentRevision, incomingRevision) + 1
    : Math.max(currentRevision, incomingRevision)
  incoming.surfaceRevision = nextRevision
  if (shouldBump) {
    incoming.runtimeHydratedHeightState = 'dirty'
    incoming.runtimeDisableOptimizedChunks = true
  }
  return nextRevision
}

function resolveDynamicMeshType(dynamicMesh: unknown): string | null {
  if (!dynamicMesh || typeof dynamicMesh !== 'object') {
    return null
  }
  return typeof (dynamicMesh as { type?: unknown }).type === 'string'
    ? ((dynamicMesh as { type: string }).type)
    : null
}

function isGroundDynamicMeshUpdate(existing: unknown, incoming: unknown): boolean {
  return resolveDynamicMeshType(existing) === 'Ground' || resolveDynamicMeshType(incoming) === 'Ground'
}

function applyDynamicMeshToSceneNode(node: SceneNode, dynamicMesh: any, options: {
  beforeMerge?: (existing: Record<string, any> | null, incoming: Record<string, any>) => void
} = {}): { materialsChanged: boolean; meshChanged: boolean } {
  if (!dynamicMesh || typeof dynamicMesh !== 'object') {
    node.dynamicMesh = dynamicMesh
  } else {
    const incoming = dynamicMesh as Record<string, any>
    const existing = node.dynamicMesh

    // If we don't have an object mesh to update, fall back to a shallow assignment.
    if (!existing || typeof existing !== 'object') {
      ;(node as any).dynamicMesh = { ...incoming }
    } else {
      const existingRecord = existing as Record<string, any>
      options.beforeMerge?.(existingRecord, incoming)

      const incomingType = typeof incoming.type === 'string' ? incoming.type : null
      const existingType = typeof existingRecord.type === 'string' ? existingRecord.type : null

      // Type mismatch: replace reference (shallow) to keep semantics correct.
      if (incomingType && existingType && incomingType !== existingType) {
        ;(node as any).dynamicMesh = { ...incoming }
      } else {
        // If incoming has a `type`, treat it as a full definition and sync keys.
        // Otherwise treat it as a patch and just assign the provided keys.
        if (incomingType) {
          for (const key of Object.keys(existingRecord)) {
            if (!(key in incoming)) {
              delete existingRecord[key]
            }
          }
        }

        for (const [key, value] of Object.entries(incoming)) {
          existingRecord[key] = value
        }
      }
    }
  }

  const floorConvention = floorHelpers.ensureFloorMaterialConvention(node)
  const wallConvention = wallHelpers.ensureWallMaterialConvention(node)
  const landformConvention = landformHelpers.ensureLandformMaterialConvention(node)
  return {
    materialsChanged: floorConvention.materialsChanged || wallConvention.materialsChanged || landformConvention.materialsChanged,
    meshChanged: floorConvention.meshChanged || wallConvention.meshChanged || landformConvention.meshChanged,
  }
}

function applySceneNodeDynamicMeshUpdate(store: {
  nodes: SceneNode[]
  groundNode: SceneNode | null
  queueSceneNodePatch: (nodeId: string, properties: any[]) => boolean
}, nodeId: string, dynamicMesh: any, options: {
  beforeMerge?: (existing: Record<string, any> | null, incoming: Record<string, any>) => void
} = {}): void {
  visitNode(store.nodes, nodeId, (node) => {
    // PERF: Avoid JSON stringify/parse deep clones.
    // Dynamic meshes can be very large and deep cloning can stall the UI.
    // Instead, update the existing dynamicMesh in-place when possible.

    const result = applyDynamicMeshToSceneNode(node, dynamicMesh, options)
    if (result.materialsChanged) {
      store.queueSceneNodePatch(nodeId, ['materials'])
    }
    if (result.meshChanged) {
      store.queueSceneNodePatch(nodeId, ['dynamicMesh'])
    }
  })
  replaceSceneNodes(store, [...store.nodes])
}

function finalizeDynamicMeshRuntimePatch(store: {
  queueSceneNodePatch: (nodeId: string, properties: any[]) => boolean
  bumpSceneNodePropertyVersion: () => void
}, nodeId: string, updatedMeshType: string | null): void {
  // Dynamic mesh edits are runtime-visible (Road/Wall/Floor/Ground) and must enqueue a node patch
  // so the viewport can reconcile and rebuild the corresponding Three.js objects immediately.
  if ( updatedMeshType === 'Road' ||  updatedMeshType === 'Wall' || updatedMeshType === 'Floor' || updatedMeshType === 'Landform' || updatedMeshType === 'Ground' || updatedMeshType === 'Region' ) {
    const queued = store.queueSceneNodePatch(nodeId, ['dynamicMesh'])

    // `SceneViewport` applies pending patches only when `sceneNodePropertyVersion` bumps.
    // If an identical patch is already pending, `queueSceneNodePatch` returns false and would not bump,
    // causing runtime-visible edits (e.g. wall segment erase/split) to appear stale until another change happens.
    if (!queued) {
      store.bumpSceneNodePropertyVersion()
    }
  }
}

function persistGroundHeightSidecarForNode(groundNode: SceneNode | null): boolean {
  if (!groundNode || groundNode.dynamicMesh?.type !== 'Ground') {
    return false
  }
  const currentSceneId = useSceneStore().currentSceneId
  const sceneId = typeof currentSceneId === 'string'
    ? currentSceneId.trim()
    : ''
  if (!sceneId) {
    return false
  }
  const sidecar = useGroundHeightmapStore().buildSceneDocumentSidecar(groundNode)
  void useScenesStore().saveSceneGroundHeightSidecar(sceneId, sidecar, { syncServer: false }).catch((error: unknown) => {
    console.warn('[SceneStore] Failed to persist ground height sidecar', error)
  })
  return true
}

function commitGroundHeightMapRuntimeEdit(
  store: {
    nodes: SceneNode[]
    currentSceneId?: string | null
    queueSceneNodePatch: (nodeId: string, fields: ScenePatchField[], options?: { bumpVersion?: boolean }) => boolean
    bumpSceneNodePropertyVersion: () => void
  },
  nodeId: string,
  definition: GroundDynamicMesh,
  manualHeightMap: Float64Array,
): boolean {
  const target = findNodeById(store.nodes, nodeId)
  if (!target || target.dynamicMesh?.type !== 'Ground' || !store.currentSceneId) {
    return false
  }
  const runtimeDefinition = definition as GroundRuntimeDynamicMesh
  const dirtyBounds = computeGroundDirtyBoundsXZ(target, runtimeDefinition, runtimeDefinition.manualHeightMap, manualHeightMap)
  const currentRevision = normalizeGroundSurfaceRevision(target.dynamicMesh.surfaceRevision)
  const nextRevision = currentRevision + 1
  const targetRuntimeDefinition = target.dynamicMesh as GroundRuntimeDynamicMesh
  targetRuntimeDefinition.surfaceRevision = nextRevision
  targetRuntimeDefinition.runtimeHydratedHeightState = 'dirty'
  targetRuntimeDefinition.runtimeDisableOptimizedChunks = true
  definition.surfaceRevision = nextRevision
  runtimeDefinition.runtimeHydratedHeightState = 'dirty'
  runtimeDefinition.runtimeDisableOptimizedChunks = true
  useGroundHeightmapStore().replaceManualHeightMap(nodeId, definition, manualHeightMap)
  refreshLandformNodesForGroundChange(store, nodeId, dirtyBounds)
  finalizeDynamicMeshRuntimePatch(store, nodeId, 'Ground')
  persistGroundHeightSidecarForNode(target)
  return true
}

function refreshGroundOptimizedMeshRuntime(
  store: {
    nodes: SceneNode[]
    currentSceneId?: string | null
    queueSceneNodePatch: (nodeId: string, fields: ScenePatchField[], options?: { bumpVersion?: boolean }) => boolean
    bumpSceneNodePropertyVersion: () => void
  },
  nodeId: string,
): boolean {
  const target = findNodeById(store.nodes, nodeId)
  if (!target || target.dynamicMesh?.type !== 'Ground' || !store.currentSceneId) {
    return false
  }

  const runtimeDefinition = useGroundHeightmapStore().resolveGroundRuntimeMesh(nodeId, target.dynamicMesh)
  const optimizedMesh = rebuildOptimizedGroundMeshForDefinition(runtimeDefinition)
  markGroundOptimizedMeshReady(runtimeDefinition, optimizedMesh)
  markGroundOptimizedMeshReady(target.dynamicMesh, optimizedMesh)
  useGroundHeightmapStore().replaceManualHeightMap(nodeId, runtimeDefinition, runtimeDefinition.manualHeightMap)
  finalizeDynamicMeshRuntimePatch(store, nodeId, 'Ground')
  persistGroundHeightSidecarForNode(target)
  return true
}

function commitGroundScatterRuntimeEdit(
  store: {
    nodes: SceneNode[]
    currentSceneId?: string | null
    queueSceneNodePatch: (nodeId: string, fields: ScenePatchField[], options?: { bumpVersion?: boolean }) => boolean
    bumpSceneNodePropertyVersion: () => void
  },
  nodeId: string,
  terrainScatter: TerrainScatterStoreSnapshot | null,
): boolean {
  const target = findNodeById(store.nodes, nodeId)
  if (!target || target.dynamicMesh?.type !== 'Ground' || !store.currentSceneId) {
    return false
  }
  useGroundScatterStore().replaceTerrainScatter(
    store.currentSceneId,
    nodeId,
    manualDeepClone(terrainScatter) as TerrainScatterStoreSnapshot | null,
    { reason: 'scene-runtime-patch' },
  )
  finalizeDynamicMeshRuntimePatch(store, nodeId, 'Ground')
  persistGroundScatterSidecarForNode(target)
  return true
}

function commitGroundPaintRuntimeEdit(
  store: {
    nodes: SceneNode[]
    currentSceneId?: string | null
    queueSceneNodePatch: (nodeId: string, fields: ScenePatchField[], options?: { bumpVersion?: boolean }) => boolean
    bumpSceneNodePropertyVersion: () => void
  },
  nodeId: string,
  groundSurfaceChunks: GroundDynamicMesh['groundSurfaceChunks'],
): boolean {
  const target = findNodeById(store.nodes, nodeId)
  if (!target || target.dynamicMesh?.type !== 'Ground' || !store.currentSceneId) {
    return false
  }
  const nextGroundSurfaceChunks = manualDeepClone(groundSurfaceChunks ?? null) as Parameters<
    ReturnType<typeof useGroundPaintStore>['replaceGroundSurfaceChunks']
  >[2]
  useGroundPaintStore().replaceGroundSurfaceChunks(store.currentSceneId, nodeId, nextGroundSurfaceChunks, {
    reason: 'scene-runtime-patch',
  })
  finalizeDynamicMeshRuntimePatch(store, nodeId, 'Ground')
  persistGroundPaintSidecarForNode(target)
  return true
}

function persistGroundScatterSidecarForNode(groundNode: SceneNode | null): boolean {
  if (!groundNode || groundNode.dynamicMesh?.type !== 'Ground') {
    return false
  }
  void useScenesStore().saveGroundScatterSidecar(buildSceneDocumentFromState(useSceneStore())).catch((error: unknown) => {
    console.warn('[SceneStore] Failed to persist ground scatter sidecar', error)
  })
  return true
}

function persistGroundPaintSidecarForNode(groundNode: SceneNode | null): boolean {
  if (!groundNode || groundNode.dynamicMesh?.type !== 'Ground') {
    return false
  }
  const currentSceneId = useSceneStore().currentSceneId
  const sceneId = typeof currentSceneId === 'string'
    ? currentSceneId.trim()
    : ''
  if (!sceneId) {
    return false
  }
  const sidecar = useGroundPaintStore().buildSceneDocumentSidecar(sceneId, groundNode)
  void useScenesStore().saveSceneGroundPaintSidecar(sceneId, sidecar, { syncServer: false }).catch((error: unknown) => {
    console.warn('[SceneStore] Failed to persist ground paint sidecar', error)
  })
  return true
}

import * as groundUtils from './groundUtils'
import * as vehicleUtils from './vehicleUtils'

function cloneGroundSettings(settings: Partial<GroundSettings> | null | undefined): GroundSettings {
  return groundUtils.cloneGroundSettings(settings as any) as GroundSettings
}

import {
  buildWallDynamicMeshFromWorldSegments,
  buildWallDynamicMeshForExistingNodeTransform,
  applyWallComponentPropsToNode as applyWallComponentPropsToNodeImported,
} from './wallUtils'

// Local wrapper to inject runtime helpers into the moved wall helper.
function applyWallComponentPropsToNode(node: SceneNode, props: WallComponentProps): boolean {
  return applyWallComponentPropsToNodeImported(node, props, { getRuntimeObject, updateWallGroup })
}

function resolveWallRenderMode(node: SceneNode | null | undefined): 'stretch' | 'repeatInstances' {
  const component = node?.components?.[WALL_COMPONENT_TYPE] as
    | { props?: Partial<WallComponentProps> | null }
    | undefined
  const value = (component?.props as any)?.wallRenderMode
  return value === 'repeatInstances' ? 'repeatInstances' : 'stretch'
}

function resolveWallRepeatInstanceStep(node: SceneNode | null | undefined): number {
  const component = node?.components?.[WALL_COMPONENT_TYPE] as
    | { props?: Partial<WallComponentProps> | null }
    | undefined
  const value = Number((component?.props as any)?.repeatInstanceStep)
  if (!Number.isFinite(value) || value <= 0) {
    return WALL_DEFAULT_REPEAT_INSTANCE_STEP
  }
  return value
}
import { buildRoadDynamicMeshFromWorldPoints } from './roadUtils'

// Floor dynamic mesh builders moved to ./sceneStoreFloor.ts

import {
  applyDisplayBoardComponentPropsToNode as applyDisplayBoardComponentPropsToNodeImported,
  refreshDisplayBoardGeometry as refreshDisplayBoardGeometryImported,
} from './displayBoardUtils'

function applyDisplayBoardComponentPropsToNode(node: SceneNode, props: DisplayBoardComponentProps): boolean {
  const normalized = clampDisplayBoardComponentProps(props)
  // pass deps into imported helper
  return applyDisplayBoardComponentPropsToNodeImported(node, normalized, { getRuntimeObject })
}

function refreshDisplayBoardGeometry(node: SceneNode | null | undefined): void {
  return refreshDisplayBoardGeometryImported(node, { getRuntimeObject })
}

// Floor component application moved to ./sceneStoreFloor.ts
 

import { applyRoadComponentPropsToNode as applyRoadComponentPropsToNodeImported } from './roadUtils'

function applyRoadComponentPropsToNode(node: SceneNode, props: RoadComponentProps, groundNode: SceneNode | null): boolean {
  return applyRoadComponentPropsToNodeImported(node, props, groundNode, { getRuntimeObject })
}



function cloneDynamicMeshDefinition(mesh?: SceneDynamicMesh): SceneDynamicMesh | undefined {
  if (!mesh) {
    return undefined
  }
  const type = normalizeDynamicMeshType(mesh.type)
  const normalizeVertex2D = (value: unknown): [number, number] | null => {
    if (!Array.isArray(value) || value.length < 2) {
      return null
    }
    const x = Number(value[0])
    const y = Number(value[1])
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null
    }
    return [x, y]
  }
  switch (type) {
    case 'Ground':
      return cloneGroundDynamicMesh({ ...(mesh as GroundDynamicMesh), type })
    case 'Wall': {
      const wallMesh = mesh as WallDynamicMesh
      return {
        type: 'Wall',
        chains: Array.isArray(wallMesh.chains)
          ? wallMesh.chains.map((chain) => ({
            points: Array.isArray(chain.points) ? chain.points.map(cloneDynamicMeshVector3) : [],
            closed: Boolean(chain.closed),
          }))
          : [],
        openings: Array.isArray(wallMesh.openings)
          ? wallMesh.openings.map((o) => ({ chainIndex: o.chainIndex, start: o.start, end: o.end }))
          : [],
        repeatErasedSlots: Array.isArray((wallMesh as any).repeatErasedSlots)
          ? (wallMesh as any).repeatErasedSlots
            .map((entry: any) => ({
              chainIndex: Number(entry?.chainIndex),
              slotIndex: Number(entry?.slotIndex),
            }))
            .filter((entry: any) => Number.isFinite(entry.chainIndex) && Number.isFinite(entry.slotIndex))
            .map((entry: any) => ({
              chainIndex: Math.max(0, Math.trunc(entry.chainIndex)),
              slotIndex: Math.max(0, Math.trunc(entry.slotIndex)),
            }))
          : [],
        bodyMaterialConfigId: typeof wallMesh.bodyMaterialConfigId === 'string' && wallMesh.bodyMaterialConfigId.trim().length
          ? wallMesh.bodyMaterialConfigId.trim()
          : null,
        dimensions: {
          height: Number.isFinite(wallMesh.dimensions?.height) ? wallMesh.dimensions.height : DEFAULT_WALL_HEIGHT,
          width: Number.isFinite(wallMesh.dimensions?.width) ? wallMesh.dimensions.width : DEFAULT_WALL_WIDTH,
          thickness: Number.isFinite(wallMesh.dimensions?.thickness) ? wallMesh.dimensions.thickness : DEFAULT_WALL_THICKNESS,
        },
      } satisfies WallDynamicMesh
    }
    case 'Road': {
      const roadMesh = mesh as RoadDynamicMesh

      const vertices = (Array.isArray(roadMesh.vertices) ? roadMesh.vertices : [])
        .map(normalizeVertex2D)
        .filter((p): p is [number, number] => !!p)

      // One-time migration for older saved scenes: legacy `points` -> `vertices`.
      const legacyPointsRaw = Array.isArray((roadMesh as any).points)
        ? ((roadMesh as any).points as unknown[])
        : ([] as unknown[])
      const legacyPoints = legacyPointsRaw
        .map(normalizeVertex2D)
        .filter((p): p is [number, number] => !!p)

      const effectiveVertices = vertices.length ? vertices : legacyPoints
      const segmentsRaw = Array.isArray((roadMesh as any).segments) ? (roadMesh as any).segments : []
      const segments = segmentsRaw
        .map((segment: any) => {
          if (!segment || typeof segment !== 'object') {
            return null
          }
          const a = Math.trunc(Number(segment.a))
          const b = Math.trunc(Number(segment.b))
          if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) {
            return null
          }
          return { a, b }
        })
        .filter((segment: any): segment is { a: number; b: number } => !!segment)

      const effectiveSegments = segments.length
        ? segments
        : (effectiveVertices.length >= 2
          ? Array.from({ length: effectiveVertices.length - 1 }, (_value, index) => ({ a: index, b: index + 1 }))
          : [])

      return {
        type: 'Road',
        width: Number.isFinite(roadMesh.width) ? Math.max(ROAD_MIN_WIDTH, roadMesh.width) : ROAD_DEFAULT_WIDTH,
        vertices: effectiveVertices,
        segments: effectiveSegments,
      }
    }
    case 'Floor': {
      const floorMesh = mesh as FloorDynamicMesh
      const vertices = (Array.isArray(floorMesh.vertices) ? floorMesh.vertices : [])
        .map(normalizeVertex2D)
        .filter((value): value is [number, number] => !!value)

      const normalizeId = (value: unknown) => (typeof value === 'string' && value.trim().length ? value.trim() : null)
      const topBottomMaterialConfigId = normalizeId(floorMesh.topBottomMaterialConfigId)
      const sideMaterialConfigId = normalizeId(floorMesh.sideMaterialConfigId) ?? topBottomMaterialConfigId

      const thicknessRaw = (floorMesh as any).thickness
      const thicknessValue = typeof thicknessRaw === 'number' && Number.isFinite(thicknessRaw) ? thicknessRaw : FLOOR_DEFAULT_THICKNESS
      const thickness = Math.min(FLOOR_MAX_THICKNESS, Math.max(FLOOR_MIN_THICKNESS, thicknessValue))

      const sideRaw = (floorMesh as any).sideUvScale
      const sideU = typeof sideRaw?.x === 'number' && Number.isFinite(sideRaw.x) ? Number(sideRaw.x) : FLOOR_DEFAULT_SIDE_UV_SCALE.x
      const sideV = typeof sideRaw?.y === 'number' && Number.isFinite(sideRaw.y) ? Number(sideRaw.y) : FLOOR_DEFAULT_SIDE_UV_SCALE.y

      return {
        type: 'Floor',
        vertices,
        topBottomMaterialConfigId,
        sideMaterialConfigId,
        smooth: Number.isFinite(floorMesh.smooth) ? floorMesh.smooth : FLOOR_DEFAULT_SMOOTH,
        thickness,
        sideUvScale: { x: Math.max(0, sideU), y: Math.max(0, sideV) },
      }
    }
    case 'Landform': {
      const landformMesh = mesh as LandformDynamicMesh
      const footprint = (Array.isArray(landformMesh.footprint) ? landformMesh.footprint : [])
        .map(normalizeVertex2D)
        .filter((value): value is [number, number] => !!value)
      const surfaceVertices = (Array.isArray(landformMesh.surfaceVertices) ? landformMesh.surfaceVertices : [])
        .map(cloneDynamicMeshVector3)
        .filter((value): value is Vector3Like => !!value)
      const surfaceIndices = (Array.isArray(landformMesh.surfaceIndices) ? landformMesh.surfaceIndices : [])
        .map((entry) => Math.trunc(Number(entry)))
        .filter((entry) => Number.isFinite(entry) && entry >= 0)
      const surfaceUvs = (Array.isArray(landformMesh.surfaceUvs) ? landformMesh.surfaceUvs : [])
        .map((entry) => {
          const x = Number((entry as any)?.x)
          const y = Number((entry as any)?.y)
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return null
          }
          return { x, y }
        })
        .filter((value): value is Vector2Like => !!value)
      const surfaceFeather = (Array.isArray(landformMesh.surfaceFeather) ? landformMesh.surfaceFeather : [])
        .map((entry) => Number(entry))
        .filter((entry) => Number.isFinite(entry))
      const normalizeId = (value: unknown) => (typeof value === 'string' && value.trim().length ? value.trim() : null)
      const uvScaleX = Number.isFinite((landformMesh.uvScale as any)?.x) ? Number((landformMesh.uvScale as any).x) : 1
      const uvScaleY = Number.isFinite((landformMesh.uvScale as any)?.y) ? Number((landformMesh.uvScale as any).y) : 1
      return {
        type: 'Landform',
        footprint,
        surfaceVertices,
        surfaceIndices,
        surfaceUvs,
        surfaceFeather,
        materialConfigId: normalizeId(landformMesh.materialConfigId),
        feather: Number.isFinite(landformMesh.feather) ? Number(landformMesh.feather) : 1,
        uvScale: { x: Math.max(1e-3, uvScaleX), y: Math.max(1e-3, uvScaleY) },
      }
    }
    case 'GuideRoute': {
      const guide = mesh as GuideRouteDynamicMesh
      const raw = Array.isArray(guide.vertices) ? guide.vertices : []
      const vertices = raw
        .map((entry: unknown) => {
          if (!entry || typeof entry !== 'object') {
            return null
          }
          const v = entry as Vector3Like
          return cloneDynamicMeshVector3(v)
        })
        .filter((value: Vector3Like | null): value is Vector3Like => !!value)

      return {
        type: 'GuideRoute',
        vertices,
      }
    }
    case 'Region': {
      const region = mesh as RegionDynamicMesh
      const vertices = (Array.isArray(region.vertices) ? region.vertices : [])
        .map(normalizeVertex2D)
        .filter((value): value is [number, number] => !!value)

      return {
        type: 'Region',
        vertices,
      }
    }
    default:
      return undefined
  }
}

import { buildGuideRouteDynamicMeshFromWorldPoints } from './guideRouteUtils'

function createGroundDynamicMeshDefinition(
  overrides: Partial<GroundDynamicMesh> = {},
  settings?: GroundSettings,
): GroundDynamicMesh {
  return groundUtils.createGroundDynamicMeshDefinition(overrides as any, settings as any) as GroundDynamicMesh
}

function createGroundSceneNode(
  overrides: { dynamicMesh?: Partial<GroundDynamicMesh> } = {},
  settings?: GroundSettings,
): SceneNode {
  return groundUtils.createGroundSceneNodeWithDeps({
    createVector,
    createNodeMaterial,
    createMaterialProps,
    generateUuid,
    clampRigidbodyComponentProps,
    RIGIDBODY_COMPONENT_TYPE,
    GROUND_NODE_ID,
  }, overrides, settings) as SceneNode
}

function isGroundNode(node: SceneNode): boolean {
  return node.id === GROUND_NODE_ID || node.dynamicMesh?.type === 'Ground'
}

import environmentUtils, { DEFAULT_ENVIRONMENT_SETTINGS as DEFAULT_NEW_SCENE_ENVIRONMENT_SETTINGS } from './environmentUtils'

const DEFAULT_ENVIRONMENT_SETTINGS: EnvironmentSettings = environmentUtils.cloneEnvironmentSettings(DEFAULT_NEW_SCENE_ENVIRONMENT_SETTINGS)

const cloneEnvironmentSettings = environmentUtils.cloneEnvironmentSettings
const isEnvironmentNode = (node: SceneNode) => environmentUtils.isEnvironmentNode(node, ENVIRONMENT_NODE_ID)
const ensureEnvironmentNode = (nodes: SceneNode[], override?: EnvironmentSettings) =>
  environmentUtils.ensureEnvironmentNode(nodes, ENVIRONMENT_NODE_ID, isGroundNode, override)
const extractEnvironmentSettings = environmentUtils.extractEnvironmentSettings
const environmentSettingsEqual = environmentUtils.environmentSettingsEqual
const resolveSceneDocumentEnvironment = (scene: StoredSceneDocument) => environmentUtils.resolveSceneDocumentEnvironment(scene, findNodeById, ENVIRONMENT_NODE_ID)

function normalizeGroundSceneNode(node: SceneNode | null | undefined, settings?: GroundSettings): SceneNode {
  return groundUtils.normalizeGroundSceneNodeWithDeps({
    createVector,
    createNodeMaterial,
    createMaterialProps,
    generateUuid,
    clampRigidbodyComponentProps,
    RIGIDBODY_COMPONENT_TYPE,
    GROUND_NODE_ID,
    getPrimaryNodeMaterial,
    cloneNode,
  }, node, settings) as SceneNode
}

function ensureGroundNode(nodes: SceneNode[], settings?: GroundSettings): SceneNode[] {
  let groundNode: SceneNode | null = null
  const others: SceneNode[] = []
  nodes.forEach((node) => {
    if (!groundNode && isGroundNode(node)) {
      groundNode = normalizeGroundSceneNode(node, settings)
    } else {
      others.push(node)
    }
  })
  if (!groundNode) {
    groundNode = createGroundSceneNode({}, settings)
  }
  return [groundNode, ...others]
}

function findGroundNode(nodes: SceneNode[]): SceneNode | null {
  for (const node of nodes) {
    if (isGroundNode(node)) {
      return node
    }
    if (node.children?.length) {
      const nested = findGroundNode(node.children)
      if (nested) {
        return nested
      }
    }
  }
  return null
}

function attachRuntimeGroundSidecarsToDocument(document: StoredSceneDocument): StoredSceneDocument {
  const groundNode = findGroundNode(document.nodes ?? [])
  if (!groundNode) {
    return document
  }
  attachGroundScatterRuntimeToNode(document.id, groundNode)
  attachGroundPaintRuntimeToNode(document.id, groundNode)
  return document
}

export function cloneSceneDocumentWithRuntimeGroundSidecars(document: StoredSceneDocument): StoredSceneDocument {
  const cloned = manualDeepClone(document) as StoredSceneDocument
  return attachRuntimeGroundSidecarsToDocument(cloned)
}

function syncGroundNodeReference(store: Pick<SceneState, 'nodes' | 'groundNode'>): SceneNode | null {
  const groundNode = findGroundNode(store.nodes)
  store.groundNode = groundNode
  return groundNode
}

function replaceSceneNodes(store: Pick<SceneState, 'nodes' | 'groundNode'>, nodes: SceneNode[]): SceneNode[] {
  store.nodes = nodes
  syncGroundNodeReference(store)
  return nodes
}

type GroundRegionBounds = {
  minRow: number
  maxRow: number
  minColumn: number
  maxColumn: number
}

function resolveGroundRuntimeDefinition(
  store: Pick<SceneState, 'nodes'> & { workspaceId?: string; currentSceneId?: string | null },
  nodeId: string,
): GroundRuntimeDynamicMesh | null {
  const node = findNodeById(store.nodes, nodeId)
  if (!node || node.dynamicMesh?.type !== 'Ground') {
    return null
  }
  const definition = node.dynamicMesh as GroundDynamicMesh
  const sceneId = typeof store.currentSceneId === 'string' && store.currentSceneId.length ? store.currentSceneId : null
  if (!sceneId) {
    return null
  }
  return useGroundHeightmapStore().resolveGroundRuntimeMesh(nodeId, definition)
}

function buildLandformFootprintWorldPoints(node: SceneNode, mesh: LandformDynamicMesh): Vector3Like[] {
  const footprint = Array.isArray(mesh.footprint) ? mesh.footprint : []
  if (footprint.length < 3) {
    return []
  }

  const temp = new THREE.Object3D()
  temp.position.set(
    Number.isFinite(node.position?.x) ? node.position.x : 0,
    Number.isFinite(node.position?.y) ? node.position.y : 0,
    Number.isFinite(node.position?.z) ? node.position.z : 0,
  )
  temp.rotation.set(
    Number.isFinite(node.rotation?.x) ? node.rotation.x : 0,
    Number.isFinite(node.rotation?.y) ? node.rotation.y : 0,
    Number.isFinite(node.rotation?.z) ? node.rotation.z : 0,
  )
  temp.scale.set(
    Number.isFinite(node.scale?.x) ? node.scale.x : 1,
    Number.isFinite(node.scale?.y) ? node.scale.y : 1,
    Number.isFinite(node.scale?.z) ? node.scale.z : 1,
  )
  temp.updateMatrixWorld(true)

  return footprint
    .map((entry) => {
      if (!Array.isArray(entry) || entry.length < 2) {
        return null
      }
      const localX = Number(entry[0])
      const localZ = Number(entry[1])
      if (!Number.isFinite(localX) || !Number.isFinite(localZ)) {
        return null
      }
      const world = new THREE.Vector3(localX, 0, localZ).applyMatrix4(temp.matrixWorld)
      return { x: world.x, y: world.y, z: world.z } satisfies Vector3Like
    })
    .filter((entry): entry is Vector3Like => Boolean(entry))
}

type WorldBoundsXZ = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

function computeWorldBoundsXZ(points: Vector3Like[]): WorldBoundsXZ | null {
  if (!points.length) {
    return null
  }
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  points.forEach((point) => {
    minX = Math.min(minX, Number(point.x))
    maxX = Math.max(maxX, Number(point.x))
    minZ = Math.min(minZ, Number(point.z))
    maxZ = Math.max(maxZ, Number(point.z))
  })
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
    return null
  }
  return { minX, maxX, minZ, maxZ }
}

function boundsIntersectXZ(a: WorldBoundsXZ | null, b: WorldBoundsXZ | null): boolean {
  if (!a || !b) {
    return true
  }
  return a.minX <= b.maxX
    && a.maxX >= b.minX
    && a.minZ <= b.maxZ
    && a.maxZ >= b.minZ
}

function computeGroundDirtyBoundsXZ(
  groundNode: SceneNode,
  definition: GroundRuntimeDynamicMesh,
  previousHeightMap: Float64Array,
  nextHeightMap: Float64Array,
): WorldBoundsXZ | null {
  const total = Math.min(previousHeightMap.length, nextHeightMap.length)
  if (total <= 0) {
    return null
  }

  let minRow = Number.POSITIVE_INFINITY
  let maxRow = Number.NEGATIVE_INFINITY
  let minColumn = Number.POSITIVE_INFINITY
  let maxColumn = Number.NEGATIVE_INFINITY
  const columns = Math.max(1, Math.trunc(definition.columns))
  const rows = Math.max(1, Math.trunc(definition.rows))

  for (let index = 0; index < total; index += 1) {
    const previous = previousHeightMap[index] ?? 0
    const next = nextHeightMap[index] ?? 0
    if (Math.abs(previous - next) <= 1e-9) {
      continue
    }
    const row = Math.floor(index / (columns + 1))
    const column = index % (columns + 1)
    minRow = Math.min(minRow, row)
    maxRow = Math.max(maxRow, row)
    minColumn = Math.min(minColumn, column)
    maxColumn = Math.max(maxColumn, column)
  }

  if (!Number.isFinite(minRow) || !Number.isFinite(maxRow) || !Number.isFinite(minColumn) || !Number.isFinite(maxColumn)) {
    return null
  }

  const expandedMinRow = Math.max(0, Math.floor(minRow) - 1)
  const expandedMaxRow = Math.min(rows, Math.ceil(maxRow) + 1)
  const expandedMinColumn = Math.max(0, Math.floor(minColumn) - 1)
  const expandedMaxColumn = Math.min(columns, Math.ceil(maxColumn) + 1)

  const halfWidth = definition.width * 0.5
  const halfDepth = definition.depth * 0.5
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 1e-6 ? definition.cellSize : 1
  const localMinX = -halfWidth + expandedMinColumn * cellSize
  const localMaxX = -halfWidth + expandedMaxColumn * cellSize
  const localMinZ = -halfDepth + expandedMinRow * cellSize
  const localMaxZ = -halfDepth + expandedMaxRow * cellSize

  const position = groundNode.position ?? { x: 0, y: 0, z: 0 }
  const scale = groundNode.scale ?? { x: 1, y: 1, z: 1 }
  const worldX0 = position.x + localMinX * scale.x
  const worldX1 = position.x + localMaxX * scale.x
  const worldZ0 = position.z + localMinZ * scale.z
  const worldZ1 = position.z + localMaxZ * scale.z
  return {
    minX: Math.min(worldX0, worldX1),
    maxX: Math.max(worldX0, worldX1),
    minZ: Math.min(worldZ0, worldZ1),
    maxZ: Math.max(worldZ0, worldZ1),
  }
}

function rebuildLandformNodeForTerrain(store: {
  nodes: SceneNode[]
  currentSceneId?: string | null
}, nodeId: string): boolean {
  const node = findNodeById(store.nodes, nodeId)
  if (!node || node.dynamicMesh?.type !== 'Landform') {
    return false
  }

  const groundNode = resolveGroundNodeForHeightSampling(store.nodes)
  const groundDefinition = groundNode?.dynamicMesh?.type === 'Ground'
    ? resolveGroundRuntimeDefinition(store, groundNode.id)
    : null
  if (!groundNode || !groundDefinition) {
    return false
  }

  const mesh = node.dynamicMesh as LandformDynamicMesh
  const worldPoints = buildLandformFootprintWorldPoints(node, mesh)
  if (worldPoints.length < 3) {
    return false
  }

  const componentState = node.components?.[LANDFORM_COMPONENT_TYPE] as { props?: unknown } | undefined
  const componentProps = clampLandformComponentProps(
    (componentState?.props as Partial<LandformComponentProps> | undefined)
      ?? resolveLandformComponentPropsFromMesh(mesh),
  )
  const rebuilt = landformHelpers.buildLandformDynamicMeshFromWorldPoints(
    worldPoints,
    groundDefinition,
    groundNode,
    componentProps,
  )
  if (!rebuilt) {
    return false
  }

  node.dynamicMesh = {
    ...rebuilt.definition,
    materialConfigId: mesh.materialConfigId ?? rebuilt.definition.materialConfigId ?? null,
  }
  node.position = createVector(rebuilt.center.x, rebuilt.center.y, rebuilt.center.z)

  const runtime = getRuntimeObject(nodeId)
  if (runtime) {
    runtime.position.set(
      Number(node.position?.x) || 0,
      Number(node.position?.y) || 0,
      Number(node.position?.z) || 0,
    )
    runtime.rotation.set(
      Number(node.rotation?.x) || 0,
      Number(node.rotation?.y) || 0,
      Number(node.rotation?.z) || 0,
    )
    runtime.scale.set(
      Number(node.scale?.x) || 1,
      Number(node.scale?.y) || 1,
      Number(node.scale?.z) || 1,
    )
    updateLandformGroup(runtime, node.dynamicMesh as LandformDynamicMesh)
  }

  return true
}

function refreshLandformNodesForGroundChange(store: {
  nodes: SceneNode[]
  currentSceneId?: string | null
  queueSceneNodePatch: (nodeId: string, fields: ScenePatchField[], options?: { bumpVersion?: boolean }) => boolean
  bumpSceneNodePropertyVersion: () => void
}, groundNodeId: string, dirtyBounds?: WorldBoundsXZ | null): number {
  const groundNode = findNodeById(store.nodes, groundNodeId)
  const groundDefinition = resolveGroundRuntimeDefinition(store, groundNodeId)
  if (!groundNode || !groundDefinition) {
    return 0
  }

  const changedNodeIds: string[] = []
  const walk = (nodes: SceneNode[]) => {
    nodes.forEach((node) => {
      if (node.dynamicMesh?.type === 'Landform') {
        if (dirtyBounds) {
          const worldPoints = buildLandformFootprintWorldPoints(node, node.dynamicMesh as LandformDynamicMesh)
          const landformBounds = computeWorldBoundsXZ(worldPoints)
          if (!boundsIntersectXZ(landformBounds, dirtyBounds)) {
            return
          }
        }
        const rebuilt = rebuildLandformNodeForTerrain(store, node.id)
        if (rebuilt) {
          changedNodeIds.push(node.id)
        }
      }
      if (Array.isArray(node.children) && node.children.length) {
        walk(node.children)
      }
    })
  }

  walk(store.nodes)
  if (!changedNodeIds.length) {
    return 0
  }

  let patchQueued = false
  changedNodeIds.forEach((id) => {
    patchQueued = store.queueSceneNodePatch(id, ['dynamicMesh', 'transform'], { bumpVersion: false }) || patchQueued
  })
  if (patchQueued) {
    store.bumpSceneNodePropertyVersion()
  }
  return changedNodeIds.length
}

function applyGroundRegionTransform(
  definition: GroundRuntimeDynamicMesh,
  bounds: GroundRegionBounds,
  transform: (current: number, row: number, column: number) => number,
): { definition: GroundRuntimeDynamicMesh; changed: boolean } {
  return groundUtils.applyGroundRegionTransform(definition as any, bounds as any, transform as any) as { definition: GroundRuntimeDynamicMesh; changed: boolean }
}

const initialAssetCatalog = createEmptyAssetCatalog()

function ensureBuiltinWallPresetAssets(
  assetCatalog: Record<string, ProjectAsset[]>,
): void {
  BUILTIN_WALL_PRESET_ASSETS.forEach((builtinAsset) => {
    const categoryId = determineAssetCategoryId(builtinAsset)
    const existingCategoryId = Object.entries(assetCatalog).find(([, list]) =>
      (list ?? []).some((entry) => entry.id === builtinAsset.id),
    )?.[0]
    if (existingCategoryId && assetCatalog[existingCategoryId]) {
      assetCatalog[existingCategoryId] = assetCatalog[existingCategoryId]!.filter((entry) => entry.id !== builtinAsset.id)
    }
    const currentList = assetCatalog[categoryId] ?? []
    const asset: ProjectAsset = {
      ...builtinAsset,
      categoryId,
      internal: true,
      isEditorOnly: true,
    }
    assetCatalog[categoryId] = [...currentList.filter((entry) => entry.id !== builtinAsset.id), asset]
  })
}

ensureBuiltinWallPresetAssets(initialAssetCatalog)

function createLightNode(options: {
  name: string
  type: LightNodeType
  color: string
  intensity: number
  position: THREE.Vector3
  rotation?: THREE.Vector3
  target?: THREE.Vector3
  extras?: LightNodeExtras
}): SceneNode {
  return lightUtils.createLightNodeWithDeps({ createVector, generateUuid }, options as any)
}

function getLightPreset(type: LightNodeType) {
  return lightUtils.getLightPresetWithDeps({ createVector }, type)
}

type ExternalSceneImportContext = {
  assetCache: ReturnType<typeof useAssetCacheStore>
  registerAsset: (asset: ProjectAsset, options: { categoryId?: string }) => ProjectAsset
  converted: Set<Object3D>
  textureRefs: Map<Texture, SceneMaterialTextureRef>
  textureSequence: number
  modelAssetId: string | null
}

function toHexColor(color: Color | null | undefined, fallback = DEFAULT_COLOR): string {
  if (!color) {
    return fallback
  }
  return `#${color.getHexString()}`
}

function toVector(vec: Vector3 | Euler): THREE.Vector3 {
  return createVector(vec.x, vec.y, vec.z)
}

function isRenderableObject(object: Object3D): boolean {
  const candidate = object as Object3D & { isMesh?: boolean; isSkinnedMesh?: boolean; isPoints?: boolean; isLine?: boolean }
  return Boolean(candidate.isMesh || candidate.isSkinnedMesh || candidate.isPoints || candidate.isLine)
}

function isBoneObject(object: Object3D): boolean {
  return object.type === 'Bone'
}

function resolveLightTypeFromObject(light: Light): LightNodeType {
  return lightUtils.resolveLightTypeFromObject(light)
}

async function textureToBlob(texture: Texture): Promise<{ blob: Blob; mimeType: string; extension: string } | null> {
  if (typeof document === 'undefined') {
    return null
  }
  const image = (texture as Texture & { image?: unknown }).image as any
  if (!image) {
    return null
  }
  const width = Number(image.width ?? image.videoWidth ?? 0)
  const height = Number(image.height ?? image.videoHeight ?? 0)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return null
  }

  if (image.data && width && height) {
    const dataSource = image.data as Uint8Array | Uint8ClampedArray
    if (!(dataSource instanceof Uint8Array || dataSource instanceof Uint8ClampedArray)) {
      return null
    }
    const array = dataSource instanceof Uint8ClampedArray ? dataSource : new Uint8ClampedArray(dataSource)
    if (array.length !== width * height * 4) {
      return null
    }
    const imageData = new ImageData(width, height)
    imageData.data.set(array)
    ctx.putImageData(imageData, 0, 0)
  } else {
    try {
      ctx.drawImage(image as CanvasImageSource, 0, 0, width, height)
    } catch (error) {
      console.warn('Failed to draw texture to canvas', error)
      return null
    }
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob((value) => resolve(value), 'image/png')
      return
    }
    if (typeof window === 'undefined' || typeof canvas.toDataURL !== 'function') {
      resolve(null)
      return
    }
    try {
      const dataUrl = canvas.toDataURL('image/png')
      const segments = dataUrl.split(',')
      if (segments.length < 2) {
        resolve(null)
        return
      }
      if (typeof window.atob !== 'function') {
        resolve(null)
        return
      }
      const binary = window.atob(segments[1] ?? '')
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
      }
      resolve(new Blob([bytes], { type: 'image/png' }))
    } catch (error) {
      console.warn('Failed to serialize texture data', error)
      resolve(null)
    }
  })

  if (!blob) {
    return null
  }

  return { blob, mimeType: 'image/png', extension: 'png' }
}

async function createTextureAssetFromTexture(texture: Texture, context: ExternalSceneImportContext): Promise<SceneMaterialTextureRef | null> {
  if (context.textureRefs.has(texture)) {
    return context.textureRefs.get(texture) ?? null
  }

  const payload = await textureToBlob(texture)
  if (!payload) {
    return null
  }

  context.textureSequence += 1
  const baseName = texture.name && texture.name.trim().length ? texture.name.trim() : `Texture ${context.textureSequence}`
  const filename = `${baseName.replace(/\s+/g, '_')}.${payload.extension}`
  const assetId = generateUuid()

  await context.assetCache.storeAssetBlob(assetId, {
    blob: payload.blob,
    mimeType: payload.mimeType,
    filename,
  })

  const asset: ProjectAsset = {
    id: assetId,
    name: baseName,
    type: 'texture',
    downloadUrl: '',
    previewColor: '#ffffff',
    thumbnail: null,
    gleaned: true,
    extension: payload.extension ?? null,
  }

  context.registerAsset(asset, { categoryId: determineAssetCategoryId(asset) })
  context.assetCache.touch(assetId)

  const ref: SceneMaterialTextureRef = {
    assetId,
    name: baseName,
  }
  context.textureRefs.set(texture, ref)
  return ref
}

function pruneConvertedChildren(clone: Object3D, source: Object3D, converted: Set<Object3D>) {
  for (let index = source.children.length - 1; index >= 0; index -= 1) {
    const originalChild = source.children[index]
    const clonedChild = clone.children[index]
    if (!originalChild || !clonedChild) {
      continue
    }
    if (converted.has(originalChild)) {
      clonedChild.removeFromParent()
    } else {
      pruneConvertedChildren(clonedChild, originalChild, converted)
    }
  }
}

function cloneRuntimeObject(object: Object3D, converted: Set<Object3D>): Object3D {
  const clone = object.clone(true)
  pruneConvertedChildren(clone, object, converted)
  return clone
}

function prepareRuntimeObjectForNode(object: Object3D) {
  object.traverse((child) => {
    const meshChild = child as Object3D & { isMesh?: boolean; isSkinnedMesh?: boolean; isPoints?: boolean; isLine?: boolean }
    if (meshChild.isMesh || meshChild.isSkinnedMesh || meshChild.isPoints || meshChild.isLine) {
      const mesh = meshChild as { castShadow?: boolean; receiveShadow?: boolean }
      mesh.castShadow = true
      mesh.receiveShadow = true
    }
  })
}

function isPathAncestor(base: number[], candidate: number[]): boolean {
  if (candidate.length <= base.length) {
    return false
  }
  for (let index = 0; index < base.length; index += 1) {
    if (candidate[index] !== base[index]) {
      return false
    }
  }
  return true
}

function pruneCloneByRelativePaths(root: Object3D, relativePaths: number[][]) {
  if (!relativePaths.length) {
    return
  }

  const sorted = [...relativePaths].sort((a, b) => {
    if (a.length !== b.length) {
      return b.length - a.length
    }
    for (let index = 0; index < a.length; index += 1) {
      const aValue = a[index] ?? -Infinity
      const bValue = b[index] ?? -Infinity
      if (aValue !== bValue) {
        return bValue - aValue
      }
    }
    return 0
  })

  sorted.forEach((path) => {
    if (!path.length) {
      return
    }
    let current: Object3D | undefined = root
    for (let depth = 0; depth < path.length - 1; depth += 1) {
      const segmentRaw = path[depth]
      if (!current || !Number.isInteger(segmentRaw)) {
        return
      }
      const segment = segmentRaw as number
      if (segment < 0 || segment >= current.children.length) {
        return
      }
      current = current.children[segment]
    }
    if (!current) {
      return
    }
    const leafIndexRaw = path[path.length - 1]
    if (!Number.isInteger(leafIndexRaw)) {
      return
    }
    const leafIndex = leafIndexRaw as number
    if (leafIndex < 0 || leafIndex >= current.children.length) {
      return
    }
    const child = current.children[leafIndex]
    if (child) {
      child.removeFromParent()
    }
  })
}

async function createNodeMaterialFromThree(material: Material | null | undefined, context: ExternalSceneImportContext): Promise<SceneNodeMaterial | null> {
  if (!material) {
    return null
  }

  const overrides: Partial<SceneMaterialProps> = {}
  const typed = material as Material & { color?: Color; wireframe?: boolean }
  if (typed.color) {
    overrides.color = toHexColor(typed.color)
  }

  const resolvedOpacity = typeof material.opacity === 'number' ? MathUtils.clamp(material.opacity, 0, 1) : 1
  overrides.opacity = resolvedOpacity
  overrides.transparent = Boolean(material.transparent ?? resolvedOpacity < 0.999)

  if (typeof typed.wireframe === 'boolean') {
    overrides.wireframe = typed.wireframe
  }

  if (material.side === BackSide) {
    overrides.side = 'back'
  } else if (material.side === DoubleSide) {
    overrides.side = 'double'
  } else {
    overrides.side = 'front'
  }

  const standard = material as Material & {
    metalness?: number
    roughness?: number
    emissive?: Color
    emissiveIntensity?: number
    aoMapIntensity?: number
    envMapIntensity?: number
  }

  if (typeof standard.metalness === 'number') {
    overrides.metalness = standard.metalness
  }
  if (typeof standard.roughness === 'number') {
    overrides.roughness = standard.roughness
  }
  if (standard.emissive) {
    overrides.emissive = toHexColor(standard.emissive, '#000000')
  }
  if (typeof standard.emissiveIntensity === 'number') {
    overrides.emissiveIntensity = standard.emissiveIntensity
  }
  if (typeof standard.aoMapIntensity === 'number') {
    overrides.aoStrength = standard.aoMapIntensity
  }
  if (typeof standard.envMapIntensity === 'number') {
    overrides.envMapIntensity = standard.envMapIntensity
  }

  const textures: Partial<Record<SceneMaterialTextureSlot, SceneMaterialTextureRef>> = {}
  const materialRecord = standard as unknown as Record<string, unknown>

  for (const mapping of IMPORT_TEXTURE_SLOT_MAP) {
    const source = materialRecord[mapping.key] as Texture | null | undefined
    if (!source) {
      continue
    }
    const ref = await createTextureAssetFromTexture(source, context)
    if (!ref) {
      return null
    }
    textures[mapping.slot] = ref
  }

  if (Object.keys(textures).length) {
    overrides.textures = textures
  }

  const props = createMaterialProps(overrides)
  const materialName = typeof material.name === 'string' && material.name.trim().length ? material.name.trim() : undefined

  return createNodeMaterial(props, {
    name: materialName,
    type: material.type as SceneMaterialType,
  })
}

async function convertObjectToSceneNode(
  object: Object3D,
  context: ExternalSceneImportContext,
  options: { fallbackName?: string; path?: number[] } = {},
): Promise<SceneNode | null> {
  const fallbackName = options.fallbackName && options.fallbackName.trim().length ? options.fallbackName.trim() : 'Imported Node'
  const currentPath = options.path ? [...options.path] : []

  const childrenNodes: SceneNode[] = []
  for (let index = 0; index < object.children.length; index += 1) {
    const child = object.children[index]!
    const convertedChild = await convertObjectToSceneNode(child, context, {
      fallbackName,
      path: [...currentPath, index],
    })
    if (convertedChild) {
      childrenNodes.push(convertedChild)
    }
  }

  if (isBoneObject(object)) {
    return null
  }

  const name = object.name && object.name.trim().length ? object.name : fallbackName
  const position = toVector(object.position)
  const rotation = toVector(object.rotation)
  const scale = toVector(object.scale)
  const visible = object.visible ?? true

  const lightCandidate = object as Light & Record<string, unknown>
  if (lightCandidate.isLight) {
    const lightType = resolveLightTypeFromObject(lightCandidate)
    const lightConfig: LightNodeProperties = {
      type: lightType,
      color: toHexColor(lightCandidate.color as Color),
      intensity: typeof lightCandidate.intensity === 'number' ? lightCandidate.intensity : DEFAULT_INTENSITY,
    }

    if (typeof (lightCandidate as Record<string, unknown>).distance === 'number') {
      lightConfig.distance = Number(lightCandidate.distance)
    }
    if (typeof (lightCandidate as Record<string, unknown>).decay === 'number') {
      lightConfig.decay = Number(lightCandidate.decay)
    }
    if (typeof (lightCandidate as Record<string, unknown>).angle === 'number') {
      lightConfig.angle = Number(lightCandidate.angle)
    }
    if (typeof (lightCandidate as Record<string, unknown>).penumbra === 'number') {
      lightConfig.penumbra = Number(lightCandidate.penumbra)
    }
    if (typeof (lightCandidate as Record<string, unknown>).castShadow === 'boolean') {
      lightConfig.castShadow = Boolean(lightCandidate.castShadow)
    }

    const normalizedLightType = normalizeLightNodeType(lightType)
    if (normalizedLightType === 'Directional' || normalizedLightType === 'Spot') {
      const target = (lightCandidate as { target?: Object3D }).target
      if (target) {
        const world = new Vector3()
        target.updateMatrixWorld?.(true)
        target.getWorldPosition(world)
        lightConfig.target = toVector(world)
      }
    }

    const node: SceneNode = {
      id: generateUuid(),
      name,
      nodeType: 'Light',
      light: lightConfig,
      position,
      rotation,
      scale,
      visible,
    }
    if (childrenNodes.length) {
      node.children = childrenNodes
    }
    context.converted.add(object)
    return node
  }

  const cameraCandidate = object as PerspectiveCamera | OrthographicCamera & Record<string, unknown>
  if (cameraCandidate.isCamera) {
    let cameraConfig: CameraNodeProperties
    if (cameraCandidate instanceof PerspectiveCamera || (cameraCandidate as Record<string, unknown>).isPerspectiveCamera) {
      const perspective = cameraCandidate as PerspectiveCamera
      cameraConfig = {
        kind: 'perspective',
        fov: perspective.fov,
        near: perspective.near,
        far: perspective.far,
        aspect: perspective.aspect,
      }
    } else {
      const ortho = cameraCandidate as OrthographicCamera
      cameraConfig = {
        kind: 'orthographic',
        near: ortho.near,
        far: ortho.far,
        zoom: ortho.zoom,
      }
    }

    const node: SceneNode = {
      id: generateUuid(),
      name,
      nodeType: 'Camera',
      camera: cameraConfig,
      position,
      rotation,
      scale,
      visible,
    }
    if (childrenNodes.length) {
      node.children = childrenNodes
    }
    context.converted.add(object)
    return node
  }

  if (isRenderableObject(object)) {
    const rawMaterial = (object as { material?: Material | Material[] }).material
    const materialList = Array.isArray(rawMaterial) ? rawMaterial : rawMaterial ? [rawMaterial] : []
    const nodeMaterials: SceneNodeMaterial[] = []
    let failedMaterial = false
    for (const material of materialList) {
      const convertedMaterial = await createNodeMaterialFromThree(material, context)
      if (!convertedMaterial) {
        failedMaterial = true
        break
      }
      nodeMaterials.push(convertedMaterial)
    }

    const node: SceneNode = {
      id: generateUuid(),
      name,
      nodeType: 'Mesh',
      position,
      rotation,
      scale,
      visible,
    }

    if (context.modelAssetId) {
      const pathCopy = currentPath.slice()
      node.sourceAssetId = context.modelAssetId
      node.importMetadata = {
        assetId: context.modelAssetId,
        objectPath: pathCopy,
      }
    }

    if (!failedMaterial && nodeMaterials.length) {
      node.materials = nodeMaterials
    }
    if (childrenNodes.length) {
      node.children = childrenNodes
    }

    const runtimeObject = cloneRuntimeObject(object, context.converted)
    runtimeObject.name = name
    runtimeObject.position.set(0, 0, 0)
    runtimeObject.rotation.set(0, 0, 0)
    runtimeObject.quaternion.identity()
    runtimeObject.scale.set(1, 1, 1)
    runtimeObject.matrix.identity()
    runtimeObject.matrixAutoUpdate = true
    runtimeObject.updateMatrixWorld(true)
    prepareRuntimeObjectForNode(runtimeObject)

    tagObjectWithNodeId(runtimeObject, node.id)
    registerRuntimeObject(node.id, runtimeObject)
    node.components = normalizeNodeComponents(node, node.components)
    componentManager.attachRuntime(node, runtimeObject)
    componentManager.syncNode(node)
    context.converted.add(object)
    return node
  }

  if (childrenNodes.length) {
    const node: SceneNode = {
      id: generateUuid(),
      name,
      nodeType: 'Group',
      position,
      rotation,
      scale,
      visible,
      groupExpanded: true,
      children: childrenNodes,
    }
    if (context.modelAssetId) {
      node.sourceAssetId = context.modelAssetId
    }
    node.allowChildNodes = false
    context.converted.add(object)
    return node
  }

  return null
}

function collectNodeIdList(nodes: SceneNode[]): string[] {
  const ids: string[] = []
  const visit = (list: SceneNode[]) => {
    list.forEach((node) => {
      ids.push(node.id)
      if (node.children?.length) {
        visit(node.children)
      }
    })
  }
  visit(nodes)
  return ids
}

const initialMaterials: SceneMaterial[] = [
  createSceneMaterial('Default Material', {
    color: '#ffffff',
    metalness: 0,
    roughness: 0.8,
  }, { id: DEFAULT_SCENE_MATERIAL_ID }),
]

const initialNodes: SceneNode[] = ensureEnvironmentNode([createGroundSceneNode()], DEFAULT_ENVIRONMENT_SETTINGS)

const placeholderDownloadWatchers = new Map<string, WatchStopHandle>()

function stopPlaceholderWatcher(nodeId: string) {
  const stop = placeholderDownloadWatchers.get(nodeId)
  if (stop) {
    stop()
    placeholderDownloadWatchers.delete(nodeId)
  }
}

const defaultCameraState: SceneCameraState = (() => {
  const position = createVector(30, 20, 30)
  const target = createVector(0, 5, 0)
  return {
    position,
    target,
    fov: 60,
    forward: computeForwardVector(position, target),
  }
})()

const defaultPanelVisibility: PanelVisibilityState = {
  hierarchy: false,
  inspector: false,
  project: true,
}

const defaultPanelPlacement: PanelPlacementState = {
  hierarchy: 'floating',
  inspector: 'floating',
  project: 'docked',
}

function normalizePanelVisibilityState(input?: Partial<PanelVisibilityState> | null): PanelVisibilityState {
  const coerce = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback

  return {
    hierarchy: coerce(input?.hierarchy, defaultPanelVisibility.hierarchy),
    inspector: coerce(input?.inspector, defaultPanelVisibility.inspector),
    project: coerce(input?.project, defaultPanelVisibility.project),
  }
}

function normalizePanelPlacementStateInput(input?: Partial<PanelPlacementState> | null): PanelPlacementState {
  const coerce = (value: unknown, fallback: PanelPlacement): PanelPlacement =>
    value === 'docked' ? 'docked' : value === 'floating' ? 'floating' : fallback

  return {
    hierarchy: coerce(input?.hierarchy, defaultPanelPlacement.hierarchy),
    inspector: coerce(input?.inspector, defaultPanelPlacement.inspector),
    project: coerce(input?.project, defaultPanelPlacement.project),
  }
}

const PROJECT_PANEL_TREE_MIN_SIZE = 10
const PROJECT_PANEL_TREE_MAX_SIZE = 90
const DEFAULT_PROJECT_PANEL_TREE_SIZE = 20

function normalizeProjectPanelTreeSize(value: unknown): number {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseFloat(value)
      : Number.NaN
  if (!Number.isFinite(numeric)) {
    return DEFAULT_PROJECT_PANEL_TREE_SIZE
  }
  const clamped = Math.min(
    Math.max(Math.round(numeric * 100) / 100, PROJECT_PANEL_TREE_MIN_SIZE),
    PROJECT_PANEL_TREE_MAX_SIZE,
  )
  return clamped
}

const defaultShadowsEnabled = true

const defaultViewportSettings: SceneViewportSettings = {
  showGrid: false,
  showAxes: false,
  cameraProjection: 'perspective',
  cameraControlMode: 'orbit',

  snapMode: 'off',
  snapThresholdPx: 12,
}

function isCameraProjectionMode(value: unknown): value is CameraProjection {
  return value === 'perspective' || value === 'orthographic'
}

function isCameraControlMode(value: unknown): value is CameraControlMode {
  return value === 'orbit' || value === 'map'
}

function isViewportSnapMode(value: unknown): value is SceneViewportSnapMode {
  return value === 'off' || value === 'vertex'
}

function normalizeSnapThresholdPx(value: unknown): number {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseFloat(value)
      : Number.NaN
  if (!Number.isFinite(numeric)) {
    return defaultViewportSettings.snapThresholdPx
  }
  // Keep it within sane UI bounds.
  return Math.min(Math.max(Math.round(numeric), 1), 128)
}

function cloneViewportSettings(settings?: Partial<SceneViewportSettings> | null): SceneViewportSettings {
  return {
    showGrid: settings?.showGrid ?? defaultViewportSettings.showGrid,
    showAxes: settings?.showAxes ?? defaultViewportSettings.showAxes,
    cameraProjection: isCameraProjectionMode(settings?.cameraProjection)
      ? settings!.cameraProjection
      : defaultViewportSettings.cameraProjection,
    cameraControlMode: isCameraControlMode(settings?.cameraControlMode)
      ? settings!.cameraControlMode
      : defaultViewportSettings.cameraControlMode,

    snapMode: isViewportSnapMode(settings?.snapMode)
      ? settings!.snapMode
      : defaultViewportSettings.snapMode,
    snapThresholdPx: normalizeSnapThresholdPx(settings?.snapThresholdPx),
  }
}

function normalizeShadowsEnabledInput(value: unknown): boolean {
  return typeof value === 'boolean' ? value : defaultShadowsEnabled
}

function resolveDocumentShadowsEnabled(document: { shadowsEnabled?: boolean | null }): boolean {
  return normalizeShadowsEnabledInput(document.shadowsEnabled)
}

function viewportSettingsEqual(a: SceneViewportSettings, b: SceneViewportSettings): boolean {
  return (
    a.showGrid === b.showGrid &&
    a.showAxes === b.showAxes &&
    a.cameraProjection === b.cameraProjection &&
    a.cameraControlMode === b.cameraControlMode &&
    a.snapMode === b.snapMode &&
    a.snapThresholdPx === b.snapThresholdPx
  )
}

const GUIDEBOARD_NAME_PATTERN = /^Guideboard(?:\b|$)/i
const DISPLAY_BOARD_NAME_PATTERN = /^Display\s*Board(?:\b|$)/i

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function clonePlainRecord(source?: Record<string, unknown> | null): Record<string, unknown> | undefined {
  if (!source) {
    return undefined
  }
  const clone: Record<string, unknown> = {}
  let hasEntries = false

  for (const [key, rawValue] of Object.entries(source)) {
    if (rawValue === undefined) {
      continue
    }
    if (Array.isArray(rawValue)) {
      const clonedArray = rawValue.map((entry) => {
        if (isPlainRecord(entry)) {
          return clonePlainRecord(entry) ?? {}
        }
        return entry
      })
      clone[key] = clonedArray
      hasEntries = true
      continue
    }
    if (isPlainRecord(rawValue)) {
      const nested = clonePlainRecord(rawValue)
      if (nested) {
        clone[key] = nested
        hasEntries = true
      }
      continue
    }
    if (typeof rawValue === 'object') {
      continue
    }
    clone[key] = rawValue
    hasEntries = true
  }

  return hasEntries ? clone : undefined
}

function cloneAiModelMeshMetadata(metadata: AiModelMeshMetadata): AiModelMeshMetadata {
  return {
    version: metadata.version,
    name: metadata.name,
    vertices: [...metadata.vertices],
    indices: [...metadata.indices],
  }
}

function createAiModelMeshMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: '#d0d0d0',
    roughness: 0.85,
    metalness: 0.1,
  })
}

function createRuntimeMeshFromMetadata(nodeName: string | undefined, metadata: AiModelMeshMetadata): THREE.Mesh {
  const geometry = createBufferGeometryFromMetadata(metadata)
  const material = createAiModelMeshMaterial()
  const mesh = new THREE.Mesh(geometry, material)
  const label = nodeName && nodeName.trim().length ? nodeName : metadata.name ?? 'AI Generated Mesh'
  mesh.name = label
  prepareRuntimeObjectForNode(mesh)
  return mesh
}

function createRuntimeWaterSurfaceMesh(nodeName: string | undefined, metadata: ReturnType<typeof normalizeWaterSurfaceMeshInput>): THREE.Mesh {
  const mesh = createWaterSurfaceRuntimeMesh(metadata, {
    name: nodeName && nodeName.trim().length ? nodeName : 'Water Surface',
  })
  prepareRuntimeObjectForNode(mesh)
  return mesh
}

function ensureAiModelMeshRuntime(node: SceneNode): boolean {
  const metadata = extractAiModelMeshMetadataFromUserData(node.userData)
  if (!metadata) {
    return false
  }
  if (getRuntimeObject(node.id)) {
    return false
  }
  try {
    const runtime = createRuntimeMeshFromMetadata(node.name, metadata)
    runtime.userData = {
      ...(runtime.userData ?? {}),
      [AI_MODEL_MESH_USERDATA_KEY]: cloneAiModelMeshMetadata(metadata),
    }
    tagObjectWithNodeId(runtime, node.id)
    registerRuntimeObject(node.id, runtime)
    componentManager.attachRuntime(node, runtime)
    componentManager.syncNode(node)
    return true
  } catch (error) {
    console.warn('Failed to rebuild AI generated mesh runtime', node.id, error)
    return false
  }
}

function ensureWaterSurfaceMeshRuntime(node: SceneNode): boolean {
  const metadata = extractWaterSurfaceMeshMetadataFromUserData(node.userData)
  if (!metadata || !node.components?.[WATER_COMPONENT_TYPE]) {
    return false
  }
  if (getRuntimeObject(node.id)) {
    return false
  }
  try {
    const runtime = createRuntimeWaterSurfaceMesh(node.name, metadata)
    runtime.userData = {
      ...(runtime.userData ?? {}),
      [WATER_SURFACE_MESH_USERDATA_KEY]: cloneWaterSurfaceMeshMetadata(metadata),
    }
    tagObjectWithNodeId(runtime, node.id)
    registerRuntimeObject(node.id, runtime)
    componentManager.attachRuntime(node, runtime)
    componentManager.syncNode(node)
    return true
  } catch (error) {
    console.warn('Failed to rebuild water surface mesh runtime', node.id, error)
    return false
  }
}

function buildWaterSurfaceMeshFromWorldPoints(points: Vector3Like[]): {
  center: Vector3Like
  metadata: ReturnType<typeof normalizeWaterSurfaceMeshInput>
} | null {
  const sanitized = points
    .map((point) => ({
      x: Number(point.x),
      y: Number(point.y),
      z: Number(point.z),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z))

  if (sanitized.length < 3) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  sanitized.forEach((point) => {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minZ = Math.min(minZ, point.z)
    maxZ = Math.max(maxZ, point.z)
  })

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
    return null
  }

  const center = {
    x: (minX + maxX) * 0.5,
    y: sanitized[0]!.y,
    z: (minZ + maxZ) * 0.5,
  }

  try {
    const metadata = normalizeWaterSurfaceMeshInput({
      // Water surface mesh runtime remains rotated around X, so local contour Y stores negated world Z offset.
      contour: sanitized.flatMap((point) => [point.x - center.x, center.z - point.z]),
    })
    return { center, metadata }
  } catch {
    return null
  }
}

function buildWaterSurfaceMeshFromLocalPoints(points: Array<[number, number]>): ReturnType<typeof normalizeWaterSurfaceMeshInput> | null {
  const sanitized = points
    .map(([x, y]) => [Number(x), Number(y)] as [number, number])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))

  if (sanitized.length < 3) {
    return null
  }

  try {
    return normalizeWaterSurfaceMeshInput({
      contour: sanitized.flatMap(([x, y]) => [x, y]),
    })
  } catch {
    return null
  }
}

function resolveGroundNodeForHeightSampling(nodes: SceneNode[]): SceneNode | null {
  const byId = findNodeById(nodes, GROUND_NODE_ID)
  if (byId?.dynamicMesh?.type === 'Ground') {
    return byId
  }
  return null
}

function ensureDynamicMeshRuntime(node: SceneNode, groundNode: SceneNode | null): boolean {
  const meshDefinition = node.dynamicMesh
  if (!meshDefinition) {
    return false
  }

  const meshType = normalizeDynamicMeshType(meshDefinition.type)
  if (meshType !== 'Wall' && meshType !== 'Road' && meshType !== 'Floor' && meshType !== 'Landform' && meshType !== 'GuideRoute' && meshType !== 'Region') {
    return false
  }

  if (getRuntimeObject(node.id)) {
    return false
  }

  try {
    let runtime: Object3D;
    if (meshType === 'Road') {
      const roadState = node.components?.[ROAD_COMPONENT_TYPE] as
        | SceneNodeComponentState<RoadComponentProps>
        | undefined
      const roadProps = clampRoadProps(roadState?.props as Partial<RoadComponentProps> | null | undefined)
      runtime = createRoadGroup(meshDefinition as RoadDynamicMesh, {
        heightSampler: roadProps.snapToTerrain ? resolveRoadLocalHeightSampler(node, groundNode) : null,
      });
    } else if (meshType === 'Floor') {
      runtime = createFloorGroup(meshDefinition as FloorDynamicMesh);
    } else if (meshType === 'Landform') {
      runtime = createLandformGroup(meshDefinition as LandformDynamicMesh)
    } else if (meshType === 'GuideRoute') {
      runtime = createGuideRouteGroup(meshDefinition as GuideRouteDynamicMesh)
    } else if (meshType === 'Region') {
      runtime = new THREE.Group()
      runtime.name = 'Region'
      runtime.userData = {
        ...(runtime.userData ?? {}),
        dynamicMeshType: 'Region',
      }
    } else {
      const wallComponent = node.components?.[WALL_COMPONENT_TYPE] as SceneNodeComponentState<WallComponentProps> | undefined
      const wallProps = wallComponent
        ? clampWallProps(wallComponent.props as Partial<WallComponentProps> | null | undefined)
        : null
      runtime = createWallGroup(meshDefinition as WallDynamicMesh, {
        wallRenderMode: resolveWallRenderMode(node),
        repeatInstanceStep: resolveWallRepeatInstanceStep(node),
        headAssetHeight: wallProps?.headAssetHeight,
        footAssetHeight: wallProps?.footAssetHeight,
      });
    }

    runtime.name = node.name ?? runtime.name
    prepareRuntimeObjectForNode(runtime)
    tagObjectWithNodeId(runtime, node.id)
    registerRuntimeObject(node.id, runtime)
    componentManager.attachRuntime(node, runtime)
    componentManager.syncNode(node)
    return true
  } catch (error) {
    console.warn('Failed to rebuild dynamic mesh runtime', node.id, error)
    return false
  }
}

function evaluateViewPointAttributes(
  userData: Record<string, unknown> | undefined,
): {
  sanitizedUserData?: Record<string, unknown>
  shouldAttachViewPoint: boolean
  componentOverrides?: Partial<ViewPointComponentProps>
} {
  let shouldAttachViewPoint = false
  let sanitizedUserData: Record<string, unknown> | undefined = userData
  let componentOverrides: Partial<ViewPointComponentProps> | undefined

  if (!userData) {
    return { sanitizedUserData, shouldAttachViewPoint, componentOverrides }
  }

  const next: Record<string, unknown> = {}
  let mutated = false
  let overrideVisibility: boolean | undefined

  for (const [key, value] of Object.entries(userData)) {
    if (key === 'viewPoint') {
      mutated = true
      if (value === true) {
        shouldAttachViewPoint = true
      }
      continue
    }
    if (key === 'viewPointInitiallyVisible') {
      mutated = true
      if (value === true) {
        overrideVisibility = true
      } else if (value === false) {
        overrideVisibility = false
      }
      continue
    }
    if (key === 'viewPointRadius' || key === 'viewPointBaseScale') {
      mutated = true
      continue
    }
    next[key] = value
  }

  if (overrideVisibility !== undefined) {
    componentOverrides = { ...(componentOverrides ?? {}), initiallyVisible: overrideVisibility }
  }

  sanitizedUserData = mutated ? (Object.keys(next).length ? next : undefined) : userData

  return { sanitizedUserData, shouldAttachViewPoint, componentOverrides }
}

function evaluateDisplayBoardAttributes(
  userData: Record<string, unknown> | undefined,
  nodeName: string | undefined,
): { sanitizedUserData?: Record<string, unknown>; shouldAttachDisplayBoard: boolean } {
  let shouldAttachDisplayBoard = false
  let sanitizedUserData: Record<string, unknown> | undefined = userData

  if (userData) {
    const next: Record<string, unknown> = {}
    let mutated = false

    for (const [key, value] of Object.entries(userData)) {
      if (key === 'displayBoard' || key === 'isDisplayBoard') {
        mutated = true
        if (value === true) {
          shouldAttachDisplayBoard = true
        }
        continue
      }
      next[key] = value
    }

    sanitizedUserData = mutated ? (Object.keys(next).length ? next : undefined) : userData
  }

  if (!shouldAttachDisplayBoard) {
    const trimmedName = typeof nodeName === 'string' ? nodeName.trim() : ''
    if (trimmedName.length && DISPLAY_BOARD_NAME_PATTERN.test(trimmedName)) {
      shouldAttachDisplayBoard = true
    }
  }

  return { sanitizedUserData, shouldAttachDisplayBoard }
}

function evaluateGuideboardAttributes(
  userData: Record<string, unknown> | undefined,
  nodeName: string | undefined,
): { sanitizedUserData?: Record<string, unknown>; shouldAttachGuideboard: boolean } {
  let shouldAttachGuideboard = false
  let sanitizedUserData: Record<string, unknown> | undefined

  if (userData) {
    const next: Record<string, unknown> = {}
    let mutated = false

    for (const [key, value] of Object.entries(userData)) {
      if (key === 'isGuideboard') {
        mutated = true
        if (value === true) {
          shouldAttachGuideboard = true
        }
        continue
      }
      next[key] = value
    }

    sanitizedUserData = mutated ? (Object.keys(next).length ? next : undefined) : userData
  }

  if (!shouldAttachGuideboard) {
    const trimmedName = typeof nodeName === 'string' ? nodeName.trim() : ''
    if (trimmedName.length && GUIDEBOARD_NAME_PATTERN.test(trimmedName)) {
      shouldAttachGuideboard = true
    }
  }

  return { sanitizedUserData, shouldAttachGuideboard }
}

function evaluateWarpGateAttributes(
  userData: Record<string, unknown> | undefined,
): { sanitizedUserData?: Record<string, unknown>; shouldAttachWarpGate: boolean } {
  if (!userData) {
    return { sanitizedUserData: undefined, shouldAttachWarpGate: false }
  }

  const next: Record<string, unknown> = {}
  let mutated = false
  let shouldAttachWarpGate = false

  for (const [key, value] of Object.entries(userData)) {
    if (key === 'warpGate') {
      mutated = true
      if (value === true) {
        shouldAttachWarpGate = true
      }
      continue
    }
    next[key] = value
  }

  const sanitizedUserData = mutated ? (Object.keys(next).length ? next : undefined) : userData
  return { sanitizedUserData, shouldAttachWarpGate }
}

const runtimeObjectRegistry = new Map<string, Object3D>()
let runtimeRefreshInFlight: Promise<void> | null = null

export function clearRuntimeObjectRegistry() {
  runtimeObjectRegistry.forEach((_object, nodeId) => {
    releaseModelInstance(nodeId)
    componentManager.detachRuntime(nodeId)
  })
  runtimeObjectRegistry.clear()
}

export function registerRuntimeObject(id: string, object: Object3D) {
  const existing = runtimeObjectRegistry.get(id)
  if (existing && existing !== object) {
    componentManager.detachRuntime(id)
  }
  runtimeObjectRegistry.set(id, object)
}

export function unregisterRuntimeObject(id: string) {
  releaseModelInstance(id)
  runtimeObjectRegistry.delete(id)
  componentManager.detachRuntime(id)
}

export function getRuntimeObject(id: string): Object3D | null {
  return runtimeObjectRegistry.get(id) ?? null
}

function reattachRuntimeObjectsForNodes(nodes: SceneNode[]): void {
  runtimeObjectRegistry.forEach((object, nodeId) => {
    const node = findNodeById(nodes, nodeId)
    if (!node) {
      return
    }
    componentManager.attachRuntime(node, object)
  })
}

function tagObjectWithNodeId(object: Object3D, nodeId: string) {
  object.userData = {
    ...(object.userData ?? {}),
    nodeId,
  }
  object.traverse((child) => {
    child.userData = {
      ...(child.userData ?? {}),
      nodeId,
    }
  })
}

type InstancedBoundsPayload = {
  min: [number, number, number]
  max: [number, number, number]
}

const boundsTransformCorners = [
  new Vector3(),
  new Vector3(),
  new Vector3(),
  new Vector3(),
  new Vector3(),
  new Vector3(),
  new Vector3(),
  new Vector3(),
] as [Vector3, Vector3, Vector3, Vector3, Vector3, Vector3, Vector3, Vector3]
const boundsTransformPoint = new Vector3()

function serializeBoundingBox(box: Box3): InstancedBoundsPayload {
  return {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
  }
}

function deserializeBoundingBox(payload: unknown): Box3 | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }
  const rawMin = (payload as InstancedBoundsPayload).min
  const rawMax = (payload as InstancedBoundsPayload).max
  if (!Array.isArray(rawMin) || !Array.isArray(rawMax) || rawMin.length < 3 || rawMax.length < 3) {
    return null
  }
  const minX = Number(rawMin[0])
  const minY = Number(rawMin[1])
  const minZ = Number(rawMin[2])
  const maxX = Number(rawMax[0])
  const maxY = Number(rawMax[1])
  const maxZ = Number(rawMax[2])
  if (![minX, minY, minZ, maxX, maxY, maxZ].every((value) => Number.isFinite(value))) {
    return null
  }
  return new Box3(new Vector3(minX, minY, minZ), new Vector3(maxX, maxY, maxZ))
}

function expandBoxByTransformedBounds(target: Box3, bounds: Box3, matrix: Matrix4): void {
  if (bounds.isEmpty()) {
    return
  }
  const { min, max } = bounds
  boundsTransformCorners[0].set(min.x, min.y, min.z)
  boundsTransformCorners[1].set(min.x, min.y, max.z)
  boundsTransformCorners[2].set(min.x, max.y, min.z)
  boundsTransformCorners[3].set(min.x, max.y, max.z)
  boundsTransformCorners[4].set(max.x, min.y, min.z)
  boundsTransformCorners[5].set(max.x, min.y, max.z)
  boundsTransformCorners[6].set(max.x, max.y, min.z)
  boundsTransformCorners[7].set(max.x, max.y, max.z)
  boundsTransformCorners.forEach((corner) => {
    boundsTransformPoint.copy(corner).applyMatrix4(matrix)
    target.expandByPoint(boundsTransformPoint)
  })
}

function resolveWallDefinitionLocalBounds(mesh: WallDynamicMesh): Box3 | null {
  const chains = Array.isArray(mesh.chains) ? mesh.chains : []
  if (!chains.length) {
    return null
  }
  const width = Number.isFinite(mesh.dimensions?.width) ? mesh.dimensions.width : DEFAULT_WALL_WIDTH
  const thickness = Number.isFinite(mesh.dimensions?.thickness) ? mesh.dimensions.thickness : DEFAULT_WALL_THICKNESS
  const height = Number.isFinite(mesh.dimensions?.height) ? mesh.dimensions.height : DEFAULT_WALL_HEIGHT
  const lateralPadding = Math.max(Math.abs(width), Math.abs(thickness), DEFAULT_SPAWN_RADIUS * 0.1) * 0.5
  const verticalPadding = Math.max(Math.abs(height), 0)

  const bounds = new Box3()
  let initialized = false
  chains.forEach((chain) => {
    const points = Array.isArray(chain.points) ? chain.points : []
    points.forEach((point) => {
      const x = Number(point?.x)
      const y = Number(point?.y)
      const z = Number(point?.z)
      if (![x, y, z].every((value) => Number.isFinite(value))) {
        return
      }
      if (!initialized) {
        bounds.makeEmpty()
        initialized = true
      }
      bounds.expandByPoint(new Vector3(x - lateralPadding, y, z - lateralPadding))
      bounds.expandByPoint(new Vector3(x + lateralPadding, y + verticalPadding, z + lateralPadding))
    })
  })
  return initialized && !bounds.isEmpty() ? bounds : null
}

function resolveNodeLocalBounds(node: SceneNode, runtimeObject: Object3D | null): Box3 | null {
  const runtimeBounds = deserializeBoundingBox(runtimeObject?.userData?.instancedBounds)
  if (runtimeBounds && !runtimeBounds.isEmpty()) {
    return runtimeBounds
  }
  if (node.dynamicMesh?.type === 'Wall') {
    return resolveWallDefinitionLocalBounds(node.dynamicMesh)
  }
  return null
}

function createInstancedPlaceholderObject(name: string | undefined, group: ModelInstanceGroup): Object3D {
  const placeholder = new Object3D()
  placeholder.name = name ?? group.object.name ?? 'Instanced Model'
  const baseUserData = clonePlainRecord(group.object.userData as Record<string, unknown> | undefined)
  if (baseUserData) {
    placeholder.userData = baseUserData
  }
  placeholder.userData = {
    ...(placeholder.userData ?? {}),
    instanced: true,
    instancedAssetId: group.assetId,
    instancedBounds: serializeBoundingBox(group.boundingBox),
  }
  return placeholder
}

function createInstancedRuntimeProxy(
  node: SceneNode,
  group: ModelInstanceGroup,
  sourceAssetId?: string,
): Object3D | null {
  const effectiveAssetId = sourceAssetId ?? node.sourceAssetId
  if (!effectiveAssetId || effectiveAssetId !== group.assetId) {
    return null
  }
  if (!group.meshes.length) {
    return null
  }
  ensureInstancedMeshesRegistered(group.assetId)
  const binding = allocateModelInstance(group.assetId, node.id)
  if (!binding) {
    return null
  }
  const proxy = new Object3D()
  proxy.name = node.name ?? group.object.name ?? 'Instanced Model'
  proxy.visible = node.visible ?? true
  proxy.userData = {
    ...(proxy.userData ?? {}),
    instanced: true,
    instancedAssetId: group.assetId,
    instancedBounds: serializeBoundingBox(group.boundingBox),
  }
  updateModelInstanceMatrix(node.id, composeNodeMatrix(node))
  return proxy
}

function applyInstancedRuntimeToNode(node: SceneNode, group: ModelInstanceGroup): Object3D | null {
  const proxy = createInstancedRuntimeProxy(node, group)
  if (!proxy) {
    return null
  }
  proxy.name = node.name ?? proxy.name
  tagObjectWithNodeId(proxy, node.id)
  registerRuntimeObject(node.id, proxy)
  componentManager.attachRuntime(node, proxy)
  componentManager.syncNode(node)
  return proxy
}

// restoreRuntimeFromSnapshot removed (unused)

function collectNodesByAssetId(nodes: SceneNode[]): Map<string, SceneNode[]> {
  // Keep this collector sourceAssetId-only for delete-asset behavior.
  const map = new Map<string, SceneNode[]>()

  const ensureNodeAssetId = (assetId: string, node: SceneNode) => {
    if (!assetId.trim()) {
      return
    }
    if (!map.has(assetId)) {
      map.set(assetId, [])
    }
    map.get(assetId)!.push(node)
  }

  const traverse = (list: SceneNode[]) => {
    list.forEach((node) => {
      if (node.sourceAssetId) {
        ensureNodeAssetId(node.sourceAssetId, node)
      }

      if (node.children?.length) {
        traverse(node.children)
      }
    })
  }

  traverse(nodes)
  return map
}

function buildParentMap(
  nodes: SceneNode[],
  parentId: string | null = null,
  map: Map<string, string | null> = new Map(),
): Map<string, string | null> {
  nodes.forEach((node) => {
    map.set(node.id, parentId)
    if (node.children?.length) {
      buildParentMap(node.children, node.id, map)
    }
  })
  return map
}

function buildNodeLookup(nodes: SceneNode[]): Map<string, SceneNode> {
  const lookup = new Map<string, SceneNode>()
  const traverse = (list: SceneNode[]) => {
    list.forEach((node) => {
      lookup.set(node.id, node)
      if (node.children?.length) {
        traverse(node.children)
      }
    })
  }
  traverse(nodes)
  return lookup
}

function isGroupNode(node: SceneNode | null | undefined): node is SceneNode {
  return !!node && node.nodeType === 'Group'
}

function isGroupExpandedFlag(node: SceneNode | null | undefined): boolean {
  if (!isGroupNode(node)) {
    return false
  }
  return node.groupExpanded !== false
}

function collectExpandedGroupIds(nodes: SceneNode[]): string[] {
  const result: string[] = []
  const traverse = (list: SceneNode[]) => {
    list.forEach((node) => {
      if (isGroupNode(node) && isGroupExpandedFlag(node)) {
        result.push(node.id)
      }
      if (node.children?.length) {
        traverse(node.children)
      }
    })
  }
  traverse(nodes)
  return result
}

function findNearestGroupAncestorId(
  nodeId: string,
  context: { parentMap: Map<string, string | null>; nodeLookup: Map<string, SceneNode> },
): string | null {
  let parentId = context.parentMap.get(nodeId) ?? null
  while (parentId) {
    const parentNode = context.nodeLookup.get(parentId)
    if (isGroupNode(parentNode)) {
      return parentId
    }
    parentId = context.parentMap.get(parentId) ?? null
  }
  return null
}

function resolveSelectableNodeId(
  nodeId: string,
  context: { parentMap: Map<string, string | null>; nodeLookup: Map<string, SceneNode> },
): string {
  let currentId = nodeId
  while (true) {
    const parentId = context.parentMap.get(currentId) ?? null
    if (!parentId) {
      return currentId
    }
    const parentNode = context.nodeLookup.get(parentId)
    if (isGroupNode(parentNode) && !isGroupExpandedFlag(parentNode)) {
      currentId = parentId
      continue
    }
    return currentId
  }
}

function filterTopLevelNodeIds(ids: string[], parentMap: Map<string, string | null>): string[] {
  const idSet = new Set(ids)
  return ids.filter((id) => {
    let parent = parentMap.get(id) ?? null
    while (parent) {
      if (idSet.has(parent)) {
        return false
      }
      parent = parentMap.get(parent) ?? null
    }
    return true
  })
}

function collectRuntimeSnapshots(node: SceneNode, bucket: Map<string, Object3D>) {
  const runtime = getRuntimeObject(node.id)
  if (runtime) {
    try {
      bucket.set(node.id, runtime.clone(true))
    } catch (error) {
      console.warn('Failed to clone runtime object for history snapshot', node.id, error)
    }
  }
  node.children?.forEach((child) => collectRuntimeSnapshots(child, bucket))
}

function collectClipboardPayload(
  nodes: SceneNode[],
  ids: string[],
): { entries: ClipboardEntry[]; runtimeSnapshots: Map<string, Object3D> } {
  const runtimeSnapshots = new Map<string, Object3D>()
  if (!ids.length) {
    return { entries: [], runtimeSnapshots }
  }
  const uniqueIds = Array.from(new Set(ids))
  const parentMap = buildParentMap(nodes)
  const topLevelIds = filterTopLevelNodeIds(uniqueIds, parentMap)
  const entries: ClipboardEntry[] = []
  topLevelIds.forEach((id) => {
    if (id === GROUND_NODE_ID || id === ENVIRONMENT_NODE_ID) {
      return
    }
    const found = findNodeById(nodes, id)
    if (found) {
      const rootNode = nodePrefabHelpers.prepareNodePrefabRoot(found, { regenerateIds: false })
      nodePrefabHelpers.bakePrefabSubtreeTransforms(rootNode, nodes)
      const serialized = JSON.stringify(rootNode, null, 2)
      entries.push({
        sourceId: id,
        sourceParentId: parentMap.get(id) ?? null,
        root: rootNode,
        serialized: serialized
      })
      collectRuntimeSnapshots(found, runtimeSnapshots)

    }
  })
  return { entries, runtimeSnapshots }
}

function remapNodeReferenceValues(value: unknown, context: DuplicateContext): unknown {
  if (typeof value === 'string') {
    const { idMap, behaviorComponentIdMap, behaviorSequenceIdMap } = context
    if (idMap?.has(value)) {
      return idMap.get(value) as string
    }
    if (behaviorComponentIdMap?.has(value)) {
      return behaviorComponentIdMap.get(value) as string
    }
    if (behaviorSequenceIdMap?.has(value)) {
      return behaviorSequenceIdMap.get(value) as string
    }
    return value
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      const next = remapNodeReferenceValues(entry, context)
      if (next !== entry) {
        value[index] = next
      }
    })
    return value
  }
  if (isPlainRecord(value)) {
    const record = value as Record<string, unknown>
    Object.entries(record).forEach(([key, entry]) => {
      const next = remapNodeReferenceValues(entry, context)
      if (next !== entry) {
        record[key] = next
      }
    })
    return record
  }
  return value
}

function remapNodeInternalReferences(node: SceneNode, context: DuplicateContext) {
  const hasIdMapping = (context.idMap?.size ?? 0) > 0
  const hasBehaviorMapping = (context.behaviorComponentIdMap?.size ?? 0) > 0 || (context.behaviorSequenceIdMap?.size ?? 0) > 0
  if (!hasIdMapping && !hasBehaviorMapping) {
    return
  }
  if (node.components) {
    Object.values(node.components).forEach((component) => {
      if (!component) {
        return
      }
      if (component.props) {
        component.props = remapNodeReferenceValues(component.props, context) as typeof component.props
      }
      if (component.metadata) {
        component.metadata = remapNodeReferenceValues(component.metadata, context) as typeof component.metadata
      }
    })
  }
  if (node.userData && isPlainRecord(node.userData)) {
    const remapped = remapNodeReferenceValues(node.userData, context)
    if (isPlainRecord(remapped)) {
      node.userData = remapped as Record<string, unknown>
    }
  }
}

function regenerateBehaviorComponentIdentifiers(
  component: SceneNodeComponentState<BehaviorComponentProps>,
  context: DuplicateContext,
) {
  const previousComponentId = component.id
  component.id = generateUuid()
  if (previousComponentId && previousComponentId !== component.id) {
    if (!context.behaviorComponentIdMap) {
      context.behaviorComponentIdMap = new Map<string, string>()
    }
    context.behaviorComponentIdMap.set(previousComponentId, component.id)
  }
  const props = component.props as BehaviorComponentProps | undefined
  if (!props || !Array.isArray(props.behaviors)) {
    return
  }
  if (!context.behaviorSequenceIdMap) {
    context.behaviorSequenceIdMap = new Map<string, string>()
  }
  const sequenceIdMap = context.behaviorSequenceIdMap
  const updatedBehaviors = props.behaviors.map((behavior) => {
    const updated = { ...behavior }
    const previousSequenceId = typeof updated.sequenceId === 'string' ? updated.sequenceId.trim() : ''
    let nextSequenceId: string
    if (previousSequenceId.length) {
      const existing = sequenceIdMap.get(previousSequenceId)
      if (existing) {
        nextSequenceId = existing
      } else {
        nextSequenceId = createBehaviorSequenceId()
        sequenceIdMap.set(previousSequenceId, nextSequenceId)
      }
    } else {
      nextSequenceId = createBehaviorSequenceId()
    }
    updated.sequenceId = nextSequenceId
    updated.id = generateUuid()
    return updated
  })
  const nextProps: BehaviorComponentProps = {
    ...props,
    behaviors: updatedBehaviors,
  }
  component.props = nextProps as typeof component.props
}

function regenerateNodeBehaviorIdentifiers(node: SceneNode, context: DuplicateContext) {
  if (!node.components) {
    return
  }
  const behaviorComponent = node.components[BEHAVIOR_COMPONENT_TYPE] as SceneNodeComponentState<BehaviorComponentProps> | undefined
  if (!behaviorComponent) {
    return
  }
  regenerateBehaviorComponentIdentifiers(behaviorComponent, context)
}

function deepCloneReferenceTree<T>(value: T): T {
  if (value === null || value === undefined) {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((entry) => deepCloneReferenceTree(entry)) as unknown as T
  }
  if (isPlainRecord(value)) {
    const record = value as Record<string, unknown>
    const cloned: Record<string, unknown> = {}
    Object.entries(record).forEach(([key, entry]) => {
      cloned[key] = deepCloneReferenceTree(entry)
    })
    return cloned as unknown as T
  }
  return value
}

function cloneNodeForDuplication(node: SceneNode): SceneNode {
  const clonedUserData = deepCloneReferenceTree(clonePlainRecord(node.userData ?? undefined))
  const viewPointResult = evaluateViewPointAttributes(clonedUserData)
  const displayBoardResult = evaluateDisplayBoardAttributes(viewPointResult.sanitizedUserData, node.name)
  const guideboardResult = evaluateGuideboardAttributes(displayBoardResult.sanitizedUserData, node.name)
  const warpGateResult = evaluateWarpGateAttributes(guideboardResult.sanitizedUserData)

  const { children: _children, ...nodeWithoutChildren } = node as SceneNode & { children?: SceneNode[] }

  const workingNode: SceneNode = {
    ...nodeWithoutChildren,
    userData: warpGateResult.sanitizedUserData
      ? (deepCloneReferenceTree(warpGateResult.sanitizedUserData) as Record<string, unknown>)
      : undefined,
  }

  const normalizedComponents = normalizeNodeComponents(
    workingNode,
    node.components,
    {
      attachDisplayBoard: displayBoardResult.shouldAttachDisplayBoard,
      attachGuideboard: guideboardResult.shouldAttachGuideboard,
      attachViewPoint: viewPointResult.shouldAttachViewPoint,
      attachWarpGate: warpGateResult.shouldAttachWarpGate,
      viewPointOverrides: viewPointResult.componentOverrides,
    },
  )

  if (normalizedComponents) {
    Object.values(normalizedComponents).forEach((component) => {
      if (!component) {
        return
      }
      if (component.props !== undefined) {
        component.props = deepCloneReferenceTree(component.props)
      }
      if (component.metadata !== undefined) {
        component.metadata = deepCloneReferenceTree(component.metadata)
      }
    })
  }

  const nodeType = normalizeSceneNodeType(workingNode.nodeType)
  const materialsSource = workingNode.materials
  const materials = sceneNodeTypeSupportsMaterials(nodeType) ? cloneNodeMaterials(materialsSource) : undefined

  return {
    ...workingNode,
    nodeType,
    materials,
    components: normalizedComponents,
    light: node.light
      ? {
          ...node.light,
          target: node.light.target ? cloneVector(node.light.target) : undefined,
        }
      : undefined,
    camera: node.camera ? { ...node.camera } : undefined,
    position: cloneVector(node.position),
    rotation: cloneVector(node.rotation),
    scale: cloneVector(node.scale),
    dynamicMesh: cloneDynamicMeshDefinition(node.dynamicMesh),
    importMetadata: workingNode.importMetadata
      ? {
          assetId: workingNode.importMetadata.assetId,
          objectPath: Array.isArray(workingNode.importMetadata.objectPath)
            ? [...workingNode.importMetadata.objectPath]
            : [],
        }
      : undefined,
    editorFlags: cloneEditorFlags(node.editorFlags),
  }
}

function duplicateNodeTree(original: SceneNode, context: DuplicateContext): SceneNode {
  const duplicated = cloneNodeForDuplication(original)
  const newId = generateUuid()
  duplicated.id = newId
  context.idMap?.set(original.id, newId)

  if (context.regenerateBehaviorIds) {
    regenerateNodeBehaviorIdentifiers(duplicated, context)
  }

  if (original.children?.length) {
    duplicated.children = original.children.map((child) => duplicateNodeTree(child, context))
  } else {
    delete duplicated.children
  }
  remapNodeInternalReferences(duplicated, context)
  if (duplicated.sourceAssetId) {
    context.assetCache.touch(duplicated.sourceAssetId)
  }
  componentManager.syncNode(duplicated)

  return duplicated
}

function cloneVector(vector: Vector3Like): Vector3Like {
  if (vector instanceof THREE.Vector3) {
    return { x: vector.x, y: vector.y, z: vector.z } as Vector3Like
  }
  return { x: vector.x, y: vector.y, z: vector.z } as Vector3Like
}

function computeAssetSpawnTransform(
  asset: ProjectAsset,
  position?: Vector3Like,
  options: { rotation?: Vector3Like | null } = {},
) {
  const spawnPosition = position ? cloneVector(position) : { x: 0, y: 0, z: 0 }
  const rotation: Vector3Like = options.rotation ? cloneVector(options.rotation) : { x: 0, y: 0, z: 0 }
  const scale: Vector3Like = { x: 1, y: 1, z: 1 }

  if (!position && asset.type !== 'model' && asset.type !== 'mesh') {
    spawnPosition.y = 1
  }

  if (asset.type === 'model' || asset.type === 'mesh') {
    const baseHeight = Math.max(scale.y, 0)
    const offset = baseHeight / 2
    spawnPosition.y = (position?.y ?? spawnPosition.y) + offset
  }

  return {
    position: spawnPosition,
    rotation,
    scale,
  }
}

function composeNodeMatrix(node: SceneNode): Matrix4 {
  const position = new Vector3(node.position.x, node.position.y, node.position.z)
  const rotation = new Euler(node.rotation.x, node.rotation.y, node.rotation.z, 'XYZ')
  const quaternion = new Quaternion().setFromEuler(rotation)
  const scale = new Vector3(node.scale.x, node.scale.y, node.scale.z)
  return new Matrix4().compose(position, quaternion, scale)
}

type CollisionSphere = {
  center: Vector3
  radius: number
}

type ObjectMetrics = {
  bounds: Box3
  center: Vector3
  radius: number
}

// Global toggle: completely disable grid snapping in editor logic.
// Keep snapping implementation for potential future re-enable.
const GRID_SNAPPING_ENABLED = false

function snapAxisToGrid(value: number): number {
  if (!GRID_SNAPPING_ENABLED) {
    return value
  }
  return Math.round(value / GRID_CELL_SIZE) * GRID_CELL_SIZE
}

function toPlainVector(vector: Vector3): Vector3Like {
  return { x: vector.x, y: vector.y, z: vector.z } as Vector3Like
}

function collectCollisionSpheres(nodes: SceneNode[]): CollisionSphere[] {
  const spheres: CollisionSphere[] = []
  const traverse = (list: SceneNode[], parentMatrix: Matrix4) => {
    list.forEach((node) => {
      const nodeMatrix = composeNodeMatrix(node)
      const worldMatrix = new Matrix4().multiplyMatrices(parentMatrix, nodeMatrix)

      const skipCollision = node.editorFlags?.ignoreGridSnapping || node.editorFlags?.editorOnly
  if (!skipCollision && !node.isPlaceholder && node.nodeType !== 'Light') {
        const runtimeObject = getRuntimeObject(node.id)
  if (runtimeObject && node.dynamicMesh?.type !== 'Ground') {
          runtimeObject.updateMatrixWorld(true)
          const bounds = new Box3().setFromObject(runtimeObject)
          if (!bounds.isEmpty()) {
            // `setFromObject` returns world-space bounds (using `matrixWorld`).
            const worldCenter = bounds.getCenter(new Vector3())
            const size = bounds.getSize(new Vector3())
            const radius = Math.max(size.length() * 0.5, DEFAULT_SPAWN_RADIUS)
            spheres.push({ center: worldCenter, radius })
          }
        }
      }

      if (node.children?.length) {
        traverse(node.children, worldMatrix)
      }
    })
  }

  traverse(nodes, new Matrix4())
  return spheres
}

type NodeBoundingInfo = {
  bounds: Box3
}

function collectNodeBoundingInfo(nodes: SceneNode[]): Map<string, NodeBoundingInfo> {
  const info = new Map<string, NodeBoundingInfo>()

  const traverse = (list: SceneNode[], parentMatrix: Matrix4) => {
    list.forEach((node) => {
      const nodeMatrix = composeNodeMatrix(node)
      const worldMatrix = new Matrix4().multiplyMatrices(parentMatrix, nodeMatrix)

      let nodeBounds: Box3 | null = null
      const runtimeObject = getRuntimeObject(node.id)
      const explicitLocalBounds = resolveNodeLocalBounds(node, runtimeObject)

      if (explicitLocalBounds && !explicitLocalBounds.isEmpty()) {
        nodeBounds = new Box3()
        expandBoxByTransformedBounds(nodeBounds, explicitLocalBounds, worldMatrix)
      }

      if (!nodeBounds && !node.isPlaceholder && node.nodeType !== 'Light') {
        if (runtimeObject && node.dynamicMesh?.type !== 'Ground') {
          runtimeObject.updateMatrixWorld(true)
          const localBounds = new Box3().setFromObject(runtimeObject)
          if (!localBounds.isEmpty()) {
            // `setFromObject` already returns bounds in world space (uses `matrixWorld`).
            nodeBounds = localBounds.clone()
          }
        }
      }

      if (!nodeBounds || nodeBounds.isEmpty()) {
        const position = new Vector3()
        const quaternion = new Quaternion()
        const scale = new Vector3()
        worldMatrix.decompose(position, quaternion, scale)
        const extent = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z), 1) * DEFAULT_SPAWN_RADIUS * 0.5
        const size = new Vector3(extent, extent, extent)
        nodeBounds = new Box3().setFromCenterAndSize(position, size)
      }

      if (node.children?.length) {
        traverse(node.children, worldMatrix)
        node.children.forEach((child) => {
          const childInfo = info.get(child.id)
          if (childInfo) {
            nodeBounds!.union(childInfo.bounds)
          }
        })
      }

      info.set(node.id, { bounds: nodeBounds.clone() })
    })
  }

  traverse(nodes, new Matrix4())
  return info
}

function computeObjectMetrics(object: Object3D): ObjectMetrics {
  object.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(object)
  if (bounds.isEmpty()) {
    return {
      bounds,
      center: new Vector3(),
      radius: DEFAULT_SPAWN_RADIUS,
    }
  }
  const center = bounds.getCenter(new Vector3())
  const size = bounds.getSize(new Vector3())
  const radius = Math.max(size.length() * 0.5, DEFAULT_SPAWN_RADIUS)
  return { bounds, center, radius }
}

function computeInstancedMetrics(group: ModelInstanceGroup): ObjectMetrics {
  const bounds = group.boundingBox.clone()
  const center = bounds.getCenter(new Vector3())
  return {
    bounds,
    center,
    radius: Math.max(group.radius, DEFAULT_SPAWN_RADIUS),
  }
}

function resolveSpawnPosition(params: {
  baseY: number
  radius: number
  localCenter?: Vector3
  camera: SceneCameraState | null | undefined
  nodes: SceneNode[]
  snapToGrid?: boolean
}): Vector3 {
  const { baseY, radius, localCenter, camera } = params
  const shouldSnap = params.snapToGrid !== false
  if (!camera) {
    const fallback = new Vector3(0, baseY, 0)
    if (shouldSnap) {
      fallback.x = snapAxisToGrid(fallback.x)
      fallback.z = snapAxisToGrid(fallback.z)
    }
    return fallback
  }

  const cameraPosition = new Vector3(camera.position.x, camera.position.y, camera.position.z)
  const cameraTarget = new Vector3(camera.target.x, camera.target.y, camera.target.z)

  let direction = camera.forward
    ? new Vector3(camera.forward.x, camera.forward.y, camera.forward.z)
    : cameraTarget.clone().sub(cameraPosition)

  if (direction.lengthSq() < CAMERA_DISTANCE_EPSILON) {
    direction = cameraTarget.clone().sub(cameraPosition)
  }
  if (direction.lengthSq() < CAMERA_DISTANCE_EPSILON) {
    direction.set(0, 0, -1)
  }
  direction.normalize()

  if (Math.abs(direction.y) > 0.95) {
    direction.y = 0
    if (direction.lengthSq() < CAMERA_DISTANCE_EPSILON) {
      direction.set(0, 0, -1)
    } else {
      direction.normalize()
    }
  }

  const collisions = collectCollisionSpheres(params.nodes)
  const margin = Math.max(radius * 0.25, COLLISION_MARGIN)
  const minDistance = Math.max(CAMERA_NEAR * 10, radius * 2)
  const maxDistance = Math.max(minDistance + GRID_CELL_SIZE, CAMERA_FAR * 0.9)
  const targetDistance = cameraPosition.distanceTo(cameraTarget)
  let baseDistance = Number.isFinite(targetDistance)
    ? MathUtils.clamp(targetDistance, minDistance, maxDistance)
    : minDistance
  if (!Number.isFinite(baseDistance) || baseDistance < minDistance) {
    baseDistance = minDistance
  }

  const step = Math.max(radius, GRID_CELL_SIZE)
  const candidate = new Vector3()
  const worldCenter = new Vector3()
  const localCenterVec = localCenter ? localCenter.clone() : new Vector3()

  for (let attempt = 0; attempt < MAX_SPAWN_ATTEMPTS; attempt += 1) {
    const distance = baseDistance + attempt * step
    if (distance > maxDistance) {
      break
    }

    candidate.copy(cameraPosition).addScaledVector(direction, distance)
    if (shouldSnap) {
      candidate.x = snapAxisToGrid(candidate.x)
      candidate.z = snapAxisToGrid(candidate.z)
    }
    candidate.y = baseY

    worldCenter.copy(localCenterVec).add(candidate)

    const collides = collisions.some((sphere) => {
      const separation = worldCenter.distanceTo(sphere.center)
      return separation < sphere.radius + radius + margin
    })

    if (!collides) {
      return candidate
    }
  }

  candidate.copy(cameraPosition).addScaledVector(direction, Math.min(baseDistance, maxDistance))
  if (shouldSnap) {
    candidate.x = snapAxisToGrid(candidate.x)
    candidate.z = snapAxisToGrid(candidate.z)
  }
  candidate.y = baseY
  return candidate
}

function computeWorldMatrixForNode(nodes: SceneNode[], targetId: string): Matrix4 | null {
  const identity = new Matrix4()

  const traverse = (list: SceneNode[], parentMatrix: Matrix4): Matrix4 | null => {
    for (const node of list) {
      const localMatrix = composeNodeMatrix(node)
      const worldMatrix = new Matrix4().multiplyMatrices(parentMatrix, localMatrix)
      if (node.id === targetId) {
        return worldMatrix
      }
      if (node.children) {
        const found = traverse(node.children, worldMatrix)
        if (found) {
          return found
        }
      }
    }
    return null
  }

  return traverse(nodes, identity)
}

function cloneCameraState(camera: SceneCameraState): SceneCameraState {
  const position = cloneVector(camera.position)
  const target = cloneVector(camera.target)
  const forwardSource = camera.forward ?? computeForwardVector(camera.position, camera.target)
  return {
    position,
    target,
    fov: camera.fov,
    forward: cloneVector(forwardSource),
  }
}

function visitNode(nodes: SceneNode[], id: string, mutate: (node: SceneNode) => void): boolean {
  for (const node of nodes) {
    if (node.id === id) {
      mutate(node)
      return true
    }
    if (node.children && visitNode(node.children, id, mutate)) {
      return true
    }
  }
  return false
}

function toHierarchyItem(node: SceneNode): HierarchyTreeItem {
  return {
    id: node.id,
    name: node.name,
    visible: node.visible ?? true,
    locked: node.locked ?? false,
    nodeType: node.nodeType,
    instanced: !!node.userData?.instanced,
    lightType: node.light?.type,
    dynamicMeshType: node.dynamicMesh?.type,
    children: node.children?.map(toHierarchyItem),
  }
}

function cloneEditorFlags(flags?: SceneNodeEditorFlags | null): SceneNodeEditorFlags | undefined {
  if (!flags) {
    return undefined
  }
  const next: SceneNodeEditorFlags = {}
  if (flags.editorOnly !== undefined) {
    next.editorOnly = flags.editorOnly
  }
  if (flags.ignoreGridSnapping !== undefined) {
    next.ignoreGridSnapping = flags.ignoreGridSnapping
  }
  return Object.keys(next).length ? next : undefined
}

function cloneNode(node: SceneNode): SceneNode {
  const clonedUserData = clonePlainRecord(node.userData ?? undefined)
  const viewPointResult = evaluateViewPointAttributes(clonedUserData)
  const displayBoardResult = evaluateDisplayBoardAttributes(viewPointResult.sanitizedUserData, node.name)
  const guideboardResult = evaluateGuideboardAttributes(displayBoardResult.sanitizedUserData, node.name)
  const warpGateResult = evaluateWarpGateAttributes(guideboardResult.sanitizedUserData)

  const workingNode: SceneNode = {
    ...node,
    userData: warpGateResult.sanitizedUserData,
  }

  const normalizedComponents = normalizeNodeComponents(
    workingNode,
    node.components,
    {
      attachDisplayBoard: displayBoardResult.shouldAttachDisplayBoard,
      attachGuideboard: guideboardResult.shouldAttachGuideboard,
      attachViewPoint: viewPointResult.shouldAttachViewPoint,
      attachWarpGate: warpGateResult.shouldAttachWarpGate,
      viewPointOverrides: viewPointResult.componentOverrides,
    },
  )

  const nodeType = normalizeSceneNodeType(workingNode.nodeType)
  const materialsSource = workingNode.materials
  const materials = sceneNodeTypeSupportsMaterials(nodeType) ? cloneNodeMaterials(materialsSource) : undefined
  const children = node.children ? node.children.map(cloneNode) : undefined

  return {
    ...workingNode,
    nodeType,
    materials,
    components: normalizedComponents,
    light: node.light
      ? {
          ...node.light,
          target: node.light.target ? cloneVector(node.light.target) : undefined,
        }
      : undefined,
    camera: node.camera ? { ...node.camera } : undefined,
    position: cloneVector(node.position),
    rotation: cloneVector(node.rotation),
    scale: cloneVector(node.scale),
    children,
    dynamicMesh: cloneDynamicMeshDefinition(node.dynamicMesh),
    importMetadata: workingNode.importMetadata
      ? {
          assetId: workingNode.importMetadata.assetId,
          objectPath: Array.isArray(workingNode.importMetadata.objectPath)
            ? [...workingNode.importMetadata.objectPath]
            : [],
        }
      : undefined,
    editorFlags: cloneEditorFlags(node.editorFlags),
  }
}

function createDefaultSceneNodes(settings?: GroundSettings, environment?: EnvironmentSettings): SceneNode[] {
  const environmentSettings = environment ? cloneEnvironmentSettings(environment) : DEFAULT_ENVIRONMENT_SETTINGS
  const baseNodes = ensureEnvironmentNode(ensureGroundNode([], settings), environmentSettings)

  const ambientPreset = getLightPreset('Ambient')
  const hemispherePreset = getLightPreset('Hemisphere')

  const ambient = createLightNode({
    name: ambientPreset.name,
    type: 'Ambient',
    color: ambientPreset.color,
    intensity: ambientPreset.intensity,
    position: ambientPreset.position,
    target: (ambientPreset as any).target,
    extras: ambientPreset.extras as any,
  })

  const hemisphere = createLightNode({
    name: hemispherePreset.name,
    type: 'Hemisphere',
    color: hemispherePreset.color,
    intensity: hemispherePreset.intensity,
    position: hemispherePreset.position,
    target: (hemispherePreset as any).target,
    extras: hemispherePreset.extras as any,
  })

  return [ambient, hemisphere, ...baseNodes]
}

function cloneSceneNodes(nodes: SceneNode[]): SceneNode[] {
  return nodes.map(cloneNode)
}
// System clipboard I/O has been moved to clipboardStore

function getAssetFromCatalog(catalog: Record<string, ProjectAsset[]>, assetId: string): ProjectAsset | null {
  for (const list of Object.values(catalog)) {
    const match = list.find((asset) => asset.id === assetId)
    if (match) {
      return match
    }
  }
  return null
}

function normalizeAssetIdForExportLookup(
  assetId: unknown,
  assetRegistry: Record<string, SceneAssetRegistryEntry>,
): string | null {
  return normalizeAssetIdWithRegistry(assetId, assetRegistry)
}

async function loadConfigAssetTextForDependencyTraversal(
  assetId: string,
  assetCatalog: Record<string, ProjectAsset[]>,
  assetRegistry: Record<string, SceneAssetRegistryEntry> = {},
): Promise<string | null> {
  const normalizedAssetId = normalizeAssetIdForExportLookup(assetId, assetRegistry)
  if (!normalizedAssetId) {
    return null
  }

  const assetCache = useAssetCacheStore()
  const asset = getAssetFromCatalog(assetCatalog, normalizedAssetId)
  let file: File | null = null
  try {
    file = await assetCache.ensureAssetFile(normalizedAssetId, { asset })
  } catch {
    return null
  }
  if (file) {
    return file.text()
  }

  const cacheEntry = assetCache.getEntry(normalizedAssetId)
  if (cacheEntry.status === 'cached' && cacheEntry.blob) {
    return cacheEntry.blob.text()
  }

  return null
}

function replaceMaterialTextureReferences(
  textures: Partial<Record<SceneMaterialTextureSlot, SceneMaterialTextureRef | null>> | undefined,
  previousId: string,
  nextId: string,
) {
  if (!textures) {
    return
  }
  MATERIAL_TEXTURE_SLOTS.forEach((slot) => {
    const reference = textures[slot]
    if (reference?.assetId === previousId) {
      textures[slot] = { ...reference, assetId: nextId }
    }
  })
}

function replaceAssetIdInMaterials(materials: SceneMaterial[], previousId: string, nextId: string) {
  materials.forEach((material) => {
    if (material.id === previousId) {
      material.id = nextId
    }
    replaceMaterialTextureReferences(material.textures, previousId, nextId)
  })
}

function parseExplicitReferencePath(path: string): Array<string | number> {
  const segments: Array<string | number> = []
  const pattern = /([^.[\]]+)|\[(\d+)\]/g
  let match: RegExpExecArray | null = null
  while ((match = pattern.exec(path)) !== null) {
    if (typeof match[1] === 'string' && match[1].length) {
      segments.push(match[1])
      continue
    }
    if (typeof match[2] === 'string' && match[2].length) {
      segments.push(Number.parseInt(match[2], 10))
    }
  }
  return segments
}

function replaceAssetIdAtReferencePath(root: unknown, path: string, previousId: string, nextId: string): boolean {
  const segments = parseExplicitReferencePath(path)
  if (!segments.length || !root || typeof root !== 'object') {
    return false
  }

  let current: unknown = root
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (!current || typeof current !== 'object') {
      return false
    }
    current = (current as Record<string | number, unknown>)[segments[index] as string | number]
  }

  if (!current || typeof current !== 'object') {
    return false
  }

  const lastSegment = segments[segments.length - 1] as string | number
  const container = current as Record<string | number, unknown>
  if (container[lastSegment] !== previousId) {
    return false
  }
  container[lastSegment] = nextId
  return true
}

function replaceAssetIdInComponentReferences(node: SceneNode, previousId: string, nextId: string): boolean {
  if (!node.components) {
    return false
  }

  let changed = false
  Object.entries(node.components).forEach(([componentType, componentState]) => {
    const props = componentState?.props as Record<string, unknown> | null | undefined
    if (!props) {
      return
    }

    visitExplicitComponentAssetReferences(componentType, props, (reference) => {
      if (reference.assetId !== previousId) {
        return
      }
      changed = replaceAssetIdAtReferencePath(props, reference.path, previousId, nextId) || changed
    })
  })

  return changed
}

function replaceAssetIdInNodes(
  nodes: SceneNode[],
  previousId: string,
  nextId: string,
): { changed: boolean; componentReferencesChanged: boolean } {
  let changed = false
  let componentReferencesChanged = false

  nodes.forEach((node) => {
    if (node.sourceAssetId === previousId) {
      node.sourceAssetId = nextId
      changed = true
    }
    if (node.importMetadata?.assetId === previousId) {
      node.importMetadata.assetId = nextId
      changed = true
    }
    if (node.materials?.length) {
      node.materials.forEach((material) => {
        replaceMaterialTextureReferences(material.textures, previousId, nextId)
      })
      changed = true
    }
    if (replaceAssetIdInComponentReferences(node, previousId, nextId)) {
      changed = true
      componentReferencesChanged = true
    }
    if (node.children?.length) {
      const childResult = replaceAssetIdInNodes(node.children, previousId, nextId)
      changed = childResult.changed || changed
      componentReferencesChanged = childResult.componentReferencesChanged || componentReferencesChanged
    }
  })

  return { changed, componentReferencesChanged }
}

function buildSceneAssetRegistryEntry(
  assetId: string,
  sourceMeta: AssetSourceMetadata | undefined,
  asset: ProjectAsset | null,
  summaryEntry: SceneResourceSummaryEntry | undefined,
  existingEntry: SceneAssetRegistryEntry | undefined,
): SceneAssetRegistryEntry | null {
  const summaryBytes = typeof summaryEntry?.bytes === 'number' ? summaryEntry.bytes : undefined
  const assetType = asset?.type ?? summaryEntry?.type
  const name = asset?.name ?? summaryEntry?.name
  const reusableExistingEntry = shouldReuseExistingRegistryEntryForExport(existingEntry) ? existingEntry : undefined
  const resolvedSourceMeta =
    sourceMeta
    ?? inferPackageSourceFromAssetId(assetId)
    ?? inferPackageSourceFromRegistryEntry(reusableExistingEntry)
  const summaryDownloadUrl = normalizeHttpUrl(summaryEntry?.downloadUrl ?? null)

  if (resolvedSourceMeta?.type === 'server' || (resolvedSourceMeta?.type === 'package' && isServerBackedProviderId(resolvedSourceMeta.providerId))) {
    return buildServerRegistryEntry(assetId, asset, resolvedSourceMeta, { bytes: summaryBytes, assetType, name })
  }

  if (!resolvedSourceMeta && summaryEntry?.source === 'remote' && summaryDownloadUrl) {
    return {
      sourceType: 'url',
      url: summaryDownloadUrl,
      bytes: summaryBytes,
      assetType,
      name,
    }
  }

  if (reusableExistingEntry) {
    const nextEntry: SceneAssetRegistryEntry = { ...reusableExistingEntry }
    if (typeof nextEntry.bytes !== 'number' && typeof summaryBytes === 'number') {
      nextEntry.bytes = summaryBytes
    }
    if (!nextEntry.assetType && assetType) {
      nextEntry.assetType = assetType
    }
    if (!nextEntry.name && name) {
      nextEntry.name = name
    }
    if (nextEntry.sourceType === 'url') {
      const resolvedUrl = normalizeHttpUrl(nextEntry.url) ?? resolveAssetDownloadUrl(asset)
      if (resolvedUrl) {
        nextEntry.url = resolvedUrl
      }
    } else if (nextEntry.sourceType === 'server') {
      const resolvedUrl = nextEntry.resolvedUrl ?? resolveAssetDownloadUrl(asset)
      if (!nextEntry.fileKey && asset?.fileKey) {
        nextEntry.fileKey = asset.fileKey
      }
      nextEntry.resolvedUrl = resolvedUrl ?? null
    }
    return nextEntry
  }

  if (resolvedSourceMeta?.type === 'local') {
    return {
      sourceType: 'package',
      zipPath: `local::${assetId}`,
      bytes: summaryBytes,
      assetType,
      name,
    }
  }

  if (resolvedSourceMeta?.type === 'package') {
    const providerId = typeof resolvedSourceMeta.providerId === 'string' ? resolvedSourceMeta.providerId.trim() : ''
    const originalAssetId =
      typeof resolvedSourceMeta.originalAssetId === 'string' && resolvedSourceMeta.originalAssetId.trim().length
        ? resolvedSourceMeta.originalAssetId.trim()
        : assetId
    if (providerId) {
      return {
        sourceType: 'package',
        zipPath: `${providerId}::${originalAssetId}`,
        bytes: summaryBytes,
        assetType,
        name,
      }
    }
  }

  const resolvedUrl = resolveAssetDownloadUrl(asset)

  if (resolvedSourceMeta?.type === 'url') {
    if (!resolvedUrl) {
      return null
    }
    return {
      sourceType: 'url',
      url: resolvedUrl,
      bytes: summaryBytes,
      assetType,
      name,
    }
  }

  if (!resolvedSourceMeta && resolvedUrl) {
    return {
      sourceType: 'url',
      url: resolvedUrl,
      bytes: summaryBytes,
      assetType,
      name,
    }
  }

  return buildServerRegistryEntry(assetId, asset, resolvedSourceMeta, { bytes: summaryBytes, assetType, name })
}

export async function buildAssetRegistryForExport(
  scene: StoredSceneDocument,
): Promise<Record<string, SceneAssetRegistryEntry>> {
  const runtimeAwareScene = cloneSceneDocumentWithRuntimeGroundSidecars(scene)
  const existingRegistry = runtimeAwareScene.assetRegistry ?? {}
  const normalizeExportAssetId = (assetId: string): string | null => normalizeAssetIdForExportLookup(assetId, existingRegistry)
  const usedAssetIds = normalizeAssetIdsWithRegistry(collectSceneAssetReferences(runtimeAwareScene), existingRegistry)
  const directReferenceAssetIds = normalizeAssetIdsWithRegistry(
    collectDirectSceneAssetReferenceIds(runtimeAwareScene),
    existingRegistry,
  )
  const retainedConfigAssetIds = new Set(
    normalizeAssetIdsWithRegistry(collectRuntimeRequiredConfigAssetIds(runtimeAwareScene), existingRegistry),
  )
  const configDependencyAssetIds = await collectTransitiveConfigDependencyAssetIds(
    directReferenceAssetIds,
    runtimeAwareScene.assetCatalog ?? {},
    {
      loadPrefab: async (assetId) => {
        const canonicalAssetId = normalizeExportAssetId(assetId) ?? assetId
        return prefabActions.loadNodePrefab({
          getAsset: (queryAssetId: string) => {
            const canonicalQueryAssetId = normalizeExportAssetId(queryAssetId) ?? queryAssetId
            return getAssetFromCatalog(runtimeAwareScene.assetCatalog ?? {}, canonicalQueryAssetId)
          },
          registerAsset: () => { throw new Error('registerAsset should not be called during export dependency collection') },
        } as unknown as PrefabStoreLike, canonicalAssetId)
      },
      loadConfigAssetText: (assetId) => loadConfigAssetTextForDependencyTraversal(
        assetId,
        runtimeAwareScene.assetCatalog ?? {},
        existingRegistry,
      ),
      normalizeAssetId: normalizeExportAssetId,
    },
  )
  const assetCatalog = runtimeAwareScene.assetCatalog ?? {}
  const summaryEntries = new Map<string, SceneResourceSummaryEntry>()
  const exportAssetIds = new Set<string>()

  usedAssetIds.forEach((assetId) => {
    const asset = getAssetFromCatalog(assetCatalog, assetId)
    if (!shouldExcludeAssetFromRuntimeExport(asset, { assetId, retainedConfigAssetIds })) {
      exportAssetIds.add(assetId)
    }
  })
  configDependencyAssetIds.forEach((assetId) => {
    const asset = getAssetFromCatalog(assetCatalog, assetId)
    if (!shouldExcludeAssetFromRuntimeExport(asset, { assetId, retainedConfigAssetIds })) {
      exportAssetIds.add(assetId)
    }
  })

  ;(runtimeAwareScene.resourceSummary?.assets ?? []).forEach((entry) => {
    const summaryAssetId = typeof entry?.assetId === 'string' ? entry.assetId.trim() : ''
    const canonicalSummaryAssetId = normalizeExportAssetId(summaryAssetId)
    if (canonicalSummaryAssetId) {
      summaryEntries.set(canonicalSummaryAssetId, entry)
    }
  })

  const assetRegistry: Record<string, SceneAssetRegistryEntry> = {}
  exportAssetIds.forEach((assetId) => {
    const asset = getAssetFromCatalog(assetCatalog, assetId)
    const sourceMeta =
      asset?.source
      ?? inferPackageSourceFromAssetId(assetId)
      ?? inferPackageSourceFromSceneProvider(assetId, runtimeAwareScene.resourceProviderId)
    const entry = buildSceneAssetRegistryEntry(
      assetId,
      sourceMeta,
      asset,
      summaryEntries.get(assetId),
      existingRegistry[assetId],
    )
    if (entry) {
      assetRegistry[assetId] = entry
    }
  })

  return assetRegistry
}

function normalizeHttpUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed.length) {
    return null
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed
  }
  return null
}

function resolveAssetDownloadUrl(
  asset: ProjectAsset | null,
): string | null {
  if (!asset) {
    return null
  }
  const candidate = normalizeHttpUrl(asset.downloadUrl) ?? normalizeHttpUrl(asset.description)
  return resolveServerAssetDownloadUrl({
    assetBaseUrl: readServerDownloadBaseUrl(),
    fileKey: asset.fileKey,
    downloadUrl: candidate,
  }) ?? candidate
}

export async function calculateSceneResourceSummary(
  scene: StoredSceneDocument,
  options: SceneBundleExportOptions,
): Promise<SceneResourceSummary> {
  const runtimeAwareScene = cloneSceneDocumentWithRuntimeGroundSidecars(scene)
  const existingRegistry = runtimeAwareScene.assetRegistry ?? {}
  const normalizeExportAssetId = (assetId: string): string | null => normalizeAssetIdForExportLookup(assetId, existingRegistry)
  const retainedConfigAssetIds = new Set(
    normalizeAssetIdsWithRegistry(collectRuntimeRequiredConfigAssetIds(runtimeAwareScene), existingRegistry),
  )
  const transitiveConfigDependencyIds = await collectTransitiveConfigDependencyAssetIds(
    normalizeAssetIdsWithRegistry(collectDirectSceneAssetReferenceIds(runtimeAwareScene), existingRegistry),
    runtimeAwareScene.assetCatalog ?? {},
    {
      loadPrefab: async (assetId) => {
        const canonicalAssetId = normalizeExportAssetId(assetId) ?? assetId
        return prefabActions.loadNodePrefab({
          getAsset: (queryAssetId: string) => {
            const canonicalQueryAssetId = normalizeExportAssetId(queryAssetId) ?? queryAssetId
            return getAssetFromCatalog(runtimeAwareScene.assetCatalog ?? {}, canonicalQueryAssetId)
          },
        } as unknown as PrefabStoreLike, canonicalAssetId)
      },
      loadConfigAssetText: (assetId) => loadConfigAssetTextForDependencyTraversal(
        assetId,
        runtimeAwareScene.assetCatalog ?? {},
        existingRegistry,
      ),
      normalizeAssetId: normalizeExportAssetId,
    },
  )
  const assetCatalog = runtimeAwareScene.assetCatalog ?? {}
  const assetRegistry = await buildAssetRegistryForExport(runtimeAwareScene)

  const summary: SceneResourceSummary = {
    totalBytes: 0,
    embeddedBytes: 0,
    externalBytes: 0,
    computedAt: new Date().toISOString(),
    assets: [],
    excludedAssetIds: [],
    unknownAssetIds: [],
  }

  type MeshTextureUsageAccumulator = {
    nodeId: string
    nodeName?: string
    assetIds: Set<string>
    textures: SceneResourceSummaryEntry[]
    totalBytes: number
  }

  const meshTextureUsageMap = new Map<string, MeshTextureUsageAccumulator>()
  const textureAssetConsumers = new Map<string, Set<string>>()
  const nodeNameById = new Map<string, string | undefined>()
  const countedTextureAssets = new Set<string>()
  let textureBytes = 0

  const assetIds = new Set<string>()
  transitiveConfigDependencyIds.forEach((assetId) => {
    const asset = getAssetFromCatalog(assetCatalog, assetId)
    if (!shouldExcludeAssetFromRuntimeExport(asset, { assetId, retainedConfigAssetIds })) {
      assetIds.add(assetId)
      return
    }
    summary.excludedAssetIds?.push(assetId)
  })

  const registerTextureUsage = (node: SceneNode, assetId: string | null | undefined): void => {
    const normalizedId = typeof assetId === 'string' ? assetId.trim() : ''
    if (!normalizedId) {
      return
    }
    assetIds.add(normalizedId)
    const consumers = textureAssetConsumers.get(normalizedId) ?? new Set<string>()
    consumers.add(node.id)
    textureAssetConsumers.set(normalizedId, consumers)

    let usage = meshTextureUsageMap.get(node.id)
    if (!usage) {
      usage = {
        nodeId: node.id,
        nodeName: node.name ?? undefined,
        assetIds: new Set<string>(),
        textures: [],
        totalBytes: 0,
      }
      meshTextureUsageMap.set(node.id, usage)
    }
    usage.assetIds.add(normalizedId)
  }

  const registerScatterAssetId = (assetId: string | null | undefined): void => {
    const normalizedId = typeof assetId === 'string' ? assetId.trim() : ''
    if (!normalizedId) {
      return
    }
    assetIds.add(normalizedId)
  }

  const collectScatterAssetRefs = (node: SceneNode): void => {
    if (node.dynamicMesh?.type !== 'Ground') {
      return
    }
    const definition = node.dynamicMesh as GroundDynamicMesh & {
      terrainScatter?: TerrainScatterStoreSnapshot | null
    }
    const snapshot = definition.terrainScatter
    if (!snapshot || !Array.isArray(snapshot.layers) || !snapshot.layers.length) {
      return
    }
    snapshot.layers.forEach((layer: any) => {
      registerScatterAssetId(layer?.assetId)
      registerScatterAssetId(layer?.profileId)
      if (Array.isArray(layer?.instances)) {
        layer.instances.forEach((instance: any) => {
          registerScatterAssetId(instance?.assetId)
          registerScatterAssetId(instance?.profileId)
        })
      }
    })
  }

  const collectMaterialTextureRefs = (
    material: SceneMaterial | SceneNodeMaterial | null | undefined,
    node: SceneNode,
  ): void => {
    if (!material || typeof material !== 'object') {
      return
    }
    const textures = material.textures as SceneMaterial['textures'] | undefined
    if (!textures) {
      return
    }
    MATERIAL_TEXTURE_SLOTS.forEach((slot) => {
      const ref = textures[slot]
      const assetId = typeof ref === 'object' && ref ? (ref.assetId ?? '').trim() : ''
      if (assetId) {
        registerTextureUsage(node, assetId)
      }
    })
  }

  const recordTextureAssetEntry = (assetId: string, entry: SceneResourceSummaryEntry): void => {
    const consumers = textureAssetConsumers.get(assetId)
    if (!consumers || consumers.size === 0) {
      return
    }
    if (!countedTextureAssets.has(assetId)) {
      countedTextureAssets.add(assetId)
      textureBytes += entry.bytes
    }
    consumers.forEach((nodeId) => {
      const usage = meshTextureUsageMap.get(nodeId)
      if (!usage) {
        return
      }
      const alreadyTracked = usage.textures.some((existing) => existing.assetId === assetId)
      if (!alreadyTracked) {
        usage.textures.push({ ...entry })
        usage.totalBytes += entry.bytes
      }
    })
  }

  const traverseNodesForTextures = (nodes: SceneNode[] | null | undefined): void => {
    if (!Array.isArray(nodes) || !nodes.length) {
      return
    }
    const stack: SceneNode[] = [...nodes]
    while (stack.length) {
      const node = stack.pop()
      if (!node) {
        continue
      }
      if (isPlanningImageConversionNode(node)) {
        continue
      }
      nodeNameById.set(node.id, node.name ?? undefined)
      if (Array.isArray(node.materials) && node.materials.length) {
        node.materials.forEach((nodeMaterial) => {
          collectMaterialTextureRefs(nodeMaterial, node)
        })
      }
      collectScatterAssetRefs(node)
      if (Array.isArray(node.children) && node.children.length) {
        stack.push(...(node.children as SceneNode[]))
      }
    }
  }

  traverseNodesForTextures(runtimeAwareScene.nodes ?? [])

  const processed = new Set<string>()
  const assetCache = useAssetCacheStore()

  Object.entries(assetRegistry).forEach(([assetId, registryEntry]) => {
    if (
      processed.has(assetId)
      || registryEntry.sourceType !== 'package'
      || !registryEntry.zipPath.startsWith(LOCAL_EMBEDDED_ASSET_PREFIX)
    ) {
      return
    }
    const asset = getAssetFromCatalog(assetCatalog, assetId)
    const cacheEntry = assetCache.getEntry(assetId)
    const bytes = typeof registryEntry.bytes === 'number'
      ? registryEntry.bytes
      : cacheEntry?.status === 'cached' && cacheEntry.size > 0
        ? cacheEntry.size
        : 0
    const entry: SceneResourceSummaryEntry = {
      assetId,
      name: asset?.name ?? registryEntry.name ?? undefined,
      bytes,
      type: asset?.type ?? registryEntry.assetType ?? undefined,
      embedded: true,
      source: 'embedded',
    }
    summary.assets.push(entry)
    recordTextureAssetEntry(assetId, entry)
    summary.totalBytes += bytes
    summary.embeddedBytes += bytes
    processed.add(assetId)
  })

  Object.keys(assetRegistry).forEach((assetId) => {
    if (assetId) {
      const asset = getAssetFromCatalog(assetCatalog, assetId)
      if (shouldExcludeAssetFromRuntimeExport(asset, { assetId, retainedConfigAssetIds })) {
        if (!summary.excludedAssetIds?.includes(assetId)) {
          summary.excludedAssetIds?.push(assetId)
        }
        return
      }
      assetIds.add(assetId)
    }
  })

  for (const assetId of assetIds) {
    if (!assetId || processed.has(assetId)) {
      continue
    }
    const cacheEntry = assetCache.getEntry(assetId)
    const asset = getAssetFromCatalog(assetCatalog, assetId)
    const registryEntry = assetRegistry[assetId]
    let bytes = typeof registryEntry?.bytes === 'number'
      ? registryEntry.bytes
      : cacheEntry?.status === 'cached' && cacheEntry.size > 0
        ? cacheEntry.size
        : 0

    if (!bytes && options.embedResources) {
      // If resources are embedded, fall back to cached blob size if available.
      bytes = cacheEntry?.blob?.size ?? bytes
    }

    if (registryEntry?.sourceType === 'package') {
      const entry: SceneResourceSummaryEntry = {
        assetId,
        name: asset?.name ?? registryEntry.name ?? undefined,
        type: asset?.type ?? registryEntry.assetType ?? undefined,
        bytes,
        embedded: true,
        source: 'embedded',
      }
      summary.assets.push(entry)
      recordTextureAssetEntry(assetId, entry)
      summary.totalBytes += bytes
      summary.embeddedBytes += bytes
      processed.add(assetId)
      continue
    }

    const downloadUrl = registryEntry?.sourceType === 'url'
      ? normalizeHttpUrl(registryEntry.url)
      : registryEntry?.sourceType === 'server'
        ? registryEntry.resolvedUrl ?? resolveAssetDownloadUrl(asset)
        : resolveAssetDownloadUrl(asset)

    if (bytes > 0 || downloadUrl) {
      const entry: SceneResourceSummaryEntry = {
        assetId,
        name: asset?.name ?? registryEntry?.name ?? undefined,
        type: asset?.type ?? registryEntry?.assetType ?? undefined,
        bytes,
        embedded: false,
        source: 'remote',
        downloadUrl: downloadUrl ?? null,
      }
      summary.assets.push(entry)
      recordTextureAssetEntry(assetId, entry)
      if (bytes > 0) {
        summary.totalBytes += bytes
        summary.externalBytes += bytes
      }
      processed.add(assetId)
    } else {
      summary.unknownAssetIds?.push(assetId)
    }
  }

  if (!summary.unknownAssetIds?.length) {
    delete summary.unknownAssetIds
  }
  if (!summary.excludedAssetIds?.length) {
    delete summary.excludedAssetIds
  }

  if (!summary.totalBytes) {
    summary.embeddedBytes = 0
    summary.externalBytes = 0
  }

  if (textureBytes > 0) {
    summary.textureBytes = textureBytes
  }

  if (meshTextureUsageMap.size > 0) {
    const meshTextureUsage = Array.from(meshTextureUsageMap.values()).map((usage) => {
      const textures = usage.textures.map((entry) => ({ ...entry }))
      const assetIdSet = usage.assetIds
      assetIdSet.forEach((assetId) => {
        const exists = textures.some((entry) => entry.assetId === assetId)
        if (!exists) {
          textures.push({ assetId, bytes: 0 })
        }
      })
      return {
        nodeId: usage.nodeId,
        nodeName: usage.nodeName,
        totalBytes: usage.totalBytes,
        textureAssetIds: Array.from(assetIdSet),
        textures,
      }
    }).filter((usage) => usage.textureAssetIds.length > 0)
    if (meshTextureUsage.length > 0) {
      summary.meshTextureUsage = meshTextureUsage
    }
  }

  return summary
}

export async function cloneSceneDocumentForExport(
  scene: StoredSceneDocument,
): Promise<StoredSceneDocument> {
  const assetRegistry = await buildAssetRegistryForExport(scene)
  const runtimeAwareScene = cloneSceneDocumentWithRuntimeGroundSidecars(scene)
  return createSceneDocument(scene.name, {
    id: scene.id,
    nodes: runtimeAwareScene.nodes,
    camera: scene.camera,
    resourceProviderId: scene.resourceProviderId,
    createdAt: scene.createdAt,
    updatedAt: scene.updatedAt,
    assetCatalog: scene.assetCatalog,
    assetRegistry,
    projectOverrideAssets: scene.projectOverrideAssets,
    sceneOverrideAssets: scene.sceneOverrideAssets,
    resourceSummary: scene.resourceSummary,
    planningData: scene.planningData,
    viewportSettings: scene.viewportSettings,
    shadowsEnabled: scene.shadowsEnabled,
    panelVisibility: scene.panelVisibility,
    panelPlacement: scene.panelPlacement,
    groundSettings: scene.groundSettings,
    environment: resolveSceneDocumentEnvironment(scene),
  })
}

type EmbeddedAssetHydrationResult = {
  migratedEmbeddedAssets: boolean
  migratedAssetCount: number
  skippedAssetCount: number
  reclaimedBytes: number
}

async function hydrateSceneDocumentWithEmbeddedAssets(scene: StoredSceneDocument): Promise<EmbeddedAssetHydrationResult> {
  const result: EmbeddedAssetHydrationResult = {
    migratedEmbeddedAssets: false,
    migratedAssetCount: 0,
    skippedAssetCount: 0,
    reclaimedBytes: 0,
  }
  void scene
  return result
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseVector3Like(value: unknown): THREE.Vector3 | null {
  if (!isPlainObject(value)) {
    return null
  }
  const { x, y, z } = value
  const nx = typeof x === 'number' ? x : Number(x)
  const ny = typeof y === 'number' ? y : Number(y)
  const nz = typeof z === 'number' ? z : Number(z)
  if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) {
    return null
  }
  return createVector(nx, ny, nz)
}

function normalizeCameraStateInput(value: unknown): SceneCameraState | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }
  const position = parseVector3Like(value.position)
  const target = parseVector3Like(value.target)
  const fovValue = typeof value.fov === 'number' ? value.fov : Number(value.fov)
  if (!position || !target || !Number.isFinite(fovValue)) {
    return undefined
  }
  const forward = parseVector3Like(value.forward)
  return {
    position,
    target,
    fov: fovValue,
    forward: forward ?? undefined,
  }
}

function normalizeViewportSettingsInput(value: unknown): Partial<SceneViewportSettings> | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }
  const input = value as unknown as SceneViewportSettings
  const normalized: Partial<SceneViewportSettings> = {}
  if (typeof input.showGrid === 'boolean') {
    normalized.showGrid = input.showGrid
  }
  if (typeof input.showAxes === 'boolean') {
    normalized.showAxes = input.showAxes
  }
  if (isCameraProjectionMode(input.cameraProjection)) {
    normalized.cameraProjection = input.cameraProjection
  }
  if (isCameraControlMode(input.cameraControlMode)) {
    normalized.cameraControlMode = input.cameraControlMode
  }
  if (isViewportSnapMode((input as any).snapMode)) {
    normalized.snapMode = (input as any).snapMode
  }
  if (typeof (input as any).snapThresholdPx === 'number' || typeof (input as any).snapThresholdPx === 'string') {
    normalized.snapThresholdPx = normalizeSnapThresholdPx((input as any).snapThresholdPx)
  }
  return normalized
}

function normalizePanelVisibilityInput(value: unknown): Partial<PanelVisibilityState> | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }
  const input = value as Partial<Record<keyof PanelVisibilityState, unknown>>
  const normalized: Partial<PanelVisibilityState> = {}
  if (typeof input.hierarchy === 'boolean') {
    normalized.hierarchy = input.hierarchy
  }
  if (typeof input.inspector === 'boolean') {
    normalized.inspector = input.inspector
  }
  if (typeof input.project === 'boolean') {
    normalized.project = input.project
  }
  return normalized
}

function normalizePanelPlacementInput(value: unknown): Partial<PanelPlacementState> | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }
  const input = value as Partial<Record<keyof PanelPlacementState, unknown>>
  const normalized: Partial<PanelPlacementState> = {}
  const coerce = (candidate: unknown): PanelPlacement | undefined =>
    candidate === 'floating' ? 'floating' : candidate === 'docked' ? 'docked' : undefined

  const hierarchy = coerce(input.hierarchy)
  if (hierarchy) {
    normalized.hierarchy = hierarchy
  }
  const inspector = coerce(input.inspector)
  if (inspector) {
    normalized.inspector = inspector
  }
  const project = coerce(input.project)
  if (project) {
    normalized.project = project
  }

  return normalized
}

function isAssetCatalog(value: unknown): value is Record<string, ProjectAsset[]> {
  if (!isPlainObject(value)) {
    return false
  }
  return Object.values(value).every((entry) => Array.isArray(entry))
}

function resolveUniqueSceneName(baseName: string, existing: Set<string>): string {
  const normalized = baseName.trim() || 'Imported Scene'
  if (!existing.has(normalized)) {
    return normalized
  }
  let counter = 2
  let candidate = `${normalized} (${counter})`
  while (existing.has(candidate)) {
    counter += 1
    candidate = `${normalized} (${counter})`
  }
  return candidate
}

function vectorsEqual(a: Vector3Like, b: Vector3Like): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z
}

function cloneAssetCatalog(catalog: Record<string, ProjectAsset[]>): Record<string, ProjectAsset[]> {
  const clone: Record<string, ProjectAsset[]> = {}
  Object.entries(catalog).forEach(([categoryId, list]) => {
    clone[categoryId] = cloneAssetList(list ?? [])
  })
  return clone
}

const SCENE_ASSET_MANIFEST_ROOT_DIRECTORY_ID = 'scene-assets-root'
const SCENE_ASSET_PACKAGE_PROVIDER_DIRECTORY_PREFIX = 'scene-assets-package-provider-'

function normalizePackageProviderDirectoryKey(value: string | null | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed.length) {
    return 'provider'
  }
  const normalized = trimmed.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '')
  return normalized.length ? normalized.toLowerCase() : 'provider'
}

export function buildLocalPackageProviderManifestDirectoryId(providerId: string): string {
  return `${SCENE_ASSET_PACKAGE_PROVIDER_DIRECTORY_PREFIX}${normalizePackageProviderDirectoryKey(providerId)}`
}

const sceneAssetCategoryLabelLookup = ASSET_CATEGORY_CONFIG.reduce<Record<string, string>>((acc, category) => {
  acc[category.id] = category.label
  return acc
}, {})

function inferAssetManifestResourceKind(url: string): 'inline' | 'local' | 'remote' | 'manifest' {
  const normalized = url.trim().toLowerCase()
  if (!normalized.length) {
    return 'manifest'
  }
  if (normalized.startsWith('data:')) {
    return 'inline'
  }
  if (normalized.startsWith('blob:') || normalized.startsWith('indexeddb:')) {
    return 'local'
  }
  if (normalized.startsWith('http://') || normalized.startsWith('https://') || normalized.startsWith('/')) {
    return 'remote'
  }
  return 'manifest'
}

function mapProjectAssetToManifestAsset(
  asset: ProjectAsset,
  categoryId: string,
  categoryName: string,
  generatedAt: string,
): AssetManifestAsset {
  const downloadUrl = typeof asset.downloadUrl === 'string' ? asset.downloadUrl : ''
  const fileKey = typeof asset.fileKey === 'string' && asset.fileKey.trim().length ? asset.fileKey.trim() : null
  const thumbnailUrl = typeof asset.thumbnail === 'string' && asset.thumbnail.trim().length ? asset.thumbnail : null
  const tagNames = Array.isArray(asset.tags) ? asset.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0) : []
  const tagIds = Array.isArray(asset.tagIds) ? asset.tagIds.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0) : []

  return {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    categoryId: asset.categoryId ?? categoryId,
    categoryPath: asset.categoryPath ?? [{ id: categoryId, name: categoryName }],
    categoryPathString: asset.categoryPathString ?? categoryName,
    tags: tagNames.map((name, index) => ({
      id: tagIds[index] ?? `${asset.id}:tag:${index}`,
      name,
    })),
    tagIds,
    seriesId: asset.seriesId ?? null,
    seriesName: asset.seriesName ?? null,
    color: asset.color ?? null,
    dimensionLength: asset.dimensionLength ?? null,
    dimensionWidth: asset.dimensionWidth ?? null,
    dimensionHeight: asset.dimensionHeight ?? null,
    sizeCategory: asset.sizeCategory ?? null,
    imageWidth: asset.imageWidth ?? null,
    imageHeight: asset.imageHeight ?? null,
    downloadUrl,
    fileKey,
    thumbnailUrl,
    resource: {
      kind: inferAssetManifestResourceKind(downloadUrl),
      url: downloadUrl || null,
      fileKey,
      exportable: true,
    },
    thumbnail: thumbnailUrl
      ? {
          kind: inferAssetManifestResourceKind(thumbnailUrl),
          url: thumbnailUrl,
          exportable: false,
        }
      : null,
    metadata: asset.metadata && typeof asset.metadata === 'object' ? { ...asset.metadata } : undefined,
    description: asset.description ?? null,
    createdAt: asset.createdAt ?? generatedAt,
    updatedAt: asset.updatedAt ?? generatedAt,
    size: 0,
    terrainScatterPreset: asset.terrainScatterPreset ?? null,
  }
}

function buildSceneAssetManifest(assetCatalog: Record<string, ProjectAsset[]>): AssetManifest {
  const generatedAt = new Date().toISOString()
  const directoriesById: Record<string, AssetManifestDirectory> = {
    [SCENE_ASSET_MANIFEST_ROOT_DIRECTORY_ID]: {
      id: SCENE_ASSET_MANIFEST_ROOT_DIRECTORY_ID,
      name: 'Scene Assets',
      parentId: null,
      directoryIds: [],
      assetIds: [],
      createdAt: generatedAt,
      updatedAt: generatedAt,
    },
  }
  const assetsById: Record<string, AssetManifestAsset> = {}

  Object.entries(assetCatalog).forEach(([categoryId, assets]) => {
    if (!Array.isArray(assets) || !assets.length) {
      return
    }
    const categoryName = sceneAssetCategoryLabelLookup[categoryId] ?? categoryId
    directoriesById[categoryId] = {
      id: categoryId,
      name: categoryName,
      parentId: SCENE_ASSET_MANIFEST_ROOT_DIRECTORY_ID,
      directoryIds: [],
      assetIds: assets.map((asset) => asset.id),
      createdAt: generatedAt,
      updatedAt: generatedAt,
    }
    directoriesById[SCENE_ASSET_MANIFEST_ROOT_DIRECTORY_ID]!.directoryIds.push(categoryId)
    assets.forEach((asset) => {
      assetsById[asset.id] = mapProjectAssetToManifestAsset(asset, categoryId, categoryName, generatedAt)
    })
  })

  return {
    format: 'harmony-asset-manifest',
    version: 2,
    generatedAt,
    rootDirectoryId: SCENE_ASSET_MANIFEST_ROOT_DIRECTORY_ID,
    directoriesById,
    assetsById,
  }
}

function buildCatalogAssetMap(catalog: Record<string, ProjectAsset[]>): Map<string, ProjectAsset> {
  const map = new Map<string, ProjectAsset>()
  Object.values(catalog).forEach((assets) => {
    assets.forEach((asset) => {
      map.set(asset.id, asset)
    })
  })
  return map
}

function findManifestDirectoryPath(manifest: AssetManifest, directoryId: string | null | undefined): AssetManifestDirectory[] {
  if (!directoryId) {
    return []
  }
  const chain: AssetManifestDirectory[] = []
  const visited = new Set<string>()
  let currentId: string | null = directoryId
  while (currentId && !visited.has(currentId)) {
    const directory: AssetManifestDirectory | undefined = manifest.directoriesById[currentId]
    if (!directory) {
      break
    }
    chain.unshift(directory)
    visited.add(currentId)
    currentId = directory.parentId
  }
  return chain
}

function mapManifestAssetToProjectAsset(
  manifest: AssetManifest,
  manifestAsset: AssetManifestAsset,
  existingAsset: ProjectAsset | null,
  directoryId: string,
): ProjectAsset {
  const pathDirectories = findManifestDirectoryPath(manifest, directoryId)
  const fallbackCategoryPath = pathDirectories
    .filter((directory) => directory.id !== manifest.rootDirectoryId)
    .map((directory) => ({ id: directory.id, name: directory.name }))
  const fallbackCategoryPathString = fallbackCategoryPath.map((item) => item.name).join('/')
  const downloadUrl = manifestAsset.resource?.url ?? manifestAsset.downloadUrl
  const thumbnailUrl = manifestAsset.thumbnail?.url ?? manifestAsset.thumbnailUrl ?? null
  const preservedCategoryPath = Array.isArray(manifestAsset.categoryPath) && manifestAsset.categoryPath.length
    ? manifestAsset.categoryPath
        .filter((item): item is { id: string; name: string } => !!item && typeof item.id === 'string' && typeof item.name === 'string')
    : fallbackCategoryPath
  const preservedCategoryPathString = typeof manifestAsset.categoryPathString === 'string' && manifestAsset.categoryPathString.trim().length
    ? manifestAsset.categoryPathString
    : fallbackCategoryPathString

  return {
    id: manifestAsset.id,
    name: manifestAsset.name,
    extension: existingAsset?.extension ?? extractExtension(downloadUrl) ?? null,
    categoryId: typeof manifestAsset.categoryId === 'string' && manifestAsset.categoryId.trim().length
      ? manifestAsset.categoryId
      : directoryId,
    categoryPath: preservedCategoryPath,
    categoryPathString: preservedCategoryPathString,
    type: manifestAsset.type,
    description: manifestAsset.description ?? undefined,
    downloadUrl,
    fileKey:
      (typeof manifestAsset.resource?.fileKey === 'string' && manifestAsset.resource.fileKey.trim().length
        ? manifestAsset.resource.fileKey.trim()
        : null)
      ?? (typeof manifestAsset.fileKey === 'string' && manifestAsset.fileKey.trim().length
        ? manifestAsset.fileKey.trim()
        : null)
      ?? existingAsset?.fileKey
      ?? null,
    previewColor: existingAsset?.previewColor ?? '#90A4AE',
    thumbnail: thumbnailUrl,
    tags: manifestAsset.tags?.map((tag) => tag.name).filter((name): name is string => typeof name === 'string' && name.length > 0),
    tagIds: [...manifestAsset.tagIds],
    color: manifestAsset.color ?? undefined,
    dimensionLength: manifestAsset.dimensionLength ?? undefined,
    dimensionWidth: manifestAsset.dimensionWidth ?? undefined,
    dimensionHeight: manifestAsset.dimensionHeight ?? undefined,
    sizeCategory: manifestAsset.sizeCategory ?? undefined,
    imageWidth: manifestAsset.imageWidth ?? undefined,
    imageHeight: manifestAsset.imageHeight ?? undefined,
    metadata: manifestAsset.metadata && typeof manifestAsset.metadata === 'object' ? { ...manifestAsset.metadata } : undefined,
    source: existingAsset?.source ? { ...existingAsset.source } : undefined,
    internal: existingAsset?.internal,
    isEditorOnly: existingAsset?.isEditorOnly,
    seriesId: manifestAsset.seriesId ?? undefined,
    seriesName: manifestAsset.seriesName ?? undefined,
    terrainScatterPreset: manifestAsset.terrainScatterPreset ?? undefined,
    createdAt: manifestAsset.createdAt,
    updatedAt: manifestAsset.updatedAt,
    gleaned: existingAsset?.gleaned ?? true,
  }
}

function buildAssetCatalogFromManifest(
  manifest: AssetManifest,
  existingCatalog: Record<string, ProjectAsset[]>,
): Record<string, ProjectAsset[]> {
  const existingAssetMap = buildCatalogAssetMap(existingCatalog)
  const catalog: Record<string, ProjectAsset[]> = {}

  Object.values(manifest.directoriesById).forEach((directory) => {
    catalog[directory.id] = directory.assetIds
      .map((assetId) => manifest.assetsById[assetId])
      .filter((asset): asset is AssetManifestAsset => !!asset)
      .map((asset) => mapManifestAssetToProjectAsset(manifest, asset, existingAssetMap.get(asset.id) ?? null, directory.id))
  })

  return catalog
}

function mergeAssetCatalogsById(
  primaryCatalog: Record<string, ProjectAsset[]>,
  secondaryCatalog: Record<string, ProjectAsset[]>,
): Record<string, ProjectAsset[]> {
  const mergedCatalog = cloneAssetCatalog(primaryCatalog)
  const seenAssetIds = new Set<string>(buildCatalogAssetMap(primaryCatalog).keys())

  Object.entries(secondaryCatalog).forEach(([categoryId, assets]) => {
    assets.forEach((asset) => {
      if (!asset?.id || seenAssetIds.has(asset.id)) {
        return
      }
      const resolvedCategoryId = typeof asset.categoryId === 'string' && asset.categoryId.length
        ? asset.categoryId
        : categoryId
      if (!mergedCatalog[resolvedCategoryId]) {
        mergedCatalog[resolvedCategoryId] = []
      }
      mergedCatalog[resolvedCategoryId]!.push({ ...asset })
      seenAssetIds.add(asset.id)
    })
  })

  return mergedCatalog
}

function buildLocalAssetTreeFromManifest(
  manifest: AssetManifest,
  catalog: Record<string, ProjectAsset[]>,
  directoryId: string,
  activeDirectoryIds: Set<string> = new Set(),
  warnedDirectoryIds: Set<string> = new Set(),
): ProjectDirectory | null {
  if (activeDirectoryIds.has(directoryId)) {
    if (!warnedDirectoryIds.has(directoryId)) {
      warnedDirectoryIds.add(directoryId)
      console.warn('[SceneStore] Skipped cyclic asset directory while building project tree', directoryId)
    }
    return null
  }

  const directory = manifest.directoriesById[directoryId]
  if (!directory) {
    return null
  }

  activeDirectoryIds.add(directoryId)
  const childDirectories = directory.directoryIds
    .map((childId) => buildLocalAssetTreeFromManifest(manifest, catalog, childId, activeDirectoryIds, warnedDirectoryIds))
    .filter((entry): entry is ProjectDirectory => !!entry)
  activeDirectoryIds.delete(directoryId)

  const projectDirectoryId = directory.id === manifest.rootDirectoryId ? ASSETS_ROOT_DIRECTORY_ID : directory.id

  return {
    id: projectDirectoryId,
    name: directory.id === manifest.rootDirectoryId ? 'Assets' : directory.name,
    children: childDirectories.length ? childDirectories : undefined,
    assets: (catalog[directory.id] ?? []).map((asset) => ({ ...asset })),
  }
}

function buildSceneProjectTree(
  assetManifest: AssetManifest | null,
  assetCatalog: Record<string, ProjectAsset[]>,
  packageDirectoryCache: Record<string, ProjectDirectory[]>,
): ProjectDirectory[] {
  const visibleAssetCatalog = buildVisibleAssetCatalog(assetCatalog)
  const fallbackTree = createProjectTreeFromCache(visibleAssetCatalog, packageDirectoryCache)
  const packagesBranch = fallbackTree.find((directory) => directory.id === PACKAGES_ROOT_DIRECTORY_ID) ?? fallbackTree[1]
  if (!assetManifest) {
    return packagesBranch ? [fallbackTree[0]!, packagesBranch] : fallbackTree
  }
  const localBranch = buildLocalAssetTreeFromManifest(assetManifest, visibleAssetCatalog, assetManifest.rootDirectoryId)
  if (!localBranch) {
    return packagesBranch ? [fallbackTree[0]!, packagesBranch] : fallbackTree
  }
  return packagesBranch ? [localBranch, packagesBranch] : [localBranch]
}

function cleanupManifestDirectoryReferences(manifest: AssetManifest): AssetManifest {
  const directoriesById: Record<string, AssetManifestDirectory> = Object.fromEntries(
    Object.entries(manifest.directoriesById).map(([directoryId, directory]) => [
      directoryId,
      {
        ...directory,
        directoryIds: directory.directoryIds.filter((childId, index, array) => childId in manifest.directoriesById && array.indexOf(childId) === index),
        assetIds: directory.assetIds.filter((assetId, index, array) => assetId in manifest.assetsById && array.indexOf(assetId) === index),
      },
    ]),
  )
  return {
    ...manifest,
    directoriesById,
  }
}

function sanitizeManifestDirectoryGraph(manifest: AssetManifest): {
  manifest: AssetManifest
  changed: boolean
  warnings: string[]
} {
  const rootDirectory = manifest.directoriesById[manifest.rootDirectoryId]
  if (!rootDirectory) {
    return {
      manifest,
      changed: true,
      warnings: [`Missing root directory \"${manifest.rootDirectoryId}\".`],
    }
  }

  const sourceDirectoriesById: Record<string, AssetManifestDirectory> = Object.fromEntries(
    Object.entries(manifest.directoriesById).map(([directoryId, directory]) => [
      directoryId,
      {
        ...directory,
        id: directoryId,
        parentId: directoryId === manifest.rootDirectoryId
          ? null
          : (typeof directory.parentId === 'string' && directory.parentId in manifest.directoriesById ? directory.parentId : null),
        directoryIds: [...directory.directoryIds],
        assetIds: [...directory.assetIds],
      },
    ]),
  )
  const sanitizedDirectoriesById: Record<string, AssetManifestDirectory> = {}
  const assignedParentByDirectoryId = new Map<string, string | null>()
  const visitedDirectoryIds = new Set<string>()
  const activeDirectoryIds = new Set<string>()
  const warnings: string[] = []
  let changed = false

  const pushWarning = (message: string) => {
    if (!warnings.includes(message)) {
      warnings.push(message)
    }
    changed = true
  }

  const ensureSanitizedDirectory = (directoryId: string, parentId: string | null): AssetManifestDirectory => {
    const existing = sanitizedDirectoriesById[directoryId]
    if (existing) {
      if (existing.parentId !== parentId) {
        existing.parentId = parentId
        changed = true
      }
      return existing
    }

    const source = sourceDirectoriesById[directoryId]!
    const createdAt = typeof source.createdAt === 'string' && source.createdAt.length ? source.createdAt : manifest.generatedAt
    const updatedAt = typeof source.updatedAt === 'string' && source.updatedAt.length ? source.updatedAt : createdAt
    const nextDirectory: AssetManifestDirectory = {
      ...source,
      id: directoryId,
      parentId,
      directoryIds: [],
      assetIds: [...source.assetIds],
      createdAt,
      updatedAt,
    }
    sanitizedDirectoriesById[directoryId] = nextDirectory
    return nextDirectory
  }

  const attachDirectory = (directoryId: string, parentId: string | null): boolean => {
    if (!(directoryId in sourceDirectoriesById)) {
      pushWarning(`Dropped missing asset directory \"${directoryId}\".`)
      return false
    }
    if (directoryId === manifest.rootDirectoryId && parentId !== null) {
      pushWarning('Moved asset manifest root back to the top level.')
      parentId = null
    }
    if (activeDirectoryIds.has(directoryId)) {
      pushWarning(`Removed cyclic asset directory reference at \"${directoryId}\".`)
      return false
    }

    const existingParentId = assignedParentByDirectoryId.get(directoryId)
    if (assignedParentByDirectoryId.has(directoryId) && existingParentId !== parentId) {
      pushWarning(`Dropped duplicate asset directory parent for \"${directoryId}\".`)
      return false
    }
    assignedParentByDirectoryId.set(directoryId, parentId)

    const target = ensureSanitizedDirectory(directoryId, parentId)
    if (visitedDirectoryIds.has(directoryId)) {
      return true
    }

    const source = sourceDirectoriesById[directoryId]!
    if (source.parentId !== parentId) {
      changed = true
    }

    visitedDirectoryIds.add(directoryId)
    activeDirectoryIds.add(directoryId)

    source.directoryIds.forEach((childId) => {
      if (childId === directoryId) {
        pushWarning(`Removed self-referencing asset directory \"${directoryId}\".`)
        return
      }
      if (!(childId in sourceDirectoriesById)) {
        pushWarning(`Dropped missing child asset directory \"${childId}\" from \"${directoryId}\".`)
        return
      }
      if (activeDirectoryIds.has(childId)) {
        pushWarning(`Removed cyclic asset directory edge \"${directoryId}\" -> \"${childId}\".`)
        return
      }
      if (attachDirectory(childId, directoryId)) {
        target.directoryIds.push(childId)
      }
    })

    activeDirectoryIds.delete(directoryId)
    return true
  }

  attachDirectory(manifest.rootDirectoryId, null)

  Object.keys(sourceDirectoriesById).forEach((directoryId) => {
    if (visitedDirectoryIds.has(directoryId)) {
      return
    }
    const source = sourceDirectoriesById[directoryId]!
    const preferredParentId = source.parentId && source.parentId in sanitizedDirectoriesById && source.parentId !== directoryId
      ? source.parentId
      : manifest.rootDirectoryId
    if (attachDirectory(directoryId, preferredParentId)) {
      const parent = sanitizedDirectoriesById[preferredParentId]
      if (parent && !parent.directoryIds.includes(directoryId)) {
        parent.directoryIds.push(directoryId)
      }
      pushWarning(`Reattached orphan asset directory \"${directoryId}\" under the manifest root.`)
    }
  })

  return {
    manifest: {
      ...manifest,
      directoriesById: sanitizedDirectoriesById,
    },
    changed,
    warnings,
  }
}

function normalizeSceneAssetManifest(
  manifest: AssetManifest | null | undefined,
  assetCatalog: Record<string, ProjectAsset[]>,
  context: string,
): AssetManifest {
  const fallbackManifest = buildSceneAssetManifest(assetCatalog)
  const clonedManifest = cloneAssetManifest(manifest)
  if (!clonedManifest) {
    return fallbackManifest
  }
  if (!(clonedManifest.rootDirectoryId in clonedManifest.directoriesById)) {
    console.warn(`[SceneStore] Rebuilt asset manifest while ${context}: missing root directory`, clonedManifest.rootDirectoryId)
    return fallbackManifest
  }

  const cleanedManifest = cleanupManifestDirectoryReferences(clonedManifest)
  const { manifest: sanitizedManifest, changed, warnings } = sanitizeManifestDirectoryGraph(cleanedManifest)
  const manifestBackedCatalog = buildAssetCatalogFromManifest(sanitizedManifest, assetCatalog)
  const synchronizedManifest = synchronizeManifestWithCatalog(
    sanitizedManifest,
    mergeAssetCatalogsById(manifestBackedCatalog, assetCatalog),
  )

  if (!(synchronizedManifest.rootDirectoryId in synchronizedManifest.directoriesById)) {
    console.warn(`[SceneStore] Rebuilt asset manifest while ${context}: sanitized manifest lost its root directory`)
    return fallbackManifest
  }

  if (changed || warnings.length) {
    console.warn(`[SceneStore] Sanitized invalid asset manifest while ${context}`, warnings)
  }

  return synchronizedManifest
}

function synchronizeManifestWithCatalog(
  manifest: AssetManifest | null,
  nextCatalog: Record<string, ProjectAsset[]>,
  options: { preferredDirectoryId?: string | null } = {},
): AssetManifest {
  const baseManifest = cloneAssetManifest(manifest) ?? buildSceneAssetManifest(nextCatalog)
  const nextManifest = cleanupManifestDirectoryReferences(baseManifest)
  const nextCatalogMap = buildCatalogAssetMap(nextCatalog)
  const knownAssetIds = new Set<string>(Object.keys(nextManifest.assetsById))

  Object.values(nextManifest.directoriesById).forEach((directory) => {
    directory.assetIds = directory.assetIds.filter((assetId) => nextCatalogMap.has(assetId))
  })

  knownAssetIds.forEach((assetId) => {
    if (!nextCatalogMap.has(assetId)) {
      delete nextManifest.assetsById[assetId]
    }
  })

  nextCatalogMap.forEach((asset, assetId) => {
    const preferredDirectoryId = options.preferredDirectoryId && options.preferredDirectoryId in nextManifest.directoriesById
      ? options.preferredDirectoryId
      : (typeof asset.categoryId === 'string' && asset.categoryId in nextManifest.directoriesById ? asset.categoryId : nextManifest.rootDirectoryId)
    const existing = nextManifest.assetsById[assetId] ?? null

    if (!existing) {
      nextManifest.assetsById[assetId] = mapProjectAssetToManifestAsset(asset, preferredDirectoryId, nextManifest.directoriesById[preferredDirectoryId]?.name ?? preferredDirectoryId, nextManifest.generatedAt)
      const directory = nextManifest.directoriesById[preferredDirectoryId]
      if (directory && !directory.assetIds.includes(assetId)) {
        directory.assetIds.push(assetId)
      }
    } else {
      nextManifest.assetsById[assetId] = {
        ...existing,
        ...mapProjectAssetToManifestAsset(asset, existing.categoryId ?? preferredDirectoryId, nextManifest.directoriesById[existing.categoryId ?? preferredDirectoryId]?.name ?? asset.name, existing.updatedAt ?? nextManifest.generatedAt),
      }
    }

  })
  return cleanupManifestDirectoryReferences(nextManifest)
}

function resolveManifestDirectoryIdFromProjectDirectoryId(
  manifest: AssetManifest | null,
  projectDirectoryId: string | null | undefined,
): string | null {
  if (!manifest || !projectDirectoryId) {
    return null
  }
  if (projectDirectoryId === ASSETS_ROOT_DIRECTORY_ID) {
    return manifest.rootDirectoryId
  }
  return projectDirectoryId in manifest.directoriesById ? projectDirectoryId : null
}

function findManifestDirectoryContainingAsset(manifest: AssetManifest, assetId: string): string | null {
  const match = Object.values(manifest.directoriesById).find((directory) => directory.assetIds.includes(assetId))
  return match?.id ?? null
}

function findManifestChildDirectoryByName(
  manifest: AssetManifest,
  parentId: string,
  name: string,
): AssetManifestDirectory | null {
  const parent = manifest.directoriesById[parentId]
  if (!parent) {
    return null
  }
  const normalizedName = name.trim().toLowerCase()
  if (!normalizedName.length) {
    return null
  }
  for (const childId of parent.directoryIds) {
    const child = manifest.directoriesById[childId]
    if (!child) {
      continue
    }
    if (child.name.trim().toLowerCase() === normalizedName) {
      return child
    }
  }
  return null
}

function ensureManifestDirectory(
  manifest: AssetManifest,
  parentId: string,
  name: string,
  preferredId?: string,
): { directoryId: string; created: boolean } {
  const parent = manifest.directoriesById[parentId]
  if (!parent) {
    return { directoryId: manifest.rootDirectoryId, created: false }
  }

  const existingByName = findManifestChildDirectoryByName(manifest, parentId, name)
  if (existingByName) {
    return { directoryId: existingByName.id, created: false }
  }

  const directoryId = preferredId && !(preferredId in manifest.directoriesById) ? preferredId : generateUuid()
  const resolvedName = buildUniqueDirectoryName(manifest, parentId, name)
  const now = new Date().toISOString()
  manifest.directoriesById[directoryId] = {
    id: directoryId,
    name: resolvedName,
    parentId,
    directoryIds: [],
    assetIds: [],
    createdAt: now,
    updatedAt: now,
  }
  parent.directoryIds = [...parent.directoryIds, directoryId]
  parent.updatedAt = now
  return { directoryId, created: true }
}

function ensureLocalPackageProviderManifestDirectory(
  manifest: AssetManifest,
  providerId: string,
): { directoryId: string; created: boolean } {
  const preferredId = buildLocalPackageProviderManifestDirectoryId(providerId)
  if (preferredId in manifest.directoriesById) {
    return { directoryId: preferredId, created: false }
  }
  return ensureManifestDirectory(
    manifest,
    manifest.rootDirectoryId,
    normalizeDirectorySegmentForManifest(providerId),
    preferredId,
  )
}

function normalizeDirectorySegmentForManifest(value: string | null | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed.length) {
    return 'Unnamed'
  }
  const normalized = trimmed.replace(/[\\/]+/g, '-').replace(/\s+/g, ' ').trim()
  return normalized.length ? normalized : 'Unnamed'
}

function isManifestDirectoryDescendant(manifest: AssetManifest, ancestorId: string, candidateId: string): boolean {
  if (ancestorId === candidateId) {
    return true
  }
  const visited = new Set<string>()
  let currentId: string | null = candidateId
  while (currentId && !visited.has(currentId)) {
    if (currentId === ancestorId) {
      return true
    }
    visited.add(currentId)
    currentId = manifest.directoriesById[currentId]?.parentId ?? null
  }
  return false
}

function buildUniqueDirectoryName(manifest: AssetManifest, parentId: string, desiredName: string, selfId?: string): string {
  const trimmed = desiredName.trim() || 'New Folder'
  const parent = manifest.directoriesById[parentId]
  const siblingNames = new Set(
    (parent?.directoryIds ?? [])
      .filter((directoryId) => directoryId !== selfId)
      .map((directoryId) => manifest.directoriesById[directoryId]?.name.trim().toLowerCase())
      .filter((name): name is string => !!name),
  )
  if (!siblingNames.has(trimmed.toLowerCase())) {
    return trimmed
  }
  let suffix = 2
  let candidate = `${trimmed} (${suffix})`
  while (siblingNames.has(candidate.toLowerCase())) {
    suffix += 1
    candidate = `${trimmed} (${suffix})`
  }
  return candidate
}

function cloneAssetManifest(manifest: AssetManifest | null | undefined): AssetManifest | null {
  if (!manifest) {
    return null
  }
  return {
    format: manifest.format,
    version: manifest.version,
    generatedAt: manifest.generatedAt,
    rootDirectoryId: manifest.rootDirectoryId,
    directoriesById: Object.fromEntries(
      Object.entries(manifest.directoriesById).map(([directoryId, directory]) => [
        directoryId,
        {
          ...directory,
          directoryIds: [...directory.directoryIds],
          assetIds: [...directory.assetIds],
        },
      ]),
    ),
    assetsById: Object.fromEntries(
      Object.entries(manifest.assetsById).map(([assetId, asset]) => [
        assetId,
        {
          ...asset,
          categoryPath: asset.categoryPath ? asset.categoryPath.map((item) => ({ ...item })) : undefined,
          tags: asset.tags ? asset.tags.map((item) => ({ ...item })) : [],
          tagIds: [...asset.tagIds],
          resource: asset.resource ? { ...asset.resource } : null,
          thumbnail: asset.thumbnail ? { ...asset.thumbnail } : null,
        },
      ]),
    ),
  }
}

function isStoredAssetManifest(value: unknown): value is AssetManifest {
  if (!value || typeof value !== 'object') {
    return false
  }
  const manifest = value as Partial<AssetManifest>
  return manifest.format === 'harmony-asset-manifest'
    && manifest.version === 2
    && typeof manifest.rootDirectoryId === 'string'
    && !!manifest.directoriesById
    && typeof manifest.directoriesById === 'object'
    && !!manifest.assetsById
    && typeof manifest.assetsById === 'object'
}

function cloneSceneAssetRegistry(
  registry: Record<string, SceneAssetRegistryEntry>,
): Record<string, SceneAssetRegistryEntry> {
  const clone: Record<string, SceneAssetRegistryEntry> = {}
  Object.entries(registry).forEach(([assetId, entry]) => {
    clone[assetId] = { ...entry }
  })
  return clone
}

function cloneSceneAssetOverrides(
  overrides: Record<string, SceneAssetOverrideEntry>,
): Record<string, SceneAssetOverrideEntry> {
  const clone: Record<string, SceneAssetOverrideEntry> = {}
  Object.entries(overrides).forEach(([assetId, entry]) => {
    clone[assetId] = { ...entry }
  })
  return clone
}

function cloneSceneResourceSummary(
  summary: SceneResourceSummary,
): SceneResourceSummary {
  return JSON.parse(JSON.stringify(summary)) as SceneResourceSummary
}

function migrateScenePersistedState(
  state: Partial<SceneState> | undefined,
  _fromVersion: number,
  _toVersion: number,
): Partial<SceneState> {
  if (!state || typeof state !== 'object') {
    return state ?? {}
  }

  const next: Record<string, unknown> = { ...state }

  delete next.scenes
  delete next.sceneSummaries
  delete next.currentScene
  delete next.sceneName

  if (typeof next.currentSceneId !== 'string') {
    next.currentSceneId = null
  }

  const now = new Date().toISOString()
  if (!next.currentSceneMeta || typeof next.currentSceneMeta !== 'object') {
    const fallbackName = typeof (state as Record<string, unknown>).currentSceneName === 'string'
      ? ((state as Record<string, unknown>).currentSceneName as string)
      : 'Untitled Scene'
    const name = fallbackName.trim() || 'Untitled Scene'
    next.currentSceneMeta = {
      name,
      thumbnail: null,
      createdAt: now,
      updatedAt: now,
    }
  } else {
    const meta = { ...(next.currentSceneMeta as Record<string, unknown>) }
    const name = typeof meta.name === 'string' ? meta.name.trim() : ''
    const createdAt = typeof meta.createdAt === 'string' ? meta.createdAt : now
    const updatedAt = typeof meta.updatedAt === 'string' ? meta.updatedAt : createdAt
    next.currentSceneMeta = {
      name: name || 'Untitled Scene',
      thumbnail: typeof meta.thumbnail === 'string' ? meta.thumbnail : null,
      createdAt,
      updatedAt,
    }
  }

  // Runtime-only interaction state should never be restored from persistence.
  next.selectedNodeId = null
  next.selectedNodeIds = []
  next.activeTool = 'select'

  if (typeof next.hasUnsavedChanges !== 'boolean') {
    next.hasUnsavedChanges = false
  }

  if (!next.environment || typeof next.environment !== 'object') {
    next.environment = cloneEnvironmentSettings(DEFAULT_ENVIRONMENT_SETTINGS)
  } else {
    next.environment = cloneEnvironmentSettings(next.environment as Partial<EnvironmentSettings> | EnvironmentSettings)
  }

  return next as Partial<SceneState>
}

function applySceneAssetState(store: SceneState, scene: StoredSceneDocument) {
  const sceneAssetCatalog = cloneAssetCatalog(scene.assetCatalog)
  store.assetManifest = normalizeSceneAssetManifest(scene.assetManifest, sceneAssetCatalog, `loading scene \"${scene.name || scene.id}\"`)
  const baseCatalog = buildAssetCatalogFromManifest(store.assetManifest, sceneAssetCatalog)
  store.assetRegistry = cloneSceneAssetRegistry(scene.assetRegistry ?? {})
  store.projectOverrideAssets = scene.projectOverrideAssets
    ? cloneSceneAssetOverrides(scene.projectOverrideAssets)
    : undefined
  store.sceneOverrideAssets = scene.sceneOverrideAssets
    ? cloneSceneAssetOverrides(scene.sceneOverrideAssets)
    : undefined
  store.resourceSummary = scene.resourceSummary
    ? cloneSceneResourceSummary(scene.resourceSummary)
    : undefined
  store.assetCatalog = mergeCatalogAssetMetadataFromIndex(baseCatalog)
  ensureBuiltinWallPresetAssets(store.assetCatalog)
  store.assetCatalog = mergeCatalogAssetMetadataFromIndex(store.assetCatalog)
  store.materials = cloneSceneMaterials(initialMaterials)
  const nextTree = buildSceneProjectTree(store.assetManifest, store.assetCatalog, store.packageDirectoryCache)
  store.projectTree = nextTree
  if (store.activeDirectoryId && !findDirectory(nextTree, store.activeDirectoryId)) {
    store.activeDirectoryId = defaultDirectoryId
  }
  if (store.selectedAssetId && !findAssetInTree(nextTree, store.selectedAssetId)) {
    store.selectedAssetId = null
  }
}

function createContentHistoryEntry(store: SceneState): SceneHistoryEntry {
  return {
    kind: 'content-snapshot',
    nodes: cloneSceneNodes(store.nodes),
    materials: cloneSceneMaterials(store.materials),
    groundSettings: resolveGroundSettingsFromNodes(store.nodes, store.groundSettings),
  }
}

function resolveGroundSettingsFromNodes(nodes: SceneNode[], fallback: GroundSettings): GroundSettings {
  const base = cloneGroundSettings(fallback)
  const groundNode = findGroundNode(nodes)
  const definition = groundNode?.dynamicMesh?.type === 'Ground' ? groundNode.dynamicMesh : null
  if (!definition) {
    return base
  }
  return cloneGroundSettings({
    width: Number.isFinite(definition.width) ? Number(definition.width) : base.width,
    depth: Number.isFinite(definition.depth) ? Number(definition.depth) : base.depth,
    enableAirWall: base.enableAirWall,
    editorScatterDynamicStreamingEnabled: base.editorScatterDynamicStreamingEnabled,
    editorScatterVisible: base.editorScatterVisible,
  })
}

type NodeBasicsHistoryRequest = {
  id: string
  name?: boolean
  visible?: boolean
  locked?: boolean
  userData?: boolean
  mirror?: boolean
}

function createNodeBasicsHistoryEntry(store: SceneState, requests: NodeBasicsHistoryRequest[]): SceneHistoryEntry {
  
  const snapshots: any[] = []

  const normalized = Array.isArray(requests)
    ? requests.filter((request): request is NodeBasicsHistoryRequest => Boolean(request && typeof request.id === 'string' && request.id.length))
    : []

  normalized.forEach((request) => {
    const node = findNodeById(store.nodes, request.id)
    if (!node) {
      return
    }

    const snapshot: Record<string, unknown> = { id: request.id }
    if (request.name) {
      snapshot.name = node.name
    }
    if (request.visible) {
      snapshot.visible = typeof (node as any).visible === 'boolean' ? (node as any).visible : null
    }
    if (request.locked) {
      snapshot.locked = typeof (node as any).locked === 'boolean' ? (node as any).locked : null
    }
    if (request.userData) {
      const raw = (node as any).userData
      snapshot.userData = raw && isPlainRecord(raw) ? (clonePlainRecord(raw) ?? null) : null
    }
    if (request.mirror) {
      const raw = (node as any).mirror
      snapshot.mirror = typeof raw === 'string' ? raw : null
    }

    // Avoid writing empty snapshots.
    if (Object.keys(snapshot).length > 1) {
      snapshots.push(snapshot)
    }
  })

  // Ensure stable ordering for deterministic diffs/history.
  snapshots.sort((a, b) => String(a.id).localeCompare(String(b.id)))
  return { kind: 'node-basics', snapshots }
}

export function findNodeLocationInTree(nodes: SceneNode[], targetId: string): SceneHistoryNodeLocation | null {
  if (!targetId) {
    return null
  }

  const visit = (current: SceneNode[], parentId: string | null): SceneHistoryNodeLocation | null => {
    for (let index = 0; index < current.length; index += 1) {
      const node = current[index]!
      if (node.id === targetId) {
        return { parentId, index }
      }
      if (node.children?.length) {
        const found = visit(node.children, node.id)
        if (found) {
          return found
        }
      }
    }
    return null
  }

  return visit(nodes, null)
}

function extractSubtreeSnapshot(nodes: SceneNode[], nodeId: string): SceneNode | null {
  const node = findNodeById(nodes, nodeId)
  if (!node) {
    return null
  }
  return cloneSceneNodes([node])[0] ?? null
}

function removeNodeByIdImmutable(nodes: SceneNode[], nodeId: string): { tree: SceneNode[]; removed: SceneNode | null } {
  let removed: SceneNode | null = null
  const walk = (current: SceneNode[]): SceneNode[] => {
    const next: SceneNode[] = []
    for (const node of current) {
      if (node.id === nodeId) {
        removed = node
        continue
      }
      if (node.children?.length) {
        const nextChildren = walk(node.children)
        if (nextChildren !== node.children) {
          next.push({ ...node, children: nextChildren.length ? nextChildren : undefined })
        } else {
          next.push(node)
        }
      } else {
        next.push(node)
      }
    }
    return next
  }

  const nextTree = walk(nodes)
  return { tree: nextTree, removed }
}

function insertSubtreeAtLocationImmutable(
  nodes: SceneNode[],
  subtree: SceneNode,
  location: SceneHistoryNodeLocation,
): SceneNode[] {
  const cloned = cloneSceneNodes([subtree])[0]
  if (!cloned) {
    return nodes
  }

  const parentId = location.parentId ?? null
  const requestedIndex = Number.isFinite(location.index) ? location.index : 0

  // Root insert
  if (!parentId || parentId === ENVIRONMENT_NODE_ID) {
    const next = [...nodes]
    const safeIndex = Math.min(Math.max(requestedIndex, 0), next.length)
    next.splice(safeIndex, 0, cloned)
    return next
  }

  // Insert as child
  let inserted = false
  const walk = (current: SceneNode[]): SceneNode[] => {
    return current.map((node) => {
      if (inserted) {
        return node
      }
      if (node.id === parentId) {
        if (!allowsChildNodes(node)) {
          return node
        }
        const children = node.children ? [...node.children] : []
        const safeIndex = Math.min(Math.max(requestedIndex, 0), children.length)
        children.splice(safeIndex, 0, cloned)
        inserted = true
        return { ...node, children }
      }
      if (node.children?.length) {
        const nextChildren = walk(node.children)
        if (nextChildren !== node.children) {
          return { ...node, children: nextChildren.length ? nextChildren : undefined }
        }
      }
      return node
    })
  }

  const nextTree = walk(nodes)
  if (inserted) {
    return nextTree
  }

  // Parent missing: fall back to root.
  const fallback = [...nodes]
  const safeIndex = Math.min(Math.max(requestedIndex, 0), fallback.length)
  fallback.splice(safeIndex, 0, cloned)
  return fallback
}

function createTransformHistoryEntry(store: SceneState, nodeIds: string[]): SceneHistoryEntry {
  const transforms: SceneHistoryTransformSnapshot[] = []
  nodeIds.forEach((id) => {
    const node = findNodeById(store.nodes, id)
    if (!node) return
    transforms.push({
      id,
      position: cloneVector(node.position ?? { x: 0, y: 0, z: 0 }),
      rotation: cloneVector(node.rotation ?? { x: 0, y: 0, z: 0 }),
      scale: cloneVector(node.scale ?? { x: 1, y: 1, z: 1 }),
    })
  })
  return { kind: 'node-transform', transforms }
}

function createDynamicMeshHistoryEntry(store: SceneState, nodeId: string): SceneHistoryEntry | null {
  const node = findNodeById(store.nodes, nodeId)
  if (!node) {
    return null
  }
  // NOTE: dynamicMesh can be large (especially Ground manual/planning maps). Prefer dedicated ground region history
  // for sculpt operations; this is mainly for non-ground meshes (road/wall/floor) and discrete edits.
  return {
    kind: 'node-dynamic-mesh',
    nodeId,
    dynamicMesh: manualDeepClone((node as any).dynamicMesh ?? null),
  }
}

function collectRecenterTransformTargets(
  nodes: SceneNode[],
  startIds: Array<string | null | undefined>,
  extraIds: string[] = [],
): string[] {
  const parentMap = buildParentMap(nodes)
  const targets = new Set<string>()

  const pushNodeAndChildren = (nodeId: string) => {
    const node = findNodeById(nodes, nodeId)
    if (!node) {
      return
    }
    targets.add(nodeId)
    node.children?.forEach((child) => {
      targets.add(child.id)
    })
  }

  startIds.forEach((rawId) => {
    let current = typeof rawId === 'string' && rawId.length ? rawId : null
    const visited = new Set<string>()
    while (current) {
      if (visited.has(current)) {
        break
      }
      visited.add(current)
      pushNodeAndChildren(current)
      current = parentMap.get(current) ?? null
    }
  })

  extraIds.forEach((id) => {
    if (typeof id === 'string' && id.length) {
      targets.add(id)
    }
  })

  return Array.from(targets)
}

function captureRedoEntryFor(store: SceneState, entry: SceneHistoryEntry): SceneHistoryEntry | null {
  const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key)
  switch (entry.kind) {
    case 'content-snapshot':
      return createContentHistoryEntry(store)
    case 'batch': {
      const captured: SceneHistoryEntry[] = []
      entry.entries.forEach((child) => {
        const redo = captureRedoEntryFor(store, child)
        if (redo) {
          captured.push(redo)
        }
      })
      if (!captured.length) {
        return null
      }
      // Invert order: redo should apply inverse operations in reverse.
      return { kind: 'batch', entries: captured.reverse() }
    }
    case 'node-basics': {
      const requests: NodeBasicsHistoryRequest[] = entry.snapshots.map((snapshot) => {
        return {
          id: snapshot.id,
          name: hasOwn(snapshot, 'name'),
          visible: hasOwn(snapshot, 'visible'),
          locked: hasOwn(snapshot, 'locked'),
          userData: hasOwn(snapshot, 'userData'),
          mirror: hasOwn(snapshot, 'mirror'),
        }
      })
      return createNodeBasicsHistoryEntry(store, requests)
    }
    case 'node-structure': {
      const nextOps: SceneHistoryNodeStructureOp[] = []
      entry.ops.forEach((op) => {
        if (op.type === 'remove') {
          const subtree = extractSubtreeSnapshot(store.nodes, op.nodeId)
          if (!subtree) {
            return
          }
          nextOps.push({
            type: 'insert',
            location: op.location,
            subtree,
          })
          return
        }
        if (op.type === 'insert') {
          nextOps.push({
            type: 'remove',
            location: op.location,
            nodeId: op.subtree.id,
          })
        }
      })
      return { kind: 'node-structure', ops: nextOps }
    }
    case 'ground-settings':
      return { kind: 'ground-settings', groundSettings: cloneGroundSettings(store.groundSettings) }
    case 'ground-texture': {
      const groundNode = findNodeById(store.nodes, entry.nodeId)
      const definition = groundNode?.dynamicMesh?.type === 'Ground' ? (groundNode.dynamicMesh as GroundDynamicMesh) : null
      return {
        kind: 'ground-texture',
        nodeId: entry.nodeId,
        dataUrl: definition?.textureDataUrl ?? null,
        name: definition?.textureName ?? null,
      }
    }
    case 'node-transform':
      return createTransformHistoryEntry(store, entry.transforms.map((t) => t.id))
    case 'node-dynamic-mesh':
      return createDynamicMeshHistoryEntry(store, entry.nodeId)
    default:
      return null
  }
}

function applyHistoryEntry(store: SceneState, entry: SceneHistoryEntry): void {
  const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key)
  switch (entry.kind) {
    case 'content-snapshot': {
      replaceSceneNodes(store, cloneSceneNodes(entry.nodes))
      store.materials = cloneSceneMaterials(entry.materials)
      store.groundSettings = cloneGroundSettings(entry.groundSettings)
      break
    }
    case 'batch': {
      entry.entries.forEach((child) => {
        applyHistoryEntry(store, child)
      })
      break
    }
    case 'node-basics': {
      entry.snapshots.forEach((snapshot) => {
        visitNode(store.nodes, snapshot.id, (node) => {
          if (hasOwn(snapshot, 'name') && typeof snapshot.name === 'string') {
            node.name = snapshot.name
          }
          if (hasOwn(snapshot, 'visible')) {
            if (snapshot.visible === null) {
              if ('visible' in (node as any)) {
                delete (node as any).visible
              }
            } else {
              ;(node as any).visible = Boolean(snapshot.visible)
            }
          }
          if (hasOwn(snapshot, 'locked')) {
            if (snapshot.locked === null) {
              if ('locked' in (node as any)) {
                delete (node as any).locked
              }
            } else {
              ;(node as any).locked = Boolean(snapshot.locked)
            }
          }
          if (hasOwn(snapshot, 'userData')) {
            const raw = snapshot.userData
            ;(node as any).userData = raw && isPlainRecord(raw) ? (clonePlainRecord(raw) ?? null) : null
          }
          if (hasOwn(snapshot, 'mirror')) {
            const raw = (snapshot as any).mirror
            if (raw === null) {
              if ('mirror' in (node as any)) {
                delete (node as any).mirror
              }
            } else if (raw === 'horizontal' || raw === 'vertical') {
              ;(node as any).mirror = raw
            }
          }
        })
      })
      replaceSceneNodes(store, [...store.nodes])
      break
    }
    case 'node-structure': {
      // Apply removes first (by id), then inserts at recorded locations.
      let working = store.nodes as SceneNode[]

      entry.ops.forEach((op) => {
        if (op.type !== 'remove') {
          return
        }
        const result = removeNodeByIdImmutable(working, op.nodeId)
        working = result.tree
      })

      entry.ops.forEach((op) => {
        if (op.type !== 'insert') {
          return
        }
        working = insertSubtreeAtLocationImmutable(working, op.subtree, op.location)
      })

      replaceSceneNodes(store, working)
      break
    }
    case 'ground-settings': {
      store.groundSettings = cloneGroundSettings(entry.groundSettings)
      break
    }
    case 'ground-texture': {
      const groundNode = findNodeById(store.nodes, entry.nodeId)
      if (!groundNode) {
        break
      }
      if (groundNode.dynamicMesh?.type !== 'Ground') {
        groundNode.dynamicMesh = createGroundDynamicMeshDefinition({}, store.groundSettings)
      }
      const definition = groundNode.dynamicMesh as GroundDynamicMesh
      groundNode.dynamicMesh = {
        ...definition,
        textureDataUrl: entry.dataUrl,
        textureName: entry.name,
      }
      replaceSceneNodes(store, [...store.nodes])
      break
    }
    case 'node-transform': {
      entry.transforms.forEach((transform) => {
        visitNode(store.nodes, transform.id, (node) => {
          node.position = cloneVector(transform.position)
          node.rotation = cloneVector(transform.rotation)
          node.scale = cloneVector(transform.scale)
        })
      })
      replaceSceneNodes(store, [...store.nodes])
      break
    }
    case 'node-dynamic-mesh': {
      visitNode(store.nodes, entry.nodeId, (node) => {
        ;(node as any).dynamicMesh = manualDeepClone(entry.dynamicMesh as any)
      })
      replaceSceneNodes(store, [...store.nodes])
      break
    }
  }
}

function collectNodeIds(node: SceneNode, buffer: string[]) {
  buffer.push(node.id)
  node.children?.forEach((child) => collectNodeIds(child, buffer))
}

function flattenNodeIds(nodes: SceneNode[]): string[] {
  const buffer: string[] = []
  nodes.forEach((node) => collectNodeIds(node, buffer))
  return buffer
}

function normalizeSelectionIds(nodes: SceneNode[], ids?: string[] | null): string[] {
  if (!Array.isArray(ids) || ids.length === 0) {
    return []
  }
  const validIds = new Set(flattenNodeIds(nodes))
  const parentMap = buildParentMap(nodes)
  const nodeLookup = buildNodeLookup(nodes)
  const seen = new Set<string>()
  const normalized: string[] = []
  ids.forEach((id) => {
    if (!validIds.has(id) || seen.has(id)) {
      return
    }
    const resolvedId = resolveSelectableNodeId(id, { parentMap, nodeLookup })
    if (seen.has(resolvedId)) {
      return
    }
    if (!validIds.has(resolvedId)) {
      return
    }
    normalized.push(resolvedId)
    seen.add(resolvedId)
  })
  return normalized
}

function cloneSelection(ids: string[] | undefined | null): string[] {
  if (!Array.isArray(ids) || !ids.length) {
    return []
  }
  return [...ids]
}

function areSelectionsEqual(a: string[], b: string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

function createSceneDocument(
  name: string,
  options: {
    id?: string
    projectId?: string
    nodes?: SceneNode[]
    materials?: SceneMaterial[]
    selectedNodeId?: string | null
    selectedNodeIds?: string[]
    camera?: SceneCameraState
    resourceProviderId?: string
    createdAt?: string
    updatedAt?: string
    assetCatalog?: Record<string, ProjectAsset[]>
    assetManifest?: AssetManifest | null
    assetRegistry?: Record<string, SceneAssetRegistryEntry>
    projectOverrideAssets?: Record<string, SceneAssetOverrideEntry>
    sceneOverrideAssets?: Record<string, SceneAssetOverrideEntry>
    resourceSummary?: SceneResourceSummary
    planningData?: PlanningSceneData | null
    viewportSettings?: Partial<SceneViewportSettings>
    shadowsEnabled?: boolean
    panelVisibility?: Partial<PanelVisibilityState>
    panelPlacement?: Partial<PanelPlacementState>
    groundSettings?: Partial<GroundSettings>
    environment?: Partial<EnvironmentSettings>
  } = {},
): StoredSceneDocument {
  const id = options.id ?? generateUuid()
  const clonedNodes = cloneSceneNodes(options.nodes ?? [])
  const existingGround = findGroundNode(clonedNodes)
  const existingGroundMesh = existingGround?.dynamicMesh?.type === 'Ground'
    ? existingGround.dynamicMesh
    : null
  const groundSettings = cloneGroundSettings(
    options.groundSettings
      ?? (existingGroundMesh ? { width: existingGroundMesh.width, depth: existingGroundMesh.depth } : undefined),
  )
  const existingEnvironmentNode = clonedNodes.find((node) => isEnvironmentNode(node)) ?? null
  const environmentSettings = cloneEnvironmentSettings(
    options.environment ?? (existingEnvironmentNode ? extractEnvironmentSettings(existingEnvironmentNode) : DEFAULT_ENVIRONMENT_SETTINGS),
  )
  const groundedNodes = ensureGroundNode(clonedNodes, groundSettings)
  // Sky node is optional: only auto-create it for new scenes without explicit nodes.
  const nodes = ensureEnvironmentNode(groundedNodes, environmentSettings)
  const camera = options.camera ? cloneCameraState(options.camera) : cloneCameraState(defaultCameraState)
  const now = new Date().toISOString()
  const createdAt = options.createdAt ?? now
  const updatedAt = options.updatedAt ?? createdAt
  const assetCatalog = options.assetCatalog ? cloneAssetCatalog(options.assetCatalog) : createEmptyAssetCatalog()
  const assetRegistry = options.assetRegistry ? cloneSceneAssetRegistry(options.assetRegistry) : {}
  const projectOverrideAssets = options.projectOverrideAssets
    ? cloneSceneAssetOverrides(options.projectOverrideAssets)
    : undefined
  const sceneOverrideAssets = options.sceneOverrideAssets
    ? cloneSceneAssetOverrides(options.sceneOverrideAssets)
    : undefined
  const normalizedAssetCatalog = mergeCatalogAssetMetadataFromIndex(assetCatalog)
  const normalizedAssetManifest = normalizeSceneAssetManifest(options.assetManifest, normalizedAssetCatalog, `creating scene \"${name}\"`)
  const normalizedStoredAssetCatalog = mergeCatalogAssetMetadataFromIndex(
    mergeAssetCatalogsById(buildAssetCatalogFromManifest(normalizedAssetManifest, normalizedAssetCatalog), normalizedAssetCatalog),
  )
  let resourceSummary: SceneResourceSummary | undefined
  if (options.resourceSummary) {
    resourceSummary = options.resourceSummary
  }
  const shadowsEnabled = normalizeShadowsEnabledInput(options.shadowsEnabled)
  const viewportSettings = cloneViewportSettings(options.viewportSettings)
  const panelVisibility = normalizePanelVisibilityState(options.panelVisibility)
  const panelPlacement = normalizePanelPlacementStateInput(options.panelPlacement)

  return {
    id,
    name,
    projectId: options.projectId ?? '',
    nodes,
    camera,
    viewportSettings,
    shadowsEnabled,
    environment: environmentSettings,
    groundSettings,
    panelVisibility,
    panelPlacement,
    resourceProviderId: options.resourceProviderId ?? 'builtin',
    createdAt,
    updatedAt,
    assetCatalog: normalizedStoredAssetCatalog,
    assetManifest: normalizedAssetManifest,
    assetRegistry,
    projectOverrideAssets,
    sceneOverrideAssets,
    resourceSummary,
    planningData: clonePlanningData(options.planningData),
  }
}

function normalizeCurrentSceneMeta(store: SceneState) {
  const now = new Date().toISOString()
  if (!store.currentSceneMeta) {
    store.currentSceneMeta = {
      name: 'Untitled Scene',
      createdAt: now,
      updatedAt: now,
      projectId: '',
    }
    return
  }

  const name = typeof store.currentSceneMeta.name === 'string' ? store.currentSceneMeta.name.trim() : ''
  const createdAtRaw = store.currentSceneMeta.createdAt
  const updatedAtRaw = store.currentSceneMeta.updatedAt
  const createdAt = typeof createdAtRaw === 'string' && createdAtRaw ? createdAtRaw : now
  const updatedAt = typeof updatedAtRaw === 'string' && updatedAtRaw ? updatedAtRaw : createdAt

  const projectId = typeof store.currentSceneMeta.projectId === 'string' ? store.currentSceneMeta.projectId : ''

  store.currentSceneMeta = {
    name: name || 'Untitled Scene',
    createdAt,
    updatedAt,
    projectId,
  }
}

function buildSceneDocumentFromState(store: SceneState): StoredSceneDocument {
  if (!store.currentSceneId) {
    throw new Error('Cannot create scene document without an active scene')
  }

  const now = new Date().toISOString()
  const meta = store.currentSceneMeta!
  const projectId = typeof meta.projectId === 'string' ? meta.projectId : ''
  const environment = cloneEnvironmentSettings(store.environment)
  const nodes = ensureEnvironmentNode(cloneSceneNodes(store.nodes), environment)
  const effectiveGroundSettings = resolveGroundSettingsFromNodes(nodes, store.groundSettings)

  const planningData = store.planningData
  const normalizedPlanningData = planningData && isPlanningDataEmpty(planningData) ? null : planningData

  return {
    id: store.currentSceneId,
    name: meta.name,
    projectId,
    nodes,
    camera: cloneCameraState(store.camera),
    viewportSettings: cloneViewportSettings(store.viewportSettings),
    shadowsEnabled: normalizeShadowsEnabledInput(store.shadowsEnabled),
    environment,
    groundSettings: effectiveGroundSettings,
    panelVisibility: normalizePanelVisibilityState(store.panelVisibility),
    panelPlacement: normalizePanelPlacementStateInput(store.panelPlacement),
    resourceProviderId: store.resourceProviderId ?? 'builtin',
    createdAt: meta.createdAt,
    updatedAt: now,
    assetCatalog: cloneAssetCatalog(store.assetCatalog),
    assetManifest: cloneAssetManifest(store.assetManifest) ?? buildSceneAssetManifest(store.assetCatalog),
    assetRegistry: cloneSceneAssetRegistry(store.assetRegistry),
    projectOverrideAssets: store.projectOverrideAssets ? cloneSceneAssetOverrides(store.projectOverrideAssets) : undefined,
    sceneOverrideAssets: store.sceneOverrideAssets ? cloneSceneAssetOverrides(store.sceneOverrideAssets) : undefined,
    resourceSummary: store.resourceSummary ? cloneSceneResourceSummary(store.resourceSummary) : undefined,
    planningData: normalizedPlanningData ?? undefined,
  }
}

function isPlanningDataEmpty(data: PlanningSceneData): boolean {
  const terrain = (data as any)?.terrain as any
  const terrainHasContent = (() => {
    if (!terrain || typeof terrain !== 'object') return false
    const noiseEnabled = Boolean(terrain?.noise?.enabled)
    const controlPoints = Array.isArray(terrain?.controlPoints) ? terrain.controlPoints : []
    const ridgeValleyLines = Array.isArray(terrain?.ridgeValleyLines) ? terrain.ridgeValleyLines : []
    const overrideCells = terrain?.overrides?.cells && typeof terrain.overrides.cells === 'object'
      ? Object.keys(terrain.overrides.cells).length
      : 0

    // If noise is enabled but settings effectively produce flat output, treat it as empty.
    const noiseAmplitude = Number(terrain?.noise?.noiseAmplitude)
    const noiseStrength = Number(terrain?.noise?.noiseStrength)
    const noiseMode = typeof terrain?.noise?.mode === 'string' ? terrain.noise.mode : ''
    const noiseProducesAnyHeight = noiseEnabled
      && (noiseMode !== 'flat')
      && (Number.isFinite(noiseAmplitude) ? noiseAmplitude !== 0 : true)
      && (Number.isFinite(noiseStrength) ? noiseStrength !== 0 : true)

    return noiseProducesAnyHeight || controlPoints.length > 0 || ridgeValleyLines.length > 0 || overrideCells > 0
  })()

  return (
    (!data.images || data.images.length === 0)
    && (!data.polygons || data.polygons.length === 0)
    && (!data.polylines || data.polylines.length === 0)
    && (!data.guides || data.guides.length === 0)
    && !terrainHasContent
  )
}

function clonePlanningData(data: PlanningSceneData | null | undefined): PlanningSceneData | null {
  if (!data) {
    return null
  }
  return manualDeepClone(data)
}

function commitSceneSnapshot(
  store: SceneState,
  _options: { updateNodes?: boolean; } = {},
) {
  if (!store.currentSceneId) {
    return
  }

  const normalizedNodes = ensureEnvironmentNode(store.nodes, store.environment)
  if (normalizedNodes !== store.nodes) {
    replaceSceneNodes(store, normalizedNodes)
  } else {
    syncGroundNodeReference(store)
  }

  normalizeCurrentSceneMeta(store)
  store.hasUnsavedChanges = true
}

function applyCurrentSceneMeta(store: SceneState, document: StoredSceneDocument) {
  store.currentSceneMeta = {
    name: document.name,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    projectId: document.projectId,
  }
}

function createInitialSceneState(): SceneState {
  const assetCatalogBase = cloneAssetCatalog(initialAssetCatalog)
  const assetCatalog = mergeCatalogAssetMetadataFromIndex(assetCatalogBase)
  const assetManifest = buildSceneAssetManifest(assetCatalog)
  const packageDirectoryCache: Record<string, ProjectDirectory[]> = {}
  const viewportSettings = cloneViewportSettings(defaultViewportSettings)
  const initialEnvironment = cloneEnvironmentSettings(DEFAULT_ENVIRONMENT_SETTINGS)
  let clonedNodes = cloneSceneNodes(initialNodes)
  clonedNodes = ensureEnvironmentNode(
    ensureGroundNode(clonedNodes, cloneGroundSettings(undefined)),
    initialEnvironment,
  )
  const initialGroundNode = findGroundNode(clonedNodes)
  componentManager.reset()
  componentManager.syncScene(clonedNodes)
  return {
    currentSceneId: null,
    sceneSwitchToken: 0,
    currentSceneMeta: null,
    nodes: clonedNodes,
    groundNode: initialGroundNode,
    materials: cloneSceneMaterials(initialMaterials),
    selectedNodeId: null,
    selectedNodeIds: [],
    selectedRoadSegment: null,
    selectedGuideRouteWaypoint: null,
    activeTool: 'select',
    assetCatalog,
    assetManifest,
    assetRegistry: {},
    projectOverrideAssets: undefined,
    sceneOverrideAssets: undefined,
    resourceSummary: undefined,
    packageDirectoryCache,
    packageDirectoryLoaded: {},
    projectTree: buildSceneProjectTree(assetManifest, assetCatalog, packageDirectoryCache),
    activeDirectoryId: defaultDirectoryId,
    selectedAssetId: null,
    camera: cloneCameraState(defaultCameraState),
    viewportSettings,
    shadowsEnabled: normalizeShadowsEnabledInput(defaultShadowsEnabled),
    environment: initialEnvironment,
    groundSettings: cloneGroundSettings(undefined),
    planningData: null,
    panelVisibility: { ...defaultPanelVisibility },
    panelPlacement: { ...defaultPanelPlacement },
    projectPanelTreeSize: DEFAULT_PROJECT_PANEL_TREE_SIZE,
    resourceProviderId: 'builtin',
    prefabAssetDownloadProgress: {},
    cameraFocusNodeId: null,
    cameraFocusRequestId: 0,
    nodeHighlightTargetId: null,
    nodeHighlightRequestId: 0,
    clipboard: null,
    draggingAssetId: null,
    draggingAssetObject: null,
    undoStack: [],
    redoStack: [],
    isRestoringHistory: false,
    activeTransformNodeId: null,
    transformSnapshotCaptured: false,
    isSceneReady: false,
    hasUnsavedChanges: false,
    sceneGraphStructureVersion: 0,
    sceneNodePropertyVersion: 0,
    pendingScenePatches: [],
    workspaceId: '',
    workspaceType: 'local',
    workspaceLabel: 'Local User',
  }
}

function resetSceneStateToNoSelection(store: SceneState) {
  const initialState = createInitialSceneState()
  store.currentSceneId = null
  store.currentSceneMeta = null
  store.sceneSwitchToken += 1
  replaceSceneNodes(store, cloneSceneNodes(initialState.nodes))
  store.environment = cloneEnvironmentSettings(initialState.environment)
  store.materials = cloneSceneMaterials(initialState.materials)
  store.selectedNodeId = null
  store.selectedNodeIds = []
  store.selectedRoadSegment = null
  store.selectedGuideRouteWaypoint = null
  store.assetCatalog = cloneAssetCatalog(initialState.assetCatalog)
  store.assetRegistry = cloneSceneAssetRegistry(initialState.assetRegistry)
  store.packageDirectoryCache = {}
  store.packageDirectoryLoaded = {}
  store.projectTree = createProjectTreeFromCache(
    buildVisibleAssetCatalog(store.assetCatalog),
    store.packageDirectoryCache,
  )
  store.activeDirectoryId = defaultDirectoryId
  store.selectedAssetId = null
  store.camera = cloneCameraState(initialState.camera)
  store.viewportSettings = cloneViewportSettings(initialState.viewportSettings)
  store.shadowsEnabled = normalizeShadowsEnabledInput(initialState.shadowsEnabled)
  store.groundSettings = cloneGroundSettings(initialState.groundSettings)
  store.planningData = null
  store.panelVisibility = { ...initialState.panelVisibility }
  store.panelPlacement = { ...initialState.panelPlacement }
  store.projectPanelTreeSize = initialState.projectPanelTreeSize
  store.resourceProviderId = initialState.resourceProviderId
  store.prefabAssetDownloadProgress = {}
  store.cameraFocusNodeId = null
  store.cameraFocusRequestId = 0
  store.nodeHighlightTargetId = null
  store.nodeHighlightRequestId = 0
  store.clipboard = null
  store.draggingAssetId = null
  store.draggingAssetObject = null
  store.undoStack = []
  store.redoStack = []
  store.isRestoringHistory = false
  store.activeTransformNodeId = null
  store.transformSnapshotCaptured = false
  store.isSceneReady = false
  store.hasUnsavedChanges = false
  store.sceneGraphStructureVersion = 0
  store.sceneNodePropertyVersion = 0
  store.pendingScenePatches = []
  store.workspaceId = ''
  store.workspaceType = 'local'
  store.workspaceLabel = 'Local User'
  clearRuntimeObjectRegistry()
  componentManager.reset()
  componentManager.syncScene(store.nodes)
}

function releaseRuntimeTree(node: SceneNode) {
  if (isGroundNode(node)) {
    const store = getTerrainScatterStore(node.id)
    if (store) {
      for (const layer of store.layers.values()) {
        for (const instance of layer.instances) {
          resetScatterInstanceBinding(instance)
        }
      }
    }
  }
  componentManager.removeNode(node.id)
  unregisterRuntimeObject(node.id)
  node.children?.forEach(releaseRuntimeTree)
}

function pruneNodes(nodes: SceneNode[], idSet: Set<string>, removed: string[]): SceneNode[] {
  const result: SceneNode[] = []
  for (const node of nodes) {
    if (idSet.has(node.id)) {
      removed.push(node.id)
      releaseRuntimeTree(node)
      if (isGroundNode(node)) {
        deleteTerrainScatterStore(node.id)
      }
      continue
    }
    const cloned = cloneNode(node)
    if (cloned.children) {
      cloned.children = pruneNodes(cloned.children, idSet, removed)
      if (cloned.children.length === 0) {
        delete cloned.children
      }
    }
    result.push(cloned)
  }
  return result
}

function findDirectory(directories: ProjectDirectory[], id: string): ProjectDirectory | null {
  for (const dir of directories) {
    if (dir.id === id) return dir
    if (dir.children) {
      const found = findDirectory(dir.children, id)
      if (found) return found
    }
  }
  return null
}

function findDirectoryPathInTree(
  directories: ProjectDirectory[],
  targetId: string,
  trail: ProjectDirectory[] = [],
): ProjectDirectory[] | null {
  for (const directory of directories) {
    const nextTrail = [...trail, directory]
    if (directory.id === targetId) {
      return nextTrail
    }
    if (directory.children?.length) {
      const found = findDirectoryPathInTree(directory.children, targetId, nextTrail)
      if (found) {
        return found
      }
    }
  }
  return null
}

function findAssetInTree(directories: ProjectDirectory[], assetId: string): ProjectAsset | null {
  for (const dir of directories) {
    if (dir.assets) {
      const asset = dir.assets.find((item) => item.id === assetId)
      if (asset) return asset
    }
    if (dir.children) {
      const found = findAssetInTree(dir.children, assetId)
      if (found) return found
    }
  }
  return null
}

function findAssetPathSegmentsInDirectories(
  directories: ProjectDirectory[],
  assetId: string,
  trail: string[] = [],
): string[] | null {
  for (const directory of directories) {
    const nextTrail = [...trail, directory.name]
    if (directory.assets?.some((item) => item.id === assetId)) {
      return nextTrail
    }
    if (directory.children?.length) {
      const found = findAssetPathSegmentsInDirectories(directory.children, assetId, nextTrail)
      if (found) {
        return found
      }
    }
  }
  return null
}

function extractServerCategoryMirrorSegments(asset: ProjectAsset): string[] {
  const rawSegments = Array.isArray(asset.categoryPath)
    ? asset.categoryPath
        .map((item) => item?.name)
        .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    : []
  if (!rawSegments.length) {
    return []
  }
  return rawSegments.filter((segment, index) => !(index === 0 && segment.trim() === '全部资源'))
}

function findNodeById(nodes: SceneNode[], id: string): SceneNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.children) {
      const match = findNodeById(node.children, id)
      if (match) return match
    }
  }
  return null
}

function collectNodeSubtreeIds(node: SceneNode, target: string[] = []): string[] {
  target.push(node.id)
  if (node.children?.length) {
    node.children.forEach((child) => collectNodeSubtreeIds(child, target))
  }
  return target
}

type SceneNodeIndex = {
  structureVersion: number
  nodeById: Map<string, SceneNode>
  parentById: Map<string, string | null>
}

const sceneNodeIndex: SceneNodeIndex = {
  structureVersion: -1,
  nodeById: new Map(),
  parentById: new Map(),
}

function rebuildSceneNodeIndex(nodes: SceneNode[]) {
  sceneNodeIndex.nodeById.clear()
  sceneNodeIndex.parentById.clear()

  const stack: Array<{ node: SceneNode; parentId: string | null }> = []
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]
    if (node) {
      stack.push({ node, parentId: null })
    }
  }

  while (stack.length) {
    const entry = stack.pop()
    if (!entry) {
      continue
    }
    const { node, parentId } = entry
    sceneNodeIndex.nodeById.set(node.id, node)
    sceneNodeIndex.parentById.set(node.id, parentId)
    const children = node.children
    if (children?.length) {
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i]
        if (child) {
          stack.push({ node: child, parentId: node.id })
        }
      }
    }
  }
}

function ensureSceneNodeIndex(store: { nodes: SceneNode[]; sceneGraphStructureVersion: number }) {
  if (sceneNodeIndex.structureVersion === store.sceneGraphStructureVersion) {
    return
  }
  rebuildSceneNodeIndex(store.nodes)
  sceneNodeIndex.structureVersion = store.sceneGraphStructureVersion
}

function isDescendantByParentMap(ancestorId: string, maybeChildId: string): boolean {
  if (!ancestorId || !maybeChildId) {
    return false
  }
  if (ancestorId === maybeChildId) {
    return true
  }
  if (!sceneNodeIndex.parentById.has(maybeChildId)) {
    return false
  }
  let current = sceneNodeIndex.parentById.get(maybeChildId) ?? null
  while (current) {
    if (current === ancestorId) {
      return true
    }
    current = sceneNodeIndex.parentById.get(current) ?? null
  }
  return false
}

function nodeContainsId(node: SceneNode, maybeChildId: string): boolean {
  if (!node.children) return false
  for (const child of node.children) {
    if (child.id === maybeChildId) return true
    if (nodeContainsId(child, maybeChildId)) return true
  }
  return false
}

function isDescendantNode(nodes: SceneNode[], ancestorId: string, childId: string): boolean {
  const ancestor = findNodeById(nodes, ancestorId)
  if (!ancestor) return false
  return nodeContainsId(ancestor, childId)
}

function isProtagonistNode(node: SceneNode | null | undefined): boolean {
  const components = node?.components
  if (!components) {
    return false
  }
  if (node?.id === PROTAGONIST_NODE_ID) {
    return true
  }
  const protagonist = components[PROTAGONIST_COMPONENT_TYPE] as
    | SceneNodeComponentState<ProtagonistComponentProps>
    | undefined
  return Boolean(protagonist)
}

function isMultiuserNode(node: SceneNode | null | undefined): boolean {
  if (!node) {
    return false
  }
  if (node.id === MULTIUSER_NODE_ID) {
    return true
  }
  const userData = node.userData as Record<string, unknown> | undefined
  if (userData?.multiuser) {
    return true
  }
  return Boolean(node.components?.[ONLINE_COMPONENT_TYPE])
}

function allowsChildNodes(node: SceneNode | null | undefined): boolean {
  if (!node) {
    return true
  }
  if (isMultiuserNode(node)) {
    return false
  }
  if (isProtagonistNode(node)) {
    return false
  }
  if (node.allowChildNodes === false) {
    return false
  }
  const nodeId = node.id
  if (nodeId === GROUND_NODE_ID || nodeId === ENVIRONMENT_NODE_ID) {
    return false
  }
  if (node.nodeType !== 'Group') {
    return false
  }
  if (node.groupExpanded === false) {
    return false
  }
  if (node.sourceAssetId) {
    return false
  }
  return true
}

function detachNodeImmutable(nodes: SceneNode[], targetId: string): DetachResult {
  const nextTree: SceneNode[] = []
  let removed: SceneNode | null = null

  for (const node of nodes) {
    if (node.id === targetId) {
      removed = cloneNode(node)
      continue
    }

    const cloned = cloneNode(node)
    if (node.children) {
      const { tree: childTree, node: childRemoved } = detachNodeImmutable(node.children, targetId)
      if (childRemoved) {
        removed = childRemoved
      }
      if (childTree.length > 0) {
        cloned.children = childTree
      } else {
        delete cloned.children
      }
    }

    nextTree.push(cloned)
  }

  return { tree: nextTree, node: removed }
}

function insertNodeMutable(
  nodes: SceneNode[],
  targetId: string | null,
  node: SceneNode,
  position: HierarchyDropPosition,
): boolean {
  if (position === 'inside' && isMultiuserNode(node)) {
    return false
  }
  if (targetId === null) {
    if (position === 'before') {
      nodes.unshift(node)
    } else {
      nodes.push(node)
    }
    return true
  }

  for (let index = 0; index < nodes.length; index += 1) {
    const current = nodes[index]!
    if (current.id === targetId) {
      if ((current.id === ENVIRONMENT_NODE_ID) && position === 'inside') {
        return false
      }
      if (position === 'inside') {
        if (!allowsChildNodes(current)) {
          return false
        }
        const children = current.children ? [...current.children, node] : [node]
        current.children = children
      } else if (position === 'before') {
        nodes.splice(index, 0, node)
      } else {
        nodes.splice(index + 1, 0, node)
      }
      return true
    }

    if (current.children) {
      const inserted = insertNodeMutable(current.children, targetId, node, position)
      if (inserted) {
        current.children = [...current.children]
        return true
      }
    }
  }

  return false
}

function selectionContainsLandformNode(
  nodes: SceneNode[],
  selectedIds: string[] | null | undefined,
): boolean {
  if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
    return false
  }

  return selectedIds.some((id) => {
    if (typeof id !== 'string' || id.length === 0) {
      return false
    }
    return findNodeById(nodes, id)?.dynamicMesh?.type === 'Landform'
  })
}

function isTransformToolAllowedForSelection(
  nodes: SceneNode[],
  selectedIds: string[] | null | undefined,
  tool: EditorTool,
): boolean {
  if ((tool === 'rotate' || tool === 'scale') && selectionContainsLandformNode(nodes, selectedIds)) {
    return false
  }
  return true
}

function normalizeInvalidTransformToolForSelection(
  nodes: SceneNode[],
  selectedIds: string[] | null | undefined,
  tool: EditorTool,
): EditorTool {
  if (!isTransformToolAllowedForSelection(nodes, selectedIds, tool) && (tool === 'rotate' || tool === 'scale')) {
    return 'translate'
  }
  return tool
}


export const useSceneStore = defineStore('scene', {
  state: (): SceneState => createInitialSceneState(),
  getters: {
    currentGroundNode(state): SceneNode | null {
      return state.groundNode
    },
    selectedNode(state): SceneNode | null {
      if (!state.selectedNodeId) return null
      let result: SceneNode | null = null
      visitNode(state.nodes, state.selectedNodeId, (node) => {
        result = node
      })
      return result
    },
    hierarchyItems(state): HierarchyTreeItem[] {
      return state.nodes.map(toHierarchyItem)
    },
    currentDirectory(state): ProjectDirectory | null {
      if (!state.activeDirectoryId) return state.projectTree[0] ?? null
      return findDirectory(state.projectTree, state.activeDirectoryId)
    },
    currentAssets(state): ProjectAsset[] {
      const directory = state.activeDirectoryId
        ? findDirectory(state.projectTree, state.activeDirectoryId)
        : state.projectTree[0] ?? null
      if (!state.activeDirectoryId) {
        return directory?.assets ?? []
      }
      if (!directory) {
        return []
      }

      return directory.assets ?? []
    },
    environmentSettings(state): EnvironmentSettings {
      return state.environment
    },
    canUndo(state): boolean {
      return state.undoStack.length > 0
    },
    canRedo(state): boolean {
      return state.redoStack.length > 0
    },
  },
  actions: {

    // Helper: build clipboard prefab payload for copy/cut actions
    createClipboardPrefabPayload(topLevelIds: string[], mode: 'copy' | 'cut') {
      if (!Array.isArray(topLevelIds) || topLevelIds.length === 0) return null

      const computeSelectionBoundsCenterWorld = (): Vector3 => {
        const boundingInfo = collectNodeBoundingInfo(this.nodes)
        const selectionBounds = new Box3()
        let boundsInitialized = false
        topLevelIds.forEach((id) => {
          const info = boundingInfo.get(id)
          if (!info || info.bounds.isEmpty()) return
          if (!boundsInitialized) {
            selectionBounds.copy(info.bounds)
            boundsInitialized = true
          } else {
            selectionBounds.union(info.bounds)
          }
        })
        if (boundsInitialized && !selectionBounds.isEmpty()) {
          return selectionBounds.getCenter(new Vector3())
        }
        const fallbackCenter = new Vector3()
        let count = 0
        topLevelIds.forEach((id) => {
          const matrix = computeWorldMatrixForNode(this.nodes, id)
          if (!matrix) return
          const position = new Vector3()
          const quaternion = new Quaternion()
          const scale = new Vector3()
          matrix.decompose(position, quaternion, scale)
          fallbackCenter.add(position)
          count += 1
        })
        if (count > 0) fallbackCenter.multiplyScalar(1 / count)
        return fallbackCenter
      }

      const roots: SceneNode[] = []
      let mergedAssetRegistry: Record<string, SceneAssetRegistryEntry> | undefined

      const mergePrefabMeta = (prefab: NodePrefabData) => {
        if (prefab.assetRegistry && Object.keys(prefab.assetRegistry).length) {
          mergedAssetRegistry = {
            ...(mergedAssetRegistry ?? {}),
            ...prefab.assetRegistry,
          }
        }
      }

      if (topLevelIds.length === 1) {
        const node = findNodeById(this.nodes, topLevelIds[0]!)
        if (!node) return null

        const payload = nodePrefabHelpers.buildSerializedPrefabPayload(node, {
          name: node.name ?? '',
          assetRegistry: this.assetRegistry,
          sceneNodes: this.nodes,
        })
        mergePrefabMeta(payload.prefab)
        roots.push(payload.prefab.root)

        const rootWorld = computeWorldMatrixForNode(this.nodes, node.id)
        let rootWorldPosition: Vector3Like | undefined
        let rootWorldRotation: QuaternionJson | undefined
        let rootWorldScale: Vector3Like | undefined
        if (rootWorld) {
          const position = new Vector3()
          const quaternion = new Quaternion()
          const scale = new Vector3()
          rootWorld.decompose(position, quaternion, scale)
          rootWorldPosition = toPlainVector(position)
          rootWorldRotation = { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w }
          rootWorldScale = toPlainVector(scale)
        }

        const envelope: ClipboardEnvelope = {
          formatVersion: NODE_PREFAB_FORMAT_VERSION,
          name: normalizePrefabName(node.name ?? 'Clipboard') || 'Clipboard',
          roots,
          clipboard: {
            mode,
            meta: {
              rootWorldPosition,
              rootWorldRotation,
              rootWorldScale,
            },
          },
        }
        if (mergedAssetRegistry && Object.keys(mergedAssetRegistry).length) {
          envelope.assetRegistry = mergedAssetRegistry
        }
        const serialized = JSON.stringify(envelope, null, 2)
        return { serialized, cut: mode === 'cut' }
      }

      const pivotWorldCenter = computeSelectionBoundsCenterWorld()
      const pivotTranslation = new Matrix4().identity()
      pivotTranslation.makeTranslation(pivotWorldCenter.x, pivotWorldCenter.y, pivotWorldCenter.z)
      const pivotInverse = pivotTranslation.clone().invert()

      topLevelIds.forEach((id) => {
        const source = findNodeById(this.nodes, id)
        if (!source) return
        const sourceWorld = computeWorldMatrixForNode(this.nodes, id)
        const payload = nodePrefabHelpers.buildSerializedPrefabPayload(source, {
          name: source.name ?? '',
          assetRegistry: this.assetRegistry,
          sceneNodes: this.nodes,
        })
        mergePrefabMeta(payload.prefab)
        const cloned = nodePrefabHelpers.prepareNodePrefabRoot(payload.prefab.root, { regenerateIds: false })
        if (sourceWorld) {
          const localMatrix = new Matrix4().multiplyMatrices(pivotInverse, sourceWorld)
          const position = new Vector3()
          const quaternion = new Quaternion()
          const scale = new Vector3()
          localMatrix.decompose(position, quaternion, scale)
          const euler = new Euler().setFromQuaternion(quaternion, 'XYZ')
          cloned.position = toPlainVector(position)
          cloned.rotation = { x: euler.x, y: euler.y, z: euler.z }
          cloned.scale = { x: scale.x, y: scale.y, z: scale.z }
        }
        roots.push(cloned)
      })

      if (!roots.length) return null

      const envelope: ClipboardEnvelope = {
        formatVersion: NODE_PREFAB_FORMAT_VERSION,
        name: 'Clipboard',
        roots,
        clipboard: {
          mode,
          meta: {
            pivotWorldPosition: toPlainVector(pivotWorldCenter),
          },
        },
      }

      if (mergedAssetRegistry && Object.keys(mergedAssetRegistry).length) {
        envelope.assetRegistry = mergedAssetRegistry
      }

      const serialized = JSON.stringify(envelope, null, 2)
      return { serialized, cut: mode === 'cut' }
    },

    beginScenePatchSuppression() {
      scenePatchSuppressionDepth += 1
    },

    endScenePatchSuppression() {
      scenePatchSuppressionDepth = Math.max(0, scenePatchSuppressionDepth - 1)
      if (scenePatchSuppressionDepth > 0) {
        return
      }

      const shouldBumpStructure = pendingSceneGraphStructureVersionBump || pendingSuppressedScenePatchRequiresFullSync
      const shouldBumpNode = pendingSceneNodePropertyVersionBump
      pendingSceneGraphStructureVersionBump = false
      pendingSceneNodePropertyVersionBump = false

      if (pendingSuppressedScenePatchRequiresFullSync) {
        pendingSuppressedScenePatchRequiresFullSync = false
        this.pendingScenePatches = [{ type: 'structure', reason: 'scenePatchSuppressionFlush' }]
      }

      if (shouldBumpStructure) {
        this.sceneGraphStructureVersion += 1
        this.sceneNodePropertyVersion += 1
        return
      }

      if (shouldBumpNode) {
        this.sceneNodePropertyVersion += 1
      }
    },

    async withScenePatchesSuppressed<T>(fn: () => Promise<T> | T): Promise<T> {
      this.beginScenePatchSuppression()
      try {
        return await fn()
      } finally {
        this.endScenePatchSuppression()
      }
    },

    bumpSceneNodePropertyVersion() {
      if (scenePatchSuppressionDepth > 0) {
        pendingSceneNodePropertyVersionBump = true
        return
      }
      this.sceneNodePropertyVersion += 1
    },

    bumpSceneGraphStructureVersion() {
      if (scenePatchSuppressionDepth > 0) {
        pendingSceneGraphStructureVersionBump = true
        pendingSceneNodePropertyVersionBump = true
        return
      }
      this.sceneGraphStructureVersion += 1
      this.sceneNodePropertyVersion += 1
    },

    queueSceneStructurePatch(reason?: string): boolean {
      if (scenePatchSuppressionDepth > 0) {
        pendingSuppressedScenePatchRequiresFullSync = true
        this.bumpSceneGraphStructureVersion()
        return true
      }

      const entry: ScenePatch = { type: 'structure', reason }
      this.pendingScenePatches = [entry]
      this.bumpSceneGraphStructureVersion()
      return true
    },

    queueSceneRemovePatch(ids: string[], reason?: string): boolean {
      if (scenePatchSuppressionDepth > 0) {
        pendingSuppressedScenePatchRequiresFullSync = true
        this.bumpSceneGraphStructureVersion()
        return true
      }

      if (!Array.isArray(ids) || ids.length === 0) {
        return false
      }
      const normalized = Array.from(
        new Set(
          ids
            .filter((id): id is string => typeof id === 'string')
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      ).filter((id) => id !== ENVIRONMENT_NODE_ID)
      if (!normalized.length) {
        return false
      }

      const existing = this.pendingScenePatches
      if (existing.some((patch) => patch.type === 'structure')) {
        // A structure reconcile is already pending; no need to queue incremental removes.
        this.bumpSceneGraphStructureVersion()
        return true
      }

      const removeSet = new Set(normalized)
      let mergedIds = new Set(normalized)
      const next: ScenePatch[] = []

      for (const patch of existing) {
        if (patch.type === 'remove') {
          patch.ids.forEach((id) => mergedIds.add(id))
          continue
        }
        if (patch.type === 'node' && removeSet.has(patch.id)) {
          // Dropping node patches for soon-to-be-removed nodes prevents viewport fallbacks.
          continue
        }
        next.push(patch)
      }

      next.push({ type: 'remove', ids: Array.from(mergedIds), reason })

      this.pendingScenePatches = next
      this.bumpSceneGraphStructureVersion()
      return true
    },

    queueSceneNodePatch(
      nodeId: string,
      fields: ScenePatchField[],
      options: { bumpVersion?: boolean } = {},
    ): boolean {
      const id = typeof nodeId === 'string' ? nodeId.trim() : ''
      if (!id) {
        return false
      }
      const bumpVersion = options.bumpVersion !== false
      const requested = Array.from(new Set(fields)).filter(Boolean)
      if (!requested.length) {
        return false
      }

      if (scenePatchSuppressionDepth > 0) {
        pendingSuppressedScenePatchRequiresFullSync = true
        if (bumpVersion) {
          this.bumpSceneNodePropertyVersion()
        }
        return true
      }
      const existing = this.pendingScenePatches
      if (existing.some((patch) => patch.type === 'structure')) {
        // A structure reconcile is already pending.
        // Still bump version so consumers (viewport/overlays) can refresh from latest store state.
        if (bumpVersion) {
          this.bumpSceneNodePropertyVersion()
        }
        return true
      }

      let changed = false
      const next = existing.map((patch) => {
        if (patch.type !== 'node' || patch.id !== id) {
          return patch
        }
        const merged = Array.from(new Set([...patch.fields, ...requested])) as ScenePatchField[]
        if (merged.length !== patch.fields.length) {
          changed = true
        }
        return { ...patch, fields: merged }
      })

      if (!next.some((patch) => patch.type === 'node' && patch.id === id)) {
        next.push({ type: 'node', id, fields: requested })
        changed = true
      }

      if (!changed) {
        return false
      }

      this.pendingScenePatches = next
      if (bumpVersion) {
        this.bumpSceneNodePropertyVersion()
      }
      return true
    },

    drainScenePatches(): ScenePatch[] {
      const patches = this.pendingScenePatches
      if (!patches.length) {
        return []
      }
      this.pendingScenePatches = []
      return patches
    },

    syncAllNodeComponents() {
      reattachRuntimeObjectsForNodes(this.nodes)
      componentManager.syncScene(this.nodes)
    },

    initialize() {
      if (workspaceScopeStopHandle) {
        return
      }
      const scenesStore = useScenesStore()
      workspaceScopeStopHandle = watch(
        [() => scenesStore.workspaceId, () => scenesStore.workspaceType],
        ([nextId, nextType], [prevId, prevType]) => {
          if (!nextId) {
            return
          }
          const descriptor = {
            id: nextId,
            type: (nextType ?? 'local') as SceneWorkspaceType,
            label: scenesStore.workspaceLabel,
          }
          const previous = {
            id: typeof prevId === 'string' ? (prevId as string) : null,
            type: (prevType as SceneWorkspaceType | undefined) ?? null,
          }
          const run = async () => {
            try {
              await this.applyWorkspaceDescriptor(descriptor, previous)
            } catch (error) {
              console.error('[SceneStore] Failed to switch workspace', error)
            }
          }
          void run()
        },
        { immediate: true },
      )
      watch(
        () => scenesStore.workspaceLabel,
        (label) => {
          if (typeof label === 'string' && label.length) {
            this.workspaceLabel = label
          }
        },
        { immediate: true },
      )
    },
    async applyWorkspaceDescriptor(
      descriptor: { id: string; type: SceneWorkspaceType; label: string },
      previous: { id: string | null; type: SceneWorkspaceType | null } | null,
    ) {
      const isInitial = !previous || !previous.id
      const changed = isInitial || descriptor.id !== this.workspaceId || descriptor.type !== this.workspaceType
      this.workspaceLabel = descriptor.label
      if (!changed) {
        return
      }
      if (!isInitial) {
        try {
          await this.saveActiveScene({ force: true })
        } catch (error) {
          console.warn('[SceneStore] Failed to auto-save before workspace switch', error)
        }
        this.nodes.forEach((node) => releaseRuntimeTree(node))
      }
      this.$reset()
      this.workspaceId = descriptor.id
      this.workspaceType = descriptor.type
      this.workspaceLabel = descriptor.label
    },
    async refreshRuntimeState(options: { showOverlay?: boolean; refreshViewport?: boolean;} = {}) {
      if (runtimeRefreshInFlight) {
        try {
          await runtimeRefreshInFlight
        } catch {
          // swallow previous errors to allow retry
        }
      }

      const task = this.performRuntimeRefresh(this.nodes, options)

      runtimeRefreshInFlight = task
      try {
        await task
      } finally {
        if (runtimeRefreshInFlight === task) {
          runtimeRefreshInFlight = null
        }
      }
    },

    async performRuntimeRefresh(
      nodes: SceneNode[],
      options: { showOverlay?: boolean; refreshViewport?: boolean } = {},
    ) {
      const showOverlay = options.showOverlay ?? false
      const refreshViewport = options.refreshViewport ?? false

      clearRuntimeObjectRegistry()
      componentManager.reset()

      if (!nodes.length) {
        return
      }

      await this.ensureSceneAssetsReady({
        nodes,
        showOverlay,
        refreshViewport,
      })
      this.rebuildGeneratedMeshRuntimes()

      // Some nodes (WarpGate/Guideboard/ViewPoint/DisplayBoard) are procedural and don't have sourceAssetId,
      // so ensure they still get a runtime Object3D during refresh.
      rebuildProceduralRuntimeObjects(nodes, {
        hasRuntimeObject: (nodeId) => runtimeObjectRegistry.has(nodeId),
        registerRuntimeObject,
        tagObjectWithNodeId,
      })

      reattachRuntimeObjectsForNodes(nodes)
      componentManager.syncScene(nodes)
    },

    applySceneDocumentToState(scene: StoredSceneDocument) {
      this.currentSceneId = scene.id
      applyCurrentSceneMeta(this, scene)
      applySceneAssetState(this, scene)
      this.environment = resolveSceneDocumentEnvironment(scene)
      const clonedNodes = cloneSceneNodes(scene.nodes)
      const effectiveGroundSettings = resolveGroundSettingsFromNodes(clonedNodes, cloneGroundSettings(scene.groundSettings))
      const normalizedNodes = ensureEnvironmentNode(
        ensureGroundNode(clonedNodes, effectiveGroundSettings),
        this.environment,
      )
      const normalizedGroundNode = findGroundNode(normalizedNodes)
      if (normalizedGroundNode) {
        // Re-attach runtime sidecars after clone/normalize so hydrated terrain paint
        // remains visible on first scene load after browser refresh.
        attachGroundScatterRuntimeToNode(scene.id, normalizedGroundNode)
        attachGroundPaintRuntimeToNode(scene.id, normalizedGroundNode)
      }
      replaceSceneNodes(this, normalizedNodes)
      this.rebuildGeneratedMeshRuntimes()
      this.planningData = clonePlanningData(scene.planningData)
      this.setSelection([])
      this.camera = cloneCameraState(scene.camera)
      this.viewportSettings = cloneViewportSettings(scene.viewportSettings)
      this.shadowsEnabled = resolveDocumentShadowsEnabled(scene)
      this.panelVisibility = normalizePanelVisibilityState(scene.panelVisibility)
      this.panelPlacement = normalizePanelPlacementStateInput(scene.panelPlacement)
      this.groundSettings = effectiveGroundSettings
      this.resourceProviderId = scene.resourceProviderId ?? 'builtin'
      this.hasUnsavedChanges = false

      this.queueSceneStructurePatch('applySceneDocumentToState')
    },
    createSceneDocumentSnapshot(): StoredSceneDocument {
      normalizeCurrentSceneMeta(this)
      const snapshot = buildSceneDocumentFromState(this)
      return snapshot
    },
    appendUndoEntry(entry: SceneHistoryEntry, options: { resetRedo?: boolean } = {}) {
      const nextUndoStack = [...this.undoStack, entry]
      this.undoStack = nextUndoStack.length > HISTORY_LIMIT
        ? nextUndoStack.slice(nextUndoStack.length - HISTORY_LIMIT)
        : nextUndoStack
      const resetRedo = options.resetRedo ?? true
      if (resetRedo && this.redoStack.length) {
        this.redoStack = []
      }
    },
    captureHistoryEntry(entry: SceneHistoryEntry, options: { resetRedo?: boolean } = {}) {
      if (this.isRestoringHistory) {
        return
      }
      if (historyCaptureSuppressionDepth > 0) {
        return
      }
      this.appendUndoEntry(entry, options)
    },
    captureHistorySnapshot(options: { resetRedo?: boolean } = {}) {
      if (this.isRestoringHistory) {
        return
      }
      if (historyCaptureSuppressionDepth > 0) {
        return
      }
      const entry = createContentHistoryEntry(this)
      this.appendUndoEntry(entry, options)
    },
    captureCoalescedMaterialHistorySnapshot(
      nodeId: string,
      nodeMaterialId: string,
      options: { resetRedo?: boolean } = {},
    ) {
      if (this.isRestoringHistory) {
        return
      }
      if (historyCaptureSuppressionDepth > 0) {
        return
      }
      const key = buildMaterialEditHistoryKey(nodeId, nodeMaterialId)
      if (!key || key === ':') {
        return
      }
      if (!activeMaterialEditHistoryKeys.has(key)) {
        const entry = createContentHistoryEntry(this)
        this.appendUndoEntry(entry, options)
        activeMaterialEditHistoryKeys.add(key)
      }
      scheduleMaterialEditHistoryWindowReset(key)
    },
    captureTransformHistorySnapshot(nodeIds: string[]) {
      if (this.isRestoringHistory) {
        return
      }
      if (historyCaptureSuppressionDepth > 0) {
        return
      }
      const normalized = Array.isArray(nodeIds)
        ? nodeIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : []
      if (!normalized.length) {
        return
      }
      const entry = createTransformHistoryEntry(this, normalized)
      this.appendUndoEntry(entry)
    },
    captureNodeBasicsHistorySnapshot(requests: NodeBasicsHistoryRequest[]) {
      if (this.isRestoringHistory) {
        return
      }
      if (historyCaptureSuppressionDepth > 0) {
        return
      }
      const normalized = Array.isArray(requests)
        ? requests.filter((request): request is NodeBasicsHistoryRequest => Boolean(request && typeof request.id === 'string' && request.id.length))
        : []
      if (!normalized.length) {
        return
      }
      const entry = createNodeBasicsHistoryEntry(this, normalized)
      if (entry.kind !== 'node-basics' || !entry.snapshots.length) {
        return
      }
      this.appendUndoEntry(entry)
    },
    captureNodeStructureHistorySnapshot(ops: SceneHistoryNodeStructureOp[]) {
      if (this.isRestoringHistory) {
        return
      }
      if (historyCaptureSuppressionDepth > 0) {
        return
      }
      const normalized = Array.isArray(ops) ? ops.filter((op): op is SceneHistoryNodeStructureOp => Boolean(op && op.type)) : []
      if (!normalized.length) {
        return
      }
      this.appendUndoEntry({ kind: 'node-structure', ops: normalized })
    },
    captureNodeDynamicMeshHistory(nodeId: string) {
      if (this.isRestoringHistory) {
        return
      }
      if (historyCaptureSuppressionDepth > 0) {
        return
      }
      const entry = createDynamicMeshHistoryEntry(this, nodeId)
      if (entry) {
        this.appendUndoEntry(entry)
      }
    },
    beginHistoryCaptureSuppression() {
      historyCaptureSuppressionDepth += 1
    },
    endHistoryCaptureSuppression() {
      historyCaptureSuppressionDepth = Math.max(0, historyCaptureSuppressionDepth - 1)
    },
    async withHistorySuppressed<T>(fn: () => Promise<T> | T): Promise<T> {
      this.beginHistoryCaptureSuppression()
      try {
        return await fn()
      } finally {
        this.endHistoryCaptureSuppression()
      }
    },
    async undo() {
      if (!this.undoStack.length || this.isRestoringHistory) {
        return false
      }
      const entry = this.undoStack[this.undoStack.length - 1]!
      this.undoStack = this.undoStack.slice(0, -1)

      this.isRestoringHistory = true
      this.activeTransformNodeId = null
      this.transformSnapshotCaptured = false
      try {
        const redoEntry = captureRedoEntryFor(this, entry)
        if (redoEntry) {
          const nextRedoStack = [...this.redoStack, redoEntry]
          this.redoStack = nextRedoStack.length > HISTORY_LIMIT
            ? nextRedoStack.slice(nextRedoStack.length - HISTORY_LIMIT)
            : nextRedoStack
        }

        this.nodes.forEach((node) => releaseRuntimeTree(node))

        applyHistoryEntry(this, entry)
        // Keep excluded state (environment/shadows/etc.) out of undo.
        this.nodes = ensureEnvironmentNode(
          ensureGroundNode(this.nodes, this.groundSettings),
          this.environment,
        )

        // Sanitize selection without recording it in history.
        this.setSelection(this.selectedNodeIds)

        await this.refreshRuntimeState({ showOverlay: false, refreshViewport: false })
        commitSceneSnapshot(this)
        return true
      } finally {
        this.isRestoringHistory = false
      }
    },
    async redo() {
      if (!this.redoStack.length || this.isRestoringHistory) {
        return false
      }
      const entry = this.redoStack[this.redoStack.length - 1]!
      this.redoStack = this.redoStack.slice(0, -1)

      this.isRestoringHistory = true
      this.activeTransformNodeId = null
      this.transformSnapshotCaptured = false
      try {
        const undoEntry = captureRedoEntryFor(this, entry)
        if (undoEntry) {
          this.appendUndoEntry(undoEntry, { resetRedo: false })
        }

        this.nodes.forEach((node) => releaseRuntimeTree(node))

        applyHistoryEntry(this, entry)
        this.nodes = ensureEnvironmentNode(
          ensureGroundNode(this.nodes, this.groundSettings),
          this.environment,
        )

        this.setSelection(this.selectedNodeIds)

        await this.refreshRuntimeState({ showOverlay: false, refreshViewport: false })
        commitSceneSnapshot(this)
        return true
      } finally {
        this.isRestoringHistory = false
      }
    },
    beginTransformInteraction(nodeId: string | null) {
      if (!nodeId) {
        this.activeTransformNodeId = null
        this.transformSnapshotCaptured = false
        return
      }
      if (this.activeTransformNodeId !== nodeId) {
        this.activeTransformNodeId = nodeId
      }
      this.transformSnapshotCaptured = false
    },
    endTransformInteraction() {
      this.activeTransformNodeId = null
      this.transformSnapshotCaptured = false
    },
    setActiveTool(tool: EditorTool) {
      if (!isTransformToolAllowedForSelection(this.nodes, this.selectedNodeIds, tool)) {
        return
      }
      this.activeTool = tool
    },
    modifyGroundRegion(bounds: GroundRegionBounds, transformer: (current: number, row: number, column: number) => number) {
      const groundNode = this.groundNode
      if (!groundNode) {
        return false
      }
      if (groundNode.dynamicMesh?.type !== 'Ground') {
        groundNode.dynamicMesh = createGroundDynamicMeshDefinition({}, this.groundSettings)
      }
      const currentDefinition = resolveGroundRuntimeDefinition(this, groundNode.id)
      if (!currentDefinition) {
        return false
      }

      const result = applyGroundRegionTransform(currentDefinition, bounds, transformer)
      if (!result.changed) {
        return false
      }

      return commitGroundHeightMapRuntimeEdit(
        this,
        groundNode.id,
        currentDefinition,
        result.definition.manualHeightMap,
      )
    },
    raiseGroundRegion(bounds: GroundRegionBounds, amount = 1) {
      const delta = Number.isFinite(amount) ? amount : 1
      return this.modifyGroundRegion(bounds, (current) => current + delta)
    },
    lowerGroundRegion(bounds: GroundRegionBounds, amount = 1) {
      const delta = Number.isFinite(amount) ? -Math.abs(amount) : -1
      return this.modifyGroundRegion(bounds, (current) => current + delta)
    },
    resetGroundRegion(bounds: GroundRegionBounds) {
      return this.modifyGroundRegion(bounds, () => 0)
    },
    setGroundAirWallEnabled(enabled: boolean) {
      const next = enabled === true
      if (this.groundSettings.enableAirWall === next) {
        return false
      }

      this.appendUndoEntry({ kind: 'ground-settings', groundSettings: cloneGroundSettings(this.groundSettings) })

      this.groundSettings = {
        ...this.groundSettings,
        enableAirWall: next,
      }

      commitSceneSnapshot(this)
      return true
    },
    setGroundEditorScatterDynamicStreamingEnabled(enabled: boolean) {
      const next = enabled === true
      if (this.groundSettings.editorScatterDynamicStreamingEnabled === next) {
        return false
      }

      this.appendUndoEntry({ kind: 'ground-settings', groundSettings: cloneGroundSettings(this.groundSettings) })

      this.groundSettings = {
        ...this.groundSettings,
        editorScatterDynamicStreamingEnabled: next,
      }

      commitSceneSnapshot(this)
      return true
    },
    setGroundEditorScatterVisible(visible: boolean) {
      const next = visible === true
      if (this.groundSettings.editorScatterVisible === next) {
        return false
      }

      this.appendUndoEntry({ kind: 'ground-settings', groundSettings: cloneGroundSettings(this.groundSettings) })

      this.groundSettings = {
        ...this.groundSettings,
        editorScatterVisible: next,
      }

      commitSceneSnapshot(this)
      return true
    },
    setGroundDimensions(payload: { width?: number; depth?: number }) {
      const requested = {
        width: payload.width ?? this.groundSettings.width,
        depth: payload.depth ?? this.groundSettings.depth,
      }
      const normalized = cloneGroundSettings(requested)
      if (
        Math.abs(normalized.width - this.groundSettings.width) < 1e-6 &&
        Math.abs(normalized.depth - this.groundSettings.depth) < 1e-6
      ) {
        return false
      }

      // This operation may resize/regenerate ground meshes; use a content snapshot for correctness.
      this.captureHistorySnapshot()

      this.groundSettings = normalized

      const clonedNodes = cloneSceneNodes(this.nodes)
      const existingGround = findGroundNode(clonedNodes)
      if (existingGround) {
        existingGround.dynamicMesh = createGroundDynamicMeshDefinition(
          existingGround.dynamicMesh?.type === 'Ground'
            ? {
                ...(existingGround.dynamicMesh as GroundDynamicMesh),
                width: normalized.width,
                depth: normalized.depth,
              }
            : {
                width: normalized.width,
                depth: normalized.depth,
              },
          normalized,
        )
      }
      const updatedNodes = ensureEnvironmentNode(
        ensureGroundNode(clonedNodes, normalized),
        this.environment,
      )
      this.nodes = updatedNodes

      commitSceneSnapshot(this)
      return true
    },
    setGroundTexture(payload: { dataUrl: string | null; name?: string | null }) {
      const groundNode = this.groundNode
      if (!groundNode) {
        return false
      }
      if (groundNode.dynamicMesh?.type !== 'Ground') {
        groundNode.dynamicMesh = createGroundDynamicMeshDefinition({}, this.groundSettings)
      }
      const definition = groundNode.dynamicMesh as GroundDynamicMesh
      const nextDataUrl = payload.dataUrl ?? null
      const nextName = payload.name ?? null
      if (definition.textureDataUrl === nextDataUrl && definition.textureName === nextName) {
        return false
      }

      this.appendUndoEntry({
        kind: 'ground-texture',
        nodeId: groundNode.id,
        dataUrl: definition.textureDataUrl ?? null,
        name: definition.textureName ?? null,
      })

      groundNode.dynamicMesh = {
        ...definition,
        textureDataUrl: nextDataUrl,
        textureName: nextName,
      }
      this.nodes = [...this.nodes]

      commitSceneSnapshot(this)
      return true
    },
    setEnvironmentSettings(settings: EnvironmentSettings) {
      const normalized = cloneEnvironmentSettings(settings)
      if (environmentSettingsEqual(this.environment, normalized)) {
        return false
      }

      this.environment = normalized
      this.nodes = ensureEnvironmentNode(this.nodes, normalized)
      commitSceneSnapshot(this)
      return true
    },
    patchEnvironmentSettings(patch: EnvironmentSettingsPatch) {
      const current = this.environment
      const merged: EnvironmentSettings = {
        ...current,
        ...patch,
        background: {
          ...current.background,
          ...(patch.background ?? {}),
        },
      }

      // Preserve user-selected HDRI assets across mode changes.
      // Explicit clearing happens only via dedicated actions (e.g., Clear buttons).

      return this.setEnvironmentSettings(merged)
    },
    setSelection(ids: string[], options: { primaryId?: string | null } = {}) {
      const normalized = normalizeSelectionIds(this.nodes, ids)
      const requestedPrimary = options.primaryId ?? null
      const previousPrimary = this.selectedNodeId ?? null
      let nextPrimary: string | null = null
      if (requestedPrimary && normalized.includes(requestedPrimary)) {
        nextPrimary = requestedPrimary
      } else if (previousPrimary && normalized.includes(previousPrimary)) {
        nextPrimary = previousPrimary
      } else {
        nextPrimary = normalized[normalized.length - 1] ?? null
      }
      const primaryChanged = this.selectedNodeId !== nextPrimary
      const selectionChanged = !areSelectionsEqual(normalized, this.selectedNodeIds)
      if (!primaryChanged && !selectionChanged) {
        return false
      }
      this.selectedNodeIds = normalized
      this.selectedNodeId = nextPrimary
      this.activeTool = normalizeInvalidTransformToolForSelection(this.nodes, normalized, this.activeTool)

      if (this.selectedRoadSegment && (normalized.length !== 1 || normalized[0] !== this.selectedRoadSegment.nodeId)) {
        this.selectedRoadSegment = null
      }
      if (this.selectedGuideRouteWaypoint && (normalized.length !== 1 || normalized[0] !== this.selectedGuideRouteWaypoint.nodeId)) {
        this.selectedGuideRouteWaypoint = null
      }
      return true
    },
    setSelectedRoadSegment(nodeId: string, segmentIndex: number | null) {
      const normalizedNodeId = typeof nodeId === 'string' ? nodeId.trim() : ''
      const normalizedIndex = typeof segmentIndex === 'number' && Number.isFinite(segmentIndex)
        ? Math.max(0, Math.floor(segmentIndex))
        : null
      if (!normalizedNodeId || normalizedIndex === null) {
        this.selectedRoadSegment = null
        return
      }
      this.selectedRoadSegment = { nodeId: normalizedNodeId, segmentIndex: normalizedIndex }
    },
    clearSelectedRoadSegment() {
      if (this.selectedRoadSegment) {
        this.selectedRoadSegment = null
      }
    },
    setSelectedGuideRouteWaypoint(nodeId: string, waypointIndex: number | null) {
      const normalizedNodeId = typeof nodeId === 'string' ? nodeId.trim() : ''
      const normalizedIndex = typeof waypointIndex === 'number' && Number.isFinite(waypointIndex)
        ? Math.max(0, Math.floor(waypointIndex))
        : null
      if (!normalizedNodeId || normalizedIndex === null) {
        this.selectedGuideRouteWaypoint = null
        return
      }
      this.selectedGuideRouteWaypoint = { nodeId: normalizedNodeId, waypointIndex: normalizedIndex }
    },
    clearSelectedGuideRouteWaypoint() {
      if (this.selectedGuideRouteWaypoint) {
        this.selectedGuideRouteWaypoint = null
      }
    },
    isGroupExpanded(nodeId: string): boolean {
      const node = findNodeById(this.nodes, nodeId)
      return isGroupExpandedFlag(node)
    },
    getExpandedGroupIds(): string[] {
      return collectExpandedGroupIds(this.nodes)
    },
    setGroupExpanded(nodeId: string, expanded: boolean, _options: { captureHistory?: boolean; commit?: boolean } = {}) {
      const node = findNodeById(this.nodes, nodeId)
      if (!isGroupNode(node)) {
        return false
      }
      const normalized = expanded !== false
      const current = isGroupExpandedFlag(node)
      if (current === normalized) {
        return false
      }
      node.groupExpanded = normalized
      this.queueSceneNodePatch(nodeId, ['groupExpanded'])
      if (!normalized) {
        this.setSelection([...this.selectedNodeIds])
      }
      return true
    },
    syncGroupExpansionState(ids: string[], _options: { captureHistory?: boolean; commit?: boolean } = {}) {
      const targetIds = new Set(ids)
      const assignments: Array<{ node: SceneNode; next: boolean }> = []
      const collectAssignments = (list: SceneNode[]) => {
        list.forEach((node) => {
          if (isGroupNode(node)) {
            const desired = targetIds.has(node.id)
            const current = isGroupExpandedFlag(node)
            if (desired !== current) {
              assignments.push({ node, next: desired })
            }
          }
          if (node.children?.length) {
            collectAssignments(node.children)
          }
        })
      }
      collectAssignments(this.nodes)
      if (!assignments.length) {
        return false
      }
      let selectionNeedsNormalization = false
      assignments.forEach(({ node, next }) => {
        node.groupExpanded = next
        if (!next) {
          selectionNeedsNormalization = true
        }
      })
      let patchQueued = false
      assignments.forEach(({ node }) => {
        patchQueued = this.queueSceneNodePatch(node.id, ['groupExpanded'], { bumpVersion: false }) || patchQueued
      })
      if (patchQueued) {
        this.bumpSceneNodePropertyVersion()
      }
      if (selectionNeedsNormalization) {
        this.setSelection([...this.selectedNodeIds])
      }
      return true
    },
    toggleGroupExpansion(nodeId: string, options: { captureHistory?: boolean; commit?: boolean } = {}) {
      const node = findNodeById(this.nodes, nodeId)
      if (!isGroupNode(node)) {
        return false
      }
      const next = !isGroupExpandedFlag(node)
      return this.setGroupExpanded(nodeId, next, options)
    },
    findParentGroupId(nodeId: string): string | null {
      const parentMap = buildParentMap(this.nodes)
      const nodeLookup = buildNodeLookup(this.nodes)
      return findNearestGroupAncestorId(nodeId, { parentMap, nodeLookup })
    },
    handleNodeDoubleClick(nodeId: string): string[] | null {
      if (!nodeId) {
        return null
      }
      const nodeLookup = buildNodeLookup(this.nodes)
      if (!nodeLookup.has(nodeId)) {
        return null
      }
      const parentMap = buildParentMap(this.nodes)
      const groupId = findNearestGroupAncestorId(nodeId, { parentMap, nodeLookup })
      if (!groupId) {
        return [nodeId]
      }
      const groupNode = nodeLookup.get(groupId)
      if (!isGroupNode(groupNode)) {
        return [nodeId]
      }
      const expanded = isGroupExpandedFlag(groupNode)
      if (!expanded) {
        this.setGroupExpanded(groupId, true, { captureHistory: false })
        return [nodeId]
      }
      if (this.selectedNodeId === nodeId) {
        this.setGroupExpanded(groupId, false, { captureHistory: false })
        return [groupId]
      }
      return [nodeId]
    },
    selectNode(id: string | null) {
      this.setSelection(id ? [id] : [], {primaryId: id })
    },
    selectAllNodes() {
      const allIds = flattenNodeIds(this.nodes)
      this.setSelection(allIds)
    },
    clearSelection() {
      this.setSelection([])
    },
    setDraggingAssetObject(assetObject: Object3D | null) {
      this.draggingAssetObject = assetObject
    },
    setDraggingAssetId(assetId: string | null) {
      this.draggingAssetId = assetId
    },

    setProjectPanelTreeSize(size: number) {
      const normalized = normalizeProjectPanelTreeSize(size)
      if (this.projectPanelTreeSize === normalized) {
        return
      }
      this.projectPanelTreeSize = normalized
    },

  updateNodeTransform(payload: { id: string; position: Vector3Like; rotation: Vector3Like; scale: Vector3Like }) {
      const target = findNodeById(this.nodes, payload.id)
      if (!target) {
        return
      }
      const positionChanged = !vectorsEqual(target.position, payload.position)
      const rotationChanged = !vectorsEqual(target.rotation, payload.rotation)
      const scaleChanged = !vectorsEqual(target.scale, payload.scale)
      if (!positionChanged && !rotationChanged && !scaleChanged) {
        return
      }
      const isActiveTransform = this.activeTransformNodeId === payload.id
      if (isActiveTransform) {
        if (!this.transformSnapshotCaptured) {
          this.captureTransformHistorySnapshot([payload.id])
          this.transformSnapshotCaptured = true
        }
      } else {
        this.captureTransformHistorySnapshot([payload.id])
      }
      visitNode(this.nodes, payload.id, (node) => {
        node.position = cloneVector(payload.position)
        node.rotation = cloneVector(payload.rotation)
        const wantsMirror = (node as any).mirror === 'horizontal' || (node as any).mirror === 'vertical'
        const rawScale = payload.scale
        const hasNegative = (rawScale?.x ?? 0) < 0 || (rawScale?.y ?? 0) < 0 || (rawScale?.z ?? 0) < 0
        node.scale = wantsMirror || hasNegative
          ? {
              x: Math.abs(rawScale?.x ?? 1),
              y: Math.abs(rawScale?.y ?? 1),
              z: Math.abs(rawScale?.z ?? 1),
            }
          : cloneVector(payload.scale)
      })
      const landformRebuilt = rebuildLandformNodeForTerrain(this, payload.id)
      this.queueSceneNodePatch(payload.id, landformRebuilt ? ['transform', 'dynamicMesh'] : ['transform'])
      if (scaleChanged) {
        const updatedNode = findNodeById(this.nodes, payload.id)
        refreshDisplayBoardGeometry(updatedNode)
      }
      commitSceneSnapshot(this)
    },
    updateNodeProperties(payload: TransformUpdatePayload) {
      const target = findNodeById(this.nodes, payload.id)
      if (!target) {
        return
      }
      let changed = false
      let scaleChanged = false
      if (payload.position && !vectorsEqual(target.position, payload.position)) {
        changed = true
      }
      if (payload.rotation && !vectorsEqual(target.rotation, payload.rotation)) {
        changed = true
      }
      if (payload.scale && !vectorsEqual(target.scale, payload.scale)) {
        changed = true
        scaleChanged = true
      }
      if (!changed) {
        return
      }
      const isActiveTransform = this.activeTransformNodeId === payload.id
      if (isActiveTransform) {
        if (!this.transformSnapshotCaptured) {
          this.captureTransformHistorySnapshot([payload.id])
          this.transformSnapshotCaptured = true
        }
      } else {
        this.captureTransformHistorySnapshot([payload.id])
      }
      visitNode(this.nodes, payload.id, (node) => {
        if (payload.position) node.position = cloneVector(payload.position)
        if (payload.rotation) node.rotation = cloneVector(payload.rotation)
        if (payload.scale) {
          const wantsMirror = (node as any).mirror === 'horizontal' || (node as any).mirror === 'vertical'
          const rawScale = payload.scale
          const hasNegative = (rawScale?.x ?? 0) < 0 || (rawScale?.y ?? 0) < 0 || (rawScale?.z ?? 0) < 0
          node.scale = wantsMirror || hasNegative
            ? {
                x: Math.abs(rawScale?.x ?? 1),
                y: Math.abs(rawScale?.y ?? 1),
                z: Math.abs(rawScale?.z ?? 1),
              }
            : cloneVector(payload.scale)
        }
      })
      const landformRebuilt = rebuildLandformNodeForTerrain(this, payload.id)
      this.queueSceneNodePatch(payload.id, landformRebuilt ? ['transform', 'dynamicMesh'] : ['transform'])
      if (scaleChanged) {
        const updatedNode = findNodeById(this.nodes, payload.id)
        refreshDisplayBoardGeometry(updatedNode)
      }
      commitSceneSnapshot(this)
    },
    updateNodeUserData(nodeId: string, userData: Record<string, unknown> | null) {
      const target = findNodeById(this.nodes, nodeId)
      if (!target) {
        return
      }

      this.captureNodeBasicsHistorySnapshot([{ id: nodeId, userData: true }])

      const sanitized = userData && isPlainRecord(userData) ? (clonePlainRecord(userData) ?? null) : null
      visitNode(this.nodes, nodeId, (node) => {
        if (sanitized) {
          node.userData = sanitized
        } else if ('userData' in node) {
          node.userData = null
        }
      })
      this.queueSceneNodePatch(nodeId, ['userData'])
      commitSceneSnapshot(this)
    },

    updateSelectionMirror(mode: 'horizontal' | 'vertical') {
      const normalized = Array.isArray(this.selectedNodeIds)
        ? this.selectedNodeIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : []
      if (!normalized.length) {
        return
      }

      const changedIds: string[] = []
      // Determine which nodes actually change state (toggle behavior).
      normalized.forEach((id) => {
        const node = findNodeById(this.nodes, id)
        if (!node) {
          return
        }
        const existing = (node as any).mirror as unknown
        // We will toggle: if existing === mode => remove mirror, else set to mode
        if (existing === mode || existing === undefined || existing === null || existing !== mode) {
          changedIds.push(id)
        }
      })

      if (!changedIds.length) {
        return
      }

      this.captureNodeBasicsHistorySnapshot(changedIds.map((id) => ({ id, mirror: true })))

      changedIds.forEach((id) => {
        visitNode(this.nodes, id, (node) => {
          const existing = (node as any).mirror as unknown
          if (existing === mode) {
            // toggle off
            if ('mirror' in (node as any)) {
              delete (node as any).mirror
            }
          } else {
            ;(node as any).mirror = mode
          }
        })
        this.queueSceneNodePatch(id, ['mirror'])
      })

      commitSceneSnapshot(this)
    },

    updateNodeInstanceLayout(nodeId: string, instanceLayout: SceneNodeInstanceLayout | null) {
      const target = findNodeById(this.nodes, nodeId)
      if (!target) {
        return
      }

      const sanitized = instanceLayout
        ? ((clonePlainRecord(instanceLayout as unknown as Record<string, unknown>) ?? null) as unknown as SceneNodeInstanceLayout)
        : null

      const existing = (target as any).instanceLayout as unknown
      const existingSerialized = typeof existing === 'undefined' ? null : stableSerialize(existing)
      const nextSerialized = sanitized ? stableSerialize(sanitized) : null
      if (existingSerialized === nextSerialized) {
        return
      }

      const prevMode = typeof (existing as any)?.mode === 'string' && (existing as any).mode === 'grid' ? 'grid' : 'single'
      const nextMode = typeof (sanitized as any)?.mode === 'string' && (sanitized as any).mode === 'grid' ? 'grid' : 'single'
      // Keep world-space geometry stable when toggling layout mode by compensating node position.
      // - single -> grid: keep instance 0 (node binding) in place
      // - grid -> single: keep instance 0 (node binding) in place
      const shouldCompensatePivot = prevMode !== nextMode && (prevMode === 'grid' || nextMode === 'grid')

      this.captureHistorySnapshot()

      visitNode(this.nodes, nodeId, (node) => {
        if (shouldCompensatePivot) {
          const gridLayout =
            nextMode === 'grid' && sanitized && sanitized.mode === 'grid'
              ? sanitized
              : prevMode === 'grid' && (existing as any)?.mode === 'grid'
                ? (existing as SceneNodeInstanceLayout)
                : null

          // Enabling grid shifts locals by -center, so move base by +center.
          // Disabling grid removes that shift, so move base by -center.
          const direction = nextMode === 'grid' ? 1 : -1

          if (gridLayout) {
            const sourceAssetId = typeof (node as any).sourceAssetId === 'string' ? ((node as any).sourceAssetId as string) : null
            const templateAssetId = resolveInstanceLayoutTemplateAssetId(gridLayout, sourceAssetId)
            if (templateAssetId) {
              const cached = getCachedModelObject(templateAssetId)
              const bbox = cached?.boundingBox
              const centerOffsetLocal = computeInstanceLayoutGridCenterOffsetLocal(gridLayout, bbox)
              if (centerOffsetLocal && centerOffsetLocal.lengthSq() > 1e-12) {
                const scale = (node as any).scale as Vector3Like
                const rotation = (node as any).rotation as Vector3Like
                const position = (node as any).position as Vector3Like

                const deltaWorld = centerOffsetLocal
                  .clone()
                  .multiplyScalar(direction)
                  .multiply(new Vector3(scale?.x ?? 1, scale?.y ?? 1, scale?.z ?? 1))
                  .applyEuler(new Euler(rotation?.x ?? 0, rotation?.y ?? 0, rotation?.z ?? 0))

                ;(node as any).position = {
                  x: (position?.x ?? 0) + deltaWorld.x,
                  y: (position?.y ?? 0) + deltaWorld.y,
                  z: (position?.z ?? 0) + deltaWorld.z,
                } as Vector3Like
              }
            }
          }
        }
        if (sanitized) {
          ;(node as any).instanceLayout = sanitized
        } else if ('instanceLayout' in (node as any)) {
          ;(node as any).instanceLayout = null
        }
      })

      this.queueSceneNodePatch(nodeId, ['instanceLayout'])
      if (shouldCompensatePivot) {
        this.queueSceneNodePatch(nodeId, ['transform'])
      }
      commitSceneSnapshot(this)
    },
    updateNodePropertiesBatch(payloads: TransformUpdatePayload[]) {
      if (!Array.isArray(payloads) || payloads.length === 0) {
        return
      }

      const prepared: TransformUpdatePayload[] = []
      const scaleRefreshTargets = new Set<string>()

      payloads.forEach((payload) => {
        if (!payload || !payload.id) {
          return
        }
        const target = findNodeById(this.nodes, payload.id)
        if (!target) {
          return
        }
        let changed = false
        const next: TransformUpdatePayload = { id: payload.id }
        if (payload.position && !vectorsEqual(target.position, payload.position)) {
          next.position = cloneVector(payload.position)
          changed = true
        }
        if (payload.rotation && !vectorsEqual(target.rotation, payload.rotation)) {
          next.rotation = cloneVector(payload.rotation)
          changed = true
        }
        if (payload.scale && !vectorsEqual(target.scale, payload.scale)) {
          next.scale = cloneVector(payload.scale)
          changed = true
          scaleRefreshTargets.add(payload.id)
        }
        if (changed) {
          prepared.push(next)
        }
      })

      if (!prepared.length) {
        return
      }

      const interactsWithActive = this.activeTransformNodeId !== null
        ? prepared.some((update) => update.id === this.activeTransformNodeId)
        : false

      if (interactsWithActive) {
        if (!this.transformSnapshotCaptured) {
          this.captureTransformHistorySnapshot(prepared.map((update) => update.id))
          this.transformSnapshotCaptured = true
        }
      } else {
        this.captureTransformHistorySnapshot(prepared.map((update) => update.id))
      }

      prepared.forEach((update) => {
        visitNode(this.nodes, update.id, (node) => {
          if (update.position) {
            node.position = cloneVector(update.position!)
          }
          if (update.rotation) {
            node.rotation = cloneVector(update.rotation!)
          }
          if (update.scale) {
            node.scale = cloneVector(update.scale!)
          }
        })
      })

      const rebuiltLandformIds: string[] = []
      prepared.forEach((update) => {
        const rebuilt = rebuildLandformNodeForTerrain(this, update.id)
        if (rebuilt) {
          rebuiltLandformIds.push(update.id)
        }
      })

      let patchQueued = false
      prepared.forEach((update) => {
        const isLandformRebuilt = rebuiltLandformIds.includes(update.id)
        patchQueued = this.queueSceneNodePatch(
          update.id,
          isLandformRebuilt ? ['transform', 'dynamicMesh'] : ['transform'],
          { bumpVersion: false },
        ) || patchQueued
      })
      if (patchQueued) {
        this.bumpSceneNodePropertyVersion()
      }
      if (scaleRefreshTargets.size) {
        scaleRefreshTargets.forEach((id) => {
          const updatedNode = findNodeById(this.nodes, id)
          refreshDisplayBoardGeometry(updatedNode)
        })
      }
      commitSceneSnapshot(this)
    },
    updateGroundNodeDynamicMesh(nodeId: string, dynamicMesh: any) {
      const target = findNodeById(this.nodes, nodeId)
      if (!target) return
      if (!isGroundDynamicMeshUpdate(target.dynamicMesh, dynamicMesh)) {
        this.updateNodeDynamicMesh(nodeId, dynamicMesh)
        return
      }
      const incoming = dynamicMesh && typeof dynamicMesh === 'object'
        ? { ...(dynamicMesh as Record<string, unknown>) }
        : dynamicMesh
      let shouldPersistScatterSidecar = false
      let shouldPersistPaintSidecar = false
      if (incoming && typeof incoming === 'object' && this.currentSceneId) {
        if (Object.prototype.hasOwnProperty.call(incoming, 'terrainScatter')) {
          useGroundScatterStore().replaceTerrainScatter(
            this.currentSceneId,
            nodeId,
            manualDeepClone((incoming as Record<string, unknown>).terrainScatter) as TerrainScatterStoreSnapshot | null,
            { reason: 'scene-dynamic-mesh-update' },
          )
          delete (incoming as Record<string, unknown>).terrainScatter
          shouldPersistScatterSidecar = true
        }
        if (Object.prototype.hasOwnProperty.call(incoming, 'groundSurfaceChunks')) {
          const nextGroundSurfaceChunks = manualDeepClone((incoming as Record<string, unknown>).groundSurfaceChunks ?? null) as Parameters<
            ReturnType<typeof useGroundPaintStore>['replaceGroundSurfaceChunks']
          >[2]
          useGroundPaintStore().replaceGroundSurfaceChunks(
            this.currentSceneId,
            nodeId,
            nextGroundSurfaceChunks,
            { reason: 'scene-dynamic-mesh-update' },
          )
          delete (incoming as Record<string, unknown>).groundSurfaceChunks
          shouldPersistPaintSidecar = true
        }
      }
      this.captureNodeDynamicMeshHistory(nodeId)
      if (incoming && typeof incoming === 'object') {
        applySceneNodeDynamicMeshUpdate(this, nodeId, incoming, {
          beforeMerge: (existingRecord, nextIncoming) => {
            prepareGroundDynamicMeshRevision(existingRecord, nextIncoming)
          },
        })
      }
      finalizeDynamicMeshRuntimePatch(this, nodeId, resolveDynamicMeshType(target.dynamicMesh))
      persistGroundHeightSidecarForNode(target)
      if (shouldPersistScatterSidecar) {
        persistGroundScatterSidecarForNode(target)
      }
      if (shouldPersistPaintSidecar) {
        persistGroundPaintSidecarForNode(target)
      }
      commitSceneSnapshot(this)
    },
    commitGroundHeightMapEdit(
      nodeId: string,
      definition: GroundDynamicMesh,
      manualHeightMap: Float64Array,
    ) {
      return commitGroundHeightMapRuntimeEdit(this, nodeId, definition, manualHeightMap)
    },
    refreshGroundOptimizedMesh(nodeId: string) {
      return refreshGroundOptimizedMeshRuntime(this, nodeId)
    },
    async saveGroundDataImmediately(nodeId: string) {
      const target = findNodeById(this.nodes, nodeId)
      const sceneId = typeof this.currentSceneId === 'string'
        ? this.currentSceneId.trim()
        : ''
      if (!target || target.dynamicMesh?.type !== 'Ground' || !sceneId) {
        return false
      }

      const sidecar = useGroundHeightmapStore().buildSceneDocumentSidecar(target)
      await useScenesStore().saveSceneGroundHeightSidecar(sceneId, sidecar, { syncServer: false })
      await this.saveActiveScene({ force: true })
      return true
    },
    commitGroundScatterEdit(
      nodeId: string,
      terrainScatter: TerrainScatterStoreSnapshot | null,
    ) {
      return commitGroundScatterRuntimeEdit(this, nodeId, terrainScatter)
    },
    commitGroundPaintEdit(
      nodeId: string,
      groundSurfaceChunks: GroundDynamicMesh['groundSurfaceChunks'],
    ) {
      return commitGroundPaintRuntimeEdit(this, nodeId, groundSurfaceChunks)
    },
    updateNodeDynamicMesh(nodeId: string, dynamicMesh: any) {
      const target = findNodeById(this.nodes, nodeId)
      if (!target) return
      if (isGroundDynamicMeshUpdate(target.dynamicMesh, dynamicMesh)) {
        this.updateGroundNodeDynamicMesh(nodeId, dynamicMesh)
        return
      }

      this.captureNodeDynamicMeshHistory(nodeId)

      applySceneNodeDynamicMeshUpdate(this, nodeId, dynamicMesh)
      finalizeDynamicMeshRuntimePatch(this, nodeId, resolveDynamicMeshType(target.dynamicMesh))
      commitSceneSnapshot(this)
    },
    setNodeLocked(nodeId: string, locked: boolean) {
      const target = findNodeById(this.nodes, nodeId)
      if (!target) return
      visitNode(this.nodes, nodeId, (node) => {
        node.locked = locked
      })
      this.queueSceneNodePatch(nodeId, ['lock'])
    },
    renameNode(id: string, name: string) {
      const trimmed = name.trim()
      if (!trimmed) {
        return
      }
      const target = findNodeById(this.nodes, id)
      if (!target || target.name === trimmed) {
        return
      }
      this.captureNodeBasicsHistorySnapshot([{ id, name: true }])
      visitNode(this.nodes, id, (node) => {
        node.name = trimmed
      })
      this.queueSceneNodePatch(id, ['name'])
      commitSceneSnapshot(this)
    },
    addNodeMaterial(
      nodeId: string,
      options: { props?: Partial<SceneMaterialProps> | null; name?: string; type?: SceneMaterialType } = {},
    ) {
      const target = findNodeById(this.nodes, nodeId)
      if (!nodeSupportsMaterials(target)) {
        return null
      }

      const baseProps = createMaterialProps(options.props ?? null)

      let created: SceneNodeMaterial | null = null
      let requiresDynamicMeshPatch = false
      this.captureHistorySnapshot()
      visitNode(this.nodes, nodeId, (node) => {
        if (!nodeSupportsMaterials(node)) {
          return
        }
        const existingCount = node.materials?.length ?? 0
        const fallbackName = options.name?.trim() || `Material ${existingCount + 1}`
        const entry = createNodeMaterial(baseProps, {
          name: fallbackName,
          type: options.type ?? DEFAULT_SCENE_MATERIAL_TYPE,
        })
        node.materials = [...(node.materials ?? []), entry]
        const floorConvention = floorHelpers.ensureFloorMaterialConvention(node)
        const wallConvention = wallHelpers.ensureWallMaterialConvention(node)
        const landformConvention = landformHelpers.ensureLandformMaterialConvention(node)
        if (floorConvention.meshChanged || wallConvention.meshChanged || landformConvention.meshChanged) {
          requiresDynamicMeshPatch = true
        }
        created = entry
      })

      if (!created) {
        return null
      }

      this.queueSceneNodePatch(nodeId, ['materials'])
      if (requiresDynamicMeshPatch) {
        this.queueSceneNodePatch(nodeId, ['dynamicMesh'])
      }
      commitSceneSnapshot(this)
      return created
    },
    setNodePrimaryTexture(
      nodeId: string,
      ref: SceneMaterialTextureRef | null,
      slot: SceneMaterialTextureSlot = 'albedo',
    ): boolean {
      const target = findNodeById(this.nodes, nodeId)
      if (!target || !nodeSupportsMaterials(target)) {
        return false
      }

      let primary = target.materials?.[0] ?? null
      if (!primary) {
        primary = this.addNodeMaterial(nodeId)
      }

      if (!primary) {
        return false
      }

      const current = primary.textures?.[slot] ?? null
      if (!ref && !current) {
        return true
      }
      if (ref && current && current.assetId === ref.assetId && current.name === ref.name) {
        return true
      }

      const texturesUpdate: Partial<Record<SceneMaterialTextureSlot, SceneMaterialTextureRef | null>> = {
        [slot]: ref,
      }
      this.updateNodeMaterialProps(nodeId, primary.id, { textures: texturesUpdate })
      return true
    },
    removeNodeMaterial(nodeId: string, nodeMaterialId: string) {
      const target = findNodeById(this.nodes, nodeId)
      if (!target || !nodeSupportsMaterials(target) || !target.materials?.length) {
        return false
      }
      if (!target.materials.some((entry) => entry.id === nodeMaterialId)) {
        return false
      }

      this.captureHistorySnapshot()
      let removed = false
      let requiresDynamicMeshPatch = false
      visitNode(this.nodes, nodeId, (node) => {
        if (!nodeSupportsMaterials(node) || !node.materials?.length) {
          return
        }
        const nextMaterials = node.materials.filter((entry) => entry.id !== nodeMaterialId)
        if (nextMaterials.length !== node.materials.length) {
          if (!nextMaterials.length) {
            const baseMaterial = findDefaultSceneMaterial(this.materials)
            const defaultProps = baseMaterial ? createMaterialProps(baseMaterial) : createMaterialProps()
            const defaultMaterial = createNodeMaterial(defaultProps, {
              name: baseMaterial?.name,
              type: baseMaterial?.type ?? DEFAULT_SCENE_MATERIAL_TYPE,
            })
            node.materials = [defaultMaterial]
          } else {
            node.materials = nextMaterials
          }
          removed = true

          const floorResult = floorHelpers.ensureFloorMaterialConvention(node)
          const wallResult = wallHelpers.ensureWallMaterialConvention(node)
          const landformResult = landformHelpers.ensureLandformMaterialConvention(node)
          if (floorResult.meshChanged || wallResult.meshChanged || landformResult.meshChanged) {
            requiresDynamicMeshPatch = true
          }
        }
      })

      if (!removed) {
        return false
      }

      this.queueSceneNodePatch(nodeId, ['materials'])
      if (requiresDynamicMeshPatch) {
        this.queueSceneNodePatch(nodeId, ['dynamicMesh'])
      }
      commitSceneSnapshot(this)
      return true
    },
    updateNodeMaterialProps(nodeId: string, nodeMaterialId: string, update: Partial<SceneMaterialProps>) {
      const overrides = materialUpdateToProps(update)
      if (!Object.keys(overrides).length) {
        return
      }

      let updated = false
      let requiresDynamicMeshPatch = false
      this.captureCoalescedMaterialHistorySnapshot(nodeId, nodeMaterialId)
      visitNode(this.nodes, nodeId, (node) => {
        if (!nodeSupportsMaterials(node) || !node.materials?.length) {
          return
        }
        node.materials = node.materials.map((entry) => {
          if (entry.id !== nodeMaterialId) {
            return entry
          }
          updated = true
          const mergedProps = mergeMaterialProps(entry, overrides)
          return createNodeMaterial(mergedProps, {
            id: entry.id,
            name: entry.name,
            type: entry.type,
          })
        })
        const landformResult = landformHelpers.ensureLandformMaterialConvention(node)
        requiresDynamicMeshPatch ||= landformResult.meshChanged
      })

      if (!updated) {
        return
      }

      this.queueSceneNodePatch(nodeId, ['materials'])
      if (requiresDynamicMeshPatch) {
        this.queueSceneNodePatch(nodeId, ['dynamicMesh'])
      }
      commitSceneSnapshot(this)
    },
    updateNodeMaterialType(nodeId: string, nodeMaterialId: string, type: SceneMaterialType) {
      let updated = false
      let requiresDynamicMeshPatch = false
      this.captureHistorySnapshot()
      visitNode(this.nodes, nodeId, (node) => {
        if (!nodeSupportsMaterials(node) || !node.materials?.length) {
          return
        }
        node.materials = node.materials.map((entry) => {
          if (entry.id !== nodeMaterialId) {
            return entry
          }
          updated = true
          return createNodeMaterial(entry, {
            id: entry.id,
            name: entry.name,
            type: type,
          })
        })
        const landformResult = landformHelpers.ensureLandformMaterialConvention(node)
        requiresDynamicMeshPatch ||= landformResult.meshChanged
      })

      if (!updated) {
        return false
      }

      this.queueSceneNodePatch(nodeId, ['materials'])
      if (requiresDynamicMeshPatch) {
        this.queueSceneNodePatch(nodeId, ['dynamicMesh'])
      }
      commitSceneSnapshot(this)
      return true
    },
    assignNodeMaterial(nodeId: string, nodeMaterialId: string, materialId: string | null) {
      const source = materialId ? this.materials.find((entry) => entry.id === materialId) ?? null : null
      if (materialId && !source) {
        return false
      }

      let updated = false
      let requiresDynamicMeshPatch = false
      this.captureHistorySnapshot()
      visitNode(this.nodes, nodeId, (node) => {
        if (!nodeSupportsMaterials(node) || !node.materials?.length) {
          return
        }
        node.materials = node.materials.map((entry, index) => {
          if (entry.id !== nodeMaterialId) {
            return entry
          }
          updated = true
          if (source) {
            return createNodeMaterial(source, {
              id: entry.id,
              name: source.name,
              type: source.type,
            })
          }
          const currentProps = extractMaterialProps(entry)
          const fallbackName = entry.name ?? `Material ${index + 1}`
          return createNodeMaterial(currentProps, {
            id: entry.id,
            name: fallbackName,
            type: entry.type,
          })
        })
        const floorResult = floorHelpers.ensureFloorMaterialConvention(node)
        const wallResult = wallHelpers.ensureWallMaterialConvention(node)
        const landformResult = landformHelpers.ensureLandformMaterialConvention(node)
        if (floorResult.meshChanged || wallResult.meshChanged || landformResult.meshChanged) {
          requiresDynamicMeshPatch = true
        }
      })

      if (!updated) {
        return false
      }

      this.queueSceneNodePatch(nodeId, ['materials'])
      if (requiresDynamicMeshPatch) {
        this.queueSceneNodePatch(nodeId, ['dynamicMesh'])
      }
      commitSceneSnapshot(this)
      return true
    },
    setNodeMaterials(nodeId: string, materials: SceneNodeMaterial[]): boolean {
      if (!materials?.length) {
        return false
      }

      const clones = cloneNodeMaterials(materials)
      let updated = false
      let requiresDynamicMeshPatch = false
      this.captureHistorySnapshot()
      visitNode(this.nodes, nodeId, (node) => {
        if (!nodeSupportsMaterials(node)) {
          return
        }
        node.materials = clones
        const floorResult = floorHelpers.ensureFloorMaterialConvention(node)
        const wallResult = wallHelpers.ensureWallMaterialConvention(node)
        const landformResult = landformHelpers.ensureLandformMaterialConvention(node)
        if (floorResult.meshChanged || wallResult.meshChanged || landformResult.meshChanged) {
          requiresDynamicMeshPatch = true
        }
        updated = true
      })

      if (!updated) {
        return false
      }

      this.queueSceneNodePatch(nodeId, ['materials'])
      if (requiresDynamicMeshPatch) {
        this.queueSceneNodePatch(nodeId, ['dynamicMesh'])
      }
      commitSceneSnapshot(this)
      return true
    },
    async syncLocalMaterialDependencyRegistryEntries(materialId: string): Promise<void> {
      const material = this.materials.find((entry) => entry.id === materialId)
      if (!material) {
        return
      }
      const nextEntries: Record<string, SceneAssetRegistryEntry> = {}
      collectMaterialAssetDependencyIds(material).forEach((assetId) => {
        const asset = this.getAsset(assetId)
        if (!asset) {
          return
        }
        const entry = buildRegistryEntryFromSource(asset, asset.source)
        if (entry) {
          nextEntries[assetId] = entry
        }
      })
      if (!Object.keys(nextEntries).length) {
        return
      }
      this.assetRegistry = upsertAssetRegistryEntries(this.assetRegistry, nextEntries)
    },
    async ensureMaterialAssetDefinitionLoaded(materialAssetId: string): Promise<SceneMaterial | null> {
      const normalizedAssetId = typeof materialAssetId === 'string' ? materialAssetId.trim() : ''
      if (!normalizedAssetId) {
        return null
      }

      const existing = this.materials.find((entry) => entry.id === normalizedAssetId) ?? null
      if (existing) {
        return existing
      }

      const asset = this.getAsset(normalizedAssetId)
      if (!asset || asset.type !== 'material') {
        return null
      }

      const fileText = await loadConfigAssetTextForDependencyTraversal(normalizedAssetId, this.assetCatalog)
      if (!fileText) {
        return null
      }

      let parsed: ReturnType<typeof parseMaterialAssetDocument>
      try {
        parsed = parseMaterialAssetDocument(JSON.parse(fileText) as unknown)
      } catch (error) {
        console.warn('Failed to parse material asset file', normalizedAssetId, error)
        return null
      }
      if (!parsed) {
        return null
      }

      const materialDependencyAssetIds = collectMaterialAssetDependencyIds(parsed.props)
      if (materialDependencyAssetIds.length) {
        try {
          await this.ensurePrefabDependencies(materialDependencyAssetIds, {
            prefabAssetIdForDownloadProgress: normalizedAssetId,
            prefabAssetRegistry: parsed.assetRegistry ?? null,
          })
        } catch (error) {
          console.warn('Failed to hydrate material asset dependencies', normalizedAssetId, error)
        }
      }

      const now = new Date().toISOString()
      const material: SceneMaterial = {
        id: normalizedAssetId,
        name: parsed.name?.trim() || asset.name || `Material ${this.materials.length + 1}`,
        description: parsed.description ?? asset.description,
        type: parsed.type ?? DEFAULT_SCENE_MATERIAL_TYPE,
        createdAt: now,
        updatedAt: now,
        ...parsed.props,
      }
      this.materials = [...this.materials, material]

      if (parsed.assetRegistry) {
        this.assetRegistry = upsertAssetRegistryEntries(this.assetRegistry, parsed.assetRegistry)
      }
      await this.syncLocalMaterialDependencyRegistryEntries(normalizedAssetId)
      return material
    },
    async applyMaterialAssetToNodeMaterialSlot(
      nodeId: string,
      nodeMaterialId: string,
      materialAssetId: string,
    ): Promise<SceneNodeMaterial | null> {
      const normalizedAssetId = typeof materialAssetId === 'string' ? materialAssetId.trim() : ''
      if (!normalizedAssetId) {
        return null
      }

      const targetNode = findNodeById(this.nodes, nodeId)
      if (!targetNode || !nodeSupportsMaterials(targetNode) || !targetNode.materials?.length) {
        return null
      }

      const material = await this.ensureMaterialAssetDefinitionLoaded(normalizedAssetId)
      if (!material) {
        return null
      }

      let updated = false
      let requiresDynamicMeshPatch = false
      let appliedEntry: SceneNodeMaterial | null = null

      this.captureHistorySnapshot()
      visitNode(this.nodes, nodeId, (node) => {
        if (!nodeSupportsMaterials(node) || !node.materials?.length) {
          return
        }
        node.materials = node.materials.map((entry, index) => {
          if (entry.id !== nodeMaterialId) {
            return entry
          }
          updated = true
          const fallbackName = entry.name?.trim() || `Material ${index + 1}`
          const resolvedName = material.name?.trim() || fallbackName
          const nextEntry = createNodeMaterial(material, {
            id: entry.id,
            name: resolvedName,
            type: material.type ?? entry.type ?? DEFAULT_SCENE_MATERIAL_TYPE,
          })
          appliedEntry = nextEntry
          return nextEntry
        })
        const floorResult = floorHelpers.ensureFloorMaterialConvention(node)
        const wallResult = wallHelpers.ensureWallMaterialConvention(node)
        const landformResult = landformHelpers.ensureLandformMaterialConvention(node)
        if (floorResult.meshChanged || wallResult.meshChanged || landformResult.meshChanged) {
          requiresDynamicMeshPatch = true
        }
      })

      if (!updated || !appliedEntry) {
        return null
      }

      this.queueSceneNodePatch(nodeId, ['materials'])
      if (requiresDynamicMeshPatch) {
        this.queueSceneNodePatch(nodeId, ['dynamicMesh'])
      }
      commitSceneSnapshot(this)

      const refreshedNode = findNodeById(this.nodes, nodeId)
      if (refreshedNode) {
        try {
          await this.ensureSceneAssetsReady({
            nodes: [refreshedNode],
            showOverlay: false,
            refreshViewport: true,
          })
        } catch (error) {
          console.warn('Failed to prepare material asset dependencies for node material slot', {
            nodeId,
            nodeMaterialId,
            materialAssetId: normalizedAssetId,
            error,
          })
        }
      }

      this.queueSceneNodePatch(nodeId, ['materials'])
      return appliedEntry
    },
    resetNodeMaterialSlotToDefault(nodeId: string, nodeMaterialId: string): SceneNodeMaterial | null {
      const targetNode = findNodeById(this.nodes, nodeId)
      if (!targetNode || !nodeSupportsMaterials(targetNode) || !targetNode.materials?.length) {
        return null
      }

      const defaultMaterial = findDefaultSceneMaterial(this.materials)
      const defaultProps = defaultMaterial ? createMaterialProps(defaultMaterial) : createMaterialProps()

      let updated = false
      let requiresDynamicMeshPatch = false
      let resetEntry: SceneNodeMaterial | null = null

      this.captureHistorySnapshot()
      visitNode(this.nodes, nodeId, (node) => {
        if (!nodeSupportsMaterials(node) || !node.materials?.length) {
          return
        }
        node.materials = node.materials.map((entry, index) => {
          if (entry.id !== nodeMaterialId) {
            return entry
          }
          updated = true
          const fallbackName = entry.name?.trim() || `Material ${index + 1}`
          const nextEntry = createNodeMaterial(defaultProps, {
            id: entry.id,
            name: defaultMaterial?.name?.trim() || fallbackName,
            type: defaultMaterial?.type ?? DEFAULT_SCENE_MATERIAL_TYPE,
          })
          resetEntry = nextEntry
          return nextEntry
        })
        const floorResult = floorHelpers.ensureFloorMaterialConvention(node)
        const wallResult = wallHelpers.ensureWallMaterialConvention(node)
        const landformResult = landformHelpers.ensureLandformMaterialConvention(node)
        if (floorResult.meshChanged || wallResult.meshChanged || landformResult.meshChanged) {
          requiresDynamicMeshPatch = true
        }
      })

      if (!updated || !resetEntry) {
        return null
      }

      this.queueSceneNodePatch(nodeId, ['materials'])
      if (requiresDynamicMeshPatch) {
        this.queueSceneNodePatch(nodeId, ['dynamicMesh'])
      }
      commitSceneSnapshot(this)
      return resetEntry
    },
    async syncLocalMaterialAsset(materialId: string): Promise<ProjectAsset | null> {
      const material = this.materials.find((entry) => entry.id === materialId)
      if (!material) {
        return null
      }

      const dependencyAssetIds = collectMaterialAssetDependencyIds(material)
      const dependencySubset = dependencyAssetIds.length
        ? buildAssetDependencySubset({
            assetIds: dependencyAssetIds,
            assetRegistry: this.assetRegistry,
          })
        : {}
      const serialized = serializeMaterialAsset(material, {
        assetRegistry: dependencySubset.assetRegistry,
      })
      const fileName = buildMaterialAssetFilename(material.name)
      const blob = new Blob([serialized], { type: 'application/json' })
      const assetCache = useAssetCacheStore()
      await assetCache.storeAssetBlob(material.id, {
        blob,
        mimeType: 'application/json',
        filename: fileName,
      })

      const existingAsset = this.getAsset(material.id)
      let thumbnailDataUrl = existingAsset?.thumbnail ?? null
      try {
        thumbnailDataUrl = await renderMaterialThumbnailDataUrl({
          material,
          resolveTexture: createMaterialAssetTextureResolver({
            assetCacheStore: assetCache,
            getAsset: (assetId: string) => this.getAsset(assetId),
          }),
          width: ASSET_THUMBNAIL_WIDTH,
          height: ASSET_THUMBNAIL_HEIGHT,
        })
      } catch (error) {
        console.warn('Failed to generate material thumbnail', material.id, error)
      }

      const asset = buildLocalMaterialProjectAsset(material, {
        existingAsset,
        thumbnail: thumbnailDataUrl,
      })
      const registered = this.registerAsset(asset, {
        categoryId: determineAssetCategoryId(asset),
        source: existingAsset?.source ?? { type: 'local' },
        commitOptions: { updateNodes: false },
        autoSave: false,
      })

      await this.syncLocalMaterialDependencyRegistryEntries(material.id)
      return registered
    },
    findMaterialAssetByFilenameInDirectory(filename: string, directoryId?: string | null): ProjectAsset | null {
      const normalized = buildMaterialAssetFilename(filename).trim().toLowerCase()
      if (!normalized.length) {
        return null
      }

      const targetDirectoryId = typeof directoryId === 'string' && directoryId.trim().length
        ? directoryId.trim()
        : this.resolveConfigAssetSaveDirectoryId()
      const manifest = this.assetManifest
      if (manifest) {
        const resolvedDirectoryId = manifest.directoriesById[targetDirectoryId]
          ? targetDirectoryId
          : this.resolveConfigAssetSaveDirectoryId()
        const directory = manifest.directoriesById[resolvedDirectoryId]
        if (!directory) {
          return null
        }
        for (const assetId of directory.assetIds) {
          const asset = this.getAsset(assetId)
          if (!asset || asset.type !== 'material') {
            continue
          }
          const description = typeof asset.description === 'string' ? asset.description.trim().toLowerCase() : ''
          if (description === normalized) {
            return asset
          }
        }
        return null
      }

      const categories = Object.values(this.assetCatalog ?? {})
      for (const assets of categories) {
        if (!Array.isArray(assets)) {
          continue
        }
        for (const asset of assets) {
          if (!asset || asset.type !== 'material') {
            continue
          }
          const description = typeof asset.description === 'string' ? asset.description.trim().toLowerCase() : ''
          if (description === normalized) {
            return asset
          }
        }
      }

      return null
    },
    async saveNodeMaterialAsset(payload: {
      nodeId?: string | null
      nodeMaterialId?: string | null
      assetId?: string | null
      select?: boolean
    }): Promise<ProjectAsset> {
      const nodeId = (payload.nodeId ?? this.selectedNodeId ?? '').trim()
      if (!nodeId) {
        throw new Error('未选择材质节点')
      }

      const node = findNodeById(this.nodes, nodeId)
      if (!node || !nodeSupportsMaterials(node) || !node.materials?.length) {
        throw new Error('当前节点没有可保存的材质')
      }

      const materialId = typeof payload.nodeMaterialId === 'string' ? payload.nodeMaterialId.trim() : ''
      if (!materialId) {
        throw new Error('未选择材质槽位')
      }

      const materialIndex = node.materials.findIndex((entry) => entry.id === materialId)
      const nodeMaterial = materialIndex >= 0 ? node.materials[materialIndex] ?? null : null
      if (!nodeMaterial) {
        throw new Error('材质槽位不存在或已被移除')
      }

      const resolvedName = nodeMaterial.name?.trim() || `Material ${materialIndex + 1}`
      const fileName = buildMaterialAssetFilename(resolvedName)
      const dependencyAssetIds = collectMaterialAssetDependencyIds(nodeMaterial)
      const dependencySubset = dependencyAssetIds.length
        ? buildAssetDependencySubset({
            assetIds: dependencyAssetIds,
            assetRegistry: this.assetRegistry,
          })
        : {}
      const serialized = serializeMaterialAsset({
        ...nodeMaterial,
        name: resolvedName,
        description: undefined,
        type: nodeMaterial.type ?? DEFAULT_SCENE_MATERIAL_TYPE,
      }, {
        assetRegistry: dependencySubset.assetRegistry,
      })

      const targetDirectoryId = this.resolveConfigAssetSaveDirectoryId()
      const assetId = typeof payload.assetId === 'string' && payload.assetId.trim().length
        ? payload.assetId.trim()
        : generateUuid()
      const existingAsset = payload.assetId ? this.getAsset(assetId) : null
      if (payload.assetId && !existingAsset) {
        throw new Error('材质资源不存在')
      }
      if (existingAsset && existingAsset.type !== 'material') {
        throw new Error('指定资源并非材质资产')
      }

      const blob = new Blob([serialized], { type: 'application/json' })
      const assetCache = useAssetCacheStore()
      await assetCache.storeAssetBlob(assetId, {
        blob,
        mimeType: 'application/json',
        filename: fileName,
      })

      let thumbnailDataUrl = existingAsset?.thumbnail ?? null
      try {
        thumbnailDataUrl = await renderMaterialThumbnailDataUrl({
          material: {
            ...nodeMaterial,
            name: resolvedName,
            type: nodeMaterial.type ?? DEFAULT_SCENE_MATERIAL_TYPE,
          },
          resolveTexture: createMaterialAssetTextureResolver({
            assetCacheStore: assetCache,
            getAsset: (textureAssetId: string) => this.getAsset(textureAssetId),
          }),
          width: ASSET_THUMBNAIL_WIDTH,
          height: ASSET_THUMBNAIL_HEIGHT,
        })
      } catch (error) {
        console.warn('Failed to generate material thumbnail', assetId, error)
      }

      if (dependencySubset.assetRegistry) {
        this.assetRegistry = upsertAssetRegistryEntries(this.assetRegistry, dependencySubset.assetRegistry)
      }

      const previewColor = typeof nodeMaterial.color === 'string' && nodeMaterial.color.trim().length
        ? nodeMaterial.color
        : existingAsset?.previewColor ?? '#607d8b'
      const projectAsset: ProjectAsset = {
        ...(existingAsset ?? {}),
        id: assetId,
        name: resolvedName,
        type: 'material',
        downloadUrl: existingAsset?.downloadUrl ?? `material://${assetId}.material`,
        previewColor,
        thumbnail: thumbnailDataUrl ?? existingAsset?.thumbnail ?? null,
        description: fileName,
        gleaned: true,
        extension: extractExtension(fileName) ?? 'material',
      }

      const registered = this.registerAsset(projectAsset, {
        categoryId: targetDirectoryId,
        source: existingAsset?.source ?? { type: 'local' },
        commitOptions: { updateNodes: false },
      })

      if (payload.select === true) {
        this.selectAsset(registered.id)
      }

      return registered
    },
    async saveNodeMaterialAsShared(
      nodeId: string,
      nodeMaterialId: string,
      options: { name?: string; description?: string } = {},
    ): Promise<SceneMaterial | null> {
      void nodeId
      void nodeMaterialId
      void options
      return null
    },
    updateNodeMaterialMetadata(nodeId: string, nodeMaterialId: string, metadata: { name?: string | null }) {
      const rawName = metadata.name
      const trimmedName = typeof rawName === 'string' ? rawName.trim() : rawName

      let updated = false
      this.captureCoalescedMaterialHistorySnapshot(nodeId, nodeMaterialId)
      visitNode(this.nodes, nodeId, (node) => {
        if (!nodeSupportsMaterials(node) || !node.materials?.length) {
          return
        }
        node.materials = node.materials.map((entry) => {
          if (entry.id !== nodeMaterialId) {
            return entry
          }
          updated = true
          const currentProps = extractMaterialProps(entry)
          return createNodeMaterial(currentProps, {
            id: entry.id,
            name: trimmedName && trimmedName.length ? trimmedName : undefined,
            type: entry.type,
          })
        })
      })

      if (!updated) {
        return
      }

      this.queueSceneNodePatch(nodeId, ['materials'])
      commitSceneSnapshot(this)
    },
    createMaterial(payload: { name?: string; props?: Partial<SceneMaterialProps> | null } = {}) {
      const material = createSceneMaterial(payload.name ?? 'New Material', payload.props ?? undefined)
      this.materials = [...this.materials, material]
      commitSceneSnapshot(this, { updateNodes: false })
      return material
    },
    duplicateMaterial(materialId: string) {
      const source = this.materials.find((entry) => entry.id === materialId)
      if (!source) {
        return null
      }
      const duplicated = createSceneMaterial(`${source.name} Copy`, source)
      duplicated.description = source.description
      this.materials = [...this.materials, duplicated]
      commitSceneSnapshot(this, { updateNodes: false })
      return duplicated
    },
    async updateMaterialDefinition(materialId: string, update: Partial<SceneMaterialProps> & { name?: string; description?: string; type?: SceneMaterialType }) {
      const existingIndex = this.materials.findIndex((entry) => entry.id === materialId)
      if (existingIndex === -1) {
        return false
      }

      const current = this.materials[existingIndex]!
      const overrides = materialUpdateToProps(update)
      const hasPropChanges = Object.keys(overrides).length > 0
      const trimmedName = typeof update.name === 'string' ? update.name.trim() : undefined
      const nameChanged = trimmedName !== undefined && trimmedName.length > 0 && trimmedName !== current.name
      const descriptionChanged = update.description !== undefined && update.description !== current.description
      const nextType = update.type ?? current.type
      const typeChanged = nextType !== current.type

      if (!hasPropChanges && !nameChanged && !descriptionChanged && !typeChanged) {
        return false
      }

      const nextProps = mergeMaterialProps(current, overrides)
      const nextMaterial: SceneMaterial = {
        ...current,
        ...nextProps,
        id: current.id,
        name: nameChanged && trimmedName ? trimmedName : current.name,
        description: update.description !== undefined ? update.description : current.description,
        updatedAt: new Date().toISOString(),
        createdAt: current.createdAt,
        type: nextType,
      }

      this.captureHistorySnapshot()
      const nextList = [...this.materials]
      nextList.splice(existingIndex, 1, nextMaterial)
      this.materials = nextList

      await this.syncLocalMaterialAsset(materialId)

      commitSceneSnapshot(this, { updateNodes: false })
      return true
    },
    deleteMaterial(materialId: string, options: { fallbackMaterialId?: string | null } = {}) {
      if (!materialId) {
        return false
      }
      const index = this.materials.findIndex((entry) => entry.id === materialId)
      if (index === -1) {
        return false
      }

      const fallbackId = options.fallbackMaterialId ?? this.materials.find((entry) => entry.id !== materialId)?.id ?? null
      const fallbackMaterial = fallbackId ? this.materials.find((entry) => entry.id === fallbackId) ?? null : null

      const nextMaterials = [...this.materials]
      nextMaterials.splice(index, 1)
      this.materials = nextMaterials

      void fallbackMaterial
      commitSceneSnapshot(this, { updateNodes: false })
      return true
    },
    updateLightProperties(
      id: string,
      properties: Partial<LightNodeProperties>,
      options: { captureHistory?: boolean } = {},
    ) {
      const target = findNodeById(this.nodes, id)
      if (!target || !target.light) {
        return
      }
      if (options.captureHistory !== false) {
        this.captureHistorySnapshot()
      }
      visitNode(this.nodes, id, (node) => {
        if (!node.light) {
          return
        }
        const next: LightNodeProperties = {
          ...node.light,
          ...properties,
        }

        if (properties.shadow) {
          next.shadow = {
            ...(node.light?.shadow ?? {}),
            ...properties.shadow,
          }
        }
        if (properties.target) {
          next.target = cloneVector(properties.target)
        } else if (properties.target === null) {
          next.target = undefined
        }
        node.light = next
      })
      this.queueSceneNodePatch(id, ['light'])
      commitSceneSnapshot(this)
    },
    isNodeLocallyVisible(id: string) {
      const node = findNodeById(this.nodes, id)
      return node?.visible ?? true
    },
    isNodeVisible(id: string) {
      if (!id) {
        return true
      }
      ensureSceneNodeIndex(this)
      let currentId: string | null = id
      while (currentId) {
        const node = sceneNodeIndex.nodeById.get(currentId) ?? null
        if (node && (node.visible ?? true) === false) {
          return false
        }
        currentId = sceneNodeIndex.parentById.get(currentId) ?? null
      }
      return true
    },
    setNodeVisibility(
      id: string,
      visible: boolean,
      options: {
        fullSyncThreshold?: number
      } = {},
    ) {
      const node = findNodeById(this.nodes, id)
      if (!node) {
        return
      }
      const currentLocal = (node as any).visible ?? true
      if (currentLocal === visible) {
        return
      }

      const thresholdRaw = options.fullSyncThreshold
      const fullSyncThreshold = Number.isFinite(thresholdRaw) ? Math.max(0, Math.floor(thresholdRaw as number)) : 200
      const affectedIds = collectNodeSubtreeIds(node)

      this.captureNodeBasicsHistorySnapshot([{ id, visible: true }])
      visitNode(this.nodes, id, (target) => {
        ;(target as any).visible = visible
      })
      this.nodes = [...this.nodes]
      if (affectedIds.length > fullSyncThreshold) {
        this.queueSceneStructurePatch('subtreeVisibility')
      } else {
        affectedIds.forEach((affectedId) => this.queueSceneNodePatch(affectedId, ['visibility']))
      }
      commitSceneSnapshot(this)
    },
    toggleNodeVisibility(id: string) {
      const current = this.isNodeLocallyVisible(id)
      this.setNodeVisibility(id, !current)
    },
    setAllNodesVisibility(visible: boolean) {
      const changedIds: string[] = []
      const apply = (nodes: SceneNode[]) => {
        nodes.forEach((node) => {
          if ((node as any).visible ?? true !== visible) {
            changedIds.push(node.id)
          }
          if (node.children?.length) {
            apply(node.children)
          }
        })
      }
      apply(this.nodes)
      if (!changedIds.length) {
        return
      }

      this.captureNodeBasicsHistorySnapshot(changedIds.map((id) => ({ id, visible: true })))
      changedIds.forEach((id) => {
        visitNode(this.nodes, id, (node) => {
          ;(node as any).visible = visible
        })
      })
      this.nodes = [...this.nodes]
      // queue visibility patches for changed nodes so the runtime updates
      changedIds.forEach((id) => this.queueSceneNodePatch(id, ['visibility']))
      commitSceneSnapshot(this)
    },

    setAllUserNodesVisibility(
      visible: boolean,
      options: {
        fullSyncThreshold?: number
      } = {},
    ): { changedCount: number } {
      const thresholdRaw = options.fullSyncThreshold
      const fullSyncThreshold = Number.isFinite(thresholdRaw) ? Math.max(0, Math.floor(thresholdRaw as number)) : 200

      const changedIds: string[] = []

      const scan = (nodes: SceneNode[]) => {
        nodes.forEach((node) => {
          const isSystemNode = node.id === GROUND_NODE_ID || node.id === ENVIRONMENT_NODE_ID
          if (!isSystemNode) {
            const currentVisible = (node as any).visible ?? true
            if (currentVisible !== visible) {
              changedIds.push(node.id)
            }
          }

          if (node.children?.length) {
            scan(node.children)
          }
        })
      }

      scan(this.nodes)
      if (!changedIds.length) {
        return { changedCount: 0 }
      }

      this.captureNodeBasicsHistorySnapshot(changedIds.map((id) => ({ id, visible: true })))

      const changedSet = new Set(changedIds)
      const apply = (nodes: SceneNode[]) => {
        nodes.forEach((node) => {
          if (changedSet.has(node.id)) {
            ;(node as any).visible = visible
          }
          if (node.children?.length) {
            apply(node.children)
          }
        })
      }

      apply(this.nodes)
      this.nodes = [...this.nodes]

      if (changedIds.length > fullSyncThreshold) {
        // Large batches: avoid generating a huge patch list.
        // Queue a single structure patch so the viewport does a full sync.
        this.queueSceneStructurePatch('bulkVisibility')
      } else {
        changedIds.forEach((id) => this.queueSceneNodePatch(id, ['visibility']))
      }

      commitSceneSnapshot(this)
      return { changedCount: changedIds.length }
    },
    toggleSelectionVisibility(): boolean {
      const selection = [...this.selectedNodeIds]
      if (!selection.length) {
        return false
      }
      const nodes = selection
        .map((id) => findNodeById(this.nodes, id))
        .filter(
          (node): node is SceneNode => {
            if (!node) {
              return false
            }
            return (
              node.id !== GROUND_NODE_ID &&
              node.id !== ENVIRONMENT_NODE_ID
            )
          },
        )
      if (!nodes.length) {
        return false
      }
      const anyVisible = nodes.some((node) => node.visible ?? true)
      const targetVisible = anyVisible ? false : true
      const shouldUpdate = nodes.some((node) => (node.visible ?? true) !== targetVisible)
      if (!shouldUpdate) {
        return false
      }

      const changedIds = nodes.filter((node) => (node.visible ?? true) !== targetVisible).map((node) => node.id)
      if (!changedIds.length) {
        return false
      }

      this.captureNodeBasicsHistorySnapshot(changedIds.map((id) => ({ id, visible: true })))
      nodes.forEach((node) => {
        ;(node as any).visible = targetVisible
      })
      this.nodes = [...this.nodes]
      commitSceneSnapshot(this)
      return true
    },
    isNodeSelectionLocked(id: string) {
      const node = findNodeById(this.nodes, id)
      return node?.locked ?? false
    },
    setNodeSelectionLock(id: string, locked: boolean) {
      if ((id === GROUND_NODE_ID || id === ENVIRONMENT_NODE_ID) && !locked) {
        return
      }
      let updated = false
      const current = this.isNodeSelectionLocked(id)
      if (current === locked) {
        return
      }

      this.captureNodeBasicsHistorySnapshot([{ id, locked: true }])
      visitNode(this.nodes, id, (node) => {
        ;(node as any).locked = locked
        updated = true
      })
      if (!updated) {
        return
      }
      if (locked && this.selectedNodeIds.includes(id)) {
        const nextSelection = this.selectedNodeIds.filter((selectedId) => selectedId !== id)
        this.setSelection(nextSelection)
      }
      this.queueSceneNodePatch(id, ['lock'])
      commitSceneSnapshot(this)
    },
    toggleNodeSelectionLock(id: string) {
      if (id === GROUND_NODE_ID || id === ENVIRONMENT_NODE_ID) {
        return
      }
      const next = !this.isNodeSelectionLocked(id)
      this.setNodeSelectionLock(id, next)
    },
    setAllNodesSelectionLock(
      locked: boolean,
      options: {
        fullSyncThreshold?: number
      } = {},
    ) {
      const thresholdRaw = options.fullSyncThreshold
      const fullSyncThreshold = Number.isFinite(thresholdRaw) ? Math.max(0, Math.floor(thresholdRaw as number)) : 200

      const changedIds: string[] = []
      const scan = (nodes: SceneNode[]) => {
        nodes.forEach((node) => {
          if (node.id !== GROUND_NODE_ID && node.id !== ENVIRONMENT_NODE_ID) {
            const current = node.locked ?? false
            if (current !== locked) {
              changedIds.push(node.id)
            }
          }
          if (node.children?.length) {
            scan(node.children)
          }
        })
      }

      scan(this.nodes)
      if (!changedIds.length) {
        return
      }

      this.captureNodeBasicsHistorySnapshot(changedIds.map((id) => ({ id, locked: true })))

      const changedSet = new Set(changedIds)
      const apply = (nodes: SceneNode[]) => {
        nodes.forEach((node) => {
          if (changedSet.has(node.id)) {
            ;(node as any).locked = locked
          }
          if (node.children?.length) {
            apply(node.children)
          }
        })
      }

      apply(this.nodes)
      this.nodes = [...this.nodes]

      if (locked && this.selectedNodeIds.length) {
        this.setSelection([])
      }

      if (changedIds.length > fullSyncThreshold) {
        // Large batches: prefer a single full sync in the viewport.
        this.queueSceneStructurePatch('setAllNodesSelectionLock')
      } else {
        changedIds.forEach((id) => this.queueSceneNodePatch(id, ['lock']))
      }

      commitSceneSnapshot(this)
    },
    toggleSelectionLock(): boolean {
      const selection = [...this.selectedNodeIds]
      if (!selection.length) {
        return false
      }
      const nodes = selection
        .map((id) => findNodeById(this.nodes, id))
        .filter((node): node is SceneNode => Boolean(node))
      if (!nodes.length) {
        return false
      }
      const shouldLock = nodes.some((node) => !(node.locked ?? false))
      const targetLock = shouldLock
      const shouldUpdate = nodes.some((node) => (node.locked ?? false) !== targetLock)
      if (!shouldUpdate) {
        return false
      }

      const changedIds = nodes.filter((node) => (node.locked ?? false) !== targetLock).map((node) => node.id)
      if (!changedIds.length) {
        return false
      }

      this.captureNodeBasicsHistorySnapshot(changedIds.map((id) => ({ id, locked: true })))
      const processed = new Set<string>()
      nodes.forEach((node) => {
        const current = node.locked ?? false
        if (current !== targetLock) {
          node.locked = targetLock
          processed.add(node.id)
        }
      })
      if (!processed.size) {
        return false
      }
      if (targetLock) {
        const remainingSelection = this.selectedNodeIds.filter((id) => !processed.has(id))
        const nextPrimary = remainingSelection[remainingSelection.length - 1] ?? null
        this.setSelection(remainingSelection, { primaryId: nextPrimary })
      }
      this.nodes = [...this.nodes]
      commitSceneSnapshot(this)
      return true
    },
    toggleSelectionTransparency(): boolean {
      const selection = [...this.selectedNodeIds]
      if (!selection.length) {
        return false
      }
      const nodes = selection
        .map((id) => findNodeById(this.nodes, id))
        .filter((node): node is SceneNode => Boolean(node && node.materials && node.materials.length))
      if (!nodes.length) {
        return false
      }
      const resolveEntryOpacity = (entry: SceneNodeMaterial | null | undefined) => {
        const raw = entry?.opacity
        return typeof raw === 'number' && Number.isFinite(raw) ? raw : 1
      }
      const resolveOpacity = (node: SceneNode) => resolveEntryOpacity(getPrimaryNodeMaterial(node))
      const anyOpaque = nodes.some((node) => (node.materials ?? []).some((entry) => resolveEntryOpacity(entry) > 0.5))
      const targetOpacity = anyOpaque ? SEMI_TRANSPARENT_OPACITY : 1
      const shouldUpdate = nodes.some((node) => Math.abs(resolveOpacity(node) - targetOpacity) > OPACITY_EPSILON)
      if (!shouldUpdate) {
        return false
      }
      nodes.forEach((node) => {
        if (!node.materials?.length) {
          return
        }
        node.materials = node.materials.map((entry) => {
          const overrides: Partial<SceneMaterialProps> = {
            opacity: targetOpacity,
            transparent: targetOpacity < 0.999,
          }
          const merged = mergeMaterialProps(entry, overrides)
          return createNodeMaterial(merged, {
            id: entry.id,
            name: entry.name,
            type: entry.type,
          })
        })
      })
      let patchQueued = false
      nodes.forEach((node) => {
        patchQueued = this.queueSceneNodePatch(node.id, ['materials'], { bumpVersion: false }) || patchQueued
      })
      if (patchQueued) {
        this.bumpSceneNodePropertyVersion()
      }
      return true
    },
    setActiveDirectory(id: string) {
      this.activeDirectoryId = id
    },
    selectAsset(id: string | null) {
      this.selectedAssetId = id
    },
    async ensureSceneAssetsReady(options: EnsureSceneAssetsOptions = {}) {
      const assetCache = useAssetCacheStore()
      const uiStore = useUiStore()

      const result = await updateSceneAssets({
        options,
        defaultNodes: this.nodes,
        assetCache,
        ui: uiStore,
        watch,
        getAsset: (assetId) => this.getAsset(assetId),
        getCachedModelObject,
        getOrLoadModelObject,
        loadObjectFromFile,
        createInstancedRuntimeProxy,
        findObjectByPath,
        pruneCloneByRelativePaths,
        isPathAncestor,
        registerRuntimeForNode: (node, runtimeObject) => {
          prepareRuntimeObjectForNode(runtimeObject)
          tagObjectWithNodeId(runtimeObject, node.id)
          registerRuntimeObject(node.id, runtimeObject)
          componentManager.attachRuntime(node, runtimeObject)
          componentManager.syncNode(node)
        },
        queueSceneNodePatch: (nodeId, fields, patchOptions) =>
          this.queueSceneNodePatch(nodeId, fields as any, patchOptions),
        prefabProgress: {
          init: (key, value) => {
            this.prefabAssetDownloadProgress[key] = value
          },
          update: (key, value) => {
            this.prefabAssetDownloadProgress[key] = value
          },
          finalize: (key, value) => {
            this.prefabAssetDownloadProgress[key] = value
          },
          clear: (key) => {
            delete this.prefabAssetDownloadProgress[key]
          },
        },
      })

      if (result.queuedRuntimeRefreshPatches) {
        this.bumpSceneNodePropertyVersion()
      }
    },

    setNodeWorldPositionPositionOnly(nodeId: string, worldPosition: THREE.Vector3): boolean {
      if (!nodeId) {
        return false
      }
      const target = findNodeById(this.nodes, nodeId)
      if (!target) {
        return false
      }

      const parentMap = buildParentMap(this.nodes)
      const parentId = parentMap.get(nodeId) ?? null
      const resolvedParentWorldMatrix = parentId ? computeWorldMatrixForNode(this.nodes, parentId) : new Matrix4()
      if (resolvedParentWorldMatrix == null) {
        return false
      }

      const parentInverse = resolvedParentWorldMatrix.clone().invert()
      const localPosition = worldPosition.clone().applyMatrix4(parentInverse)

      this.updateNodeProperties({
        id: nodeId,
        position: toPlainVector(localPosition),
      })

      return true
    },

    async resolvePlaceableAsset(assetOrId: ProjectAsset | string): Promise<ResolvedPlaceableAsset> {
      const requestedAsset = typeof assetOrId === 'string'
        ? this.getAsset(assetOrId)
        : assetOrId
      if (!requestedAsset) {
        throw new Error('Unable to find the requested asset')
      }

      if (requestedAsset.type === 'model' || requestedAsset.type === 'mesh') {
        return {
          requestedAsset,
          modelAsset: requestedAsset,
          lodPresetAssetId: null,
          lodPresetData: null,
        }
      }

      if (requestedAsset.type !== 'lod') {
        throw new Error('Asset is not a placeable model asset')
      }

      const prepared = await this.prepareLodAsset(requestedAsset)

      return {
        requestedAsset: prepared.requestedAsset,
        modelAsset: prepared.modelAsset,
        lodPresetAssetId: requestedAsset.id,
        lodPresetData: prepared.preset,
      }
    },

    async addPlaceableAssetNode(payload: {
      asset: ProjectAsset
      position?: THREE.Vector3
      baseY?: number
      name?: string
      rotation?: THREE.Vector3
      scale?: THREE.Vector3
      parentId?: string | null
      snapToGrid?: boolean
      skipGroundAlignment?: boolean
      editorFlags?: SceneNodeEditorFlags
      appendToParentEnd?: boolean
    }): Promise<SceneNode | null> {
      const resolved = await this.resolvePlaceableAsset(payload.asset)

      if (resolved.lodPresetAssetId) {
        const assetCache = useAssetCacheStore()
        if (!assetCache.hasCache(resolved.modelAsset.id)) {
          const entry = await assetCache.downloadProjectAsset(resolved.modelAsset)
          if (!assetCache.hasCache(resolved.modelAsset.id)) {
            throw new Error(entry.error ?? 'Referenced LOD model asset is not ready yet')
          }
        }
      }

      const node = await this.addModelNode({
        ...payload,
        asset: resolved.modelAsset,
      })
      if (node && resolved.lodPresetAssetId) {
        await this.applyLodPresetToNode(node.id, resolved.lodPresetAssetId)
      }
      return node
    },

    async spawnAssetIntoEmptyGroupAtPosition(
      assetId: string,
      groupId: string,
      worldPosition: THREE.Vector3,
      options: { rotation?: THREE.Vector3 } = {},
    ): Promise<{ asset: ProjectAsset; node: SceneNode }> {
      const groupNode = groupId ? findNodeById(this.nodes, groupId) : null
      const isEmptyGroup = Boolean(
        groupNode
        && groupNode.nodeType === 'Group'
        && (!groupNode.children || groupNode.children.length === 0),
      )

      if (isEmptyGroup) {
        this.setNodeWorldPositionPositionOnly(groupId, worldPosition)
      }

      const result = await this.spawnAssetAtPosition(assetId, worldPosition, {
        parentId: groupId,
        preserveWorldPosition: Boolean(groupId),
        rotation: options.rotation,
      })

      if (isEmptyGroup) {
        this.updateNodeProperties({
          id: result.node.id,
          position: { x: 0, y: 0, z: 0 },
        })
      }

      return result
    },

    async spawnAssetIntoEmptyGroupAtWorldTransform(
      assetId: string,
      groupId: string,
      transform: { position: THREE.Vector3; rotation?: THREE.Vector3 | null; scale?: THREE.Vector3 | null },
    ): Promise<{ asset: ProjectAsset; node: SceneNode }> {
      const groupNode = groupId ? findNodeById(this.nodes, groupId) : null
      const isEmptyGroup = Boolean(
        groupNode
        && groupNode.nodeType === 'Group'
        && (!groupNode.children || groupNode.children.length === 0),
      )

      if (isEmptyGroup) {
        this.setNodeWorldPositionPositionOnly(groupId, transform.position)
      }

      const result = await this.spawnAssetAtWorldTransform(assetId, {
        position: transform.position,
        rotation: transform.rotation ?? null,
        scale: transform.scale ?? null,
        parentId: groupId,
        preserveWorldPosition: Boolean(groupId),
      })

      if (isEmptyGroup) {
        this.updateNodeProperties({
          id: result.node.id,
          position: { x: 0, y: 0, z: 0 },
        })
      }

      return result
    },

    async spawnAssetAtWorldTransform(
      assetId: string,
      options: {
        position: THREE.Vector3
        rotation?: THREE.Vector3 | null
        scale?: THREE.Vector3 | null
        parentId?: string | null
        preserveWorldPosition?: boolean
      },
    ): Promise<{ asset: ProjectAsset; node: SceneNode }> {
      const asset = findAssetInTree(this.projectTree, assetId)
      if (!asset) {
        throw new Error('Unable to find the requested asset')
      }

      const parentMap = buildParentMap(this.nodes)
      let targetParentId = options.parentId ?? null
      while (targetParentId) {
        const candidate = findNodeById(this.nodes, targetParentId)
        if (allowsChildNodes(candidate)) {
          break
        }
        targetParentId = parentMap.get(targetParentId) ?? null
      }

      const desiredWorldPosition = options.position.clone()
      const desiredWorldQuaternion = new Quaternion().setFromEuler(
        new Euler(options.rotation?.x ?? 0, options.rotation?.y ?? 0, options.rotation?.z ?? 0, 'XYZ'),
      )
      const desiredWorldScale = new Vector3(
        options.scale?.x ?? 1,
        options.scale?.y ?? 1,
        options.scale?.z ?? 1,
      )

      const adjustNodeWorldTransform = (nodeId: string | null) => {
        if (!nodeId) {
          return
        }

        let localPosition = desiredWorldPosition.clone()
        let localQuaternion = desiredWorldQuaternion.clone()
        let localScale = desiredWorldScale.clone()

        if (targetParentId) {
          const parentMatrix = computeWorldMatrixForNode(this.nodes, targetParentId)
          if (!parentMatrix) {
            return
          }

          const desiredWorldMatrix = new Matrix4().compose(
            desiredWorldPosition.clone(),
            desiredWorldQuaternion.clone(),
            desiredWorldScale.clone(),
          )
          const parentInverse = parentMatrix.clone().invert()
          const localMatrix = new Matrix4().multiplyMatrices(parentInverse, desiredWorldMatrix)
          localMatrix.decompose(localPosition, localQuaternion, localScale)
        }

        const localEuler = new Euler().setFromQuaternion(localQuaternion, 'XYZ')
        this.updateNodeTransform({
          id: nodeId,
          position: toPlainVector(localPosition),
          rotation: { x: localEuler.x, y: localEuler.y, z: localEuler.z } as Vector3Like,
          scale: toPlainVector(localScale),
        })
      }

      if (asset.type === 'prefab') {
        const node = await this.spawnPrefabWithPlaceholder(asset.id, desiredWorldPosition, {
          parentId: targetParentId,
          rotation: options.rotation ?? null,
        })
        await this.withHistorySuppressed(() => adjustNodeWorldTransform(node?.id ?? null))
        return { asset, node }
      }

      const supportsDirectPlacement = asset.type === 'model' || asset.type === 'mesh' || asset.type === 'lod'
      const node = supportsDirectPlacement
        ? await this.addPlaceableAssetNode({
            asset,
            position: desiredWorldPosition,
            rotation: options.rotation ?? undefined,
            scale: options.scale ?? undefined,
            parentId: targetParentId ?? undefined,
            skipGroundAlignment: true,
          })
        : null
      if (node) {
        if (options.preserveWorldPosition) {
          await this.withHistorySuppressed(() => adjustNodeWorldTransform(node.id))
        }
        return { asset, node }
      }

      const placeholder = this.addPlaceholderNode(asset, {
        position: toPlainVector(desiredWorldPosition),
        rotation: options.rotation ? toPlainVector(options.rotation) : { x: 0, y: 0, z: 0 },
        scale: options.scale ? toPlainVector(options.scale) : { x: 1, y: 1, z: 1 },
      }, {
        parentId: targetParentId,
      })
      if (options.preserveWorldPosition) {
        await this.withHistorySuppressed(() => adjustNodeWorldTransform(placeholder.id))
      }

      const assetCache = useAssetCacheStore()
      this.observeAssetDownloadForNode(placeholder.id, asset)
      assetCache.setError(asset.id, null)
      void assetCache.downloadProjectAsset(asset).catch((error) => {
        const target = findNodeById(this.nodes, placeholder.id)
        if (target) {
          target.downloadStatus = 'error'
          target.downloadError = (error as Error).message ?? 'Asset download failed'
          this.queueSceneNodePatch(placeholder.id, ['download'])
        }
      })

      return { asset, node: placeholder }
    },

    async spawnAssetAtPosition(
      assetId: string,
      position: THREE.Vector3,
      options: { parentId?: string | null; preserveWorldPosition?: boolean; rotation?: THREE.Vector3 } = {},
    ): Promise<{ asset: ProjectAsset; node: SceneNode }> {
      const asset = findAssetInTree(this.projectTree, assetId)
      if (!asset) {
        throw new Error('Unable to find the requested asset')
      }

      const parentMap = buildParentMap(this.nodes)
      let targetParentId = options.parentId ?? null
      while (targetParentId) {
        const candidate = findNodeById(this.nodes, targetParentId)
        if (allowsChildNodes(candidate)) {
          break
        }
        targetParentId = parentMap.get(targetParentId) ?? null
      }

      const adjustNodeWorldPosition = (nodeId: string | null, desiredWorldPosition: THREE.Vector3 | null) => {
        if (!nodeId || !desiredWorldPosition || !targetParentId) {
          return
        }
        const parentMatrix = computeWorldMatrixForNode(this.nodes, targetParentId)
        if (!parentMatrix) {
          return
        }

        const parentInverse = parentMatrix.clone().invert()
        const currentWorldMatrix = computeWorldMatrixForNode(this.nodes, nodeId)
        if (!currentWorldMatrix) {
          return
        }

        const currentWorldPosition = new Vector3()
        const currentWorldQuaternion = new Quaternion()
        const currentWorldScale = new Vector3()
        currentWorldMatrix.decompose(currentWorldPosition, currentWorldQuaternion, currentWorldScale)

        const desiredWorldMatrix = new Matrix4().compose(
          desiredWorldPosition.clone(),
          currentWorldQuaternion,
          currentWorldScale,
        )

        const localMatrix = new Matrix4().multiplyMatrices(parentInverse, desiredWorldMatrix)
        const localPosition = new Vector3()
        const localQuaternion = new Quaternion()
        const localScale = new Vector3()
        localMatrix.decompose(localPosition, localQuaternion, localScale)
        const localEuler = new Euler().setFromQuaternion(localQuaternion, 'XYZ')

        this.updateNodeTransform({
          id: nodeId,
          position: toPlainVector(localPosition),
          rotation: { x: localEuler.x, y: localEuler.y, z: localEuler.z } as Vector3Like,
          scale: toPlainVector(localScale),
        })
      }

      if (asset.type === 'prefab') {
        const node = await this.spawnPrefabWithPlaceholder(asset.id, position ?? null, {
          parentId: targetParentId,
          rotation: options.rotation ?? null,
        })
        if (options.preserveWorldPosition) {
          await this.withHistorySuppressed(() => adjustNodeWorldPosition(node?.id ?? null, position))
        }
        return { asset, node }
      }

      const supportsDirectPlacement = asset.type === 'model' || asset.type === 'mesh' || asset.type === 'lod'
      const node = supportsDirectPlacement
        ? await this.addPlaceableAssetNode({
            asset,
            position,
            rotation: options.rotation,
            parentId: targetParentId ?? undefined,
          })
        : null
      if (node) {
        if (options.preserveWorldPosition) {
          await this.withHistorySuppressed(() => adjustNodeWorldPosition(node.id, position))
        }
        return { asset, node }
      }

      const assetCache = useAssetCacheStore()
      const transform = computeAssetSpawnTransform(asset, position, {
        rotation: options.rotation ? toPlainVector(options.rotation) : null,
      })
      const placeholder = this.addPlaceholderNode(asset, transform, {
        parentId: targetParentId,
      })
      if (options.preserveWorldPosition) {
        await this.withHistorySuppressed(() => adjustNodeWorldPosition(placeholder.id, position))
      }
      this.observeAssetDownloadForNode(placeholder.id, asset)
      assetCache.setError(asset.id, null)
      void assetCache.downloadProjectAsset(asset).catch((error) => {
        const target = findNodeById(this.nodes, placeholder.id)
      if (target) {
        target.downloadStatus = 'error'
        target.downloadError = (error as Error).message ?? 'Asset download failed'
        this.queueSceneNodePatch(placeholder.id, ['download'])
      }
      })

      return { asset, node: placeholder }
    },
    resetProjectTree() {
      this.packageDirectoryCache = {}
      this.packageDirectoryLoaded = {}
      this.refreshProjectTree()
      this.activeDirectoryId = defaultDirectoryId
      this.selectedAssetId = null
    },
    // Helper: rebuild project tree from current catalog + package directory cache
    refreshProjectTree() {
      this.projectTree = buildSceneProjectTree(
        this.assetManifest,
        this.assetCatalog,
        this.packageDirectoryCache,
      )
    },
    // Helper: ensure active directory and selected asset are valid in the current projectTree
    ensureActiveDirectoryAndSelectionValid() {
      if (this.activeDirectoryId && !findDirectory(this.projectTree, this.activeDirectoryId)) {
        this.activeDirectoryId = defaultDirectoryId
      }
      if (this.selectedAssetId && !findAssetInTree(this.projectTree, this.selectedAssetId)) {
        this.selectedAssetId = null
      }
    },
    // Helper: atomically apply catalog/index/registry updates and refresh tree
    applyCatalogUpdate(
      nextCatalog: Record<string, ProjectAsset[]>,
      options?: {
        nextAssetRegistry?: Record<string, SceneAssetRegistryEntry>
        nextManifest?: AssetManifest | null
        preferredDirectoryId?: string | null
        commitSnapshot?: boolean
        updateNodes?: boolean
      },
    ) {
      const nextManifest = options?.nextManifest
        ? cloneAssetManifest(options.nextManifest)
        : synchronizeManifestWithCatalog(this.assetManifest, nextCatalog, {
            preferredDirectoryId: options?.preferredDirectoryId,
          })
      const normalizedCatalog = nextManifest
        ? buildAssetCatalogFromManifest(nextManifest, nextCatalog)
        : nextCatalog
      this.assetManifest = nextManifest
      if (options?.nextAssetRegistry) {
        this.assetRegistry = filterAssetRegistryByCatalog(options.nextAssetRegistry, normalizedCatalog)
      } else {
        this.assetRegistry = filterAssetRegistryByCatalog(this.assetRegistry, normalizedCatalog)
      }
      this.assetCatalog = mergeCatalogAssetMetadataFromIndex(normalizedCatalog)
      this.refreshProjectTree()
      if (options?.commitSnapshot) {
        commitSceneSnapshot(this, { updateNodes: !!options.updateNodes })
      }
    },
    markSceneDirty(options: { updateNodes?: boolean } = {}) {
      commitSceneSnapshot(this, { updateNodes: options.updateNodes === true })
    },
    // Helper: find asset by id directly from catalog
    findAssetInCatalog(assetId: string): ProjectAsset | null {
      return getAssetFromCatalog(this.assetCatalog, assetId)
    },
    // Helper: collect all assets from catalog into a Map by id
    collectCatalogAssetMap(): Map<string, ProjectAsset> {
      const map = new Map<string, ProjectAsset>()
      Object.values(this.assetCatalog).forEach((list) => {
        list.forEach((asset) => {
          map.set(asset.id, asset)
        })
      })
      return map
    },
    ensureLocalPackagesDirectoryInAssets(): string {
      const currentManifest = cloneAssetManifest(this.assetManifest) ?? buildSceneAssetManifest(this.assetCatalog)
      if (!this.assetManifest) {
        this.applyCatalogUpdate(this.assetCatalog, {
          nextManifest: currentManifest,
          commitSnapshot: false,
          updateNodes: false,
        })
      }
      return currentManifest.rootDirectoryId
    },
    resolveConfigAssetSaveDirectoryId(): string {
      const manifest = this.assetManifest
      if (!manifest) {
        return SCENE_ASSET_MANIFEST_ROOT_DIRECTORY_ID
      }

      const fallbackDirectoryId = manifest.rootDirectoryId
      const activeProjectDirectoryId = this.activeDirectoryId
      if (!activeProjectDirectoryId) {
        return fallbackDirectoryId
      }

      const activeDirectoryPath = findDirectoryPathInTree(this.projectTree, activeProjectDirectoryId) ?? []
      const isReadonlyPackagesDirectory = isPackageDirectoryPath(activeDirectoryPath)
      if (isReadonlyPackagesDirectory) {
        return fallbackDirectoryId
      }

      const activeManifestDirectoryId = resolveManifestDirectoryIdFromProjectDirectoryId(manifest, activeProjectDirectoryId)
      if (!activeManifestDirectoryId) {
        return fallbackDirectoryId
      }

      return activeManifestDirectoryId
    },
    resolvePackageMirrorDirectoryId(providerId: string, packagePathSegments: string[] = []): string {
      const manifest = cloneAssetManifest(this.assetManifest) ?? buildSceneAssetManifest(this.assetCatalog)
      let changed = false

      const providerDirectory = ensureLocalPackageProviderManifestDirectory(manifest, providerId)
      changed = changed || providerDirectory.created

      let currentDirectoryId = providerDirectory.directoryId
      packagePathSegments
        .map((segment) => normalizeDirectorySegmentForManifest(segment))
        .forEach((segment) => {
          const ensured = ensureManifestDirectory(manifest, currentDirectoryId, segment)
          changed = changed || ensured.created
          currentDirectoryId = ensured.directoryId
        })

      if (changed || !this.assetManifest) {
        this.applyCatalogUpdate(this.assetCatalog, {
          nextManifest: manifest,
          commitSnapshot: false,
          updateNodes: false,
        })
      }

      return currentDirectoryId
    },
    getPackageAssetPathSegments(providerId: string, assetId: string): string[] {
      const providerDirectories = this.packageDirectoryCache[providerId]
      if (!providerDirectories?.length) {
        return []
      }
      const normalized = normalizePackageProviderDirectories(providerDirectories)
      if (normalized.assets?.some((asset) => asset.id === assetId)) {
        return []
      }
      const foundPath = findAssetPathSegmentsInDirectories(normalized.directories, assetId)
      if (!foundPath?.length) {
        return []
      }
      return foundPath
    },
    createAssetDirectory(name: string, parentProjectDirectoryId?: string | null): string | null {
      const manifest = cloneAssetManifest(this.assetManifest)
      if (!manifest) {
        return null
      }
      const parentId = resolveManifestDirectoryIdFromProjectDirectoryId(
        manifest,
        parentProjectDirectoryId ?? this.activeDirectoryId ?? ASSETS_ROOT_DIRECTORY_ID,
      ) ?? manifest.rootDirectoryId
      const parent = manifest.directoriesById[parentId]
      if (!parent) {
        return null
      }
      const directoryId = generateUuid()
      const resolvedName = buildUniqueDirectoryName(manifest, parentId, name)
      manifest.directoriesById[directoryId] = {
        id: directoryId,
        name: resolvedName,
        parentId,
        directoryIds: [],
        assetIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      parent.directoryIds = [...parent.directoryIds, directoryId]
      this.applyCatalogUpdate(this.assetCatalog, {
        nextManifest: manifest,
        commitSnapshot: true,
        updateNodes: false,
      })
      this.setActiveDirectory(directoryId)
      // Persist scene immediately after modifying asset directories
      void this.saveActiveScene({ force: true }).catch(() => {})
      return directoryId
    },
    renameAssetDirectory(projectDirectoryId: string, name: string): boolean {
      const manifest = cloneAssetManifest(this.assetManifest)
      const directoryId = resolveManifestDirectoryIdFromProjectDirectoryId(manifest, projectDirectoryId)
      if (!manifest || !directoryId || directoryId === manifest.rootDirectoryId) {
        return false
      }
      const directory = manifest.directoriesById[directoryId]
      if (!directory) {
        return false
      }
      const parentId = directory.parentId ?? manifest.rootDirectoryId
      const resolvedName = buildUniqueDirectoryName(manifest, parentId, name, directoryId)
      if (resolvedName === directory.name) {
        return false
      }
      directory.name = resolvedName
      directory.updatedAt = new Date().toISOString()
      this.applyCatalogUpdate(this.assetCatalog, {
        nextManifest: manifest,
        commitSnapshot: true,
        updateNodes: false,
      })
      // Persist scene immediately after renaming a directory
      void this.saveActiveScene({ force: true }).catch(() => {})
      return true
    },
    moveAssetDirectory(projectDirectoryId: string, targetProjectDirectoryId: string): boolean {
      const manifest = cloneAssetManifest(this.assetManifest)
      const directoryId = resolveManifestDirectoryIdFromProjectDirectoryId(manifest, projectDirectoryId)
      const targetDirectoryId = resolveManifestDirectoryIdFromProjectDirectoryId(manifest, targetProjectDirectoryId)
      if (!manifest || !directoryId || !targetDirectoryId || directoryId === manifest.rootDirectoryId) {
        return false
      }
      if (directoryId === targetDirectoryId || isManifestDirectoryDescendant(manifest, directoryId, targetDirectoryId)) {
        return false
      }
      const directory = manifest.directoriesById[directoryId]
      const currentParent = directory?.parentId ? manifest.directoriesById[directory.parentId] : null
      const targetParent = manifest.directoriesById[targetDirectoryId]
      if (!directory || !targetParent) {
        return false
      }
      if (directory.parentId === targetDirectoryId) {
        return false
      }
      if (currentParent) {
        currentParent.directoryIds = currentParent.directoryIds.filter((id) => id !== directoryId)
      }
      directory.parentId = targetDirectoryId
      directory.name = buildUniqueDirectoryName(manifest, targetDirectoryId, directory.name, directoryId)
      directory.updatedAt = new Date().toISOString()
      targetParent.directoryIds = [...targetParent.directoryIds, directoryId]
      this.applyCatalogUpdate(this.assetCatalog, {
        nextManifest: manifest,
        commitSnapshot: true,
        updateNodes: false,
      })
      this.setActiveDirectory(directoryId)
      // Persist scene immediately after moving a directory
      void this.saveActiveScene({ force: true }).catch(() => {})
      return true
    },
    deleteAssetDirectory(projectDirectoryId: string): { removedDirectoryIds: string[]; removedAssetIds: string[] } {
      const manifest = cloneAssetManifest(this.assetManifest)
      const directoryId = resolveManifestDirectoryIdFromProjectDirectoryId(manifest, projectDirectoryId)
      if (!manifest || !directoryId || directoryId === manifest.rootDirectoryId) {
        return { removedDirectoryIds: [], removedAssetIds: [] }
      }
      const directory = manifest.directoriesById[directoryId]
      if (!directory) {
        return { removedDirectoryIds: [], removedAssetIds: [] }
      }

      const directoryIdsToRemove = new Set<string>()
      const assetIdsToRemove = new Set<string>()
      const stack = [directoryId]
      while (stack.length) {
        const currentId = stack.pop()!
        if (directoryIdsToRemove.has(currentId)) {
          continue
        }
        directoryIdsToRemove.add(currentId)
        const currentDirectory = manifest.directoriesById[currentId]
        currentDirectory?.assetIds.forEach((assetId) => assetIdsToRemove.add(assetId))
        currentDirectory?.directoryIds.forEach((childId) => stack.push(childId))
      }

      const parentId = directory.parentId ?? manifest.rootDirectoryId
      const parent = manifest.directoriesById[parentId]
      if (parent) {
        parent.directoryIds = parent.directoryIds.filter((id) => id !== directoryId)
      }

      directoryIdsToRemove.forEach((id) => {
        delete manifest.directoriesById[id]
      })
      assetIdsToRemove.forEach((assetId) => {
        delete manifest.assetsById[assetId]
      })

      const nextCatalog = buildAssetCatalogFromManifest(cleanupManifestDirectoryReferences(manifest), this.assetCatalog)

      this.applyCatalogUpdate(nextCatalog, {
        nextManifest: manifest,
        commitSnapshot: true,
        updateNodes: false,
      })
      this.setActiveDirectory(parentId === manifest.rootDirectoryId ? ASSETS_ROOT_DIRECTORY_ID : parentId)
      // Persist scene immediately after deleting a directory (and its assets)
      void this.saveActiveScene({ force: true }).catch(() => {})
      return {
        removedDirectoryIds: Array.from(directoryIdsToRemove),
        removedAssetIds: Array.from(assetIdsToRemove),
      }
    },
    renameProjectAsset(assetId: string, name: string): boolean {
      const manifest = cloneAssetManifest(this.assetManifest)
      if (!manifest || !(assetId in manifest.assetsById)) {
        return false
      }
      const asset = manifest.assetsById[assetId]!
      const nextName = name.trim()
      if (!nextName.length || nextName === asset.name) {
        return false
      }
      asset.name = nextName
      asset.updatedAt = new Date().toISOString()
      this.applyCatalogUpdate(this.assetCatalog, {
        nextManifest: manifest,
        commitSnapshot: true,
        updateNodes: false,
      })
      // Persist scene immediately after renaming a project asset
      void this.saveActiveScene({ force: true }).catch(() => {})
      return true
    },
    updateProjectAssetMetadata(assetId: string, updates: Partial<ProjectAsset>): ProjectAsset | null {
      const currentAsset = this.findAssetInCatalog(assetId)
      if (!currentAsset) {
        return null
      }

      const targetCategoryId =
        (typeof currentAsset.categoryId === 'string' && currentAsset.categoryId.trim().length
          ? currentAsset.categoryId.trim()
          : null)
        ?? determineAssetCategoryId(currentAsset)

      const nextCatalog = { ...this.assetCatalog }
      const currentList = nextCatalog[targetCategoryId] ?? []
      const timestamp = new Date().toISOString()
      let updatedAsset: ProjectAsset | null = null

      nextCatalog[targetCategoryId] = currentList.map((asset) => {
        if (asset.id !== assetId) {
          return asset
        }
        updatedAsset = {
          ...asset,
          ...updates,
          id: asset.id,
          type: asset.type,
          downloadUrl: updates.downloadUrl ?? asset.downloadUrl,
          extension: updates.extension ?? asset.extension ?? null,
          previewColor: updates.previewColor ?? asset.previewColor,
          metadata: updates.metadata === undefined
            ? (asset.metadata && typeof asset.metadata === 'object' ? { ...asset.metadata } : asset.metadata ?? null)
            : (updates.metadata && typeof updates.metadata === 'object' ? { ...updates.metadata } : updates.metadata ?? null),
          source: updates.source ?? asset.source,
          internal: typeof updates.internal === 'boolean' ? updates.internal : asset.internal,
          isEditorOnly: typeof updates.isEditorOnly === 'boolean' ? updates.isEditorOnly : asset.isEditorOnly,
          createdAt: asset.createdAt ?? timestamp,
          updatedAt: timestamp,
          gleaned: asset.gleaned,
        }
        return updatedAsset
      })

      if (!updatedAsset) {
        return null
      }

      this.applyCatalogUpdate(nextCatalog, {
        commitSnapshot: true,
        updateNodes: false,
      })
      void this.saveActiveScene({ force: true }).catch(() => {})
      return this.findAssetInCatalog(assetId)
    },
    moveProjectAssetToDirectory(assetId: string, targetProjectDirectoryId: string): boolean {
      const manifest = cloneAssetManifest(this.assetManifest)
      const targetDirectoryId = resolveManifestDirectoryIdFromProjectDirectoryId(manifest, targetProjectDirectoryId)
      if (!manifest || !targetDirectoryId || !(assetId in manifest.assetsById)) {
        return false
      }
      const currentDirectoryId = findManifestDirectoryContainingAsset(manifest, assetId)
      if (currentDirectoryId === targetDirectoryId) {
        return false
      }
      if (currentDirectoryId && manifest.directoriesById[currentDirectoryId]) {
        manifest.directoriesById[currentDirectoryId]!.assetIds = manifest.directoriesById[currentDirectoryId]!.assetIds.filter((id) => id !== assetId)
      }
      const targetDirectory = manifest.directoriesById[targetDirectoryId]
      if (!targetDirectory) {
        return false
      }
      targetDirectory.assetIds = [...targetDirectory.assetIds.filter((id) => id !== assetId), assetId]
      const asset = manifest.assetsById[assetId]!
      asset.categoryId = targetDirectoryId
      asset.updatedAt = new Date().toISOString()
      this.applyCatalogUpdate(this.assetCatalog, {
        nextManifest: manifest,
        commitSnapshot: true,
        updateNodes: false,
      })
      // Persist scene immediately after moving an asset to a different directory
      void this.saveActiveScene({ force: true }).catch(() => {})
      return true
    },
    getPackageDirectories(providerId: string): ProjectDirectory[] | null {
      const cached = this.packageDirectoryCache[providerId]
      if (!cached) {
        return null
      }
      return cloneProjectTree(cached)
    },
    findPackageProviderIdForAsset(assetId: string): string | null {
      const normalizedAssetId = typeof assetId === 'string' ? assetId.trim() : ''
      if (!normalizedAssetId) {
        return null
      }
      for (const [providerId, directories] of Object.entries(this.packageDirectoryCache)) {
        if (findAssetInTree(directories ?? [], normalizedAssetId)) {
          return providerId
        }
      }
      return null
    },
    isPackageLoaded(providerId: string): boolean {
      return !!this.packageDirectoryLoaded[providerId]
    },
    setPackageDirectories(providerId: string, directories: ProjectDirectory[]) {
      this.packageDirectoryCache[providerId] = cloneProjectTree(directories)
      this.packageDirectoryLoaded[providerId] = true
      this.refreshProjectTree()
      this.ensureActiveDirectoryAndSelectionValid()
      this.selectedAssetId = null
    },
    async ensurePackageDirectoriesLoaded(providerId: string): Promise<ProjectDirectory[]> {
      const normalizedProviderId = typeof providerId === 'string' ? providerId.trim() : ''
      if (!normalizedProviderId) {
        return []
      }

      const cached = this.getPackageDirectories(normalizedProviderId)
      if (cached?.length) {
        return cached
      }

      const provider = resourceProviders.find((entry) => entry.id === normalizedProviderId)
      if (!provider?.load) {
        return []
      }

      const directories = await provider.load()
      const normalizedDirectories = Array.isArray(directories) ? directories : []
      this.setPackageDirectories(normalizedProviderId, normalizedDirectories)
      return this.getPackageDirectories(normalizedProviderId) ?? []
    },
    resolvePackageProviderIdForAsset(
      asset: ProjectAsset,
      options: { providerId?: string; packagePathSegments?: string[] } = {},
    ): string | null {
      const explicitProviderId = typeof options.providerId === 'string' ? options.providerId.trim() : ''
      if (explicitProviderId) {
        return explicitProviderId
      }

      const sourceMeta = asset.source
      if (sourceMeta?.type === 'package' && typeof sourceMeta.providerId === 'string' && sourceMeta.providerId.trim().length > 0) {
        return sourceMeta.providerId.trim()
      }

      if (typeof asset.fileKey === 'string' && asset.fileKey.trim().length > 0) {
        return SERVER_ASSET_PROVIDER_ID
      }

      return this.findPackageProviderIdForAsset(asset.id)
    },
    ensureSceneAssetRegistered(
      asset: ProjectAsset,
      options: {
        providerId?: string
        packagePathSegments?: string[]
        categoryId?: string
        source?: AssetSourceMetadata
        internal?: boolean
        isEditorOnly?: boolean
        commitOptions?: { updateNodes?: boolean }
        autoSave?: boolean
      } = {},
    ): ProjectAsset {
      const assetId = typeof asset?.id === 'string' ? asset.id.trim() : ''
      if (!assetId) {
        return asset
      }

      const normalizedAsset: ProjectAsset = {
        ...asset,
        id: assetId,
        gleaned: asset.gleaned ?? true,
      }

      const existing = this.getRegisteredAsset(assetId)
      if (existing) {
        const syncSource = options.source ?? existing.source ?? normalizedAsset.source
        if (syncSource) {
          void this.syncAssetRegistryEntry(existing, syncSource)
        }
        return existing
      }

      const providerId = this.resolvePackageProviderIdForAsset(normalizedAsset, {
        providerId: options.providerId,
        packagePathSegments: options.packagePathSegments,
      })
      if (providerId) {
        const packagePathSegments = Array.isArray(options.packagePathSegments)
          ? options.packagePathSegments
          : this.getPackageAssetPathSegments(providerId, assetId)
        return this.copyPackageAssetToAssets(providerId, normalizedAsset, { packagePathSegments })
      }

      const inferredSource =
        options.source
        ?? normalizedAsset.source
        ?? (typeof normalizedAsset.fileKey === 'string' && normalizedAsset.fileKey.trim().length > 0
          ? createServerAssetSource(assetId)
          : (resolveAssetDownloadUrl(normalizedAsset) ? { type: 'url' } satisfies AssetSourceMetadata : undefined))

      return this.registerAsset(normalizedAsset, {
        categoryId: options.categoryId ?? determineAssetCategoryId(normalizedAsset),
        source: inferredSource,
        internal: options.internal,
        isEditorOnly: options.isEditorOnly,
        commitOptions: options.commitOptions ?? { updateNodes: false },
        autoSave: options.autoSave,
      })
    },
    getRegisteredAsset(assetId: string): ProjectAsset | null {
      const normalizedAssetId = typeof assetId === 'string' ? assetId.trim() : ''
      if (!normalizedAssetId) {
        return null
      }

      const direct = this.findAssetInCatalog(normalizedAssetId)
      if (direct) {
        return direct
      }

      for (const [registryKey, entry] of Object.entries(this.assetRegistry ?? {})) {
        if (!entry || entry.sourceType !== 'server') {
          continue
        }
        const serverAssetId = typeof entry.serverAssetId === 'string' ? entry.serverAssetId.trim() : ''
        if (!serverAssetId || serverAssetId !== normalizedAssetId) {
          continue
        }
        const mapped = this.findAssetInCatalog(registryKey)
        if (mapped) {
          return mapped
        }
      }

      return null
    },

    getAsset(assetId: string): ProjectAsset | null {
      const foundInCatalog = this.getRegisteredAsset(assetId)
      if (foundInCatalog) {
        return foundInCatalog
      }
      return findAssetInTree(this.projectTree, assetId)
    },
    getNodeWorldCenter(nodeId: string): THREE.Vector3 | null {
      if (!nodeId) {
        return null
      }
      const boundsMap = collectNodeBoundingInfo(this.nodes)
      const info = boundsMap.get(nodeId)
      if (info && info.bounds && !info.bounds.isEmpty()) {
        return info.bounds.getCenter(new Vector3())
      }
      const matrix = computeWorldMatrixForNode(this.nodes, nodeId)
      if (!matrix) {
        return null
      }
      const position = new Vector3()
      const quaternion = new Quaternion()
      const scale = new Vector3()
      matrix.decompose(position, quaternion, scale)
      return position
    },
    async ensureBuiltinWaterNormalAsset(): Promise<ProjectAsset | null> {
      const assetId = BUILTIN_WATER_NORMAL_ASSET_ID
      const assetCache = useAssetCacheStore()

      let cached = await assetCache.ensureAssetEntry(assetId, {
        downloadUrl: builtinWaterNormalUrl,
        name: BUILTIN_WATER_NORMAL_FILENAME,
      })

      if (!cached || cached.status !== 'cached' || !cached.blob) {
        const blob = await loadBuiltinWaterNormalBlob()
        cached = await assetCache.storeAssetBlob(assetId, {
          blob,
          mimeType: blob.type || 'image/jpeg',
          filename: BUILTIN_WATER_NORMAL_FILENAME,
          downloadUrl: builtinWaterNormalUrl,
        })
      }
      assetCache.touch(assetId)

      const projectAsset: ProjectAsset = {
        id: assetId,
        name: 'Water Normal',
        type: 'texture',
        downloadUrl: builtinWaterNormalUrl,
        previewColor: '#ffffff',
        thumbnail: null,
        description: BUILTIN_WATER_NORMAL_FILENAME,
        gleaned: true,
        extension: 'jpg',
      }

      return this.registerAsset(projectAsset, {
        categoryId: determineAssetCategoryId(projectAsset),
        source: { type: 'local' },
        internal: true,
        commitOptions: { updateNodes: false },
      })
    },
    applyWaterNodeDefaultNormalMap(nodeId: string): void {
      if (!nodeId) {
        return
      }
      this.setNodePrimaryTexture(nodeId, {
        assetId: BUILTIN_WATER_NORMAL_ASSET_ID,
        name: BUILTIN_WATER_NORMAL_FILENAME,
      }, 'normal')

      void this.ensureBuiltinWaterNormalAsset().catch((error) => {
        console.error('Failed to ensure built-in water normal asset', error)
      })
    },
    async ensureLocalAssetFromFile(
      file: File,
      metadata: {
        type: ProjectAsset['type']
        name: string
        description?: string
        previewColor?: string
        gleaned?: boolean
        isEditorOnly?: boolean
        commitOptions?: { updateNodes?: boolean }
      },
    ): Promise<{ asset: ProjectAsset; isNew: boolean }> {
      const assetCache = useAssetCacheStore()
      const displayName = metadata.name && metadata.name.trim().length ? metadata.name.trim() : file.name ?? 'Local Asset'
      const description = metadata.description ?? (file.name && file.name.trim().length ? file.name : undefined)
      const assetId = await computeBlobHash(file)

      let entry = assetCache.hasCache(assetId) ? assetCache.getEntry(assetId) : null
      if (!entry || entry.status !== 'cached' || !entry.blob) {
        entry = await assetCache.ensureAssetEntry(assetId, { contentHash: assetId })
      }
      if (!entry || entry.status !== 'cached' || !entry.blob) {
        entry = await assetCache.storeAssetBlob(assetId, {
          blob: file,
          mimeType: file.type || null,
          filename: file.name ?? displayName,
        })
      }

      assetCache.touch(assetId)

      const existing = this.getAsset(assetId)
      if (existing) {
        return { asset: existing, isNew: false }
      }

      const projectAsset: ProjectAsset = {
        id: assetId,
        name: displayName,
        type: metadata.type,
        downloadUrl: assetId,
        previewColor: metadata.previewColor ?? '#ffffff',
        thumbnail: null,
        description,
        metadata: null,
        gleaned: metadata.gleaned ?? true,
        extension: extractExtension(file.name) ?? getExtensionFromMimeType(file.type) ?? null,
      }

      const registered = this.registerAsset(projectAsset, {
        categoryId: determineAssetCategoryId(projectAsset),
        source: { type: 'local' },
        isEditorOnly: metadata.isEditorOnly,
        commitOptions: metadata.commitOptions ?? { updateNodes: false },
      })

      return { asset: registered, isNew: true }
    },

    registerAssets(
      assets: ProjectAsset[],
      options: {
        categoryId?: string | ((asset: ProjectAsset) => string)
        source?: AssetSourceMetadata | ((asset: ProjectAsset) => AssetSourceMetadata | undefined)
        internal?: boolean | ((asset: ProjectAsset) => boolean)
        isEditorOnly?: boolean | ((asset: ProjectAsset) => boolean)
        commitOptions?: { updateNodes?: boolean }
        autoSave?: boolean
      } = {},
    ): ProjectAsset[] {
      const normalizedAssets = Array.isArray(assets) ? assets.filter(Boolean) : []
      if (!normalizedAssets.length) {
        return []
      }

      const categoryIdForAsset = (asset: ProjectAsset): string => {
        if (typeof options.categoryId === 'string' && options.categoryId.trim().length) {
          return options.categoryId
        }
        if (typeof options.categoryId === 'function') {
          return options.categoryId(asset)
        }
        const preferredDirectoryId = resolveManifestDirectoryIdFromProjectDirectoryId(this.assetManifest, this.activeDirectoryId)
        if (preferredDirectoryId && preferredDirectoryId !== this.assetManifest?.rootDirectoryId) {
          return preferredDirectoryId
        }
        return determineAssetCategoryId(asset)
      }

      const sourceForAsset = (asset: ProjectAsset): AssetSourceMetadata | undefined => {
        if (typeof options.source === 'function') {
          return options.source(asset)
        }
        return options.source
      }

      const internalForAsset = (asset: ProjectAsset): boolean | undefined => {
        if (typeof options.internal === 'undefined') {
          return undefined
        }
        if (typeof options.internal === 'function') {
          return Boolean(options.internal(asset))
        }
        return Boolean(options.internal)
      }

      const editorOnlyForAsset = (asset: ProjectAsset): boolean | undefined => {
        if (typeof options.isEditorOnly === 'undefined') {
          return shouldAssetDefaultToEditorOnly(asset) ? true : undefined
        }
        if (typeof options.isEditorOnly === 'function') {
          return Boolean(options.isEditorOnly(asset))
        }
        return Boolean(options.isEditorOnly)
      }

      const { nextCatalog, nextAssetRegistry, registeredAssets } = upsertAssetsIntoCatalogAndIndex(
        this.assetCatalog,
        this.assetRegistry,
        normalizedAssets,
        { categoryIdForAsset, sourceForAsset, internalForAsset, editorOnlyForAsset },
      )

      if (!registeredAssets.length) {
        return []
      }

      this.applyCatalogUpdate(nextCatalog, {
        nextAssetRegistry,
        preferredDirectoryId: resolveManifestDirectoryIdFromProjectDirectoryId(this.assetManifest, this.activeDirectoryId),
      })

      if (options.autoSave !== false) {
        // Persist scene immediately after registering new assets so they survive reload.
        void this.saveActiveScene({ force: true }).catch(() => {})
      }

      return registeredAssets
    },

    registerAsset(
      asset: ProjectAsset,
      options: {
        categoryId?: string
        source?: AssetSourceMetadata
        internal?: boolean
        isEditorOnly?: boolean
        commitOptions?: { updateNodes?: boolean }
        autoSave?: boolean
      } = {},
    ) {
      const categoryId = options.categoryId ?? determineAssetCategoryId(asset)
      const registered = this.registerAssets([asset], {
        categoryId,
        source: options.source,
        internal: options.internal,
        isEditorOnly: options.isEditorOnly,
        commitOptions: options.commitOptions,
        autoSave: options.autoSave,
      })
      return registered[0] ?? { ...asset }
    },
    ensureProjectAssetRegistered(
      asset: ProjectAsset,
      options: {
        providerId?: string
        packagePathSegments?: string[]
        categoryId?: string
        source?: AssetSourceMetadata
        commitOptions?: { updateNodes?: boolean }
        autoSave?: boolean
      } = {},
    ): ProjectAsset {
      return this.ensureSceneAssetRegistered(asset, {
        providerId: options.providerId,
        packagePathSegments: options.packagePathSegments,
        categoryId: options.categoryId,
        source: options.source,
        commitOptions: options.commitOptions ?? { updateNodes: false },
        autoSave: options.autoSave,
      })
    },
    async cleanUnusedAssets(): Promise<{ removedAssetIds: string[] }> {
      if (!this.currentSceneId) {
        return { removedAssetIds: [] }
      }

      normalizeCurrentSceneMeta(this)
      const document = buildSceneDocumentFromState(this)
      const retainedAssetIds = collectRetainedAssetIdsForSceneCleanup(document, this.assetCatalog)
      const directReferenceAssetIds = collectDirectSceneAssetReferenceIds(document)
      const configRootAssetIds = new Set<string>(directReferenceAssetIds)
      collectEditorOnlyConfigAssetIdsFromCatalog(this.assetCatalog).forEach((assetId) => configRootAssetIds.add(assetId))
      const configDependencyAssetIds = await collectTransitiveConfigDependencyAssetIds(
        configRootAssetIds,
        this.assetCatalog,
        {
          loadPrefab: (assetId) => this.loadNodePrefab(assetId),
          loadConfigAssetText: (assetId) => loadConfigAssetTextForDependencyTraversal(assetId, this.assetCatalog),
        },
      )
      configDependencyAssetIds.forEach((assetId) => retainedAssetIds.add(assetId))
      const {
        nextCatalog,
        removedAssetIds,
        catalogChanged,
      } = pruneAssetCatalogByRetainedIds(this.assetCatalog, retainedAssetIds)
      const nextAssetRegistry = filterAssetRegistryByCatalog(this.assetRegistry, nextCatalog)
      const registryChanged = !areSceneAssetRegistriesEqual(this.assetRegistry, nextAssetRegistry)

      const shouldResetSelection = this.selectedAssetId ? !retainedAssetIds.has(this.selectedAssetId) : false

      if (!catalogChanged && !registryChanged) {
        return { removedAssetIds: [] }
      }

      this.applyCatalogUpdate(nextCatalog, registryChanged ? { nextAssetRegistry } : undefined)
      if (shouldResetSelection) {
        this.selectedAssetId = null
      }
      this.ensureActiveDirectoryAndSelectionValid()

      commitSceneSnapshot(this, { updateNodes: false })

      return { removedAssetIds }
    },
    async cleanUnusedAssetsByIds(candidateAssetIds: Iterable<string>): Promise<{ removedAssetIds: string[] }> {
      if (!this.currentSceneId) {
        return { removedAssetIds: [] }
      }

      const normalizedCandidateIds = Array.from(new Set(
        Array.from(candidateAssetIds ?? [])
          .map((assetId) => typeof assetId === 'string' ? assetId.trim() : '')
          .filter((assetId) => assetId.length > 0),
      ))
      if (!normalizedCandidateIds.length) {
        return { removedAssetIds: [] }
      }

      normalizeCurrentSceneMeta(this)
      const document = buildSceneDocumentFromState(this)
      const retainedAssetIds = collectRetainedAssetIdsForSceneCleanup(document, this.assetCatalog)
      const directReferenceAssetIds = collectDirectSceneAssetReferenceIds(document)
      const configRootAssetIds = new Set<string>(directReferenceAssetIds)
      collectEditorOnlyConfigAssetIdsFromCatalog(this.assetCatalog).forEach((assetId) => configRootAssetIds.add(assetId))
      const configDependencyAssetIds = await collectTransitiveConfigDependencyAssetIds(
        configRootAssetIds,
        this.assetCatalog,
        {
          loadPrefab: (assetId) => this.loadNodePrefab(assetId),
          loadConfigAssetText: (assetId) => loadConfigAssetTextForDependencyTraversal(assetId, this.assetCatalog),
        },
      )
      configDependencyAssetIds.forEach((assetId) => retainedAssetIds.add(assetId))

      const removableCandidateIds = new Set(
        normalizedCandidateIds.filter((assetId) => !retainedAssetIds.has(assetId) && !directReferenceAssetIds.has(assetId)),
      )
      if (!removableCandidateIds.size) {
        return { removedAssetIds: [] }
      }

      const nextCatalog: Record<string, ProjectAsset[]> = {}
      const removedAssetIds: string[] = []
      let catalogChanged = false

      Object.entries(this.assetCatalog).forEach(([categoryId, list]) => {
        const filtered = list.filter((asset) => {
          const remove = removableCandidateIds.has(asset.id)
          if (remove) {
            removedAssetIds.push(asset.id)
          }
          return !remove
        })
        if (filtered.length !== list.length) {
          catalogChanged = true
        }
        nextCatalog[categoryId] = filtered
      })

      if (!catalogChanged) {
        const nextAssetRegistry = filterAssetRegistryByCatalog(this.assetRegistry, nextCatalog)
        const registryChanged = !areSceneAssetRegistriesEqual(this.assetRegistry, nextAssetRegistry)
        if (!registryChanged) {
          return { removedAssetIds: [] }
        }
        this.applyCatalogUpdate(nextCatalog, { nextAssetRegistry })
        if (this.selectedAssetId && removableCandidateIds.has(this.selectedAssetId)) {
          this.selectedAssetId = null
        }
        this.ensureActiveDirectoryAndSelectionValid()

        commitSceneSnapshot(this, { updateNodes: false })

        return { removedAssetIds }
      }

      this.applyCatalogUpdate(nextCatalog)
      if (this.selectedAssetId && removableCandidateIds.has(this.selectedAssetId)) {
        this.selectedAssetId = null
      }
      this.ensureActiveDirectoryAndSelectionValid()

      commitSceneSnapshot(this, { updateNodes: false })

      return { removedAssetIds }
    },
    async syncAssetRegistryEntry(asset: ProjectAsset, source?: AssetSourceMetadata) {
      if (!asset?.id) {
        return
      }

      try {
        const entry = buildRegistryEntryFromSource(asset, source)
        if (!entry) {
          return
        }

        const prev = this.assetRegistry[asset.id]
        const unchanged = prev
          && prev.sourceType === entry.sourceType
          && JSON.stringify(prev) === JSON.stringify(entry)
        if (unchanged) {
          return
        }

        this.assetRegistry = {
          ...this.assetRegistry,
          [asset.id]: entry,
        }
        commitSceneSnapshot(this, { updateNodes: false })
      } catch (error) {
        console.warn('Failed to synchronize asset registry entry for asset', asset.id, error)
      }
    },
    async createLocalAssetDataUrl(asset: ProjectAsset): Promise<string | null> {
      const assetId = asset?.id?.trim()
      if (!assetId) {
        return null
      }
      const assetCache = useAssetCacheStore()
      let entry = assetCache.hasCache(assetId) ? assetCache.getEntry(assetId) : null
      if (!entry || entry.status !== 'cached' || !entry.blob) {
        entry = await assetCache.ensureAssetEntry(assetId, { asset })
      }
      const blob = entry?.blob ?? null
      if (!blob) {
        return null
      }

      const mimeType = entry?.mimeType ?? blob.type ?? ''
      const assetType = asset.type
      const isSupportedMedia = mimeType.startsWith('image/') || mimeType.startsWith('video/') || assetType === 'image' || assetType === 'texture'
      if (!isSupportedMedia) {
        return null
      }

      try {
        return await blobToDataUrl(blob)
      } catch (error) {
        console.warn('Failed to serialize local asset to data URL', assetId, error)
        return null
      }
    },
    async registerPrefabAssetFromData(
      prefabData: NodePrefabData,
      serialized: string,
      options: { assetId?: string | null; select?: boolean } = {},
    ): Promise<ProjectAsset> {
      return prefabActions.registerPrefabAssetFromData(this as unknown as PrefabStoreLike, prefabData, serialized, options)
    },
    async saveNodePrefab(nodeId: string, options: { assetId?: string; name?: string; select?: boolean } = {}): Promise<ProjectAsset> {
      return prefabActions.saveNodePrefab(this as unknown as PrefabStoreLike, nodeId, options)
    },
    async importPrefabAssetFromClipboard(serialized: string): Promise<ProjectAsset | null> {
      return prefabActions.importPrefabAssetFromClipboard(this as unknown as PrefabStoreLike, serialized)
    },
    async loadNodePrefab(assetId: string): Promise<NodePrefabData> {
      return prefabActions.loadNodePrefab(this as unknown as PrefabStoreLike, assetId)
    },
    async preparePrefabAsset(
      assetId: string,
      options: {
        providerId?: string | null
        prefabAssetIdForDownloadProgress?: string | null
      } = {},
    ): Promise<NodePrefabData> {
      return prefabActions.preparePrefabAsset(this as unknown as PrefabStoreLike, assetId, options)
    },
    async ensurePrefabDependencies(
      assetIds: string[],
      options: {
        providerId?: string | null
        prefabAssetIdForDownloadProgress?: string | null
        prefabAssetRegistry?: Record<string, SceneAssetRegistryEntry> | null
      } = {},
    ) {
      return prefabActions.ensurePrefabDependencies(this as unknown as PrefabStoreLike, assetIds, options)
    },
    async instantiatePrefabData(
      prefab: NodePrefabData,
      options: {
        sourceAssetId?: string | null
        dependencyAssetIds?: string[]
        runtimeSnapshots?: Map<string, Object3D>
        position?: THREE.Vector3 | null
        providerId?: string | null
        prefabAssetIdForDownloadProgress?: string | null
      } = {},
    ): Promise<SceneNode> {
      return prefabActions.instantiatePrefabData(this as unknown as PrefabStoreLike, prefab, options)
    },
    syncComponentSubtree(node: SceneNode) {
        componentManager.syncNode(node)
        if (node.children?.length) {
          node.children.forEach(this.syncComponentSubtree.bind(this))
        }
      },
    async instantiateNodePrefabAsset(
      assetId: string,
      position?: THREE.Vector3,
      options: { parentId?: string | null; rotation?: THREE.Vector3 | null } = {},
    ): Promise<SceneNode> {
      return prefabActions.instantiateNodePrefabAsset(this as unknown as PrefabStoreLike, assetId, position, options)
    },

    observePrefabDownloadForNode(nodeId: string, prefabAssetId: string) {
      return prefabActions.observePrefabDownloadForNode(this as unknown as PrefabStoreLike, nodeId, prefabAssetId)
    },

    async spawnPrefabWithPlaceholder(
      assetId: string,
      position: THREE.Vector3 | null,
      options: { parentId?: string | null; placeAtParentOrigin?: boolean; rotation?: THREE.Vector3 | null } = {},
    ): Promise<SceneNode> {
      return prefabActions.spawnPrefabWithPlaceholder(this as unknown as PrefabStoreLike, assetId, position, options)
    },
    async saveBehaviorPrefab(payload: {
      name: string
      action: BehaviorEventType
      sequence: SceneBehavior[]
    }): Promise<ProjectAsset> {
      return prefabActions.saveBehaviorPrefab(this as unknown as PrefabStoreLike, payload)
    },

    async saveLodPreset(payload: {
      name: string
      props: LodComponentProps
      select?: boolean
    }): Promise<ProjectAsset> {
      return lodPresetActions.saveLodPreset(this as any, payload)
    },

    findWallPresetAssetByFilename(filename: string): ProjectAsset | null {
      return wallPresetActions.findWallPresetAssetByFilename(this as any, filename)
    },

    async saveWallPreset(payload: {
      name: string
      nodeId?: string | null
      assetId?: string | null
      select?: boolean
    }): Promise<ProjectAsset> {
      return wallPresetActions.saveWallPreset(this as any, payload)
    },

    async loadWallPreset(assetId: string): Promise<WallPresetData> {
      return wallPresetActions.loadWallPreset(this as any, assetId)
    },

    async applyWallPresetToNode(
      nodeId: string,
      assetId: string,
      presetData?: WallPresetData | null,
    ): Promise<WallComponentProps> {
      return wallPresetActions.applyWallPresetToNode(this as any, nodeId, assetId, presetData)
    },

    async applyWallPresetToSelectedWall(assetId: string): Promise<void> {
      await wallPresetActions.applyWallPresetToSelectedWall(this as any, assetId)
    },

    findFloorPresetAssetByFilename(filename: string): ProjectAsset | null {
      return floorPresetActions.findFloorPresetAssetByFilename(this as any, filename)
    },

    async saveFloorPreset(payload: {
      name: string
      nodeId?: string | null
      assetId?: string | null
      select?: boolean
    }): Promise<ProjectAsset> {
      return floorPresetActions.saveFloorPreset(this as any, payload)
    },

    async loadFloorPreset(assetId: string): Promise<FloorPresetData> {
      return floorPresetActions.loadFloorPreset(this as any, assetId)
    },

    async applyFloorPresetToNode(
      nodeId: string,
      assetId: string,
      presetData?: FloorPresetData | null,
    ): Promise<FloorComponentProps> {
      return floorPresetActions.applyFloorPresetToNode(this as any, nodeId, assetId, presetData)
    },

    async applyFloorPresetToSelectedFloor(assetId: string): Promise<void> {
      await floorPresetActions.applyFloorPresetToSelectedFloor(this as any, assetId)
    },

    findLandformPresetAssetByFilename(filename: string): ProjectAsset | null {
      return landformPresetActions.findLandformPresetAssetByFilename(this as any, filename)
    },

    async saveLandformPreset(payload: {
      name: string
      nodeId?: string | null
      assetId?: string | null
      select?: boolean
    }): Promise<ProjectAsset> {
      return landformPresetActions.saveLandformPreset(this as any, payload)
    },

    async loadLandformPreset(assetId: string): Promise<LandformPresetData> {
      return landformPresetActions.loadLandformPreset(this as any, assetId)
    },

    async applyLandformPresetToNode(
      nodeId: string,
      assetId: string,
      presetData?: LandformPresetData | null,
    ): Promise<LandformComponentProps> {
      return landformPresetActions.applyLandformPresetToNode(this as any, nodeId, assetId, presetData)
    },

    async applyLandformPresetToSelectedLandform(assetId: string): Promise<void> {
      await landformPresetActions.applyLandformPresetToSelectedLandform(this as any, assetId)
    },

    findRoadPresetAssetByFilename(filename: string): ProjectAsset | null {
      return roadPresetActions.findRoadPresetAssetByFilename(this as any, filename)
    },

    async saveRoadPreset(payload: {
      name: string
      nodeId?: string | null
      assetId?: string | null
      select?: boolean
    }): Promise<ProjectAsset> {
      return roadPresetActions.saveRoadPreset(this as any, payload)
    },

    async loadRoadPreset(assetId: string): Promise<RoadPresetData> {
      return roadPresetActions.loadRoadPreset(this as any, assetId)
    },

    async applyRoadPresetToNode(
      nodeId: string,
      assetId: string,
      presetData?: RoadPresetData | null,
    ): Promise<RoadComponentProps> {
      return roadPresetActions.applyRoadPresetToNode(this as any, nodeId, assetId, presetData)
    },

    async applyRoadPresetToSelectedRoad(assetId: string): Promise<void> {
      await roadPresetActions.applyRoadPresetToSelectedRoad(this as any, assetId)
    },

    async loadLodPreset(assetId: string): Promise<LodPresetData> {
      return lodPresetActions.loadLodPreset(this as any, assetId)
    },

    async prepareLodAsset(assetOrId: ProjectAsset | string): Promise<PreparedLodAssetResult> {
      return lodPresetActions.prepareLodAsset(this as any, assetOrId)
    },

    async applyLodPresetToNode(nodeId: string, assetId: string): Promise<LodPresetData> {
      return lodPresetActions.applyLodPresetToNode(this as any, nodeId, assetId)
    },
    async loadBehaviorPrefab(assetId: string): Promise<BehaviorPrefabData> {
      return prefabActions.loadBehaviorPrefab(this as unknown as PrefabStoreLike, assetId)
    },
    async applyBehaviorPrefabToNode(
      nodeId: string,
      assetId: string,
    ): Promise<{ sequenceId: string; sequence: SceneBehavior[]; action: BehaviorEventType; name: string } | null> {
      return prefabActions.applyBehaviorPrefabToNode(this as unknown as PrefabStoreLike, nodeId, assetId)
    },
    copyPackageAssetToAssets(
      providerId: string,
      asset: ProjectAsset,
      options: { packagePathSegments?: string[]; internal?: boolean } = {},
    ): ProjectAsset {
      return this.copyPackageAssetsToAssets(providerId, [asset], options)[0] ?? asset
    },

    copyPackageAssetsToAssets(
      providerId: string,
      assets: ProjectAsset[],
      options: { packagePathSegments?: string[]; packagePathByAssetId?: Record<string, string[]>; internal?: boolean } = {},
    ): ProjectAsset[] {
      const normalized = Array.isArray(assets)
        ? assets
            .filter((asset) => asset && typeof asset.id === 'string' && asset.id.trim().length > 0)
            .map((asset) => ({ ...asset, id: asset.id.trim() }))
        : []
      if (!normalized.length) {
        return []
      }

      const resolved: ProjectAsset[] = []
      const toRegister: Array<{ asset: ProjectAsset; originalAssetId: string; packagePathSegments: string[] }> = []
      const targetCategoryIdByAssetId = new Map<string, string>()
      const packagePathByAssetId: Record<string, string[]> = {}

      const findExistingByPackageLookupKey = (lookupKey: string): ProjectAsset | null => {
        for (const [existingAssetId, entry] of Object.entries(this.assetRegistry ?? {})) {
          if (entry?.sourceType !== 'package') {
            continue
          }
          const zipPath = typeof entry.zipPath === 'string' ? entry.zipPath.trim() : ''
          if (!zipPath || zipPath !== lookupKey) {
            continue
          }
          const existingAsset = this.findAssetInCatalog(existingAssetId)
          if (existingAsset) {
            return existingAsset
          }
        }
        return null
      }

      const resolvePackagePathSegments = (assetId: string): string[] => {
        const currentAsset = normalized.find((entry) => entry.id === assetId) ?? null
        if (currentAsset && isServerBackedProviderId(providerId)) {
          const categorySegments = extractServerCategoryMirrorSegments(currentAsset)
          if (categorySegments.length) {
            return categorySegments
          }
        }
        if (options.packagePathByAssetId && Array.isArray(options.packagePathByAssetId[assetId])) {
          return options.packagePathByAssetId[assetId]!
        }
        if (Array.isArray(options.packagePathSegments)) {
          return options.packagePathSegments
        }
        const derived = this.getPackageAssetPathSegments(providerId, assetId)
        return derived.length ? derived : []
      }

      normalized.forEach((asset) => {
        if (isServerBackedProviderId(providerId)) {
          // Only skip registration when the asset already exists in scene assets.
          const existingServerAsset = this.findAssetInCatalog(asset.id)
          if (existingServerAsset) {
            resolved.push(existingServerAsset)
            return
          }
        }

        const mapKey = `${providerId}::${asset.id}`
        const existingAsset = findExistingByPackageLookupKey(mapKey)
        if (existingAsset) {
          resolved.push(existingAsset)
          return
        }

        const packagePathSegments = resolvePackagePathSegments(asset.id)
        const targetCategoryId = this.resolvePackageMirrorDirectoryId(providerId, packagePathSegments)
        targetCategoryIdByAssetId.set(asset.id, targetCategoryId)
        packagePathByAssetId[asset.id] = [...packagePathSegments]

        toRegister.push({
          originalAssetId: asset.id,
          packagePathSegments,
          asset: {
            ...asset,
            gleaned: true,
          },
        })
      })

      if (toRegister.length) {
        const registered = this.registerAssets(toRegister.map((entry) => entry.asset), {
          categoryId: (asset) => targetCategoryIdByAssetId.get(asset.id) ?? determineAssetCategoryId(asset),
          source: (asset) => {
            if (isServerBackedProviderId(providerId)) {
              return createServerAssetSource(asset.id)
            }
            return {
              type: 'package',
              providerId,
              originalAssetId: asset.id,
              packagePathSegments: packagePathByAssetId[asset.id] ?? [],
            }
          },
          internal: options.internal,
          commitOptions: { updateNodes: false },
        })
        resolved.push(...registered)
      }

      return resolved
    },
    async deleteProjectAssets(assetIds: string[]): Promise<string[]> {
      const uniqueIds = Array.from(
        new Set(
          assetIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
        ),
      )
      if (!uniqueIds.length) {
        return []
      }

      const catalogAssets = this.collectCatalogAssetMap()

      const deletableIds = uniqueIds.filter((id) => {
        const asset = catalogAssets.get(id)
        if (!asset) {
          return false
        }
        return asset.internal !== true
      })
      if (!deletableIds.length) {
        return []
      }

      const materialAssetIds: string[] = []
      const nonMaterialAssetIds: string[] = []
      deletableIds.forEach((assetId) => {
        const asset = catalogAssets.get(assetId)
        if (asset?.type === 'material') {
          materialAssetIds.push(assetId)
        } else {
          nonMaterialAssetIds.push(assetId)
        }
      })

      const assetIdSet = new Set(deletableIds)
      const assetCache = useAssetCacheStore()

      materialAssetIds.forEach((materialId) => {
        this.deleteMaterial(materialId)
      })

      if (nonMaterialAssetIds.length) {
        const assetNodeMap = collectNodesByAssetId(this.nodes)
        const nodeIdsToRemove: string[] = []
        nonMaterialAssetIds.forEach((assetId) => {
          const nodes = assetNodeMap.get(assetId)
          if (nodes?.length) {
            nodes.forEach((node) => {
              nodeIdsToRemove.push(node.id)
            })
          }
        })
        if (nodeIdsToRemove.length) {
          this.removeSceneNodes(nodeIdsToRemove)
        }
      }

      const nextCatalog: Record<string, ProjectAsset[]> = {}
      Object.entries(this.assetCatalog).forEach(([categoryId, list]) => {
        nextCatalog[categoryId] = list
          .filter((asset) => !assetIdSet.has(asset.id))
          .map((asset) => ({ ...asset }))
      })

      // Apply catalog update and refresh project tree
      this.applyCatalogUpdate(nextCatalog)
      this.ensureActiveDirectoryAndSelectionValid()
      if (this.selectedAssetId && assetIdSet.has(this.selectedAssetId)) {
        this.selectedAssetId = null
      }

      nonMaterialAssetIds.forEach((assetId) => {
        assetCache.removeCache(assetId)
      })

      if (deletableIds.length) {
        commitSceneSnapshot(this, { updateNodes: false })
        // Persist scene immediately after deleting assets
        void this.saveActiveScene({ force: true }).catch(() => {})
      }

      return deletableIds
    },
    replaceLocalAssetWithServerAsset(
      localAssetId: string,
      remoteAsset: ProjectAsset,
      options: { source?: AssetSourceMetadata } = {},
    ): ProjectAsset | null {
      const localAsset = this.findAssetInCatalog(localAssetId)
      if (!localAsset) {
        return null
      }

      const storedAsset: ProjectAsset = {
        ...remoteAsset,
        gleaned: false,
      }
      if (!storedAsset.fileKey && !storedAsset.downloadUrl.trim().length) {
        throw new Error(`Uploaded asset \"${storedAsset.name}\" is missing a downloadable server URL`)
      }
      const nextCategoryId = determineAssetCategoryId(storedAsset)
      const previousCategoryId =
        (typeof localAsset.categoryId === 'string' && localAsset.categoryId.trim().length
          ? localAsset.categoryId.trim()
          : null)
        ?? nextCategoryId

      const nextCatalog = { ...this.assetCatalog }
      const previousList = nextCatalog[previousCategoryId] ?? []
      nextCatalog[previousCategoryId] = previousList.filter((asset) => asset.id !== localAssetId)

      const targetList = nextCatalog[nextCategoryId] ?? []
      nextCatalog[nextCategoryId] = [...targetList.filter((asset) => asset.id !== storedAsset.id), storedAsset]

      const nextAssetRegistry = { ...this.assetRegistry }
      delete nextAssetRegistry[localAssetId]
      const replacementRegistryEntry = buildRegistryEntryFromSource(
        storedAsset,
        options.source ?? createServerAssetSource(remoteAsset.id),
      )
      if (replacementRegistryEntry) {
        nextAssetRegistry[storedAsset.id] = replacementRegistryEntry
      }

      // Atomically apply catalog/index/registry and rebuild project tree
      this.applyCatalogUpdate(nextCatalog, { nextAssetRegistry })

      replaceAssetIdInMaterials(this.materials, localAssetId, storedAsset.id)
      const nodeReplacement = replaceAssetIdInNodes(this.nodes, localAssetId, storedAsset.id)
      this.materials = [...this.materials]
      if (nodeReplacement.componentReferencesChanged) {
        componentManager.syncScene(this.nodes)
      }
      this.queueSceneStructurePatch('replaceAssetIdInNodes')

      if (storedAsset.type === 'material') {
        void this.syncLocalMaterialDependencyRegistryEntries(storedAsset.id)
      }

      if (this.selectedAssetId === localAssetId) {
        this.selectedAssetId = storedAsset.id
      }
      if (this.draggingAssetId === localAssetId) {
        this.draggingAssetId = storedAsset.id
      }

      commitSceneSnapshot(this, { updateNodes: true })
      // Persist scene after replacing a local asset with a server asset
      void this.saveActiveScene({ force: true }).catch(() => {})
      return storedAsset
    },
    setResourceProviderId(providerId: string) {
      if (this.resourceProviderId === providerId) {
        return
      }
      this.resourceProviderId = providerId
    },
    setCameraState(camera: SceneCameraState) {
      this.camera = cloneCameraState(camera)
    },
    resetCameraState() {
      this.camera = cloneCameraState(defaultCameraState)
    },
    setViewportSettings(partial: Partial<SceneViewportSettings>) {
      const next = cloneViewportSettings({ ...this.viewportSettings, ...partial })
      if (viewportSettingsEqual(this.viewportSettings, next)) {
        return
      }
      this.viewportSettings = next
      commitSceneSnapshot(this, { updateNodes: false })
    },
    setViewportGridVisible(visible: boolean) {
      this.setViewportSettings({ showGrid: visible })
    },
    toggleViewportGridVisible() {
      this.setViewportGridVisible(!this.viewportSettings.showGrid)
    },
    setViewportAxesVisible(visible: boolean) {
      this.setViewportSettings({ showAxes: visible })
    },
    toggleViewportAxesVisible() {
      this.setViewportAxesVisible(!this.viewportSettings.showAxes)
    },

    setViewportSnapMode(mode: SceneViewportSnapMode) {
      if (!isViewportSnapMode(mode)) {
        return
      }
      this.setViewportSettings({ snapMode: mode })
    },
    toggleViewportVertexSnap() {
      const next: SceneViewportSnapMode = this.viewportSettings.snapMode === 'vertex' ? 'off' : 'vertex'
      this.setViewportSnapMode(next)
    },
    setViewportSnapThresholdPx(value: number) {
      this.setViewportSettings({ snapThresholdPx: normalizeSnapThresholdPx(value) })
    },
    setShadowsEnabled(enabled: boolean) {
      const next = normalizeShadowsEnabledInput(enabled)
      if (this.shadowsEnabled === next) {
        return
      }
      this.shadowsEnabled = next
      commitSceneSnapshot(this, { updateNodes: false })
    },
    toggleShadowsEnabled() {
      this.setShadowsEnabled(!this.shadowsEnabled)
    },
    setViewportCameraProjection(mode: CameraProjection) {
      if (!isCameraProjectionMode(mode)) {
        return
      }
      this.setViewportSettings({ cameraProjection: mode })
    },
    toggleViewportCameraProjection() {
      const next: CameraProjection = this.viewportSettings.cameraProjection === 'perspective'
        ? 'orthographic'
        : 'perspective'
      this.setViewportCameraProjection(next)
    },
    setCameraControlMode(mode: CameraControlMode) {
      if (!isCameraControlMode(mode)) {
        return
      }
      this.setViewportSettings({ cameraControlMode: mode })
    },
    setPanelVisibility(panel: EditorPanel, visible: boolean) {
      if (this.panelVisibility[panel] === visible) {
        return
      }
      this.panelVisibility = {
        ...this.panelVisibility,
        [panel]: visible,
      }
    },
    setPanelPlacement(panel: EditorPanel, placement: PanelPlacement) {
      const safePlacement: PanelPlacement = placement === 'docked' ? 'docked' : 'floating'
      if (this.panelPlacement[panel] === safePlacement) {
        return
      }
      this.panelPlacement = {
        ...this.panelPlacement,
        [panel]: safePlacement,
      }
    },
    togglePanelPlacement(panel: EditorPanel) {
      const next = this.panelPlacement[panel] === 'floating' ? 'docked' : 'floating'
      this.setPanelPlacement(panel, next)
    },
    togglePanelVisibility(panel: EditorPanel) {
      this.setPanelVisibility(panel, !this.panelVisibility[panel])
    },

    requestCameraFocus(nodeId: string | null) {
      if (!nodeId) {
        return
      }
      this.cameraFocusNodeId = nodeId
      this.cameraFocusRequestId += 1
    },

    clearCameraFocusRequest(nodeId?: string | null) {
      if (nodeId && this.cameraFocusNodeId && nodeId !== this.cameraFocusNodeId) {
        return
      }
      this.cameraFocusNodeId = null
    },

    requestNodeHighlight(nodeId: string | null) {
      if (!nodeId) {
        return
      }
      this.nodeHighlightTargetId = nodeId
      this.nodeHighlightRequestId += 1
    },

    clearNodeHighlightRequest(nodeId?: string | null, token?: number) {
      if (typeof token === 'number' && token !== this.nodeHighlightRequestId) {
        return
      }
      if (nodeId && this.nodeHighlightTargetId && nodeId !== this.nodeHighlightTargetId) {
        return
      }
      this.nodeHighlightTargetId = null
    },

    recenterGroupNode(
      groupId: string,
      options: { captureHistory?: boolean; commit?: boolean; parentMap?: Map<string, string | null> } = {},
    ) {
      const group = findNodeById(this.nodes, groupId)
      if (!isGroupNode(group) || !group.children?.length) {
        return false
      }

      const parentMap = options.parentMap ?? buildParentMap(this.nodes)
      const parentId = parentMap.get(groupId) ?? null
      const parentWorldMatrix = parentId ? computeWorldMatrixForNode(this.nodes, parentId) : new Matrix4()
      if (!parentWorldMatrix) {
        return false
      }

      const childWorldMatrices = new Map<string, Matrix4>()
      group.children.forEach((child) => {
        const worldMatrix = computeWorldMatrixForNode(this.nodes, child.id)
        if (worldMatrix) {
          childWorldMatrices.set(child.id, worldMatrix)
        }
      })
      if (!childWorldMatrices.size) {
        return false
      }

      const boundingInfo = collectNodeBoundingInfo([group])
      const groupInfo = boundingInfo.get(groupId)
      if (!groupInfo || groupInfo.bounds.isEmpty()) {
        return false
      }

      const centerWorld = groupInfo.bounds.getCenter(new Vector3())
      const parentInverse = parentWorldMatrix.clone().invert()
      const newLocalPositionVec = centerWorld.clone().applyMatrix4(parentInverse)
      if (!Number.isFinite(newLocalPositionVec.x) || !Number.isFinite(newLocalPositionVec.y) || !Number.isFinite(newLocalPositionVec.z)) {
        newLocalPositionVec.set(0, 0, 0)
      }

      const rotationVec = group.rotation ?? createVector(0, 0, 0)
      const scaleVec = group.scale ?? createVector(1, 1, 1)
      const groupQuaternion = new Quaternion().setFromEuler(new Euler(rotationVec.x, rotationVec.y, rotationVec.z, 'XYZ'))
      const groupScale = new Vector3(scaleVec.x, scaleVec.y, scaleVec.z)
      const newGroupLocalPosition = new Vector3(newLocalPositionVec.x, newLocalPositionVec.y, newLocalPositionVec.z)
      const newGroupWorldMatrix = new Matrix4().multiplyMatrices(
        parentWorldMatrix,
        new Matrix4().compose(newGroupLocalPosition.clone(), groupQuaternion.clone(), groupScale.clone()),
      )
      const groupInverseWorldMatrix = newGroupWorldMatrix.clone().invert()

      const childAdjustments: Array<{ id: string; position: Vector3Like; rotation: Vector3Like; scale: Vector3Like }> = []
      childWorldMatrices.forEach((worldMatrix, childId) => {
        const localMatrix = new Matrix4().multiplyMatrices(groupInverseWorldMatrix, worldMatrix)
        const position = new Vector3()
        const quaternion = new Quaternion()
        const scale = new Vector3()
        localMatrix.decompose(position, quaternion, scale)
        const euler = new Euler().setFromQuaternion(quaternion, 'XYZ')
        const rotationVec3 = new Vector3(euler.x, euler.y, euler.z)
        childAdjustments.push({
          id: childId,
          position: toPlainVector(position),
          rotation: toPlainVector(rotationVec3),
          scale: toPlainVector(scale),
        })
      })

      if (!childAdjustments.length) {
        return false
      }

      if (options.captureHistory !== false) {
        this.captureHistorySnapshot()
      }

      group.position = toPlainVector(newGroupLocalPosition)
      componentManager.syncNode(group)

      childAdjustments.forEach((adjustment) => {
        const childNode = findNodeById(this.nodes, adjustment.id)
        if (!childNode) {
          return
        }
        childNode.position = adjustment.position
        childNode.rotation = adjustment.rotation
        childNode.scale = adjustment.scale
        componentManager.syncNode(childNode)
      })

      let patchQueued = false
      patchQueued = this.queueSceneNodePatch(groupId, ['transform'], { bumpVersion: false }) || patchQueued
      childAdjustments.forEach((adjustment) => {
        const landformRebuilt = rebuildLandformNodeForTerrain(this, adjustment.id)
        patchQueued = this.queueSceneNodePatch(adjustment.id, ['transform'], { bumpVersion: false }) || patchQueued
        if (landformRebuilt) {
          patchQueued = this.queueSceneNodePatch(adjustment.id, ['dynamicMesh'], { bumpVersion: false }) || patchQueued
        }
      })
      if (patchQueued) {
        this.bumpSceneNodePropertyVersion()
      }
      if (options.commit) {
        commitSceneSnapshot(this)
      }
      return true
    },

    recenterGroupAncestry(
      startGroupId: string | null,
      options: { captureHistory?: boolean; parentMap?: Map<string, string | null>; skipIds?: string[] } = {},
    ) {
      if (!startGroupId) {
        return false
      }
      const parentMap = options.parentMap ?? buildParentMap(this.nodes)
      const skipSet = new Set(Array.isArray(options.skipIds) ? options.skipIds : [])
      const visited = new Set<string>()
      let current: string | null = startGroupId
      let changed = false
      let isFirst = true
      const captureFirst = options.captureHistory === true

      while (current) {
        if (visited.has(current)) {
          break
        }

        const currentNode = findNodeById(this.nodes, current)
        const currentUserData = currentNode?.userData as Record<string, unknown> | null | undefined
        if (currentUserData?.[PLANNING_CONVERSION_ROOT_TAG] === true) {
          break
        }
        if (!skipSet.has(current)) {
          const recentered = this.recenterGroupNode(current, {
            captureHistory: captureFirst && isFirst,
            commit: false,
            parentMap,
          })
          if (recentered) {
            changed = true
          }
        }
        visited.add(current)
        current = parentMap.get(current) ?? null
        isFirst = false
      }

      return changed
    },
    applyTransformsToGroup(groupId: string) {
      if (!groupId) {
        return false
      }
      const group = findNodeById(this.nodes, groupId)
      if (!isGroupNode(group) || !group.children?.length) {
        return false
      }
      const parentMap = buildParentMap(this.nodes)
      const changed = this.recenterGroupAncestry(groupId, { captureHistory: true, parentMap })
      if (!changed) {
        return false
      }
      commitSceneSnapshot(this)
      return true
    },

    recenterGroupOrigin(groupId: string) {
      if (!groupId) {
        return false
      }
      const group = findNodeById(this.nodes, groupId)
      if (!isGroupNode(group) || !group.children?.length) {
        return false
      }
      const parentMap = buildParentMap(this.nodes)
      const recentered = this.recenterGroupNode(groupId, {
        captureHistory: true,
        commit: true,
        parentMap,
      })
      return Boolean(recentered)
    },

    isDescendant(ancestorId: string, maybeChildId: string) {
      if (!ancestorId || !maybeChildId) return false
      ensureSceneNodeIndex(this)
      return isDescendantByParentMap(ancestorId, maybeChildId)
    },
    nodeAllowsChildCreation(nodeId: string | null) {
      if (!nodeId) {
        return true
      }
      ensureSceneNodeIndex(this)
      const node = sceneNodeIndex.nodeById.get(nodeId) ?? null
      return allowsChildNodes(node)
    },

    getNodeById(nodeId: string | null | undefined): SceneNode | null {
      if (!nodeId) {
        return null
      }
      ensureSceneNodeIndex(this)
      return sceneNodeIndex.nodeById.get(nodeId) ?? null
    },

    getParentNodeId(nodeId: string | null | undefined): string | null {
      if (!nodeId) {
        return null
      }
      ensureSceneNodeIndex(this)
      if (!sceneNodeIndex.parentById.has(nodeId)) {
        return null
      }
      return sceneNodeIndex.parentById.get(nodeId) ?? null
    },

    isMultiuserNodeId(nodeId: string | null | undefined): boolean {
      if (!nodeId) {
        return false
      }
      const node = this.getNodeById(nodeId)
      return isMultiuserNode(node)
    },

    moveNode(payload: {
      nodeId: string
      targetId: string | null
      position: HierarchyDropPosition
      recenterSkipGroupIds?: string[]
    }) {
      const { nodeId, targetId, position } = payload
      if (!nodeId) return false
      if (targetId && nodeId === targetId) return false
      if (nodeId === GROUND_NODE_ID || nodeId === ENVIRONMENT_NODE_ID) {
        return false
      }

      const oldLocation = findNodeLocationInTree(this.nodes, nodeId)
      const oldSubtree = extractSubtreeSnapshot(this.nodes, nodeId)
      if (!oldLocation || !oldSubtree) {
        return false
      }

      const movingNode = findNodeById(this.nodes, nodeId)
      if (!movingNode) {
        return false
      }

      if (targetId && isDescendantNode(this.nodes, nodeId, targetId)) {
        return false
      }
      if (isMultiuserNode(movingNode) && targetId !== null && position === 'inside') {
        return false
      }

      if ((targetId === ENVIRONMENT_NODE_ID) && position === 'inside') {
        return false
      }

      const parentMap = buildParentMap(this.nodes)
      if (!parentMap.has(nodeId)) {
        return false
      }
      const oldParentId = parentMap.get(nodeId) ?? null

      let newParentId: string | null
      if (targetId === null) {
        newParentId = null
      } else if (position === 'inside') {
        newParentId = targetId
      } else {
        if (!parentMap.has(targetId)) {
          return false
        }
        newParentId = parentMap.get(targetId) ?? null
      }

      if (newParentId === ENVIRONMENT_NODE_ID) {
        return false
      }

      if (isProtagonistNode(movingNode) && newParentId !== null) {
        return false
      }

      let updatedLocal: { position: THREE.Vector3; rotation: THREE.Vector3; scale: THREE.Vector3 } | null = null

      if (newParentId && newParentId !== oldParentId) {
        const candidateParent = findNodeById(this.nodes, newParentId)
        if (!candidateParent || candidateParent.nodeType !== 'Group' || !allowsChildNodes(candidateParent)) {
          return false
        }
      }

      if (newParentId !== oldParentId) {
        const nodeWorldMatrix = computeWorldMatrixForNode(this.nodes, nodeId)
        if (!nodeWorldMatrix) {
          return false
        }

        let parentInverse = new Matrix4()
        if (newParentId) {
          const parentWorldMatrix = computeWorldMatrixForNode(this.nodes, newParentId)
          if (!parentWorldMatrix) {
            return false
          }
          parentInverse = parentInverse.copy(parentWorldMatrix).invert()
        } else {
          parentInverse.identity()
        }

        const localMatrix = new Matrix4().multiplyMatrices(parentInverse, nodeWorldMatrix)
        const positionVec = new Vector3()
        const rotationQuat = new Quaternion()
        const scaleVec = new Vector3()
        localMatrix.decompose(positionVec, rotationQuat, scaleVec)
        const euler = new Euler().setFromQuaternion(rotationQuat, 'XYZ')

        updatedLocal = {
          position: createVector(positionVec.x, positionVec.y, positionVec.z),
          rotation: createVector(euler.x, euler.y, euler.z),
          scale: createVector(scaleVec.x, scaleVec.y, scaleVec.z),
        }
      }

      const { tree, node } = detachNodeImmutable(this.nodes, nodeId)
      if (!node) return false

      if (updatedLocal) {
        node.position = updatedLocal.position
        node.rotation = updatedLocal.rotation
        node.scale = updatedLocal.scale
      }

      const inserted = insertNodeMutable(tree, targetId, node, position)
      if (!inserted) return false

      const newLocation = findNodeLocationInTree(tree, nodeId)
      if (!newLocation) {
        return false
      }

      const movingSubtreeIds = flattenNodeIds([oldSubtree])
      const transformTargetIds = collectRecenterTransformTargets(
        this.nodes,
        [oldParentId, newParentId],
        movingSubtreeIds,
      )
      const transformUndo = transformTargetIds.length
        ? createTransformHistoryEntry(this, transformTargetIds)
        : null

      const undoOps: SceneHistoryNodeStructureOp[] = [
        { type: 'remove', location: newLocation, nodeId },
        { type: 'insert', location: oldLocation, subtree: oldSubtree },
      ]
      const batchEntries: SceneHistoryEntry[] = [
        { kind: 'node-structure', ops: undoOps },
      ]
      if (transformUndo && transformUndo.kind === 'node-transform' && transformUndo.transforms.length) {
        batchEntries.push(transformUndo)
      }
      this.captureHistoryEntry({ kind: 'batch', entries: batchEntries })

      this.nodes = tree

      // Reparenting changes hierarchy topology. The viewport must reconcile parent-child
      // relationships immediately; a transform-only patch updates local values but does not
      // move existing Object3D instances under their new parent.
      this.queueSceneStructurePatch('moveNode')

      const postMoveParentMap = buildParentMap(this.nodes)
      if (oldParentId) {
        this.recenterGroupAncestry(oldParentId, {
          captureHistory: false,
          parentMap: postMoveParentMap,
          skipIds: payload.recenterSkipGroupIds,
        })
      }
      if (newParentId && newParentId !== oldParentId) {
        this.recenterGroupAncestry(newParentId, {
          captureHistory: false,
          parentMap: postMoveParentMap,
          skipIds: payload.recenterSkipGroupIds,
        })
      }
      commitSceneSnapshot(this)
      return true
    },

  addPlaceholderNode(
    asset: ProjectAsset,
    transform: { position: Vector3Like; rotation: Vector3Like; scale: Vector3Like },
    options: { parentId?: string | null } = {},
  ) {
      const id = generateUuid()
      let parentId = options.parentId ?? null
      if (parentId === ENVIRONMENT_NODE_ID) {
        parentId = null
      }
      if (parentId) {
        const parentNode = findNodeById(this.nodes, parentId)
        if (!allowsChildNodes(parentNode)) {
          parentId = null
        }
      }

      let position = cloneVector(transform.position)
      let rotation = cloneVector(transform.rotation)
      let scale = cloneVector(transform.scale)

      if (parentId) {
        const parentMatrix = computeWorldMatrixForNode(this.nodes, parentId)
        if (parentMatrix) {
          const worldPosition = new Vector3(transform.position.x, transform.position.y, transform.position.z)
          const worldScale = new Vector3(transform.scale.x, transform.scale.y, transform.scale.z)
          const worldQuaternion = new Quaternion().setFromEuler(
            new Euler(transform.rotation.x, transform.rotation.y, transform.rotation.z, 'XYZ'),
          )
          const worldMatrix = new Matrix4().compose(worldPosition, worldQuaternion, worldScale)
          const parentInverse = parentMatrix.clone().invert()
          const localMatrix = new Matrix4().multiplyMatrices(parentInverse, worldMatrix)
          const localPosition = new Vector3()
          const localQuaternion = new Quaternion()
          const localScale = new Vector3()
          localMatrix.decompose(localPosition, localQuaternion, localScale)
          const localEuler = new Euler().setFromQuaternion(localQuaternion, 'XYZ')
          position = cloneVector(localPosition)
          rotation = { x: localEuler.x, y: localEuler.y, z: localEuler.z }
          scale = cloneVector(localScale)
        } else {
          parentId = null
        }
      }

      const node: SceneNode = {
        id,
        name: asset.name,
        nodeType: 'Mesh',
        materials: [
          createNodeMaterial(createMaterialProps({
            color: '#90a4ae',
            opacity: 0.6,
            transparent: true,
          }))
        ],
        position,
        rotation,
        scale,
        visible: true,
        sourceAssetId: asset.id,
        isPlaceholder: true,
        downloadProgress: 0,
        downloadStatus: 'downloading',
        downloadError: null,
      }

      if (parentId) {
        const workingTree = [...this.nodes]
        const inserted = insertNodeMutable(workingTree, parentId, node, 'inside')
        if (inserted) {
          replaceSceneNodes(this, workingTree)
        } else {
          replaceSceneNodes(this, [node, ...this.nodes])
        }
      } else {
        replaceSceneNodes(this, [node, ...this.nodes])
      }
      this.setSelection([id])

      // A new node was inserted. Use incremental viewport updates.
      this.queueSceneNodePatch(id, ['transform', 'download'])

      return node
    },

    observeAssetDownloadForNode(nodeId: string, asset: ProjectAsset) {
      const assetCache = useAssetCacheStore()
      stopPlaceholderWatcher(nodeId)

      const stop = watch(
        () => {
          const entry = assetCache.entries[asset.id]
          if (!entry) {
            return null
          }
          return {
            status: entry.status,
            progress: entry.progress ?? 0,
            error: entry.error ?? null,
          }
        },
        (snapshot) => {
          const target = findNodeById(this.nodes, nodeId)
          if (!target) {
            stopPlaceholderWatcher(nodeId)
            return
          }

          if (!snapshot) {
            return
          }

          let changed = false

          if (target.downloadProgress !== snapshot.progress) {
            target.downloadProgress = snapshot.progress
            changed = true
          }

          if (target.downloadError !== snapshot.error) {
            target.downloadError = snapshot.error
            changed = true
          }

          if (snapshot.status === 'cached') {
            target.downloadStatus = 'ready'
            target.downloadProgress = 100
            changed = true
            stopPlaceholderWatcher(nodeId)
            this.queueSceneNodePatch(nodeId, ['download'])
            void this.finalizePlaceholderNode(nodeId, asset)
            return
          }

          if (snapshot.status === 'error') {
            target.downloadStatus = 'error'
            changed = true
            stopPlaceholderWatcher(nodeId)
            if (changed) {
              this.queueSceneNodePatch(nodeId, ['download'])
            }
            return
          }

          const nextStatus = snapshot.status === 'downloading' ? 'downloading' : 'idle'
          if (target.downloadStatus !== nextStatus) {
            target.downloadStatus = nextStatus
            changed = true
          }

          if (changed) {
            this.queueSceneNodePatch(nodeId, ['download'])
          }
        },
        { immediate: true },
      )

      placeholderDownloadWatchers.set(nodeId, stop)
    },

    async retryPlaceholderNodeDownload(nodeId: string): Promise<boolean> {
      const placeholder = findNodeById(this.nodes, nodeId)
      if (!placeholder || !placeholder.isPlaceholder) {
        return false
      }

      const assetId = typeof placeholder.sourceAssetId === 'string' ? placeholder.sourceAssetId : ''
      if (!assetId) {
        placeholder.downloadStatus = 'error'
        placeholder.downloadError = 'Missing resource ID, cannot retry'
        this.queueSceneNodePatch(nodeId, ['download'])
        return false
      }

      const asset = this.getAsset(assetId)
      if (!asset) {
        placeholder.downloadStatus = 'error'
        placeholder.downloadError = 'Resource not found, cannot retry'
        this.queueSceneNodePatch(nodeId, ['download'])
        return false
      }

      const assetCache = useAssetCacheStore()

      placeholder.downloadStatus = 'downloading'
      placeholder.downloadProgress = 0
      placeholder.downloadError = null
      this.queueSceneNodePatch(nodeId, ['download'])

      this.observeAssetDownloadForNode(nodeId, asset)
      assetCache.setError(asset.id, null)

      try {
        await assetCache.downloadProjectAsset(asset)
        return true
      } catch (error) {
        const target = findNodeById(this.nodes, nodeId)
        if (target) {
          target.downloadStatus = 'error'
          target.downloadError = (error as Error).message ?? 'Asset download failed'
          this.queueSceneNodePatch(nodeId, ['download'])
        }
        return false
      }
    },

    cancelAndDeletePlaceholderNode(nodeId: string): boolean {
      const node = findNodeById(this.nodes, nodeId)
      if (!node) {
        return false
      }

      const assetId = typeof node.sourceAssetId === 'string' ? node.sourceAssetId : null
      if (assetId) {
        const assetCache = useAssetCacheStore()
        assetCache.cancelDownload(assetId)
      }

      this.removeSceneNodes([nodeId])
      return true
    },

    async finalizePlaceholderNode(nodeId: string, asset: ProjectAsset) {
      const assetCache = useAssetCacheStore()
      const placeholder = findNodeById(this.nodes, nodeId)
      if (!placeholder) {
        return
      }

      try {
        const shouldCacheModelObject = asset.type === 'model'
        let modelGroup: ModelInstanceGroup | null = null
        let baseObject: Object3D | null = null

        if (shouldCacheModelObject) {
          const cachedGroup = getCachedModelObject(asset.id)
          if (cachedGroup) {
            modelGroup = cachedGroup
            baseObject = cachedGroup.object
          }
        }

        if (!baseObject) {
          const file = await assetCache.ensureAssetFile(asset.id, { asset })
          if (!file) {
            throw new Error('Resource not fully cached')
          }
          if (shouldCacheModelObject) {
            const loadedGroup = await getOrLoadModelObject(asset.id, () => loadObjectFromFile(file, asset.extension ?? undefined))
            modelGroup = loadedGroup
            baseObject = loadedGroup.object
            assetCache.releaseInMemoryBlob(asset.id)
          } else {
            baseObject = await loadObjectFromFile(file, asset.extension ?? undefined)
          }
        }

        if (!baseObject) {
          throw new Error('Failed to load resource')
        }

        const canUseInstancing = Boolean(modelGroup?.meshes.length) && !placeholder.importMetadata?.objectPath
        const workingObject = canUseInstancing ? null : baseObject.clone(true)
        const parentMap = buildParentMap(this.nodes)
        const parentId = parentMap.get(nodeId) ?? null
        const siblingSource = parentId
          ? (findNodeById(this.nodes, parentId)?.children ?? [])
          : this.nodes
        const placeholderIndex = siblingSource.findIndex((item) => item.id === nodeId)

        const worldMatrix = computeWorldMatrixForNode(this.nodes, nodeId) ?? composeNodeMatrix(placeholder)
        const parentWorldMatrix = parentId ? computeWorldMatrixForNode(this.nodes, parentId) : null

        const worldPosition = new Vector3()
        const worldQuaternion = new Quaternion()
        const worldScale = new Vector3()
        worldMatrix.decompose(worldPosition, worldQuaternion, worldScale)

        const metrics = canUseInstancing && modelGroup
          ? computeInstancedMetrics(modelGroup)
          : computeObjectMetrics(workingObject!)
        const minY = metrics.bounds.min.y
        const halfHeight = Math.abs(worldScale.y) * 0.5
        const anchorWorldY = worldPosition.y - halfHeight
        const finalWorldPosition = worldPosition.clone()
        if (Number.isFinite(minY)) {
          finalWorldPosition.y = anchorWorldY - minY + GROUND_CONTACT_EPSILON
        } else {
          finalWorldPosition.y = anchorWorldY
        }

        const finalWorldMatrix = new Matrix4().compose(finalWorldPosition, worldQuaternion, worldScale)
        const parentInverse = new Matrix4()
        if (parentWorldMatrix) {
          parentInverse.copy(parentWorldMatrix).invert()
        } else {
          parentInverse.identity()
        }

        const localMatrix = new Matrix4().multiplyMatrices(parentInverse, finalWorldMatrix)
        const localPosition = new Vector3()
        const localQuaternion = new Quaternion()
        const localScale = new Vector3()
        localMatrix.decompose(localPosition, localQuaternion, localScale)
        const localEuler = new Euler().setFromQuaternion(localQuaternion, 'XYZ')

        const newNodeId = generateUuid()
        const nodeType = resolveSceneNodeTypeFromObject(baseObject)
        const positionVector = toPlainVector(localPosition)
        const scaleVector = toPlainVector(localScale)
        const rotationVector: Vector3Like = { x: localEuler.x, y: localEuler.y, z: localEuler.z }

        const { tree, node: removedPlaceholder } = detachNodeImmutable(this.nodes, nodeId)
        if (!removedPlaceholder) {
          throw new Error('Placeholder node does not exist')
        }

        const newNode: SceneNode = {
          id: newNodeId,
          name: asset.name,
          nodeType,
          materials: [],
          position: positionVector,
          rotation: rotationVector,
          scale: scaleVector,
          visible: placeholder.visible ?? true,
          locked: placeholder.locked,
          sourceAssetId: asset.id,
        }

        if (removedPlaceholder.children?.length) {
          newNode.children = removedPlaceholder.children
        }

        const viewPointEvaluation = evaluateViewPointAttributes(undefined)
        const displayBoardEvaluation = evaluateDisplayBoardAttributes(viewPointEvaluation.sanitizedUserData, newNode.name)
        const guideboardEvaluation = evaluateGuideboardAttributes(displayBoardEvaluation.sanitizedUserData, newNode.name)
        const warpGateEvaluation = evaluateWarpGateAttributes(guideboardEvaluation.sanitizedUserData)
        newNode.userData = warpGateEvaluation.sanitizedUserData
        const componentMap = normalizeNodeComponents(newNode, placeholder.components, {
          attachDisplayBoard: displayBoardEvaluation.shouldAttachDisplayBoard,
          attachGuideboard: guideboardEvaluation.shouldAttachGuideboard,
          attachViewPoint: viewPointEvaluation.shouldAttachViewPoint,
          attachWarpGate: warpGateEvaluation.shouldAttachWarpGate,
          viewPointOverrides: viewPointEvaluation.componentOverrides,
        })
        if (componentMap) {
          newNode.components = componentMap
        }

        let runtimeObject: Object3D | null = null
        if (canUseInstancing && modelGroup) {
          runtimeObject = createInstancedRuntimeProxy(newNode, modelGroup)
        }
        if (!runtimeObject) {
          runtimeObject = workingObject
        }
        if (!runtimeObject) {
          throw new Error('Failed to prepare runtime object')
        }

        runtimeObject.name = newNode.name ?? runtimeObject.name
        prepareRuntimeObjectForNode(runtimeObject)
        tagObjectWithNodeId(runtimeObject, newNodeId)
        registerRuntimeObject(newNodeId, runtimeObject)
        componentManager.attachRuntime(newNode, runtimeObject)
        componentManager.syncNode(newNode)

        if (parentId) {
          const parent = findNodeById(tree, parentId)
          if (parent) {
            const children = parent.children ? [...parent.children] : []
            const actualIndex = placeholderIndex >= 0 ? placeholderIndex : children.length
            children.splice(actualIndex, 0, newNode)
            parent.children = children
          } else {
            const actualIndex = placeholderIndex >= 0 ? placeholderIndex : tree.length
            tree.splice(actualIndex, 0, newNode)
          }
        } else {
          const actualIndex = placeholderIndex >= 0 ? placeholderIndex : tree.length
          tree.splice(actualIndex, 0, newNode)
        }

        this.nodes = tree
        this.setSelection([newNodeId])

        // Avoid forcing a full scene graph reconcile. Incrementally remove the placeholder
        // and create the real node in the viewport.
        this.queueSceneRemovePatch([nodeId], 'finalizePlaceholderNode')
        this.queueSceneNodePatch(newNodeId, ['runtime'])

        assetCache.touch(asset.id)

        commitSceneSnapshot(this)
        } catch (error) {
        placeholder.isPlaceholder = true
        placeholder.downloadStatus = 'error'
        placeholder.downloadError = (error as Error).message ?? 'Failed to load resource'
        this.queueSceneNodePatch(nodeId, ['download'])
      }
    },

    async replaceNodeModelAsset(nodeId: string, assetId: string): Promise<boolean> {
      const node = findNodeById(this.nodes, nodeId)
      if (!node) {
        return false
      }
      const asset = this.getAsset(assetId)
      if (!asset || (asset.type !== 'model' && asset.type !== 'mesh')) {
        return false
      }

      const assetCache = useAssetCacheStore()
      await ensureModelAssetCached(assetCache, asset)

      const file = await assetCache.ensureAssetFile(asset.id, { asset })
      if (!file) {
            throw new Error('Model asset file unavailable')
          }

      const shouldCacheModelObject = asset.type === 'model' || asset.type === 'mesh'
      let modelGroup: ModelInstanceGroup | null = null
      let baseObject: Object3D | null = null

      if (shouldCacheModelObject) {
        const cached = getCachedModelObject(asset.id)
        if (cached) {
          modelGroup = cached
          baseObject = cached.object
        }
      }

      if (!baseObject) {
        if (shouldCacheModelObject) {
          const loaded = await getOrLoadModelObject(asset.id, () => loadObjectFromFile(file, asset.extension ?? undefined))
          modelGroup = loaded
          baseObject = loaded.object
          assetCache.releaseInMemoryBlob(asset.id)
        } else {
          baseObject = await loadObjectFromFile(file, asset.extension ?? undefined)
        }
      }

        if (!baseObject) {
        throw new Error('Failed to load model asset')
      }

      const canUseInstancing = Boolean(modelGroup?.meshes.length)
      const runtimeClone = canUseInstancing ? null : baseObject.clone(true)
      const nodeType = canUseInstancing ? 'Group' : resolveSceneNodeTypeFromObject(baseObject)

      let runtimeObject: Object3D | null = null
      if (canUseInstancing && modelGroup) {
        runtimeObject = createInstancedRuntimeProxy(node, modelGroup, asset.id)
      }
      runtimeObject = runtimeObject ?? runtimeClone

      if (!runtimeObject) {
        throw new Error('Model asset could not be applied to node')
      }

      runtimeObject.name = asset.name ?? runtimeObject.name
      prepareRuntimeObjectForNode(runtimeObject)

      this.captureHistorySnapshot()
      node.nodeType = nodeType
      node.sourceAssetId = asset.id
      node.dynamicMesh = undefined
      delete node.isPlaceholder
      delete node.downloadStatus
      delete node.downloadProgress
      delete node.downloadError
      delete node.importMetadata

      unregisterRuntimeObject(node.id)

      tagObjectWithNodeId(runtimeObject, node.id)
      registerRuntimeObject(node.id, runtimeObject)
      componentManager.attachRuntime(node, runtimeObject)
      componentManager.syncNode(node)

      this.queueSceneStructurePatch('replaceNodeModelAsset')

      assetCache.touch(asset.id)
      commitSceneSnapshot(this)
      return true
    },

    addLightNode(type: LightNodeType, options: { position?: THREE.Vector3; name?: string } = {}) {
      const preset = getLightPreset(type)
      const node = createLightNode({
        name: options.name ?? preset.name,
        type,
        color: preset.color,
        intensity: preset.intensity,
        position: options.position ?? preset.position,
        target: preset.target,
        extras: preset.extras,
      })

      this.captureHistorySnapshot()
      this.nodes = [node, ...this.nodes]
      this.setSelection([node.id])

      // SceneViewport only applies pending patches when `sceneNodePropertyVersion` bumps.
      // Queue a patch so the viewport incrementally creates the runtime light object.
      this.queueSceneNodePatch(node.id, ['transform', 'light'])

      commitSceneSnapshot(this)
      return node
    },

    async addModelNode(payload: {
      object?: Object3D
      asset?: ProjectAsset
      nodeId?: string
      nodeType?: SceneNodeType
      position?: THREE.Vector3
      baseY?: number
      name?: string
      sourceAssetId?: string
      rotation?: THREE.Vector3
      scale?: THREE.Vector3
      parentId?: string | null
      snapToGrid?: boolean
      skipGroundAlignment?: boolean
      editorFlags?: SceneNodeEditorFlags
      appendToParentEnd?: boolean
    }): Promise<SceneNode | null> {
      if (!payload.object && !payload.asset) {
        throw new Error('addModelNode requires either an object or an asset')
      }

      const baseRotation = {
        x: payload.rotation?.x ?? 0,
        y: payload.rotation?.y ?? 0,
        z: payload.rotation?.z ?? 0,
      }
      const baseScale = {
        x: payload.scale?.x ?? 1,
        y: payload.scale?.y ?? 1,
        z: payload.scale?.z ?? 1,
      }
      let rotation: Vector3Like = { ...baseRotation }
      let scale: Vector3Like = { ...baseScale }
      let targetParentId = payload.parentId ?? null
      if (targetParentId === ENVIRONMENT_NODE_ID) {
        targetParentId = null
      }
      const shouldSnapToGrid =
        payload.snapToGrid !== undefined ? payload.snapToGrid : !(payload.editorFlags?.ignoreGridSnapping)
      let runtimeSource: Object3D | null = payload.object ?? null
      let name = payload.name
      let sourceAssetId = payload.sourceAssetId
      let assetCache: ReturnType<typeof useAssetCacheStore> | null = null
      let registerAssetId: string | null = null
      let modelGroup: ModelInstanceGroup | null = null
      let canUseInstancing = false
      let metrics: ObjectMetrics | null = runtimeSource ? computeObjectMetrics(runtimeSource) : null

      
      if (payload.asset) {
        const asset = payload.asset
        if (asset.type !== 'model' && asset.type !== 'mesh') {
          return null
        }

        assetCache = useAssetCacheStore()
        const cached = getCachedModelObject(asset.id)
        if (cached) {
          modelGroup = cached
        } else {
          const file = await assetCache.ensureAssetFile(asset.id, { asset })
          if (!file) {
            throw new Error('Missing asset data in cache')
          }
          const baseObject = await getOrLoadModelObject(asset.id, () => loadObjectFromFile(file, asset.extension ?? undefined))
          assetCache.releaseInMemoryBlob(asset.id)
          modelGroup = baseObject
        }

        canUseInstancing = Boolean(modelGroup?.meshes.length)

        if (canUseInstancing && modelGroup) {
          runtimeSource = createInstancedPlaceholderObject(name ?? payload.asset.name, modelGroup)
          metrics = computeInstancedMetrics(modelGroup)
        } else if (modelGroup) {
          runtimeSource = modelGroup.object.clone(true)
          metrics = computeObjectMetrics(runtimeSource)
        }

        name = name ?? asset.name
        sourceAssetId = sourceAssetId ?? asset.id
        registerAssetId = asset.id
      } else {
        runtimeSource = payload.object!
        metrics = computeObjectMetrics(runtimeSource)
        name = name ?? runtimeSource.name ?? 'Imported Mesh'
      }

      if (!runtimeSource || !metrics) {
        throw new Error('Failed to prepare runtime object')
      }

      const minY = metrics.bounds.min.y
      const hasExplicitPosition = Boolean(payload.position)
      let spawnVector: Vector3
      if (payload.position) {
        spawnVector = payload.position.clone()
      } else {
        spawnVector = resolveSpawnPosition({
          baseY: payload.baseY ?? 0,
          radius: metrics.radius,
          localCenter: metrics.center,
          camera: this.camera,
          nodes: this.nodes,
          snapToGrid: shouldSnapToGrid,
        })
      }

      if (!payload.skipGroundAlignment && Number.isFinite(minY)) {
        spawnVector.y -= minY
        spawnVector.y += GROUND_CONTACT_EPSILON
      }

      if (hasExplicitPosition && payload.baseY !== undefined && Number.isFinite(payload.baseY)) {
        spawnVector.y += payload.baseY
      }

      let parentMatrix: Matrix4 | null = null
      if (targetParentId) {
        parentMatrix = computeWorldMatrixForNode(this.nodes, targetParentId)
        if (!parentMatrix) {
          targetParentId = null
        }
      }

      let localPosition = spawnVector.clone()
      if (parentMatrix) {
        const worldQuaternion = new Quaternion().setFromEuler(new Euler(baseRotation.x, baseRotation.y, baseRotation.z, 'XYZ'))
        const worldScale = new Vector3(baseScale.x, baseScale.y, baseScale.z)
        const worldMatrix = new Matrix4().compose(spawnVector.clone(), worldQuaternion, worldScale)
        const parentInverse = parentMatrix.clone().invert()
        const localMatrix = new Matrix4().multiplyMatrices(parentInverse, worldMatrix)
        const positionVec = new Vector3()
        const rotationQuat = new Quaternion()
        const scaleVec = new Vector3()
        localMatrix.decompose(positionVec, rotationQuat, scaleVec)
        const euler = new Euler().setFromQuaternion(rotationQuat, 'XYZ')
        localPosition = positionVec
        rotation = { x: euler.x, y: euler.y, z: euler.z }
        scale = { x: scaleVec.x, y: scaleVec.y, z: scaleVec.z }
      }

      const nodeType = payload.nodeType ?? (canUseInstancing ? 'Group' : resolveSceneNodeTypeFromObject(runtimeSource))

      this.captureHistorySnapshot()

      const node = this.addSceneNode({
        nodeId: payload.nodeId,
        nodeType,
        object: runtimeSource,
        name: name ?? runtimeSource.name ?? 'Imported Mesh',
        position: toPlainVector(localPosition),
        rotation,
        scale,
        sourceAssetId: sourceAssetId ?? undefined,
        parentId: targetParentId ?? undefined,
        editorFlags: payload.editorFlags,
        userData: clonePlainRecord(runtimeSource.userData as Record<string, unknown> | undefined),
      })

      if (registerAssetId && assetCache) {
        assetCache.touch(registerAssetId)
      }

      if (node && canUseInstancing && modelGroup) {
        applyInstancedRuntimeToNode(node, modelGroup)
      }

      // If caller requested the new node be appended to the end of its parent
      // (useful for drag/drop into the root), reorder the root list so the
      // newly created node appears at the end instead of the default prepend.
      if (node && payload.appendToParentEnd === true && targetParentId === null) {
        this.nodes = [...this.nodes.filter((n) => n.id !== node.id), node]
        commitSceneSnapshot(this)
      }

      return node
    },

    async importExternalSceneObject(object: Object3D, options: { sourceName?: string; sourceFile?: File } = {}): Promise<string[]> {
      if (!object) {
        return []
      }

      object.updateMatrixWorld(true)

      const assetCache = useAssetCacheStore()
      const fallbackName = options.sourceName && options.sourceName.trim().length
        ? options.sourceName.trim()
        : object.name?.trim() ?? 'Imported Scene'

      let modelAssetId: string | null = null

      if (options.sourceFile) {
        try {
          const ensured = await this.ensureLocalAssetFromFile(options.sourceFile, {
            type: 'model',
            name: fallbackName,
            description: options.sourceFile.name ?? undefined,
            previewColor: '#ffffff',
            gleaned: true,
            commitOptions: { updateNodes: false },
          })
          modelAssetId = ensured.asset.id
          assetCache.touch(modelAssetId)
        } catch (error) {
          console.warn('Failed to cache imported scene assets', error)
        }
      }

      const context: ExternalSceneImportContext = {
        assetCache,
        registerAsset: (asset, registerOptions) => this.registerAsset(asset, {
          ...registerOptions,
          commitOptions: { updateNodes: false },
        }),
        converted: new Set<Object3D>(),
        textureRefs: new Map<Texture, SceneMaterialTextureRef>(),
        textureSequence: 0,
        modelAssetId,
      }

      const rootNode = await convertObjectToSceneNode(object, context, { fallbackName, path: [] })
      const nodes: SceneNode[] = []

      if (rootNode) {
        nodes.push(rootNode)
      } else {
        for (let index = 0; index < object.children.length; index += 1) {
          const child = object.children[index]!
          const convertedChild = await convertObjectToSceneNode(child, context, { fallbackName, path: [index] })
          if (convertedChild) {
            nodes.push(convertedChild)
          }
        }
      }

      if (!nodes.length) {
        return []
      }

      this.captureHistorySnapshot()
      this.nodes = [...this.nodes, ...nodes]
  nodes.forEach((node) => componentManager.syncNode(node))

      const importedIds = collectNodeIdList(nodes)
      if (importedIds.length) {
        this.setSelection(importedIds, { primaryId: importedIds[0] ?? null })
      }

      commitSceneSnapshot(this)
      return importedIds
    },

    addSceneNode(payload: {
      nodeId?: string
      nodeType: SceneNodeType
      object: Object3D
      name?: string
      position?: Vector3Like
      rotation?: Vector3Like
      scale?: Vector3Like
      canPrefab?: boolean
      sourceAssetId?: string
      dynamicMesh?: SceneDynamicMesh
      components?: SceneNodeComponentMap
      parentId?: string | null
      editorFlags?: SceneNodeEditorFlags
      userData?: Record<string, unknown>
    }) {
      const id = payload.nodeId ?? generateUuid()
      const nodeType = normalizeSceneNodeType(payload.nodeType)
      const suppressInitialMaterials = payload.dynamicMesh?.type === 'Region'
      let nodeMaterials: SceneNodeMaterial[] | undefined

      if (!suppressInitialMaterials && sceneNodeTypeSupportsMaterials(nodeType)) {
        const baseMaterial = findDefaultSceneMaterial(this.materials)
        const initialProps: SceneMaterialProps = baseMaterial ? createMaterialProps(baseMaterial) : createMaterialProps()
        const initialMaterial = createNodeMaterial(initialProps, {
          name: baseMaterial?.name,
          type: baseMaterial?.type ?? DEFAULT_SCENE_MATERIAL_TYPE,
        })
        nodeMaterials = [initialMaterial]
      }
      const nodeName = payload.name ?? payload.object.name ?? 'Imported Mesh'
      const initialUserData = clonePlainRecord(
        (payload.userData ?? payload.object.userData) as Record<string, unknown> | undefined,
      )
      const viewPointEvaluation = evaluateViewPointAttributes(initialUserData)
      const displayBoardEvaluation = evaluateDisplayBoardAttributes(viewPointEvaluation.sanitizedUserData, nodeName)
      const guideboardEvaluation = evaluateGuideboardAttributes(displayBoardEvaluation.sanitizedUserData, nodeName)
      const warpGateEvaluation = evaluateWarpGateAttributes(guideboardEvaluation.sanitizedUserData)

      const node: SceneNode = {
        id,
        name: nodeName,
        nodeType,
        materials: nodeMaterials,
        position: payload.position ?? { x: 0, y: 0, z: 0 },
        rotation: payload.rotation ?? { x: 0, y: 0, z: 0 },
        scale: payload.scale ?? { x: 1, y: 1, z: 1 },
        canPrefab: payload.canPrefab,
        visible: true,
        sourceAssetId: payload.sourceAssetId,
        dynamicMesh: payload.dynamicMesh ? cloneDynamicMeshDefinition(payload.dynamicMesh) : undefined,
        editorFlags: cloneEditorFlags(payload.editorFlags),
        userData: warpGateEvaluation.sanitizedUserData,
      }

      if (nodeType === 'Group') {
        node.groupExpanded = true
      }

      node.components = normalizeNodeComponents(node, payload.components, {
        attachDisplayBoard: displayBoardEvaluation.shouldAttachDisplayBoard,
        attachGuideboard: guideboardEvaluation.shouldAttachGuideboard,
        attachViewPoint: viewPointEvaluation.shouldAttachViewPoint,
        attachWarpGate: warpGateEvaluation.shouldAttachWarpGate,
        viewPointOverrides: viewPointEvaluation.componentOverrides,
      })

      registerRuntimeObject(id, payload.object)
      tagObjectWithNodeId(payload.object, id)
      componentManager.attachRuntime(node, payload.object)
      componentManager.syncNode(node)
      let nextTree: SceneNode[]
      let parentId = payload.parentId ?? null
      if (parentId === ENVIRONMENT_NODE_ID) {
        parentId = null
      }
      if (isMultiuserNode(node)) {
        parentId = null
      }
      if (parentId) {
        const parentNode = findNodeById(this.nodes, parentId)
        if (!allowsChildNodes(parentNode)) {
          parentId = null
        }
      }
      if (parentId) {
        const workingTree = [...this.nodes]
        const inserted = insertNodeMutable(workingTree, parentId, node, 'inside')
        nextTree = inserted ? workingTree : [node, ...workingTree]
      } else {
        nextTree = [node, ...this.nodes]
      }
      this.nodes = nextTree
      this.setSelection([id], { primaryId: id })
      // New nodes can be handled incrementally by SceneViewport via ensureNodeSubtreeExists.
      // Avoid full syncs on every add when scenes get large.
      this.queueSceneNodePatch(id, ['transform'])
      commitSceneSnapshot(this)

      return node
    },

    createAiGeneratedMeshNode(payload: { name?: string | null; vertices: number[]; indices: number[] } | AiModelMeshMetadata) {
      const metadata: AiModelMeshMetadata = 'version' in payload
        ? {
            version: payload.version,
            name: payload.name,
            vertices: [...payload.vertices],
            indices: [...payload.indices],
          }
        : normalizeAiModelMeshInput({
            name: payload.name,
            vertices: payload.vertices,
            indices: payload.indices,
          })
      const fallbackName = typeof (payload as { name?: unknown }).name === 'string'
        ? ((payload as { name?: string }).name as string)
        : undefined
      const resolvedName = metadata.name ?? fallbackName
      const runtime = createRuntimeMeshFromMetadata(resolvedName, metadata)
      const runtimeMetadata = cloneAiModelMeshMetadata(metadata)
      runtime.userData = {
        ...(runtime.userData ?? {}),
        [AI_MODEL_MESH_USERDATA_KEY]: runtimeMetadata,
      }
      const nodeMetadata = cloneAiModelMeshMetadata(metadata)
      const nodeName = resolvedName ?? 'AI Generated Mesh'

      const node = this.addSceneNode({
        nodeType: 'Mesh',
        object: runtime,
        name: nodeName,
        userData: {
          [AI_MODEL_MESH_USERDATA_KEY]: nodeMetadata,
        },
      })
      return node
    },

    rebuildGeneratedMeshRuntimes() {
      let created = 0
      const groundNode = resolveGroundNodeForHeightSampling(this.nodes)
      const visitNodes = (list: SceneNode[]) => {
        list.forEach((node) => {
          const ensured = ensureDynamicMeshRuntime(node, groundNode)
            || ensureAiModelMeshRuntime(node)
            || ensureWaterSurfaceMeshRuntime(node)
          if (ensured) {
            created += 1
          }
          if (node.children?.length) {
            visitNodes(node.children)
          }
        })
      }
      visitNodes(this.nodes)
      if (created > 0) {
        this.queueSceneStructurePatch('rebuildGeneratedMeshRuntimes')
      }
      return created
    },

    generateGroupNodeName() {
      const used = new Set<number>()

      const collect = (nodes: SceneNode[] | undefined) => {
        if (!nodes?.length) {
          return
        }
        nodes.forEach((node) => {
          const name = node.name?.trim()
          if (name) {
            const match = /^Group(?:\s+(\d+))?$/i.exec(name)
            if (match) {
              const index = match[1] ? Number.parseInt(match[1], 10) : 1
              if (Number.isFinite(index)) {
                used.add(index)
              }
            }
          }
          if (node.children?.length) {
            collect(node.children)
          }
        })
      }

      collect(this.nodes)

      let candidate = 1
      while (used.has(candidate)) {
        candidate += 1
      }

      return `Group ${candidate}`
    },
    
    generateWallNodeName() {
      const prefix = 'Wall '
      const pattern = /^Wall\s(\d{2})$/
      const taken = new Set<string>()
      const collectNames = (nodes: SceneNode[]) => {
        nodes.forEach((node) => {
          if (typeof node.name === 'string' && node.name.startsWith(prefix)) {
            taken.add(node.name)
          }
          if (node.children?.length) {
            collectNames(node.children)
          }
        })
      }
      collectNames(this.nodes)
      for (let index = 1; index < 1000; index += 1) {
        const candidate = `${prefix}${index.toString().padStart(2, '0')}`
        if (!taken.has(candidate)) {
          return candidate
        }
      }
      const fallback = Array.from(taken)
        .map((name) => {
          const match = name.match(pattern)
          return match ? Number(match[1]) : Number.NaN
        })
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b)
      const nextIndex = (fallback[fallback.length - 1] ?? 0) + 1
      return `${prefix}${nextIndex.toString().padStart(2, '0')}`
    },

    generateRoadNodeName() {
      const prefix = 'Road '
      const pattern = /^Road\s(\d{2})$/
      const taken = new Set<string>()
      const collectNames = (nodes: SceneNode[]) => {
        nodes.forEach((node) => {
          if (typeof node.name === 'string' && node.name.startsWith(prefix)) {
            taken.add(node.name)
          }
          if (node.children?.length) {
            collectNames(node.children)
          }
        })
      }
      collectNames(this.nodes)
      for (let index = 1; index < 1000; index += 1) {
        const candidate = `${prefix}${index.toString().padStart(2, '0')}`
        if (!taken.has(candidate)) {
          return candidate
        }
      }
      const fallback = Array.from(taken)
        .map((name) => {
          const match = name.match(pattern)
          return match ? Number(match[1]) : Number.NaN
        })
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b)
      const nextIndex = (fallback[fallback.length - 1] ?? 0) + 1
      return `${prefix}${nextIndex.toString().padStart(2, '0')}`
    },

    generateFloorNodeName() {
      const prefix = 'Floor '
      const pattern = /^Floor\s(\d{2})$/
      const taken = new Set<string>()
      const collectNames = (nodes: SceneNode[]) => {
        nodes.forEach((node) => {
          if (typeof node.name === 'string' && node.name.startsWith(prefix)) {
            taken.add(node.name)
          }
          if (node.children?.length) {
            collectNames(node.children)
          }
        })
      }
      collectNames(this.nodes)
      for (let index = 1; index < 1000; index += 1) {
        const candidate = `${prefix}${index.toString().padStart(2, '0')}`
        if (!taken.has(candidate)) {
          return candidate
        }
      }
      const fallback = Array.from(taken)
        .map((name) => {
          const match = name.match(pattern)
          return match ? Number(match[1]) : Number.NaN
        })
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b)
      const nextIndex = (fallback[fallback.length - 1] ?? 0) + 1
      return `${prefix}${nextIndex.toString().padStart(2, '0')}`
    },

    generateLandformNodeName() {
      const prefix = 'Landform '
      const pattern = /^Landform\s(\d{2})$/
      const taken = new Set<string>()
      const collectNames = (nodes: SceneNode[]) => {
        nodes.forEach((node) => {
          if (typeof node.name === 'string' && node.name.startsWith(prefix)) {
            taken.add(node.name)
          }
          if (node.children?.length) {
            collectNames(node.children)
          }
        })
      }
      collectNames(this.nodes)
      for (let index = 1; index < 1000; index += 1) {
        const candidate = `${prefix}${index.toString().padStart(2, '0')}`
        if (!taken.has(candidate)) {
          return candidate
        }
      }
      const fallback = Array.from(taken)
        .map((name) => {
          const match = name.match(pattern)
          return match ? Number(match[1]) : Number.NaN
        })
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b)
      const nextIndex = (fallback[fallback.length - 1] ?? 0) + 1
      return `${prefix}${nextIndex.toString().padStart(2, '0')}`
    },

    generateRegionNodeName() {
      const prefix = 'Region '
      const pattern = /^Region\s(\d{2})$/
      const taken = new Set<string>()
      const collectNames = (nodes: SceneNode[]) => {
        nodes.forEach((node) => {
          if (typeof node.name === 'string' && node.name.startsWith(prefix)) {
            taken.add(node.name)
          }
          if (node.children?.length) {
            collectNames(node.children)
          }
        })
      }
      collectNames(this.nodes)
      for (let index = 1; index < 1000; index += 1) {
        const candidate = `${prefix}${index.toString().padStart(2, '0')}`
        if (!taken.has(candidate)) {
          return candidate
        }
      }
      const fallback = Array.from(taken)
        .map((name) => {
          const match = name.match(pattern)
          return match ? Number(match[1]) : Number.NaN
        })
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b)
      const nextIndex = (fallback[fallback.length - 1] ?? 0) + 1
      return `${prefix}${nextIndex.toString().padStart(2, '0')}`
    },

    generateWaterNodeName() {
      const prefix = 'Water '
      const pattern = /^Water\s(\d{2})$/
      const taken = new Set<string>()
      const collectNames = (nodes: SceneNode[]) => {
        nodes.forEach((node) => {
          if (typeof node.name === 'string' && node.name.startsWith(prefix)) {
            taken.add(node.name)
          }
          if (node.children?.length) {
            collectNames(node.children)
          }
        })
      }
      collectNames(this.nodes)
      for (let index = 1; index < 1000; index += 1) {
        const candidate = `${prefix}${index.toString().padStart(2, '0')}`
        if (!taken.has(candidate)) {
          return candidate
        }
      }
      const fallback = Array.from(taken)
        .map((name) => {
          const match = name.match(pattern)
          return match ? Number(match[1]) : Number.NaN
        })
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b)
      const nextIndex = (fallback[fallback.length - 1] ?? 0) + 1
      return `${prefix}${nextIndex.toString().padStart(2, '0')}`
    },

    generateDisplayBoardNodeName() {
      const prefix = 'Display Board '
      const pattern = /^Display Board\s(\d{2})$/
      const taken = new Set<string>()
      const collectNames = (nodes: SceneNode[]) => {
        nodes.forEach((node) => {
          if (typeof node.name === 'string' && node.name.startsWith(prefix)) {
            taken.add(node.name)
          }
          if (node.children?.length) {
            collectNames(node.children)
          }
        })
      }
      collectNames(this.nodes)
      for (let index = 1; index < 1000; index += 1) {
        const candidate = `${prefix}${index.toString().padStart(2, '0')}`
        if (!taken.has(candidate)) {
          return candidate
        }
      }
      const fallback = Array.from(taken)
        .map((name) => {
          const match = name.match(pattern)
          return match ? Number(match[1]) : Number.NaN
        })
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b)
      const nextIndex = (fallback[fallback.length - 1] ?? 0) + 1
      return `${prefix}${nextIndex.toString().padStart(2, '0')}`
    },

    generateBillboardNodeName() {
      const prefix = 'Billboard '
      const pattern = /^Billboard\s(\d{2})$/
      const taken = new Set<string>()
      const collectNames = (nodes: SceneNode[]) => {
        nodes.forEach((node) => {
          if (typeof node.name === 'string' && node.name.startsWith(prefix)) {
            taken.add(node.name)
          }
          if (node.children?.length) {
            collectNames(node.children)
          }
        })
      }
      collectNames(this.nodes)
      for (let index = 1; index < 1000; index += 1) {
        const candidate = `${prefix}${index.toString().padStart(2, '0')}`
        if (!taken.has(candidate)) {
          return candidate
        }
      }
      const fallback = Array.from(taken)
        .map((name) => {
          const match = name.match(pattern)
          return match ? Number(match[1]) : Number.NaN
        })
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b)
      const nextIndex = (fallback[fallback.length - 1] ?? 0) + 1
      return `${prefix}${nextIndex.toString().padStart(2, '0')}`
    },

    ensureStaticRigidbodyComponent(nodeId: string): SceneNodeComponentState<RigidbodyComponentProps> | null {
      const target = findNodeById(this.nodes, nodeId)
      if (!target) {
        return null
      }

      const existing = target.components?.[RIGIDBODY_COMPONENT_TYPE] as
        | SceneNodeComponentState<RigidbodyComponentProps>
        | undefined

      if (existing) {
        const props = clampRigidbodyComponentProps(existing.props as RigidbodyComponentProps)
        if (props.bodyType === 'STATIC' && Math.abs(props.mass) <= 1e-4) {
          return existing
        }
        this.updateNodeComponentProps(nodeId, existing.id, {
          bodyType: 'STATIC',
          mass: 0,
        })
        return existing
      }

      const result = this.addNodeComponent<typeof RIGIDBODY_COMPONENT_TYPE>(nodeId, RIGIDBODY_COMPONENT_TYPE)
      const created = result?.component
      if (!created) {
        return null
      }
      this.updateNodeComponentProps(nodeId, created.id, {
        bodyType: 'STATIC',
        mass: 0,
      })
      return created
    },
    createWallNode(payload: {
      nodeId?: string
      segments: Array<{ start: Vector3Like; end: Vector3Like }>
      dimensions?: { height?: number; width?: number; thickness?: number }
      closed?: boolean
      name?: string
      bodyAssetId?: string | null
      wallComponentProps?: Partial<WallComponentProps> | null
      wallPresetData?: WallPresetData | null
      editorFlags?: SceneNodeEditorFlags
    }): SceneNode | null {
      const build = buildWallDynamicMeshFromWorldSegments(payload.segments, payload.dimensions, {
        forceClosedSingleChain: Boolean(payload.closed),
      })
      if (!build) {
        return null
      }

      const defaultMaterials = createWallNodeMaterials({ bodyName: 'Body' })
      const defaultBodyMaterialConfigId = defaultMaterials[0]?.id ?? null
      const defaultMesh: WallDynamicMesh = {
        ...build.definition,
        bodyMaterialConfigId: defaultBodyMaterialConfigId,
      }

      const initialWallComponentPatch = payload.wallPresetData?.wallProps
        ? buildWallComponentPropsPatchFromPreset(payload.wallPresetData.wallProps)
        : (payload.wallComponentProps ?? null)

        const initialWallProps = clampWallProps({
          ...resolveWallComponentPropsFromMesh(defaultMesh),
          ...(initialWallComponentPatch ?? {}),
        })

        const wallGroup = createWallGroup(defaultMesh, {
          wallRenderMode: initialWallProps.wallRenderMode,
          repeatInstanceStep: initialWallProps.repeatInstanceStep,
          headAssetHeight: initialWallProps.headAssetHeight,
          footAssetHeight: initialWallProps.footAssetHeight,
        })
      const nodeName = payload.name ?? this.generateWallNodeName()

      this.captureHistorySnapshot()
      this.beginHistoryCaptureSuppression()
      try {
        const desiredId = typeof payload.nodeId === 'string' && payload.nodeId.trim().length ? payload.nodeId.trim() : null
        const existing = desiredId ? findNodeById(this.nodes, desiredId) : null

        if (existing && desiredId) {
          if (payload.name && payload.name.trim() && existing.name !== payload.name.trim()) {
            this.renameNode(desiredId, payload.name.trim())
          }
          this.updateNodeTransform({
            id: desiredId,
            position: createVector(build.center.x, build.center.y, build.center.z),
            rotation: createVector(0, 0, 0),
            scale: createVector(1, 1, 1),
          })
          this.updateNodeDynamicMesh(desiredId, defaultMesh)
          if (payload.editorFlags) {
            existing.editorFlags = cloneEditorFlags(payload.editorFlags)
            this.queueSceneNodePatch(desiredId, ['visibility'])
          }

          let materialsChanged = false
          let meshChanged = false
          visitNode(this.nodes, desiredId, (node) => {
            const result = wallHelpers.ensureWallMaterialConvention(node)
            materialsChanged ||= result.materialsChanged
            meshChanged ||= result.meshChanged
          })
          if (materialsChanged) {
            this.queueSceneNodePatch(desiredId, ['materials'])
          }
          if (meshChanged) {
            this.queueSceneNodePatch(desiredId, ['dynamicMesh'])
          }
          if (materialsChanged || meshChanged) {
            this.nodes = [...this.nodes]
            commitSceneSnapshot(this)
          }

          const wallComponent = (findNodeById(this.nodes, desiredId)?.components?.[WALL_COMPONENT_TYPE] as
            | SceneNodeComponentState<WallComponentProps>
            | undefined)
          if (wallComponent?.id) {
            const nextPatch = initialWallComponentPatch
              ? { ...initialWallComponentPatch }
              : {}
            const bodyAssetId = typeof payload.bodyAssetId === 'string' && payload.bodyAssetId.trim().length
              ? payload.bodyAssetId
              : null
            if (bodyAssetId) {
              ;(nextPatch as Partial<WallComponentProps>).bodyAssetId = bodyAssetId
            }
            if (Object.keys(nextPatch).length) {
              this.updateNodeComponentProps(desiredId, wallComponent.id, nextPatch as Partial<Record<string, unknown>>)
            }
          }
          return findNodeById(this.nodes, desiredId)
        }

        const node = this.addSceneNode({
          nodeId: desiredId ?? undefined,
          nodeType: 'Mesh',
          object: wallGroup,
          name: nodeName,
          position: createVector(build.center.x, build.center.y, build.center.z),
          rotation: createVector(0, 0, 0),
          scale: createVector(1, 1, 1),
          dynamicMesh: defaultMesh,
          editorFlags: payload.editorFlags,
        })
        if (node) {
          this.setNodeMaterials(node.id, defaultMaterials)

          const nextPatch = initialWallComponentPatch
            ? { ...initialWallComponentPatch }
            : {}
          const bodyAssetId = typeof payload.bodyAssetId === 'string' && payload.bodyAssetId.trim().length
            ? payload.bodyAssetId
            : null

          if (bodyAssetId) {
            ;(nextPatch as Partial<WallComponentProps>).bodyAssetId = bodyAssetId
          }

          if (Object.keys(nextPatch).length) {
            const component = node.components?.[WALL_COMPONENT_TYPE] as
              | SceneNodeComponentState<WallComponentProps>
              | undefined
            if (component) {
              this.updateNodeComponentProps(node.id, component.id, nextPatch as Partial<Record<string, unknown>>)
            }
          }
        }
        return node
      } finally {
        this.endHistoryCaptureSuppression()
      }
    },

    createRoadNode(payload: {
      nodeId?: string
      points: Vector3Like[]
      width?: number
      name?: string
      bodyAssetId?: string | null,
      roadPresetData?: RoadPresetData | null
      editorFlags?: SceneNodeEditorFlags
    }): SceneNode | null {
      const presetWidth = Number.isFinite(payload.roadPresetData?.width)
        ? Math.max(ROAD_MIN_WIDTH, Number(payload.roadPresetData!.width))
        : undefined
      const requestedWidth = Number.isFinite(payload.width) ? payload.width : presetWidth
      const build = buildRoadDynamicMeshFromWorldPoints(payload.points, requestedWidth)
      if (!build) {
        return null
      }

      const presetMaterials = buildRoadNodeMaterialsFromPreset(payload.roadPresetData)

      const groundNode = resolveGroundNodeForHeightSampling(this.nodes)
      const groundDefinition = groundNode?.dynamicMesh?.type === 'Ground'
        ? resolveGroundRuntimeDefinition(this, groundNode.id)
        : null

      const groundPosition = (groundNode?.position as { x?: unknown; y?: unknown; z?: unknown } | undefined) ?? undefined
      const groundOriginX = typeof groundPosition?.x === 'number' && Number.isFinite(groundPosition.x) ? groundPosition.x : 0
      const groundOriginY = typeof groundPosition?.y === 'number' && Number.isFinite(groundPosition.y) ? groundPosition.y : 0
      const groundOriginZ = typeof groundPosition?.z === 'number' && Number.isFinite(groundPosition.z) ? groundPosition.z : 0

      const roadOriginX = build.center.x
      const roadOriginY = build.center.y
      const roadOriginZ = build.center.z

      const roadGroup = createRoadGroup(build.definition, {
        heightSampler: groundDefinition
          ? ((x: number, z: number) => {
              const worldX = roadOriginX + x
              const worldZ = roadOriginZ + z
              const groundLocalX = worldX - groundOriginX
              const groundLocalZ = worldZ - groundOriginZ
              const groundWorldY = groundOriginY + sampleGroundHeight(groundDefinition, groundLocalX, groundLocalZ)
              return groundWorldY - roadOriginY
            })
          : null,
      })
      const nodeName = payload.name ?? this.generateRoadNodeName()

      this.captureHistorySnapshot()
      this.beginHistoryCaptureSuppression()
      try {
        const desiredId = typeof payload.nodeId === 'string' && payload.nodeId.trim().length ? payload.nodeId.trim() : null
        const existing = desiredId ? findNodeById(this.nodes, desiredId) : null

        if (existing && desiredId) {
          if (payload.name && payload.name.trim() && existing.name !== payload.name.trim()) {
            this.renameNode(desiredId, payload.name.trim())
          }
          this.updateNodeTransform({
            id: desiredId,
            position: createVector(build.center.x, build.center.y, build.center.z),
            rotation: createVector(0, 0, 0),
            scale: createVector(1, 1, 1),
          })
          this.updateNodeDynamicMesh(desiredId, build.definition)

          // Ensure road component exists so the node remains identifiable.
          const roadComponent = (findNodeById(this.nodes, desiredId)?.components?.[ROAD_COMPONENT_TYPE] as { id?: string } | undefined)
          if (!roadComponent?.id) {
            this.addNodeComponent(desiredId, ROAD_COMPONENT_TYPE)
          }

          const refreshedExisting = findNodeById(this.nodes, desiredId)
          const refreshedRoadComponent = refreshedExisting?.components?.[ROAD_COMPONENT_TYPE] as { id?: string } | undefined
          if (refreshedRoadComponent?.id) {
            const componentPatch = payload.roadPresetData
              ? buildRoadComponentPatchFromPreset(payload.roadPresetData.roadProps)
              : { bodyAssetId: typeof payload.bodyAssetId === 'string' && payload.bodyAssetId.trim().length ? payload.bodyAssetId : null }
            this.updateNodeComponentProps(desiredId, refreshedRoadComponent.id, componentPatch)
          }

          if (presetMaterials.length) {
            this.setNodeMaterials(desiredId, presetMaterials)
          }
          return findNodeById(this.nodes, desiredId)
        }

        const node = this.addSceneNode({
          nodeId: desiredId ?? undefined,
          nodeType: 'Mesh',
          object: roadGroup,
          name: nodeName,
          position: createVector(build.center.x, build.center.y, build.center.z),
          rotation: createVector(0, 0, 0),
          scale: createVector(1, 1, 1),
          dynamicMesh: build.definition,
          editorFlags: payload.editorFlags,
        })

        if (node) {
          const bodyAssetId = typeof payload.bodyAssetId === 'string' && payload.bodyAssetId.trim().length
            ? payload.bodyAssetId
            : (payload.roadPresetData?.roadProps.bodyAssetId ?? null)

          const result = this.addNodeComponent(node.id, ROAD_COMPONENT_TYPE)
          const component = result?.component

          if (component?.id) {
            const componentPatch = payload.roadPresetData
              ? buildRoadComponentPatchFromPreset(payload.roadPresetData.roadProps)
              : null
            this.updateNodeComponentProps(node.id, component.id, {
              ...resolveRoadComponentPropsFromMesh(build.definition),
              ...(componentPatch ?? {}),
              bodyAssetId,
            })
          }

          if (presetMaterials.length) {
            this.setNodeMaterials(node.id, presetMaterials)
          }
        }

        return node
      } finally {
        this.endHistoryCaptureSuppression()
      }
    },

    createFloorNode(payload: {
      nodeId?: string
      points: Vector3Like[]
      name?: string,
      floorPresetData?: FloorPresetData | null
      editorFlags?: SceneNodeEditorFlags
    }): SceneNode | null {
      const build = floorHelpers.buildFloorDynamicMeshFromWorldPoints(payload.points)
      if (!build) {
        return null
      }

      const presetMaterials = buildFloorNodeMaterialsFromPreset(payload.floorPresetData)
      // Floors use 2 material slots by default: TopBottom + Side.
      const defaultMaterials = presetMaterials.length
        ? presetMaterials
        : createFloorNodeMaterials({
            topBottomName: 'TopBottom',
            sideName: 'Side',
          })

      const presetMeshPatch = buildFloorDynamicMeshPresetPatch(payload.floorPresetData)
      const defaultTopId = presetMeshPatch?.topBottomMaterialConfigId ?? defaultMaterials[0]?.id ?? null
      const defaultSideId = presetMeshPatch?.sideMaterialConfigId ?? defaultMaterials[1]?.id ?? defaultTopId
      const defaultMesh: FloorDynamicMesh = {
        ...build.definition,
        smooth: presetMeshPatch?.smooth ?? build.definition.smooth,
        thickness: presetMeshPatch?.thickness ?? build.definition.thickness,
        sideUvScale: presetMeshPatch?.sideUvScale ?? build.definition.sideUvScale,
        topBottomMaterialConfigId: defaultTopId,
        sideMaterialConfigId: defaultSideId,
      }

      const floorGroup = createFloorGroup(defaultMesh)
      const nodeName = payload.name ?? this.generateFloorNodeName()

      this.captureHistorySnapshot()
      this.beginHistoryCaptureSuppression()
      try {
        const desiredId = typeof payload.nodeId === 'string' && payload.nodeId.trim().length ? payload.nodeId.trim() : null
        const existing = desiredId ? findNodeById(this.nodes, desiredId) : null

        if (existing && desiredId) {
          if (payload.name && payload.name.trim() && existing.name !== payload.name.trim()) {
            this.renameNode(desiredId, payload.name.trim())
          }
          this.updateNodeTransform({
            id: desiredId,
            position: createVector(build.center.x, build.center.y, build.center.z),
            rotation: createVector(0, 0, 0),
            scale: createVector(1, 1, 1),
          })

          // Keep existing material selector ids when updating geometry.
          const existingMesh = existing.dynamicMesh?.type === 'Floor' ? (existing.dynamicMesh as FloorDynamicMesh) : null
          this.updateNodeDynamicMesh(desiredId, {
            ...build.definition,
            smooth: presetMeshPatch?.smooth ?? existingMesh?.smooth ?? build.definition.smooth,
            thickness: presetMeshPatch?.thickness ?? (existingMesh as any)?.thickness ?? build.definition.thickness,
            sideUvScale: presetMeshPatch?.sideUvScale ?? (existingMesh as any)?.sideUvScale ?? build.definition.sideUvScale,
            topBottomMaterialConfigId: presetMeshPatch?.topBottomMaterialConfigId ?? existingMesh?.topBottomMaterialConfigId ?? null,
            sideMaterialConfigId: presetMeshPatch?.sideMaterialConfigId ?? existingMesh?.sideMaterialConfigId ?? null,
          } as FloorDynamicMesh)

          if (presetMaterials.length) {
            this.setNodeMaterials(desiredId, defaultMaterials)
          }

          const floorComponent = (findNodeById(this.nodes, desiredId)?.components?.[FLOOR_COMPONENT_TYPE] as { id?: string } | undefined)
          if (!floorComponent?.id) {
            this.addNodeComponent(desiredId, FLOOR_COMPONENT_TYPE)
          }
          const updated = findNodeById(this.nodes, desiredId)
          const component = (updated?.components?.[FLOOR_COMPONENT_TYPE] as { id?: string } | undefined)
          if (component?.id) {
            const nextProps = resolveFloorComponentPropsFromMesh(build.definition)
            this.updateNodeComponentProps(desiredId, component.id, {
              smooth: nextProps.smooth,
              thickness: nextProps.thickness,
              sideUvScale: nextProps.sideUvScale,
            })
          }

          // Ensure floor keeps 2 material slots and selector ids reference existing slots.
          let materialsChanged = false
          let meshChanged = false
          visitNode(this.nodes, desiredId, (node) => {
            const result = floorHelpers.ensureFloorMaterialConvention(node)
            materialsChanged ||= result.materialsChanged
            meshChanged ||= result.meshChanged
          })
          if (materialsChanged) {
            this.queueSceneNodePatch(desiredId, ['materials'])
          }
          if (meshChanged) {
            this.queueSceneNodePatch(desiredId, ['dynamicMesh'])
          }
          if (materialsChanged || meshChanged) {
            this.nodes = [...this.nodes]
            commitSceneSnapshot(this)
          }
          return updated
        }

        const node = this.addSceneNode({
          nodeId: desiredId ?? undefined,
          nodeType: 'Mesh',
          object: floorGroup,
          name: nodeName,
          position: createVector(build.center.x, build.center.y, build.center.z),
          rotation: createVector(0, 0, 0),
          scale: createVector(1, 1, 1),
          dynamicMesh: defaultMesh,
          editorFlags: payload.editorFlags,
        })

        if (node) {
          // Replace the default single material slot created by addSceneNode with our 2-slot floor convention.
          this.setNodeMaterials(node.id, defaultMaterials)

          const result = this.addNodeComponent(node.id, FLOOR_COMPONENT_TYPE)
          const component = result?.component
          if (component?.id) {
            const nextProps = resolveFloorComponentPropsFromMesh(defaultMesh)
            this.updateNodeComponentProps(node.id, component.id, {
              smooth: nextProps.smooth,
              thickness: nextProps.thickness,
              sideUvScale: nextProps.sideUvScale,
            })
          }
        }

        return node
      } finally {
        this.endHistoryCaptureSuppression()
      }
    },

    createLandformNode(payload: {
      nodeId?: string
      points: Vector3Like[]
      name?: string
      editorFlags?: SceneNodeEditorFlags
      componentProps?: Partial<LandformComponentProps>
    }): SceneNode | null {
      const groundNode = resolveGroundNodeForHeightSampling(this.nodes)
      const groundDefinition = groundNode?.dynamicMesh?.type === 'Ground'
        ? resolveGroundRuntimeDefinition(this, groundNode.id)
        : null
      const build = landformHelpers.buildLandformDynamicMeshFromWorldPoints(
        payload.points,
        groundDefinition,
        groundNode,
        payload.componentProps,
      )
      if (!build) {
        return null
      }

      const defaultMaterials = createLandformNodeMaterials({ surfaceName: 'Surface' })
      const defaultMesh: LandformDynamicMesh = {
        ...build.definition,
        materialConfigId: defaultMaterials[0]?.id ?? null,
      }

      const landformGroup = createLandformGroup(defaultMesh)
      const nodeName = payload.name ?? this.generateLandformNodeName()

      this.captureHistorySnapshot()
      this.beginHistoryCaptureSuppression()
      try {
        const desiredId = typeof payload.nodeId === 'string' && payload.nodeId.trim().length ? payload.nodeId.trim() : null
        const existing = desiredId ? findNodeById(this.nodes, desiredId) : null

        if (existing && desiredId) {
          if (payload.name && payload.name.trim() && existing.name !== payload.name.trim()) {
            this.renameNode(desiredId, payload.name.trim())
          }
          this.updateNodeTransform({
            id: desiredId,
            position: createVector(build.center.x, build.center.y, build.center.z),
            rotation: createVector(0, 0, 0),
            scale: createVector(1, 1, 1),
          })

          const existingMesh = existing.dynamicMesh?.type === 'Landform' ? (existing.dynamicMesh as LandformDynamicMesh) : null
          this.updateNodeDynamicMesh(desiredId, {
            ...defaultMesh,
            materialConfigId: existingMesh?.materialConfigId ?? defaultMesh.materialConfigId,
          } as LandformDynamicMesh)

          const existingComponent = findNodeById(this.nodes, desiredId)?.components?.[LANDFORM_COMPONENT_TYPE] as { id?: string } | undefined
          if (!existingComponent?.id) {
            this.addNodeComponent(desiredId, LANDFORM_COMPONENT_TYPE)
          }
          const updated = findNodeById(this.nodes, desiredId)
          const component = updated?.components?.[LANDFORM_COMPONENT_TYPE] as { id?: string } | undefined
          if (component?.id) {
            const nextProps = resolveLandformComponentPropsFromMesh(defaultMesh)
            this.updateNodeComponentProps(desiredId, component.id, {
              enableFeather: nextProps.enableFeather,
              feather: nextProps.feather,
              uvScale: nextProps.uvScale,
            })
          }

          let materialsChanged = false
          let meshChanged = false
          visitNode(this.nodes, desiredId, (node) => {
            const result = landformHelpers.ensureLandformMaterialConvention(node)
            materialsChanged ||= result.materialsChanged
            meshChanged ||= result.meshChanged
          })
          if (materialsChanged) {
            this.queueSceneNodePatch(desiredId, ['materials'])
          }
          if (meshChanged) {
            this.queueSceneNodePatch(desiredId, ['dynamicMesh'])
          }
          if (materialsChanged || meshChanged) {
            this.nodes = [...this.nodes]
            commitSceneSnapshot(this)
          }
          return updated
        }

        const node = this.addSceneNode({
          nodeId: desiredId ?? undefined,
          nodeType: 'Mesh',
          object: landformGroup,
          name: nodeName,
          position: createVector(build.center.x, build.center.y, build.center.z),
          rotation: createVector(0, 0, 0),
          scale: createVector(1, 1, 1),
          dynamicMesh: defaultMesh,
          editorFlags: payload.editorFlags,
        })

        if (node) {
          this.setNodeMaterials(node.id, defaultMaterials)
          const result = this.addNodeComponent(node.id, LANDFORM_COMPONENT_TYPE)
          const component = result?.component
          if (component?.id) {
            const nextProps = resolveLandformComponentPropsFromMesh(defaultMesh)
            this.updateNodeComponentProps(node.id, component.id, {
              enableFeather: nextProps.enableFeather,
              feather: nextProps.feather,
              uvScale: nextProps.uvScale,
            })
          }
        }

        return node
      } finally {
        this.endHistoryCaptureSuppression()
      }
    },

    buildLandformPreviewMesh(payload: {
      points: Vector3Like[]
      componentProps?: Partial<LandformComponentProps>
      reason?: string
    }): { center: Vector3Like; definition: LandformDynamicMesh } | null {
      const groundNode = resolveGroundNodeForHeightSampling(this.nodes)
      const groundDefinition = groundNode?.dynamicMesh?.type === 'Ground'
        ? resolveGroundRuntimeDefinition(this, groundNode.id)
        : null
      const build = landformHelpers.buildLandformDynamicMeshFromWorldPoints(
        payload.points,
        groundDefinition,
        groundNode,
        payload.componentProps,
      )
      if (!build) {
        return null
      }
      return {
        center: { x: build.center.x, y: build.center.y, z: build.center.z },
        definition: build.definition,
      }
    },

    createWaterSurfaceMeshNode(payload: {
      nodeId?: string
      points: Vector3Like[]
      buildShape: WaterBuildShape
      name?: string
      editorFlags?: SceneNodeEditorFlags
    }): SceneNode | null {
      const build = buildWaterSurfaceMeshFromWorldPoints(payload.points)
      if (!build) {
        return null
      }

      const runtime = createRuntimeWaterSurfaceMesh(payload.name, build.metadata)
      const nodeName = payload.name ?? this.generateWaterNodeName()
      const userData = mergeUserDataWithWaterBuildShape({
        [WATER_SURFACE_MESH_USERDATA_KEY]: cloneWaterSurfaceMeshMetadata(build.metadata),
      }, payload.buildShape)

      this.captureHistorySnapshot()
      this.beginHistoryCaptureSuppression()
      try {
        const node = this.addSceneNode({
          nodeId: payload.nodeId,
          nodeType: 'Mesh',
          object: runtime,
          name: nodeName,
          position: createVector(build.center.x, build.center.y, build.center.z),
          rotation: createVector(-Math.PI / 2, 0, 0),
          scale: createVector(1, 1, 1),
          editorFlags: payload.editorFlags,
          userData,
        })

        if (!node) {
          return null
        }

        this.addNodeComponent<typeof WATER_COMPONENT_TYPE>(node.id, WATER_COMPONENT_TYPE)
        this.applyWaterNodeDefaultNormalMap(node.id)
        const updated = findNodeById(this.nodes, node.id)
        return updated ?? node
      } finally {
        this.endHistoryCaptureSuppression()
      }
    },

    createDisplayBoardNode(payload: {
      nodeId?: string
      center: Vector3Like
      rotation: Vector3Like
      scale: Vector3Like
      name?: string
      editorFlags?: SceneNodeEditorFlags
    }): SceneNode | null {
      const scaleX = Math.max(1e-3, Math.abs(Number(payload.scale.x)))
      const scaleY = Math.max(1e-3, Math.abs(Number(payload.scale.y)))
      const scaleZ = Math.max(1e-3, Math.abs(Number(payload.scale.z ?? 1)))
      if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || !Number.isFinite(scaleZ)) {
        return null
      }

      const runtime = createPrimitiveMesh('Plane', { color: 0xffffff, doubleSided: true })
      runtime.castShadow = false
      runtime.receiveShadow = true
      runtime.userData = {
        ...(runtime.userData ?? {}),
        displayBoard: true,
      }

      const nodeName = payload.name ?? this.generateDisplayBoardNodeName()

      this.captureHistorySnapshot()
      this.beginHistoryCaptureSuppression()
      try {
        const node = this.addSceneNode({
          nodeId: payload.nodeId,
          nodeType: 'Plane',
          object: runtime,
          name: nodeName,
          position: createVector(Number(payload.center.x) || 0, Number(payload.center.y) || 0, Number(payload.center.z) || 0),
          rotation: createVector(Number(payload.rotation.x) || 0, Number(payload.rotation.y) || 0, Number(payload.rotation.z) || 0),
          scale: createVector(scaleX, scaleY, scaleZ),
          editorFlags: payload.editorFlags,
          userData: {
            displayBoard: true,
          },
        })

        if (!node) {
          return null
        }

        const primaryMaterial = node.materials?.[0] ?? null
        if (primaryMaterial) {
          this.updateNodeMaterialProps(node.id, primaryMaterial.id, { side: 'double' })
        }

        if (!node.components?.[DISPLAY_BOARD_COMPONENT_TYPE]) {
          this.addNodeComponent<typeof DISPLAY_BOARD_COMPONENT_TYPE>(node.id, DISPLAY_BOARD_COMPONENT_TYPE)
        }

        const updated = findNodeById(this.nodes, node.id)
        if (updated) {
          refreshDisplayBoardGeometry(updated)
        }
        return updated ?? node
      } finally {
        this.endHistoryCaptureSuppression()
      }
    },

    createBillboardNode(payload: {
      nodeId?: string
      center: Vector3Like
      rotation: Vector3Like
      scale: Vector3Like
      name?: string
      editorFlags?: SceneNodeEditorFlags
    }): SceneNode | null {
      const scaleX = Math.max(1e-3, Math.abs(Number(payload.scale.x)))
      const scaleY = Math.max(1e-3, Math.abs(Number(payload.scale.y)))
      const radialScale = Math.max(1e-3, scaleX / Math.PI)
      const runtime = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1, true),
        new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
      )
      runtime.castShadow = false
      runtime.receiveShadow = true
      runtime.userData = {
        ...(runtime.userData ?? {}),
        billboard: true,
      }

      const nodeName = payload.name ?? this.generateBillboardNodeName()

      this.captureHistorySnapshot()
      this.beginHistoryCaptureSuppression()
      try {
        const node = this.addSceneNode({
          nodeId: payload.nodeId,
          nodeType: 'Cylinder',
          object: runtime,
          name: nodeName,
          position: createVector(Number(payload.center.x) || 0, Number(payload.center.y) || 0, Number(payload.center.z) || 0),
          rotation: createVector(Number(payload.rotation.x) || 0, Number(payload.rotation.y) || 0, Number(payload.rotation.z) || 0),
          scale: createVector(radialScale, scaleY, radialScale),
          editorFlags: payload.editorFlags,
          userData: {
            billboard: true,
          },
        })

        if (!node) {
          return null
        }

        const primaryMaterial = node.materials?.[0] ?? null
        if (primaryMaterial) {
          this.updateNodeMaterialProps(node.id, primaryMaterial.id, { side: 'double' })
        }

        if (!node.components?.[BILLBOARD_COMPONENT_TYPE]) {
          this.addNodeComponent<typeof BILLBOARD_COMPONENT_TYPE>(node.id, BILLBOARD_COMPONENT_TYPE)
        }

        return findNodeById(this.nodes, node.id) ?? node
      } finally {
        this.endHistoryCaptureSuppression()
      }
    },

    updateWaterSurfaceMeshNode(payload: {
      nodeId: string
      localPoints: Array<[number, number]>
      buildShape: WaterBuildShape
    }): SceneNode | null {
      const target = findNodeById(this.nodes, payload.nodeId)
      if (!target || target.nodeType !== 'Mesh' || !isWaterSurfaceNode(target)) {
        return null
      }

      const metadata = buildWaterSurfaceMeshFromLocalPoints(payload.localPoints)
      if (!metadata) {
        return null
      }

      this.captureHistorySnapshot()
      visitNode(this.nodes, payload.nodeId, (node) => {
        node.userData = mergeUserDataWithWaterBuildShape({
          ...(node.userData ?? {}),
          [WATER_SURFACE_MESH_USERDATA_KEY]: cloneWaterSurfaceMeshMetadata(metadata),
        }, payload.buildShape)
      })
      this.queueSceneNodePatch(payload.nodeId, ['userData'])
      commitSceneSnapshot(this)
      return findNodeById(this.nodes, payload.nodeId)
    },

    updateLandformSurfaceMeshNode(payload: {
      nodeId: string
      localPoints: Array<[number, number]>
    }): SceneNode | null {
      const target = findNodeById(this.nodes, payload.nodeId)
      if (!target || target.dynamicMesh?.type !== 'Landform') {
        return null
      }

      const groundNode = resolveGroundNodeForHeightSampling(this.nodes)
      const groundDefinition = groundNode?.dynamicMesh?.type === 'Ground'
        ? resolveGroundRuntimeDefinition(this, groundNode.id)
        : null
      const existingMesh = target.dynamicMesh as LandformDynamicMesh
      const componentState = target.components?.[LANDFORM_COMPONENT_TYPE] as { props?: unknown } | undefined
      const componentProps = clampLandformComponentProps(
        (componentState?.props as Partial<LandformComponentProps> | undefined)
          ?? resolveLandformComponentPropsFromMesh(existingMesh),
      )
      const runtime = getRuntimeObject(payload.nodeId)
      const build = landformHelpers.buildLandformDynamicMeshFromLocalPoints(
        target,
        payload.localPoints,
        groundDefinition,
        groundNode,
        componentProps,
        runtime,
      )
      if (!build) {
        return null
      }

      this.captureHistorySnapshot()
      let materialsChanged = false
      let meshChanged = false
      visitNode(this.nodes, payload.nodeId, (node) => {
        if (node.dynamicMesh?.type !== 'Landform') {
          return
        }
        const mesh = node.dynamicMesh as LandformDynamicMesh
        node.dynamicMesh = {
          ...build,
          materialConfigId: mesh.materialConfigId ?? build.materialConfigId ?? null,
        }
        const result = landformHelpers.ensureLandformMaterialConvention(node)
        materialsChanged ||= result.materialsChanged
        meshChanged ||= result.meshChanged
      })
      if (runtime) {
        const nextNode = findNodeById(this.nodes, payload.nodeId)
        if (nextNode?.dynamicMesh?.type === 'Landform') {
          updateLandformGroup(runtime, nextNode.dynamicMesh as LandformDynamicMesh)
        }
      }
      this.queueSceneNodePatch(payload.nodeId, ['dynamicMesh'])
      if (materialsChanged) {
        this.queueSceneNodePatch(payload.nodeId, ['materials'])
      }
      if (meshChanged) {
        this.queueSceneNodePatch(payload.nodeId, ['dynamicMesh'])
      }
      replaceSceneNodes(this, [...this.nodes])
      commitSceneSnapshot(this)
      return findNodeById(this.nodes, payload.nodeId)
    },

    previewLandformSurfaceMeshNode(payload: {
      nodeId: string
      localPoints: Array<[number, number]>
    }): boolean {
      const target = findNodeById(this.nodes, payload.nodeId)
      if (!target || target.dynamicMesh?.type !== 'Landform') {
        return false
      }

      const runtime = getRuntimeObject(payload.nodeId)
      if (!runtime) {
        return false
      }

      const groundNode = resolveGroundNodeForHeightSampling(this.nodes)
      const groundDefinition = groundNode?.dynamicMesh?.type === 'Ground'
        ? resolveGroundRuntimeDefinition(this, groundNode.id)
        : null
      const existingMesh = target.dynamicMesh as LandformDynamicMesh
      const componentState = target.components?.[LANDFORM_COMPONENT_TYPE] as { props?: unknown } | undefined
      const componentProps = clampLandformComponentProps(
        (componentState?.props as Partial<LandformComponentProps> | undefined)
          ?? resolveLandformComponentPropsFromMesh(existingMesh),
      )
      const previewMesh = landformHelpers.buildLandformDynamicMeshFromLocalPoints(
        target,
        payload.localPoints,
        groundDefinition,
        groundNode,
        componentProps,
        runtime,
      )
      if (!previewMesh) {
        return false
      }

      updateLandformGroup(runtime, {
        ...previewMesh,
        materialConfigId: existingMesh.materialConfigId ?? previewMesh.materialConfigId ?? null,
      })
      return true
    },

    restoreLandformSurfaceMeshRuntime(nodeId: string): boolean {
      const target = findNodeById(this.nodes, nodeId)
      if (!target || target.dynamicMesh?.type !== 'Landform') {
        return false
      }
      const runtime = getRuntimeObject(nodeId)
      if (!runtime) {
        return false
      }
      runtime.position.set(
        Number(target.position?.x) || 0,
        Number(target.position?.y) || 0,
        Number(target.position?.z) || 0,
      )
      runtime.rotation.set(
        Number(target.rotation?.x) || 0,
        Number(target.rotation?.y) || 0,
        Number(target.rotation?.z) || 0,
      )
      runtime.scale.set(
        Number(target.scale?.x) || 1,
        Number(target.scale?.y) || 1,
        Number(target.scale?.z) || 1,
      )
      updateLandformGroup(runtime, target.dynamicMesh as LandformDynamicMesh)
      return true
    },

    createGuideRouteNode(payload: {
      nodeId?: string
      points: Vector3Like[]
      waypoints?: Array<{ name?: string; dock?: boolean }>
      name?: string
      editorFlags?: SceneNodeEditorFlags
    }): SceneNode | null {
      const build = buildGuideRouteDynamicMeshFromWorldPoints(payload.points)
      if (!build) {
        return null
      }

      const group = createGuideRouteGroup(build.definition)
      const nodeName = payload.name ?? 'Guide Route'

      this.captureHistorySnapshot()
      this.beginHistoryCaptureSuppression()
      try {
        const desiredId = typeof payload.nodeId === 'string' && payload.nodeId.trim().length ? payload.nodeId.trim() : null
        const existing = desiredId ? findNodeById(this.nodes, desiredId) : null

        const applyGuideRouteProps = (nodeId: string) => {
          const result = this.addNodeComponent(nodeId, GUIDE_ROUTE_COMPONENT_TYPE)
          const component = result?.component ?? (findNodeById(this.nodes, nodeId)?.components?.[GUIDE_ROUTE_COMPONENT_TYPE] as any)
          if (component?.id) {
            const waypoints = buildGuideRouteWaypointsFromPositions(build.definition.vertices, payload.waypoints)
            this.updateNodeComponentProps(nodeId, component.id, { waypoints })
          }
        }

        if (existing && desiredId) {
          if (payload.name && payload.name.trim() && existing.name !== payload.name.trim()) {
            this.renameNode(desiredId, payload.name.trim())
          }
          this.updateNodeTransform({
            id: desiredId,
            position: createVector(build.center.x, build.center.y, build.center.z),
            rotation: createVector(0, 0, 0),
            scale: createVector(1, 1, 1),
          })
          this.updateNodeDynamicMesh(desiredId, build.definition)
          applyGuideRouteProps(desiredId)
          return findNodeById(this.nodes, desiredId)
        }

        const node = this.addSceneNode({
          nodeId: desiredId ?? undefined,
          nodeType: 'Mesh',
          object: group,
          name: nodeName,
          position: createVector(build.center.x, build.center.y, build.center.z),
          rotation: createVector(0, 0, 0),
          scale: createVector(1, 1, 1),
          dynamicMesh: build.definition,
          editorFlags: payload.editorFlags,
        })

        if (node) {
          applyGuideRouteProps(node.id)
        }

        return node
      } finally {
        this.endHistoryCaptureSuppression()
      }
    },
    updateGuideRouteWaypoints(nodeId: string, options: {
      vertices: Vector3Like[]
      waypoints?: Array<Partial<GuideRouteWaypoint> | null | undefined>
      selectedWaypointIndex?: number | null
    }): boolean {
      const target = findNodeById(this.nodes, nodeId)
      if (!target || target.dynamicMesh?.type !== 'GuideRoute') {
        return false
      }

      const nextVertices = buildGuideRouteWaypointsFromPositions(options.vertices).map((entry) => entry.position)
      if (nextVertices.length < 2) {
        return false
      }

      const componentResult = this.addNodeComponent(nodeId, GUIDE_ROUTE_COMPONENT_TYPE)
      const component = componentResult?.component
        ?? (findNodeById(this.nodes, nodeId)?.components?.[GUIDE_ROUTE_COMPONENT_TYPE] as SceneNodeComponentState<GuideRouteComponentProps> | undefined)
      if (!component?.id) {
        return false
      }

      const currentWaypoints = Array.isArray(component.props?.waypoints) ? component.props.waypoints : []
      const waypointSource = Array.isArray(options.waypoints) ? options.waypoints : currentWaypoints
      const nextWaypoints = buildGuideRouteWaypointsFromPositions(nextVertices, waypointSource)

      this.captureHistorySnapshot()
      this.beginHistoryCaptureSuppression()
      try {
        this.updateNodeDynamicMesh(nodeId, {
          ...(target.dynamicMesh as GuideRouteDynamicMesh),
          vertices: nextVertices.map((point) => ({ x: point.x, y: point.y, z: point.z })),
        })
        this.updateNodeComponentProps(nodeId, component.id, { waypoints: nextWaypoints })

        const requestedIndex = typeof options.selectedWaypointIndex === 'number' && Number.isFinite(options.selectedWaypointIndex)
          ? Math.max(0, Math.floor(options.selectedWaypointIndex))
          : null
        const nextSelectedIndex = requestedIndex === null
          ? (this.selectedGuideRouteWaypoint?.nodeId === nodeId
              ? Math.min(this.selectedGuideRouteWaypoint.waypointIndex, nextWaypoints.length - 1)
              : null)
          : Math.min(requestedIndex, nextWaypoints.length - 1)

        if (nextSelectedIndex === null || nextWaypoints.length === 0) {
          this.clearSelectedGuideRouteWaypoint()
        } else {
          this.setSelectedGuideRouteWaypoint(nodeId, nextSelectedIndex)
        }
        return true
      } finally {
        this.endHistoryCaptureSuppression()
      }
    },

    createRegionNode(payload: {
      nodeId?: string
      points: Vector3Like[]
      name?: string
      editorFlags?: SceneNodeEditorFlags
    }): SceneNode | null {
      const build = buildRegionDynamicMeshFromWorldPoints(payload.points)
      if (!build) {
        return null
      }

      const group = new THREE.Group()
      group.name = payload.name ?? 'Region'
      group.userData = {
        ...(group.userData ?? {}),
        dynamicMeshType: 'Region',
      }
      const nodeName = payload.name ?? this.generateRegionNodeName()

      this.captureHistorySnapshot()
      this.beginHistoryCaptureSuppression()
      try {
        const desiredId = typeof payload.nodeId === 'string' && payload.nodeId.trim().length ? payload.nodeId.trim() : null
        const existing = desiredId ? findNodeById(this.nodes, desiredId) : null

        if (existing && desiredId) {
          if (payload.name && payload.name.trim() && existing.name !== payload.name.trim()) {
            this.renameNode(desiredId, payload.name.trim())
          }
          this.updateNodeTransform({
            id: desiredId,
            position: createVector(build.center.x, build.center.y, build.center.z),
            rotation: createVector(0, 0, 0),
            scale: createVector(1, 1, 1),
          })
          this.updateNodeDynamicMesh(desiredId, build.definition)
          return findNodeById(this.nodes, desiredId)
        }

        return this.addSceneNode({
          nodeId: desiredId ?? undefined,
          nodeType: 'Mesh',
          object: group,
          name: nodeName,
          position: createVector(build.center.x, build.center.y, build.center.z),
          rotation: createVector(0, 0, 0),
          scale: createVector(1, 1, 1),
          dynamicMesh: build.definition,
          editorFlags: payload.editorFlags,
        })
      } finally {
        this.endHistoryCaptureSuppression()
      }
    },

    updateRegionNode(payload: {
      nodeId: string
      localPoints: Array<[number, number]>
    }): SceneNode | null {
      const target = findNodeById(this.nodes, payload.nodeId)
      if (!target || target.dynamicMesh?.type !== 'Region') {
        return null
      }

      const nextMesh = buildRegionDynamicMeshFromLocalVertices(payload.localPoints)
      if (!nextMesh) {
        return null
      }

      this.captureHistorySnapshot()
      visitNode(this.nodes, payload.nodeId, (node) => {
        if (node.dynamicMesh?.type !== 'Region') {
          return
        }
        node.dynamicMesh = nextMesh
      })
      this.queueSceneNodePatch(payload.nodeId, ['dynamicMesh'])
      replaceSceneNodes(this, [...this.nodes])
      commitSceneSnapshot(this)
      return findNodeById(this.nodes, payload.nodeId)
    },

    updateWallNodeGeometry(nodeId: string, payload: {
      segments: Array<{ start: Vector3Like; end: Vector3Like }>
      dimensions?: { height?: number; width?: number; thickness?: number }
    }): boolean {
  const node = findNodeById(this.nodes, nodeId)
  if (!node || node.dynamicMesh?.type !== 'Wall') {
        return false
      }

      const wallComponent = node.components?.[WALL_COMPONENT_TYPE] as SceneNodeComponentState<WallComponentProps> | undefined
      const existingWallProps = wallComponent?.props
        ? clampWallProps(wallComponent.props as WallComponentProps)
        : null
      const wallBaseOffsetLocal = existingWallProps?.wallBaseOffsetLocal
      const baseOffsetX = Number((wallBaseOffsetLocal as any)?.x) || 0
      const baseOffsetY = Number((wallBaseOffsetLocal as any)?.y) || 0
      const baseOffsetZ = Number((wallBaseOffsetLocal as any)?.z) || 0

      // Line-build sessions operate on the currently visible world segments. Convert them
      // back to the unshifted baseline before rebuilding, then re-apply the local base
      // offset once to avoid recursive accumulation on previously committed segments.
      const normalizedSegments = (payload.segments ?? []).map((segment) => ({
        start: {
          x: Number(segment?.start?.x ?? 0) + baseOffsetX,
          y: Number(segment?.start?.y ?? 0) + baseOffsetY,
          z: Number(segment?.start?.z ?? 0) + baseOffsetZ,
        },
        end: {
          x: Number(segment?.end?.x ?? 0) + baseOffsetX,
          y: Number(segment?.end?.y ?? 0) + baseOffsetY,
          z: Number(segment?.end?.z ?? 0) + baseOffsetZ,
        },
      }))

      const nodeWorldMatrix = computeWorldMatrixForNode(this.nodes, nodeId)
      if (!nodeWorldMatrix) {
        return false
      }
      const inverseNodeWorldMatrix = nodeWorldMatrix.clone().invert()

      const nextDefinition = buildWallDynamicMeshForExistingNodeTransform(
        normalizedSegments,
        inverseNodeWorldMatrix,
        payload.dimensions,
      )
      if (!nextDefinition) {
        return false
      }

      if (Math.abs(baseOffsetX) > 1e-6 || Math.abs(baseOffsetY) > 1e-6 || Math.abs(baseOffsetZ) > 1e-6) {
        nextDefinition.chains = (nextDefinition.chains ?? []).map((chain) => ({
            ...chain,
            points: (chain.points ?? []).map((point) => ({
              x: Number(point?.x ?? 0) - baseOffsetX,
              y: Number(point?.y ?? 0) - baseOffsetY,
              z: Number(point?.z ?? 0) - baseOffsetZ,
            })),
          }))
      }

      const currentBodyMaterialConfigId = typeof (node.dynamicMesh as any)?.bodyMaterialConfigId === 'string'
        && (node.dynamicMesh as any).bodyMaterialConfigId.trim().length
        ? (node.dynamicMesh as any).bodyMaterialConfigId.trim()
        : null
      if (currentBodyMaterialConfigId) {
        nextDefinition.bodyMaterialConfigId = currentBodyMaterialConfigId
      }

      const parentMap = buildParentMap(this.nodes)
      const parentId = parentMap.get(nodeId) ?? null

      this.captureHistorySnapshot()
  node.dynamicMesh = nextDefinition

      // Keep wall component dimensions in sync with the wall mesh so inspector UI and runtime component state
      // always reflect geometry edits (e.g. gizmo height drag).
      const meshProps = resolveWallComponentPropsFromMesh(nextDefinition)
      const previousWallComponent = wallComponent
      const previousProps = previousWallComponent?.props as WallComponentProps | undefined
      const nextProps = clampWallProps({
        ...meshProps,
        ...(previousProps ?? {}),
        bodyOrientation: previousProps?.bodyOrientation ?? meshProps.bodyOrientation,
        headOrientation: previousProps?.headOrientation ?? meshProps.headOrientation,
        footOrientation: previousProps?.footOrientation ?? meshProps.footOrientation,
        bodyEndCapOrientation: previousProps?.bodyEndCapOrientation ?? meshProps.bodyEndCapOrientation,
        headEndCapOrientation: previousProps?.headEndCapOrientation ?? meshProps.headEndCapOrientation,
        footEndCapOrientation: previousProps?.footEndCapOrientation ?? meshProps.footEndCapOrientation,
        bodyMaterialConfigId: previousProps?.bodyMaterialConfigId ?? meshProps.bodyMaterialConfigId,
        height: meshProps.height,
        width: meshProps.width,
        thickness: meshProps.thickness,
      })
      const nextComponents: SceneNodeComponentMap = { ...(node.components ?? {}) }
      nextComponents[WALL_COMPONENT_TYPE] = {
        id: previousWallComponent?.id && previousWallComponent.id.trim().length ? previousWallComponent.id : generateUuid(),
        type: WALL_COMPONENT_TYPE,
        enabled: previousWallComponent?.enabled ?? true,
        props: cloneWallComponentProps(nextProps),
        metadata: previousWallComponent?.metadata,
      }
      node.components = nextComponents

      const recentered = parentId
        ? this.recenterGroupAncestry(parentId, { captureHistory: false, parentMap })
        : false
      if (!recentered) {
        this.queueSceneNodePatch(nodeId, ['transform', 'dynamicMesh', 'components'])
      } else {
        this.queueSceneNodePatch(nodeId, ['components'])
      }
      commitSceneSnapshot(this)

      // Ensure runtime component instances see the updated props.
      componentManager.syncNode(node)

      const runtime = getRuntimeObject(nodeId)
      if (runtime) {
        runtime.traverse((child) => {
          const group = child as THREE.Group
          if (!(group?.isGroup && group.name === 'WallGroup' && (group.userData as any)?.dynamicMeshType === 'Wall')) {
            return
          }
          updateWallGroup(group, nextDefinition, {
            wallRenderMode: resolveWallRenderMode(node),
            repeatInstanceStep: resolveWallRepeatInstanceStep(node),
          } as any)
        })
      }
      return true
    },
    setWallNodeDimensions(nodeId: string, dimensions: { height?: number; width?: number; thickness?: number }): boolean {
      const node = findNodeById(this.nodes, nodeId)
      if (!node || node.dynamicMesh?.type !== 'Wall') {
        return false
      }

      const current = resolveWallComponentPropsFromMesh(node.dynamicMesh)
      const wallComponent = node.components?.[WALL_COMPONENT_TYPE] as SceneNodeComponentState<WallComponentProps> | undefined
      const componentProps = wallComponent ? clampWallProps(wallComponent.props as WallComponentProps) : current

      const targetProps = clampWallProps({
        ...componentProps,
        height: dimensions.height ?? current.height,
        width: dimensions.width ?? current.width,
        thickness: dimensions.thickness ?? current.thickness,
      })

      const hasGeometryChange =
        Math.abs(current.height - targetProps.height) > WALL_DIMENSION_EPSILON ||
        Math.abs(current.width - targetProps.width) > WALL_DIMENSION_EPSILON ||
        Math.abs(current.thickness - targetProps.thickness) > WALL_DIMENSION_EPSILON

      const hasComponentChange =
        Math.abs(componentProps.height - targetProps.height) > WALL_DIMENSION_EPSILON ||
        Math.abs(componentProps.width - targetProps.width) > WALL_DIMENSION_EPSILON ||
        Math.abs(componentProps.thickness - targetProps.thickness) > WALL_DIMENSION_EPSILON

      if (!hasGeometryChange && !hasComponentChange) {
        return false
      }

      visitNode(this.nodes, nodeId, (target) => {
        applyWallComponentPropsToNode(target, targetProps)
        const previous = target.components?.[WALL_COMPONENT_TYPE] as SceneNodeComponentState<WallComponentProps> | undefined
        const previousProps = previous?.props as WallComponentProps | undefined

        const propsChanged =
          !previousProps ||
          Math.abs(previousProps.height - targetProps.height) > WALL_DIMENSION_EPSILON ||
          Math.abs(previousProps.width - targetProps.width) > WALL_DIMENSION_EPSILON ||
          Math.abs(previousProps.thickness - targetProps.thickness) > WALL_DIMENSION_EPSILON

        if (!propsChanged && previous) {
          return
        }

        const clonedMetadata: Record<string, unknown> | undefined = previous?.metadata

        const nextComponents: SceneNodeComponentMap = { ...(target.components ?? {}) }
        nextComponents[WALL_COMPONENT_TYPE] = {
          id:
            previous?.id && previous.id.trim().length ? previous.id : generateUuid(),
          type: WALL_COMPONENT_TYPE,
          enabled: previous?.enabled ?? true,
          props: cloneWallComponentProps(targetProps),
          metadata: clonedMetadata,
        }
        target.components = nextComponents
      })

      this.queueSceneNodePatch(nodeId, ['components', 'dynamicMesh', 'transform'])
      const normalizedNode = findNodeById(this.nodes, nodeId)
      if (normalizedNode) {
        componentManager.syncNode(normalizedNode)
      }
      return true
    },

    setFloorNodeThickness(nodeId: string, thickness: number, options: { captureHistory?: boolean } = {}): boolean {
      const node = findNodeById(this.nodes, nodeId)
      if (!node || node.dynamicMesh?.type !== 'Floor') {
        return false
      }

      const current = resolveFloorComponentPropsFromMesh(node.dynamicMesh as FloorDynamicMesh)

      const floorComponent = node.components?.[FLOOR_COMPONENT_TYPE] as SceneNodeComponentState<FloorComponentProps> | undefined
      const componentProps = floorComponent ? (floorComponent.props as FloorComponentProps) : current

      const currentSmooth = Number.isFinite(componentProps.smooth) ? componentProps.smooth : current.smooth
      const currentSideUvScale = componentProps.sideUvScale ?? current.sideUvScale

      const targetProps = clampFloorComponentProps({
        smooth: currentSmooth,
        thickness,
        sideUvScale: currentSideUvScale,
      })

      const meshThickness = Number.isFinite((node.dynamicMesh as any).thickness)
        ? Number((node.dynamicMesh as any).thickness)
        : FLOOR_DEFAULT_THICKNESS
      const componentThickness = Number.isFinite(componentProps.thickness) ? componentProps.thickness : FLOOR_DEFAULT_THICKNESS

      const hasGeometryChange = Math.abs(meshThickness - targetProps.thickness) > 1e-6
      const hasComponentChange = Math.abs(componentThickness - targetProps.thickness) > 1e-6
      if (!hasGeometryChange && !hasComponentChange) {
        return false
      }

      if (options.captureHistory) {
        this.captureHistorySnapshot()
      }

      visitNode(this.nodes, nodeId, (target) => {
        floorHelpers.applyFloorComponentPropsToNode(target, targetProps)
        const previous = target.components?.[FLOOR_COMPONENT_TYPE] as SceneNodeComponentState<FloorComponentProps> | undefined
        const previousProps = previous?.props as FloorComponentProps | undefined

        const propsChanged =
          !previousProps ||
          Math.abs((Number.isFinite(previousProps.thickness) ? previousProps.thickness : FLOOR_DEFAULT_THICKNESS) - targetProps.thickness) > 1e-6

        if (!propsChanged && previous) {
          return
        }

        const nextComponents: SceneNodeComponentMap = { ...(target.components ?? {}) }
        nextComponents[FLOOR_COMPONENT_TYPE] = {
          id: previous?.id && previous.id.trim().length ? previous.id : generateUuid(),
          type: FLOOR_COMPONENT_TYPE,
          enabled: previous?.enabled ?? true,
          props: cloneFloorComponentProps(targetProps),
          metadata: previous?.metadata,
        }
        target.components = nextComponents
      })

      this.queueSceneNodePatch(nodeId, ['components', 'dynamicMesh'])
      const normalizedNode = findNodeById(this.nodes, nodeId)
      if (normalizedNode) {
        componentManager.syncNode(normalizedNode)
      }
      if (options.captureHistory) {
        commitSceneSnapshot(this)
      }
      return true
    },
    addNodeComponent<T extends NodeComponentType>(
      nodeId: string,
      type: T,
    ): AddNodeComponentResult<T> | null {
      const target = findNodeById(this.nodes, nodeId)
      if (!target) {
        return null
      }
      const definition = componentManager.getDefinition(type)
      if (!definition || !definition.canAttach(target)) {
        return null
      }
      const existing = target.components?.[type] as SceneNodeComponentState<NodeComponentPropsOf<T>> | undefined
      if (existing) {
        return { component: existing, created: false }
      }

      const requestedState: SceneNodeComponentState<NodeComponentPropsOf<T>> = {
        id: generateUuid(),
        type,
        enabled: true,
        props: definition.createDefaultProps(target) as NodeComponentPropsOf<T>,
      }

      if (type === VEHICLE_COMPONENT_TYPE) {
        const base = clampVehicleComponentProps(requestedState.props as VehicleComponentProps)
        const inferredWheels = inferVehicleWheelsFromNode(target, base.indexForwardAxis)
        if (inferredWheels.length) {
          requestedState.props = clampVehicleComponentProps({
            ...base,
            wheels: inferredWheels,
          } as any) as unknown as NodeComponentPropsOf<T>
        }
      }

      const statesToAdd: SceneNodeComponentState<any>[] = [requestedState]

      if (type === VEHICLE_COMPONENT_TYPE && !target.components?.[RIGIDBODY_COMPONENT_TYPE]) {
        const rigidbodyDefinition = componentManager.getDefinition(RIGIDBODY_COMPONENT_TYPE)
        if (rigidbodyDefinition?.canAttach(target)) {
          statesToAdd.unshift({
            id: generateUuid(),
            type: RIGIDBODY_COMPONENT_TYPE,
            enabled: true,
            props: rigidbodyDefinition.createDefaultProps(target),
          })
        }
      }

      visitNode(this.nodes, nodeId, (node) => {
        const nextComponents: SceneNodeComponentMap = { ...(node.components ?? {}) }
        statesToAdd.forEach((componentState) => {
          nextComponents[componentState.type] = {
            ...componentState,
          }
          if (componentState.type === WALL_COMPONENT_TYPE) {
            applyWallComponentPropsToNode(node, componentState.props as unknown as WallComponentProps)
          } else if (componentState.type === BILLBOARD_COMPONENT_TYPE) {
            // Billboard runtime is texture-driven; no geometry sync is required here.
          } else if (componentState.type === DISPLAY_BOARD_COMPONENT_TYPE) {
            applyDisplayBoardComponentPropsToNode(
              node,
              componentState.props as unknown as DisplayBoardComponentProps,
            )
          } else if (componentState.type === FLOOR_COMPONENT_TYPE) {
            floorHelpers.applyFloorComponentPropsToNode(node, componentState.props as FloorComponentProps)
          } else if (componentState.type === LANDFORM_COMPONENT_TYPE) {
            landformHelpers.applyLandformComponentPropsToNode(node, componentState.props as LandformComponentProps)
          }else if (componentState.type === ROAD_COMPONENT_TYPE) {
            const groundNode = resolveGroundNodeForHeightSampling(this.nodes)
            applyRoadComponentPropsToNode(node, componentState.props as RoadComponentProps, groundNode)
          } 
        })
        node.components = nextComponents
      })

      this.queueSceneNodePatch(
        nodeId,
        type === WALL_COMPONENT_TYPE ? ['components', 'dynamicMesh', 'transform'] : ['components', 'dynamicMesh'],
      )
      const updatedNode = findNodeById(this.nodes, nodeId)
      if (updatedNode) {
        componentManager.syncNode(updatedNode)
      }
      commitSceneSnapshot(this)
      return { component: requestedState, created: true }
    },
    removeNodeComponent(nodeId: string, componentId: string): boolean {
      const target = findNodeById(this.nodes, nodeId)
      const entry = findComponentEntryById(target?.components, componentId)
      if (!entry) {
        return false
      }

      this.captureHistorySnapshot()
      visitNode(this.nodes, nodeId, (node) => {
        const match = findComponentEntryById(node.components, componentId)
        if (!match) {
          return
        }
        const [type] = match
        const nextComponents: SceneNodeComponentMap = { ...(node.components ?? {}) }
        delete nextComponents[type]
        node.components = componentCount(nextComponents) ? nextComponents : undefined
      })

      this.queueSceneNodePatch(nodeId, ['components', 'dynamicMesh'])
      const updatedNode = findNodeById(this.nodes, nodeId)
      if (updatedNode) {
        componentManager.syncNode(updatedNode)
      }
      commitSceneSnapshot(this)
      return true
    },
    setNodeComponentEnabled(nodeId: string, componentId: string, enabled: boolean): boolean {
      const target = findNodeById(this.nodes, nodeId)
      const match = findComponentEntryById(target?.components, componentId)
      if (!match) {
        return false
      }
  const [, component] = match
  if ((component.enabled ?? true) === enabled) {
        return false
      }

      visitNode(this.nodes, nodeId, (node) => {
        const current = findComponentEntryById(node.components, componentId)
        if (!current) {
          return
        }
        const [currentType, state] = current
        const nextComponents: SceneNodeComponentMap = { ...(node.components ?? {}) }
        nextComponents[currentType] = {
          ...state,
          type: currentType,
          enabled,
        }
        node.components = nextComponents
      })

      this.queueSceneNodePatch(nodeId, ['components'])
      const updatedNode = findNodeById(this.nodes, nodeId)
      if (updatedNode) {
        componentManager.syncNode(updatedNode)
      }
      return true
    },
    toggleNodeComponentEnabled(nodeId: string, componentId: string): boolean {
      const match = findComponentEntryById(findNodeById(this.nodes, nodeId)?.components, componentId)
      if (!match) {
        return false
      }
      const [, component] = match
      return this.setNodeComponentEnabled(nodeId, componentId, !(component.enabled ?? true))
    },
  updateNodeComponentProps(nodeId: string, componentId: string, patch: Partial<Record<string, unknown>>): boolean {
      const target = findNodeById(this.nodes, nodeId)
      const match = findComponentEntryById(target?.components, componentId)
      if (!match) {
        return false
      }
      const [type, component] = match

      const definition = componentManager.getDefinition(type)
      if (!definition) {
        return false
      }

      let nextProps:
        | Record<string, unknown>
        | WallComponentProps
        | RoadComponentProps
        | BillboardComponentProps
        | DisplayBoardComponentProps
        | PlanningImagesComponentProps
        | WarpGateComponentProps
        | FloorComponentProps
        | LandformComponentProps
        | EffectComponentProps
        | RigidbodyComponentProps
        | VehicleComponentProps
        | WaterComponentProps
        | NominateComponentProps
      let wallCenterOffsetDelta: { x: number; y: number; z: number } | null = null
      let isOffsetOnlyWallPatch = false
      if (type === WALL_COMPONENT_TYPE) {
        const currentProps = clampWallProps(component.props as WallComponentProps)
        const typedPatch = patch as Partial<WallComponentProps>
        const hasBodyMaterialConfigId = Object.prototype.hasOwnProperty.call(typedPatch, 'bodyMaterialConfigId')
        const hasBodyAssetId = Object.prototype.hasOwnProperty.call(typedPatch, 'bodyAssetId')
        const hasHeadAssetId = Object.prototype.hasOwnProperty.call(typedPatch, 'headAssetId')
        const hasHeadAssetHeight = Object.prototype.hasOwnProperty.call(typedPatch, 'headAssetHeight')
        const hasFootAssetId = Object.prototype.hasOwnProperty.call(typedPatch, 'footAssetId')
        const hasFootAssetHeight = Object.prototype.hasOwnProperty.call(typedPatch, 'footAssetHeight')
        const hasWallBaseOffsetLocal = Object.prototype.hasOwnProperty.call(typedPatch, 'wallBaseOffsetLocal')
        const hasBodyEndCapAssetId = Object.prototype.hasOwnProperty.call(typedPatch, 'bodyEndCapAssetId')
        const hasHeadEndCapAssetId = Object.prototype.hasOwnProperty.call(typedPatch, 'headEndCapAssetId')
        const hasFootEndCapAssetId = Object.prototype.hasOwnProperty.call(typedPatch, 'footEndCapAssetId')
        const hasBodyEndCapOffsetLocal = Object.prototype.hasOwnProperty.call(typedPatch, 'bodyEndCapOffsetLocal')
        const hasHeadEndCapOffsetLocal = Object.prototype.hasOwnProperty.call(typedPatch, 'headEndCapOffsetLocal')
        const hasFootEndCapOffsetLocal = Object.prototype.hasOwnProperty.call(typedPatch, 'footEndCapOffsetLocal')
        const hasBodyOrientation = Object.prototype.hasOwnProperty.call(typedPatch, 'bodyOrientation')
        const hasBodyUvAxis = Object.prototype.hasOwnProperty.call(typedPatch, 'bodyUvAxis')
        const hasHeadOrientation = Object.prototype.hasOwnProperty.call(typedPatch, 'headOrientation')
        const hasHeadUvAxis = Object.prototype.hasOwnProperty.call(typedPatch, 'headUvAxis')
        const hasFootOrientation = Object.prototype.hasOwnProperty.call(typedPatch, 'footOrientation')
        const hasFootUvAxis = Object.prototype.hasOwnProperty.call(typedPatch, 'footUvAxis')
        const hasBodyEndCapOrientation = Object.prototype.hasOwnProperty.call(typedPatch, 'bodyEndCapOrientation')
        const hasHeadEndCapOrientation = Object.prototype.hasOwnProperty.call(typedPatch, 'headEndCapOrientation')
        const hasFootEndCapOrientation = Object.prototype.hasOwnProperty.call(typedPatch, 'footEndCapOrientation')
        const hasForbidden = Object.prototype.hasOwnProperty.call(typedPatch, 'forbidden')
        const hasIsAirWall = Object.prototype.hasOwnProperty.call(typedPatch, 'isAirWall')
        const hasWallRenderMode = Object.prototype.hasOwnProperty.call(typedPatch, 'wallRenderMode')
        const hasRepeatInstanceStep = Object.prototype.hasOwnProperty.call(typedPatch, 'repeatInstanceStep')
        const hasCornerModels = Object.prototype.hasOwnProperty.call(typedPatch, 'cornerModels')
        const patchKeys = Object.keys(typedPatch)
        isOffsetOnlyWallPatch = hasWallBaseOffsetLocal && patchKeys.length === 1

        const orientationsEqual = (a: any, b: any): boolean => {
          const axisA = typeof a?.forwardAxis === 'string' ? a.forwardAxis : null
          const axisB = typeof b?.forwardAxis === 'string' ? b.forwardAxis : null
          const yawA = typeof a?.yawDeg === 'number' ? a.yawDeg : Number(a?.yawDeg)
          const yawB = typeof b?.yawDeg === 'number' ? b.yawDeg : Number(b?.yawDeg)
          if ((axisA ?? null) !== (axisB ?? null)) {
            return false
          }
          if (!Number.isFinite(yawA) || !Number.isFinite(yawB) || Math.abs(yawA - yawB) > 1e-6) {
            return false
          }
          return true
        }

        const cornerModelsEqual = (a: unknown, b: unknown): boolean => {
          const arrA = Array.isArray(a) ? a : []
          const arrB = Array.isArray(b) ? b : []
          if (arrA.length !== arrB.length) {
            return false
          }
          const readOffset = (entry: any, key: 'bodyOffsetLocal' | 'headOffsetLocal' | 'footOffsetLocal'): { x: number; y: number; z: number } => {
            const record = entry?.[key] && typeof entry[key] === 'object' ? entry[key] : null
            const read = (axis: 'x' | 'y' | 'z'): number => {
              const raw = record ? (record as any)[axis] : 0
              const num = typeof raw === 'number' ? raw : Number(raw)
              return Number.isFinite(num) ? num : 0
            }
            return { x: read('x'), y: read('y'), z: read('z') }
          }
          for (let i = 0; i < arrA.length; i += 1) {
            const entryA = arrA[i] as any
            const entryB = arrB[i] as any
            const bodyAssetA = typeof entryA?.bodyAssetId === 'string' ? entryA.bodyAssetId : null
            const bodyAssetB = typeof entryB?.bodyAssetId === 'string' ? entryB.bodyAssetId : null
            const headAssetA = typeof entryA?.headAssetId === 'string' ? entryA.headAssetId : null
            const headAssetB = typeof entryB?.headAssetId === 'string' ? entryB.headAssetId : null
            const footAssetA = typeof entryA?.footAssetId === 'string' ? entryA.footAssetId : null
            const footAssetB = typeof entryB?.footAssetId === 'string' ? entryB.footAssetId : null
            const angleA = typeof entryA?.angle === 'number' ? entryA.angle : Number(entryA?.angle)
            const angleB = typeof entryB?.angle === 'number' ? entryB.angle : Number(entryB?.angle)
            const toleranceA = typeof entryA?.tolerance === 'number' ? entryA.tolerance : Number(entryA?.tolerance)
            const toleranceB = typeof entryB?.tolerance === 'number' ? entryB.tolerance : Number(entryB?.tolerance)

            const bodyForwardAxisA = typeof entryA?.bodyForwardAxis === 'string' ? entryA.bodyForwardAxis : null
            const bodyForwardAxisB = typeof entryB?.bodyForwardAxis === 'string' ? entryB.bodyForwardAxis : null
            const bodyYawDegA = typeof entryA?.bodyYawDeg === 'number' ? entryA.bodyYawDeg : Number(entryA?.bodyYawDeg)
            const bodyYawDegB = typeof entryB?.bodyYawDeg === 'number' ? entryB.bodyYawDeg : Number(entryB?.bodyYawDeg)

            const headForwardAxisA = typeof entryA?.headForwardAxis === 'string' ? entryA.headForwardAxis : null
            const headForwardAxisB = typeof entryB?.headForwardAxis === 'string' ? entryB.headForwardAxis : null
            const headYawDegA = typeof entryA?.headYawDeg === 'number' ? entryA.headYawDeg : Number(entryA?.headYawDeg)
            const headYawDegB = typeof entryB?.headYawDeg === 'number' ? entryB.headYawDeg : Number(entryB?.headYawDeg)

            const footForwardAxisA = typeof entryA?.footForwardAxis === 'string' ? entryA.footForwardAxis : null
            const footForwardAxisB = typeof entryB?.footForwardAxis === 'string' ? entryB.footForwardAxis : null
            const footYawDegA = typeof entryA?.footYawDeg === 'number' ? entryA.footYawDeg : Number(entryA?.footYawDeg)
            const footYawDegB = typeof entryB?.footYawDeg === 'number' ? entryB.footYawDeg : Number(entryB?.footYawDeg)

            const bodyOffsetA = readOffset(entryA, 'bodyOffsetLocal')
            const bodyOffsetB = readOffset(entryB, 'bodyOffsetLocal')
            const headOffsetA = readOffset(entryA, 'headOffsetLocal')
            const headOffsetB = readOffset(entryB, 'headOffsetLocal')
            const footOffsetA = readOffset(entryA, 'footOffsetLocal')
            const footOffsetB = readOffset(entryB, 'footOffsetLocal')
            const trimStartA = typeof entryA?.jointTrim?.start === 'number' ? entryA.jointTrim.start : Number(entryA?.jointTrim?.start)
            const trimStartB = typeof entryB?.jointTrim?.start === 'number' ? entryB.jointTrim.start : Number(entryB?.jointTrim?.start)
            const trimEndA = typeof entryA?.jointTrim?.end === 'number' ? entryA.jointTrim.end : Number(entryA?.jointTrim?.end)
            const trimEndB = typeof entryB?.jointTrim?.end === 'number' ? entryB.jointTrim.end : Number(entryB?.jointTrim?.end)

            if ((bodyAssetA ?? null) !== (bodyAssetB ?? null)) {
              return false
            }
            if ((headAssetA ?? null) !== (headAssetB ?? null)) {
              return false
            }
            if ((footAssetA ?? null) !== (footAssetB ?? null)) {
              return false
            }
            if (!Number.isFinite(angleA) || !Number.isFinite(angleB) || Math.abs(angleA - angleB) > 1e-6) {
              return false
            }
            if (!Number.isFinite(toleranceA) || !Number.isFinite(toleranceB) || Math.abs(toleranceA - toleranceB) > 1e-6) {
              return false
            }

            if ((bodyForwardAxisA ?? null) !== (bodyForwardAxisB ?? null)) {
              return false
            }
            if (!Number.isFinite(bodyYawDegA) || !Number.isFinite(bodyYawDegB) || Math.abs(bodyYawDegA - bodyYawDegB) > 1e-6) {
              return false
            }
            if ((headForwardAxisA ?? null) !== (headForwardAxisB ?? null)) {
              return false
            }
            if (!Number.isFinite(headYawDegA) || !Number.isFinite(headYawDegB) || Math.abs(headYawDegA - headYawDegB) > 1e-6) {
              return false
            }
            if ((footForwardAxisA ?? null) !== (footForwardAxisB ?? null)) {
              return false
            }
            if (!Number.isFinite(footYawDegA) || !Number.isFinite(footYawDegB) || Math.abs(footYawDegA - footYawDegB) > 1e-6) {
              return false
            }

            if (Math.abs(bodyOffsetA.x - bodyOffsetB.x) > 1e-6 || Math.abs(bodyOffsetA.y - bodyOffsetB.y) > 1e-6 || Math.abs(bodyOffsetA.z - bodyOffsetB.z) > 1e-6) {
              return false
            }
            if (Math.abs(headOffsetA.x - headOffsetB.x) > 1e-6 || Math.abs(headOffsetA.y - headOffsetB.y) > 1e-6 || Math.abs(headOffsetA.z - headOffsetB.z) > 1e-6) {
              return false
            }
            if (Math.abs(footOffsetA.x - footOffsetB.x) > 1e-6 || Math.abs(footOffsetA.y - footOffsetB.y) > 1e-6 || Math.abs(footOffsetA.z - footOffsetB.z) > 1e-6) {
              return false
            }
            if (!Number.isFinite(trimStartA) || !Number.isFinite(trimStartB) || Math.abs(trimStartA - trimStartB) > 1e-6) {
              return false
            }
            if (!Number.isFinite(trimEndA) || !Number.isFinite(trimEndB) || Math.abs(trimEndA - trimEndB) > 1e-6) {
              return false
            }
          }
          return true
        }

        const offsetLocalEqual = (a: unknown, b: unknown): boolean => {
          const read = (value: unknown, key: 'x' | 'y' | 'z'): number => {
            const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
            const raw = record ? record[key] : 0
            const num = typeof raw === 'number' ? raw : Number(raw)
            return Number.isFinite(num) ? num : 0
          }
          return (
            Math.abs(read(a, 'x') - read(b, 'x')) <= 1e-6
            && Math.abs(read(a, 'y') - read(b, 'y')) <= 1e-6
            && Math.abs(read(a, 'z') - read(b, 'z')) <= 1e-6
          )
        }

        const merged = clampWallProps({
          height: (typedPatch.height as number | undefined) ?? currentProps.height,
          width: (typedPatch.width as number | undefined) ?? currentProps.width,
          thickness: (typedPatch.thickness as number | undefined) ?? currentProps.thickness,
          wallBaseOffsetLocal: hasWallBaseOffsetLocal
            ? (typedPatch.wallBaseOffsetLocal as any)
            : currentProps.wallBaseOffsetLocal,
          bodyMaterialConfigId: hasBodyMaterialConfigId
            ? (typedPatch.bodyMaterialConfigId as string | null | undefined)
            : currentProps.bodyMaterialConfigId,
          forbidden: hasForbidden
            ? (typedPatch.forbidden as boolean | undefined)
            : currentProps.forbidden,
          isAirWall: hasIsAirWall
            ? (typedPatch.isAirWall as boolean | undefined)
            : currentProps.isAirWall,
          wallRenderMode: hasWallRenderMode
            ? (typedPatch.wallRenderMode as any)
            : currentProps.wallRenderMode,
          repeatInstanceStep: hasRepeatInstanceStep
            ? (typedPatch.repeatInstanceStep as number | undefined)
            : currentProps.repeatInstanceStep,
          bodyAssetId: hasBodyAssetId
            ? (typedPatch.bodyAssetId as string | null | undefined)
            : currentProps.bodyAssetId,
          headAssetId: hasHeadAssetId
            ? (typedPatch.headAssetId as string | null | undefined)
            : currentProps.headAssetId,
          headAssetHeight: hasHeadAssetHeight
            ? (typedPatch.headAssetHeight as number | undefined)
            : currentProps.headAssetHeight,
          footAssetId: hasFootAssetId
            ? (typedPatch.footAssetId as string | null | undefined)
            : currentProps.footAssetId,
          footAssetHeight: hasFootAssetHeight
            ? (typedPatch.footAssetHeight as number | undefined)
            : currentProps.footAssetHeight,
          bodyEndCapAssetId: hasBodyEndCapAssetId
            ? (typedPatch.bodyEndCapAssetId as string | null | undefined)
            : currentProps.bodyEndCapAssetId,
          bodyEndCapOffsetLocal: hasBodyEndCapOffsetLocal
            ? (typedPatch.bodyEndCapOffsetLocal as any)
            : currentProps.bodyEndCapOffsetLocal,
          headEndCapAssetId: hasHeadEndCapAssetId
            ? (typedPatch.headEndCapAssetId as string | null | undefined)
            : currentProps.headEndCapAssetId,
          headEndCapOffsetLocal: hasHeadEndCapOffsetLocal
            ? (typedPatch.headEndCapOffsetLocal as any)
            : currentProps.headEndCapOffsetLocal,
          footEndCapAssetId: hasFootEndCapAssetId
            ? (typedPatch.footEndCapAssetId as string | null | undefined)
            : currentProps.footEndCapAssetId,
          footEndCapOffsetLocal: hasFootEndCapOffsetLocal
            ? (typedPatch.footEndCapOffsetLocal as any)
            : currentProps.footEndCapOffsetLocal,
          bodyOrientation: hasBodyOrientation
            ? (typedPatch.bodyOrientation as any)
            : currentProps.bodyOrientation,
          bodyUvAxis: hasBodyUvAxis
            ? (typedPatch.bodyUvAxis as any)
            : currentProps.bodyUvAxis,
          headOrientation: hasHeadOrientation
            ? (typedPatch.headOrientation as any)
            : currentProps.headOrientation,
          headUvAxis: hasHeadUvAxis
            ? (typedPatch.headUvAxis as any)
            : currentProps.headUvAxis,
          footOrientation: hasFootOrientation
            ? (typedPatch.footOrientation as any)
            : currentProps.footOrientation,
          footUvAxis: hasFootUvAxis
            ? (typedPatch.footUvAxis as any)
            : currentProps.footUvAxis,
          bodyEndCapOrientation: hasBodyEndCapOrientation
            ? (typedPatch.bodyEndCapOrientation as any)
            : currentProps.bodyEndCapOrientation,
          headEndCapOrientation: hasHeadEndCapOrientation
            ? (typedPatch.headEndCapOrientation as any)
            : currentProps.headEndCapOrientation,
          footEndCapOrientation: hasFootEndCapOrientation
            ? (typedPatch.footEndCapOrientation as any)
            : currentProps.footEndCapOrientation,
          cornerModels: hasCornerModels
            ? (typedPatch.cornerModels as any)
            : currentProps.cornerModels,
        })

        const unchanged =
          Math.abs(currentProps.height - merged.height) <= 1e-4 &&
          Math.abs(currentProps.width - merged.width) <= 1e-4 &&
          Math.abs(currentProps.thickness - merged.thickness) <= 1e-4 &&
          offsetLocalEqual(currentProps.wallBaseOffsetLocal, merged.wallBaseOffsetLocal) &&
          (currentProps.bodyMaterialConfigId ?? null) === (merged.bodyMaterialConfigId ?? null) &&
          currentProps.forbidden === merged.forbidden &&
          currentProps.isAirWall === merged.isAirWall &&
          currentProps.wallRenderMode === merged.wallRenderMode &&
          Math.abs(currentProps.repeatInstanceStep - merged.repeatInstanceStep) <= 1e-6 &&
          (currentProps.bodyAssetId ?? null) === (merged.bodyAssetId ?? null) &&
          (currentProps.headAssetId ?? null) === (merged.headAssetId ?? null) &&
          Math.abs(currentProps.headAssetHeight - merged.headAssetHeight) <= 1e-6 &&
          (currentProps.footAssetId ?? null) === (merged.footAssetId ?? null) &&
          Math.abs(currentProps.footAssetHeight - merged.footAssetHeight) <= 1e-6 &&
          (currentProps.bodyEndCapAssetId ?? null) === (merged.bodyEndCapAssetId ?? null) &&
          offsetLocalEqual(currentProps.bodyEndCapOffsetLocal, merged.bodyEndCapOffsetLocal) &&
          (currentProps.headEndCapAssetId ?? null) === (merged.headEndCapAssetId ?? null) &&
          offsetLocalEqual(currentProps.headEndCapOffsetLocal, merged.headEndCapOffsetLocal) &&
          (currentProps.footEndCapAssetId ?? null) === (merged.footEndCapAssetId ?? null) &&
          offsetLocalEqual(currentProps.footEndCapOffsetLocal, merged.footEndCapOffsetLocal) &&
          orientationsEqual(currentProps.bodyOrientation, merged.bodyOrientation) &&
          (currentProps.bodyUvAxis ?? 'auto') === (merged.bodyUvAxis ?? 'auto') &&
          orientationsEqual(currentProps.headOrientation, merged.headOrientation) &&
          (currentProps.headUvAxis ?? 'auto') === (merged.headUvAxis ?? 'auto') &&
          orientationsEqual(currentProps.footOrientation, merged.footOrientation) &&
          (currentProps.footUvAxis ?? 'auto') === (merged.footUvAxis ?? 'auto') &&
          orientationsEqual(currentProps.bodyEndCapOrientation, merged.bodyEndCapOrientation) &&
          orientationsEqual(currentProps.headEndCapOrientation, merged.headEndCapOrientation) &&
          orientationsEqual(currentProps.footEndCapOrientation, merged.footEndCapOrientation) &&
          cornerModelsEqual(currentProps.cornerModels, merged.cornerModels)
        if (unchanged) {
          return false
        }

        wallCenterOffsetDelta = {
          x: (Number((merged.wallBaseOffsetLocal as any)?.x) || 0) - (Number((currentProps.wallBaseOffsetLocal as any)?.x) || 0),
          y: (Number((merged.wallBaseOffsetLocal as any)?.y) || 0) - (Number((currentProps.wallBaseOffsetLocal as any)?.y) || 0),
          z: (Number((merged.wallBaseOffsetLocal as any)?.z) || 0) - (Number((currentProps.wallBaseOffsetLocal as any)?.z) || 0),
        }

        nextProps = cloneWallComponentProps(merged)
      } else if (type === ROAD_COMPONENT_TYPE) {
        const currentProps = component.props as RoadComponentProps
        const typedPatch = patch as Partial<RoadComponentProps>
        const merged = clampRoadProps({
          ...currentProps,
          ...typedPatch,
        })

        const unchanged =
          Math.abs(currentProps.width - merged.width) <= 1e-4 &&
          Math.abs(currentProps.junctionSmoothing - merged.junctionSmoothing) <= 1e-4 &&
          currentProps.laneLines === merged.laneLines &&
          currentProps.shoulders === merged.shoulders &&
          (currentProps.bodyAssetId ?? null) === (merged.bodyAssetId ?? null) &&
          Math.abs((currentProps.samplingDensityFactor ?? 1.0) - (merged.samplingDensityFactor ?? 1.0)) <= 1e-4 &&
          Math.abs((currentProps.smoothingStrengthFactor ?? 1.0) - (merged.smoothingStrengthFactor ?? 1.0)) <= 1e-4 &&
          Math.abs((currentProps.minClearance ?? 0.01) - (merged.minClearance ?? 0.01)) <= 1e-4 &&
          optionalNumberEquals(currentProps.laneLineWidth, merged.laneLineWidth) &&
          optionalNumberEquals(currentProps.shoulderWidth, merged.shoulderWidth)

        if (unchanged) {
          return false
        }
        nextProps = cloneRoadComponentProps(merged)
      } else if (type === DISPLAY_BOARD_COMPONENT_TYPE) {
        const currentProps = component.props as DisplayBoardComponentProps
        const typedPatch = patch as Partial<DisplayBoardComponentProps>
        const hasIntrinsicWidth = Object.prototype.hasOwnProperty.call(typedPatch, 'intrinsicWidth')
        const hasIntrinsicHeight = Object.prototype.hasOwnProperty.call(typedPatch, 'intrinsicHeight')
        const hasAdaptation = Object.prototype.hasOwnProperty.call(typedPatch, 'adaptation')
        const nextAdaptation = hasAdaptation
          ? typedPatch.adaptation === 'fill'
            ? 'fill'
            : 'fit'
          : currentProps.adaptation ?? 'fit'
        const merged = clampDisplayBoardComponentProps({
          assetId: typeof typedPatch.assetId === 'string' ? typedPatch.assetId : currentProps.assetId,
          intrinsicWidth: hasIntrinsicWidth ? typedPatch.intrinsicWidth ?? undefined : currentProps.intrinsicWidth,
          intrinsicHeight: hasIntrinsicHeight ? typedPatch.intrinsicHeight ?? undefined : currentProps.intrinsicHeight,
          adaptation: nextAdaptation,
        })
        const unchanged =
          (currentProps.assetId ?? '') === merged.assetId &&
          optionalNumberEquals(currentProps.intrinsicWidth, merged.intrinsicWidth) &&
          optionalNumberEquals(currentProps.intrinsicHeight, merged.intrinsicHeight) &&
          (currentProps.adaptation ?? 'fit') === merged.adaptation
        if (unchanged) {
          return false
        }
        nextProps = cloneDisplayBoardComponentProps(merged)
      } else if (type === BILLBOARD_COMPONENT_TYPE) {
        const currentProps = component.props as BillboardComponentProps
        const typedPatch = patch as Partial<BillboardComponentProps>
        const hasIntrinsicWidth = Object.prototype.hasOwnProperty.call(typedPatch, 'intrinsicWidth')
        const hasIntrinsicHeight = Object.prototype.hasOwnProperty.call(typedPatch, 'intrinsicHeight')
        const hasAdaptation = Object.prototype.hasOwnProperty.call(typedPatch, 'adaptation')
        const nextAdaptation = hasAdaptation
          ? typedPatch.adaptation === 'fill'
            ? 'fill'
            : 'fit'
          : currentProps.adaptation ?? 'fit'
        const merged = clampBillboardComponentProps({
          assetId: typeof typedPatch.assetId === 'string' ? typedPatch.assetId : currentProps.assetId,
          intrinsicWidth: hasIntrinsicWidth ? typedPatch.intrinsicWidth ?? undefined : currentProps.intrinsicWidth,
          intrinsicHeight: hasIntrinsicHeight ? typedPatch.intrinsicHeight ?? undefined : currentProps.intrinsicHeight,
          adaptation: nextAdaptation,
        })
        const unchanged =
          (currentProps.assetId ?? '') === merged.assetId &&
          optionalNumberEquals(currentProps.intrinsicWidth, merged.intrinsicWidth) &&
          optionalNumberEquals(currentProps.intrinsicHeight, merged.intrinsicHeight) &&
          (currentProps.adaptation ?? 'fit') === merged.adaptation
        if (unchanged) {
          return false
        }
        nextProps = cloneBillboardComponentProps(merged)
      } else if (type === PLANNING_IMAGES_COMPONENT_TYPE) {
        const currentProps = clampPlanningImagesComponentProps(component.props as PlanningImagesComponentProps)
        const typedPatch = patch as Partial<PlanningImagesComponentProps>
        const merged = clampPlanningImagesComponentProps({
          images: Array.isArray(typedPatch.images) ? typedPatch.images : currentProps.images,
        })
        const unchanged = JSON.stringify(currentProps) === JSON.stringify(merged)
        if (unchanged) {
          return false
        }
        nextProps = clonePlanningImagesComponentProps(merged)
      } else if (type === WARP_GATE_COMPONENT_TYPE) {
        const currentProps = clampWarpGateComponentProps(component.props as WarpGateComponentProps)
        const typedPatch = patch as Partial<WarpGateComponentProps>
        const merged = clampWarpGateComponentProps({
          ...currentProps,
          ...typedPatch,
        })
        const unchanged =
          currentProps.color === merged.color &&
          Math.abs(currentProps.intensity - merged.intensity) <= 1e-4 &&
          Math.abs(currentProps.particleSize - merged.particleSize) <= 1e-4 &&
          currentProps.particleCount === merged.particleCount &&
          currentProps.showParticles === merged.showParticles &&
          currentProps.showBeams === merged.showBeams &&
          currentProps.showRings === merged.showRings
        if (unchanged) {
          return false
        }
        nextProps = cloneWarpGateComponentProps(merged)
      } else if (type === FLOOR_COMPONENT_TYPE) {
        const currentProps = component.props as FloorComponentProps
        const typedPatch = patch as Partial<FloorComponentProps>
        const hasSmoothPatch = Object.prototype.hasOwnProperty.call(typedPatch, 'smooth')
        const hasThicknessPatch = Object.prototype.hasOwnProperty.call(typedPatch, 'thickness')
        const hasSideUvScalePatch = Object.prototype.hasOwnProperty.call(typedPatch, 'sideUvScale')

        const targetSmooth = hasSmoothPatch
          ? (typedPatch.smooth ?? FLOOR_DEFAULT_SMOOTH)
          : (Number.isFinite(currentProps.smooth) ? currentProps.smooth : FLOOR_DEFAULT_SMOOTH)

        const targetThickness = hasThicknessPatch
          ? (typedPatch.thickness ?? FLOOR_DEFAULT_THICKNESS)
          : (Number.isFinite(currentProps.thickness) ? currentProps.thickness : FLOOR_DEFAULT_THICKNESS)

        const targetSideUvScale = hasSideUvScalePatch
          ? (typedPatch.sideUvScale ?? FLOOR_DEFAULT_SIDE_UV_SCALE)
          : (currentProps.sideUvScale ?? FLOOR_DEFAULT_SIDE_UV_SCALE)

        const merged = clampFloorComponentProps({
          smooth: targetSmooth,
          thickness: targetThickness,
          sideUvScale: targetSideUvScale,
        })

        const currentSmooth = Number.isFinite(currentProps.smooth) ? currentProps.smooth : FLOOR_DEFAULT_SMOOTH
        const currentThickness = Number.isFinite(currentProps.thickness) ? currentProps.thickness : FLOOR_DEFAULT_THICKNESS
        const currentSideU = Number.isFinite(currentProps.sideUvScale?.x) ? Number(currentProps.sideUvScale.x) : FLOOR_DEFAULT_SIDE_UV_SCALE.x
        const currentSideV = Number.isFinite(currentProps.sideUvScale?.y) ? Number(currentProps.sideUvScale.y) : FLOOR_DEFAULT_SIDE_UV_SCALE.y

        const unchanged =
          Math.abs(currentSmooth - merged.smooth) <= 1e-6 &&
          Math.abs(currentThickness - merged.thickness) <= 1e-6 &&
          Math.abs(currentSideU - merged.sideUvScale.x) <= 1e-6 &&
          Math.abs(currentSideV - merged.sideUvScale.y) <= 1e-6
        if (unchanged) {
          return false
        }

        nextProps = cloneFloorComponentProps(merged)
      } else if (type === LANDFORM_COMPONENT_TYPE) {
        const currentProps = component.props as LandformComponentProps
        const typedPatch = patch as Partial<LandformComponentProps>
        const hasEnableFeatherPatch = Object.prototype.hasOwnProperty.call(typedPatch, 'enableFeather')
        const hasFeatherPatch = Object.prototype.hasOwnProperty.call(typedPatch, 'feather')
        const hasUvScalePatch = Object.prototype.hasOwnProperty.call(typedPatch, 'uvScale')

        const merged = clampLandformComponentProps({
          enableFeather: hasEnableFeatherPatch ? (typedPatch.enableFeather ?? undefined) : currentProps.enableFeather,
          feather: hasFeatherPatch ? (typedPatch.feather ?? undefined) : currentProps.feather,
          uvScale: hasUvScalePatch ? (typedPatch.uvScale ?? undefined) : currentProps.uvScale,
        })

        const currentEnableFeather = typeof currentProps.enableFeather === 'boolean'
          ? currentProps.enableFeather
          : merged.enableFeather
        const currentFeather = Number.isFinite(currentProps.feather) ? Number(currentProps.feather) : merged.feather
        const currentU = Number.isFinite(currentProps.uvScale?.x) ? Number(currentProps.uvScale.x) : merged.uvScale.x
        const currentV = Number.isFinite(currentProps.uvScale?.y) ? Number(currentProps.uvScale.y) : merged.uvScale.y

        const unchanged =
          currentEnableFeather === merged.enableFeather &&
          Math.abs(currentFeather - merged.feather) <= 1e-6 &&
          Math.abs(currentU - merged.uvScale.x) <= 1e-6 &&
          Math.abs(currentV - merged.uvScale.y) <= 1e-6
        if (unchanged) {
          return false
        }

        nextProps = cloneLandformComponentProps(merged)
      } else if (type === EFFECT_COMPONENT_TYPE) {
        const currentProps = clampEffectComponentProps(component.props as EffectComponentProps)
        const typedPatch = patch as Partial<EffectComponentProps>
        const merged = clampEffectComponentProps({
          ...currentProps,
          ...typedPatch,
          groundLight: {
            ...currentProps.groundLight,
            ...(typedPatch.groundLight ?? {}),
          },
        })
        const unchanged =
          currentProps.effectType === merged.effectType &&
          currentProps.groundLight.color === merged.groundLight.color &&
          Math.abs(currentProps.groundLight.intensity - merged.groundLight.intensity) <= 1e-4 &&
          Math.abs(currentProps.groundLight.particleSize - merged.groundLight.particleSize) <= 1e-4 &&
          currentProps.groundLight.particleCount === merged.groundLight.particleCount &&
          currentProps.groundLight.showParticles === merged.groundLight.showParticles &&
          currentProps.groundLight.showBeams === merged.groundLight.showBeams &&
          currentProps.groundLight.showRings === merged.groundLight.showRings
        if (unchanged) {
          return false
        }
        nextProps = cloneEffectComponentProps(merged)
      } else if (type === RIGIDBODY_COMPONENT_TYPE) {
        const currentProps = clampRigidbodyComponentProps(component.props as RigidbodyComponentProps)
        const typedPatch = patch as Partial<RigidbodyComponentProps>
        const merged = clampRigidbodyComponentProps({
          ...currentProps,
          ...typedPatch,
        })
        const hasChanges =
          Math.abs(currentProps.mass - merged.mass) > 1e-4 ||
          currentProps.bodyType !== merged.bodyType ||
          currentProps.colliderType !== merged.colliderType ||
          Math.abs(currentProps.linearDamping - merged.linearDamping) > 1e-4 ||
          Math.abs(currentProps.angularDamping - merged.angularDamping) > 1e-4 ||
          Math.abs(currentProps.restitution - merged.restitution) > 1e-4 ||
          Math.abs(currentProps.friction - merged.friction) > 1e-4 ||
          currentProps.targetNodeId !== merged.targetNodeId

        if (!hasChanges) {
          return false
        }
        nextProps = cloneRigidbodyComponentProps(merged)
      } else if (type === VEHICLE_COMPONENT_TYPE) {
        const currentProps = clampVehicleComponentProps(component.props as VehicleComponentProps)
        const typedPatch = patch as Partial<VehicleComponentProps>
        const merged = clampVehicleComponentProps({
          ...currentProps,
          ...typedPatch,
        })
        const wheelsChanged = JSON.stringify(currentProps.wheels) !== JSON.stringify(merged.wheels)
        const hasChanges =
          currentProps.indexRightAxis !== merged.indexRightAxis ||
          currentProps.indexUpAxis !== merged.indexUpAxis ||
          currentProps.indexForwardAxis !== merged.indexForwardAxis ||
          wheelsChanged
        if (!hasChanges) {
          return false
        }
        nextProps = cloneVehicleComponentProps(merged)
      } else if (type === WATER_COMPONENT_TYPE) {
        const currentProps = clampWaterComponentProps(component.props as WaterComponentProps)
        const typedPatch = patch as Partial<WaterComponentProps>
        const flowPatch = typedPatch.flowDirection
        const mergedFlowDirection = flowPatch
          ? {
              x: typeof flowPatch.x === 'number' ? flowPatch.x : currentProps.flowDirection.x,
              y: typeof flowPatch.y === 'number' ? flowPatch.y : currentProps.flowDirection.y,
            }
          : currentProps.flowDirection
        const merged = clampWaterComponentProps({
          ...currentProps,
          ...typedPatch,
          flowDirection: mergedFlowDirection,
        })
        const flowDirectionUnchanged =
          Math.abs(currentProps.flowDirection.x - merged.flowDirection.x) <= 1e-6 &&
          Math.abs(currentProps.flowDirection.y - merged.flowDirection.y) <= 1e-6
        const unchanged =
          currentProps.implementationMode === merged.implementationMode &&
          currentProps.textureWidth === merged.textureWidth &&
          currentProps.textureHeight === merged.textureHeight &&
          Math.abs(currentProps.distortionScale - merged.distortionScale) <= 1e-6 &&
          Math.abs(currentProps.size - merged.size) <= 1e-6 &&
          Math.abs(currentProps.flowSpeed - merged.flowSpeed) <= 1e-6 &&
          Math.abs(currentProps.waveStrength - merged.waveStrength) <= 1e-6 &&
          flowDirectionUnchanged
        if (unchanged) {
          return false
        }
        nextProps = cloneWaterComponentProps(merged)
      } else if (type === NOMINATE_COMPONENT_TYPE) {
        const currentProps = clampNominateComponentProps(component.props as NominateComponentProps)
        const typedPatch = patch as Partial<NominateComponentProps>
        const merged = clampNominateComponentProps({
          ...currentProps,
          ...typedPatch,
        })
        const unchanged = JSON.stringify(currentProps) === JSON.stringify(merged)
        if (unchanged) {
          return false
        }
        nextProps = cloneNominateComponentProps(merged)
      } else {
        const currentProps = component.props as Record<string, unknown>
        const merged = { ...currentProps, ...patch }
        const unchanged = JSON.stringify(currentProps) === JSON.stringify(merged)
        if (unchanged) {
          return false
        }
        nextProps = merged
      }

      this.captureHistorySnapshot()

      let includesWallTransformChange = false

      visitNode(this.nodes, nodeId, (node) => {
        const current = findComponentEntryById(node.components, componentId)
        if (!current) {
          return
        }
        const [currentType, state] = current
        const nextComponents: SceneNodeComponentMap = { ...(node.components ?? {}) }
        nextComponents[currentType] = {
          ...state,
          type: currentType,
          props: nextProps,
        }

        node.components = nextComponents

        if (currentType === WALL_COMPONENT_TYPE) {
          includesWallTransformChange = !isOffsetOnlyWallPatch
          if (!isOffsetOnlyWallPatch) {
            applyWallComponentPropsToNode(node, nextProps as WallComponentProps)
          }
          if (wallCenterOffsetDelta && node.dynamicMesh?.type === 'Wall' && (
            Math.abs(wallCenterOffsetDelta.x) > 1e-6
            || Math.abs(wallCenterOffsetDelta.y) > 1e-6
            || Math.abs(wallCenterOffsetDelta.z) > 1e-6
          )) {
            node.dynamicMesh = {
              ...node.dynamicMesh,
              chains: (node.dynamicMesh.chains ?? []).map((chain) => ({
                ...chain,
                points: (chain.points ?? []).map((point) => ({
                  x: Number(point?.x ?? 0) - wallCenterOffsetDelta!.x,
                  y: Number(point?.y ?? 0) - wallCenterOffsetDelta!.y,
                  z: Number(point?.z ?? 0) - wallCenterOffsetDelta!.z,
                })),
              })),
            }

            const runtime = getRuntimeObject(node.id)
            if (runtime) {
              runtime.traverse((child) => {
                const group = child as THREE.Group
                if (!(group?.isGroup && group.name === 'WallGroup' && (group.userData as any)?.dynamicMeshType === 'Wall')) {
                  return
                }
                updateWallGroup(group, node.dynamicMesh as WallDynamicMesh, {
                  wallRenderMode: resolveWallRenderMode(node),
                  repeatInstanceStep: resolveWallRepeatInstanceStep(node),
                } as any)
              })
            }
          }
        } else if (currentType === ROAD_COMPONENT_TYPE) {
          applyRoadComponentPropsToNode(node, nextProps as RoadComponentProps, resolveGroundNodeForHeightSampling(this.nodes))
        } else if (currentType === BILLBOARD_COMPONENT_TYPE) {
          // Billboard runtime is texture-driven; no geometry sync is required here.
        } else if (currentType === DISPLAY_BOARD_COMPONENT_TYPE) {
          applyDisplayBoardComponentPropsToNode(node, nextProps as DisplayBoardComponentProps)
        } else if (currentType === FLOOR_COMPONENT_TYPE) {
          floorHelpers.applyFloorComponentPropsToNode(node, nextProps as FloorComponentProps)
        } else if (currentType === LANDFORM_COMPONENT_TYPE) {
          const rebuilt = rebuildLandformNodeForTerrain(this, node.id)
          if (!rebuilt) {
            landformHelpers.applyLandformComponentPropsToNode(node, nextProps as unknown as LandformComponentProps)
          }
        }
      })

      this.queueSceneNodePatch(
        nodeId,
        includesWallTransformChange ? ['components', 'dynamicMesh', 'transform'] : ['components', 'dynamicMesh'],
      )
      const updatedNode = findNodeById(this.nodes, nodeId)
      if (updatedNode) {
        componentManager.syncNode(updatedNode)
      }
      commitSceneSnapshot(this)
      return true
    },
    updateNodeComponentMetadata(nodeId: string, componentId: string, metadata: Record<string, unknown> | undefined): boolean {
      const target = findNodeById(this.nodes, nodeId)
      const match = findComponentEntryById(target?.components, componentId)
      if (!match) {
        return false
      }

      this.captureHistorySnapshot()
      
      const clonedMetadata: Record<string, unknown> | undefined = metadata

      visitNode(this.nodes, nodeId, (node) => {
        const current = findComponentEntryById(node.components, componentId)
        if (!current) {
          return
        }
        const [currentType, state] = current
        const nextComponents: SceneNodeComponentMap = { ...(node.components ?? {}) }
        nextComponents[currentType] = {
          ...state,
          type: currentType,
          metadata: clonedMetadata,
        }
        node.components = componentCount(nextComponents) ? nextComponents : undefined
      })

      this.queueSceneNodePatch(nodeId, ['components'])
      const updatedNode = findNodeById(this.nodes, nodeId)
      if (updatedNode) {
        componentManager.syncNode(updatedNode)
      }
      commitSceneSnapshot(this)
      return true
    },
    async applyDisplayBoardAsset(
      nodeId: string,
      componentId: string,
      assetId: string | null,
      options: { updateMaterial?: boolean } = {},
    ): Promise<boolean> {
      const rawId = typeof assetId === 'string' ? assetId.trim() : ''
      const normalizedId = rawId.startsWith('asset://') ? rawId.slice('asset://'.length) : rawId
      const node = findNodeById(this.nodes, nodeId)
      if (!node) {
        return false
      }
      const componentEntry = findComponentEntryById(node.components, componentId)
      if (!componentEntry || componentEntry[0] !== DISPLAY_BOARD_COMPONENT_TYPE) {
        return false
      }

      const shouldUpdateMaterial = options.updateMaterial !== false

      if (!normalizedId) {
        const changed = this.updateNodeComponentProps(nodeId, componentId, {
          assetId: '',
          intrinsicWidth: undefined,
          intrinsicHeight: undefined,
        })
        if (shouldUpdateMaterial) {
          this.setNodePrimaryTexture(nodeId, null, 'albedo')
        }
        return changed
      }

      const asset = this.getAsset(normalizedId)
      const dimensions = await measureAssetImageDimensions(normalizedId, asset)

      const patch: Partial<DisplayBoardComponentProps> = {
        assetId: normalizedId,
      }
      if (dimensions) {
        patch.intrinsicWidth = dimensions.width
        patch.intrinsicHeight = dimensions.height
      } else {
        patch.intrinsicWidth = undefined
        patch.intrinsicHeight = undefined
      }

      const changed = this.updateNodeComponentProps(nodeId, componentId, patch)

      if (shouldUpdateMaterial) {
        const ref: SceneMaterialTextureRef | null = asset?.name?.trim().length
          ? { assetId: normalizedId, name: asset?.name }
          : { assetId: normalizedId }
        this.setNodePrimaryTexture(nodeId, ref, 'albedo')
      }

      return changed
    },
    async applyBillboardAsset(
      nodeId: string,
      componentId: string,
      assetId: string | null,
      options: { updateMaterial?: boolean } = {},
    ): Promise<boolean> {
      const rawId = typeof assetId === 'string' ? assetId.trim() : ''
      const normalizedId = rawId.startsWith('asset://') ? rawId.slice('asset://'.length) : rawId
      const node = findNodeById(this.nodes, nodeId)
      if (!node) {
        return false
      }
      const componentEntry = findComponentEntryById(node.components, componentId)
      if (!componentEntry || componentEntry[0] !== BILLBOARD_COMPONENT_TYPE) {
        return false
      }

      const shouldUpdateMaterial = options.updateMaterial !== false

      if (!normalizedId) {
        const changed = this.updateNodeComponentProps(nodeId, componentId, {
          assetId: '',
          intrinsicWidth: undefined,
          intrinsicHeight: undefined,
        })
        if (shouldUpdateMaterial) {
          this.setNodePrimaryTexture(nodeId, null, 'albedo')
        }
        return changed
      }

      const asset = this.getAsset(normalizedId)
      const dimensions = await measureAssetImageDimensions(normalizedId, asset)

      const patch: Partial<BillboardComponentProps> = {
        assetId: normalizedId,
      }
      if (dimensions) {
        patch.intrinsicWidth = dimensions.width
        patch.intrinsicHeight = dimensions.height
      } else {
        patch.intrinsicWidth = undefined
        patch.intrinsicHeight = undefined
      }

      const changed = this.updateNodeComponentProps(nodeId, componentId, patch)

      if (shouldUpdateMaterial) {
        const ref: SceneMaterialTextureRef | null = asset?.name?.trim().length
          ? { assetId: normalizedId, name: asset?.name }
          : { assetId: normalizedId }
        this.setNodePrimaryTexture(nodeId, ref, 'albedo')
      }

      return changed
    },
    async measureModelAssetBoundingBox(assetId: string | null): Promise<Box3 | null> {
      const rawId = typeof assetId === 'string' ? assetId.trim() : ''
      const normalizedId = rawId.startsWith('asset://') ? rawId.slice('asset://'.length) : rawId
      if (!normalizedId) {
        return null
      }

      const asset = this.getAsset(normalizedId)
      if (!asset || (asset.type !== 'model' && asset.type !== 'mesh')) {
        return null
      }

      const cached = getCachedModelObject(normalizedId)
      if (cached?.boundingBox && !cached.boundingBox.isEmpty()) {
        return cached.boundingBox.clone()
      }

      const assetCache = useAssetCacheStore()
      const file = await ensureAssetFileForMeasurement(normalizedId, asset)
      if (!file) {
        return null
      }

      try {
        const loaded = await getOrLoadModelObject(
          normalizedId,
          () => loadObjectFromFile(file, asset.extension ?? undefined),
        )
        const bounds = loaded?.boundingBox
        if (!bounds || bounds.isEmpty()) {
          return null
        }
        return bounds.clone()
      } catch (error) {
        console.warn('Failed to measure model asset bounding box', normalizedId, error)
        return null
      } finally {
        assetCache.releaseInMemoryBlob(normalizedId)
      }
    },
    hasRuntimeObject(id: string) {
      return runtimeObjectRegistry.has(id)
    },
    releaseRuntimeObject(id: string) {
      unregisterRuntimeObject(id)
    },
    removeSceneNodes(ids: string[]) {
      if (!Array.isArray(ids) || ids.length === 0) {
        return
      }
      const existingIds = ids.filter(
        (id) => id !== ENVIRONMENT_NODE_ID && !!findNodeById(this.nodes, id),
      )
      if (!existingIds.length) {
        return
      }
      const idSet = new Set(existingIds)
      const parentMap = buildParentMap(this.nodes)

      // Structural undo entry: re-insert the removed top-level subtrees at their original locations.
      const topLevelIds = filterTopLevelNodeIds(existingIds, parentMap)
      const undoOps: SceneHistoryNodeStructureOp[] = []
      topLevelIds.forEach((id) => {
        const location = findNodeLocationInTree(this.nodes, id)
        const subtree = extractSubtreeSnapshot(this.nodes, id)
        if (!location || !subtree) {
          return
        }
        undoOps.push({ type: 'insert', location, subtree })
      })

      const affectedParentIds = new Set<string>()
      existingIds.forEach((id) => {
        const parentId = parentMap.get(id) ?? null
        if (parentId) {
          affectedParentIds.add(parentId)
        }
      })

      const transformTargetIds = collectRecenterTransformTargets(this.nodes, Array.from(affectedParentIds))
      const transformUndo = transformTargetIds.length
        ? createTransformHistoryEntry(this, transformTargetIds)
        : null
      const batchEntries: SceneHistoryEntry[] = []
      if (undoOps.length) {
        batchEntries.push({ kind: 'node-structure', ops: undoOps })
      }
      if (transformUndo && transformUndo.kind === 'node-transform' && transformUndo.transforms.length) {
        batchEntries.push(transformUndo)
      }
      if (batchEntries.length) {
        this.captureHistoryEntry({ kind: 'batch', entries: batchEntries })
      }

      const removed: string[] = []
      this.nodes = pruneNodes(this.nodes, idSet, removed)

      if (removed.length) {
        this.queueSceneRemovePatch(removed, 'removeSceneNodes')
      }

      removed.forEach((id) => stopPlaceholderWatcher(id))
      removed.forEach((id) => stopPrefabPlaceholderWatcher(id))

      affectedParentIds.forEach((parentId) => {
        if (!findNodeById(this.nodes, parentId)) {
          return
        }
        this.recenterGroupAncestry(parentId, { captureHistory: false })
      })

      const prevSelection = cloneSelection(this.selectedNodeIds)
      const nextSelection = prevSelection.filter((id) => !removed.includes(id))
      this.setSelection(nextSelection)
      commitSceneSnapshot(this)
    },

    groupSelection(): boolean {
      const selection = Array.from(new Set(this.selectedNodeIds))
      if (selection.length < 1) {
        return false
      }

      const parentMap = buildParentMap(this.nodes)
      const validIds = selection.filter((id) => {
        if (!id || id === GROUND_NODE_ID || id === ENVIRONMENT_NODE_ID) {
          return false
        }
        if (this.isNodeSelectionLocked(id)) {
          return false
        }
        return parentMap.has(id)
      })

      if (validIds.length < 1) {
        return false
      }

      const topLevelIds = filterTopLevelNodeIds(validIds, parentMap)
      if (topLevelIds.length < 1) {
        return false
      }

      const orderMap = new Map<string, number>()
      let orderCounter = 0
      const assignOrder = (nodes: SceneNode[]) => {
        nodes.forEach((node) => {
          orderMap.set(node.id, orderCounter)
          orderCounter += 1
          if (node.children?.length) {
            assignOrder(node.children)
          }
        })
      }
      assignOrder(this.nodes)
      topLevelIds.sort((a, b) => {
        const aOrder = orderMap.get(a) ?? 0
        const bOrder = orderMap.get(b) ?? 0
        return aOrder - bOrder
      })

      const collectAncestors = (id: string): Set<string | null> => {
        const ancestors = new Set<string | null>()
        let current: string | null = parentMap.get(id) ?? null
        while (true) {
          ancestors.add(current)
          if (current === null) {
            break
          }
          current = parentMap.get(current) ?? null
        }
        return ancestors
      }

      const firstGroupId = topLevelIds[0]!
      let commonAncestors = collectAncestors(firstGroupId)
      for (let i = 1; i < topLevelIds.length; i += 1) {
        const ancestorId = topLevelIds[i]!
        const ancestors = collectAncestors(ancestorId)
        const intersection = new Set<string | null>()
        commonAncestors.forEach((ancestor) => {
          if (ancestors.has(ancestor)) {
            intersection.add(ancestor)
          }
        })
        commonAncestors = intersection
        if (commonAncestors.size === 0) {
          break
        }
      }

      if (commonAncestors.size === 0) {
        return false
      }

      const depthCache = new Map<string | null, number>()
      depthCache.set(null, -1)
      const resolveDepth = (id: string | null): number => {
        if (depthCache.has(id)) {
          return depthCache.get(id) as number
        }
        if (!id) {
          return depthCache.get(null) as number
        }
        const parentId = parentMap.get(id) ?? null
        const depth = resolveDepth(parentId) + 1
        depthCache.set(id, depth)
        return depth
      }

      let targetParentId: string | null = null
      let maxDepth = -Infinity
      commonAncestors.forEach((ancestor) => {
        const depth = resolveDepth(ancestor)
        if (depth > maxDepth) {
          maxDepth = depth
          targetParentId = ancestor
        }
      })

      const shareDirectParent = topLevelIds.every((id) => (parentMap.get(id) ?? null) === targetParentId)

      const worldMatrices = new Map<string, Matrix4>()
      for (const id of topLevelIds) {
        const matrix = computeWorldMatrixForNode(this.nodes, id)
        if (!matrix) {
          return false
        }
        worldMatrices.set(id, matrix)
      }

      const boundingInfo = collectNodeBoundingInfo(this.nodes)
      // Use world-space bounds so the new group origin matches the combined selection bounds center
      const selectionBounds = new Box3()
      let boundsInitialized = false
      topLevelIds.forEach((id) => {
        const info = boundingInfo.get(id)
        if (!info || info.bounds.isEmpty()) {
          return
        }
        if (!boundsInitialized) {
          selectionBounds.copy(info.bounds)
          boundsInitialized = true
        } else {
          selectionBounds.union(info.bounds)
        }
      })

      let centerWorld = new Vector3()
      if (boundsInitialized && !selectionBounds.isEmpty()) {
        centerWorld = selectionBounds.getCenter(new Vector3())
      } else {
        let count = 0
        worldMatrices.forEach((matrix) => {
          const position = new Vector3()
          const quaternion = new Quaternion()
          const scale = new Vector3()
          matrix.decompose(position, quaternion, scale)
          centerWorld.add(position)
          count += 1
        })
        if (count > 0) {
          centerWorld.multiplyScalar(1 / count)
        }
      }

      const parentWorldMatrix = targetParentId
        ? computeWorldMatrixForNode(this.nodes, targetParentId)
        : new Matrix4()
      if (!parentWorldMatrix) {
        return false
      }

      const parentInverse = parentWorldMatrix.clone().invert()
      const groupLocalPositionVec = centerWorld.clone().applyMatrix4(parentInverse)
      if (!Number.isFinite(groupLocalPositionVec.x) || !Number.isFinite(groupLocalPositionVec.y) || !Number.isFinite(groupLocalPositionVec.z)) {
        groupLocalPositionVec.set(0, 0, 0)
      }
      const groupLocalQuaternion = new Quaternion()
      const groupLocalScaleVec = new Vector3(1, 1, 1)

      const groupLocalMatrix = new Matrix4().compose(
        groupLocalPositionVec.clone(),
        groupLocalQuaternion,
        groupLocalScaleVec.clone(),
      )
      const groupWorldMatrix = new Matrix4().multiplyMatrices(parentWorldMatrix, groupLocalMatrix)
      const groupInverseWorldMatrix = groupWorldMatrix.clone().invert()
      const groupLocalEuler = new Euler().setFromQuaternion(groupLocalQuaternion, 'XYZ')

      const topLevelSet = new Set(topLevelIds)
      let insertionIndex: number
      if (shareDirectParent) {
        if (targetParentId) {
          const parentNodeOriginal = findNodeById(this.nodes, targetParentId)
          if (!parentNodeOriginal) {
            return false
          }
          const siblings = parentNodeOriginal.children ?? []
          insertionIndex = siblings.length
          siblings.forEach((child, index) => {
            if (topLevelSet.has(child.id)) {
              insertionIndex = Math.min(insertionIndex, index)
            }
          })
        } else {
          insertionIndex = this.nodes.length
          this.nodes.forEach((node, index) => {
            if (topLevelSet.has(node.id)) {
              insertionIndex = Math.min(insertionIndex, index)
            }
          })
        }
      } else {
        if (targetParentId) {
          const parentNodeOriginal = findNodeById(this.nodes, targetParentId)
          insertionIndex = parentNodeOriginal?.children?.length ?? 0
        } else {
          insertionIndex = this.nodes.length
        }
      }

      let tree = this.nodes as SceneNode[]
      const removedNodes: SceneNode[] = []
      topLevelIds.forEach((id) => {
        const result = detachNodeImmutable(tree, id)
        tree = result.tree
        if (result.node) {
          removedNodes.push(result.node)
        }
      })

      if (removedNodes.length !== topLevelIds.length) {
        return false
      }

      const groupId = generateUuid()
      const groupName = this.generateGroupNodeName()

      removedNodes.forEach((node) => {
        const worldMatrix = worldMatrices.get(node.id)
        if (!worldMatrix) {
          return
        }
        const localMatrix = new Matrix4().multiplyMatrices(groupInverseWorldMatrix, worldMatrix)
        const localPosition = new Vector3()
        const localQuaternion = new Quaternion()
        const localScale = new Vector3()
        localMatrix.decompose(localPosition, localQuaternion, localScale)
        const localEuler = new Euler().setFromQuaternion(localQuaternion, 'XYZ')
        node.position = createVector(localPosition.x, localPosition.y, localPosition.z)
        node.rotation = createVector(localEuler.x, localEuler.y, localEuler.z)
        node.scale = createVector(localScale.x, localScale.y, localScale.z)
      })

      const groupNode: SceneNode = {
        id: groupId,
        name: groupName,
        nodeType: 'Group',
        position: createVector(groupLocalPositionVec.x, groupLocalPositionVec.y, groupLocalPositionVec.z),
        rotation: createVector(groupLocalEuler.x, groupLocalEuler.y, groupLocalEuler.z),
        scale: createVector(groupLocalScaleVec.x, groupLocalScaleVec.y, groupLocalScaleVec.z),
        visible: true,
        locked: false,
        groupExpanded: true,
        children: removedNodes,
      }

      if (targetParentId) {
        const parentNode = findNodeById(tree, targetParentId)
        if (!parentNode) {
          return false
        }
        const siblings = parentNode.children ? [...parentNode.children] : []
        const safeIndex = Math.min(Math.max(insertionIndex, 0), siblings.length)

        // Capture undo entry: remove group + re-insert original nodes at original locations.
        const undoOps: SceneHistoryNodeStructureOp[] = []
        topLevelIds.forEach((id) => {
          const location = findNodeLocationInTree(this.nodes, id)
          const subtree = extractSubtreeSnapshot(this.nodes, id)
          if (location && subtree) {
            undoOps.push({ type: 'insert', location, subtree })
          }
        })
        undoOps.push({ type: 'remove', location: { parentId: targetParentId, index: safeIndex }, nodeId: groupId })
        this.captureNodeStructureHistorySnapshot(undoOps)

        siblings.splice(safeIndex, 0, groupNode)
        parentNode.children = siblings
        tree = [...tree]
      } else {
        const nextTree = [...tree]
        const safeIndex = Math.min(Math.max(insertionIndex, 0), nextTree.length)

        const undoOps: SceneHistoryNodeStructureOp[] = []
        topLevelIds.forEach((id) => {
          const location = findNodeLocationInTree(this.nodes, id)
          const subtree = extractSubtreeSnapshot(this.nodes, id)
          if (location && subtree) {
            undoOps.push({ type: 'insert', location, subtree })
          }
        })
        undoOps.push({ type: 'remove', location: { parentId: null, index: safeIndex }, nodeId: groupId })
        this.captureNodeStructureHistorySnapshot(undoOps)

        nextTree.splice(safeIndex, 0, groupNode)
        tree = nextTree
      }
      this.nodes = tree

      // The viewport relies on structure patches to reconcile its Object3D tree.
      // Without this, the newly created group node may not exist in `objectMap` yet,
      // which prevents TransformControls from attaching when the group is selected.
      this.queueSceneStructurePatch('groupSelection')
      this.setSelection([groupId], {primaryId: groupId })
      commitSceneSnapshot(this)
      return true
    },
    duplicateNodes(nodeIds: string[], options: { select?: boolean } = {}): string[] {
      const selectDuplicates = options.select ?? true
      if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
        return []
      }

      const uniqueIds = Array.from(new Set(nodeIds)).filter((id): id is string => typeof id === 'string' && id.length > 0)
      if (!uniqueIds.length) {
        return []
      }

      const existingIds = uniqueIds.filter((id) => !!findNodeById(this.nodes, id) && !this.isNodeSelectionLocked(id))
      if (!existingIds.length) {
        return []
      }

      const parentMap = buildParentMap(this.nodes)
      const topLevelIds = filterTopLevelNodeIds(existingIds, parentMap)
      if (!topLevelIds.length) {
        return []
      }

      const assetCache = useAssetCacheStore()
      const runtimeSnapshots = new Map<string, Object3D>()
      topLevelIds.forEach((id) => {
        const original = findNodeById(this.nodes, id)
        if (original) {
          collectRuntimeSnapshots(original, runtimeSnapshots)
        }
      })

      const working = cloneSceneNodes(this.nodes)
      const duplicateIdMap = new Map<string, string>()
      const duplicates: SceneNode[] = []
      const affectedParentIds = new Set<string>()

      topLevelIds.forEach((id) => {
        const parentId = parentMap.get(id) ?? null
        if (parentId) {
          affectedParentIds.add(parentId)
        }
      })

      const undoOps: SceneHistoryNodeStructureOp[] = []

      topLevelIds.forEach((id) => {
        const source = findNodeById(this.nodes, id)
        if (!source) {
          return
        }
        const duplicate = duplicateNodeTree(source, {
          assetCache,
          runtimeSnapshots,
          idMap: duplicateIdMap,
          regenerateBehaviorIds: true,
        })
        const inserted = insertNodeMutable(working, id, duplicate, 'after')
        if (!inserted) {
          working.push(duplicate)
        }
        duplicates.push(duplicate)
        duplicateIdMap.set(id, duplicate.id)

        const location = findNodeLocationInTree(working, duplicate.id)
        if (location) {
          undoOps.push({ type: 'remove', location, nodeId: duplicate.id })
        }
      })

      if (!duplicates.length) {
        return []
      }

      if (undoOps.length) {
        this.captureNodeStructureHistorySnapshot(undoOps)
      }

      this.nodes = working
      affectedParentIds.forEach((parentId) => {
        if (!findNodeById(this.nodes, parentId)) {
          return
        }
        this.recenterGroupAncestry(parentId, { captureHistory: false })
      })

      if (selectDuplicates) {
        const duplicateIds = duplicates.map((node) => node.id)
        const previousPrimary = this.selectedNodeId ?? null
        const nextPrimary = previousPrimary ? duplicateIdMap.get(previousPrimary) ?? duplicateIds[0] ?? null : duplicateIds[0] ?? null
        this.setSelection(duplicateIds, { primaryId: nextPrimary })
      }

      commitSceneSnapshot(this)
      return duplicates.map((node) => node.id)
    },
    copyNodes(nodeIds: string[]) {
      if (!Array.isArray(nodeIds) || nodeIds.length === 0) return false

      const uniqueIds = Array.from(new Set(nodeIds)).filter((id) => typeof id === 'string' && id.trim().length > 0)
      if (!uniqueIds.length) return false

      const existingIds = uniqueIds.filter((id) => !!findNodeById(this.nodes, id) && !this.isNodeSelectionLocked(id))
      if (!existingIds.length) return false

      const parentMap = buildParentMap(this.nodes)
      const topLevelIds = filterTopLevelNodeIds(existingIds, parentMap)
        .filter((id) => id !== GROUND_NODE_ID && id !== ENVIRONMENT_NODE_ID)
        .filter((id) => {
          const node = findNodeById(this.nodes, id)
          if (!node) return false
          if (node.canPrefab === false) return false
          return true
        })

      if (!topLevelIds.length) return false

      const { entries, runtimeSnapshots } = collectClipboardPayload(this.nodes, topLevelIds)

      const prefabPayload = this.createClipboardPrefabPayload(topLevelIds, 'copy')
      if (!prefabPayload) return false

      const clipboardStore = useClipboardStore()
      clipboardStore.setClipboard({ entries, runtimeSnapshots, cut: false })
      clipboardStore.writeText(prefabPayload.serialized)
      return true
    },
    cutNodes(nodeIds: string[]) {
      if (!Array.isArray(nodeIds) || nodeIds.length === 0) return false

      const uniqueIds = Array.from(new Set(nodeIds)).filter((id) => typeof id === 'string' && id.trim().length > 0)
      if (!uniqueIds.length) return false

      const existingIds = uniqueIds.filter((id) => !!findNodeById(this.nodes, id) && !this.isNodeSelectionLocked(id))
      if (!existingIds.length) return false

      const parentMap = buildParentMap(this.nodes)
      const topLevelIds = filterTopLevelNodeIds(existingIds, parentMap)
        .filter((id) => id !== GROUND_NODE_ID && id !== ENVIRONMENT_NODE_ID)
        .filter((id) => {
          const node = findNodeById(this.nodes, id)
          if (!node) return false
          if (node.canPrefab === false) return false
          return true
        })

      if (!topLevelIds.length) return false

      const { entries, runtimeSnapshots } = collectClipboardPayload(this.nodes, topLevelIds)

      const prefabPayload = this.createClipboardPrefabPayload(topLevelIds, 'cut')
      if (!prefabPayload) return false

      const clipboardStore = useClipboardStore()
      clipboardStore.setClipboard({ entries, runtimeSnapshots, cut: true })
      clipboardStore.writeText(prefabPayload.serialized)

      // Cut semantics: remove from scene immediately
      this.removeSceneNodes(topLevelIds)
      return true
    },
    async pasteClipboard(targetId?: string | null): Promise<boolean> {
      const clipboardStore = useClipboardStore()
      const normalized = clipboardStore.readText()
      if (!normalized) return false

      let parsedEnvelope: ClipboardEnvelope | null = null
      let clipboardMeta: ClipboardMeta | null = null
      try {
        const parsed = JSON.parse(normalized) as unknown
        if (!parsed || typeof parsed !== 'object') {
          return false
        }
        parsedEnvelope = parsed as ClipboardEnvelope
        if ('clipboard' in (parsed as any)) {
          const candidate = (parsed as any).clipboard
          if (candidate && typeof candidate === 'object') clipboardMeta = candidate as ClipboardMeta
        }
      } catch {
        return false
      }

      const parsedRoots = Array.isArray(parsedEnvelope?.roots)
        ? parsedEnvelope!.roots.filter((node): node is SceneNode => Boolean(node && typeof node === 'object'))
        : []
      const rootsFromPayload = parsedRoots.length
        ? parsedRoots
        : parsedEnvelope?.root && typeof parsedEnvelope.root === 'object'
          ? [parsedEnvelope.root as SceneNode]
          : []
      if (!rootsFromPayload.length) {
        return false
      }

      const clipboardSourceIds = (clipboardStore.clipboard?.entries ?? []).map((entry: any) => entry?.sourceId).filter((id: any) => typeof id === 'string') as string[]

      let parentId = typeof targetId === 'string' ? targetId.trim() : ''
      if (!parentId.length) parentId = ''
      let resolvedParentId: string | null = parentId.length ? parentId : null
      if (resolvedParentId === ENVIRONMENT_NODE_ID) resolvedParentId = null
      if (resolvedParentId) {
        const targetNode = findNodeById(this.nodes, resolvedParentId)
        if (!targetNode) {
          resolvedParentId = null
        } else {
          const targetIsGroup = targetNode.nodeType === 'Group'
          const targetIsClosedGroup = targetIsGroup && (targetNode as any).groupExpanded === false
          const targetMatchesClipboardSource = clipboardSourceIds.includes(resolvedParentId)
          const pasteIntoParent = !targetIsGroup || targetIsClosedGroup || targetMatchesClipboardSource

          if (pasteIntoParent) {
            const parentMap = buildParentMap(this.nodes)
            resolvedParentId = parentMap.get(resolvedParentId) ?? null
            if (resolvedParentId === ENVIRONMENT_NODE_ID) resolvedParentId = null
          }

          if (resolvedParentId) {
            const parentNode = findNodeById(this.nodes, resolvedParentId)
            if (!parentNode || parentNode.nodeType !== 'Group' || !allowsChildNodes(parentNode)) resolvedParentId = null
          }
        }
      }

      const runtimeSnapshots = clipboardStore.clipboard?.runtimeSnapshots ?? new Map<string, any>()

      const metaPayload = clipboardMeta?.meta ?? null
      const pivotWorld = metaPayload?.pivotWorldPosition
      const rootWorldPosition = metaPayload?.rootWorldPosition
      const hasMultiRoots = rootsFromPayload.length > 1

      const commonPrefabAssetRegistry = sanitizeSceneAssetRegistry(parsedEnvelope?.assetRegistry) ?? {}

      const applyWorldToParentLocal = (node: SceneNode, worldMatrix: Matrix4, targetParentId: string | null) => {
        let parentInverse = new Matrix4().identity()
        if (targetParentId) {
          const parentWorld = computeWorldMatrixForNode(this.nodes, targetParentId)
          if (!parentWorld) targetParentId = null
          else parentInverse = parentWorld.clone().invert()
        }
        const localMatrix = targetParentId ? new Matrix4().multiplyMatrices(parentInverse, worldMatrix) : worldMatrix.clone()
        const position = new Vector3()
        const quaternion = new Quaternion()
        const scale = new Vector3()
        localMatrix.decompose(position, quaternion, scale)
        const euler = new Euler().setFromQuaternion(quaternion, 'XYZ')
        node.position = toPlainVector(position)
        node.rotation = { x: euler.x, y: euler.y, z: euler.z }
        node.scale = { x: scale.x, y: scale.y, z: scale.z }
        this.syncComponentSubtree(node)
      }

      const rootsToInsert: SceneNode[] = []
      let pivotTranslation = new Matrix4().identity()
      if (hasMultiRoots && pivotWorld) {
        pivotTranslation = new Matrix4().makeTranslation(
          pivotWorld.x ?? 0,
          pivotWorld.y ?? 0,
          pivotWorld.z ?? 0,
        )
      }

      for (let index = 0; index < rootsFromPayload.length; index += 1) {
        const sourceRoot = rootsFromPayload[index]!
        const preparedRoot = nodePrefabHelpers.prepareNodePrefabRoot(sourceRoot, { regenerateIds: false })
        const prefabForRoot: NodePrefabData = {
          formatVersion: NODE_PREFAB_FORMAT_VERSION,
          name: normalizePrefabName(parsedEnvelope?.name ?? preparedRoot.name ?? 'Clipboard') || 'Clipboard',
          root: preparedRoot,
        }
        if (commonPrefabAssetRegistry && Object.keys(commonPrefabAssetRegistry).length) {
          prefabForRoot.assetRegistry = commonPrefabAssetRegistry
        }

        const duplicate = await this.instantiatePrefabData(prefabForRoot, {
          runtimeSnapshots,
          position: null,
        })
        this.syncComponentSubtree(duplicate)

        if (hasMultiRoots) {
          const rootLocalWorld = composeNodeMatrix(duplicate)
          const desiredWorld = new Matrix4().multiplyMatrices(pivotTranslation, rootLocalWorld)
          applyWorldToParentLocal(duplicate, desiredWorld, resolvedParentId)
        } else {
          const rotation = metaPayload?.rootWorldRotation
          const scale = metaPayload?.rootWorldScale
          const hasFullRootTransform = Boolean(rootWorldPosition && rotation && scale)
          const rootWorld = hasFullRootTransform
            ? new Matrix4().compose(
                new Vector3(rootWorldPosition!.x ?? 0, rootWorldPosition!.y ?? 0, rootWorldPosition!.z ?? 0),
                new Quaternion(rotation!.x, rotation!.y, rotation!.z, rotation!.w),
                new Vector3(scale!.x ?? 1, scale!.y ?? 1, scale!.z ?? 1),
              )
            : composeNodeMatrix(duplicate)
          applyWorldToParentLocal(duplicate, rootWorld, resolvedParentId)
        }

        rootsToInsert.push(duplicate)
      }

      if (!rootsToInsert.length) return false

      // UX: When pasting a single node into a Group, place it at the Group origin so it's easy to find.
      // This intentionally changes the pasted node's world position (it moves to the group's center),
      // while keeping the Group node itself unchanged.
      const pasteTargetNode = resolvedParentId ? findNodeById(this.nodes, resolvedParentId) : null
      const shouldConsiderSnapToGroupOrigin = Boolean(
        pasteTargetNode
        && pasteTargetNode.nodeType === 'Group'
        && rootsToInsert.length === 1,
      )

      // Rule:
      // - If pasting within the same parent (same Group / both root), preserve world transform.
      // - If pasting into an ancestor/descendant of the source node, preserve world transform.
      // - Otherwise (changing parent group), snap local position to the target Group origin.
      const soleClipboardEntry = clipboardStore.clipboard?.entries?.length === 1 ? clipboardStore.clipboard.entries[0] : null
      const sourceParentId = soleClipboardEntry?.sourceParentId ?? null
      const sourceId = soleClipboardEntry?.sourceId
      const isSameParent = sourceParentId === resolvedParentId
      const isPasteWithinSourceLineage = Boolean(
        typeof sourceId === 'string'
        && resolvedParentId
        && (
          isDescendantNode(this.nodes, sourceId, resolvedParentId)
          || isDescendantNode(this.nodes, resolvedParentId, sourceId)
        ),
      )

      const shouldSnapPasteToGroupOrigin = Boolean(
        shouldConsiderSnapToGroupOrigin
        && !isSameParent
        && !isPasteWithinSourceLineage,
      )
      if (shouldSnapPasteToGroupOrigin) {
        const node = rootsToInsert[0]!
        node.position = createVector(0, 0, 0)
        componentManager.syncNode(node)
      }

      const undoOps: any[] = []
      let workingTree = [...this.nodes]
      rootsToInsert.forEach((node) => {
        if (resolvedParentId) {
          const inserted = insertNodeMutable(workingTree, resolvedParentId, node, 'inside')
          if (!inserted) workingTree.push(node)
        } else {
          workingTree.push(node)
        }
        const location = findNodeLocationInTree(workingTree, node.id)
        if (location) undoOps.push({ type: 'remove', location, nodeId: node.id })
      })

      if (undoOps.length) this.captureNodeStructureHistorySnapshot(undoOps)

      replaceSceneNodes(this, workingTree)

      if (resolvedParentId && !shouldSnapPasteToGroupOrigin) {
        this.recenterGroupAncestry(resolvedParentId, { captureHistory: false })
      }

      await this.ensureSceneAssetsReady({ nodes: rootsToInsert, showOverlay: false, refreshViewport: true })

      rootsToInsert.forEach((node) => this.queueSceneNodePatch(node.id, ['transform']))

      const insertedIds = rootsToInsert.map((node) => node.id)
      this.setSelection(insertedIds, { primaryId: insertedIds[0] ?? null })
      return true
    },
    clearClipboard() {
      const clipboardStore = useClipboardStore()
      clipboardStore.clearClipboard()
    },
    async saveActiveScene(options: { force?: boolean } = {}): Promise<StoredSceneDocument | null> {
      if (!this.currentSceneId) {
        console.warn('[SceneStore] Attempted to save without an active scene')
        return null
      }

      if (!options.force && !this.hasUnsavedChanges) {
        return null
      }

      const scenesStore = useScenesStore()
      const document = buildSceneDocumentFromState(this)

      const existing = await scenesStore.loadSceneDocument(document.id)
      const projectsStore = useProjectsStore()
      const projectId = existing?.projectId ?? projectsStore.activeProjectId
      if (!projectId) {
        throw new Error('Project must be opened before saving scene')
      }
      document.projectId = projectId
      await scenesStore.saveSceneDocument(document)
      applyCurrentSceneMeta(this, document)
      this.hasUnsavedChanges = false

      if (projectsStore.activeProjectId === projectId) {
        await projectsStore.setLastEditedScene(projectId, document.id)
      }
      return document
    },
    async createScene(
      name = 'Untitled Scene',
      options?: GroundSettings | { groundSettings?: Partial<GroundSettings> } | null,
    ) {
      this.isSceneReady = false
      const scenesStore = useScenesStore()
      const projectsStore = useProjectsStore()
      const projectId = projectsStore.activeProjectId
      if (!projectId) {
        throw new Error('Project must be opened before creating scene')
      }
      const displayName = name.trim() || 'Untitled Scene'

      let resolvedGroundOptions: Partial<GroundSettings> | undefined
      if (options && typeof options === 'object') {
        if ('groundSettings' in options) {
          resolvedGroundOptions = (options as { groundSettings?: Partial<GroundSettings> }).groundSettings
        } else {
          resolvedGroundOptions = options as Partial<GroundSettings>
        }
      }

      const groundSettings = cloneGroundSettings(resolvedGroundOptions ?? this.groundSettings)

      const baseNodes = createDefaultSceneNodes(groundSettings)
      const baseAssetCatalog = cloneAssetCatalog(initialAssetCatalog)

      const sceneDocument = createSceneDocument(displayName, {
        projectId,
        resourceProviderId: this.resourceProviderId,
        viewportSettings: this.viewportSettings,
        shadowsEnabled: this.shadowsEnabled,
        nodes: baseNodes,
        materials: this.materials,
        selectedNodeId: null,
        selectedNodeIds: [],
        groundSettings,
        assetCatalog: baseAssetCatalog,
        panelVisibility: this.panelVisibility,
        panelPlacement: this.panelPlacement,
      })

      await scenesStore.saveSceneDocument(sceneDocument)
      this.applySceneDocumentToState(sceneDocument)
      this.isSceneReady = true

      await projectsStore.addSceneToProject(projectId, { id: sceneDocument.id, name: sceneDocument.name })
      await projectsStore.setLastEditedScene(projectId, sceneDocument.id)
      return sceneDocument.id
    },
    
    async selectScene(sceneId: string, options: { setLastEdited?: boolean; forceReload?: boolean } = {}) {
      // Invalidate any in-flight scene-bound async work as early as possible.
      this.sceneSwitchToken += 1
      const forceReload = options.forceReload === true
      const scenesStore = useScenesStore()
      const sceneReady = await scenesStore.ensureSceneBundleAvailable(sceneId)
      if (!sceneReady) {
        return false
      }
      if (!forceReload && sceneId === this.currentSceneId) {
        this.isSceneReady = false
        try {
          await this.ensureSceneAssetsReady({ showOverlay: true })
        } finally {
          this.isSceneReady = true
        }
        return true
      }
      const scene = await scenesStore.loadSceneDocument(sceneId, { hydrateGroundRuntime: true })
      if (!scene) {
        return false
      }

      const embeddedMigration = await hydrateSceneDocumentWithEmbeddedAssets(scene)

      this.nodes.forEach((node) => releaseRuntimeTree(node))

      this.isSceneReady = false
      try {
        const sceneNodes = cloneSceneNodes(scene.nodes)
        await this.ensureSceneAssetsReady({
          nodes: sceneNodes,
          showOverlay: true,
          refreshViewport: false,
        })

        scene.nodes = sceneNodes
        attachRuntimeGroundSidecarsToDocument(scene)
        this.applySceneDocumentToState(scene)
      } finally {
        this.isSceneReady = true
      }

      const projectsStore = useProjectsStore()
      const setLastEdited = options.setLastEdited !== false
      if (setLastEdited && projectsStore.activeProjectId && projectsStore.activeProjectId === scene.projectId) {
        await projectsStore.setLastEditedScene(scene.projectId, scene.id)
      }
      if (embeddedMigration.migratedEmbeddedAssets) {
        void this.saveActiveScene({ force: true }).catch((error) => {
          console.warn('[SceneStore] Failed to persist embedded-asset migration result', error)
        })
      }
      return true
    },
    async deleteScene(sceneId: string): Promise<{ deleted: boolean; projectId: string | null; hasRemainingScenes: boolean }> {
      const scenesStore = useScenesStore()
      const projectsStore = useProjectsStore()
      const target = await scenesStore.loadSceneDocument(sceneId)
      if (!target) {
        return { deleted: false, projectId: null, hasRemainingScenes: scenesStore.metadata.length > 0 }
      }

      const projectId = target.projectId

      target.nodes.forEach((node) => releaseRuntimeTree(node))

      await scenesStore.deleteScene(sceneId)
      await scenesStore.refreshMetadata()

      if (projectId) {
        await projectsStore.removeSceneFromProject(projectId, sceneId)
      }

      if (!scenesStore.metadata.length) {
        if (projectId) {
          projectsStore.setActiveProject(projectId)
        }
        if (this.currentSceneId === sceneId) {
          resetSceneStateToNoSelection(this)
        }
        return { deleted: true, projectId: projectId ?? null, hasRemainingScenes: false }
      }

      if (this.currentSceneId === sceneId) {
        const nextId = scenesStore.metadata[0]!.id
        this.isSceneReady = false
        try {
          await this.selectScene(nextId)
        } finally {
          this.isSceneReady = true
        }
      }

      return { deleted: true, projectId: projectId ?? null, hasRemainingScenes: true }
    },
    async renameScene(sceneId: string, name: string) {
      const trimmed = name.trim()
      if (!trimmed) {
        return false
      }
      const scenesStore = useScenesStore()
      const document = await scenesStore.loadSceneDocument(sceneId)
      if (!document) {
        return false
      }
      const updated: StoredSceneDocument = {
        ...document,
        name: trimmed,
        updatedAt: new Date().toISOString(),
      }
      await scenesStore.saveSceneDocument(updated)

      const projectsStore = useProjectsStore()
      if (projectsStore.activeProjectId && projectsStore.activeProjectId === updated.projectId) {
        await projectsStore.renameSceneInProject(updated.projectId, sceneId, trimmed)
      }
      if (this.currentSceneId === sceneId) {
        applyCurrentSceneMeta(this, updated)
      }
      return true
    },
    async exportSceneBundle(
      sceneIds: string[],
      exportOptions: SceneBundleExportOptions = { embedResources: false },
    ): Promise<SceneBundleExportPayload | null> {
      if (!Array.isArray(sceneIds) || !sceneIds.length) {
        return null
      }
      const scenesStore = useScenesStore()
      const uniqueIds = Array.from(new Set(sceneIds))
      const collected: StoredSceneDocument[] = []
      for (const id of uniqueIds) {
        const document = await scenesStore.loadSceneDocument(id)
        if (document) {
          collected.push(document)
        }
      }
      if (!collected.length) {
        return null
      }
      void exportOptions
      const scenes = await Promise.all(collected.map((scene) => cloneSceneDocumentForExport(scene)))
      return {
        formatVersion: SCENE_BUNDLE_FORMAT_VERSION,
        exportedAt: new Date().toISOString(),
        scenes,
      }
    },
    async importScenePackageZip(zipBytes: ArrayBuffer): Promise<SceneImportResult> {
      const { scenes, groundHeightSidecars } = await loadStoredScenesFromScenePackage(zipBytes)
      if (!Array.isArray(scenes) || !scenes.length) {
        throw new Error('Scene package does not contain any scene data')
      }

      const scenesStore = useScenesStore()
      const projectsStore = useProjectsStore()
      const projectId = projectsStore.activeProjectId
      if (!projectId) {
        throw new Error('Project must be opened before importing scene package')
      }

      const existingNames = new Set(scenesStore.metadata.map((scene) => scene.name))
      const imported: StoredSceneDocument[] = []
  const importedGroundHeightSidecars = new Map<string, ArrayBuffer | null>()
      const renamedScenes: Array<{ originalName: string; renamedName: string }> = []

      for (let index = 0; index < scenes.length; index += 1) {
        const entry = scenes[index]!
        const baseName = typeof entry.name === 'string' ? entry.name : `Imported Scene ${index + 1}`
        const normalizedName = baseName.trim() || `Imported Scene ${index + 1}`
        const uniqueName = resolveUniqueSceneName(normalizedName, existingNames)
        if (uniqueName !== normalizedName) {
          renamedScenes.push({ originalName: normalizedName, renamedName: uniqueName })
        }
        existingNames.add(uniqueName)

        const importedAssetCatalog = isAssetCatalog(entry.assetCatalog)
          ? (entry.assetCatalog as Record<string, ProjectAsset[]>)
          : undefined
        const importedAssetRegistry = sanitizeSceneAssetRegistry((entry as { assetRegistry?: unknown }).assetRegistry) ?? {}

        const sceneDocument = createSceneDocument(uniqueName, {
          nodes: entry.nodes as SceneNode[],
          projectId,
          camera: normalizeCameraStateInput(entry.camera),
          resourceProviderId: typeof entry.resourceProviderId === 'string' ? entry.resourceProviderId : undefined,
          createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : undefined,
          updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : undefined,
          assetCatalog: importedAssetCatalog,
          assetManifest: isStoredAssetManifest((entry as { assetManifest?: unknown }).assetManifest)
            ? ((entry as { assetManifest?: AssetManifest }).assetManifest ?? null)
            : undefined,
          assetRegistry: importedAssetRegistry,
          planningData: entry.planningData ?? null,
          viewportSettings: normalizeViewportSettingsInput(entry.viewportSettings),
          panelVisibility: normalizePanelVisibilityInput(entry.panelVisibility),
          panelPlacement: normalizePanelPlacementInput(entry.panelPlacement),
          groundSettings: (entry as { groundSettings?: Partial<GroundSettings> | null }).groundSettings ?? undefined,
          environment: isPlainRecord((entry as { environment?: unknown }).environment)
            ? ((entry as { environment?: Partial<EnvironmentSettings> | null }).environment ?? undefined)
            : undefined,
        })

        await hydrateSceneDocumentWithEmbeddedAssets(sceneDocument)
        await persistPlanningImageLayersToIndexedDB(sceneDocument.id, sceneDocument.planningData?.images ?? [])
        await projectsStore.addSceneToProject(projectId, { id: sceneDocument.id, name: sceneDocument.name })
        imported.push(sceneDocument)
        importedGroundHeightSidecars.set(sceneDocument.id, groundHeightSidecars[entry.id] ?? null)
      }

      await scenesStore.saveSceneDocuments(
        imported,
        {
          groundHeightSidecars: Object.fromEntries(
            imported.map((sceneDocument) => [sceneDocument.id, importedGroundHeightSidecars.get(sceneDocument.id) ?? null]),
          ),
        },
      )
      await scenesStore.refreshMetadata()

      return {
        importedSceneIds: imported.map((scene) => scene.id),
        renamedScenes,
      }
    },
    async importSceneBundle(payload: SceneBundleImportPayload): Promise<SceneImportResult> {
      const formatVersionRaw = (payload as { formatVersion?: unknown })?.formatVersion
      const formatVersion = typeof formatVersionRaw === 'number'
        ? formatVersionRaw
        : Number.isFinite(formatVersionRaw)
          ? Number(formatVersionRaw)
          : SCENE_BUNDLE_FORMAT_VERSION
      if (!Number.isFinite(formatVersion)) {
        throw new Error('Invalid scene file version')
      }
      if (formatVersion > SCENE_BUNDLE_FORMAT_VERSION) {
        throw new Error('Scene file version not supported')
      }
      if (!Array.isArray(payload.scenes) || !payload.scenes.length) {
        throw new Error('Scene file does not contain any scene data')
      }

      const scenesStore = useScenesStore()
      const projectsStore = useProjectsStore()
      const projectId = projectsStore.activeProjectId
      if (!projectId) {
        throw new Error('Project must be opened before importing scene')
      }
      const existingNames = new Set(scenesStore.metadata.map((scene) => scene.name))
      const imported: StoredSceneDocument[] = []
      const renamedScenes: Array<{ originalName: string; renamedName: string }> = []

      for (let index = 0; index < payload.scenes.length; index += 1) {
        const entry = payload.scenes[index]
        if (!isPlainObject(entry)) {
          throw new Error(`Scene data format error (index ${index})`)
        }
        if (!Array.isArray(entry.nodes)) {
          throw new Error(`Scene data missing node information (index ${index})`)
        }

        const baseName = typeof entry.name === 'string' ? entry.name : `Imported Scene ${index + 1}`
        const normalizedName = baseName.trim() || `Imported Scene ${index + 1}`
        const uniqueName = resolveUniqueSceneName(normalizedName, existingNames)
        if (uniqueName !== normalizedName) {
          renamedScenes.push({ originalName: normalizedName, renamedName: uniqueName })
        }
        existingNames.add(uniqueName)

        const importedAssetCatalog = isAssetCatalog(entry.assetCatalog)
          ? (entry.assetCatalog as Record<string, ProjectAsset[]>)
          : undefined
        const importedAssetRegistry = sanitizeSceneAssetRegistry((entry as { assetRegistry?: unknown }).assetRegistry) ?? {}

        const sceneDocument = createSceneDocument(uniqueName, {
          nodes: entry.nodes as SceneNode[],
          projectId,
          camera: normalizeCameraStateInput(entry.camera),
          resourceProviderId: typeof entry.resourceProviderId === 'string' ? entry.resourceProviderId : undefined,
          createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : undefined,
          updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : undefined,
          assetCatalog: importedAssetCatalog,
          assetManifest: isStoredAssetManifest((entry as { assetManifest?: unknown }).assetManifest)
            ? ((entry as { assetManifest?: AssetManifest }).assetManifest ?? null)
            : undefined,
          assetRegistry: importedAssetRegistry,
          planningData: isPlainObject((entry as { planningData?: unknown }).planningData)
            ? ((entry as { planningData?: PlanningSceneData | null }).planningData ?? null)
            : null,
          viewportSettings: normalizeViewportSettingsInput(entry.viewportSettings),
          panelVisibility: normalizePanelVisibilityInput(entry.panelVisibility),
          panelPlacement: normalizePanelPlacementInput(entry.panelPlacement),
          groundSettings: (entry as { groundSettings?: Partial<GroundSettings> | null }).groundSettings ?? undefined,
          environment: isPlainRecord((entry as { environment?: unknown }).environment)
            ? ((entry as { environment?: Partial<EnvironmentSettings> | null }).environment ?? undefined)
            : undefined,
        })

        await hydrateSceneDocumentWithEmbeddedAssets(sceneDocument)

        await projectsStore.addSceneToProject(projectId, { id: sceneDocument.id, name: sceneDocument.name })
        imported.push(sceneDocument)
      }

      if (!imported.length) {
        throw new Error('Scene file does not contain any valid scenes')
      }

      await scenesStore.saveSceneDocuments(imported)
      await scenesStore.refreshMetadata()

      return {
        importedSceneIds: imported.map((scene) => scene.id),
        renamedScenes,
      }
    },
    async ensureCurrentSceneLoaded() {
      this.isSceneReady = false
      try {
        if (this.currentSceneId) {
          const sidecar = await useScenesStore().loadGroundHeightSidecar(this.currentSceneId)
          await useGroundHeightmapStore().hydrateSceneDocument(findGroundNode(this.nodes), sidecar)
          const scatterSidecar = await useScenesStore().loadGroundScatterSidecar(this.currentSceneId)
          await useGroundScatterStore().hydrateSceneDocument(this.currentSceneId, findGroundNode(this.nodes), scatterSidecar)
          const paintSidecar = await useScenesStore().loadGroundPaintSidecar(this.currentSceneId)
          await useGroundPaintStore().hydrateSceneDocument(this.currentSceneId, findGroundNode(this.nodes), paintSidecar)
          const groundNode = findGroundNode(this.nodes)
          attachGroundScatterRuntimeToNode(this.currentSceneId, groundNode)
          attachGroundPaintRuntimeToNode(this.currentSceneId, groundNode)
        }
        await this.refreshRuntimeState({ showOverlay: true, refreshViewport: false })
      } finally {
        this.isSceneReady = true
      }
    },
  },
  persist: {
    key: 'scene-store',
    storage: 'indexeddb',
    version: 2,
    pick: [
      'currentSceneId',
      'currentSceneMeta',
      'nodes',
      'planningData',
      'viewportSettings',
      'panelVisibility',
      'panelPlacement',
      'projectPanelTreeSize',
      'resourceProviderId',
      'assetCatalog',
      'groundSettings',
      'shadowsEnabled',
      'environment',
      'workspaceId',
      'workspaceType',
      'workspaceLabel',
    ],
    shouldPersist: (state: Partial<SceneState>) => state.workspaceType !== 'user',
    migrations: migrateScenePersistedState,
  },
})
