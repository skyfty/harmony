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
  SKY_NODE_ID,
  ENVIRONMENT_NODE_ID,
  MULTIUSER_NODE_ID,
  PROTAGONIST_NODE_ID,
} from '@harmony/schema'
import type {
  AssetIndexEntry,
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
  Vector3Like,
  WallDynamicMesh,
  RoadDynamicMesh,
  FloorDynamicMesh,
  GuideRouteDynamicMesh,
} from '@harmony/schema'
import { normalizeNodeComponents } from './normalizeNodeComponentsUtils'
import { createSkySceneNode as createSkySceneNodeImported, ensureSkyNode as ensureSkyNodeImported } from './skyUtils'
import { stableSerialize } from '@schema/stableSerialize'
import { normalizeLightNodeType } from '@/types/light'
import lightUtils from './lightUtils'
import type { NodePrefabData } from '@/types/node-prefab'
import type { ClipboardMeta, QuaternionJson } from '@/types/prefab'
import type { DetachResult } from '@/types/detach-result'
import type { DuplicateContext } from '@/types/duplicate-context'
import type { EditorTool } from '@/types/editor-tool'
import type { EnsureSceneAssetsOptions } from '@/types/ensure-scene-assets-options'
import type { PanelVisibilityState } from '@/types/panel-visibility-state'
import type { PanelPlacementState, PanelPlacement } from '@/types/panel-placement-state'
import type { HierarchyTreeItem } from '@/types/hierarchy-tree-item'
import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import { getExtensionFromMimeType } from '@harmony/schema'
import type { SceneCameraState } from '@/types/scene-camera-state'
import type {
  SceneHistoryEntry,
  SceneHistoryGroundRegionBounds,
  SceneHistoryGroundHeightEntry,
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
  ClipboardEntry,
  SceneMaterialTextureSlot,
  SceneSkyboxSettings,
  CameraControlMode,
  CameraProjection,
  SceneResourceSummary,
  SceneResourceSummaryEntry,
} from '@harmony/schema'
import {
  deleteTerrainScatterStore,
  getTerrainScatterStore,
  type TerrainScatterStoreSnapshot,
} from '@harmony/schema/terrain-scatter'

export { GROUND_NODE_ID, SKY_NODE_ID, ENVIRONMENT_NODE_ID, MULTIUSER_NODE_ID, PROTAGONIST_NODE_ID }

import { normalizeDynamicMeshType } from '@/types/dynamic-mesh'
import { createFloorNodeMaterials } from '@/utils/floorNodeMaterials'
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

import {
  CUSTOM_SKYBOX_PRESET_ID,
  DEFAULT_SKYBOX_SETTINGS,
  cloneSkyboxSettings,
  normalizeSkyboxSettings,
  resolveSkyboxPreset,
} from '@/stores/skyboxPresets'
import { cloudSettingsEqual } from '@schema/cloudRenderer'
import { useAssetCacheStore } from './assetCacheStore'
import { useUiStore } from './uiStore'
import { useScenesStore, type SceneWorkspaceType } from './scenesStore'
import { updateSceneAssets } from './ensureSceneAssetsReady'
import { useClipboardStore } from './clipboardStore'
import { loadObjectFromFile } from '@schema/assetImport'
import { sampleGroundHeight } from '@schema/groundMesh'
import { generateUuid } from '@/utils/uuid'
import {
  clampSceneNodeInstanceLayout,
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
import { createGuideRouteGroup } from '@schema/guideRouteMesh'
import { computeBlobHash, blobToDataUrl, dataUrlToBlob, inferBlobFilename, extractExtension, ensureExtension } from '@/utils/blob'
import type { BehaviorPrefabData } from '@/utils/behaviorPrefab'
import {
  type LodPresetData,
} from '@/utils/lodPreset'
import { createLodPresetActions } from './lodPresetActions'
import { type WallPresetData } from '@/utils/wallPreset'
import { type FloorPresetData } from '@/utils/floorPreset'
import { createWallPresetActions } from './wallPresetActions'
import { createFloorPresetActions } from './floorPresetActions'
import { createSceneStoreFloorHelpers } from './sceneStoreFloor'
import {
  createNodePrefabHelpers,
  createPrefabActions,
  normalizePrefabName,
  stopPrefabPlaceholderWatcher,
  type PrefabActionsDeps,
  type PrefabStoreLike,
} from './prefabActions'
import {
  AI_MODEL_MESH_USERDATA_KEY,
  createBufferGeometryFromMetadata,
  extractAiModelMeshMetadataFromUserData,
  normalizeAiModelMeshInput,
  type AiModelMeshMetadata,
} from '@/utils/aiModelMesh'

import {
  cloneAssetList,
  cloneProjectTree,
  createEmptyAssetCatalog,
  createProjectTreeFromCache,
  defaultDirectoryId,
  determineAssetCategoryId,
  ASSETS_ROOT_DIRECTORY_ID,
  PACKAGES_ROOT_DIRECTORY_ID,
} from './assetCatalog'
import { rebuildProceduralRuntimeObjects } from '@/utils/proceduralRuntime'
import { resetScatterInstanceBinding } from '@/utils/terrainScatterRuntime'
import type {
  DisplayBoardComponentProps,
  EffectComponentProps,
  GuideRouteComponentProps,
  GuideboardComponentProps,
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
  EFFECT_COMPONENT_TYPE,
  PROTAGONIST_COMPONENT_TYPE,
  ONLINE_COMPONENT_TYPE,
  BEHAVIOR_COMPONENT_TYPE,
  RIGIDBODY_COMPONENT_TYPE,
  VEHICLE_COMPONENT_TYPE,
  AUTO_TOUR_COMPONENT_TYPE,
  WALL_DEFAULT_HEIGHT,
  WALL_DEFAULT_THICKNESS,
  WALL_DEFAULT_WIDTH,
  WALL_DEFAULT_SMOOTHING,
  clampWallProps,
  cloneWallComponentProps,
  ROAD_DEFAULT_WIDTH,
  ROAD_MIN_WIDTH,
  resolveRoadComponentPropsFromMesh,
  clampRoadProps,
  cloneRoadComponentProps,
  clampDisplayBoardComponentProps,
  cloneDisplayBoardComponentProps,
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
  WATER_COMPONENT_TYPE,
  clampWaterComponentProps,
  cloneWaterComponentProps,
} from '@schema/components'
import {
  LOD_COMPONENT_TYPE,
  type LodComponentProps,
} from '@schema/components'

export { ASSETS_ROOT_DIRECTORY_ID, buildPackageDirectoryId, extractProviderIdFromPackageDirectoryId } from './assetCatalog'

export type EditorPanel = 'hierarchy' | 'inspector' | 'project'

export type HierarchyDropPosition = 'before' | 'after' | 'inside'

type NodeComponentPropsByType = {
  [WALL_COMPONENT_TYPE]: WallComponentProps
  [ROAD_COMPONENT_TYPE]: RoadComponentProps
  [FLOOR_COMPONENT_TYPE]: FloorComponentProps
  [WATER_COMPONENT_TYPE]: WaterComponentProps
  [GUIDE_ROUTE_COMPONENT_TYPE]: GuideRouteComponentProps
  [GUIDEBOARD_COMPONENT_TYPE]: GuideboardComponentProps
  [VIEW_POINT_COMPONENT_TYPE]: ViewPointComponentProps
  [WARP_GATE_COMPONENT_TYPE]: WarpGateComponentProps
  [DISPLAY_BOARD_COMPONENT_TYPE]: DisplayBoardComponentProps
  [EFFECT_COMPONENT_TYPE]: EffectComponentProps
  [PROTAGONIST_COMPONENT_TYPE]: ProtagonistComponentProps
  [ONLINE_COMPONENT_TYPE]: OnlineComponentProps
  [BEHAVIOR_COMPONENT_TYPE]: BehaviorComponentProps
  [RIGIDBODY_COMPONENT_TYPE]: RigidbodyComponentProps
  [VEHICLE_COMPONENT_TYPE]: VehicleComponentProps
  [AUTO_TOUR_COMPONENT_TYPE]: AutoTourComponentProps
  [LOD_COMPONENT_TYPE]: LodComponentProps
}

type NodeComponentPropsOf<T extends NodeComponentType> = T extends keyof NodeComponentPropsByType
  ? NodeComponentPropsByType[T]
  : Record<string, unknown>

type AddNodeComponentResult<T extends NodeComponentType> = {
  component: SceneNodeComponentState<NodeComponentPropsOf<T>>
  created: boolean
}

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

// Used to suppress history snapshot creation during bulk operations.
// Module-scoped because the editor typically has a single scene store instance.
let historyCaptureSuppressionDepth = 0

// Used to suppress scene patch version bumps during bulk operations.
// Prevents repeated viewport refreshes when creating/moving many nodes.
let scenePatchSuppressionDepth = 0
let pendingSceneGraphStructureVersionBump = false
let pendingSceneNodePropertyVersionBump = false
let pendingSuppressedScenePatchRequiresFullSync = false

const PLANNING_CONVERSION_ROOT_TAG = 'planningConversionRoot'

const LOCAL_EMBEDDED_ASSET_PREFIX = 'local::'

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
  internalForAsset: (asset: ProjectAsset) => boolean
}

function upsertAssetsIntoCatalogAndIndex(
  currentCatalog: Record<string, ProjectAsset[]>,
  currentIndex: Record<string, AssetIndexEntry>,
  assets: ProjectAsset[],
  options: AssetRegistrationOptions,
): {
  nextCatalog: Record<string, ProjectAsset[]>
  nextIndex: Record<string, AssetIndexEntry>
  registeredAssets: ProjectAsset[]
  sourceByAssetId: Record<string, AssetSourceMetadata | undefined>
} {
  const nextCatalog: Record<string, ProjectAsset[]> = { ...currentCatalog }
  const nextIndex: Record<string, AssetIndexEntry> = { ...currentIndex }
  const registeredAssets: ProjectAsset[] = []
  const sourceByAssetId: Record<string, AssetSourceMetadata | undefined> = {}

  const seen = new Set<string>()
  assets.forEach((asset) => {
    const assetId = typeof asset?.id === 'string' ? asset.id.trim() : ''
    if (!assetId || seen.has(assetId)) {
      return
    }
    seen.add(assetId)

    const categoryId = options.categoryIdForAsset(asset)
    const source = options.sourceForAsset(asset)
    const internal = options.internalForAsset(asset)

    const existingEntry = nextIndex[assetId]
    if (existingEntry?.categoryId && nextCatalog[existingEntry.categoryId]) {
      nextCatalog[existingEntry.categoryId] = nextCatalog[existingEntry.categoryId]!.filter((item) => item.id !== assetId)
    }

    const registeredAsset: ProjectAsset = { ...asset, id: assetId }
    const currentList = nextCatalog[categoryId] ?? []
    nextCatalog[categoryId] = [...currentList.filter((item) => item.id !== assetId), registeredAsset]

    nextIndex[assetId] = {
      categoryId,
      source,
      internal,
    }

    registeredAssets.push(registeredAsset)
    sourceByAssetId[assetId] = source
  })

  return { nextCatalog, nextIndex, registeredAssets, sourceByAssetId }
}

function buildVisibleAssetCatalog(
  catalog: Record<string, ProjectAsset[]>,
  assetIndex: Record<string, AssetIndexEntry> | undefined,
): Record<string, ProjectAsset[]> {
  if (!assetIndex) {
    return catalog
  }
  const next: Record<string, ProjectAsset[]> = {}
  Object.entries(catalog).forEach(([categoryId, list]) => {
    next[categoryId] = (list ?? []).filter((asset) => !assetIndex[asset.id]?.internal)
  })
  return next
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
  buildAssetIndexSubsetForPrefab,
  buildPackageAssetMapSubsetForPrefab,
  mergeAssetIndexEntries,
  mergePackageAssetMapEntries,
  isAssetIndex,
  isPackageAssetMap,
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
  buildAssetIndexSubsetForPrefab,
  buildPackageAssetMapSubsetForPrefab,
  mergeAssetIndexEntries,
  mergePackageAssetMapEntries,
  isAssetIndex,
  isPackageAssetMap,
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

  SKY_NODE_ID,
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

  isAssetIndex,
  isPackageAssetMap,
  cloneAssetIndex,
  clonePackageAssetMap,
  buildAssetIndexSubsetForPrefab,
  buildPackageAssetMapSubsetForPrefab,
  mergeAssetIndexEntries,
  mergePackageAssetMapEntries,

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
const HEIGHT_EPSILON = 1e-5
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
  metalness: 0.5,
  roughness: 0.5,
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
  let entry = assetCache.getEntry(assetId)
  if (entry.status !== 'cached') {
    await assetCache.loadFromIndexedDb(assetId)
    entry = assetCache.getEntry(assetId)
  }

  if (entry.status !== 'cached') {
    const downloadUrl = entry.downloadUrl ?? asset?.downloadUrl ?? asset?.description ?? null
    if (!downloadUrl) {
      return null
    }
    try {
      await assetCache.downloadAsset(assetId, downloadUrl, asset?.name ?? assetId)
    } catch (error) {
      console.warn('Failed to download asset for measurement', assetId, error)
      return null
    }
    entry = assetCache.getEntry(assetId)
    if (entry.status !== 'cached') {
      return null
    }
  }

  return assetCache.createFileFromCache(assetId)
}

async function ensureModelAssetCached(assetCache: ReturnType<typeof useAssetCacheStore>, asset: ProjectAsset): Promise<void> {
  await assetCache.loadFromIndexedDb(asset.id)
  if (assetCache.hasCache(asset.id)) {
    return
  }
  await assetCache.downloaProjectAsset(asset)
  await assetCache.loadFromIndexedDb(asset.id)
  if (!assetCache.hasCache(asset.id)) {
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
  materialId: string | null,
  props: SceneMaterialProps,
  options: { id?: string; name?: string; type?: SceneMaterialType } = {},
): SceneNodeMaterial {
  return {
    id: options.id ?? generateUuid(),
    materialId,
    name: options.name,
    type: options.type ?? 'MeshStandardMaterial',
    ...cloneMaterialProps(props),
  }
}

function cloneNodeMaterial(material: SceneNodeMaterial): SceneNodeMaterial {
  return createNodeMaterial(material.materialId, material, {
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
  const terrainScatter = manualDeepClone(definition.terrainScatter)
  const terrainPaint = manualDeepClone(definition.terrainPaint)
  const result: GroundDynamicMesh = {
    type: 'Ground',
    width: definition.width,
    depth: definition.depth,
    rows: definition.rows,
    columns: definition.columns,
    cellSize: definition.cellSize,
    heightMap: { ...(definition.heightMap ?? {}) },
    terrainScatterInstancesUpdatedAt: definition.terrainScatterInstancesUpdatedAt,
    textureDataUrl: definition.textureDataUrl ?? null,
    textureName: definition.textureName ?? null,
    generation: cloneGroundGenerationSettings(definition.generation) ?? null,
  }
  if (definition.hasManualEdits !== undefined) {
    result.hasManualEdits = definition.hasManualEdits
  }
  if (terrainScatter !== undefined) {
    result.terrainScatter = terrainScatter
  }
  if (terrainPaint !== undefined) {
    result.terrainPaint = terrainPaint
  }
  return result
}

import * as groundUtils from './groundUtils'
import * as vehicleUtils from './vehicleUtils'

function cloneGroundSettings(settings: Partial<GroundSettings> | null | undefined): GroundSettings {
  return groundUtils.cloneGroundSettings(settings as any) as GroundSettings
}

import { buildWallDynamicMeshFromWorldSegments, applyWallComponentPropsToNode as applyWallComponentPropsToNodeImported, resolveWallSmoothing as resolveWallSmoothingImported } from './wallUtils'

// Local wrapper to inject runtime helpers into the moved wall helper.
function applyWallComponentPropsToNode(node: SceneNode, props: WallComponentProps): boolean {
  return applyWallComponentPropsToNodeImported(node, props, { getRuntimeObject, updateWallGroup })
}

const resolveWallSmoothing = resolveWallSmoothingImported
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
        segments: wallMesh.segments.map((segment) => ({
          start: cloneDynamicMeshVector3(segment.start),
          end: cloneDynamicMeshVector3(segment.end),
          height: Number.isFinite(segment.height) ? segment.height : DEFAULT_WALL_HEIGHT,
          width: Number.isFinite((segment as { width?: number }).width)
            ? (segment as { width?: number }).width!
            : DEFAULT_WALL_WIDTH,
          thickness: Number.isFinite(segment.thickness) ? segment.thickness : DEFAULT_WALL_THICKNESS,
        })),
      }
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

import environmentUtils from './environmentUtils'

function isSkyNode(node: SceneNode): boolean {
  return node.id === SKY_NODE_ID
}

function ensureSkyNode(nodes: SceneNode[]): SceneNode[] {
  return ensureSkyNodeImported(nodes, isGroundNode, (n: SceneNode) => n.id === SKY_NODE_ID, (overrides?: any) => createSkySceneNodeImported(SKY_NODE_ID, overrides))
}

const DEFAULT_ENVIRONMENT_SETTINGS: EnvironmentSettings = environmentUtils.cloneEnvironmentSettings(undefined)

const cloneEnvironmentSettings = environmentUtils.cloneEnvironmentSettings
const isEnvironmentNode = (node: SceneNode) => environmentUtils.isEnvironmentNode(node, ENVIRONMENT_NODE_ID)
const ensureEnvironmentNode = (nodes: SceneNode[], override?: EnvironmentSettings) =>
  environmentUtils.ensureEnvironmentNode(nodes, ENVIRONMENT_NODE_ID, isSkyNode, isGroundNode, override)
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

type GroundRegionBounds = {
  minRow: number
  maxRow: number
  minColumn: number
  maxColumn: number
}

function groundVertexKey(row: number, column: number): string {
  return groundUtils.groundVertexKey(row, column)
}

function normalizeGroundBounds(definition: GroundDynamicMesh, bounds: GroundRegionBounds): GroundRegionBounds {
  return groundUtils.normalizeGroundBounds(definition as any, bounds as any) as GroundRegionBounds
}

function applyGroundRegionTransform(
  definition: GroundDynamicMesh,
  bounds: GroundRegionBounds,
  transform: (current: number, row: number, column: number) => number,
): { definition: GroundDynamicMesh; changed: boolean } {
  return groundUtils.applyGroundRegionTransform(definition as any, bounds as any, transform as any) as { definition: GroundDynamicMesh; changed: boolean }
}

const initialAssetCatalog = createEmptyAssetCatalog()

const initialAssetIndex: Record<string, AssetIndexEntry> = {}

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

function toHexColor(color: Color | null | undefined, fallback = '#ffffff'): string {
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

  return createNodeMaterial(null, props, {
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
      color: toHexColor(lightCandidate.color as Color, '#ffffff'),
      intensity: typeof lightCandidate.intensity === 'number' ? lightCandidate.intensity : 1,
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

const initialNodes: SceneNode[] = ensureEnvironmentNode(ensureSkyNode([createGroundSceneNode()]), DEFAULT_ENVIRONMENT_SETTINGS)

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

const defaultSkyboxSettings = cloneSkyboxSettings(DEFAULT_SKYBOX_SETTINGS)
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

function cloneSceneSkybox(settings?: Partial<SceneSkyboxSettings> | SceneSkyboxSettings | null): SceneSkyboxSettings {
  if (!settings) {
    return cloneSkyboxSettings(defaultSkyboxSettings)
  }
  return normalizeSkyboxSettings(settings)
}

function normalizeShadowsEnabledInput(value: unknown): boolean {
  return typeof value === 'boolean' ? value : defaultShadowsEnabled
}

function resolveDocumentSkybox(document: { skybox?: Partial<SceneSkyboxSettings> | SceneSkyboxSettings | null }): SceneSkyboxSettings {
  return cloneSceneSkybox(document.skybox ?? null)
}

function resolveDocumentShadowsEnabled(document: { shadowsEnabled?: boolean | null }): boolean {
  return normalizeShadowsEnabledInput(document.shadowsEnabled)
}

function skyboxSettingsEqual(a: SceneSkyboxSettings, b: SceneSkyboxSettings): boolean {
  return (
    a.presetId === b.presetId &&
    a.exposure === b.exposure &&
    a.turbidity === b.turbidity &&
    a.rayleigh === b.rayleigh &&
    a.mieCoefficient === b.mieCoefficient &&
    a.mieDirectionalG === b.mieDirectionalG &&
    a.elevation === b.elevation &&
    a.azimuth === b.azimuth &&
    cloudSettingsEqual(a.clouds ?? null, b.clouds ?? null)
  )
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
  if (meshType !== 'Wall' && meshType !== 'Road' && meshType !== 'Floor' && meshType !== 'GuideRoute') {
    return false
  }

  if (getRuntimeObject(node.id)) {
    return false
  }

  try {
    let runtime: Object3D;
    if (meshType === 'Road') {
      runtime = createRoadGroup(meshDefinition as RoadDynamicMesh, {
        heightSampler: resolveRoadLocalHeightSampler(node, groundNode),
      });
    } else if (meshType === 'Floor') {
      runtime = createFloorGroup(meshDefinition as FloorDynamicMesh);
    } else if (meshType === 'GuideRoute') {
      runtime = createGuideRouteGroup(meshDefinition as GuideRouteDynamicMesh)
    } else {
      runtime = createWallGroup(meshDefinition as WallDynamicMesh, { smoothing: resolveWallSmoothing(node) });
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

const initialSceneDocument = createSceneDocument('Sample Scene', {
  nodes: initialNodes,
  materials: initialMaterials,
  selectedNodeId: null,
  selectedNodeIds: [],
  resourceProviderId: 'builtin',
  assetCatalog: initialAssetCatalog,
  assetIndex: initialAssetIndex,
})

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

function serializeBoundingBox(box: Box3): InstancedBoundsPayload {
  return {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
  }
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
    if (id === GROUND_NODE_ID || id === SKY_NODE_ID || id === ENVIRONMENT_NODE_ID) {
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

  if (!node.isPlaceholder && node.nodeType !== 'Light') {
        const runtimeObject = getRuntimeObject(node.id)
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

function applyMaterialPropsToNodeTree(
  nodes: SceneNode[],
  materialId: string,
  props: SceneMaterialProps,
  assignedId: string | null = materialId,
  type: SceneMaterialType | undefined = undefined,
): boolean {
  let changed = false
  nodes.forEach((node) => {
    if (node.materials?.length) {
      let nodeChanged = false
      const nextMaterials = node.materials.map((entry) => {
        if (entry.materialId !== materialId) {
          return entry
        }
        nodeChanged = true
        return createNodeMaterial(assignedId, props, {
          id: entry.id,
          name: entry.name,
          type: type ?? entry.type,
        })
      })
      if (nodeChanged) {
        node.materials = nextMaterials
        changed = true
      }
    }
    if (node.children?.length) {
      if (applyMaterialPropsToNodeTree(node.children, materialId, props, assignedId, type)) {
        changed = true
      }
    }
  })
  return changed
}

function nodeTreeIncludesMaterial(nodes: SceneNode[], materialId: string): boolean {
  for (const node of nodes) {
    if (node.materials?.some((entry) => entry.materialId === materialId)) {
      return true
    }
    if (node.children?.length && nodeTreeIncludesMaterial(node.children, materialId)) {
      return true
    }
  }
  return false
}

function reassignMaterialInNodeTree(nodes: SceneNode[], fromId: string, target: SceneMaterial): boolean {
  let changed = false
  const targetId = target.id
  nodes.forEach((node) => {
    if (node.materials?.length) {
      let nodeChanged = false
      const nextMaterials = node.materials.map((entry) => {
        if (entry.materialId !== fromId) {
          return entry
        }
        nodeChanged = true
        return createNodeMaterial(targetId, target, {
          id: entry.id,
          name: entry.name,
          type: target.type,
        })
      })
      if (nodeChanged) {
        node.materials = nextMaterials
        changed = true
      }
    }
    if (node.children?.length) {
      if (reassignMaterialInNodeTree(node.children, fromId, target)) {
        changed = true
      }
    }
  })
  return changed
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
  const baseNodes = ensureEnvironmentNode(ensureSkyNode(ensureGroundNode([], settings)), environmentSettings)

  const ambientPreset = getLightPreset('Ambient')
  const directionalPreset = getLightPreset('Directional')
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

  const directional = createLightNode({
    name: directionalPreset.name,
    type: 'Directional',
    color: directionalPreset.color,
    intensity: directionalPreset.intensity,
    position: directionalPreset.position,
    target: (directionalPreset as any).target,
    extras: directionalPreset.extras as any,
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

  return [ambient, directional, hemisphere, ...baseNodes]
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

function extractAssetFromCatalog(
  catalog: Record<string, ProjectAsset[]>,
  assetId: string,
): { asset: ProjectAsset; categoryId: string } | null {
  for (const [categoryId, list] of Object.entries(catalog)) {
    const index = list.findIndex((asset) => asset.id === assetId)
    if (index !== -1) {
      const asset = list[index]!
      const nextList = [...list.slice(0, index), ...list.slice(index + 1)]
      catalog[categoryId] = nextList
      return { asset: { ...asset }, categoryId }
    }
  }
  return null
}

function insertAssetIntoCatalog(
  catalog: Record<string, ProjectAsset[]>,
  categoryId: string,
  asset: ProjectAsset,
) {
  const list = catalog[categoryId] ?? []
  const filtered = list.filter((entry) => entry.id !== asset.id)
  catalog[categoryId] = [...filtered, asset]
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
    replaceMaterialTextureReferences(material.textures, previousId, nextId)
  })
}

function replaceAssetIdInNodes(nodes: SceneNode[], previousId: string, nextId: string) {
  nodes.forEach((node) => {
    if (node.sourceAssetId === previousId) {
      node.sourceAssetId = nextId
    }
    if (node.importMetadata?.assetId === previousId) {
      node.importMetadata.assetId = nextId
    }
    if (node.materials?.length) {
      node.materials.forEach((material) => {
        replaceMaterialTextureReferences(material.textures, previousId, nextId)
      })
    }
    if (node.children?.length) {
      replaceAssetIdInNodes(node.children, previousId, nextId)
    }
  })
}

function replaceAssetIdReferences(scene: StoredSceneDocument, previousId: string, nextId: string) {
  if (previousId === nextId) {
    return
  }

  const hasExistingTarget = !!getAssetFromCatalog(scene.assetCatalog, nextId)
  const extracted = extractAssetFromCatalog(scene.assetCatalog, previousId)
  if (!hasExistingTarget && extracted) {
    const nextAsset: ProjectAsset = {
      ...extracted.asset,
      id: nextId,
      downloadUrl: extracted.asset.downloadUrl === previousId ? nextId : extracted.asset.downloadUrl,
      extension: extracted.asset.extension ?? extractExtension(extracted.asset.downloadUrl) ?? null,
    }
    insertAssetIntoCatalog(scene.assetCatalog, extracted.categoryId, nextAsset)
  }

  const previousIndex = scene.assetIndex[previousId]
  if (!scene.assetIndex[nextId]) {
    if (previousIndex) {
      scene.assetIndex[nextId] = {
        categoryId: previousIndex.categoryId,
        source: { type: 'local' },
      }
    } else if (extracted) {
      scene.assetIndex[nextId] = {
        categoryId: extracted.categoryId,
        source: { type: 'local' },
      }
    }
  }
  if (scene.assetIndex[nextId]) {
    scene.assetIndex[nextId] = {
      ...scene.assetIndex[nextId],
      source: { type: 'local' },
    }
  }
  delete scene.assetIndex[previousId]

  replaceAssetIdInMaterials(scene.materials, previousId, nextId)
  replaceAssetIdInNodes(scene.nodes, previousId, nextId)
}

function resolveEmbeddedAssetFilename(scene: StoredSceneDocument, assetId: string, blob: Blob): string {
  const asset = getAssetFromCatalog(scene.assetCatalog, assetId)
  const extensionCandidates = [
    extractExtension(asset?.description ?? undefined),
    extractExtension(asset?.name ?? undefined),
    extractExtension(asset?.downloadUrl ?? undefined),
  ]
  const mimeExtension = blob.type ? blob.type.split('/').pop() ?? null : null
  if (mimeExtension) {
    extensionCandidates.push(mimeExtension)
  }
  const extension = extensionCandidates.find((value) => value && value.length) ?? 'bin'
  const fallback = `${assetId}.${extension}`
  const filename = inferBlobFilename([asset?.description ?? null, asset?.name ?? null], fallback)
  return ensureExtension(filename, extension)
}

export async function buildPackageAssetMapForExport(
  scene: StoredSceneDocument,
  _options?: { embedResources?: boolean },
): Promise<{ packageAssetMap: Record<string, string>; assetIndex: Record<string, AssetIndexEntry> }> {
  const usedAssetIds = collectSceneAssetReferences(scene)
  let packageAssetMap = filterPackageAssetMapByUsage(stripAssetEntries(clonePackageAssetMap(scene.packageAssetMap)),usedAssetIds)
  const assetIndex = filterAssetIndexByUsage(scene.assetIndex, usedAssetIds)

  return { packageAssetMap, assetIndex }
}

function estimateInlineAssetByteSize(raw: string | null | undefined): number {
  if (!raw) {
    return 0
  }
  const trimmed = raw.trim()
  if (!trimmed.length) {
    return 0
  }
  if (trimmed.startsWith('data:')) {
    try {
      return dataUrlToBlob(trimmed).size
    } catch (_error) {
      return 0
    }
  }
  if (/^[A-Za-z0-9+/=\s-]+$/.test(trimmed) && trimmed.length >= 12) {
    const sanitized = trimmed.replace(/[^A-Za-z0-9+/=]/g, '')
    if (!sanitized.length) {
      return 0
    }
    const padding = sanitized.endsWith('==') ? 2 : sanitized.endsWith('=') ? 1 : 0
    return Math.max(0, Math.floor((sanitized.length * 3) / 4) - padding)
  }
  return 0
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
  assetId: string,
  indexEntry: AssetIndexEntry | undefined,
  asset: ProjectAsset|null,
  packageMap: Record<string, string>,
): string | null {
  const pickUrl = (input: unknown): string | null => {
    if (!input || typeof input !== 'object') {
      return null
    }
    const record = input as Record<string, unknown>
    const directKeys: Array<keyof typeof record> = ['downloadUrl', 'url']
    for (const key of directKeys) {
      const candidate = normalizeHttpUrl(typeof record[key] === 'string' ? (record[key] as string) : null)
      if (candidate) {
        return candidate
      }
    }
    if (record.source && typeof record.source === 'object') {
      const nested = pickUrl(record.source)
      if (nested) {
        return nested
      }
    }
    return null
  }

  const fromIndex = pickUrl(indexEntry as Record<string, unknown> | undefined)
  if (fromIndex) {
    return fromIndex
  }

  const mapUrl = normalizeHttpUrl(packageMap[`url::${assetId}`])
  if (mapUrl) {
    return mapUrl
  }

  if (asset) {
    const candidate = normalizeHttpUrl(asset.downloadUrl) ?? normalizeHttpUrl(asset.description)
    if (candidate) {
      return candidate
    }
  }

  return null
}

export async function calculateSceneResourceSummary(
  scene: StoredSceneDocument,
  options: SceneBundleExportOptions,
): Promise<SceneResourceSummary> {
  const packageMap = scene.packageAssetMap ?? {}
  const assetIndex = scene.assetIndex ?? {}
  const assetCatalog = scene.assetCatalog ?? {}

  const summary: SceneResourceSummary = {
    totalBytes: 0,
    embeddedBytes: 0,
    externalBytes: 0,
    computedAt: new Date().toISOString(),
    assets: [],
    unknownAssetIds: [],
  }

  type MeshTextureUsageAccumulator = {
    nodeId: string
    nodeName?: string
    assetIds: Set<string>
    textures: SceneResourceSummaryEntry[]
    totalBytes: number
  }

  const materialById = new Map<string, SceneMaterial>()
  ;(scene.materials ?? []).forEach((material) => {
    if (!material || typeof material !== 'object' || typeof material.id !== 'string') {
      return
    }
    const trimmed = material.id.trim()
    if (!trimmed) {
      return
    }
    materialById.set(trimmed, material)
  })

  const meshTextureUsageMap = new Map<string, MeshTextureUsageAccumulator>()
  const textureAssetConsumers = new Map<string, Set<string>>()
  const nodeNameById = new Map<string, string | undefined>()
  const countedTextureAssets = new Set<string>()
  let textureBytes = 0

  const assetIds = new Set<string>()

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
      nodeNameById.set(node.id, node.name ?? undefined)
      if (Array.isArray(node.materials) && node.materials.length) {
        node.materials.forEach((nodeMaterial) => {
          collectMaterialTextureRefs(nodeMaterial, node)
          const baseId = nodeMaterial?.materialId?.trim()
          if (baseId) {
            const baseMaterial = materialById.get(baseId)
            if (baseMaterial) {
              collectMaterialTextureRefs(baseMaterial, node)
            }
          }
        })
      }
      collectScatterAssetRefs(node)
      if (Array.isArray(node.children) && node.children.length) {
        stack.push(...(node.children as SceneNode[]))
      }
    }
  }

  traverseNodesForTextures(scene.nodes ?? [])

  const processed = new Set<string>()
  const packageEntriesByAsset = new Map<string, Array<{ key: string; value: string }>>()

  Object.entries(packageMap).forEach(([key, value]) => {
    const separator = key.indexOf('::')
    if (separator === -1) {
      return
    }
    const assetId = key.slice(separator + 2)
    if (!assetId) {
      return
    }
    const list = packageEntriesByAsset.get(assetId) ?? []
    list.push({ key, value })
    packageEntriesByAsset.set(assetId, list)
  })

  Object.entries(packageMap).forEach(([key, value]) => {
    if (!key.startsWith(LOCAL_EMBEDDED_ASSET_PREFIX)) {
      return
    }
    const assetId = key.slice(LOCAL_EMBEDDED_ASSET_PREFIX.length)
    if (!assetId || processed.has(assetId)) {
      return
    }
    const asset = getAssetFromCatalog(assetCatalog, assetId)
    const bytes = estimateInlineAssetByteSize(value)
    const entry: SceneResourceSummaryEntry = {
       assetId, 
       bytes,
       type: asset?.type ?? undefined,
      embedded: true, 
      source: 'embedded' 
      }
    summary.assets.push(entry)
    recordTextureAssetEntry(assetId, entry)
    summary.totalBytes += bytes
    summary.embeddedBytes += bytes
    processed.add(assetId)
  })

  Object.keys(assetIndex).forEach((assetId) => {
    if (assetId) {
      assetIds.add(assetId)
    }
  })
  packageEntriesByAsset.forEach((_entries, assetId) => {
    if (assetId) {
      assetIds.add(assetId)
    }
  })

  const assetCache = useAssetCacheStore()

  for (const assetId of assetIds) {
    if (!assetId || processed.has(assetId)) {
      continue
    }
    const indexEntry = assetIndex[assetId]
    const cacheEntry = assetCache.getEntry(assetId)
    let bytes = cacheEntry?.status === 'cached' && cacheEntry.size > 0 ? cacheEntry.size : 0
    const asset = getAssetFromCatalog(assetCatalog, assetId)
    const downloadUrl = resolveAssetDownloadUrl(assetId, indexEntry, asset, packageMap)

    if (!bytes && options.embedResources) {
      // If resources are embedded, fall back to cached blob size if available.
      bytes = cacheEntry?.blob?.size ?? bytes
    }

    if (bytes > 0 || downloadUrl) {
      const entry: SceneResourceSummaryEntry = {
        assetId,
        name: asset?.name ?? undefined,
        type: asset?.type ?? undefined,
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
  const {packageAssetMap, assetIndex} = await buildPackageAssetMapForExport(scene)
  return createSceneDocument(scene.name, {
    id: scene.id,
    nodes: scene.nodes,
    selectedNodeId: scene.selectedNodeId,
    selectedNodeIds: scene.selectedNodeIds,
    camera: scene.camera,
    resourceProviderId: scene.resourceProviderId,
    createdAt: scene.createdAt,
    updatedAt: scene.updatedAt,
    assetCatalog: scene.assetCatalog,
    assetIndex: assetIndex,
    packageAssetMap,
    resourceSummary: scene.resourceSummary,
    materials: scene.materials,
    viewportSettings: scene.viewportSettings,
    skybox: scene.skybox,
    shadowsEnabled: scene.shadowsEnabled,
    panelVisibility: scene.panelVisibility,
    panelPlacement: scene.panelPlacement,
    groundSettings: scene.groundSettings,
    environment: resolveSceneDocumentEnvironment(scene),
  })
}

async function hydrateSceneDocumentWithEmbeddedAssets(scene: StoredSceneDocument): Promise<void> {
  if (!scene.packageAssetMap || !Object.keys(scene.packageAssetMap).length) {
    return
  }
  const entries = Object.entries(scene.packageAssetMap)
  if (!entries.some(([key]) => key.startsWith(LOCAL_EMBEDDED_ASSET_PREFIX))) {
    return
  }

  const assetCache = useAssetCacheStore()
  const nextPackageMap: Record<string, string> = {}

  entries.forEach(([key, value]) => {
    if (!key.startsWith(LOCAL_EMBEDDED_ASSET_PREFIX)) {
      nextPackageMap[key] = value
    }
  })

  for (const [key, dataUrl] of entries) {
    if (!key.startsWith(LOCAL_EMBEDDED_ASSET_PREFIX)) {
      continue
    }
    const originalId = key.slice(LOCAL_EMBEDDED_ASSET_PREFIX.length)
    if (!originalId) {
      nextPackageMap[key] = dataUrl
      continue
    }

    let blob: Blob
    try {
      blob = dataUrlToBlob(dataUrl)
    } catch (error) {
      console.warn('Failed to parse local asset data', error)
      nextPackageMap[key] = dataUrl
      continue
    }

    let computedId = originalId
    try {
      computedId = await computeBlobHash(blob)
    } catch (error) {
      console.warn('Failed to compute resource hash', error)
    }

    const filename = resolveEmbeddedAssetFilename(scene, originalId, blob)

    let entry = assetCache.hasCache(computedId) ? assetCache.getEntry(computedId) : null
    if (!entry || entry.status !== 'cached' || !entry.blob) {
      entry = await assetCache.loadFromIndexedDb(computedId)
    }
    if (!entry || entry.status !== 'cached' || !entry.blob) {
      try {
        entry = await assetCache.storeAssetBlob(computedId, {
          blob,
          mimeType: blob.type || null,
          filename,
          downloadUrl: computedId,
        })
      } catch (error) {
        console.warn('Failed to write to local asset cache', error)
        nextPackageMap[key] = dataUrl
        continue
      }
    }

    assetCache.touch(computedId)

    if (computedId !== originalId) {
      replaceAssetIdReferences(scene, originalId, computedId)
      Object.entries(nextPackageMap).forEach(([mapKey, mapValue]) => {
        if (!mapKey.startsWith(LOCAL_EMBEDDED_ASSET_PREFIX) && mapValue === originalId) {
          nextPackageMap[mapKey] = computedId
        }
      })
    }

    nextPackageMap[`${LOCAL_EMBEDDED_ASSET_PREFIX}${computedId}`] = dataUrl
  }

  scene.packageAssetMap = nextPackageMap
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeEnvironmentAssetReferences<T>(value: T): T {
  if (!isPlainObject(value)) {
    return value
  }

  const clone: Record<string, unknown> = { ...value }

  const stripHdriAsset = (raw: unknown, key: 'background' | 'environmentMap'): void => {
    if (!isPlainObject(raw)) {
      return
    }
    const section: Record<string, unknown> = { ...raw }
    const mode = typeof section.mode === 'string' ? section.mode.toLowerCase() : ''
    if (mode !== 'hdri') {
      delete section.hdriAssetId
    }
    clone[key] = section
  }

  stripHdriAsset(clone.background, 'background')
  stripHdriAsset(clone.environmentMap, 'environmentMap')

  return clone as T
}

const ASSET_REFERENCE_SKIP_KEYS = new Set<string>([PREFAB_SOURCE_METADATA_KEY])

function isAssetReferenceKey(key: string | null | undefined): boolean {
  if (!key) {
    return false
  }
  const normalized = key.trim().toLowerCase()
  if (!normalized) {
    return false
  }
  return normalized.includes('assetid')
}

function normalizePrefabAssetIdCandidate(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  let candidate = value.trim()
  if (!candidate) {
    return null
  }
  const assetProtocol = 'asset://'
  if (candidate.startsWith(assetProtocol)) {
    candidate = candidate.slice(assetProtocol.length)
  }
  if (!candidate) {
    return null
  }
  if (candidate.startsWith(LOCAL_EMBEDDED_ASSET_PREFIX)) {
    return null
  }
  if (/^(?:https?:|data:|blob:)/i.test(candidate)) {
    return null
  }
  if (candidate.length > 256) {
    return null
  }
  return candidate
}

function collectAssetIdCandidate(bucket: Set<string>, value: unknown) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectAssetIdCandidate(bucket, entry))
    return
  }
  const normalized = normalizePrefabAssetIdCandidate(value)
  if (normalized) {
    bucket.add(normalized)
  }
}

function collectAssetIdsFromUnknown(value: unknown, bucket: Set<string>) {
  if (!value) {
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectAssetIdsFromUnknown(entry, bucket))
    return
  }
  if (!isPlainObject(value)) {
    return
  }
  Object.entries(value).forEach(([key, entry]) => {
    if (ASSET_REFERENCE_SKIP_KEYS.has(key)) {
      return
    }
    if (isAssetReferenceKey(key)) {
      collectAssetIdCandidate(bucket, entry)
    } else {
      collectAssetIdsFromUnknown(entry, bucket)
    }
  })
}

function collectTerrainScatterAssetDependencies(
  snapshot: TerrainScatterStoreSnapshot | null | undefined,
  bucket: Set<string>,
) {
  if (!snapshot || !Array.isArray(snapshot.layers) || !snapshot.layers.length) {
    return
  }
  snapshot.layers.forEach((layer) => {
    collectAssetIdCandidate(bucket, layer.assetId)
    collectAssetIdCandidate(bucket, layer.profileId)
    if (Array.isArray(layer.instances)) {
      layer.instances.forEach((instance) => {
        collectAssetIdCandidate(bucket, instance.assetId)
        collectAssetIdCandidate(bucket, instance.profileId)
      })
    }
  })
}

function collectNodeAssetDependencies(node: SceneNode | null | undefined, bucket: Set<string>) {
  if (!node) {
    return
  }
  collectAssetIdCandidate(bucket, node.sourceAssetId)
  collectAssetIdCandidate(bucket, node.importMetadata?.assetId)

  // InstanceLayout may reference a different template asset.
  const rawLayout = (node as any).instanceLayout as unknown
  if (rawLayout) {
    const layout = clampSceneNodeInstanceLayout(rawLayout)
    if (layout?.mode === 'grid') {
      const templateAssetId = resolveInstanceLayoutTemplateAssetId(layout, node.sourceAssetId)
      collectAssetIdCandidate(bucket, templateAssetId)
    }
  }
  if (node.materials?.length) {
    node.materials.forEach((material) => {
      collectAssetIdsFromUnknown(material, bucket)
    })
  }
  if (node.components) {
    Object.values(node.components).forEach((component) => {
      if (component?.props) {
        collectAssetIdsFromUnknown(component.props, bucket)
      }
    })
  }
  if (node.userData) {
    if (isEnvironmentNode(node) && isPlainObject(node.userData)) {
      const sanitizedUserData = { ...(node.userData as Record<string, unknown>) }
      if ('environment' in sanitizedUserData) {
        sanitizedUserData.environment = sanitizeEnvironmentAssetReferences(sanitizedUserData.environment)
      }
      collectAssetIdsFromUnknown(sanitizedUserData, bucket)
    } else {
      collectAssetIdsFromUnknown(node.userData, bucket)
    }
  }
  if (node.dynamicMesh?.type === 'Ground') {
    const definition = node.dynamicMesh as GroundDynamicMesh & {
      terrainScatter?: TerrainScatterStoreSnapshot | null
    }
    collectTerrainScatterAssetDependencies(definition.terrainScatter, bucket)

    const terrainPaint: any = (definition as any)?.terrainPaint
    if (terrainPaint && terrainPaint.version === 1 && terrainPaint.chunks && typeof terrainPaint.chunks === 'object') {
      if (Array.isArray(terrainPaint.layers)) {
        terrainPaint.layers.forEach((layer: any) => {
          collectAssetIdCandidate(bucket, layer?.textureAssetId)
        })
      }
      Object.values(terrainPaint.chunks).forEach((ref: any) => {
        const logicalId = typeof ref?.logicalId === 'string' ? ref.logicalId.trim() : ''
        if (logicalId) {
          bucket.add(logicalId)
        }
      })
    }
  }
  if (node.children?.length) {
    node.children.forEach((child) => collectNodeAssetDependencies(child, bucket))
  }
}

// `collectPrefabAssetReferences` moved to `prefabActions` to reduce sceneStore surface.

export function collectSceneAssetReferences(scene: StoredSceneDocument): Set<string> {
  const bucket = new Set<string>()
  const materialIds = new Set<string>()

  const traverseNodes = (nodes: SceneNode[] | null | undefined): void => {
    if (!Array.isArray(nodes) || !nodes.length) {
      return
    }
    nodes.forEach((node) => {
      if (!node) {
        return
      }
      collectNodeAssetDependencies(node, bucket)
      if (Array.isArray(node.materials) && node.materials.length) {
        node.materials.forEach((material) => {
          const baseId = typeof material?.materialId === 'string' ? material.materialId.trim() : ''
          if (baseId) {
            materialIds.add(baseId)
          }
        })
      }
      if (Array.isArray(node.children) && node.children.length) {
        traverseNodes(node.children as SceneNode[])
      }
    })
  }

  traverseNodes(scene.nodes ?? [])

  const materialById = new Map<string, SceneMaterial>()
  if (Array.isArray(scene.materials) && scene.materials.length) {
    scene.materials.forEach((material) => {
      const materialId = typeof material?.id === 'string' ? material.id.trim() : ''
      if (materialId) {
        materialById.set(materialId, material)
      }
    })
  }

  materialIds.forEach((materialId) => {
    const material = materialById.get(materialId)
    if (material) {
      collectAssetIdsFromUnknown(material, bucket)
    }
  })

  collectAssetIdsFromUnknown(scene.skybox, bucket)
  collectAssetIdsFromUnknown(sanitizeEnvironmentAssetReferences(scene.environment), bucket)
  collectAssetIdsFromUnknown(scene.groundSettings, bucket)

  const catalog = scene.assetCatalog ?? {}
  const removable: string[] = []
  bucket.forEach((assetId) => {
    const asset = getAssetFromCatalog(catalog, assetId)
    if (asset?.type === 'prefab') {
      removable.push(assetId)
    }
  })
  removable.forEach((assetId) => bucket.delete(assetId))

  return bucket
}

function filterPackageAssetMapByUsage(
  map: Record<string, string>,
  usedAssetIds: Set<string>,
): Record<string, string> {
  if (!usedAssetIds.size) {
    return {}
  }
  const filtered: Record<string, string> = {}
  Object.entries(map).forEach(([rawKey, rawValue]) => {
    const key = typeof rawKey === 'string' ? rawKey.trim() : ''
    const value = typeof rawValue === 'string' ? rawValue.trim() : ''
    if (!key || !value) {
      return
    }
    const derivedId = extractAssetIdFromPackageMapKey(key)
    const valueUsed = usedAssetIds.has(value)
    const derivedUsed = derivedId ? usedAssetIds.has(derivedId) : false
    if (valueUsed || derivedUsed || !derivedId) {
      filtered[key] = rawValue
    }
  })
  return filtered
}

function filterAssetIndexByUsage(
  assetIndex: Record<string, AssetIndexEntry> | undefined,
  usedAssetIds: Set<string>,
): Record<string, AssetIndexEntry> {
  if (!assetIndex || !usedAssetIds.size) {
    return {}
  }
  const filtered: Record<string, AssetIndexEntry> = {}
  usedAssetIds.forEach((assetId) => {
    const entry = assetIndex[assetId]
    if (!entry) {
      return
    }
    filtered[assetId] = {
      categoryId: entry.categoryId,
      source: entry.source ? { ...entry.source } : undefined,
      internal: entry.internal,
    }
  })
  return filtered
}

function extractAssetIdFromPackageMapKey(key: string): string | null {
  if (!key) {
    return null
  }
  if (key.startsWith(LOCAL_EMBEDDED_ASSET_PREFIX)) {
    const embeddedId = key.slice(LOCAL_EMBEDDED_ASSET_PREFIX.length)
    return embeddedId.trim().length ? embeddedId.trim() : null
  }
  if (key.startsWith('url::')) {
    const remoteId = key.slice('url::'.length)
    return remoteId.trim().length ? remoteId.trim() : null
  }
  const separatorIndex = key.indexOf('::')
  if (separatorIndex >= 0 && separatorIndex < key.length - 2) {
    const suffix = key.slice(separatorIndex + 2)
    return suffix.trim().length ? suffix.trim() : null
  }
  return null
}

function buildAssetIndexSubsetForPrefab(
  source: Record<string, AssetIndexEntry>,
  assetIds: Iterable<string>,
): Record<string, AssetIndexEntry> | undefined {
  const subset: Record<string, AssetIndexEntry> = {}
  for (const rawId of assetIds) {
    const assetId = typeof rawId === 'string' ? rawId.trim() : ''
    if (!assetId) {
      continue
    }
    const entry = source[assetId]
    if (!entry) {
      continue
    }
    subset[assetId] = {
      categoryId: entry.categoryId,
      source: entry.source ? { ...entry.source } : undefined,
    }
  }
  return Object.keys(subset).length ? subset : undefined
}

function buildPackageAssetMapSubsetForPrefab(
  source: Record<string, string>,
  assetIds: Iterable<string>,
): Record<string, string> | undefined {
  const normalizedIds = Array.from(assetIds)
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value): value is string => value.length > 0)
  if (!normalizedIds.length) {
    return undefined
  }
  const assetIdSet = new Set(normalizedIds)
  const subset: Record<string, string> = {}
  Object.entries(source).forEach(([rawKey, rawValue]) => {
    const key = typeof rawKey === 'string' ? rawKey.trim() : ''
    const value = typeof rawValue === 'string' ? rawValue.trim() : ''
    if (!key || !value) {
      return
    }
    if (assetIdSet.has(value)) {
      subset[key] = value
      return
    }
    const derivedId = extractAssetIdFromPackageMapKey(key)
    if (derivedId && assetIdSet.has(derivedId)) {
      subset[key] = value
    }
  })
  return Object.keys(subset).length ? subset : undefined
}

function mergeAssetIndexEntries(
  current: Record<string, AssetIndexEntry>,
  additions?: Record<string, AssetIndexEntry>,
  filter?: Set<string>,
): { next: Record<string, AssetIndexEntry>; changed: boolean } {
  if (!additions || !Object.keys(additions).length) {
    return { next: current, changed: false }
  }
  const next: Record<string, AssetIndexEntry> = { ...current }
  let changed = false
  Object.entries(additions).forEach(([assetId, entry]) => {
    if (!entry || typeof entry.categoryId !== 'string') {
      return
    }
    if (filter && filter.size && !filter.has(assetId)) {
      return
    }
    const existing = next[assetId]
    if (!existing) {
      next[assetId] = {
        categoryId: entry.categoryId,
        source: entry.source ? { ...entry.source } : undefined,
      }
      changed = true
      return
    }
    let updated: AssetIndexEntry | null = null
    if (!existing.categoryId && entry.categoryId) {
      updated = { ...(updated ?? existing), categoryId: entry.categoryId }
    }
    if (!existing.source && entry.source) {
      updated = {
        ...(updated ?? existing),
        source: { ...entry.source },
      }
    }
    if (updated) {
      next[assetId] = updated
      changed = true
    }
  })
  return { next, changed }
}

function mergePackageAssetMapEntries(
  current: Record<string, string>,
  additions?: Record<string, string>,
  filter?: Set<string>,
): { next: Record<string, string>; changed: boolean } {
  if (!additions || !Object.keys(additions).length) {
    return { next: current, changed: false }
  }
  const next: Record<string, string> = { ...current }
  let changed = false
  Object.entries(additions).forEach(([rawKey, rawValue]) => {
    const key = typeof rawKey === 'string' ? rawKey.trim() : ''
    const value = typeof rawValue === 'string' ? rawValue.trim() : ''
    if (!key || !value) {
      return
    }
    if (filter && filter.size) {
      if (!filter.has(value)) {
        const derived = extractAssetIdFromPackageMapKey(key)
        if (!derived || !filter.has(derived)) {
          return
        }
      }
    }
    if (key in next) {
      return
    }
    next[key] = value
    changed = true
  })
  return { next, changed }
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

function isAssetIndex(value: unknown): value is Record<string, AssetIndexEntry> {
  if (!isPlainObject(value)) {
    return false
  }
  return Object.values(value).every((entry) => isPlainObject(entry))
}

function isPackageAssetMap(value: unknown): value is Record<string, string> {
  if (!isPlainObject(value)) {
    return false
  }
  return Object.values(value).every((entry) => typeof entry === 'string')
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

function cloneAssetIndex(index: Record<string, AssetIndexEntry>): Record<string, AssetIndexEntry> {
  const clone: Record<string, AssetIndexEntry> = {}
  Object.entries(index).forEach(([assetId, entry]) => {
    clone[assetId] = {
      categoryId: entry.categoryId,
      source: entry.source ? { ...entry.source } : undefined,
    }
  })
  return clone
}

function clonePackageAssetMap(map: Record<string, string>): Record<string, string> {
  return { ...map }
}

function stripAssetEntries(map: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  Object.entries(map).forEach(([key, value]) => {
    if (!key.startsWith(LOCAL_EMBEDDED_ASSET_PREFIX)) {
      result[key] = value
    }
  })
  return result
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

  if (!Array.isArray(next.selectedNodeIds)) {
    next.selectedNodeIds = []
  } else {
    next.selectedNodeIds = (next.selectedNodeIds as unknown[]).filter((id): id is string => typeof id === 'string')
  }

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
  store.assetCatalog = cloneAssetCatalog(scene.assetCatalog)
  store.assetIndex = cloneAssetIndex(scene.assetIndex)
  store.packageAssetMap = clonePackageAssetMap(scene.packageAssetMap)
  store.materials = cloneSceneMaterials(Array.isArray(scene.materials) ? scene.materials : initialMaterials)
  const nextTree = createProjectTreeFromCache(store.assetCatalog, store.packageDirectoryCache)
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
    groundSettings: cloneGroundSettings(store.groundSettings),
  }
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
  if (!parentId || parentId === SKY_NODE_ID || parentId === ENVIRONMENT_NODE_ID) {
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
  // NOTE: dynamicMesh can be large (especially Ground.heightMap). Prefer dedicated ground region history
  // for sculpt operations; this is mainly for non-ground meshes (road/wall/floor) and discrete edits.
  return {
    kind: 'node-dynamic-mesh',
    nodeId,
    dynamicMesh: manualDeepClone((node as any).dynamicMesh ?? null),
  }
}

function createGroundHeightmapRegionEntry(
  store: SceneState,
  nodeId: string,
  bounds: SceneHistoryGroundRegionBounds,
): SceneHistoryEntry | null {
  const node = findNodeById(store.nodes, nodeId)
  if (!node || node.dynamicMesh?.type !== 'Ground') {
    return null
  }
  const definition = node.dynamicMesh as GroundDynamicMesh
  const normalized = normalizeGroundBounds(definition, bounds)
  const entries: SceneHistoryGroundHeightEntry[] = []
  const heightMap = definition.heightMap ?? {}
  for (const [key, rawValue] of Object.entries(heightMap)) {
    const value = typeof rawValue === 'number' && Number.isFinite(rawValue) ? rawValue : 0
    if (Math.abs(value) <= HEIGHT_EPSILON) {
      continue
    }
    const parts = key.split(':')
    if (parts.length !== 2) {
      continue
    }
    const row = Number(parts[0])
    const column = Number(parts[1])
    if (!Number.isFinite(row) || !Number.isFinite(column)) {
      continue
    }
    if (
      row >= normalized.minRow && row <= normalized.maxRow &&
      column >= normalized.minColumn && column <= normalized.maxColumn
    ) {
      entries.push({ row, column, value })
    }
  }
  return {
    kind: 'ground-heightmap-region',
    nodeId,
    bounds: normalized,
    entries,
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
    case 'ground-heightmap-region':
      return createGroundHeightmapRegionEntry(store, entry.nodeId, entry.bounds)
    default:
      return null
  }
}

function applyHistoryEntry(store: SceneState, entry: SceneHistoryEntry): void {
  const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key)
  switch (entry.kind) {
    case 'content-snapshot': {
      store.nodes = cloneSceneNodes(entry.nodes)
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
      store.nodes = [...store.nodes]
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

      store.nodes = working
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
      store.nodes = [...store.nodes]
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
      // trigger reactivity
      store.nodes = [...store.nodes]
      break
    }
    case 'node-dynamic-mesh': {
      visitNode(store.nodes, entry.nodeId, (node) => {
        ;(node as any).dynamicMesh = manualDeepClone(entry.dynamicMesh as any)
      })
      store.nodes = [...store.nodes]
      break
    }
    case 'ground-heightmap-region': {
      const node = findNodeById(store.nodes, entry.nodeId)
      if (!node) {
        break
      }
      if (node.dynamicMesh?.type !== 'Ground') {
        node.dynamicMesh = createGroundDynamicMeshDefinition({}, store.groundSettings)
      }
      const definition = node.dynamicMesh as GroundDynamicMesh
      const nextHeightMap: Record<string, number> = { ...(definition.heightMap ?? {}) }
      for (const key of Object.keys(nextHeightMap)) {
        const parts = key.split(':')
        if (parts.length !== 2) continue
        const row = Number(parts[0])
        const column = Number(parts[1])
        if (!Number.isFinite(row) || !Number.isFinite(column)) continue
        if (
          row >= entry.bounds.minRow && row <= entry.bounds.maxRow &&
          column >= entry.bounds.minColumn && column <= entry.bounds.maxColumn
        ) {
          delete nextHeightMap[key]
        }
      }
      entry.entries.forEach((cell) => {
        const key = groundVertexKey(cell.row, cell.column)
        nextHeightMap[key] = cell.value
      })
      node.dynamicMesh = {
        ...definition,
        heightMap: nextHeightMap,
      }
      store.nodes = [...store.nodes]
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
    assetIndex?: Record<string, AssetIndexEntry>
    packageAssetMap?: Record<string, string>
    resourceSummary?: SceneResourceSummary
    viewportSettings?: Partial<SceneViewportSettings>
    skybox?: Partial<SceneSkyboxSettings>
    shadowsEnabled?: boolean
    panelVisibility?: Partial<PanelVisibilityState>
    panelPlacement?: Partial<PanelPlacementState>
    groundSettings?: Partial<GroundSettings>
    environment?: Partial<EnvironmentSettings>
  } = {},
): StoredSceneDocument {
  const id = options.id ?? generateUuid()
  const clonedNodes = options.nodes ? cloneSceneNodes(options.nodes) : []
  const materials = options.materials ? cloneSceneMaterials(options.materials) : cloneSceneMaterials(initialMaterials)
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
  const nodes = ensureEnvironmentNode(ensureSkyNode(ensureGroundNode(clonedNodes, groundSettings)), environmentSettings)
  const camera = options.camera ? cloneCameraState(options.camera) : cloneCameraState(defaultCameraState)
  const findDefaultSelectableNode = () => nodes.find((node) => !isGroundNode(node) && !isSkyNode(node))?.id ?? null
  let selectedNodeId = options.selectedNodeId !== undefined
    ? options.selectedNodeId
    : findDefaultSelectableNode()
  if (selectedNodeId && !nodes.some((node) => node.id === selectedNodeId)) {
    selectedNodeId = findDefaultSelectableNode()
  }
  const selectedNodeIds = normalizeSelectionIds(nodes, options.selectedNodeIds ?? (selectedNodeId ? [selectedNodeId] : []))
  const now = new Date().toISOString()
  const createdAt = options.createdAt ?? now
  const updatedAt = options.updatedAt ?? createdAt
  const assetCatalog = options.assetCatalog ? cloneAssetCatalog(options.assetCatalog) : createEmptyAssetCatalog()
  const assetIndex = options.assetIndex ? cloneAssetIndex(options.assetIndex) : {}
  const packageAssetMap = options.packageAssetMap ? clonePackageAssetMap(options.packageAssetMap) : {}
  let resourceSummary: SceneResourceSummary | undefined
  if (options.resourceSummary) {
    resourceSummary = options.resourceSummary
  }
  const skybox = cloneSceneSkybox(options.skybox ?? null)
  const shadowsEnabled = normalizeShadowsEnabledInput(options.shadowsEnabled)
  const viewportSettings = cloneViewportSettings(options.viewportSettings)
  const panelVisibility = normalizePanelVisibilityState(options.panelVisibility)
  const panelPlacement = normalizePanelPlacementStateInput(options.panelPlacement)

  return {
    id,
    name,
    projectId: options.projectId ?? '',
    nodes,
    materials,
    selectedNodeId,
    selectedNodeIds,
    camera,
    viewportSettings,
  skybox,
  shadowsEnabled,
    environment: environmentSettings,
    groundSettings,
    panelVisibility,
    panelPlacement,
    resourceProviderId: options.resourceProviderId ?? 'builtin',
    createdAt,
    updatedAt,
    assetCatalog,
    assetIndex,
    packageAssetMap,
    resourceSummary,
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

  normalizeCurrentSceneMeta(store)
  const now = new Date().toISOString()
  const meta = store.currentSceneMeta!
  const projectId = typeof meta.projectId === 'string' ? meta.projectId : ''
  const environment = cloneEnvironmentSettings(store.environment)
  const nodes = ensureEnvironmentNode(ensureSkyNode(cloneSceneNodes(store.nodes)),environment)

  const planningData = store.planningData
  const normalizedPlanningData = planningData && isPlanningDataEmpty(planningData) ? null : planningData

  return {
    id: store.currentSceneId,
    name: meta.name,
    projectId,
    nodes,
    materials: cloneSceneMaterials(store.materials),
    selectedNodeId: store.selectedNodeId,
    selectedNodeIds: cloneSelection(store.selectedNodeIds),
    camera: cloneCameraState(store.camera),
    viewportSettings: cloneViewportSettings(store.viewportSettings),
    skybox: cloneSkyboxSettings(store.skybox),
    shadowsEnabled: normalizeShadowsEnabledInput(store.shadowsEnabled),
    environment,
    groundSettings: cloneGroundSettings(store.groundSettings),
    panelVisibility: normalizePanelVisibilityState(store.panelVisibility),
    panelPlacement: normalizePanelPlacementStateInput(store.panelPlacement),
    resourceProviderId: store.resourceProviderId ?? 'builtin',
    createdAt: meta.createdAt,
    updatedAt: now,
    assetCatalog: cloneAssetCatalog(store.assetCatalog),
    assetIndex: cloneAssetIndex(store.assetIndex),
    packageAssetMap: clonePackageAssetMap(store.packageAssetMap),
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

  const normalizedNodes = ensureEnvironmentNode(ensureSkyNode(store.nodes),store.environment)
  if (normalizedNodes !== store.nodes) {
    store.nodes = normalizedNodes
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

function collectDirectoryAssets(directory: ProjectDirectory | null, bucket: ProjectAsset[]) {
  if (!directory) {
    return
  }
  if (directory.assets?.length) {
    bucket.push(...directory.assets)
  }
  directory.children?.forEach((child) => collectDirectoryAssets(child, bucket))
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
  if (nodeId === GROUND_NODE_ID || nodeId === SKY_NODE_ID || nodeId === ENVIRONMENT_NODE_ID) {
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
      if ((current.id === SKY_NODE_ID || current.id === ENVIRONMENT_NODE_ID) && position === 'inside') {
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


export const useSceneStore = defineStore('scene', {
  state: (): SceneState => {
    const assetCatalog = cloneAssetCatalog(initialSceneDocument.assetCatalog)
    const assetIndex = cloneAssetIndex(initialSceneDocument.assetIndex)
    const packageDirectoryCache: Record<string, ProjectDirectory[]> = {}
    const viewportSettings = cloneViewportSettings(initialSceneDocument.viewportSettings)
    const initialSkybox = resolveDocumentSkybox(initialSceneDocument)
    const initialShadowsEnabled = resolveDocumentShadowsEnabled(initialSceneDocument)
    let clonedNodes = cloneSceneNodes(initialSceneDocument.nodes)
    const initialEnvironment = initialSceneDocument.environment
      ? cloneEnvironmentSettings(initialSceneDocument.environment)
      : extractEnvironmentSettings(findNodeById(clonedNodes, ENVIRONMENT_NODE_ID))
    clonedNodes = ensureEnvironmentNode(
      ensureSkyNode(ensureGroundNode(clonedNodes, initialSceneDocument.groundSettings)),
      initialEnvironment,
    )
    componentManager.reset()
    componentManager.syncScene(clonedNodes)
    return {
      currentSceneId: initialSceneDocument.id,
      sceneSwitchToken: 0,
      currentSceneMeta: {
        name: initialSceneDocument.name,
        createdAt: initialSceneDocument.createdAt,
        updatedAt: initialSceneDocument.updatedAt,
        projectId: initialSceneDocument.projectId ?? '',
      },
      nodes: clonedNodes,
      materials: cloneSceneMaterials(initialSceneDocument.materials),
      selectedNodeId: initialSceneDocument.selectedNodeId,
      selectedNodeIds: cloneSelection(initialSceneDocument.selectedNodeIds),
      selectedRoadSegment: null,
      activeTool: 'select',
      assetCatalog,
      assetIndex,
      packageAssetMap: {},
      packageDirectoryCache,
      packageDirectoryLoaded: {},
      projectTree: createProjectTreeFromCache(buildVisibleAssetCatalog(assetCatalog, assetIndex), packageDirectoryCache),
      activeDirectoryId: defaultDirectoryId,
      selectedAssetId: null,
      camera: cloneCameraState(initialSceneDocument.camera),
      viewportSettings,
      skybox: initialSkybox,
      shadowsEnabled: initialShadowsEnabled,
      environment: initialEnvironment,
      groundSettings: cloneGroundSettings(initialSceneDocument.groundSettings),
      planningData: clonePlanningData((initialSceneDocument as StoredSceneDocument).planningData),
      panelVisibility: { ...defaultPanelVisibility },
      panelPlacement: { ...defaultPanelPlacement },
      projectPanelTreeSize: DEFAULT_PROJECT_PANEL_TREE_SIZE,
      resourceProviderId: initialSceneDocument.resourceProviderId,
      cloudPreviewEnabled: false,
      prefabAssetDownloadProgress: {},
      cameraFocusNodeId: null,
      cameraFocusRequestId: 0,
    nodeHighlightTargetId: null,
    nodeHighlightRequestId: 0,
      // clipboard moved to dedicated clipboard store (legacy field kept for typing compatibility)
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
  },
  getters: {
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
      if (state.activeDirectoryId === PACKAGES_ROOT_DIRECTORY_ID) {
        return []
      }
      if (!directory) {
        return []
      }

      if (state.activeDirectoryId === ASSETS_ROOT_DIRECTORY_ID) {
        const collected: ProjectAsset[] = []
        collectDirectoryAssets(directory, collected)
        return collected
      }

      const path = findDirectoryPathInTree(state.projectTree, state.activeDirectoryId)
      const isUnderPackages = path ? path.some((entry) => entry.id === PACKAGES_ROOT_DIRECTORY_ID) : false
      if (isUnderPackages) {
        const collected: ProjectAsset[] = []
        collectDirectoryAssets(directory, collected)
        return collected
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

      // Single-root group
      if (topLevelIds.length === 1) {
        const node = findNodeById(this.nodes, topLevelIds[0]!)
        if (!node) return null
        if (node.nodeType === 'Group') {
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
          const payload = nodePrefabHelpers.buildSerializedPrefabPayload(node, {
            name: node.name ?? '',
            assetIndex: this.assetIndex,
            packageAssetMap: this.packageAssetMap,
            sceneNodes: this.nodes,
          })
          const serialized = JSON.stringify(
            {
              ...payload.prefab,
              clipboard: {
                mode,
                multiRoot: false,
                meta: { rootWorldPosition, rootWorldRotation, rootWorldScale },
              },
            },
            null,
            2,
          )
          return { serialized, cut: mode === 'cut' }
        }
      }

      // Multi-root
      const pivotWorldCenter = computeSelectionBoundsCenterWorld()
      const pivotTranslation = new Matrix4().identity()
      pivotTranslation.makeTranslation(pivotWorldCenter.x, pivotWorldCenter.y, pivotWorldCenter.z)
      const pivotInverse = pivotTranslation.clone().invert()

      const wrapperId = generateUuid()
      const rootChildIds: string[] = []
      const children: SceneNode[] = []

      topLevelIds.forEach((id) => {
        const source = findNodeById(this.nodes, id)
        if (!source) return
        const sourceWorld = computeWorldMatrixForNode(this.nodes, id)
        const cloned = nodePrefabHelpers.prepareNodePrefabRoot(source, { regenerateIds: false })
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
        rootChildIds.push(cloned.id)
        children.push(cloned)
      })

      if (!children.length) return null

      const wrapper: SceneNode = {
        id: wrapperId,
        name: 'Clipboard',
        nodeType: 'Group',
        position: toPlainVector(new Vector3(0, 0, 0)),
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        visible: true,
        locked: false,
        groupExpanded: false,
        children,
      }

      const payload = nodePrefabHelpers.buildSerializedPrefabPayload(wrapper, {
        name: 'Clipboard',
        assetIndex: this.assetIndex,
        packageAssetMap: this.packageAssetMap,
        sceneNodes: this.nodes,
      })

      const serialized = JSON.stringify(
        {
          ...payload.prefab,
          clipboard: {
            mode,
            multiRoot: true,
            rootChildIds,
            meta: { pivotWorldPosition: toPlainVector(pivotWorldCenter) },
          },
        },
        null,
        2,
      )
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
      ).filter((id) => id !== SKY_NODE_ID && id !== ENVIRONMENT_NODE_ID)
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
      this.nodes = cloneSceneNodes(scene.nodes)
      this.environment = resolveSceneDocumentEnvironment(scene)
      this.rebuildGeneratedMeshRuntimes()
      this.planningData = clonePlanningData(scene.planningData)
      this.setSelection(scene.selectedNodeIds ?? (scene.selectedNodeId ? [scene.selectedNodeId] : []))
      this.camera = cloneCameraState(scene.camera)
      this.viewportSettings = cloneViewportSettings(scene.viewportSettings)
      this.skybox = resolveDocumentSkybox(scene)
      this.shadowsEnabled = resolveDocumentShadowsEnabled(scene)
      this.panelVisibility = normalizePanelVisibilityState(scene.panelVisibility)
      this.panelPlacement = normalizePanelPlacementStateInput(scene.panelPlacement)
      this.groundSettings = cloneGroundSettings(scene.groundSettings)
      this.resourceProviderId = scene.resourceProviderId ?? 'builtin'
      this.hasUnsavedChanges = false

      this.queueSceneStructurePatch('applySceneDocumentToState')
    },
    createSceneDocumentSnapshot(): StoredSceneDocument {
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
    captureGroundHeightmapRegionHistory(nodeId: string, bounds: SceneHistoryGroundRegionBounds) {
      if (this.isRestoringHistory) {
        return
      }
      if (historyCaptureSuppressionDepth > 0) {
        return
      }
      const entry = createGroundHeightmapRegionEntry(this, nodeId, bounds)
      if (entry) {
        this.appendUndoEntry(entry)
      }
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
        // Keep excluded state (environment/skybox/shadows/etc.) out of undo.
        this.nodes = ensureEnvironmentNode(
          ensureSkyNode(ensureGroundNode(this.nodes, this.groundSettings)),
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
          ensureSkyNode(ensureGroundNode(this.nodes, this.groundSettings)),
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
      this.activeTool = tool
    },
    modifyGroundRegion(bounds: GroundRegionBounds, transformer: (current: number, row: number, column: number) => number) {
      const groundNode = findGroundNode(this.nodes)
      if (!groundNode) {
        return false
      }
      if (groundNode.dynamicMesh?.type !== 'Ground') {
        groundNode.dynamicMesh = createGroundDynamicMeshDefinition({}, this.groundSettings)
      }
      const currentDefinition = groundNode.dynamicMesh as GroundDynamicMesh

      const result = applyGroundRegionTransform(currentDefinition, bounds, transformer)
      if (!result.changed) {
        return false
      }

      // Record a minimal history entry for this region (sparse heightMap keys only).
      this.captureGroundHeightmapRegionHistory(groundNode.id, bounds)

      groundNode.dynamicMesh = result.definition
      this.nodes = [...this.nodes]
      commitSceneSnapshot(this)
      return true
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
        ensureSkyNode(ensureGroundNode(clonedNodes, normalized)),
        this.environment,
      )
      this.nodes = updatedNodes

      commitSceneSnapshot(this)
      return true
    },
    setGroundTexture(payload: { dataUrl: string | null; name?: string | null }) {
      const groundNode = findGroundNode(this.nodes)
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
        environmentMap: {
          ...current.environmentMap,
          ...(patch.environmentMap ?? {}),
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

      if (this.selectedRoadSegment && (normalized.length !== 1 || normalized[0] !== this.selectedRoadSegment.nodeId)) {
        this.selectedRoadSegment = null
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
      this.queueSceneNodePatch(payload.id, ['transform'])
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
      this.queueSceneNodePatch(payload.id, ['transform'])
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
      let patchQueued = false
      prepared.forEach((update) => {
        patchQueued =
          this.queueSceneNodePatch(update.id, ['transform'], { bumpVersion: false }) || patchQueued
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
    updateNodeDynamicMesh(nodeId: string, dynamicMesh: any) {
      const target = findNodeById(this.nodes, nodeId)
      if (!target) return

      if (target.dynamicMesh?.type === 'Ground') {
        // Ground mesh edits should ideally use region-based history; fall back to a content snapshot for safety.
        this.captureHistorySnapshot()
      } else {
        this.captureNodeDynamicMeshHistory(nodeId)
      }

      visitNode(this.nodes, nodeId, (node) => {
        // PERF: Avoid JSON stringify/parse deep clones.
        // Dynamic meshes (especially Ground.heightMap) can be very large and deep cloning can stall the UI.
        // Instead, update the existing dynamicMesh in-place when possible.

        if (!dynamicMesh || typeof dynamicMesh !== 'object') {
          node.dynamicMesh = dynamicMesh
          return
        }

        const incoming = dynamicMesh as Record<string, any>
        const existing = node.dynamicMesh

        // If we don't have an object mesh to update, fall back to a shallow assignment.
        if (!existing || typeof existing !== 'object') {
          ;(node as any).dynamicMesh = { ...incoming }
          return
        }

        const existingRecord = existing as Record<string, any>

        const incomingType = typeof incoming.type === 'string' ? incoming.type : null
        const existingType = typeof existingRecord.type === 'string' ? existingRecord.type : null

        // Type mismatch: replace reference (shallow) to keep semantics correct.
        if (incomingType && existingType && incomingType !== existingType) {
          ;(node as any).dynamicMesh = { ...incoming }
          return
        }

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
      })
      this.nodes = [...this.nodes]

      // Dynamic mesh edits are runtime-visible (Road/Wall/Floor/Ground) and must enqueue a node patch
      // so the viewport can reconcile and rebuild the corresponding Three.js objects immediately.
      const updatedMeshType = typeof (target as any)?.dynamicMesh?.type === 'string' ? (target as any).dynamicMesh.type : null
      if (
        updatedMeshType === 'Road' ||
        updatedMeshType === 'Wall' ||
        updatedMeshType === 'Floor' ||
        updatedMeshType === 'Ground'
      ) {
        const queued = this.queueSceneNodePatch(nodeId, ['dynamicMesh'])

        // `SceneViewport` applies pending patches only when `sceneNodePropertyVersion` bumps.
        // If an identical patch is already pending, `queueSceneNodePatch` returns false and would not bump,
        // causing runtime-visible edits (e.g. wall segment erase/split) to appear stale until another change happens.
        if (!queued) {
          this.bumpSceneNodePropertyVersion()
        }
      }
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
      options: { materialId?: string | null; props?: Partial<SceneMaterialProps> | null; name?: string; type?: SceneMaterialType } = {},
    ) {
      const target = findNodeById(this.nodes, nodeId)
      if (!nodeSupportsMaterials(target)) {
        return null
      }

      const requestedMaterialId = options.materialId ?? null
      const shared = requestedMaterialId ? this.materials.find((entry) => entry.id === requestedMaterialId) ?? null : null
      if (requestedMaterialId && !shared) {
        return null
      }

      const baseProps = shared
        ? mergeMaterialProps(shared, options.props ?? null)
        : createMaterialProps(options.props ?? null)

      let created: SceneNodeMaterial | null = null
      this.captureHistorySnapshot()
      visitNode(this.nodes, nodeId, (node) => {
        if (!nodeSupportsMaterials(node)) {
          return
        }
        const existingCount = node.materials?.length ?? 0
        const fallbackName = options.name?.trim() || shared?.name || `Material ${existingCount + 1}`
        const entry = createNodeMaterial(shared?.id ?? null, baseProps, {
          name: shared ? shared.name : fallbackName,
          type: shared?.type ?? options.type ?? DEFAULT_SCENE_MATERIAL_TYPE,
        })
        node.materials = [...(node.materials ?? []), entry]
        created = entry
      })

      if (!created) {
        return null
      }

      this.queueSceneNodePatch(nodeId, ['materials'])
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
      } else if (primary.materialId) {
        const primaryId = primary.id
        const detached = this.assignNodeMaterial(nodeId, primaryId, null)
        if (!detached) {
          return false
        }
        const refreshed = findNodeById(this.nodes, nodeId)
        primary = refreshed?.materials?.find((entry) => entry.id === primaryId) ?? null
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
            const defaultMaterial = createNodeMaterial(baseMaterial ? baseMaterial.id : null, defaultProps, {
              name: baseMaterial?.name,
              type: baseMaterial?.type ?? DEFAULT_SCENE_MATERIAL_TYPE,
            })
            node.materials = [defaultMaterial]
          } else {
            node.materials = nextMaterials
          }
          removed = true

          const { meshChanged } = floorHelpers.ensureFloorMaterialConvention(node)
          if (meshChanged) {
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
      this.captureHistorySnapshot()
      visitNode(this.nodes, nodeId, (node) => {
        if (!nodeSupportsMaterials(node) || !node.materials?.length) {
          return
        }
        node.materials = node.materials.map((entry) => {
          if (entry.id !== nodeMaterialId) {
            return entry
          }
          if (entry.materialId) {
            return entry
          }
          updated = true
          const mergedProps = mergeMaterialProps(entry, overrides)
          return createNodeMaterial(null, mergedProps, {
            id: entry.id,
            name: entry.name,
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
    updateNodeMaterialType(nodeId: string, nodeMaterialId: string, type: SceneMaterialType) {
      let updated = false
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
          // create a new node material preserving props but with new type
          return createNodeMaterial(entry.materialId, entry, {
            id: entry.id,
            name: entry.name,
            type: type,
          })
        })
      })

      if (!updated) {
        return false
      }

      this.queueSceneNodePatch(nodeId, ['materials'])
      commitSceneSnapshot(this)
      return true
    },
    assignNodeMaterial(nodeId: string, nodeMaterialId: string, materialId: string | null) {
      const shared = materialId ? this.materials.find((entry) => entry.id === materialId) ?? null : null
      if (materialId && !shared) {
        return false
      }

      let updated = false
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
          if (shared) {
            return createNodeMaterial(shared.id, shared, {
              id: entry.id,
              name: shared.name,
              type: shared.type,
            })
          }
          const currentProps = extractMaterialProps(entry)
          const fallbackName = entry.name ?? `Material ${index + 1}`
          return createNodeMaterial(null, currentProps, {
            id: entry.id,
            name: fallbackName,
            type: entry.type,
          })
        })
      })

      if (!updated) {
        return false
      }

      this.queueSceneNodePatch(nodeId, ['materials'])
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
        const { meshChanged } = floorHelpers.ensureFloorMaterialConvention(node)
        if (meshChanged) {
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
    resetSharedMaterialAssignments(materialId: string) {
      if (!materialId || !nodeTreeIncludesMaterial(this.nodes, materialId)) {
        return false
      }

      this.captureHistorySnapshot()
      const fallbackMaterial = findDefaultSceneMaterial(this.materials)
      const defaultProps = fallbackMaterial ? createMaterialProps(fallbackMaterial) : createMaterialProps()
      const changed = applyMaterialPropsToNodeTree(
        this.nodes,
        materialId,
        defaultProps,
        null,
        DEFAULT_SCENE_MATERIAL_TYPE,
      )

      if (!changed) {
        return false
      }
      this.queueSceneStructurePatch('resetSharedMaterialAssignments')
      commitSceneSnapshot(this)
      return true
    },
    saveNodeMaterialAsShared(
      nodeId: string,
      nodeMaterialId: string,
      options: { name?: string; description?: string } = {},
    ): SceneMaterial | null {
      const targetNode = findNodeById(this.nodes, nodeId)
      if (!nodeSupportsMaterials(targetNode) || !targetNode?.materials?.length) {
        return null
      }

      const existing = targetNode.materials.find((entry) => entry.id === nodeMaterialId) ?? null
      if (!existing) {
        return null
      }
      if (existing.materialId) {
        return this.materials.find((entry) => entry.id === existing.materialId) ?? null
      }

      const props = extractMaterialProps(existing)
      const nameCandidates = [
        typeof options.name === 'string' ? options.name.trim() : '',
        typeof existing.name === 'string' ? existing.name.trim() : '',
      ]
      const fallbackName = `Material ${this.materials.length + 1}`
      const resolvedName = nameCandidates.find((value) => value && value.length) ?? fallbackName
      const normalizedDescription =
        typeof options.description === 'string' ? options.description.trim() : undefined

      const material = createSceneMaterial(resolvedName, props, { type:existing.type ?? DEFAULT_SCENE_MATERIAL_TYPE })
      if (normalizedDescription && normalizedDescription.length) {
        material.description = normalizedDescription
      }

      let nodeUpdated = false
      visitNode(this.nodes, nodeId, (node) => {
        if (!nodeSupportsMaterials(node) || !node.materials?.length) {
          return
        }
        const nextMaterials = node.materials.map((entry) => {
          if (entry.id !== nodeMaterialId) {
            return entry
          }
          nodeUpdated = true
          return createNodeMaterial(material.id, material, {
            id: entry.id,
            name: material.name,
            type: material.type,
          })
        })
        node.materials = nextMaterials
      })

      if (!nodeUpdated) {
        return null
      }

      this.materials = [...this.materials, material]
      this.queueSceneNodePatch(nodeId, ['materials'])

      const previewColor = typeof props.color === 'string' && props.color.trim().length ? props.color : '#607d8b'
      const asset: ProjectAsset = {
        id: material.id,
        name: material.name,
        type: 'material',
        description: material.description,
        downloadUrl: `material://${material.id}.material`,
        previewColor,
        thumbnail: null,
        gleaned: true,
        extension: extractExtension(`material://${material.id}.material`) ?? null,
      }

      this.registerAsset(asset, {
        categoryId: determineAssetCategoryId(asset),
        source: { type: 'local' },
        commitOptions: { updateNodes: true },
      })

      return material
    },
    updateNodeMaterialMetadata(nodeId: string, nodeMaterialId: string, metadata: { name?: string | null }) {
      const rawName = metadata.name
      const trimmedName = typeof rawName === 'string' ? rawName.trim() : rawName

      let updated = false
      this.captureHistorySnapshot()
      visitNode(this.nodes, nodeId, (node) => {
        if (!nodeSupportsMaterials(node) || !node.materials?.length) {
          return
        }
        node.materials = node.materials.map((entry) => {
          if (entry.id !== nodeMaterialId) {
            return entry
          }
          if (entry.materialId) {
            return entry
          }
          updated = true
          const currentProps = extractMaterialProps(entry)
          return createNodeMaterial(null, currentProps, {
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
    updateMaterialDefinition(materialId: string, update: Partial<SceneMaterialProps> & { name?: string; description?: string; type?: SceneMaterialType }) {
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

      let changedNodes = false
      if (
        applyMaterialPropsToNodeTree(
          this.nodes,
          materialId,
          nextMaterial,
          materialId,
          nextType,
        )
      ) {
        changedNodes = true
      }

      if (changedNodes) {
        this.queueSceneStructurePatch('updateMaterialDefinition')
      }

      commitSceneSnapshot(this, { updateNodes: changedNodes })
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

      let changedNodes = false
      if (fallbackMaterial) {
        if (reassignMaterialInNodeTree(this.nodes, materialId, fallbackMaterial)) {
          changedNodes = true
        }
      } else {
        const defaultProps = createMaterialProps()
        if (
          applyMaterialPropsToNodeTree(
            this.nodes,
            materialId,
            defaultProps,
            null,
            DEFAULT_SCENE_MATERIAL_TYPE,
          )
        ) {
          changedNodes = true
        }
      }

      if (changedNodes) {
        this.queueSceneStructurePatch('deleteMaterial')
      }

      commitSceneSnapshot(this, { updateNodes: changedNodes })
      return true
    },
    updateLightProperties(id: string, properties: Partial<LightNodeProperties>) {
      const target = findNodeById(this.nodes, id)
      if (!target || !target.light) {
        return
      }
      this.captureHistorySnapshot()
      visitNode(this.nodes, id, (node) => {
        if (!node.light) {
          return
        }
        const next: LightNodeProperties = {
          ...node.light,
          ...properties,
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
    isNodeVisible(id: string) {
      const node = findNodeById(this.nodes, id)
      return node?.visible ?? true
    },
    setNodeVisibility(id: string, visible: boolean) {
      const node = findNodeById(this.nodes, id)
      if (!node) {
        return
      }
      const currentEffective = (node as any).visible ?? true
      if (currentEffective === visible) {
        return
      }

      this.captureNodeBasicsHistorySnapshot([{ id, visible: true }])
      visitNode(this.nodes, id, (target) => {
        ;(target as any).visible = visible
      })
      this.nodes = [...this.nodes]
      this.queueSceneNodePatch(id, ['visibility'])
      commitSceneSnapshot(this)
    },
    toggleNodeVisibility(id: string) {
      const current = this.isNodeVisible(id)
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
          const isSystemNode = node.id === GROUND_NODE_ID || node.id === SKY_NODE_ID || node.id === ENVIRONMENT_NODE_ID
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
              node.id !== SKY_NODE_ID &&
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
      if ((id === GROUND_NODE_ID || id === SKY_NODE_ID || id === ENVIRONMENT_NODE_ID) && !locked) {
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
      if (id === GROUND_NODE_ID || id === SKY_NODE_ID || id === ENVIRONMENT_NODE_ID) {
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
          if (node.id !== GROUND_NODE_ID && node.id !== SKY_NODE_ID && node.id !== ENVIRONMENT_NODE_ID) {
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
          return createNodeMaterial(entry.materialId, merged, {
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

      const nodesToScan = Array.isArray(options.nodes) ? options.nodes : this.nodes
      const terrainPaintRefs = new Map<string, string | null>()
      const collectTerrainPaintRefs = (node: SceneNode) => {
        const dynamicMesh = node.dynamicMesh
        if (dynamicMesh && dynamicMesh.type === 'Ground') {
          const groundMesh = dynamicMesh as GroundDynamicMesh
          const terrainPaint = groundMesh.terrainPaint ?? null
          if (terrainPaint && terrainPaint.version === 1 && terrainPaint.chunks) {
            Object.values(terrainPaint.chunks).forEach((ref) => {
              if (!ref || typeof (ref as any).logicalId !== 'string' || !String((ref as any).logicalId).trim().length) {
                return
              }
              const logicalId = String((ref as any).logicalId).trim()
              if (!terrainPaintRefs.has(logicalId)) {
                terrainPaintRefs.set(logicalId, null)
              }
            })
          }
        }
        if (Array.isArray(node.children)) {
          node.children.forEach((child) => collectTerrainPaintRefs(child))
        }
      }

      nodesToScan.forEach((node) => collectTerrainPaintRefs(node))

      if (terrainPaintRefs.size > 0) {
        await Promise.allSettled(
          Array.from(terrainPaintRefs.keys()).map(async (logicalId) => {
            await assetCache.loadFromIndexedDb(logicalId)
          }),
        )
      }

      const result = await updateSceneAssets({
        options,
        defaultNodes: this.nodes,
        assetCache,
        ui: uiStore,
        watch,
        getAsset: (assetId) => this.getAsset(assetId),
        collectNodesByAssetId,
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

      const node = await this.addModelNode({
        asset,
        position,
        rotation: options.rotation,
        parentId: targetParentId ?? undefined,
      })
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
      void assetCache.downloaProjectAsset(asset).catch((error) => {
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
      this.projectTree = createProjectTreeFromCache(
        buildVisibleAssetCatalog(this.assetCatalog, this.assetIndex),
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
    // Helper: atomically apply catalog/index/packageMap updates and refresh tree
    applyCatalogUpdate(
      nextCatalog: Record<string, ProjectAsset[]>,
      options?: {
        nextIndex?: Record<string, AssetIndexEntry>
        nextPackageMap?: Record<string, string>
        commitSnapshot?: boolean
        updateNodes?: boolean
      },
    ) {
      this.assetCatalog = nextCatalog
      if (options?.nextIndex) {
        this.assetIndex = options.nextIndex
      }
      if (options?.nextPackageMap) {
        this.packageAssetMap = options.nextPackageMap
      }
      this.refreshProjectTree()
      if (options?.commitSnapshot) {
        commitSceneSnapshot(this, { updateNodes: !!options.updateNodes })
      }
    },
    // Helper: find asset by id inside catalog using assetIndex.categoryId
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
    getPackageDirectories(providerId: string): ProjectDirectory[] | null {
      const cached = this.packageDirectoryCache[providerId]
      if (!cached) {
        return null
      }
      return cloneProjectTree(cached)
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
    
    getAsset(assetId: string): ProjectAsset | null {
      const foundInCatalog = this.findAssetInCatalog(assetId)
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
    async ensureLocalAssetFromFile(
      file: File,
      metadata: {
        type: ProjectAsset['type']
        name: string
        description?: string
        previewColor?: string
        gleaned?: boolean
        commitOptions?: { updateNodes?: boolean }
      },
    ): Promise<{ asset: ProjectAsset; isNew: boolean }> {
      const assetCache = useAssetCacheStore()
      const displayName = metadata.name && metadata.name.trim().length ? metadata.name.trim() : file.name ?? 'Local Asset'
      const description = metadata.description ?? (file.name && file.name.trim().length ? file.name : undefined)
      const assetId = await computeBlobHash(file)

      let entry = assetCache.hasCache(assetId) ? assetCache.getEntry(assetId) : null
      if (!entry || entry.status !== 'cached' || !entry.blob) {
        entry = await assetCache.loadFromIndexedDb(assetId)
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
        gleaned: metadata.gleaned ?? true,
        extension: extractExtension(file.name) ?? getExtensionFromMimeType(file.type) ?? null,
      }

      const registered = this.registerAsset(projectAsset, {
        categoryId: determineAssetCategoryId(projectAsset),
        source: { type: 'local' },
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
        commitOptions?: { updateNodes?: boolean }
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
        return determineAssetCategoryId(asset)
      }

      const sourceForAsset = (asset: ProjectAsset): AssetSourceMetadata | undefined => {
        if (typeof options.source === 'function') {
          return options.source(asset)
        }
        return options.source
      }

      const internalForAsset = (asset: ProjectAsset): boolean => {
        if (typeof options.internal === 'function') {
          return Boolean(options.internal(asset))
        }
        return Boolean(options.internal)
      }

      const { nextCatalog, nextIndex, registeredAssets, sourceByAssetId } = upsertAssetsIntoCatalogAndIndex(
        this.assetCatalog,
        this.assetIndex,
        normalizedAssets,
        { categoryIdForAsset, sourceForAsset, internalForAsset },
      )

      if (!registeredAssets.length) {
        return []
      }

      this.applyCatalogUpdate(nextCatalog, { nextIndex })

      registeredAssets.forEach((asset) => {
        void this.syncAssetPackageMapEntry(asset, sourceByAssetId[asset.id])
      })

      return registeredAssets
    },

    registerAsset(
      asset: ProjectAsset,
      options: { categoryId?: string; source?: AssetSourceMetadata; internal?: boolean; commitOptions?: { updateNodes?: boolean } } = {},
    ) {
      const categoryId = options.categoryId ?? determineAssetCategoryId(asset)
      const registered = this.registerAssets([asset], {
        categoryId,
        source: options.source,
        internal: options.internal,
        commitOptions: options.commitOptions,
      })
      return registered[0] ?? { ...asset }
    },
    async cleanUnusedAssets(): Promise<{ removedAssetIds: string[] }> {
      if (!this.currentSceneId) {
        return { removedAssetIds: [] }
      }

      const document = buildSceneDocumentFromState(this)
      const usedAssetIds = collectSceneAssetReferences(document)
      const removedAssetIds: string[] = []
      const nextCatalog: Record<string, ProjectAsset[]> = {}
      let catalogChanged = false

      Object.entries(this.assetCatalog).forEach(([categoryId, list]) => {
        const filtered = list.filter((asset) => {
          const keep = usedAssetIds.has(asset.id)
          if (!keep) {
            removedAssetIds.push(asset.id)
          }
          return keep
        })
        if (filtered.length !== list.length) {
          catalogChanged = true
        }
        nextCatalog[categoryId] = filtered
      })

      const assetIndexChanged = Object.keys(this.assetIndex).some((assetId) => !usedAssetIds.has(assetId))
      const nextAssetIndex = assetIndexChanged
        ? filterAssetIndexByUsage(this.assetIndex, usedAssetIds)
        : this.assetIndex

      const nextPackageAssetMap = filterPackageAssetMapByUsage(this.packageAssetMap, usedAssetIds)
      const packageMapChanged = Object.keys(this.packageAssetMap).length !== Object.keys(nextPackageAssetMap).length
        || Object.entries(this.packageAssetMap).some(([key, value]) => nextPackageAssetMap[key] !== value)

      const shouldResetSelection = this.selectedAssetId ? !usedAssetIds.has(this.selectedAssetId) : false

      if (!catalogChanged && !assetIndexChanged && !packageMapChanged) {
        return { removedAssetIds: [] }
      }

      this.applyCatalogUpdate(nextCatalog, { nextIndex: nextAssetIndex, nextPackageMap: nextPackageAssetMap })
      if (shouldResetSelection) {
        this.selectedAssetId = null
      }
      this.ensureActiveDirectoryAndSelectionValid()

      commitSceneSnapshot(this, { updateNodes: false })

      return { removedAssetIds }
    },
    async syncAssetPackageMapEntry(asset: ProjectAsset, source?: AssetSourceMetadata) {
      if (!asset?.id) {
        return
      }

      try {
        const updates: Record<string, string> = {}
        const removals: string[] = []

        if (source?.type === 'package' && source.providerId) {
          const mapKey = `${source.providerId}::${source.originalAssetId ?? asset.id}`
          updates[mapKey] = asset.id
        }

        const remoteCandidate = normalizeRemoteCandidate(asset.downloadUrl)
          ?? normalizeRemoteCandidate(asset.description)
          ?? normalizeRemoteCandidate(asset.thumbnail)
          ?? normalizeRemoteCandidate(asset.id)

        if (remoteCandidate) {
          const remoteKey = `url::${asset.id}`
          updates[remoteKey] = remoteCandidate
          removals.push(`${LOCAL_EMBEDDED_ASSET_PREFIX}${asset.id}`)
        }

        const shouldEmbedLocal = source?.type === 'local' && !remoteCandidate
        if (shouldEmbedLocal) {
          const dataUrl = await this.createLocalAssetDataUrl(asset)
          if (dataUrl) {
            const embeddedKey = `${LOCAL_EMBEDDED_ASSET_PREFIX}${asset.id}`
            updates[embeddedKey] = dataUrl
            removals.push(`url::${asset.id}`)
          }
        }

        if (!Object.keys(updates).length && !removals.length) {
          return
        }

        const nextMap: Record<string, string> = { ...this.packageAssetMap }
        let changed = false

        removals.forEach((key) => {
          if (key in nextMap) {
            delete nextMap[key]
            changed = true
          }
        })

        Object.entries(updates).forEach(([key, value]) => {
          if (typeof value !== 'string' || !value.trim().length) {
            return
          }
          if (nextMap[key] !== value) {
            nextMap[key] = value
            changed = true
          }
        })

        if (!changed) {
          return
        }

        this.packageAssetMap = nextMap
        commitSceneSnapshot(this, { updateNodes: false })
      } catch (error) {
        console.warn('Failed to synchronize package asset map for asset', asset.id, error)
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
        entry = await assetCache.loadFromIndexedDb(assetId)
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
    async saveNodePrefab(nodeId: string, options: { assetId?: string; name?: string } = {}): Promise<ProjectAsset> {
      return prefabActions.saveNodePrefab(this as unknown as PrefabStoreLike, nodeId, options)
    },
    async importPrefabAssetFromClipboard(serialized: string): Promise<ProjectAsset | null> {
      return prefabActions.importPrefabAssetFromClipboard(this as unknown as PrefabStoreLike, serialized)
    },
    async loadNodePrefab(assetId: string): Promise<NodePrefabData> {
      return prefabActions.loadNodePrefab(this as unknown as PrefabStoreLike, assetId)
    },
    async ensurePrefabDependencies(
      assetIds: string[],
      options: {
        providerId?: string | null
        prefabAssetIdForDownloadProgress?: string | null
        prefabAssetIndex?: Record<string, AssetIndexEntry> | null
        prefabPackageAssetMap?: Record<string, string> | null
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

    async loadLodPreset(assetId: string): Promise<LodPresetData> {
      return lodPresetActions.loadLodPreset(this as any, assetId)
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
    copyPackageAssetToAssets(providerId: string, asset: ProjectAsset): ProjectAsset {
      return this.copyPackageAssetsToAssets(providerId, [asset])[0] ?? asset
    },

    copyPackageAssetsToAssets(providerId: string, assets: ProjectAsset[]): ProjectAsset[] {
      const normalized = Array.isArray(assets)
        ? assets
            .filter((asset) => asset && typeof asset.id === 'string' && asset.id.trim().length > 0)
            .map((asset) => ({ ...asset, id: asset.id.trim() }))
        : []
      if (!normalized.length) {
        return []
      }

      const nextPackageMap: Record<string, string> = { ...this.packageAssetMap }
      let packageMapChanged = false
      const resolved: ProjectAsset[] = []
      const toRegister: ProjectAsset[] = []

      normalized.forEach((asset) => {
        const mapKey = `${providerId}::${asset.id}`
        const existingId = nextPackageMap[mapKey]
        if (existingId) {
          const existingAsset = this.getAsset(existingId)
          if (existingAsset) {
            resolved.push(existingAsset)
            return
          }
          delete nextPackageMap[mapKey]
          packageMapChanged = true
        }

        toRegister.push({
          ...asset,
          gleaned: true,
        })
      })

      if (toRegister.length) {
        const registered = this.registerAssets(toRegister, {
          categoryId: (asset) => determineAssetCategoryId(asset),
          source: (asset) => ({
            type: 'package',
            providerId,
            originalAssetId: asset.id,
          }),
          commitOptions: { updateNodes: false },
        })

        registered.forEach((asset) => {
          nextPackageMap[`${providerId}::${asset.id}`] = asset.id
        })
        packageMapChanged = true
        resolved.push(...registered)
      }

      if (packageMapChanged) {
        this.packageAssetMap = nextPackageMap
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

      const deletableIds = uniqueIds.filter((id) => catalogAssets.has(id))
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

      const nextIndex = { ...this.assetIndex }
      deletableIds.forEach((assetId) => {
        delete nextIndex[assetId]
      })

      const nextPackageMap: Record<string, string> = {}
      Object.entries(this.packageAssetMap).forEach(([key, value]) => {
        if (key.startsWith(LOCAL_EMBEDDED_ASSET_PREFIX)) {
          const embeddedId = key.slice(LOCAL_EMBEDDED_ASSET_PREFIX.length)
          if (embeddedId && assetIdSet.has(embeddedId)) {
            return
          }
        }
        if (assetIdSet.has(value)) {
          return
        }
        nextPackageMap[key] = value
      })

      // Apply catalog/index/packageMap update and refresh project tree
      this.applyCatalogUpdate(nextCatalog, { nextIndex, nextPackageMap })
      this.ensureActiveDirectoryAndSelectionValid()
      if (this.selectedAssetId && assetIdSet.has(this.selectedAssetId)) {
        this.selectedAssetId = null
      }

      nonMaterialAssetIds.forEach((assetId) => {
        assetCache.removeCache(assetId)
      })

      if (deletableIds.length) {
        commitSceneSnapshot(this, { updateNodes: false })
      }

      return deletableIds
    },
    replaceLocalAssetWithServerAsset(
      localAssetId: string,
      remoteAsset: ProjectAsset,
      options: { source?: AssetSourceMetadata } = {},
    ): ProjectAsset | null {
      const meta = this.assetIndex[localAssetId]
      if (!meta) {
        return null
      }

      const storedAsset: ProjectAsset = {
        ...remoteAsset,
        gleaned: false,
      }
      const nextCategoryId = determineAssetCategoryId(storedAsset)

      const nextCatalog = { ...this.assetCatalog }
      const previousList = nextCatalog[meta.categoryId] ?? []
      nextCatalog[meta.categoryId] = previousList.filter((asset) => asset.id !== localAssetId)

      const targetList = nextCatalog[nextCategoryId] ?? []
      nextCatalog[nextCategoryId] = [...targetList.filter((asset) => asset.id !== storedAsset.id), storedAsset]

      const nextIndex = { ...this.assetIndex }
      delete nextIndex[localAssetId]
      nextIndex[storedAsset.id] = {
        categoryId: nextCategoryId,
        source: options.source ?? { type: 'url' },
      }

      const nextPackageMap: Record<string, string> = {}
      Object.entries(this.packageAssetMap).forEach(([key, value]) => {
        if (key === `${LOCAL_EMBEDDED_ASSET_PREFIX}${localAssetId}`) {
          return
        }
        if (value === localAssetId) {
          nextPackageMap[key] = storedAsset.id
          return
        }
        nextPackageMap[key] = value
      })

      // Atomically apply catalog/index/packageMap and rebuild project tree
      this.applyCatalogUpdate(nextCatalog, { nextIndex, nextPackageMap })

      replaceAssetIdInMaterials(this.materials, localAssetId, storedAsset.id)
      replaceAssetIdInNodes(this.nodes, localAssetId, storedAsset.id)
      this.materials = [...this.materials]
      this.queueSceneStructurePatch('replaceAssetIdInNodes')

      if (this.selectedAssetId === localAssetId) {
        this.selectedAssetId = storedAsset.id
      }
      if (this.draggingAssetId === localAssetId) {
        this.draggingAssetId = storedAsset.id
      }

      commitSceneSnapshot(this, { updateNodes: true })
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
    setSkyboxSettings(partial: Partial<SceneSkyboxSettings>, options: { markCustom?: boolean } = {}) {
      const current = cloneSkyboxSettings(this.skybox)
      const next = normalizeSkyboxSettings({ ...current, ...partial })
      if (options.markCustom && !partial.presetId) {
        next.presetId = CUSTOM_SKYBOX_PRESET_ID
      }
      if (skyboxSettingsEqual(this.skybox, next)) {
        return
      }
      this.skybox = next
      commitSceneSnapshot(this, { updateNodes: false })
    },
    applySkyboxPreset(presetId: string) {
      const preset = resolveSkyboxPreset(presetId)
      if (!preset) {
        return
      }
      const next = normalizeSkyboxSettings({
        presetId,
        ...preset.settings,
      })
      if (skyboxSettingsEqual(this.skybox, next)) {
        return
      }
      this.skybox = next
      commitSceneSnapshot(this, { updateNodes: false })
    },
    setCloudPreviewEnabled(enabled: boolean) {
      if (this.cloudPreviewEnabled === enabled) {
        return
      }
      this.cloudPreviewEnabled = enabled
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
        patchQueued = this.queueSceneNodePatch(adjustment.id, ['transform'], { bumpVersion: false }) || patchQueued
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
      if (nodeId === GROUND_NODE_ID || nodeId === SKY_NODE_ID || nodeId === ENVIRONMENT_NODE_ID) {
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

      if ((targetId === SKY_NODE_ID || targetId === ENVIRONMENT_NODE_ID) && position === 'inside') {
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

      if (newParentId === SKY_NODE_ID || newParentId === ENVIRONMENT_NODE_ID) {
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

      // Ensure viewport/overlays can update topology even when group recentering is skipped.
      this.queueSceneNodePatch(nodeId, ['transform'])

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
      if (parentId === SKY_NODE_ID || parentId === ENVIRONMENT_NODE_ID) {
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
          createNodeMaterial(null, createMaterialProps({
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
          this.nodes = workingTree
        } else {
          this.nodes = [node, ...this.nodes]
        }
      } else {
        this.nodes = [node, ...this.nodes]
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
        await assetCache.downloaProjectAsset(asset)
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
          const file = assetCache.createFileFromCache(asset.id)
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

      const file = assetCache.createFileFromCache(asset.id)
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
      if (targetParentId === SKY_NODE_ID || targetParentId === ENVIRONMENT_NODE_ID) {
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
          if (!assetCache.hasCache(asset.id)) {
            return null
          }
          const file = assetCache.createFileFromCache(asset.id)
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

      if (Number.isFinite(minY)) {
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
      let nodeMaterials: SceneNodeMaterial[] | undefined

      if (sceneNodeTypeSupportsMaterials(nodeType)) {
        const baseMaterial = findDefaultSceneMaterial(this.materials)
        const initialProps: SceneMaterialProps = baseMaterial ? createMaterialProps(baseMaterial) : createMaterialProps()
        const initialMaterial = createNodeMaterial(null, initialProps, {
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
      if (parentId === SKY_NODE_ID || parentId === ENVIRONMENT_NODE_ID) {
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
          const ensured = ensureDynamicMeshRuntime(node, groundNode) || ensureAiModelMeshRuntime(node)
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
      name?: string
      bodyAssetId?: string | null
      editorFlags?: SceneNodeEditorFlags
    }): SceneNode | null {
      const build = buildWallDynamicMeshFromWorldSegments(payload.segments, payload.dimensions)
      if (!build) {
        return null
      }

      const wallGroup = createWallGroup(build.definition, { smoothing: WALL_DEFAULT_SMOOTHING })
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
          this.updateNodeDynamicMesh(desiredId, build.definition)
          if (payload.editorFlags) {
            existing.editorFlags = cloneEditorFlags(payload.editorFlags)
            this.queueSceneNodePatch(desiredId, ['visibility'])
          }

          // Ensure required components exist and are configured.
          this.ensureStaticRigidbodyComponent(desiredId)
          const wallComponent = (findNodeById(this.nodes, desiredId)?.components?.[WALL_COMPONENT_TYPE] as
            | SceneNodeComponentState<WallComponentProps>
            | undefined)
          if (wallComponent?.id) {
            const bodyAssetId = typeof payload.bodyAssetId === 'string' && payload.bodyAssetId.trim().length
              ? payload.bodyAssetId
              : null
            if (bodyAssetId) {
              this.updateNodeComponentProps(desiredId, wallComponent.id, { bodyAssetId })
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
          dynamicMesh: build.definition,
          editorFlags: payload.editorFlags,
        })
        if (node) {
          this.ensureStaticRigidbodyComponent(node.id)

          const bodyAssetId = typeof payload.bodyAssetId === 'string' && payload.bodyAssetId.trim().length
            ? payload.bodyAssetId
            : null

          if (bodyAssetId) {
            const component = node.components?.[WALL_COMPONENT_TYPE] as
              | SceneNodeComponentState<WallComponentProps>
              | undefined
            if (component) {
              this.updateNodeComponentProps(node.id, component.id, {
                bodyAssetId,
              })
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
      editorFlags?: SceneNodeEditorFlags
    }): SceneNode | null {
      const build = buildRoadDynamicMeshFromWorldPoints(payload.points, payload.width)
      if (!build) {
        return null
      }

      const groundNode = resolveGroundNodeForHeightSampling(this.nodes)
      const groundDefinition = groundNode?.dynamicMesh?.type === 'Ground'
        ? (groundNode.dynamicMesh as GroundDynamicMesh)
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
            : null

          const result = this.addNodeComponent(node.id, ROAD_COMPONENT_TYPE)
          const component = result?.component

          if (component?.id) {
            this.updateNodeComponentProps(node.id, component.id, {
              ...resolveRoadComponentPropsFromMesh(build.definition),
              bodyAssetId,
            })
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
      editorFlags?: SceneNodeEditorFlags
    }): SceneNode | null {
      const build = floorHelpers.buildFloorDynamicMeshFromWorldPoints(payload.points)
      if (!build) {
        return null
      }

      // Floors use 2 material slots by default: TopBottom + Side.
      const defaultMaterials = createFloorNodeMaterials({
        topBottomName: 'TopBottom',
        sideName: 'Side',
      })

      const defaultTopId = defaultMaterials[0]?.id ?? null
      const defaultSideId = defaultMaterials[1]?.id ?? defaultTopId

      const defaultMesh: FloorDynamicMesh = {
        ...build.definition,
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
            topBottomMaterialConfigId: existingMesh?.topBottomMaterialConfigId ?? null,
            sideMaterialConfigId: existingMesh?.sideMaterialConfigId ?? null,
          } as FloorDynamicMesh)

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
            const names = Array.isArray(payload.waypoints) ? payload.waypoints : []
            const waypoints = build.definition.vertices.map((position: Vector3Like, index: number) => {
              const rawName = (names[index]?.name ?? '').trim()
              const name = rawName.length ? rawName : `P${index + 1}`
              return { name, position, dock: names[index]?.dock === true }
            })
            this.updateNodeComponentProps(node.id, component.id, { waypoints })
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
    updateWallNodeGeometry(nodeId: string, payload: {
      segments: Array<{ start: Vector3Like; end: Vector3Like }>
      dimensions?: { height?: number; width?: number; thickness?: number }
    }): boolean {
  const node = findNodeById(this.nodes, nodeId)
  if (!node || node.dynamicMesh?.type !== 'Wall') {
        return false
      }

      const build = buildWallDynamicMeshFromWorldSegments(payload.segments, payload.dimensions)
      if (!build) {
        return false
      }

      const parentMap = buildParentMap(this.nodes)
      const parentId = parentMap.get(nodeId) ?? null

      this.captureHistorySnapshot()
      node.position = createVector(build.center.x, build.center.y, build.center.z)
      node.dynamicMesh = build.definition

      // Keep wall component dimensions in sync with the wall mesh so inspector UI and runtime component state
      // always reflect geometry edits (e.g. gizmo height drag).
      const meshProps = resolveWallComponentPropsFromMesh(build.definition)
      const previousWallComponent = node.components?.[WALL_COMPONENT_TYPE] as SceneNodeComponentState<WallComponentProps> | undefined
      const previousProps = previousWallComponent?.props as WallComponentProps | undefined
      const nextProps = clampWallProps({
        ...meshProps,
        ...(previousProps ?? {}),
        bodyOrientation: previousProps?.bodyOrientation ?? meshProps.bodyOrientation,
        headOrientation: previousProps?.headOrientation ?? meshProps.headOrientation,
        bodyEndCapOrientation: previousProps?.bodyEndCapOrientation ?? meshProps.bodyEndCapOrientation,
        headEndCapOrientation: previousProps?.headEndCapOrientation ?? meshProps.headEndCapOrientation,
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
        updateWallGroup(runtime, build.definition, {
          smoothing: resolveWallSmoothing(node),
          jointTrimMode: nextProps.jointTrimMode,
          jointTrimManual: nextProps.jointTrimManual,
        } as any)
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

      this.queueSceneNodePatch(nodeId, ['components', 'dynamicMesh'])
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
          } else if (componentState.type === DISPLAY_BOARD_COMPONENT_TYPE) {
            applyDisplayBoardComponentPropsToNode(
              node,
              componentState.props as unknown as DisplayBoardComponentProps,
            )
          } else if (componentState.type === FLOOR_COMPONENT_TYPE) {
            floorHelpers.applyFloorComponentPropsToNode(node, componentState.props as FloorComponentProps)
          }else if (componentState.type === ROAD_COMPONENT_TYPE) {
            const groundNode = resolveGroundNodeForHeightSampling(this.nodes)
            applyRoadComponentPropsToNode(node, componentState.props as RoadComponentProps, groundNode)
          } 
        })
        node.components = nextComponents
      })

      this.queueSceneNodePatch(nodeId, ['components', 'dynamicMesh'])
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
        | DisplayBoardComponentProps
        | WarpGateComponentProps
        | FloorComponentProps
        | EffectComponentProps
        | RigidbodyComponentProps
        | VehicleComponentProps
        | WaterComponentProps
      if (type === WALL_COMPONENT_TYPE) {
        const currentProps = clampWallProps(component.props as WallComponentProps)
        const typedPatch = patch as Partial<WallComponentProps>
        const hasBodyAssetId = Object.prototype.hasOwnProperty.call(typedPatch, 'bodyAssetId')
        const hasHeadAssetId = Object.prototype.hasOwnProperty.call(typedPatch, 'headAssetId')
        const hasBodyEndCapAssetId = Object.prototype.hasOwnProperty.call(typedPatch, 'bodyEndCapAssetId')
        const hasHeadEndCapAssetId = Object.prototype.hasOwnProperty.call(typedPatch, 'headEndCapAssetId')
        const hasBodyOrientation = Object.prototype.hasOwnProperty.call(typedPatch, 'bodyOrientation')
        const hasHeadOrientation = Object.prototype.hasOwnProperty.call(typedPatch, 'headOrientation')
        const hasBodyEndCapOrientation = Object.prototype.hasOwnProperty.call(typedPatch, 'bodyEndCapOrientation')
        const hasHeadEndCapOrientation = Object.prototype.hasOwnProperty.call(typedPatch, 'headEndCapOrientation')
        const hasSmoothing = Object.prototype.hasOwnProperty.call(typedPatch, 'smoothing')
        const hasIsAirWall = Object.prototype.hasOwnProperty.call(typedPatch, 'isAirWall')
        const hasCornerModels = Object.prototype.hasOwnProperty.call(typedPatch, 'cornerModels')
        const hasJointTrimMode = Object.prototype.hasOwnProperty.call(typedPatch, 'jointTrimMode')
        const hasJointTrimManual = Object.prototype.hasOwnProperty.call(typedPatch, 'jointTrimManual')

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
          const readOffset = (entry: any, key: 'bodyOffsetLocal' | 'headOffsetLocal'): { x: number; y: number; z: number } => {
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

            const bodyOffsetA = readOffset(entryA, 'bodyOffsetLocal')
            const bodyOffsetB = readOffset(entryB, 'bodyOffsetLocal')
            const headOffsetA = readOffset(entryA, 'headOffsetLocal')
            const headOffsetB = readOffset(entryB, 'headOffsetLocal')

            if ((bodyAssetA ?? null) !== (bodyAssetB ?? null)) {
              return false
            }
            if ((headAssetA ?? null) !== (headAssetB ?? null)) {
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

            if (Math.abs(bodyOffsetA.x - bodyOffsetB.x) > 1e-6 || Math.abs(bodyOffsetA.y - bodyOffsetB.y) > 1e-6 || Math.abs(bodyOffsetA.z - bodyOffsetB.z) > 1e-6) {
              return false
            }
            if (Math.abs(headOffsetA.x - headOffsetB.x) > 1e-6 || Math.abs(headOffsetA.y - headOffsetB.y) > 1e-6 || Math.abs(headOffsetA.z - headOffsetB.z) > 1e-6) {
              return false
            }
          }
          return true
        }

        const merged = clampWallProps({
          height: (typedPatch.height as number | undefined) ?? currentProps.height,
          width: (typedPatch.width as number | undefined) ?? currentProps.width,
          thickness: (typedPatch.thickness as number | undefined) ?? currentProps.thickness,
          smoothing: hasSmoothing
            ? (typedPatch.smoothing as number | undefined)
            : currentProps.smoothing,
          jointTrimMode: hasJointTrimMode
            ? (typedPatch.jointTrimMode as any)
            : currentProps.jointTrimMode,
          jointTrimManual: hasJointTrimManual
            ? (typedPatch.jointTrimManual as any)
            : currentProps.jointTrimManual,
          isAirWall: hasIsAirWall
            ? (typedPatch.isAirWall as boolean | undefined)
            : currentProps.isAirWall,
          bodyAssetId: hasBodyAssetId
            ? (typedPatch.bodyAssetId as string | null | undefined)
            : currentProps.bodyAssetId,
          headAssetId: hasHeadAssetId
            ? (typedPatch.headAssetId as string | null | undefined)
            : currentProps.headAssetId,
          bodyEndCapAssetId: hasBodyEndCapAssetId
            ? (typedPatch.bodyEndCapAssetId as string | null | undefined)
            : currentProps.bodyEndCapAssetId,
          headEndCapAssetId: hasHeadEndCapAssetId
            ? (typedPatch.headEndCapAssetId as string | null | undefined)
            : currentProps.headEndCapAssetId,
          bodyOrientation: hasBodyOrientation
            ? (typedPatch.bodyOrientation as any)
            : currentProps.bodyOrientation,
          headOrientation: hasHeadOrientation
            ? (typedPatch.headOrientation as any)
            : currentProps.headOrientation,
          bodyEndCapOrientation: hasBodyEndCapOrientation
            ? (typedPatch.bodyEndCapOrientation as any)
            : currentProps.bodyEndCapOrientation,
          headEndCapOrientation: hasHeadEndCapOrientation
            ? (typedPatch.headEndCapOrientation as any)
            : currentProps.headEndCapOrientation,
          cornerModels: hasCornerModels
            ? (typedPatch.cornerModels as any)
            : currentProps.cornerModels,
        })

        const unchanged =
          Math.abs(currentProps.height - merged.height) <= 1e-4 &&
          Math.abs(currentProps.width - merged.width) <= 1e-4 &&
          Math.abs(currentProps.thickness - merged.thickness) <= 1e-4 &&
          Math.abs(currentProps.smoothing - merged.smoothing) <= 1e-6 &&
          (currentProps.jointTrimMode ?? 'auto') === (merged.jointTrimMode ?? 'auto') &&
          Math.abs((currentProps.jointTrimManual?.start ?? 0) - (merged.jointTrimManual?.start ?? 0)) <= 1e-6 &&
          Math.abs((currentProps.jointTrimManual?.end ?? 0) - (merged.jointTrimManual?.end ?? 0)) <= 1e-6 &&
          currentProps.isAirWall === merged.isAirWall &&
          (currentProps.bodyAssetId ?? null) === (merged.bodyAssetId ?? null) &&
          (currentProps.headAssetId ?? null) === (merged.headAssetId ?? null) &&
          (currentProps.bodyEndCapAssetId ?? null) === (merged.bodyEndCapAssetId ?? null) &&
          (currentProps.headEndCapAssetId ?? null) === (merged.headEndCapAssetId ?? null) &&
          orientationsEqual(currentProps.bodyOrientation, merged.bodyOrientation) &&
          orientationsEqual(currentProps.headOrientation, merged.headOrientation) &&
          orientationsEqual(currentProps.bodyEndCapOrientation, merged.bodyEndCapOrientation) &&
          orientationsEqual(currentProps.headEndCapOrientation, merged.headEndCapOrientation) &&
          cornerModelsEqual(currentProps.cornerModels, merged.cornerModels)
        if (unchanged) {
          return false
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
          currentProps.textureWidth === merged.textureWidth &&
          currentProps.textureHeight === merged.textureHeight &&
          Math.abs(currentProps.distortionScale - merged.distortionScale) <= 1e-6 &&
          Math.abs(currentProps.size - merged.size) <= 1e-6 &&
          Math.abs(currentProps.flowSpeed - merged.flowSpeed) <= 1e-6 &&
          flowDirectionUnchanged
        if (unchanged) {
          return false
        }
        nextProps = cloneWaterComponentProps(merged)
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
          applyWallComponentPropsToNode(node, nextProps as WallComponentProps)
        } else if (currentType === ROAD_COMPONENT_TYPE) {
          applyRoadComponentPropsToNode(node, nextProps as RoadComponentProps, resolveGroundNodeForHeightSampling(this.nodes))
        } else if (currentType === DISPLAY_BOARD_COMPONENT_TYPE) {
          applyDisplayBoardComponentPropsToNode(node, nextProps as DisplayBoardComponentProps)
        } else if (currentType === FLOOR_COMPONENT_TYPE) {
          floorHelpers.applyFloorComponentPropsToNode(node, nextProps as FloorComponentProps)
        }
      })

      this.queueSceneNodePatch(nodeId, ['components', 'dynamicMesh'])
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
        (id) =>  id !== SKY_NODE_ID && id !== ENVIRONMENT_NODE_ID && !!findNodeById(this.nodes, id),
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
        if (!id || id === GROUND_NODE_ID || id === SKY_NODE_ID || id === ENVIRONMENT_NODE_ID) {
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
        .filter((id) => id !== GROUND_NODE_ID && id !== SKY_NODE_ID && id !== ENVIRONMENT_NODE_ID)
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
        .filter((id) => id !== GROUND_NODE_ID && id !== SKY_NODE_ID && id !== ENVIRONMENT_NODE_ID)
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

      let clipboardMeta: ClipboardMeta | null = null
      try {
        const parsed = JSON.parse(normalized) as unknown
        if (parsed && typeof parsed === 'object' && 'clipboard' in (parsed as any)) {
          const candidate = (parsed as any).clipboard
          if (candidate && typeof candidate === 'object') clipboardMeta = candidate as ClipboardMeta
        }
      } catch {
        // ignore
      }

      let prefab: NodePrefabData | null = null
      try {
        prefab = nodePrefabHelpers.parseNodePrefab(normalized)
      } catch (_error) {
        let parsed: unknown
        try {
          parsed = JSON.parse(normalized)
        } catch {
          return false
        }

        if (!parsed || typeof parsed !== 'object') return false

        const rawNode = parsed as SceneNode
        const groupRoot: SceneNode = rawNode.nodeType === 'Group'
          ? { ...rawNode, groupExpanded: false }
          : {
              id: generateUuid(),
              name: rawNode.name?.trim().length ? `${rawNode.name} Group` : 'Group Root',
              nodeType: 'Group',
              position: createVector(0, 0, 0),
              rotation: createVector(0, 0, 0),
              scale: createVector(1, 1, 1),
              visible: rawNode.visible ?? true,
              locked: false,
              groupExpanded: false,
              children: [rawNode],
            }

        const root = nodePrefabHelpers.prepareNodePrefabRoot(groupRoot, { regenerateIds: false })
        prefab = {
          formatVersion: NODE_PREFAB_FORMAT_VERSION,
          name: normalizePrefabName(rawNode.name ?? 'Clipboard') || 'Clipboard',
          root,
        }
      }

      if (!prefab) return false
      const clipboardSourceIds = (clipboardStore.clipboard?.entries ?? []).map((entry: any) => entry?.sourceId).filter((id: any) => typeof id === 'string') as string[]

      let parentId = typeof targetId === 'string' ? targetId.trim() : ''
      if (!parentId.length) parentId = ''
      let resolvedParentId: string | null = parentId.length ? parentId : null
      if (resolvedParentId === SKY_NODE_ID || resolvedParentId === ENVIRONMENT_NODE_ID) resolvedParentId = null
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
            if (resolvedParentId === SKY_NODE_ID || resolvedParentId === ENVIRONMENT_NODE_ID) resolvedParentId = null
          }

          if (resolvedParentId) {
            const parentNode = findNodeById(this.nodes, resolvedParentId)
            if (!parentNode || parentNode.nodeType !== 'Group' || !allowsChildNodes(parentNode)) resolvedParentId = null
          }
        }
      }

      const runtimeSnapshots = clipboardStore.clipboard?.runtimeSnapshots ?? new Map<string, any>()

      const multiRoot = Boolean(clipboardMeta?.multiRoot)
      const metaPayload = clipboardMeta?.meta ?? null
      const pivotWorld = metaPayload?.pivotWorldPosition
      const rootWorldPosition = metaPayload?.rootWorldPosition

      const requestedPosition = multiRoot
        ? pivotWorld
          ? new Vector3(pivotWorld.x ?? 0, pivotWorld.y ?? 0, pivotWorld.z ?? 0)
          : undefined
        : rootWorldPosition
          ? new Vector3(rootWorldPosition.x ?? 0, rootWorldPosition.y ?? 0, rootWorldPosition.z ?? 0)
          : undefined

      const duplicate = await this.instantiatePrefabData(prefab, {
        runtimeSnapshots,
        position: requestedPosition,
      })
      this.syncComponentSubtree(duplicate)

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
      if (multiRoot && duplicate.nodeType === 'Group' && duplicate.children?.length) {
        const wrapperWorld = composeNodeMatrix(duplicate)
        duplicate.children.forEach((child: SceneNode) => {
          const childWorld = new Matrix4().multiplyMatrices(wrapperWorld, composeNodeMatrix(child))
          applyWorldToParentLocal(child, childWorld, resolvedParentId)
          rootsToInsert.push(child)
        })
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

      this.nodes = workingTree

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
      const baseAssetIndex = cloneAssetIndex(initialAssetIndex)

      const sceneDocument = createSceneDocument(displayName, {
        projectId,
        resourceProviderId: this.resourceProviderId,
        viewportSettings: this.viewportSettings,
        skybox: this.skybox,
        shadowsEnabled: this.shadowsEnabled,
        nodes: baseNodes,
        materials: this.materials,
        selectedNodeId: null,
        selectedNodeIds: [],
        groundSettings,
        assetCatalog: baseAssetCatalog,
        assetIndex: baseAssetIndex,
        packageAssetMap: {},
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
    
    async selectScene(sceneId: string, options: { setLastEdited?: boolean } = {}) {
      // Invalidate any in-flight scene-bound async work as early as possible.
      this.sceneSwitchToken += 1
      if (sceneId === this.currentSceneId) {
        this.isSceneReady = false
        try {
          await this.ensureSceneAssetsReady({ showOverlay: true })
        } finally {
          this.isSceneReady = true
        }
        return true
      }
      const scenesStore = useScenesStore()
      const scene = await scenesStore.loadSceneDocument(sceneId)
      if (!scene) {
        return false
      }

      await hydrateSceneDocumentWithEmbeddedAssets(scene)

      this.nodes.forEach((node) => releaseRuntimeTree(node))

      this.isSceneReady = false
      try {
        await this.ensureSceneAssetsReady({
          nodes: scene.nodes,
          showOverlay: true,
          refreshViewport: false,
        })

        this.applySceneDocumentToState(scene)
      } finally {
        this.isSceneReady = true
      }

      const projectsStore = useProjectsStore()
      const setLastEdited = options.setLastEdited !== false
      if (setLastEdited && projectsStore.activeProjectId && projectsStore.activeProjectId === scene.projectId) {
        await projectsStore.setLastEditedScene(scene.projectId, scene.id)
      }
      return true
    },
    async deleteScene(sceneId: string) {
      const scenesStore = useScenesStore()
      const projectsStore = useProjectsStore()
      const target = await scenesStore.loadSceneDocument(sceneId)
      if (!target) {
        return false
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
        const fallbackId = await this.createScene('Untitled Scene', {
          groundSettings: this.groundSettings,
        })
        if (this.currentSceneId !== fallbackId) {
          await this.selectScene(fallbackId)
        }
        return true
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

      return true
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

        const sceneDocument = createSceneDocument(uniqueName, {
          nodes: entry.nodes as SceneNode[],
          projectId,
          selectedNodeId: typeof entry.selectedNodeId === 'string' ? entry.selectedNodeId : null,
          selectedNodeIds: Array.isArray(entry.selectedNodeIds)
            ? (entry.selectedNodeIds as unknown[]).filter((id): id is string => typeof id === 'string')
            : undefined,
          camera: normalizeCameraStateInput(entry.camera),
          resourceProviderId: typeof entry.resourceProviderId === 'string' ? entry.resourceProviderId : undefined,
          createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : undefined,
          updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : undefined,
          assetCatalog: isAssetCatalog(entry.assetCatalog)
            ? (entry.assetCatalog as Record<string, ProjectAsset[]>)
            : undefined,
          assetIndex: isAssetIndex(entry.assetIndex)
            ? (entry.assetIndex as Record<string, AssetIndexEntry>)
            : undefined,
          packageAssetMap: isPackageAssetMap(entry.packageAssetMap)
            ? (entry.packageAssetMap as Record<string, string>)
            : undefined,
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
      const scenesStore = useScenesStore()

      try {
        if (!scenesStore.metadata.length) {
          const fallback = createSceneDocument('Untitled Scene', { resourceProviderId: 'builtin' })
          await scenesStore.saveSceneDocument(fallback)
          await scenesStore.refreshMetadata()
          this.applySceneDocumentToState(fallback)
          await this.refreshRuntimeState({ showOverlay: false, refreshViewport: false })
        } else {
          await this.refreshRuntimeState({ showOverlay: true, refreshViewport: false })
        }
      } finally {
        this.isSceneReady = true
      }
    },
  },
  persist: {
    key: 'scene-store',
    storage: 'indexeddb',
    version: 1,
    pick: [
      'currentSceneId',
      'currentSceneMeta',
      'nodes',
      'planningData',
      'activeDirectoryId',
      'selectedAssetId',
      'viewportSettings',
      'panelVisibility',
      'panelPlacement',
      'projectPanelTreeSize',
      'resourceProviderId',
      'assetCatalog',
      'assetIndex',
      'packageAssetMap',
      'groundSettings',
      'skybox',
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
