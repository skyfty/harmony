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
  type Object3D,
  type Texture,
  type Material,
  type Light,
} from 'three'
import type {
  EnvironmentSettings,
  EnvironmentSettingsPatch,
  EnvironmentBackgroundMode,
  EnvironmentMapMode,
  EnvironmentFogMode,
} from '@/types/environment'
import type {
  AssetIndexEntry,
  AssetSourceMetadata,
  BehaviorComponentProps,
  BehaviorEventType,
  CameraNodeProperties,
  GroundDynamicMesh,
  GroundSettings,
  LightNodeProperties,
  LightNodeType,
  NodeComponentType,
  PlatformDynamicMesh,
  SurfaceDynamicMesh,
  SceneBehavior,
  SceneDynamicMesh,
  SceneNode,
  SceneNodeComponentMap,
  SceneNodeComponentState,
  SceneNodeEditorFlags,
  SceneNodeType,
  Vector3Like,
  WallDynamicMesh,
} from '@harmony/schema'
import { normalizeLightNodeType } from '@/types/light'
import type { ClipboardEntry } from '@/types/clipboard-entry'
import type { NodePrefabData } from '@/types/node-prefab'
import type { DetachResult } from '@/types/detach-result'
import type { DuplicateContext } from '@/types/duplicate-context'
import type { EditorTool } from '@/types/editor-tool'
import type { EnsureSceneAssetsOptions } from '@/types/ensure-scene-assets-options'
import type { PanelVisibilityState } from '@/types/panel-visibility-state'
import type { PanelPlacementState, PanelPlacement } from '@/types/panel-placement-state'
import type { HierarchyTreeItem } from '@/types/hierarchy-tree-item'
import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import type { SceneCameraState } from '@/types/scene-camera-state'
import type { SceneHistoryEntry } from '@/types/scene-history-entry'
import type { SceneState } from '@/types/scene-state'
import type { StoredSceneDocument } from '@/types/stored-scene-document'
import type { PresetSceneDocument } from '@/types/preset-scene'
import type { TransformUpdatePayload } from '@/types/transform-update-payload'
import type { SceneViewportSettings } from '@/types/scene-viewport-settings'
import type {
  SceneSkyboxSettings,
  CameraControlMode,
  CameraProjection,
  SceneResourceSummary,
  SceneResourceSummaryEntry,
} from '@harmony/schema'

import { normalizeDynamicMeshType } from '@/types/dynamic-mesh'
import type {
  SceneMaterial,
  SceneMaterialProps,
  SceneMaterialTextureRef,
  SceneMaterialTextureSlot,
  SceneMaterialType,
  SceneNodeMaterial,
} from '@/types/material'

import { cloneTextureSettings } from '@/types/material'
import { DEFAULT_SCENE_MATERIAL_ID, DEFAULT_SCENE_MATERIAL_TYPE } from '@/types/material'
import { behaviorMapToList, cloneBehaviorList, createBehaviorSequenceId } from '@schema/behaviors/definitions'

import {
  CUSTOM_SKYBOX_PRESET_ID,
  DEFAULT_SKYBOX_SETTINGS,
  cloneSkyboxSettings,
  normalizeSkyboxSettings,
  resolveSkyboxPreset,
} from '@/stores/skyboxPresets'
import { useAssetCacheStore } from './assetCacheStore'
import type { AssetCacheEntry } from './assetCacheStore'
import { useUiStore } from './uiStore'
import { useScenesStore, type SceneWorkspaceType } from './scenesStore'
import { loadObjectFromFile } from '@/utils/assetImport'
import { generateUuid } from '@/utils/uuid'
import { getCachedModelObject, getOrLoadModelObject } from './modelObjectCache'
import { createWallGroup, updateWallGroup } from '@/utils/wallMesh'
import { createSurfaceMesh } from '@/utils/surfaceMesh'
import { computeBlobHash, blobToDataUrl, dataUrlToBlob, inferBlobFilename, extractExtension, ensureExtension } from '@/utils/blob'
import {
  buildBehaviorPrefabFilename,
  createBehaviorPrefabData,
  deserializeBehaviorPrefab,
  instantiateBehaviorPrefab,
  serializeBehaviorPrefab,
  type BehaviorPrefabData,
} from '@/utils/behaviorPrefab'
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
import type {
  DisplayBoardComponentProps,
  EffectComponentProps,
  GuideboardComponentProps,
  ViewPointComponentProps,
  WallComponentProps,
  WarpGateComponentProps,
} from '@schema/components'
import {
  WALL_COMPONENT_TYPE,
  GUIDEBOARD_COMPONENT_TYPE,
  VIEW_POINT_COMPONENT_TYPE,
  WARP_GATE_COMPONENT_TYPE,
  DISPLAY_BOARD_COMPONENT_TYPE,
  EFFECT_COMPONENT_TYPE,
  BEHAVIOR_COMPONENT_TYPE,
  WALL_DEFAULT_HEIGHT,
  WALL_DEFAULT_THICKNESS,
  WALL_DEFAULT_WIDTH,
  WALL_MIN_HEIGHT,
  WALL_MIN_THICKNESS,
  WALL_MIN_WIDTH,
  clampWallProps,
  cloneWallComponentProps,
  clampGuideboardComponentProps,
  cloneGuideboardComponentProps,
  createGuideboardComponentState,
  clampDisplayBoardComponentProps,
  cloneDisplayBoardComponentProps,
  createDisplayBoardComponentState,
  clampViewPointComponentProps,
  cloneViewPointComponentProps,
  createViewPointComponentState,
  clampWarpGateComponentProps,
  cloneWarpGateComponentProps,
  createWarpGateComponentState,
  clampEffectComponentProps,
  cloneEffectComponentProps,
  componentManager,
  resolveWallComponentPropsFromMesh,
} from '@schema/components'

export { ASSETS_ROOT_DIRECTORY_ID, buildPackageDirectoryId, extractProviderIdFromPackageDirectoryId } from './assetCatalog'

export type EditorPanel = 'hierarchy' | 'inspector' | 'project'

export type HierarchyDropPosition = 'before' | 'after' | 'inside'

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

const LOCAL_EMBEDDED_ASSET_PREFIX = 'local::'

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
const BEHAVIOR_PREFAB_PREVIEW_COLOR = '#4DB6AC'
const NODE_PREFAB_FORMAT_VERSION = 1
const NODE_PREFAB_PREVIEW_COLOR = '#7986CB'
const PREFAB_PLACEMENT_EPSILON = 1e-3

export const PREFAB_SOURCE_METADATA_KEY = '__prefabAssetId'
export const GROUND_NODE_ID = 'harmony:ground'
export const SKY_NODE_ID = 'harmony:sky'
export const ENVIRONMENT_NODE_ID = 'harmony:environment'


const DEFAULT_WALL_HEIGHT = WALL_DEFAULT_HEIGHT
const DEFAULT_WALL_WIDTH = WALL_DEFAULT_WIDTH
const DEFAULT_WALL_THICKNESS = WALL_DEFAULT_THICKNESS
const MIN_WALL_HEIGHT = WALL_MIN_HEIGHT
const MIN_WALL_WIDTH = WALL_MIN_WIDTH
const MIN_WALL_THICKNESS = WALL_MIN_THICKNESS

const GRID_CELL_SIZE = 1
const CAMERA_NEAR = 0.1
const CAMERA_FAR = 500
const CAMERA_DISTANCE_EPSILON = 1e-6
const MAX_SPAWN_ATTEMPTS = 64
const COLLISION_MARGIN = 0.35
const DEFAULT_SPAWN_RADIUS = GRID_CELL_SIZE * 0.75
const GROUND_CONTACT_EPSILON = 1e-4
const DEFAULT_GROUND_EXTENT = 100
const MIN_GROUND_EXTENT = 1
const MAX_GROUND_EXTENT = 20000
const DEFAULT_GROUND_CELL_SIZE = GRID_CELL_SIZE
const SEMI_TRANSPARENT_OPACITY = 0.35
const HEIGHT_EPSILON = 1e-5
const WALL_DIMENSION_EPSILON = 1e-4

declare module '@/types/scene-state' {
  interface SceneState {
    panelPlacement: PanelPlacementState
    workspaceId: string
    workspaceType: SceneWorkspaceType
    workspaceLabel: string
  }
}
const OPACITY_EPSILON = 1e-3

let workspaceScopeStopHandle: WatchStopHandle | null = null

const MATERIAL_TEXTURE_SLOTS: SceneMaterialTextureSlot[] = ['albedo', 'normal', 'metalness', 'roughness', 'ao', 'emissive', 'displacement']

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
  const type = node.nodeType ?? (node.light ? 'Light' : 'Mesh')
  return sceneNodeTypeSupportsMaterials(type)
}

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

function cloneComponentProps<T>(props: T): T {
  if (props === null || props === undefined) {
    return props
  }
  try {
    return structuredClone(props)
  } catch (_error) {
    return JSON.parse(JSON.stringify(props)) as T
  }
}

function cloneComponentState(state: SceneNodeComponentState<any>, typeOverride?: NodeComponentType): SceneNodeComponentState<any> {
  const resolvedType = (typeOverride ?? state.type) as NodeComponentType
  const resolvedId = typeof state.id === 'string' && state.id.trim().length ? state.id : generateUuid()
  
  // 深度克隆 metadata 以确保可以被 IndexedDB 序列化
  let clonedMetadata: Record<string, unknown> | undefined
  if (state.metadata) {
    try {
      clonedMetadata = structuredClone(state.metadata)
    } catch (_error) {
      // 如果 structuredClone 失败，尝试使用 JSON 序列化
      try {
        clonedMetadata = JSON.parse(JSON.stringify(state.metadata)) as Record<string, unknown>
      } catch (_jsonError) {
        // 如果都失败了，使用浅拷贝作为最后手段
        console.warn('Failed to deeply clone component metadata, using shallow copy', _jsonError)
        clonedMetadata = { ...state.metadata }
      }
    }
  }
  
  return {
    id: resolvedId,
    type: resolvedType,
    enabled: state.enabled ?? true,
    props: cloneComponentProps(state.props),
    metadata: clonedMetadata,
  }
}

function shouldAutoAttachDisplayBoard(node: SceneNode): boolean {
  const userData = node.userData as Record<string, unknown> | undefined
  if (userData) {
    const directFlag = userData['displayBoard'] === true || userData['isDisplayBoard'] === true
    if (directFlag) {
      return true
    }
  }
  const typeName = typeof node.nodeType === 'string' ? node.nodeType.trim().toLowerCase() : ''
  if (typeName === 'displayboard') {
    return true
  }
  const nodeName = typeof node.name === 'string' ? node.name.trim() : ''
  if (nodeName.length && DISPLAY_BOARD_NAME_PATTERN.test(nodeName)) {
    return true
  }
  return false
}

function normalizeNodeComponents(
  node: SceneNode,
  components?: SceneNodeComponentMap,
  options: {
    attachDisplayBoard?: boolean
    attachGuideboard?: boolean
    attachViewPoint?: boolean
    attachWarpGate?: boolean
    viewPointOverrides?: Partial<ViewPointComponentProps>
  } = {},
): SceneNodeComponentMap | undefined {
  const normalized: SceneNodeComponentMap = {}

  if (components) {
    Object.entries(components).forEach(([rawType, state]) => {
      if (!state) {
        return
      }
      const type = (state.type ?? rawType) as NodeComponentType
      normalized[type] = cloneComponentState(state, type)
    })
  }

  if (node.dynamicMesh?.type === 'Wall') {
    const baseProps = resolveWallComponentPropsFromMesh(node.dynamicMesh as WallDynamicMesh)
    const existing = normalized[WALL_COMPONENT_TYPE]
    const nextProps = cloneWallComponentProps(
      clampWallProps({
        height: (existing?.props as { height?: number })?.height ?? baseProps.height,
        width: (existing?.props as { width?: number })?.width ?? baseProps.width,
        thickness: (existing?.props as { thickness?: number })?.thickness ?? baseProps.thickness,
      }),
    )

    // 深度克隆 metadata 以确保可以被 IndexedDB 序列化
    let clonedMetadata: Record<string, unknown> | undefined
    if (existing?.metadata) {
      try {
        clonedMetadata = structuredClone(existing.metadata)
      } catch (_error) {
        try {
          clonedMetadata = JSON.parse(JSON.stringify(existing.metadata)) as Record<string, unknown>
        } catch (_jsonError) {
          console.warn('Failed to deeply clone wall component metadata, using shallow copy', _jsonError)
          clonedMetadata = { ...existing.metadata }
        }
      }
    }

    normalized[WALL_COMPONENT_TYPE] = {
      id: existing?.id && existing.id.trim().length ? existing.id : generateUuid(),
      type: WALL_COMPONENT_TYPE,
      enabled: existing?.enabled ?? true,
      props: nextProps,
      metadata: clonedMetadata,
    }
  }

  const existingDisplayBoard = normalized[DISPLAY_BOARD_COMPONENT_TYPE] as
    | SceneNodeComponentState<DisplayBoardComponentProps>
    | undefined
  const shouldAttachDisplayBoard = options.attachDisplayBoard ?? shouldAutoAttachDisplayBoard(node)
  if (existingDisplayBoard) {
    const nextProps = cloneDisplayBoardComponentProps(
      clampDisplayBoardComponentProps(existingDisplayBoard.props as Partial<DisplayBoardComponentProps>),
    )

    let clonedMetadata: Record<string, unknown> | undefined
    if (existingDisplayBoard.metadata) {
      try {
        clonedMetadata = structuredClone(existingDisplayBoard.metadata)
      } catch (_error) {
        try {
          clonedMetadata = JSON.parse(JSON.stringify(existingDisplayBoard.metadata)) as Record<string, unknown>
        } catch (_jsonError) {
          console.warn('Failed to deeply clone display board component metadata, using shallow copy', _jsonError)
          clonedMetadata = { ...existingDisplayBoard.metadata }
        }
      }
    }

    normalized[DISPLAY_BOARD_COMPONENT_TYPE] = {
      id: existingDisplayBoard.id && existingDisplayBoard.id.trim().length ? existingDisplayBoard.id : generateUuid(),
      type: DISPLAY_BOARD_COMPONENT_TYPE,
      enabled: existingDisplayBoard.enabled ?? true,
      props: nextProps,
      metadata: clonedMetadata,
    }
  } else if (shouldAttachDisplayBoard) {
    normalized[DISPLAY_BOARD_COMPONENT_TYPE] = {
      ...createDisplayBoardComponentState(node, undefined, { id: generateUuid(), enabled: true }),
    }
  }

  const existingGuideboard = normalized[GUIDEBOARD_COMPONENT_TYPE] as
    | SceneNodeComponentState<GuideboardComponentProps>
    | undefined
  if (existingGuideboard) {
    const nextProps = cloneGuideboardComponentProps(
      clampGuideboardComponentProps(existingGuideboard.props as Partial<GuideboardComponentProps>),
    )

    let clonedMetadata: Record<string, unknown> | undefined
    if (existingGuideboard.metadata) {
      try {
        clonedMetadata = structuredClone(existingGuideboard.metadata)
      } catch (_error) {
        try {
          clonedMetadata = JSON.parse(JSON.stringify(existingGuideboard.metadata)) as Record<string, unknown>
        } catch (_jsonError) {
          console.warn('Failed to deeply clone guideboard component metadata, using shallow copy', _jsonError)
          clonedMetadata = { ...existingGuideboard.metadata }
        }
      }
    }

    normalized[GUIDEBOARD_COMPONENT_TYPE] = {
      id: existingGuideboard.id && existingGuideboard.id.trim().length ? existingGuideboard.id : generateUuid(),
      type: GUIDEBOARD_COMPONENT_TYPE,
      enabled: existingGuideboard.enabled ?? true,
      props: nextProps,
      metadata: clonedMetadata,
    }
  } else if (options.attachGuideboard) {
    normalized[GUIDEBOARD_COMPONENT_TYPE] = {
      ...createGuideboardComponentState(node, undefined, { id: generateUuid(), enabled: true }),
    }
  }

  const existingViewPoint = normalized[VIEW_POINT_COMPONENT_TYPE] as
    | SceneNodeComponentState<ViewPointComponentProps>
    | undefined
  if (existingViewPoint) {
    const nextProps = cloneViewPointComponentProps(
      clampViewPointComponentProps(existingViewPoint.props as Partial<ViewPointComponentProps>),
    )

    let clonedMetadata: Record<string, unknown> | undefined
    if (existingViewPoint.metadata) {
      try {
        clonedMetadata = structuredClone(existingViewPoint.metadata)
      } catch (_error) {
        try {
          clonedMetadata = JSON.parse(JSON.stringify(existingViewPoint.metadata)) as Record<string, unknown>
        } catch (_jsonError) {
          console.warn('Failed to deeply clone view point component metadata, using shallow copy', _jsonError)
          clonedMetadata = { ...existingViewPoint.metadata }
        }
      }
    }

    normalized[VIEW_POINT_COMPONENT_TYPE] = {
      id: existingViewPoint.id && existingViewPoint.id.trim().length ? existingViewPoint.id : generateUuid(),
      type: VIEW_POINT_COMPONENT_TYPE,
      enabled: existingViewPoint.enabled ?? true,
      props: nextProps,
      metadata: clonedMetadata,
    }
  } else if (options.attachViewPoint) {
    normalized[VIEW_POINT_COMPONENT_TYPE] = {
      ...createViewPointComponentState(node, options.viewPointOverrides, { id: generateUuid(), enabled: true }),
    }
  }

  const existingWarpGate = normalized[WARP_GATE_COMPONENT_TYPE] as
    | SceneNodeComponentState<WarpGateComponentProps>
    | undefined
  if (existingWarpGate) {
    const nextProps = cloneWarpGateComponentProps(
      clampWarpGateComponentProps(existingWarpGate.props as Partial<WarpGateComponentProps>),
    )

    let clonedMetadata: Record<string, unknown> | undefined
    if (existingWarpGate.metadata) {
      try {
        clonedMetadata = structuredClone(existingWarpGate.metadata)
      } catch (_error) {
        try {
          clonedMetadata = JSON.parse(JSON.stringify(existingWarpGate.metadata)) as Record<string, unknown>
        } catch (_jsonError) {
          console.warn('Failed to deeply clone warp gate component metadata, using shallow copy', _jsonError)
          clonedMetadata = { ...existingWarpGate.metadata }
        }
      }
    }

    normalized[WARP_GATE_COMPONENT_TYPE] = {
      id: existingWarpGate.id && existingWarpGate.id.trim().length ? existingWarpGate.id : generateUuid(),
      type: WARP_GATE_COMPONENT_TYPE,
      enabled: existingWarpGate.enabled ?? true,
      props: nextProps,
      metadata: clonedMetadata,
    }
  } else if (options.attachWarpGate) {
    normalized[WARP_GATE_COMPONENT_TYPE] = {
      ...createWarpGateComponentState(node, undefined, { id: generateUuid(), enabled: true }),
    }
  }

  const existingEffect = normalized[EFFECT_COMPONENT_TYPE] as
    | SceneNodeComponentState<EffectComponentProps>
    | undefined
  if (existingEffect) {
    const nextProps = cloneEffectComponentProps(
      clampEffectComponentProps(existingEffect.props as Partial<EffectComponentProps>),
    )

    let clonedMetadata: Record<string, unknown> | undefined
    if (existingEffect.metadata) {
      try {
        clonedMetadata = structuredClone(existingEffect.metadata)
      } catch (_error) {
        try {
          clonedMetadata = JSON.parse(JSON.stringify(existingEffect.metadata)) as Record<string, unknown>
        } catch (_jsonError) {
          console.warn('Failed to deeply clone effect component metadata, using shallow copy', _jsonError)
          clonedMetadata = { ...existingEffect.metadata }
        }
      }
    }

    normalized[EFFECT_COMPONENT_TYPE] = {
      id: existingEffect.id && existingEffect.id.trim().length ? existingEffect.id : generateUuid(),
      type: EFFECT_COMPONENT_TYPE,
      enabled: existingEffect.enabled ?? true,
      props: nextProps,
      metadata: clonedMetadata,
    }
  }

  return Object.keys(normalized).length ? normalized : undefined
}

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

function extractBehaviorList(
  component: SceneNodeComponentState<BehaviorComponentProps> | undefined,
): SceneBehavior[] {
  if (!component) {
    return []
  }
  const props = component.props as BehaviorComponentProps | undefined
  const behaviors = props?.behaviors
  if (Array.isArray(behaviors)) {
    return cloneBehaviorList(behaviors)
  }
  return cloneBehaviorList(behaviorMapToList(behaviors))
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

function cloneGroundDynamicMesh(definition: GroundDynamicMesh): GroundDynamicMesh {
  return {
    type: 'Ground',
    width: definition.width,
    depth: definition.depth,
    rows: definition.rows,
    columns: definition.columns,
    cellSize: definition.cellSize,
    heightMap: { ...(definition.heightMap ?? {}) },
    textureDataUrl: definition.textureDataUrl ?? null,
    textureName: definition.textureName ?? null,
  }
}

function normalizeGroundDimension(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseFloat(value)
      : Number.NaN
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  if (numeric >= MAX_GROUND_EXTENT) {
    return MAX_GROUND_EXTENT
  }
  if (numeric <= MIN_GROUND_EXTENT) {
    return MIN_GROUND_EXTENT
  }
  return numeric
}

function normalizeGroundSettings(settings?: Partial<GroundSettings> | null): GroundSettings {
  return {
    width: normalizeGroundDimension(settings?.width, DEFAULT_GROUND_EXTENT),
    depth: normalizeGroundDimension(settings?.depth, DEFAULT_GROUND_EXTENT),
  }
}

function cloneGroundSettings(settings: Partial<GroundSettings> | null | undefined): GroundSettings {
  return normalizeGroundSettings(settings ?? null)
}

type WallWorldSegment = {
  start: Vector3
  end: Vector3
}

function normalizeWallDimensions(values: { height?: number; width?: number; thickness?: number }): {
  height: number
  width: number
  thickness: number
} {
  const height = Number.isFinite(values.height) ? Math.max(MIN_WALL_HEIGHT, values.height!) : DEFAULT_WALL_HEIGHT
  const width = Number.isFinite(values.width) ? Math.max(MIN_WALL_WIDTH, values.width!) : DEFAULT_WALL_WIDTH
  const thickness = Number.isFinite(values.thickness) ? Math.max(MIN_WALL_THICKNESS, values.thickness!) : DEFAULT_WALL_THICKNESS
  return { height, width, thickness }
}

function buildWallWorldSegments(segments: Array<{ start: Vector3Like; end: Vector3Like }>): WallWorldSegment[] {
  return segments
    .map((segment) => {
      if (!segment?.start || !segment?.end) {
        return null
      }
      const start = new Vector3(segment.start.x, segment.start.y, segment.start.z)
      const end = new Vector3(segment.end.x, segment.end.y, segment.end.z)
      if (!Number.isFinite(start.x) || !Number.isFinite(start.y) || !Number.isFinite(start.z)) {
        return null
      }
      if (!Number.isFinite(end.x) || !Number.isFinite(end.y) || !Number.isFinite(end.z)) {
        return null
      }
      if (start.distanceToSquared(end) <= 1e-10) {
        return null
      }
      return { start, end }
    })
    .filter((entry): entry is WallWorldSegment => !!entry)
}

function computeWallCenter(segments: WallWorldSegment[]): Vector3 {
  const min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
  const max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)

  segments.forEach(({ start, end }) => {
    min.x = Math.min(min.x, start.x, end.x)
    min.y = Math.min(min.y, start.y, end.y)
    min.z = Math.min(min.z, start.z, end.z)
    max.x = Math.max(max.x, start.x, end.x)
    max.y = Math.max(max.y, start.y, end.y)
    max.z = Math.max(max.z, start.z, end.z)
  })

  if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) {
    return new Vector3(0, 0, 0)
  }

  return new Vector3(
    (min.x + max.x) * 0.5,
    (min.y + max.y) * 0.5,
    (min.z + max.z) * 0.5,
  )
}

function buildWallDynamicMeshFromWorldSegments(
  segments: Array<{ start: Vector3Like; end: Vector3Like }>,
  dimensions: { height?: number; width?: number; thickness?: number } = {},
): { center: Vector3; definition: WallDynamicMesh } | null {
  const worldSegments = buildWallWorldSegments(segments)
  if (!worldSegments.length) {
    return null
  }

  const { height, width, thickness } = normalizeWallDimensions(dimensions)
  const center = computeWallCenter(worldSegments)

  const dynamicSegments = worldSegments.map(({ start, end }) => ({
    start: createVector(start.x - center.x, start.y - center.y, start.z - center.z),
    end: createVector(end.x - center.x, end.y - center.y, end.z - center.z),
    height,
    width,
    thickness,
  }))

  const definition: WallDynamicMesh = {
    type: 'Wall',
    segments: dynamicSegments,
  }

  return { center, definition }
}

const SURFACE_POINT_MIN_DISTANCE = 1e-3

function buildSurfaceDynamicMeshFromWorldPoints(points: Vector3Like[]): { center: Vector3; definition: SurfaceDynamicMesh } | null {
  if (!Array.isArray(points) || points.length < 3) {
    return null
  }

  const sanitized: Vector3[] = []
  const minDistanceSq = SURFACE_POINT_MIN_DISTANCE * SURFACE_POINT_MIN_DISTANCE
  points.forEach((point) => {
    if (!point) {
      return
    }
    const vec = createVector(
      Number.isFinite(point.x) ? point.x : 0,
      Number.isFinite(point.y) ? point.y : 0,
      Number.isFinite(point.z) ? point.z : 0,
    )
    const previous = sanitized[sanitized.length - 1] ?? null
    if (previous && previous.distanceToSquared(vec) <= minDistanceSq) {
      return
    }
    sanitized.push(vec)
  })

  if (sanitized.length >= 2) {
    const first = sanitized[0] ?? null
    const last = sanitized[sanitized.length - 1] ?? null
    if (first && last && first.distanceToSquared(last) <= minDistanceSq) {
      sanitized.pop()
    }
  }

  if (sanitized.length < 3) {
    return null
  }

  let twiceArea = 0
  for (let index = 0; index < sanitized.length; index += 1) {
    const current = sanitized[index]!
    const next = sanitized[(index + 1) % sanitized.length]!
    twiceArea += current.x * next.z - next.x * current.z
  }

  if (Math.abs(twiceArea) <= 1e-4) {
    return null
  }

  if (twiceArea < 0) {
    sanitized.reverse()
    twiceArea *= -1
  }

  const first = sanitized[0]!
  const second = sanitized[1]!
  const third = sanitized[2]!
  const edgeA = second.clone().sub(first)
  const edgeB = third.clone().sub(first)
  const normal = new Vector3().crossVectors(edgeA, edgeB)
  if (normal.lengthSq() <= 1e-6) {
    return null
  }
  normal.normalize()
  if (normal.y < 0) {
    normal.multiplyScalar(-1)
  }

  const center = new Vector3()
  sanitized.forEach((vector) => {
    center.add(vector)
  })
  center.multiplyScalar(1 / sanitized.length)

  const localPoints = sanitized.map<Vector3Like>((vector) => ({
    x: vector.x - center.x,
    y: vector.y - center.y,
    z: vector.z - center.z,
  }))

  const definition: SurfaceDynamicMesh = {
    type: 'Surface',
    points: localPoints.map(cloneDynamicMeshVector3),
    normal: cloneDynamicMeshVector3({ x: normal.x, y: normal.y, z: normal.z }),
  }

  return { center, definition }
}

function applyDisplayBoardComponentPropsToNode(
  node: SceneNode,
  props: DisplayBoardComponentProps,
): boolean {
  const runtime = getRuntimeObject(node.id)
  if (!runtime) {
    return false
  }

  const mesh = findDisplayBoardPlaneMesh(runtime)
  if (!mesh) {
    return false
  }

  const normalized = clampDisplayBoardComponentProps(props)
  const mediaSize = resolveDisplayBoardMediaSize(normalized, mesh)
  const targetSize = computeDisplayBoardPlaneSize(mesh, normalized, mediaSize)
  if (!targetSize) {
    return false
  }

  const currentSize = extractPlaneGeometrySize(mesh.geometry)
  if (
    currentSize &&
    Math.abs(currentSize.width - targetSize.width) < DISPLAY_BOARD_GEOMETRY_EPSILON &&
    Math.abs(currentSize.height - targetSize.height) < DISPLAY_BOARD_GEOMETRY_EPSILON
  ) {
    return false
  }

  const { widthSegments, heightSegments } = resolvePlaneGeometrySegments(mesh.geometry)
  const nextGeometry = new THREE.PlaneGeometry(
    targetSize.width,
    targetSize.height,
    widthSegments,
    heightSegments,
  )
  const previous = mesh.geometry
  mesh.geometry = nextGeometry
  previous?.dispose?.()
  return true
}

function refreshDisplayBoardGeometry(node: SceneNode | null | undefined): void {
  if (!node) {
    return
  }
  const componentState = node.components?.[DISPLAY_BOARD_COMPONENT_TYPE] as
    | SceneNodeComponentState<DisplayBoardComponentProps>
    | undefined
  if (!componentState || componentState.enabled === false) {
    return
  }
  applyDisplayBoardComponentPropsToNode(node, componentState.props as DisplayBoardComponentProps)
}

const DISPLAY_BOARD_GEOMETRY_EPSILON = 1e-4

type DisplayBoardPlaneMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>

function findDisplayBoardPlaneMesh(root: Object3D): DisplayBoardPlaneMesh | null {
  const stack: Object3D[] = [root]
  while (stack.length) {
    const current = stack.pop()
    if (!current) {
      continue
    }
    if ((current as THREE.Mesh).isMesh) {
      const mesh = current as DisplayBoardPlaneMesh
      if (isPlaneGeometry(mesh.geometry)) {
        return mesh
      }
    }
    if (current.children?.length) {
      stack.push(...current.children)
    }
  }
  return null
}

function resolveDisplayBoardMediaSize(
  props: DisplayBoardComponentProps,
  mesh: DisplayBoardPlaneMesh,
): { width: number; height: number } | null {
  const width = typeof props.intrinsicWidth === 'number' && props.intrinsicWidth > 0 ? props.intrinsicWidth : null
  const height = typeof props.intrinsicHeight === 'number' && props.intrinsicHeight > 0 ? props.intrinsicHeight : null
  if (width && height) {
    return { width, height }
  }

  const texture = extractPrimaryTexture(mesh.material)
  if (!texture || !texture.image) {
    return null
  }

  const image = texture.image as {
    width?: number
    height?: number
    naturalWidth?: number
    naturalHeight?: number
    videoWidth?: number
    videoHeight?: number
  }
  const inferredWidth = image?.naturalWidth ?? image?.videoWidth ?? image?.width ?? 0
  const inferredHeight = image?.naturalHeight ?? image?.videoHeight ?? image?.height ?? 0
  if (inferredWidth > 0 && inferredHeight > 0) {
    return { width: inferredWidth, height: inferredHeight }
  }

  return null
}

function computeDisplayBoardPlaneSize(
  mesh: DisplayBoardPlaneMesh,
  props: DisplayBoardComponentProps,
  mediaSize: { width: number; height: number } | null,
): { width: number; height: number } | null {
  const { maxWidth, maxHeight } = resolveDisplayBoardScaleLimits(mesh)
  const boardSize = {
    width: Math.max(maxWidth, 1e-3),
    height: Math.max(maxHeight, 1e-3),
  }
  const hasAsset = typeof props.assetId === 'string' && props.assetId.trim().length > 0
  if (!hasAsset) {
    return convertWorldSizeToGeometry(mesh, boardSize)
  }

  const adaptation = props.adaptation === 'fill' ? 'fill' : 'fit'
  if (adaptation === 'fill') {
    return convertWorldSizeToGeometry(mesh, boardSize)
  }

  const source = selectDisplayBoardMediaSize(props, mediaSize)
  if (!source) {
    const fallback = Math.max(Math.min(boardSize.width, boardSize.height), 1e-3)
    return convertWorldSizeToGeometry(mesh, { width: fallback, height: fallback })
  }

  const fitted = fitDisplayBoardMediaWithinLimits({ maxWidth, maxHeight }, source)
  return convertWorldSizeToGeometry(mesh, fitted)
}

function selectDisplayBoardMediaSize(
  props: DisplayBoardComponentProps,
  mediaSize: { width: number; height: number } | null,
): { width: number; height: number } | null {
  if (mediaSize && mediaSize.width > 0 && mediaSize.height > 0) {
    return mediaSize
  }
  const intrinsicWidth = typeof props.intrinsicWidth === 'number' && props.intrinsicWidth > 0 ? props.intrinsicWidth : null
  const intrinsicHeight =
    typeof props.intrinsicHeight === 'number' && props.intrinsicHeight > 0 ? props.intrinsicHeight : null
  if (!intrinsicWidth || !intrinsicHeight) {
    return null
  }
  return { width: intrinsicWidth, height: intrinsicHeight }
}

function fitDisplayBoardMediaWithinLimits(
  limits: { maxWidth: number; maxHeight: number },
  mediaSize: { width: number; height: number },
): { width: number; height: number } {
  const maxWidth = Math.max(limits.maxWidth, 1e-3)
  const maxHeight = Math.max(limits.maxHeight, 1e-3)
  const aspect = mediaSize.width / Math.max(mediaSize.height, 1e-6)

  let width = maxWidth
  let height = width / Math.max(aspect, 1e-6)

  if (height > maxHeight) {
    height = maxHeight
    width = height * aspect
  }

  return {
    width: Math.max(width, 1e-3),
    height: Math.max(height, 1e-3),
  }
}

function resolveDisplayBoardScaleLimits(mesh: DisplayBoardPlaneMesh): { maxWidth: number; maxHeight: number } {
  return {
    maxWidth: resolveScaleComponent(mesh.scale.x),
    maxHeight: resolveScaleComponent(mesh.scale.y),
  }
}

function resolveScaleComponent(candidate: number): number {
  const magnitude = Math.abs(candidate)
  return magnitude > 1e-3 ? magnitude : 1e-3
}

function convertWorldSizeToGeometry(
  mesh: DisplayBoardPlaneMesh,
  worldSize: { width: number; height: number },
): { width: number; height: number } {
  const scaleX = resolveScaleComponent(mesh.scale.x)
  const scaleY = resolveScaleComponent(mesh.scale.y)
  return {
    width: worldSize.width / scaleX,
    height: worldSize.height / scaleY,
  }
}

function extractPlaneGeometrySize(geometry: THREE.BufferGeometry): { width: number; height: number } | null {
  const parameters = (geometry as unknown as { parameters?: { width?: number; height?: number } }).parameters
  if (Number.isFinite(parameters?.width) && Number.isFinite(parameters?.height)) {
    return { width: parameters!.width!, height: parameters!.height! }
  }

  if (!geometry.boundingBox) {
    geometry.computeBoundingBox()
  }
  const box = geometry.boundingBox
  if (!box) {
    return null
  }

  const width = box.max.x - box.min.x
  const height = box.max.y - box.min.y
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null
  }

  return { width: Math.abs(width), height: Math.abs(height) }
}

function resolvePlaneGeometrySegments(geometry: THREE.BufferGeometry): { widthSegments: number; heightSegments: number } {
  const parameters = (geometry as unknown as { parameters?: { widthSegments?: number; heightSegments?: number } }).parameters
  const widthSegments = Number.isFinite(parameters?.widthSegments)
    ? Math.max(1, parameters!.widthSegments!)
    : 1
  const heightSegments = Number.isFinite(parameters?.heightSegments)
    ? Math.max(1, parameters!.heightSegments!)
    : 1
  return { widthSegments, heightSegments }
}

function isPlaneGeometry(geometry: THREE.BufferGeometry): geometry is THREE.PlaneGeometry {
  return geometry instanceof THREE.PlaneGeometry || geometry.type === 'PlaneGeometry'
}

function extractPrimaryTexture(material: THREE.Material | THREE.Material[]): THREE.Texture | null {
  const materials = Array.isArray(material) ? material : [material]
  for (const candidate of materials) {
    if (!candidate) {
      continue
    }
    const typed = candidate as THREE.Material & { map?: THREE.Texture | null }
    if (typed.map) {
      return typed.map
    }
  }
  return null
}

function applyWallComponentPropsToNode(node: SceneNode, props: WallComponentProps): boolean {
  if (node.dynamicMesh?.type !== 'Wall' || !node.dynamicMesh.segments.length) {
    return false
  }

  const normalized = clampWallProps(props)
  let changed = false
  const nextSegments = node.dynamicMesh.segments.map((segment) => {
    const next = {
      ...segment,
      height: normalized.height,
      width: normalized.width,
      thickness: normalized.thickness,
    }
    if (
      segment.height !== next.height ||
      segment.width !== next.width ||
      segment.thickness !== next.thickness
    ) {
      changed = true
    }
    return next
  })

  if (!changed) {
    return false
  }

  node.dynamicMesh = {
    type: 'Wall',
    segments: nextSegments,
  }

  const runtime = getRuntimeObject(node.id)
  if (runtime) {
    updateWallGroup(runtime, node.dynamicMesh)
  }

  return true
}

function cloneDynamicMeshDefinition(mesh?: SceneDynamicMesh): SceneDynamicMesh | undefined {
  if (!mesh) {
    return undefined
  }
  const type = normalizeDynamicMeshType(mesh.type)
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
    case 'Platform': {
      const platformMesh = mesh as PlatformDynamicMesh
      return {
        type: 'Platform',
        footprint: platformMesh.footprint.map(cloneDynamicMeshVector3),
        height: platformMesh.height,
      }
    }
    case 'Surface': {
      const surfaceMesh = mesh as SurfaceDynamicMesh
      const normal = surfaceMesh.normal ? cloneDynamicMeshVector3(surfaceMesh.normal) : cloneDynamicMeshVector3({ x: 0, y: 1, z: 0 })
      return {
        type: 'Surface',
        points: (surfaceMesh.points ?? []).map(cloneDynamicMeshVector3),
        normal,
      }
    }
    default:
      return undefined
  }
}

function createGroundDynamicMeshDefinition(
  overrides: Partial<GroundDynamicMesh> = {},
  settings?: GroundSettings,
): GroundDynamicMesh {
  const baseSettings = normalizeGroundSettings(settings ?? null)
  const cellSize = overrides.cellSize ?? DEFAULT_GROUND_CELL_SIZE
  const normalizedWidth = overrides.width !== undefined
    ? normalizeGroundDimension(overrides.width, baseSettings.width)
    : baseSettings.width
  const normalizedDepth = overrides.depth !== undefined
    ? normalizeGroundDimension(overrides.depth, baseSettings.depth)
    : baseSettings.depth
  const derivedColumns = overrides.columns ?? Math.max(1, Math.round(normalizedWidth / Math.max(cellSize, 1e-6)))
  const derivedRows = overrides.rows ?? Math.max(1, Math.round(normalizedDepth / Math.max(cellSize, 1e-6)))
  const width = overrides.width !== undefined ? normalizedWidth : derivedColumns * cellSize
  const depth = overrides.depth !== undefined ? normalizedDepth : derivedRows * cellSize
  return {
    type: 'Ground',
    width,
    depth,
    rows: derivedRows,
    columns: derivedColumns,
    cellSize,
    heightMap: { ...(overrides.heightMap ?? {}) },
    textureDataUrl: overrides.textureDataUrl ?? null,
    textureName: overrides.textureName ?? null,
  }
}

function createGroundSceneNode(
  overrides: { dynamicMesh?: Partial<GroundDynamicMesh> } = {},
  settings?: GroundSettings,
): SceneNode {
  const dynamicMesh = createGroundDynamicMeshDefinition(overrides.dynamicMesh, settings)
  return {
    id: GROUND_NODE_ID,
    name: 'Ground',
    nodeType: 'Mesh',
    allowChildNodes: false,
    materials: [
      createNodeMaterial(null, createMaterialProps({
        color: '#707070',
        wireframe: false,
        opacity: 1,
        transparent: false,
      }), { name: 'Ground Material' })
    ],
    position: createVector(0, 0, 0),
    rotation: createVector(0, 0, 0),
    scale: createVector(1, 1, 1),
    visible: true,
    locked: true,
    dynamicMesh,
  }
}

function isGroundNode(node: SceneNode): boolean {
  return node.id === GROUND_NODE_ID || node.dynamicMesh?.type === 'Ground'
}

function createSkySceneNode(overrides: { visible?: boolean; userData?: Record<string, unknown> | null } = {}): SceneNode {
  return {
    id: SKY_NODE_ID,
    name: 'Sky',
    nodeType: 'Sky',
    allowChildNodes: false,
    position: createVector(0, 0, 0),
    rotation: createVector(0, 0, 0),
    scale: createVector(1, 1, 1),
    visible: overrides.visible ?? true,
    locked: true,
    editorFlags: { editorOnly: true },
    userData: overrides.userData ?? null,
  }
}

function isSkyNode(node: SceneNode): boolean {
  return node.id === SKY_NODE_ID
}

function normalizeSkySceneNode(node: SceneNode | null | undefined): SceneNode {
  if (!node) {
    return createSkySceneNode()
  }
  const visible = node.visible ?? true
  const userData = clonePlainRecord(node.userData as Record<string, unknown> | null) ?? null
  const normalized = createSkySceneNode({ visible, userData })
  if (node.children?.length) {
    normalized.children = node.children.map(cloneNode)
  }
  return normalized
}

function ensureSkyNode(nodes: SceneNode[]): SceneNode[] {
  let skyNode: SceneNode | null = null
  const others: SceneNode[] = []
  nodes.forEach((node) => {
    if (!skyNode && isSkyNode(node)) {
      skyNode = normalizeSkySceneNode(node)
      return
    }
    if (!isSkyNode(node)) {
      others.push(node)
    }
  })
  if (!skyNode) {
    skyNode = createSkySceneNode()
  }
  const insertIndex = others.findIndex((node) => isGroundNode(node))
  const next = [...others]
  next.splice(insertIndex >= 0 ? insertIndex + 1 : 0, 0, skyNode)
  return next
}

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{6})$/
const DEFAULT_ENVIRONMENT_BACKGROUND_COLOR = '#516175'
const DEFAULT_ENVIRONMENT_AMBIENT_COLOR = '#ffffff'
const DEFAULT_ENVIRONMENT_AMBIENT_INTENSITY = 0.6
const DEFAULT_ENVIRONMENT_FOG_COLOR = '#516175'
const DEFAULT_ENVIRONMENT_FOG_DENSITY = 0.02

const DEFAULT_ENVIRONMENT_SETTINGS: EnvironmentSettings = {
  background: {
    mode: 'skybox',
    solidColor: DEFAULT_ENVIRONMENT_BACKGROUND_COLOR,
    hdriAssetId: null,
  },
  ambientLightColor: DEFAULT_ENVIRONMENT_AMBIENT_COLOR,
  ambientLightIntensity: DEFAULT_ENVIRONMENT_AMBIENT_INTENSITY,
  fogMode: 'none',
  fogColor: DEFAULT_ENVIRONMENT_FOG_COLOR,
  fogDensity: DEFAULT_ENVIRONMENT_FOG_DENSITY,
  environmentMap: {
    mode: 'skybox',
    hdriAssetId: null,
  },
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const sanitized = value.trim()
    if (HEX_COLOR_PATTERN.test(sanitized)) {
      return `#${sanitized.slice(1).toLowerCase()}`
    }
  }
  return fallback
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  if (numeric < min) {
    return min
  }
  if (numeric > max) {
    return max
  }
  return numeric
}

function normalizeAssetId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function cloneEnvironmentSettings(source?: Partial<EnvironmentSettings> | EnvironmentSettings | null): EnvironmentSettings {
  const backgroundSource = source?.background ?? null
  const environmentMapSource = source?.environmentMap ?? null

  let backgroundMode: EnvironmentBackgroundMode = 'skybox'
  if (backgroundSource?.mode === 'hdri') {
    backgroundMode = 'hdri'
  } else if (backgroundSource?.mode === 'solidColor') {
    backgroundMode = 'solidColor'
  }
  const environmentMapMode: EnvironmentMapMode = environmentMapSource?.mode === 'custom' ? 'custom' : 'skybox'
  const fogMode: EnvironmentFogMode = source?.fogMode === 'exp' ? 'exp' : 'none'

  return {
    background: {
      mode: backgroundMode,
      solidColor: normalizeHexColor(backgroundSource?.solidColor, DEFAULT_ENVIRONMENT_BACKGROUND_COLOR),
      hdriAssetId: normalizeAssetId(backgroundSource?.hdriAssetId ?? null),
    },
    ambientLightColor: normalizeHexColor(source?.ambientLightColor, DEFAULT_ENVIRONMENT_AMBIENT_COLOR),
    ambientLightIntensity: clampNumber(source?.ambientLightIntensity, 0, 10, DEFAULT_ENVIRONMENT_AMBIENT_INTENSITY),
    fogMode,
    fogColor: normalizeHexColor(source?.fogColor, DEFAULT_ENVIRONMENT_FOG_COLOR),
    fogDensity: clampNumber(source?.fogDensity, 0, 5, DEFAULT_ENVIRONMENT_FOG_DENSITY),
    environmentMap: {
      mode: environmentMapMode,
      hdriAssetId: normalizeAssetId(environmentMapSource?.hdriAssetId ?? null),
    },
  }
}

function isEnvironmentNode(node: SceneNode): boolean {
  return node.id === ENVIRONMENT_NODE_ID
}

function createEnvironmentSceneNode(
  overrides: { settings?: Partial<EnvironmentSettings> | EnvironmentSettings | null; visible?: boolean } = {},
): SceneNode {
  const settings = cloneEnvironmentSettings(overrides.settings ?? null)
  return {
    id: ENVIRONMENT_NODE_ID,
    name: 'Environment',
    nodeType: 'Environment',
    allowChildNodes: false,
    position: createVector(0, 0, 0),
    rotation: createVector(0, 0, 0),
    scale: createVector(1, 1, 1),
    visible: overrides.visible ?? true,
    locked: true,
    userData: { environment: settings },
  }
}

function normalizeEnvironmentSceneNode(node: SceneNode | null | undefined, override?: EnvironmentSettings): SceneNode {
  if (!node) {
    return createEnvironmentSceneNode({ settings: override })
  }
  const existingSettings = isPlainRecord(node.userData)
    ? ((node.userData as Record<string, unknown>).environment as EnvironmentSettings | null | undefined)
    : null
  const settings = override ? cloneEnvironmentSettings(override) : cloneEnvironmentSettings(existingSettings ?? null)
  const visible = node.visible ?? true
  const normalized = createEnvironmentSceneNode({ settings, visible })
  if (node.children?.length) {
    normalized.children = node.children.map(cloneNode)
  }
  return normalized
}

function ensureEnvironmentNode(nodes: SceneNode[], override?: EnvironmentSettings): SceneNode[] {
  let environment: SceneNode | null = null
  const others: SceneNode[] = []

  nodes.forEach((node) => {
    if (!environment && isEnvironmentNode(node)) {
      environment = normalizeEnvironmentSceneNode(node, override)
      return
    }
    if (!isEnvironmentNode(node)) {
      others.push(node)
    }
  })

  if (!environment) {
    environment = createEnvironmentSceneNode({ settings: override })
  }

  const result = [...others]
  const skyIndex = result.findIndex((node) => isSkyNode(node))
  const groundIndex = result.findIndex((node) => isGroundNode(node))
  const insertIndex = skyIndex >= 0 ? skyIndex + 1 : groundIndex >= 0 ? groundIndex + 1 : 0
  result.splice(insertIndex, 0, environment)
  return result
}

function extractEnvironmentSettings(node: SceneNode | null | undefined): EnvironmentSettings {
  if (!node) {
    return cloneEnvironmentSettings(DEFAULT_ENVIRONMENT_SETTINGS)
  }
  if (!isPlainRecord(node.userData)) {
    return cloneEnvironmentSettings(DEFAULT_ENVIRONMENT_SETTINGS)
  }
  const payload = (node.userData as Record<string, unknown>).environment as EnvironmentSettings | Partial<EnvironmentSettings> | null | undefined
  return cloneEnvironmentSettings(payload ?? DEFAULT_ENVIRONMENT_SETTINGS)
}

function environmentSettingsEqual(a: EnvironmentSettings, b: EnvironmentSettings, epsilon = 1e-4): boolean {
  return (
    a.background.mode === b.background.mode &&
    a.background.solidColor === b.background.solidColor &&
    a.background.hdriAssetId === b.background.hdriAssetId &&
    a.ambientLightColor === b.ambientLightColor &&
    Math.abs(a.ambientLightIntensity - b.ambientLightIntensity) <= epsilon &&
    a.fogMode === b.fogMode &&
    a.fogColor === b.fogColor &&
    Math.abs(a.fogDensity - b.fogDensity) <= epsilon &&
    a.environmentMap.mode === b.environmentMap.mode &&
    a.environmentMap.hdriAssetId === b.environmentMap.hdriAssetId
  )
}

function resolveSceneDocumentEnvironment(scene: StoredSceneDocument): EnvironmentSettings {
  if (scene.environment) {
    return cloneEnvironmentSettings(scene.environment)
  }
  const environmentNode = findNodeById(scene.nodes, ENVIRONMENT_NODE_ID)
  return extractEnvironmentSettings(environmentNode)
}

function normalizeGroundSceneNode(node: SceneNode | null | undefined, settings?: GroundSettings): SceneNode {
  if (!node) {
    return createGroundSceneNode({}, settings)
  }
  if (node.dynamicMesh?.type === 'Ground') {
    const primaryMaterial = getPrimaryNodeMaterial(node)
    const children = node.children?.length ? node.children.map(cloneNode) : undefined
    return {
      ...node,
      id: GROUND_NODE_ID,
      name: 'Ground',
  nodeType: 'Mesh',
      allowChildNodes: false,
      materials: [
        createNodeMaterial(null, createMaterialProps({
          color: primaryMaterial?.color ?? '#707070',
          wireframe: false,
          opacity: 1,
          transparent: false,
        }), { id: primaryMaterial?.id, name: primaryMaterial?.name ?? 'Ground Material', type: primaryMaterial?.type })
      ],
      position: createVector(0, 0, 0),
      rotation: createVector(0, 0, 0),
      scale: createVector(1, 1, 1),
      visible: node.visible ?? true,
      locked: true,
      dynamicMesh: createGroundDynamicMeshDefinition(node.dynamicMesh, settings),
      sourceAssetId: undefined,
      children,
    }
  }
  return createGroundSceneNode({}, settings)
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
  return `${row}:${column}`
}

function normalizeGroundBounds(definition: GroundDynamicMesh, bounds: GroundRegionBounds): GroundRegionBounds {
  const minRow = Math.max(0, Math.min(definition.rows, Math.min(bounds.minRow, bounds.maxRow)))
  const maxRow = Math.max(0, Math.min(definition.rows, Math.max(bounds.minRow, bounds.maxRow)))
  const minColumn = Math.max(0, Math.min(definition.columns, Math.min(bounds.minColumn, bounds.maxColumn)))
  const maxColumn = Math.max(0, Math.min(definition.columns, Math.max(bounds.minColumn, bounds.maxColumn)))
  return { minRow, maxRow, minColumn, maxColumn }
}

function applyGroundRegionTransform(
  definition: GroundDynamicMesh,
  bounds: GroundRegionBounds,
  transform: (current: number, row: number, column: number) => number,
): { definition: GroundDynamicMesh; changed: boolean } {
  const normalized = normalizeGroundBounds(definition, bounds)
  const nextHeightMap = { ...definition.heightMap }
  let changed = false
  for (let row = normalized.minRow; row <= normalized.maxRow; row += 1) {
    for (let column = normalized.minColumn; column <= normalized.maxColumn; column += 1) {
      const key = groundVertexKey(row, column)
      const current = nextHeightMap[key] ?? 0
      const next = transform(current, row, column)
      if (Math.abs(next) <= HEIGHT_EPSILON) {
        if (key in nextHeightMap) {
          delete nextHeightMap[key]
          changed = true
        }
      } else if (Math.abs(next - current) > HEIGHT_EPSILON) {
        nextHeightMap[key] = next
        changed = true
      }
    }
  }
  if (!changed) {
    return { definition, changed: false }
  }
  return {
    definition: {
      ...definition,
      heightMap: nextHeightMap,
    },
    changed: true,
  }
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
  const normalizedType = normalizeLightNodeType(options.type)
  const light: LightNodeProperties = {
    type: normalizedType,
    color: options.color,
    intensity: options.intensity,
    ...(options.extras ?? {}),
  }

  if (options.target) {
    light.target = createVector(options.target.x, options.target.y, options.target.z)
  }

  return {
    id: generateUuid(),
    name: options.name,
    nodeType: 'Light',
    light,
    position: createVector(options.position.x, options.position.y, options.position.z),
    rotation: options.rotation
      ? createVector(options.rotation.x, options.rotation.y, options.rotation.z)
      : createVector(0, 0, 0),
    scale: createVector(1, 1, 1),
    visible: true,
  }
}

function getLightPreset(type: LightNodeType) {
  const normalizedType = normalizeLightNodeType(type)
  switch (normalizedType) {
    case 'Directional':
      return {
        name: 'Directional Light',
        color: '#ffffff',
        intensity: 1.2,
        position: createVector(20, 40, 20),
        target: createVector(0, 0, 0),
        extras: { castShadow: true } as LightNodeExtras,
      }
    case 'Point':
      return {
        name: 'Point Light',
        color: '#ffffff',
        intensity: 1,
        position: createVector(0, 8, 0),
        extras: { distance: 60, decay: 2, castShadow: false } as LightNodeExtras,
      }
    case 'Spot':
      return {
        name: 'Spot Light',
        color: '#ffffff',
        intensity: 1,
        position: createVector(12, 18, 12),
        target: createVector(0, 0, 0),
        extras: { angle: Math.PI / 5, penumbra: 0.35, distance: 80, decay: 2, castShadow: true } as LightNodeExtras,
      }
    case 'Ambient':
    default:
      return {
        name: 'Ambient Light',
        color: '#ffffff',
        intensity: 0.35,
        position: createVector(0, 25, 0),
        extras: {} as LightNodeExtras,
      }
  }
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
  const typed = light as Light & Record<string, unknown>
  if (typed.isDirectionalLight) {
    return 'Directional'
  }
  if (typed.isSpotLight) {
    return 'Spot'
  }
  if (typed.isPointLight || typed.isRectAreaLight) {
    return 'Point'
  }
  return 'Ambient'
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
      console.warn('无法绘制纹理到画布', error)
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
      console.warn('无法序列化纹理数据', error)
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
  }

  context.registerAsset(asset, { categoryId: determineAssetCategoryId(asset) })
  context.assetCache.registerUsage(assetId)

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

function findObjectByPath(root: Object3D, path: number[]): Object3D | null {
  let current: Object3D | undefined = root
  for (const segment of path) {
    if (!current) {
      return null
    }
    const index = Number.isInteger(segment) ? segment : Number.NaN
    if (!Number.isFinite(index) || index < 0 || index >= current.children.length) {
      return null
    }
    current = current.children[index]
  }
  return current ?? null
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
  showGrid: true,
  showAxes: false,
  cameraProjection: 'perspective',
  cameraControlMode: 'orbit',
}

function isCameraProjectionMode(value: unknown): value is CameraProjection {
  return value === 'perspective' || value === 'orthographic'
}

function isCameraControlMode(value: unknown): value is CameraControlMode {
  return value === 'orbit' || value === 'map'
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
  }
}

type LegacyViewportSettings = SceneViewportSettings & {
  skybox?: Partial<SceneSkyboxSettings> | null
  shadowsEnabled?: boolean
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

function resolveDocumentSkybox(document: { skybox?: Partial<SceneSkyboxSettings> | SceneSkyboxSettings | null; viewportSettings?: SceneViewportSettings | LegacyViewportSettings | null }): SceneSkyboxSettings {
  const legacyViewport = document.viewportSettings as LegacyViewportSettings | null | undefined
  const candidate = document.skybox ?? legacyViewport?.skybox ?? null
  return cloneSceneSkybox(candidate)
}

function resolveDocumentShadowsEnabled(document: { shadowsEnabled?: boolean | null; viewportSettings?: SceneViewportSettings | LegacyViewportSettings | null }): boolean {
  const legacyViewport = document.viewportSettings as LegacyViewportSettings | null | undefined
  const candidate = typeof document.shadowsEnabled === 'boolean'
    ? document.shadowsEnabled
    : typeof legacyViewport?.shadowsEnabled === 'boolean'
      ? legacyViewport!.shadowsEnabled
      : undefined
  return normalizeShadowsEnabledInput(candidate)
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
    a.azimuth === b.azimuth
  )
}

function viewportSettingsEqual(a: SceneViewportSettings, b: SceneViewportSettings): boolean {
  return (
    a.showGrid === b.showGrid &&
    a.showAxes === b.showAxes &&
    a.cameraProjection === b.cameraProjection &&
    a.cameraControlMode === b.cameraControlMode
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

function ensureDynamicMeshRuntime(node: SceneNode): boolean {
  const meshDefinition = node.dynamicMesh
  if (!meshDefinition) {
    return false
  }

  const meshType = normalizeDynamicMeshType(meshDefinition.type)
  if (meshType !== 'Wall') {
    return false
  }

  if (getRuntimeObject(node.id)) {
    return false
  }

  try {
    const runtime = createWallGroup(meshDefinition as WallDynamicMesh)
    runtime.name = node.name ?? runtime.name
    prepareRuntimeObjectForNode(runtime)
    tagObjectWithNodeId(runtime, node.id)
    registerRuntimeObject(node.id, runtime)
    componentManager.attachRuntime(node, runtime)
    componentManager.syncNode(node)
    return true
  } catch (error) {
    console.warn('Failed to rebuild wall mesh runtime', node.id, error)
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
  selectedNodeId: GROUND_NODE_ID,
  resourceProviderId: 'builtin',
  assetCatalog: initialAssetCatalog,
  assetIndex: initialAssetIndex,
})

const runtimeObjectRegistry = new Map<string, Object3D>()
let runtimeRefreshInFlight: Promise<void> | null = null

function clearRuntimeObjectRegistry() {
  runtimeObjectRegistry.forEach((_object, nodeId) => {
    componentManager.detachRuntime(nodeId)
  })
  runtimeObjectRegistry.clear()
}

function registerRuntimeObject(id: string, object: Object3D) {
  const existing = runtimeObjectRegistry.get(id)
  if (existing && existing !== object) {
    componentManager.detachRuntime(id)
  }
  runtimeObjectRegistry.set(id, object)
}

function unregisterRuntimeObject(id: string) {
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

function collectNodesByAssetId(nodes: SceneNode[]): Map<string, SceneNode[]> {
  const map = new Map<string, SceneNode[]>()

  const traverse = (list: SceneNode[]) => {
    list.forEach((node) => {
      if (node.sourceAssetId) {
        if (!map.has(node.sourceAssetId)) {
          map.set(node.sourceAssetId, [])
        }
        map.get(node.sourceAssetId)!.push(node)
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
  context: { assetIndex: Record<string, AssetIndexEntry>; packageAssetMap: Record<string, string> },
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
      const payload = buildSerializedPrefabPayload(found, {
        name: found.name ?? 'Clipboard Prefab',
        assetIndex: context.assetIndex,
        packageAssetMap: context.packageAssetMap,
        resetRootTransform: true,
      })
      entries.push({
        sourceId: id,
        prefab: payload.prefab,
        serialized: payload.serialized,
        dependencyAssetIds: payload.dependencyAssetIds,
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

function duplicateNodeTree(original: SceneNode, context: DuplicateContext): SceneNode {
  const duplicated = cloneNode(original)
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
    context.assetCache.registerUsage(duplicated.sourceAssetId)
  }

  const runtimeObject = getRuntimeObject(original.id) ?? context.runtimeSnapshots.get(original.id) ?? null
  if (runtimeObject) {
    try {
      const clonedObject = runtimeObject.clone(true)
      tagObjectWithNodeId(clonedObject, duplicated.id)
      registerRuntimeObject(duplicated.id, clonedObject)
      componentManager.attachRuntime(duplicated, clonedObject)
    } catch (error) {
      console.warn('Failed to clone runtime object while duplicating node', original.id, error)
    }
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

function computeAssetSpawnTransform(asset: ProjectAsset, position?: Vector3Like) {
  const spawnPosition = position ? cloneVector(position) : { x: 0, y: 0, z: 0 }
  const rotation: Vector3Like = { x: 0, y: 0, z: 0 }
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

function snapAxisToGrid(value: number): number {
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
            const localCenter = bounds.getCenter(new Vector3())
            const size = bounds.getSize(new Vector3())
            const localRadius = Math.max(size.length() * 0.5, DEFAULT_SPAWN_RADIUS)
            const worldCenter = localCenter.clone().applyMatrix4(worldMatrix)

            const position = new Vector3()
            const quaternion = new Quaternion()
            const scale = new Vector3()
            worldMatrix.decompose(position, quaternion, scale)
            const scaleFactor = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z), 1)
            const radius = localRadius * scaleFactor
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
            nodeBounds = localBounds.clone().applyMatrix4(worldMatrix)
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
  const nodes = initialNodes.map((node) => cloneNode(node))
  const environmentSettings = environment ? cloneEnvironmentSettings(environment) : DEFAULT_ENVIRONMENT_SETTINGS
  if (!settings) {
    return ensureEnvironmentNode(ensureSkyNode(nodes), environmentSettings)
  }
  return ensureEnvironmentNode(ensureSkyNode(ensureGroundNode(nodes, settings)), environmentSettings)
}

function cloneSceneNodes(nodes: SceneNode[]): SceneNode[] {
  return nodes.map(cloneNode)
}

function normalizePrefabName(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

function buildNodePrefabFilename(name: string): string {
  const normalized = normalizePrefabName(name) || 'Unnamed Prefab'
  const sanitized = normalized
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  const base = sanitized.length ? sanitized : 'UnnamedPrefab'
  return `${base}.prefab`
}

function sanitizePrefabUserData(userData?: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!userData || !isPlainRecord(userData)) {
    return null
  }
  const cloned = clonePlainRecord(userData)
  if (!cloned) {
    return null
  }
  if (PREFAB_SOURCE_METADATA_KEY in cloned) {
    delete cloned[PREFAB_SOURCE_METADATA_KEY]
  }
  return Object.keys(cloned).length ? cloned : null
}

function stripPrefabTransientFields(node: SceneNode): SceneNode {
  const sanitized: SceneNode = { ...node }
  delete (sanitized as { parentId?: string | null }).parentId
  delete (sanitized as { downloadProgress?: number }).downloadProgress
  delete (sanitized as { downloadStatus?: SceneNode['downloadStatus'] }).downloadStatus
  delete (sanitized as { downloadError?: string | null }).downloadError
  delete (sanitized as { isPlaceholder?: boolean }).isPlaceholder
  sanitized.visible = sanitized.visible ?? true
  if ('locked' in sanitized) {
    delete sanitized.locked
  }
  const cleanedUserData = sanitizePrefabUserData(sanitized.userData as Record<string, unknown> | null)
  if (cleanedUserData) {
    sanitized.userData = cleanedUserData
  } else if ('userData' in sanitized) {
    delete sanitized.userData
  }
  if (sanitized.children?.length) {
    sanitized.children = sanitized.children.map(stripPrefabTransientFields)
  } else if (sanitized.children) {
    delete sanitized.children
  }
  return sanitized
}

function attachPrefabMetadata(node: SceneNode, assetId: string) {
  if (!assetId) {
    return
  }
  const current = clonePlainRecord(node.userData as Record<string, unknown> | null)
  const next: Record<string, unknown> = current ? { ...current } : {}
  next[PREFAB_SOURCE_METADATA_KEY] = assetId
  node.userData = next
}

function remapPrefabNodeIds(node: SceneNode, regenerate: boolean): SceneNode {
  const resolvedId = regenerate || typeof node.id !== 'string' || !node.id.trim().length
    ? generateUuid()
    : node.id
  const children = node.children?.map((child) => remapPrefabNodeIds(child, regenerate))
  const sanitized: SceneNode = {
    ...node,
    id: resolvedId,
  }
  if (children && children.length) {
    sanitized.children = children
  } else if (children) {
    delete sanitized.children
  }
  return sanitized
}

function prepareNodePrefabRoot(
  source: SceneNode,
  options: { regenerateIds?: boolean } = {},
): SceneNode {
  const cloned = cloneNode(source)
  const stripped = stripPrefabTransientFields(cloned)
  return remapPrefabNodeIds(stripped, options.regenerateIds ?? false)
}

function resetPrefabRootTransform(root: SceneNode) {
  root.position = { x: 0, y: 0, z: 0 }
  root.rotation = { x: 0, y: 0, z: 0 }
  root.scale = root.scale ?? { x: 1, y: 1, z: 1 }
}

function ensurePrefabGroupRoot(node: SceneNode): SceneNode {
  if (node.nodeType === 'Group') {
    const cloned = cloneNode(node)
    cloned.groupExpanded = false
    return cloned
  }
  const wrapper: SceneNode = {
    id: generateUuid(),
    name: node.name?.trim().length ? `${node.name} Group` : 'Group Root',
    nodeType: 'Group',
    position: createVector(0, 0, 0),
    rotation: createVector(0, 0, 0),
    scale: createVector(1, 1, 1),
    visible: node.visible ?? true,
    locked: false,
    groupExpanded: false,
    children: [cloneNode(node)],
  }
  return wrapper
}

function createNodePrefabData(node: SceneNode, name: string, options: { resetRootTransform?: boolean } = {}): NodePrefabData {
  const normalizedName = normalizePrefabName(name) || 'Unnamed Prefab'
  const root = prepareNodePrefabRoot(node, { regenerateIds: false })
  if (options.resetRootTransform !== false) {
    resetPrefabRootTransform(root)
  }
  return {
    formatVersion: NODE_PREFAB_FORMAT_VERSION,
    name: normalizedName,
    root,
  }
}

function serializeNodePrefab(payload: NodePrefabData): string {
  return JSON.stringify(payload, null, 2)
}

function deserializeNodePrefab(raw: string, options: { resetRootTransform?: boolean } = {}): NodePrefabData {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`节点预制件数据无效: ${(error as Error).message}`)
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('节点预制件数据格式错误')
  }
  const candidate = parsed as Partial<NodePrefabData> & { root?: SceneNode | null }
  const formatVersion = Number.isFinite(candidate.formatVersion)
    ? Number(candidate.formatVersion)
    : NODE_PREFAB_FORMAT_VERSION
  if (formatVersion !== NODE_PREFAB_FORMAT_VERSION) {
    throw new Error(`不支持的节点预制件版本: ${candidate.formatVersion}`)
  }
  if (!candidate.root || typeof candidate.root !== 'object') {
    throw new Error('节点预制件缺少有效的节点数据')
  }
  const normalizedName = normalizePrefabName(typeof candidate.name === 'string' ? candidate.name : '') || 'Unnamed Prefab'
  const root = prepareNodePrefabRoot(candidate.root as SceneNode, { regenerateIds: false })
  if (options.resetRootTransform !== false) {
    resetPrefabRootTransform(root)
  }
  const assetIndex = candidate.assetIndex && isAssetIndex(candidate.assetIndex)
    ? cloneAssetIndex(candidate.assetIndex as Record<string, AssetIndexEntry>)
    : undefined
  const packageAssetMap = candidate.packageAssetMap && isPackageAssetMap(candidate.packageAssetMap)
    ? clonePackageAssetMap(candidate.packageAssetMap as Record<string, string>)
    : undefined
  const prefab: NodePrefabData = {
    formatVersion: NODE_PREFAB_FORMAT_VERSION,
    name: normalizedName,
    root,
  }
  if (assetIndex && Object.keys(assetIndex).length) {
    prefab.assetIndex = assetIndex
  }
  if (packageAssetMap && Object.keys(packageAssetMap).length) {
    prefab.packageAssetMap = packageAssetMap
  }
  return prefab
}

type SerializedPrefabPayload = {
  prefab: NodePrefabData
  serialized: string
  dependencyAssetIds: string[]
}

function buildSerializedPrefabPayload(
  node: SceneNode,
  context: {
    name?: string
    assetIndex: Record<string, AssetIndexEntry>
    packageAssetMap: Record<string, string>
    resetRootTransform?: boolean
  },
): SerializedPrefabPayload {
  const prefabRoot = ensurePrefabGroupRoot(node)
  const prefabData = createNodePrefabData(prefabRoot, context.name ?? node.name ?? '', {
    resetRootTransform: context.resetRootTransform !== false,
  })
  const dependencyAssetIds = collectPrefabAssetReferences(prefabData.root)
  if (dependencyAssetIds.length) {
    const assetIndexSubset = buildAssetIndexSubsetForPrefab(context.assetIndex, dependencyAssetIds)
    if (assetIndexSubset) {
      prefabData.assetIndex = assetIndexSubset
    } else {
      delete prefabData.assetIndex
    }
    const packageAssetMapSubset = buildPackageAssetMapSubsetForPrefab(context.packageAssetMap, dependencyAssetIds)
    if (packageAssetMapSubset) {
      prefabData.packageAssetMap = packageAssetMapSubset
    } else {
      delete prefabData.packageAssetMap
    }
  } else {
    delete prefabData.assetIndex
    delete prefabData.packageAssetMap
  }
  const serialized = serializeNodePrefab(prefabData)
  return {
    prefab: prefabData,
    serialized,
    dependencyAssetIds,
  }
}

async function writePrefabToSystemClipboard(serialized: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
    return
  }
  try {
    await navigator.clipboard.writeText(serialized)
  } catch (error) {
    console.warn('Failed to write prefab data to clipboard', error)
  }
}

async function readPrefabFromSystemClipboard(): Promise<NodePrefabData | null> {
  if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
    return null
  }
  try {
    const text = await navigator.clipboard.readText()
    const normalized = text?.trim()
    if (!normalized) {
      return null
    }
    return deserializeNodePrefab(normalized)
  } catch (error) {
    console.warn('Failed to read prefab data from clipboard', error)
    return null
  }
}

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

async function buildPackageEmbedAssetMapForExport(
  scene: StoredSceneDocument,
  packageAssetMap: Record<string, string>,
  usedAssetIds: Set<string>): Promise<Record<string, string>> {
  if (!usedAssetIds.size) {
    return packageAssetMap
  }
  const assetCache = useAssetCacheStore()
  const assetIdsToEmbed = new Set<string>()

  const assetIndex = scene.assetIndex ?? {}
  usedAssetIds.forEach((assetId) => {
    const entry = assetIndex[assetId]
    if (entry?.source?.type === 'local') {
      assetIdsToEmbed.add(assetId)
    }
  })

  if (!assetIdsToEmbed.size) {
    return packageAssetMap
  }

  const normalizeUrl = (value: string | null | undefined): string | null => {
    if (!value) {
      return null
    }
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  const embedTasks: Promise<void>[] = []

  assetIdsToEmbed.forEach((assetId) => {
    embedTasks.push((async () => {
      const asset = getAssetFromCatalog(scene.assetCatalog, assetId)
      if (!asset) {
        return
      }

      let cacheEntry = assetCache.hasCache(assetId) ? assetCache.getEntry(assetId) : null
      if (!cacheEntry || cacheEntry.status !== 'cached' || !cacheEntry.blob) {
        cacheEntry = await assetCache.loadFromIndexedDb(assetId)
      }

      if (!cacheEntry || cacheEntry.status !== 'cached' || !cacheEntry.blob) {
        const downloadUrl = normalizeUrl(asset.downloadUrl) ?? normalizeUrl(asset.description)
        if (!downloadUrl) {
          console.warn('Missing asset data, cannot embed in exported scene', assetId)
          return
        }
        try {
          cacheEntry = await assetCache.downloadAsset(assetId, downloadUrl, asset.name)
        } catch (error) {
          console.warn('Failed to download asset data, cannot embed in exported scene', assetId, error)
          return
        }
      }

      if (!cacheEntry || cacheEntry.status !== 'cached' || !cacheEntry.blob) {
        console.warn('Asset not cached, cannot embed in exported scene', assetId)
        return
      }

      try {
        packageAssetMap[`${LOCAL_EMBEDDED_ASSET_PREFIX}${assetId}`] = await blobToDataUrl(cacheEntry.blob)
      } catch (error) {
        console.warn('Failed to serialize asset, cannot embed in exported scene', assetId, error)
      }
    })())
  })

  if (embedTasks.length) {
    await Promise.all(embedTasks)
  }
  return packageAssetMap
}

export async function buildPackageAssetMapForExport(
  scene: StoredSceneDocument,
  options: SceneBundleExportOptions,
): Promise<{ packageAssetMap: Record<string, string>; assetIndex: Record<string, AssetIndexEntry> }> {
  const usedAssetIds = collectSceneAssetReferences(scene)
  let packageAssetMap = filterPackageAssetMapByUsage(stripAssetEntries(clonePackageAssetMap(scene.packageAssetMap)),usedAssetIds)
  const assetIndex = filterAssetIndexByUsage(scene.assetIndex, usedAssetIds)
  const embedResources = options.embedResources ?? false
  if (embedResources) {
    packageAssetMap = await buildPackageEmbedAssetMapForExport(scene, packageAssetMap, usedAssetIds);
  }
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
  catalog: Record<string, ProjectAsset[]>,
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

  const asset = getAssetFromCatalog(catalog, assetId)
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
    const bytes = estimateInlineAssetByteSize(value)
    const entry: SceneResourceSummaryEntry = { assetId, bytes, embedded: true, source: 'embedded' }
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
    const downloadUrl = resolveAssetDownloadUrl(assetId, indexEntry, assetCatalog, packageMap)

    if (!bytes && options.embedResources) {
      // If resources are embedded, prefer cached array buffer size if available.
      bytes = cacheEntry?.arrayBuffer?.byteLength ?? bytes
    }

    if (bytes > 0) {
      const entry: SceneResourceSummaryEntry = {
        assetId,
        bytes,
        embedded: false,
        source: 'remote',
        downloadUrl: downloadUrl ?? null,
      }
      summary.assets.push(entry)
      recordTextureAssetEntry(assetId, entry)
      summary.totalBytes += bytes
      summary.externalBytes += bytes
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
  options: SceneBundleExportOptions,
): Promise<StoredSceneDocument> {
  const {packageAssetMap, assetIndex} = await buildPackageAssetMapForExport(scene,options)
  return createSceneDocument(scene.name, {
    id: scene.id,
    nodes: scene.nodes,
    selectedNodeId: scene.selectedNodeId,
    selectedNodeIds: scene.selectedNodeIds,
    camera: scene.camera,
    thumbnail: scene.thumbnail ?? null,
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
      console.warn('无法解析本地资源数据', error)
      nextPackageMap[key] = dataUrl
      continue
    }

    let computedId = originalId
    try {
      computedId = await computeBlobHash(blob)
    } catch (error) {
      console.warn('计算资源哈希失败', error)
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
        console.warn('写入本地资源缓存失败', error)
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

function collectNodeAssetDependencies(node: SceneNode | null | undefined, bucket: Set<string>) {
  if (!node) {
    return
  }
  collectAssetIdCandidate(bucket, node.sourceAssetId)
  collectAssetIdCandidate(bucket, node.importMetadata?.assetId)
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
  if (node.children?.length) {
    node.children.forEach((child) => collectNodeAssetDependencies(child, bucket))
  }
}

function collectPrefabAssetReferences(root: SceneNode | null | undefined): string[] {
  if (!root) {
    return []
  }
  const bucket = new Set<string>()
  collectNodeAssetDependencies(root, bucket)
  return Array.from(bucket)
}

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

function normalizeViewportSettingsInput(value: unknown): (Partial<SceneViewportSettings> & Partial<LegacyViewportSettings>) | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }
  const input = value as unknown as LegacyViewportSettings
  const normalized: Partial<SceneViewportSettings> & Partial<LegacyViewportSettings> = {}
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
  if (input.skybox && isPlainObject(input.skybox)) {
    normalized.skybox = input.skybox as Partial<SceneSkyboxSettings>
  }
  if (typeof input.shadowsEnabled === 'boolean') {
    normalized.shadowsEnabled = input.shadowsEnabled
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

function collectSceneRuntimeSnapshots(nodes: SceneNode[]): Map<string, Object3D> {
  const runtimeSnapshots = new Map<string, Object3D>()
  nodes.forEach((node) => collectRuntimeSnapshots(node, runtimeSnapshots))
  return runtimeSnapshots
}

function createHistorySnapshot(store: SceneState): SceneHistoryEntry {
  return {
    nodes: cloneSceneNodes(store.nodes),
    materials: cloneSceneMaterials(store.materials),
    selectedNodeIds: cloneSelection(store.selectedNodeIds),
    selectedNodeId: store.selectedNodeId,
    viewportSettings: cloneViewportSettings(store.viewportSettings),
    skybox: cloneSkyboxSettings(store.skybox),
    shadowsEnabled: normalizeShadowsEnabledInput(store.shadowsEnabled),
    environment: cloneEnvironmentSettings(store.environment),
    groundSettings: cloneGroundSettings(store.groundSettings),
    resourceProviderId: store.resourceProviderId,
    runtimeSnapshots: collectSceneRuntimeSnapshots(store.nodes),
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
    nodes?: SceneNode[]
    materials?: SceneMaterial[]
    selectedNodeId?: string | null
    selectedNodeIds?: string[]
    camera?: SceneCameraState
    thumbnail?: string | null
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
  let selectedNodeId = options.selectedNodeId ?? findDefaultSelectableNode()
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
    try {
      resourceSummary = structuredClone(options.resourceSummary)
    } catch (_error) {
      try {
        resourceSummary = JSON.parse(JSON.stringify(options.resourceSummary)) as SceneResourceSummary
      } catch (_jsonError) {
        resourceSummary = { ...options.resourceSummary }
      }
    }
  }
  const legacyViewport = options.viewportSettings as LegacyViewportSettings | undefined
  const skybox = cloneSceneSkybox(options.skybox ?? legacyViewport?.skybox ?? null)
  const shadowsEnabled = normalizeShadowsEnabledInput(options.shadowsEnabled ?? legacyViewport?.shadowsEnabled)
  const viewportSettings = cloneViewportSettings(options.viewportSettings)
  const panelVisibility = normalizePanelVisibilityState(options.panelVisibility)
  const panelPlacement = normalizePanelPlacementStateInput(options.panelPlacement)

  return {
    id,
    name,
    thumbnail: options.thumbnail ?? null,
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
      thumbnail: null,
      createdAt: now,
      updatedAt: now,
    }
    return
  }

  const name = typeof store.currentSceneMeta.name === 'string' ? store.currentSceneMeta.name.trim() : ''
  const thumbnail = typeof store.currentSceneMeta.thumbnail === 'string' ? store.currentSceneMeta.thumbnail : null
  const createdAtRaw = store.currentSceneMeta.createdAt
  const updatedAtRaw = store.currentSceneMeta.updatedAt
  const createdAt = typeof createdAtRaw === 'string' && createdAtRaw ? createdAtRaw : now
  const updatedAt = typeof updatedAtRaw === 'string' && updatedAtRaw ? updatedAtRaw : createdAt

  store.currentSceneMeta = {
    name: name || 'Untitled Scene',
    thumbnail,
    createdAt,
    updatedAt,
  }
}

function buildSceneDocumentFromState(store: SceneState): StoredSceneDocument {
  if (!store.currentSceneId) {
    throw new Error('Cannot create scene document without an active scene')
  }

  normalizeCurrentSceneMeta(store)
  const now = new Date().toISOString()
  const meta = store.currentSceneMeta!
  const environment = cloneEnvironmentSettings(store.environment)
  const nodes = ensureEnvironmentNode(
    ensureSkyNode(ensureGroundNode(cloneSceneNodes(store.nodes), store.groundSettings)),
    environment,
  )

  return {
    id: store.currentSceneId,
    name: meta.name,
    thumbnail: meta.thumbnail ?? null,
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
  }
}

function commitSceneSnapshot(
  store: SceneState,
  _options: { updateNodes?: boolean; updateCamera?: boolean } = {},
) {
  if (!store.currentSceneId) {
    return
  }

  const normalizedNodes = ensureEnvironmentNode(
    ensureSkyNode(ensureGroundNode(store.nodes, store.groundSettings)),
    store.environment,
  )
  if (normalizedNodes !== store.nodes) {
    store.nodes = normalizedNodes
  }

  normalizeCurrentSceneMeta(store)
  store.hasUnsavedChanges = true
}

function applyCurrentSceneMeta(store: SceneState, document: StoredSceneDocument) {
  store.currentSceneMeta = {
    name: document.name,
    thumbnail: document.thumbnail ?? null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  }
}

function releaseRuntimeTree(node: SceneNode) {
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

function allowsChildNodes(node: SceneNode | null | undefined): boolean {
  if (!node) {
    return true
  }
  if (node.allowChildNodes === false) {
    return false
  }
  const nodeId = node.id
  if (nodeId === GROUND_NODE_ID || nodeId === SKY_NODE_ID || nodeId === ENVIRONMENT_NODE_ID) {
    return false
  }
  const nodeType = node.nodeType
  if (nodeType === 'Sky' || nodeType === 'Environment') {
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
      currentSceneMeta: {
        name: initialSceneDocument.name,
        thumbnail: initialSceneDocument.thumbnail ?? null,
        createdAt: initialSceneDocument.createdAt,
        updatedAt: initialSceneDocument.updatedAt,
      },
      nodes: clonedNodes,
      materials: cloneSceneMaterials(initialSceneDocument.materials),
      selectedNodeId: initialSceneDocument.selectedNodeId,
      selectedNodeIds: cloneSelection(initialSceneDocument.selectedNodeIds),
      activeTool: 'select',
      assetCatalog,
      assetIndex,
      packageAssetMap: {},
      packageDirectoryCache,
      packageDirectoryLoaded: {},
      projectTree: createProjectTreeFromCache(assetCatalog, packageDirectoryCache),
      activeDirectoryId: defaultDirectoryId,
      selectedAssetId: null,
      camera: cloneCameraState(initialSceneDocument.camera),
      viewportSettings,
      skybox: initialSkybox,
      shadowsEnabled: initialShadowsEnabled,
      environment: initialEnvironment,
      groundSettings: cloneGroundSettings(initialSceneDocument.groundSettings),
      panelVisibility: { ...defaultPanelVisibility },
      panelPlacement: { ...defaultPanelPlacement },
      projectPanelTreeSize: DEFAULT_PROJECT_PANEL_TREE_SIZE,
      resourceProviderId: initialSceneDocument.resourceProviderId,
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
      pendingTransformSnapshot: null,
      isSceneReady: false,
      hasUnsavedChanges: false,
      workspaceId: '',
      workspaceType: 'local',
      workspaceLabel: '本地用户',
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
      await this.ensureCurrentSceneLoaded()
    },
    onPersistHydrated(_state?: Partial<SceneState>) {
      const nextTree = createProjectTreeFromCache(this.assetCatalog, this.packageDirectoryCache)
      this.projectTree = nextTree
      if (this.activeDirectoryId && !findDirectory(nextTree, this.activeDirectoryId)) {
        this.activeDirectoryId = defaultDirectoryId
      }
      if (this.selectedAssetId && !findAssetInTree(nextTree, this.selectedAssetId)) {
        this.selectedAssetId = null
      }
      this.skybox = cloneSceneSkybox(this.skybox)
      this.shadowsEnabled = normalizeShadowsEnabledInput(this.shadowsEnabled)
      void this.refreshRuntimeState({ showOverlay: false, refreshViewport: false })
    },
    async refreshRuntimeState(options: { showOverlay?: boolean; refreshViewport?: boolean; skipComponentSync?: boolean } = {}) {
      if (runtimeRefreshInFlight) {
        try {
          await runtimeRefreshInFlight
        } catch {
          // swallow previous errors to allow retry
        }
      }

      const task = (async () => {
        const showOverlay = options.showOverlay ?? false
        const refreshViewport = options.refreshViewport ?? false
        const skipComponentSync = options.skipComponentSync ?? false

        clearRuntimeObjectRegistry()
        componentManager.reset()

        if (!this.nodes.length) {
          if (!skipComponentSync) {
            componentManager.syncScene(this.nodes)
          }
          useAssetCacheStore().recalculateUsage(this.nodes)
          return
        }

        await this.ensureSceneAssetsReady({
          nodes: this.nodes,
          showOverlay,
          refreshViewport,
        })

        this.rebuildGeneratedMeshRuntimes()

        const assetNodeMap = collectNodesByAssetId(this.nodes)
        const missingAssetNodes: SceneNode[] = []
        assetNodeMap.forEach((nodesForAsset) => {
          nodesForAsset.forEach((node) => {
            if (!runtimeObjectRegistry.has(node.id)) {
              missingAssetNodes.push(node)
            }
          })
        })

        if (missingAssetNodes.length) {
          await this.ensureSceneAssetsReady({
            nodes: missingAssetNodes,
            showOverlay: false,
            refreshViewport,
          })
        }

        if (!skipComponentSync) {
          reattachRuntimeObjectsForNodes(this.nodes)
          componentManager.syncScene(this.nodes)
        }
        useAssetCacheStore().recalculateUsage(this.nodes)
      })()

      runtimeRefreshInFlight = task
      try {
        await task
      } finally {
        if (runtimeRefreshInFlight === task) {
          runtimeRefreshInFlight = null
        }
      }
    },
    createSceneDocumentSnapshot(): StoredSceneDocument {
      const snapshot = buildSceneDocumentFromState(this)
      return snapshot
    },
    appendUndoSnapshot(snapshot: SceneHistoryEntry, options: { resetRedo?: boolean } = {}) {
      const nextUndoStack = [...this.undoStack, snapshot]
      this.undoStack = nextUndoStack.length > HISTORY_LIMIT
        ? nextUndoStack.slice(nextUndoStack.length - HISTORY_LIMIT)
        : nextUndoStack
      const resetRedo = options.resetRedo ?? true
      if (resetRedo && this.redoStack.length) {
        this.redoStack = []
      }
    },
    captureHistorySnapshot(options: { resetRedo?: boolean } = {}) {
      if (this.isRestoringHistory) {
        return
      }
      const snapshot = createHistorySnapshot(this)
      this.appendUndoSnapshot(snapshot, options)
    },
    pushRedoSnapshot() {
      const snapshot = createHistorySnapshot(this)
      const nextRedoStack = [...this.redoStack, snapshot]
      this.redoStack = nextRedoStack.length > HISTORY_LIMIT
        ? nextRedoStack.slice(nextRedoStack.length - HISTORY_LIMIT)
        : nextRedoStack
    },
    async restoreFromHistory(snapshot: SceneHistoryEntry) {
      const assetCache = useAssetCacheStore()
      this.isRestoringHistory = true
      this.activeTransformNodeId = null
      this.transformSnapshotCaptured = false
      this.pendingTransformSnapshot = null
      try {
        this.nodes.forEach((node) => releaseRuntimeTree(node))
        this.nodes = cloneSceneNodes(snapshot.nodes)
        this.materials = cloneSceneMaterials(snapshot.materials)
        this.selectedNodeIds = cloneSelection(snapshot.selectedNodeIds)
        this.selectedNodeId = snapshot.selectedNodeId
        this.viewportSettings = cloneViewportSettings(snapshot.viewportSettings)
        const legacyViewport = snapshot.viewportSettings as LegacyViewportSettings | undefined
        this.skybox = cloneSceneSkybox(snapshot.skybox ?? legacyViewport?.skybox ?? null)
        this.shadowsEnabled = normalizeShadowsEnabledInput(snapshot.shadowsEnabled ?? legacyViewport?.shadowsEnabled)
        this.environment = cloneEnvironmentSettings(snapshot.environment)
        this.groundSettings = cloneGroundSettings(snapshot.groundSettings)
        this.resourceProviderId = snapshot.resourceProviderId

        componentManager.reset()
        componentManager.syncScene(this.nodes)

        assetCache.recalculateUsage(this.nodes)

        snapshot.runtimeSnapshots.forEach((object, nodeId) => {
          try {
            const clonedObject = object.clone(true)
            tagObjectWithNodeId(clonedObject, nodeId)
            registerRuntimeObject(nodeId, clonedObject)
            const node = findNodeById(this.nodes, nodeId)
            if (node) {
              componentManager.attachRuntime(node, clonedObject)
            }
          } catch (error) {
            console.warn('Failed to clone stored runtime snapshot during restore', nodeId, error)
          }
        })

        this.rebuildGeneratedMeshRuntimes()

        const nodeIds = flattenNodeIds(this.nodes)
        const missingRuntimeObjects = nodeIds.filter((id) => !runtimeObjectRegistry.has(id))
        if (missingRuntimeObjects.length) {
          await this.ensureSceneAssetsReady({ nodes: this.nodes, showOverlay: false, refreshViewport: false })
        }

        // trigger reactivity for consumers relying on node array reference
        this.nodes = [...this.nodes]
        commitSceneSnapshot(this)
      } finally {
        this.isRestoringHistory = false
      }
    },
    async undo() {
      if (!this.undoStack.length || this.isRestoringHistory) {
        return false
      }
      const snapshot = this.undoStack[this.undoStack.length - 1]!
      this.undoStack = this.undoStack.slice(0, -1)
      this.pushRedoSnapshot()
      await this.restoreFromHistory(snapshot)
      return true
    },
    async redo() {
      if (!this.redoStack.length || this.isRestoringHistory) {
        return false
      }
      const snapshot = this.redoStack[this.redoStack.length - 1]!
      this.redoStack = this.redoStack.slice(0, -1)
      this.captureHistorySnapshot({ resetRedo: false })
      await this.restoreFromHistory(snapshot)
      return true
    },
    beginTransformInteraction(nodeId: string | null) {
      if (!nodeId) {
        this.activeTransformNodeId = null
        this.transformSnapshotCaptured = false
        this.pendingTransformSnapshot = null
        return
      }
      if (this.activeTransformNodeId !== nodeId) {
        this.activeTransformNodeId = nodeId
      }
      this.transformSnapshotCaptured = false
      this.pendingTransformSnapshot = this.isRestoringHistory ? null : createHistorySnapshot(this)
    },
    endTransformInteraction() {
      if (this.pendingTransformSnapshot && this.transformSnapshotCaptured && !this.isRestoringHistory) {
        this.appendUndoSnapshot(this.pendingTransformSnapshot)
      }
      this.pendingTransformSnapshot = null
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
      this.captureHistorySnapshot()
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
      this.captureHistorySnapshot()
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

      this.captureHistorySnapshot()
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
      return true
    },
    isGroupExpanded(nodeId: string): boolean {
      const node = findNodeById(this.nodes, nodeId)
      return isGroupExpandedFlag(node)
    },
    getExpandedGroupIds(): string[] {
      return collectExpandedGroupIds(this.nodes)
    },
    setGroupExpanded(nodeId: string, expanded: boolean, options: { captureHistory?: boolean; commit?: boolean } = {}) {
      const node = findNodeById(this.nodes, nodeId)
      if (!isGroupNode(node)) {
        return false
      }
      const normalized = expanded !== false
      const current = isGroupExpandedFlag(node)
      if (current === normalized) {
        return false
      }
      if (options.captureHistory !== false) {
        this.captureHistorySnapshot()
      }
      node.groupExpanded = normalized
      this.nodes = [...this.nodes]
      if (!normalized) {
        this.setSelection([...this.selectedNodeIds])
      }
      if (options.commit !== false) {
        commitSceneSnapshot(this)
      }
      return true
    },
    syncGroupExpansionState(ids: string[], options: { captureHistory?: boolean; commit?: boolean } = {}) {
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
      if (options.captureHistory !== false) {
        this.captureHistorySnapshot()
      }
      let selectionNeedsNormalization = false
      assignments.forEach(({ node, next }) => {
        node.groupExpanded = next
        if (!next) {
          selectionNeedsNormalization = true
        }
      })
      this.nodes = [...this.nodes]
      if (selectionNeedsNormalization) {
        this.setSelection([...this.selectedNodeIds])
      }
      if (options.commit !== false) {
        commitSceneSnapshot(this)
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
          if (this.pendingTransformSnapshot) {
            this.transformSnapshotCaptured = true
          } else {
            this.captureHistorySnapshot()
            this.transformSnapshotCaptured = true
          }
        }
      } else {
        this.captureHistorySnapshot()
      }
      visitNode(this.nodes, payload.id, (node) => {
        node.position = cloneVector(payload.position)
        node.rotation = cloneVector(payload.rotation)
        node.scale = cloneVector(payload.scale)
      })
      this.nodes = [...this.nodes]
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
          if (this.pendingTransformSnapshot) {
            this.transformSnapshotCaptured = true
          } else {
            this.captureHistorySnapshot()
            this.transformSnapshotCaptured = true
          }
        }
      } else {
        this.captureHistorySnapshot()
      }
      visitNode(this.nodes, payload.id, (node) => {
        if (payload.position) node.position = cloneVector(payload.position)
        if (payload.rotation) node.rotation = cloneVector(payload.rotation)
        if (payload.scale) node.scale = cloneVector(payload.scale)
      })
      // trigger reactivity for listeners relying on reference changes
      this.nodes = [...this.nodes]
      if (scaleChanged) {
        const updatedNode = findNodeById(this.nodes, payload.id)
        refreshDisplayBoardGeometry(updatedNode)
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
          if (this.pendingTransformSnapshot) {
            this.transformSnapshotCaptured = true
          } else {
            this.captureHistorySnapshot()
            this.transformSnapshotCaptured = true
          }
        }
      } else {
        this.captureHistorySnapshot()
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
      this.nodes = [...this.nodes]
      if (scaleRefreshTargets.size) {
        scaleRefreshTargets.forEach((id) => {
          const updatedNode = findNodeById(this.nodes, id)
          refreshDisplayBoardGeometry(updatedNode)
        })
      }
      commitSceneSnapshot(this)
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
      this.captureHistorySnapshot()
      visitNode(this.nodes, id, (node) => {
        node.name = trimmed
      })
      this.nodes = [...this.nodes]
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

      this.nodes = [...this.nodes]
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
        }
      })

      if (!removed) {
        return false
      }

      this.nodes = [...this.nodes]
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

      this.nodes = [...this.nodes]
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
      this.nodes = [...this.nodes]
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

      this.nodes = [...this.nodes]
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

      this.nodes = [...this.nodes]
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
      this.nodes = [...this.nodes]

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
      }

      this.registerAsset(asset, {
        categoryId: determineAssetCategoryId(asset),
        source: { type: 'local' },
        commitOptions: { updateNodes: true, updateCamera: false },
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

      this.nodes = [...this.nodes]
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
        this.nodes = [...this.nodes]
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
        this.nodes = [...this.nodes]
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
      this.nodes = [...this.nodes]
      commitSceneSnapshot(this)
    },
    isNodeVisible(id: string) {
      const node = findNodeById(this.nodes, id)
      return node?.visible ?? true
    },
    setNodeVisibility(id: string, visible: boolean) {
      let updated = false
      visitNode(this.nodes, id, (node) => {
        node.visible = visible
        updated = true
      })
      if (!updated) {
        return
      }
      this.nodes = [...this.nodes]
      commitSceneSnapshot(this)
    },
    toggleNodeVisibility(id: string) {
      const current = this.isNodeVisible(id)
      this.setNodeVisibility(id, !current)
    },
    setAllNodesVisibility(visible: boolean) {
      let updated = false
      const apply = (nodes: SceneNode[]) => {
        nodes.forEach((node) => {
          if ((node.visible ?? true) !== visible) {
            node.visible = visible
            updated = true
          }
          if (node.children?.length) {
            apply(node.children)
          }
        })
      }
      apply(this.nodes)
      if (!updated) {
        return
      }
      this.nodes = [...this.nodes]
      commitSceneSnapshot(this)
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
      this.captureHistorySnapshot()
      nodes.forEach((node) => {
        node.visible = targetVisible
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
      if (id === GROUND_NODE_ID || id === SKY_NODE_ID || id === ENVIRONMENT_NODE_ID) {
        return
      }
      let updated = false
      visitNode(this.nodes, id, (node) => {
        const current = node.locked ?? false
        if (current !== locked) {
          node.locked = locked
          updated = true
        }
      })
      if (!updated) {
        return
      }
      if (locked && this.selectedNodeIds.includes(id)) {
        const nextSelection = this.selectedNodeIds.filter((selectedId) => selectedId !== id)
        this.setSelection(nextSelection)
      }
      this.nodes = [...this.nodes]
      commitSceneSnapshot(this)
    },
    toggleNodeSelectionLock(id: string) {
      const next = !this.isNodeSelectionLocked(id)
      this.setNodeSelectionLock(id, next)
    },
    setAllNodesSelectionLock(locked: boolean) {
      let updated = false
      const apply = (nodes: SceneNode[]) => {
        nodes.forEach((node) => {
          const current = node.locked ?? false
          if (node.id === GROUND_NODE_ID || node.id === SKY_NODE_ID || node.id === ENVIRONMENT_NODE_ID) {
            return
          }
          if (current !== locked) {
            node.locked = locked
            updated = true
          }
          if (node.children?.length) {
            apply(node.children)
          }
        })
      }
      apply(this.nodes)
      if (!updated) {
        return
      }
      if (locked && this.selectedNodeIds.length) {
        this.setSelection([])
      }
      this.nodes = [...this.nodes]
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
      this.captureHistorySnapshot()
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
      this.captureHistorySnapshot()
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
      this.nodes = [...this.nodes]
      commitSceneSnapshot(this)
      return true
    },
    setActiveDirectory(id: string) {
      this.activeDirectoryId = id
    },
    selectAsset(id: string | null) {
      this.selectedAssetId = id
    },
    async ensureSceneAssetsReady(options: EnsureSceneAssetsOptions = {}) {
      const targetNodes = Array.isArray(options.nodes) ? options.nodes : this.nodes
      if (!targetNodes.length) {
        if (options.showOverlay) {
          useUiStore().hideLoadingOverlay(true)
        }
        return
      }

      const assetNodeMap = collectNodesByAssetId(targetNodes)
      if (assetNodeMap.size === 0) {
        if (options.showOverlay) {
          useUiStore().hideLoadingOverlay(true)
        }
        return
      }

      const assetCache = useAssetCacheStore()
      const uiStore = useUiStore()
      const shouldShowOverlay = options.showOverlay ?? true
      const refreshViewport = options.refreshViewport ?? options.nodes === undefined
      const normalizeUrl = (value: string | null | undefined): string | null => {
        if (!value) {
          return null
        }
        const trimmed = value.trim()
        return trimmed.length > 0 ? trimmed : null
      }

      if (shouldShowOverlay) {
        uiStore.showLoadingOverlay({
          title: 'Loading Scene Assets',
          message: 'Preparing assets…',
          mode: 'determinate',
          progress: 0,
          closable: false,
          autoClose: false,
        })
      }

      const total = assetNodeMap.size
      let completed = 0
      const errors: Array<{ assetId: string; message: string }> = []

      for (const [assetId, nodesForAsset] of assetNodeMap.entries()) {
        const asset = this.getAsset(assetId)
        const assetLabel = normalizeUrl(asset?.name) ?? nodesForAsset[0]?.name ?? assetId
        const fallbackDownloadUrl = normalizeUrl(asset?.downloadUrl) ?? normalizeUrl(asset?.description)
    
        try {
          if (shouldShowOverlay) {
            uiStore.updateLoadingOverlay({
              message: `Loading asset: ${assetLabel}`,
            })
          }

          const shouldCacheModelObject = asset?.type === 'model' || asset?.type === 'mesh'
          let baseObject: Object3D | null = null

          if (shouldCacheModelObject) {
            const cachedModelObject = getCachedModelObject(assetId)
            if (cachedModelObject) {
              baseObject = cachedModelObject
              assetCache.touch(assetId)
            }
          }

          let stopDownloadWatcher: WatchStopHandle | null = null
          if (!baseObject) {
            let entry = assetCache.getEntry(assetId)
            if (!normalizeUrl(entry.downloadUrl) && fallbackDownloadUrl) {
              entry.downloadUrl = fallbackDownloadUrl
            }
            if (entry.status !== 'cached') {
              await assetCache.loadFromIndexedDb(assetId)
              entry = assetCache.getEntry(assetId)
              if (!normalizeUrl(entry.downloadUrl) && fallbackDownloadUrl) {
                entry.downloadUrl = fallbackDownloadUrl
              }
            }
            const downloadUrl = normalizeUrl(entry?.downloadUrl) ?? fallbackDownloadUrl

            const completedBeforeAsset = completed
            const overlayTotal = total > 0 ? total : 1

            try {
              if (!assetCache.hasCache(assetId)) {
                if (!downloadUrl) {
                  throw new Error('Missing asset download URL')
                }

                if (shouldShowOverlay) {
                  stopDownloadWatcher = watch(
                    () => {
                      const current = assetCache.getEntry(assetId)
                      return [current.status, current.progress, current.filename] as const
                    },
                    ([status, progress, filename]) => {
                      if (status !== 'downloading') {
                        return
                      }
                      const normalizedProgress = Number.isFinite(progress)
                        ? Math.max(0, Math.round(progress))
                        : 0
                      const displayName = filename?.trim() || assetLabel
                      const aggregateProgress = Math.max(
                        0,
                        Math.min(100, Math.round(((completedBeforeAsset + normalizedProgress / 100) / overlayTotal) * 100)),
                      )
                      uiStore.updateLoadingOverlay({
                        message: `Downloading asset: ${displayName} (${normalizedProgress}%)`,
                        progress: aggregateProgress,
                        mode: 'determinate',
                      })
                      uiStore.updateLoadingProgress(aggregateProgress, { autoClose: false })
                    },
                    { immediate: true },
                  )
                }

                await assetCache.downloadAsset(assetId, downloadUrl, assetLabel)
                if (shouldShowOverlay) {
                  uiStore.updateLoadingOverlay({
                    message: `Loading asset: ${assetLabel}`,
                  })
                }
              } else {
                assetCache.touch(assetId)
              }
            } finally {
              stopDownloadWatcher?.()
            }

            entry = assetCache.getEntry(assetId)

            const file = assetCache.createFileFromCache(assetId)
            if (!file) {
              throw new Error('Missing asset file in cache')
            }

            baseObject = shouldCacheModelObject
              ? await getOrLoadModelObject(assetId, () => loadObjectFromFile(file))
              : await loadObjectFromFile(file)

            if (shouldCacheModelObject) {
              assetCache.releaseInMemoryBlob(assetId)
            }
          }

          if (!baseObject) {
            throw new Error('Failed to resolve base object')
          }
          const baseObjectResolved = baseObject

          const metadataEntries = nodesForAsset
            .map((node) => {
              const metadata = node.importMetadata
              return metadata && Array.isArray(metadata.objectPath)
                ? { node, path: metadata.objectPath }
                : null
            })
            .filter((entry): entry is { node: SceneNode; path: number[] } => Boolean(entry))

          const descendantCache = new Map<string, number[][]>()
          metadataEntries.forEach((entry) => {
            const basePath = entry.path
            const key = basePath.join('.')
            const descendants: number[][] = []
            metadataEntries.forEach((candidate) => {
              if (candidate === entry) {
                return
              }
              if (isPathAncestor(basePath, candidate.path)) {
                descendants.push(candidate.path.slice(basePath.length))
              }
            })
            descendantCache.set(key, descendants)
          })

          let baseObjectAssigned = false

          nodesForAsset.forEach((node) => {
            const metadata = node.importMetadata
            let runtimeObject: Object3D

            if (metadata && Array.isArray(metadata.objectPath)) {
              const target = findObjectByPath(baseObjectResolved, metadata.objectPath) ?? baseObjectResolved
              runtimeObject = target.clone(true)
              const descendantKey = metadata.objectPath.join('.')
              const descendantPaths = descendantCache.get(descendantKey) ?? []
              pruneCloneByRelativePaths(runtimeObject, descendantPaths)
            } else {
              const reuseOriginal = !shouldCacheModelObject && !baseObjectAssigned
              runtimeObject = reuseOriginal ? baseObjectResolved : baseObjectResolved.clone(true)
              baseObjectAssigned = baseObjectAssigned || reuseOriginal
            }

            runtimeObject.name = node.name ?? runtimeObject.name
            prepareRuntimeObjectForNode(runtimeObject)
            tagObjectWithNodeId(runtimeObject, node.id)
            registerRuntimeObject(node.id, runtimeObject)
            componentManager.attachRuntime(node, runtimeObject)
            componentManager.syncNode(node)
          })
        } catch (error) {
          const message = (error as Error).message ?? 'Unknown error'
          errors.push({ assetId, message })
          console.warn(`Failed to load asset ${assetId}`, error)
          if (shouldShowOverlay) {
            uiStore.updateLoadingOverlay({
              message: `Failed to load asset ${assetLabel}: ${message}`,
              closable: true,
              autoClose: false,
            })
          }
        } finally {
          completed += 1
          if (shouldShowOverlay) {
            const percent = Math.round((completed / total) * 100)
            uiStore.updateLoadingProgress(percent, { autoClose: false })
          }
        }
      }

      if (shouldShowOverlay) {
        if (errors.length === 0) {
          uiStore.updateLoadingOverlay({
            message: 'Assets loaded successfully',
            autoClose: true,
            autoCloseDelay: 600,
          })
          uiStore.updateLoadingProgress(100, { autoClose: true, autoCloseDelay: 600 })
        } else {
          uiStore.updateLoadingOverlay({
            message: `${errors.length} assets failed to load. Please check the logs.`,
            closable: true,
            autoClose: false,
          })
          uiStore.updateLoadingProgress(100, { autoClose: false })
        }
      }

      if (errors.length === 0 && refreshViewport) {
        this.nodes = [...this.nodes]
      }
    },
    async spawnAssetAtPosition(assetId: string, position: THREE.Vector3): Promise<{ asset: ProjectAsset; node: SceneNode }> {
      const asset = findAssetInTree(this.projectTree, assetId)
      if (!asset) {
        throw new Error('Unable to find the requested asset')
      }

      if (asset.type === 'prefab') {
        const node = await this.instantiateNodePrefabAsset(asset.id, position)
        return { asset, node }
      }

      const node = await this.addModelNode({ asset, position })
      if (node) {
        return { asset, node }
      }

      const assetCache = useAssetCacheStore()
      const transform = computeAssetSpawnTransform(asset, position)
      const placeholder = this.addPlaceholderNode(asset, transform)
      this.observeAssetDownloadForNode(placeholder.id, asset)
      assetCache.setError(asset.id, null)
      void assetCache.downloaProjectAsset(asset).catch((error) => {
        const target = findNodeById(this.nodes, placeholder.id)
        if (target) {
          target.downloadStatus = 'error'
          target.downloadError = (error as Error).message ?? '资源下载失败'
          this.nodes = [...this.nodes]
        }
      })

      return { asset, node: placeholder }
    },
    resetProjectTree() {
      this.packageDirectoryCache = {}
      this.packageDirectoryLoaded = {}
      this.projectTree = createProjectTreeFromCache(this.assetCatalog, this.packageDirectoryCache)
      this.activeDirectoryId = defaultDirectoryId
      this.selectedAssetId = null
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
      const nextTree = createProjectTreeFromCache(this.assetCatalog, this.packageDirectoryCache)
      this.projectTree = nextTree
      if (!this.activeDirectoryId || !findDirectory(nextTree, this.activeDirectoryId)) {
        this.activeDirectoryId = defaultDirectoryId
      }
      this.selectedAssetId = null
    },
    getAsset(assetId: string): ProjectAsset | null {
      const meta = this.assetIndex[assetId]
      if (meta) {
        const catalogList = this.assetCatalog[meta.categoryId] ?? []
        const found = catalogList.find((item) => item.id === assetId)
        if (found) {
          return found
        }
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
        commitOptions?: { updateNodes?: boolean; updateCamera?: boolean }
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
      }

      const registered = this.registerAsset(projectAsset, {
        categoryId: determineAssetCategoryId(projectAsset),
        source: { type: 'local' },
        commitOptions: metadata.commitOptions ?? { updateNodes: false, updateCamera: false },
      })

      return { asset: registered, isNew: true }
    },
    registerAsset(
      asset: ProjectAsset,
      options: { categoryId?: string; source?: AssetSourceMetadata; commitOptions?: { updateNodes?: boolean; updateCamera?: boolean } } = {},
    ) {
      const categoryId = options.categoryId ?? determineAssetCategoryId(asset)
      const existingEntry = this.assetIndex[asset.id]
      const nextCatalog: Record<string, ProjectAsset[]> = { ...this.assetCatalog }

      if (existingEntry) {
        const previousCategoryId = existingEntry.categoryId
        if (nextCatalog[previousCategoryId]) {
          nextCatalog[previousCategoryId] = nextCatalog[previousCategoryId]!.filter((item) => item.id !== asset.id)
        }
      }

      const registeredAsset: ProjectAsset = { ...asset }
      const currentList = nextCatalog[categoryId] ?? []
      nextCatalog[categoryId] = [...currentList.filter((item) => item.id !== registeredAsset.id), registeredAsset]

      this.assetCatalog = nextCatalog
      this.assetIndex = {
        ...this.assetIndex,
        [registeredAsset.id]: {
          categoryId,
          source: options.source,
        },
      }

      this.projectTree = createProjectTreeFromCache(this.assetCatalog, this.packageDirectoryCache)
      const commitOptions = options.commitOptions ?? { updateNodes: false, updateCamera: false }
      commitSceneSnapshot(this, commitOptions)
      void this.syncAssetPackageMapEntry(registeredAsset, options.source)
      return registeredAsset
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
        commitSceneSnapshot(this, { updateNodes: false, updateCamera: false })
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
      const targetAssetId = options.assetId ?? generateUuid()
      const fileName = buildNodePrefabFilename(prefabData.name)
      const blob = new Blob([serialized], { type: 'application/json' })
      const assetCache = useAssetCacheStore()
      await assetCache.storeAssetBlob(targetAssetId, {
        blob,
        mimeType: 'application/json',
        filename: fileName,
      })

      if (options.assetId) {
        const existing = this.getAsset(targetAssetId)
        if (!existing) {
          throw new Error('节点预制件资源不存在')
        }
        if (existing.type !== 'prefab') {
          throw new Error('指定资源并非节点预制件')
        }
        const updated: ProjectAsset = {
          ...existing,
          name: prefabData.name,
          description: fileName,
          previewColor: NODE_PREFAB_PREVIEW_COLOR,
        }
        const categoryId = determineAssetCategoryId(updated)
        const sourceMeta = this.assetIndex[targetAssetId]?.source
        return this.registerAsset(updated, {
          categoryId,
          source: sourceMeta,
          commitOptions: { updateNodes: false, updateCamera: false },
        })
      }

      const projectAsset: ProjectAsset = {
        id: targetAssetId,
        name: prefabData.name,
        type: 'prefab',
        downloadUrl: targetAssetId,
        previewColor: NODE_PREFAB_PREVIEW_COLOR,
        thumbnail: null,
        description: fileName,
        gleaned: true,
      }
      const categoryId = determineAssetCategoryId(projectAsset)
      const registered = this.registerAsset(projectAsset, {
        categoryId,
        source: { type: 'local' },
        commitOptions: { updateNodes: false, updateCamera: false },
      })
      if (options.select !== false) {
        this.setActiveDirectory(categoryId)
        this.selectAsset(registered.id)
      }
      return registered
    },
    async saveNodePrefab(nodeId: string, options: { assetId?: string; name?: string } = {}): Promise<ProjectAsset> {
      const node = findNodeById(this.nodes, nodeId)
      if (!node) {
        throw new Error('节点不存在或已被移除')
      }
      if (isGroundNode(node)) {
        throw new Error('地面节点无法保存为预制件')
      }

      const payload = buildSerializedPrefabPayload(node, {
        name: options.name ?? node.name ?? '',
        assetIndex: this.assetIndex,
        packageAssetMap: this.packageAssetMap,
        resetRootTransform: true,
      })

      const registered = await this.registerPrefabAssetFromData(payload.prefab, payload.serialized, {
        assetId: options.assetId,
      })

      this.captureHistorySnapshot()
      attachPrefabMetadata(node, registered.id)
      this.nodes = [...this.nodes]
      commitSceneSnapshot(this)

      return registered
    },
    async importPrefabAssetFromClipboard(serialized: string): Promise<ProjectAsset | null> {
      if (typeof serialized !== 'string' || !serialized.trim().length) {
        return null
      }
      try {
        const prefabData = deserializeNodePrefab(serialized)
        return await this.registerPrefabAssetFromData(prefabData, serialized)
      } catch (error) {
        console.warn('Invalid prefab clipboard payload', error)
        return null
      }
    },
    async loadNodePrefab(assetId: string): Promise<NodePrefabData> {
      const asset = this.getAsset(assetId)
      if (!asset) {
        throw new Error('节点预制件资源不存在')
      }
      if (asset.type !== 'prefab') {
        throw new Error('指定资源并非节点预制件')
      }

      const assetCache = useAssetCacheStore()
      let entry: AssetCacheEntry | null = assetCache.getEntry(assetId)
      if (!entry || entry.status !== 'cached' || !entry.blob) {
        entry = await assetCache.loadFromIndexedDb(assetId)
      }
      if ((!entry || !entry.blob) && asset.downloadUrl && /^https?:\/\//i.test(asset.downloadUrl)) {
        await assetCache.downloaProjectAsset(asset)
        entry = assetCache.getEntry(assetId)
      }
      if (!entry || !entry.blob) {
        throw new Error('无法加载节点预制件数据')
      }

      assetCache.touch(assetId)
      const text = await entry.blob.text()
      return deserializeNodePrefab(text)
    },
    async ensurePrefabDependencies(assetIds: string[], options: { providerId?: string | null } = {}) {
      const providerId = options.providerId ?? null
      const normalizedIds = Array.from(
        new Set(
          assetIds
            .map((value) => (typeof value === 'string' ? value.trim() : ''))
            .filter((value) => value.length > 0 && !value.startsWith(LOCAL_EMBEDDED_ASSET_PREFIX)),
        ),
      )

      if (!normalizedIds.length) {
        return
      }

      const assetCache = useAssetCacheStore()
      const missingIds = normalizedIds.filter((assetId) => !this.getAsset(assetId))

      if (missingIds.length && providerId) {
        const providerDirectories = this.packageDirectoryCache[providerId]
        if (providerDirectories?.length) {
          missingIds.forEach((assetId) => {
            const providerAsset = findAssetInTree(providerDirectories, assetId)
            if (providerAsset) {
              this.copyPackageAssetToAssets(providerId, providerAsset)
            }
          })
        } else {
          console.warn(`Provider ${providerId} is not loaded; prefab dependencies may be unavailable.`)
        }
      }

      const resolvedAssets: ProjectAsset[] = []
      normalizedIds.forEach((assetId) => {
        const asset = this.getAsset(assetId)
        if (asset) {
          resolvedAssets.push(asset)
        }
      })

      if (!resolvedAssets.length) {
        return
      }

      await Promise.all(
        resolvedAssets.map(async (asset) => {
          if (assetCache.hasCache(asset.id)) {
            assetCache.touch(asset.id)
            return
          }
          try {
            await assetCache.downloaProjectAsset(asset)
          } catch (error) {
            console.warn(`Failed to preload prefab dependency ${asset.id}`, error)
          }
        }),
      )
    },
    async instantiatePrefabData(
      prefab: NodePrefabData,
      options: {
        sourceAssetId?: string | null
        dependencyAssetIds?: string[]
        runtimeSnapshots?: Map<string, Object3D>
        position?: THREE.Vector3 | null
        providerId?: string | null
      } = {},
    ): Promise<SceneNode> {
      const dependencyAssetIds = options.dependencyAssetIds ?? collectPrefabAssetReferences(prefab.root)
      const dependencyFilter = dependencyAssetIds.length ? new Set(dependencyAssetIds) : undefined
      const providerId = options.providerId ?? null
      if (dependencyAssetIds.length) {
        await this.ensurePrefabDependencies(dependencyAssetIds, { providerId })
      }

      const prefabAssetIndex = prefab.assetIndex && isAssetIndex(prefab.assetIndex) ? prefab.assetIndex : undefined
      const prefabPackageAssetMap = prefab.packageAssetMap && isPackageAssetMap(prefab.packageAssetMap)
        ? prefab.packageAssetMap
        : undefined
      if (prefabAssetIndex || prefabPackageAssetMap) {
        const { next: mergedIndex, changed: assetIndexChanged } = mergeAssetIndexEntries(
          this.assetIndex,
          prefabAssetIndex,
          dependencyFilter,
        )
        if (assetIndexChanged) {
          this.assetIndex = mergedIndex
        }
        const { next: mergedPackageMap, changed: packageMapChanged } = mergePackageAssetMapEntries(
          this.packageAssetMap,
          prefabPackageAssetMap,
          dependencyFilter,
        )
        if (packageMapChanged) {
          this.packageAssetMap = mergedPackageMap
        }
      }

      const assetCache = useAssetCacheStore()
      const idMap = new Map<string, string>()
      const runtimeSnapshots = options.runtimeSnapshots ?? new Map<string, Object3D>()
      const duplicate = duplicateNodeTree(prefab.root, {
        assetCache,
        runtimeSnapshots,
        idMap,
        regenerateBehaviorIds: true,
      })
      const spawnPosition = options.position
        ? options.position.clone()
        : resolveSpawnPosition({
            baseY: 0,
            radius: DEFAULT_SPAWN_RADIUS,
            localCenter: new Vector3(0, 0, 0),
            camera: this.camera,
            nodes: this.nodes,
            snapToGrid: true,
          })
      duplicate.position = toPlainVector(spawnPosition)
      duplicate.rotation = duplicate.rotation ?? { x: 0, y: 0, z: 0 }
      duplicate.scale = duplicate.scale ?? { x: 1, y: 1, z: 1 }
      if (duplicate.nodeType === 'Group') {
        duplicate.groupExpanded = false
      }
      if (options.sourceAssetId) {
        attachPrefabMetadata(duplicate, options.sourceAssetId)
      } else if (duplicate.userData && isPlainRecord(duplicate.userData)) {
        const sanitized = clonePlainRecord(duplicate.userData as Record<string, unknown>)
        if (sanitized && PREFAB_SOURCE_METADATA_KEY in sanitized) {
          delete sanitized[PREFAB_SOURCE_METADATA_KEY]
          duplicate.userData = Object.keys(sanitized).length ? sanitized : undefined
        }
      }
      componentManager.syncNode(duplicate)
      return duplicate
    },
    async instantiateNodePrefabAsset(assetId: string, position?: THREE.Vector3): Promise<SceneNode> {
      const asset = this.getAsset(assetId)
      if (!asset) {
        throw new Error('节点预制件资源不存在')
      }
      if (asset.type !== 'prefab') {
        throw new Error('指定资源并非节点预制件')
      }

      const prefab = await this.loadNodePrefab(assetId)
      const sourceMeta = this.assetIndex[assetId]?.source ?? null
      const dependencyProviderId = sourceMeta && sourceMeta.type === 'package' ? sourceMeta.providerId ?? null : null
      const duplicate = await this.instantiatePrefabData(prefab, {
        sourceAssetId: assetId,
        position: position ?? null,
        providerId: dependencyProviderId,
      })

      this.captureHistorySnapshot()
      const nextNodes = [...this.nodes, duplicate]
      this.nodes = nextNodes
      await this.ensureSceneAssetsReady({ nodes: [duplicate], showOverlay: false })

      const boundingInfo = collectNodeBoundingInfo([duplicate])
      const duplicateBounds = boundingInfo.get(duplicate.id)?.bounds ?? null
      const spawnPosition = new Vector3(duplicate.position?.x ?? 0, duplicate.position?.y ?? 0, duplicate.position?.z ?? 0)
      if (duplicateBounds) {
        const currentMinY = duplicateBounds.min.y
        const desiredMinY = spawnPosition.y
        const offsetY = desiredMinY - currentMinY
        if (Math.abs(offsetY) > PREFAB_PLACEMENT_EPSILON) {
          const currentPosition = duplicate.position ?? { x: 0, y: 0, z: 0 }
          duplicate.position = {
            x: currentPosition.x,
            y: currentPosition.y + offsetY,
            z: currentPosition.z,
          }
          componentManager.syncNode(duplicate)
          this.nodes = [...this.nodes]
        }
      }
      useAssetCacheStore().recalculateUsage(this.nodes)
      if (duplicate.nodeType === 'Group') {
        duplicate.groupExpanded = false
      }
      this.setSelection([duplicate.id], { primaryId: duplicate.id })
      commitSceneSnapshot(this)
      return duplicate
    },
    async saveBehaviorPrefab(payload: {
      name: string
      action: BehaviorEventType
      sequence: SceneBehavior[]
    }): Promise<ProjectAsset> {
      const sanitized = createBehaviorPrefabData(payload)
      const serialized = serializeBehaviorPrefab(sanitized)
      const assetId = generateUuid()
      const fileName = buildBehaviorPrefabFilename(sanitized.name)
      const blob = new Blob([serialized], { type: 'application/json' })
      const assetCache = useAssetCacheStore()
      await assetCache.storeAssetBlob(assetId, {
        blob,
        mimeType: 'application/json',
        filename: fileName,
      })

      const projectAsset: ProjectAsset = {
        id: assetId,
        name: sanitized.name,
        type: 'behavior',
        downloadUrl: assetId,
        previewColor: BEHAVIOR_PREFAB_PREVIEW_COLOR,
        thumbnail: null,
        description: fileName,
        gleaned: true,
      }

      return this.registerAsset(projectAsset, {
        categoryId: determineAssetCategoryId(projectAsset),
        source: { type: 'local' },
        commitOptions: { updateNodes: false, updateCamera: false },
      })
    },
    async loadBehaviorPrefab(assetId: string): Promise<BehaviorPrefabData> {
      const asset = this.getAsset(assetId)
      if (!asset) {
        throw new Error('行为预制件资源不存在')
      }
      if (asset.type !== 'behavior') {
        throw new Error('指定资源并非行为预制件')
      }

      const assetCache = useAssetCacheStore()
      let entry: AssetCacheEntry | null = assetCache.getEntry(assetId)
      if (!entry || entry.status !== 'cached' || !entry.blob) {
        entry = await assetCache.loadFromIndexedDb(assetId)
      }
      if ((!entry || !entry.blob) && asset.downloadUrl && /^https?:\/\//i.test(asset.downloadUrl)) {
        await assetCache.downloaProjectAsset(asset)
        entry = assetCache.getEntry(assetId)
      }
      if (!entry || !entry.blob) {
        throw new Error('无法加载行为预制件数据')
      }

      assetCache.touch(assetId)
      const text = await entry.blob.text()
      return deserializeBehaviorPrefab(text)
    },
    async applyBehaviorPrefabToNode(
      nodeId: string,
      assetId: string,
    ): Promise<{ sequenceId: string; sequence: SceneBehavior[]; action: BehaviorEventType; name: string } | null> {
      const node = findNodeById(this.nodes, nodeId)
      if (!node) {
        return null
      }

      const asset = this.getAsset(assetId)
      if (!asset) {
        throw new Error('行为预制件资源不存在')
      }
      if (asset.type !== 'behavior') {
        throw new Error('指定资源并非行为预制件')
      }

      const prefab = await this.loadBehaviorPrefab(assetId)
      const instantiated = instantiateBehaviorPrefab(prefab, { nodeId })

      if (!node.components?.[BEHAVIOR_COMPONENT_TYPE]) {
        const created = this.addNodeComponent(nodeId, BEHAVIOR_COMPONENT_TYPE)
        if (!created) {
          throw new Error('无法为节点添加行为组件')
        }
      }

      const refreshedNode = findNodeById(this.nodes, nodeId)
      const behaviorComponent = refreshedNode?.components?.[BEHAVIOR_COMPONENT_TYPE] as
        | SceneNodeComponentState<BehaviorComponentProps>
        | undefined
      if (!behaviorComponent) {
        throw new Error('行为组件不可用')
      }

      const currentList = extractBehaviorList(behaviorComponent)
      const newSequence = cloneBehaviorList(instantiated.sequence)
      const nextList: SceneBehavior[] = []
      let inserted = false

      currentList.forEach((step) => {
        if (!inserted && step.action === instantiated.action) {
          nextList.push(...newSequence)
          inserted = true
        }
        if (step.action !== instantiated.action) {
          nextList.push(step)
        }
      })

      if (!inserted) {
        nextList.push(...newSequence)
      }

      const updated = this.updateNodeComponentProps(nodeId, behaviorComponent.id, {
        behaviors: cloneBehaviorList(nextList),
      })

      if (!updated) {
        return null
      }

      return instantiated
    },
    copyPackageAssetToAssets(providerId: string, asset: ProjectAsset): ProjectAsset {
      const mapKey = `${providerId}::${asset.id}`
      const existingId = this.packageAssetMap[mapKey]
      if (existingId) {
        const existingAsset = this.getAsset(existingId)
        if (existingAsset) {
          return existingAsset
        }
        const { [mapKey]: _removed, ...rest } = this.packageAssetMap
        this.packageAssetMap = rest
      }

      const assetClone: ProjectAsset = {
        ...asset,
        gleaned: true
      }
      const categoryId = determineAssetCategoryId(assetClone)
      const registered = this.registerAsset(assetClone, {
        categoryId,
        source: {
          type: 'package',
          providerId,
          originalAssetId: asset.id,
        },
      })

      this.packageAssetMap = {
        ...this.packageAssetMap,
        [mapKey]: registered.id,
      }

      return registered
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

      const catalogAssets = new Map<string, ProjectAsset>()
      Object.values(this.assetCatalog).forEach((list) => {
        list.forEach((asset) => {
          catalogAssets.set(asset.id, asset)
        })
      })

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
      this.assetCatalog = nextCatalog
      this.projectTree = createProjectTreeFromCache(this.assetCatalog, this.packageDirectoryCache)
      if (this.activeDirectoryId && !findDirectory(this.projectTree, this.activeDirectoryId)) {
        this.activeDirectoryId = defaultDirectoryId
      }
      if (this.selectedAssetId && assetIdSet.has(this.selectedAssetId)) {
        this.selectedAssetId = null
      }

      const nextIndex = { ...this.assetIndex }
      deletableIds.forEach((assetId) => {
        delete nextIndex[assetId]
      })
      this.assetIndex = nextIndex

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
      this.packageAssetMap = nextPackageMap

      nonMaterialAssetIds.forEach((assetId) => {
        assetCache.removeCache(assetId)
      })

      if (deletableIds.length) {
        commitSceneSnapshot(this, { updateNodes: false, updateCamera: false })
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
      this.assetCatalog = nextCatalog

      const nextIndex = { ...this.assetIndex }
      delete nextIndex[localAssetId]
      nextIndex[storedAsset.id] = {
        categoryId: nextCategoryId,
        source: options.source ?? { type: 'url' },
      }
      this.assetIndex = nextIndex

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
      this.packageAssetMap = nextPackageMap

      replaceAssetIdInMaterials(this.materials, localAssetId, storedAsset.id)
      replaceAssetIdInNodes(this.nodes, localAssetId, storedAsset.id)
      this.materials = [...this.materials]
      this.nodes = [...this.nodes]

      if (this.selectedAssetId === localAssetId) {
        this.selectedAssetId = storedAsset.id
      }
      if (this.draggingAssetId === localAssetId) {
        this.draggingAssetId = storedAsset.id
      }

      this.projectTree = createProjectTreeFromCache(this.assetCatalog, this.packageDirectoryCache)

      const assetCache = useAssetCacheStore()
      assetCache.recalculateUsage(this.nodes)

      commitSceneSnapshot(this, { updateNodes: true, updateCamera: false })
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
      commitSceneSnapshot(this, { updateNodes: false, updateCamera: false })
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
    setShadowsEnabled(enabled: boolean) {
      const next = normalizeShadowsEnabledInput(enabled)
      if (this.shadowsEnabled === next) {
        return
      }
      this.shadowsEnabled = next
      commitSceneSnapshot(this, { updateNodes: false, updateCamera: false })
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
      commitSceneSnapshot(this, { updateNodes: false, updateCamera: false })
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
      commitSceneSnapshot(this, { updateNodes: false, updateCamera: false })
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

      this.nodes = [...this.nodes]
      if (options.commit) {
        commitSceneSnapshot(this)
      }
      return true
    },

    recenterGroupAncestry(
      startGroupId: string | null,
      options: { captureHistory?: boolean; parentMap?: Map<string, string | null> } = {},
    ) {
      if (!startGroupId) {
        return false
      }
      const parentMap = options.parentMap ?? buildParentMap(this.nodes)
      const visited = new Set<string>()
      let current: string | null = startGroupId
      let changed = false
      let isFirst = true
      const captureFirst = options.captureHistory === true

      while (current) {
        if (visited.has(current)) {
          break
        }
        const recentered = this.recenterGroupNode(current, {
          captureHistory: captureFirst && isFirst,
          commit: false,
          parentMap,
        })
        if (recentered) {
          changed = true
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

    isDescendant(ancestorId: string, maybeChildId: string) {
      if (!ancestorId || !maybeChildId) return false
      if (ancestorId === maybeChildId) return true
      return isDescendantNode(this.nodes, ancestorId, maybeChildId)
    },
    nodeAllowsChildCreation(nodeId: string | null) {
      if (!nodeId) {
        return true
      }
      const node = findNodeById(this.nodes, nodeId)
      return allowsChildNodes(node)
    },

    moveNode(payload: { nodeId: string; targetId: string | null; position: HierarchyDropPosition }) {
      const { nodeId, targetId, position } = payload
      if (!nodeId) return false
      if (targetId && nodeId === targetId) return false
      if (nodeId === GROUND_NODE_ID || nodeId === SKY_NODE_ID || nodeId === ENVIRONMENT_NODE_ID) {
        return false
      }

      if (targetId && isDescendantNode(this.nodes, nodeId, targetId)) {
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

      this.captureHistorySnapshot()
      this.nodes = tree
      const postMoveParentMap = buildParentMap(this.nodes)
      if (oldParentId) {
        this.recenterGroupAncestry(oldParentId, { captureHistory: false, parentMap: postMoveParentMap })
      }
      if (newParentId && newParentId !== oldParentId) {
        this.recenterGroupAncestry(newParentId, { captureHistory: false, parentMap: postMoveParentMap })
      }
      commitSceneSnapshot(this)
      return true
    },

  addPlaceholderNode(asset: ProjectAsset, transform: { position: Vector3Like; rotation: Vector3Like; scale: Vector3Like }) {
      const id = generateUuid()
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
        position: cloneVector(transform.position),
        rotation: cloneVector(transform.rotation),
        scale: cloneVector(transform.scale),
        visible: true,
        sourceAssetId: asset.id,
        isPlaceholder: true,
        downloadProgress: 0,
        downloadStatus: 'downloading',
        downloadError: null,
      }

      this.nodes = [node, ...this.nodes]
      this.setSelection([id])

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
            this.nodes = [...this.nodes]
            void this.finalizePlaceholderNode(nodeId, asset)
            return
          }

          if (snapshot.status === 'error') {
            target.downloadStatus = 'error'
            changed = true
            stopPlaceholderWatcher(nodeId)
            if (changed) {
              this.nodes = [...this.nodes]
            }
            return
          }

          const nextStatus = snapshot.status === 'downloading' ? 'downloading' : 'idle'
          if (target.downloadStatus !== nextStatus) {
            target.downloadStatus = nextStatus
            changed = true
          }

          if (changed) {
            this.nodes = [...this.nodes]
          }
        },
        { immediate: true },
      )

      placeholderDownloadWatchers.set(nodeId, stop)
    },

    async finalizePlaceholderNode(nodeId: string, asset: ProjectAsset) {
      const assetCache = useAssetCacheStore()
      const placeholder = findNodeById(this.nodes, nodeId)
      if (!placeholder) {
        return
      }

      try {
        const shouldCacheModelObject = asset.type === 'model'
        let baseObject: Object3D | null = null

        if (shouldCacheModelObject) {
          baseObject = getCachedModelObject(asset.id)
        }

        if (!baseObject) {
          const file = assetCache.createFileFromCache(asset.id)
          if (!file) {
            throw new Error('资源未缓存完成')
          }
          baseObject = shouldCacheModelObject
            ? await getOrLoadModelObject(asset.id, () => loadObjectFromFile(file))
            : await loadObjectFromFile(file)
          if (shouldCacheModelObject) {
            assetCache.releaseInMemoryBlob(asset.id)
          }
        }

        if (!baseObject) {
          throw new Error('资源加载失败')
        }

        const workingObject = baseObject.clone(true)
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

        const metrics = computeObjectMetrics(workingObject)
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
        const nodeType = resolveSceneNodeTypeFromObject(workingObject)
        const positionVector = toPlainVector(localPosition)
        const scaleVector = toPlainVector(localScale)
        const rotationVector: Vector3Like = { x: localEuler.x, y: localEuler.y, z: localEuler.z }

        const { tree, node: removedPlaceholder } = detachNodeImmutable(this.nodes, nodeId)
        if (!removedPlaceholder) {
          throw new Error('占位节点不存在')
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

        registerRuntimeObject(newNodeId, workingObject)
        tagObjectWithNodeId(workingObject, newNodeId)
        componentManager.attachRuntime(newNode, workingObject)
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

        assetCache.registerUsage(asset.id)
        assetCache.touch(asset.id)

        commitSceneSnapshot(this)
      } catch (error) {
        placeholder.isPlaceholder = true
        placeholder.downloadStatus = 'error'
        placeholder.downloadError = (error as Error).message ?? '资源加载失败'
        this.nodes = [...this.nodes]
      }
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
      let workingObject: Object3D
      let name = payload.name
      let sourceAssetId = payload.sourceAssetId
      let assetCache: ReturnType<typeof useAssetCacheStore> | null = null
      let registerAssetId: string | null = null

      
      if (payload.asset) {
        const asset = payload.asset
        if (asset.type !== 'model' && asset.type !== 'mesh') {
          return null
        }

        assetCache = useAssetCacheStore()
        const cached = getCachedModelObject(asset.id)
        if (cached) {
          workingObject = cached.clone(true)
        } else {
          if (!assetCache.hasCache(asset.id)) {
            return null
          }
          const file = assetCache.createFileFromCache(asset.id)
          if (!file) {
            throw new Error('Missing asset data in cache')
          }
          const baseObject = await getOrLoadModelObject(asset.id, () => loadObjectFromFile(file))
          assetCache.releaseInMemoryBlob(asset.id)
          workingObject = baseObject.clone(true)
        }

        name = name ?? asset.name
        sourceAssetId = sourceAssetId ?? asset.id
        registerAssetId = asset.id
      } else {
        workingObject = payload.object!
        name = name ?? workingObject.name ?? 'Imported Mesh'
      }

      const metrics = computeObjectMetrics(workingObject)
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

      const nodeType = payload.nodeType ?? resolveSceneNodeTypeFromObject(workingObject)

      const node = this.addSceneNode({
        nodeType,
        object: workingObject,
        name: name ?? workingObject.name ?? 'Imported Mesh',
        position: toPlainVector(localPosition),
        rotation,
        scale,
        sourceAssetId: sourceAssetId ?? undefined,
        parentId: targetParentId ?? undefined,
        editorFlags: payload.editorFlags,
        userData: clonePlainRecord(workingObject.userData as Record<string, unknown> | undefined),
      })

      if (registerAssetId && assetCache) {
        assetCache.registerUsage(registerAssetId)
        assetCache.touch(registerAssetId)
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
            commitOptions: { updateNodes: false, updateCamera: false },
          })
          modelAssetId = ensured.asset.id
          assetCache.registerUsage(modelAssetId)
          assetCache.touch(modelAssetId)
        } catch (error) {
          console.warn('缓存导入场景资源失败', error)
        }
      }

      const context: ExternalSceneImportContext = {
        assetCache,
        registerAsset: (asset, registerOptions) => this.registerAsset(asset, {
          ...registerOptions,
          commitOptions: { updateNodes: false, updateCamera: false },
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
      assetCache.recalculateUsage(this.nodes)
      return importedIds
    },

    addSceneNode(payload: {
      nodeType: SceneNodeType
      object: Object3D
      name?: string
      position?: Vector3Like
      rotation?: Vector3Like
      scale?: Vector3Like
      sourceAssetId?: string
      dynamicMesh?: SceneDynamicMesh
      components?: SceneNodeComponentMap
      parentId?: string | null
      editorFlags?: SceneNodeEditorFlags
      userData?: Record<string, unknown>
    }) {
      this.captureHistorySnapshot()
      const id = generateUuid()
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
      if (parentId) {
        const parentMap = buildParentMap(this.nodes)
        this.recenterGroupAncestry(parentId, { captureHistory: false, parentMap })
      }
      this.setSelection([id], { primaryId: id })
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
      const visitNodes = (list: SceneNode[]) => {
        list.forEach((node) => {
          const ensured = ensureDynamicMeshRuntime(node) || ensureAiModelMeshRuntime(node)
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
        this.nodes = [...this.nodes]
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
    generateSurfaceNodeName() {
      const prefix = 'Surface '
      const taken = new Set<string>()
      const collect = (nodes: SceneNode[]) => {
        nodes.forEach((node) => {
          if (typeof node.name === 'string' && node.name.startsWith(prefix)) {
            taken.add(node.name)
          }
          if (Array.isArray(node.children) && node.children.length) {
            collect(node.children)
          }
        })
      }
      collect(this.nodes)
      for (let index = 1; index < 1000; index += 1) {
        const candidate = `${prefix}${index.toString().padStart(2, '0')}`
        if (!taken.has(candidate)) {
          return candidate
        }
      }
      let nextIndex = 1
      taken.forEach((name) => {
        const parsed = Number.parseInt(name.slice(prefix.length), 10)
        if (Number.isFinite(parsed) && parsed >= nextIndex) {
          nextIndex = parsed + 1
        }
      })
      return `${prefix}${nextIndex.toString().padStart(2, '0')}`
    },
    createWallNode(payload: {
      segments: Array<{ start: Vector3Like; end: Vector3Like }>
      dimensions?: { height?: number; width?: number; thickness?: number }
      name?: string
    }): SceneNode | null {
      const build = buildWallDynamicMeshFromWorldSegments(payload.segments, payload.dimensions)
      if (!build) {
        return null
      }

      const wallGroup = createWallGroup(build.definition)
      const nodeName = payload.name ?? this.generateWallNodeName()
      const node = this.addSceneNode({
        nodeType: 'Mesh',
        object: wallGroup,
        name: nodeName,
        position: createVector(build.center.x, build.center.y, build.center.z),
        rotation: createVector(0, 0, 0),
        scale: createVector(1, 1, 1),
        dynamicMesh: build.definition,
      })
      return node
    },
    createSurfaceNode(payload: { points: Vector3Like[]; name?: string }): SceneNode | null {
      const build = buildSurfaceDynamicMeshFromWorldPoints(payload.points)
      if (!build) {
        return null
      }
      const mesh = createSurfaceMesh(build.definition)
      mesh.name = payload.name ?? 'Surface'
      const node = this.addSceneNode({
        nodeType: 'Mesh',
        object: mesh,
        name: payload.name ?? this.generateSurfaceNodeName(),
        position: createVector(build.center.x, build.center.y, build.center.z),
        rotation: createVector(0, 0, 0),
        scale: createVector(1, 1, 1),
        dynamicMesh: build.definition,
      })
      return node
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
      const recentered = parentId
        ? this.recenterGroupAncestry(parentId, { captureHistory: false, parentMap })
        : false
      if (!recentered) {
        this.nodes = [...this.nodes]
      }
      commitSceneSnapshot(this)

      const runtime = getRuntimeObject(nodeId)
      if (runtime) {
        updateWallGroup(runtime, build.definition)
      }
      return true
    },
    setWallNodeDimensions(nodeId: string, dimensions: { height?: number; width?: number; thickness?: number }): boolean {
      const node = findNodeById(this.nodes, nodeId)
      if (!node || node.dynamicMesh?.type !== 'Wall') {
        return false
      }

      const current = resolveWallComponentPropsFromMesh(node.dynamicMesh)
      const targetProps = clampWallProps({
        height: dimensions.height ?? current.height,
        width: dimensions.width ?? current.width,
        thickness: dimensions.thickness ?? current.thickness,
      })

  const wallComponent = node.components?.[WALL_COMPONENT_TYPE] as SceneNodeComponentState<WallComponentProps> | undefined
  const componentProps = wallComponent ? (wallComponent.props as WallComponentProps) : current

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

      this.captureHistorySnapshot()

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

        // 深度克隆 metadata 以确保可以被 IndexedDB 序列化
        let clonedMetadata: Record<string, unknown> | undefined
        if (previous?.metadata) {
          try {
            clonedMetadata = structuredClone(previous.metadata)
          } catch (_error) {
            try {
              clonedMetadata = JSON.parse(JSON.stringify(previous.metadata)) as Record<string, unknown>
            } catch (_jsonError) {
              console.warn('Failed to deeply clone wall component metadata, using shallow copy', _jsonError)
              clonedMetadata = { ...previous.metadata }
            }
          }
        }

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

      this.nodes = [...this.nodes]
      const normalizedNode = findNodeById(this.nodes, nodeId)
      if (normalizedNode) {
        componentManager.syncNode(normalizedNode)
      }
      commitSceneSnapshot(this)
      return true
    },
    addNodeComponent(nodeId: string, type: NodeComponentType): SceneNodeComponentState | null {
      const target = findNodeById(this.nodes, nodeId)
      if (!target) {
        return null
      }
      const definition = componentManager.getDefinition(type)
      if (!definition || !definition.canAttach(target)) {
        return null
      }
      if (target.components?.[type]) {
        return null
      }

      const props = definition.createDefaultProps(target)
      const state: SceneNodeComponentState<any> = {
        id: generateUuid(),
        type,
        enabled: true,
        props,
      }

      this.captureHistorySnapshot()

      visitNode(this.nodes, nodeId, (node) => {
        const nextComponents: SceneNodeComponentMap = { ...(node.components ?? {}) }
        nextComponents[type] = {
          ...state,
        }
        node.components = nextComponents
        if (type === WALL_COMPONENT_TYPE) {
          applyWallComponentPropsToNode(node, props as unknown as WallComponentProps)
        } else if (type === DISPLAY_BOARD_COMPONENT_TYPE) {
          applyDisplayBoardComponentPropsToNode(node, props as unknown as DisplayBoardComponentProps)
        }
      })

      this.nodes = [...this.nodes]
      const updatedNode = findNodeById(this.nodes, nodeId)
      if (updatedNode) {
        componentManager.syncNode(updatedNode)
      }
      commitSceneSnapshot(this)
      return state
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

      this.nodes = [...this.nodes]
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
          enabled,
        }
        node.components = nextComponents
      })

      this.nodes = [...this.nodes]
      const updatedNode = findNodeById(this.nodes, nodeId)
      if (updatedNode) {
        componentManager.syncNode(updatedNode)
      }
      commitSceneSnapshot(this)
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
        | DisplayBoardComponentProps
        | WarpGateComponentProps
        | EffectComponentProps
      if (type === WALL_COMPONENT_TYPE) {
        const currentProps = component.props as WallComponentProps
        const merged = clampWallProps({
          height: (patch.height as number | undefined) ?? currentProps.height,
          width: (patch.width as number | undefined) ?? currentProps.width,
          thickness: (patch.thickness as number | undefined) ?? currentProps.thickness,
        })
        if (
          Math.abs(currentProps.height - merged.height) <= WALL_DIMENSION_EPSILON &&
          Math.abs(currentProps.width - merged.width) <= WALL_DIMENSION_EPSILON &&
          Math.abs(currentProps.thickness - merged.thickness) <= WALL_DIMENSION_EPSILON
        ) {
          return false
        }
        nextProps = cloneWallComponentProps(merged)
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
        } else if (currentType === DISPLAY_BOARD_COMPONENT_TYPE) {
          applyDisplayBoardComponentPropsToNode(node, nextProps as DisplayBoardComponentProps)
        }
      })

      this.nodes = [...this.nodes]
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
      
      // 深度克隆 metadata 以确保可以被 IndexedDB 序列化
      let clonedMetadata: Record<string, unknown> | undefined
      if (metadata) {
        try {
          clonedMetadata = structuredClone(metadata)
        } catch (_error) {
          // 如果 structuredClone 失败，尝试使用 JSON 序列化
          try {
            clonedMetadata = JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>
          } catch (_jsonError) {
            // 如果都失败了，使用浅拷贝作为最后手段
            console.warn('Failed to deeply clone component metadata, using shallow copy', _jsonError)
            clonedMetadata = { ...metadata }
          }
        }
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
          metadata: clonedMetadata,
        }
        node.components = componentCount(nextComponents) ? nextComponents : undefined
      })

      this.nodes = [...this.nodes]
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
        (id) => id !== GROUND_NODE_ID && id !== SKY_NODE_ID && id !== ENVIRONMENT_NODE_ID && !!findNodeById(this.nodes, id),
      )
      if (!existingIds.length) {
        return
      }
      const idSet = new Set(existingIds)
      const parentMap = buildParentMap(this.nodes)
      const affectedParentIds = new Set<string>()
      existingIds.forEach((id) => {
        const parentId = parentMap.get(id) ?? null
        if (parentId) {
          affectedParentIds.add(parentId)
        }
      })

      this.captureHistorySnapshot()

      const removed: string[] = []
      this.nodes = pruneNodes(this.nodes, idSet, removed)

      removed.forEach((id) => stopPlaceholderWatcher(id))

      affectedParentIds.forEach((parentId) => {
        if (!findNodeById(this.nodes, parentId)) {
          return
        }
        this.recenterGroupAncestry(parentId, { captureHistory: false })
      })

      const prevSelection = cloneSelection(this.selectedNodeIds)
      const nextSelection = prevSelection.filter((id) => !removed.includes(id))
      this.setSelection(nextSelection)
      const assetCache = useAssetCacheStore()
      assetCache.recalculateUsage(this.nodes)
      commitSceneSnapshot(this)
    },

    groupSelection(): boolean {
      const selection = Array.from(new Set(this.selectedNodeIds))
      if (selection.length < 2) {
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

      if (validIds.length < 2) {
        return false
      }

      const topLevelIds = filterTopLevelNodeIds(validIds, parentMap)
      if (topLevelIds.length < 2) {
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
        siblings.splice(safeIndex, 0, groupNode)
        parentNode.children = siblings
        tree = [...tree]
      } else {
        const nextTree = [...tree]
        const safeIndex = Math.min(Math.max(insertionIndex, 0), nextTree.length)
        nextTree.splice(safeIndex, 0, groupNode)
        tree = nextTree
      }

      this.captureHistorySnapshot()

      this.nodes = tree
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

      this.captureHistorySnapshot()

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
      })

      if (!duplicates.length) {
        return []
      }

      this.nodes = working
      affectedParentIds.forEach((parentId) => {
        if (!findNodeById(this.nodes, parentId)) {
          return
        }
        this.recenterGroupAncestry(parentId, { captureHistory: false })
      })
      assetCache.recalculateUsage(this.nodes)

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
      const { entries, runtimeSnapshots } = collectClipboardPayload(this.nodes, nodeIds, {
        assetIndex: this.assetIndex,
        packageAssetMap: this.packageAssetMap,
      })
      if (!entries.length) {
        this.clipboard = null
        return false
      }
      this.clipboard = {
        entries,
        runtimeSnapshots,
        cut: false,
      }
      void writePrefabToSystemClipboard(entries[0]?.serialized ?? '')
      return true
    },
    cutNodes(nodeIds: string[]) {
      const success = this.copyNodes(nodeIds)
      if (!success || !this.clipboard) {
        return false
      }
      this.clipboard.cut = true
      const idsToRemove = this.clipboard.entries.map((entry) => entry.sourceId)
      if (idsToRemove.length) {
        this.removeSceneNodes(idsToRemove)
      }
      return true
    },
    async pasteClipboard(targetId?: string | null): Promise<boolean> {
      let clipboardEntries = this.clipboard?.entries ?? []
      let runtimeSnapshots = this.clipboard?.runtimeSnapshots ?? new Map<string, Object3D>()

      if (!clipboardEntries.length) {
        const systemPrefab = await readPrefabFromSystemClipboard()
        if (!systemPrefab) {
          return false
        }
        clipboardEntries = [
          {
            sourceId: systemPrefab.root.id,
            prefab: systemPrefab,
            serialized: serializeNodePrefab(systemPrefab),
            dependencyAssetIds: collectPrefabAssetReferences(systemPrefab.root),
          },
        ]
        runtimeSnapshots = new Map<string, Object3D>()
      }

      if (!clipboardEntries.length) {
        return false
      }

      const resolveParentId = (): string | null => {
        const candidateId = targetId ?? this.selectedNodeId ?? null
        if (!candidateId) {
          return null
        }
        if (candidateId === GROUND_NODE_ID || candidateId === SKY_NODE_ID || candidateId === ENVIRONMENT_NODE_ID) {
          return null
        }
        if (this.isNodeSelectionLocked(candidateId)) {
          return null
        }
        return findNodeById(this.nodes, candidateId) ? candidateId : null
      }

      const parentId = resolveParentId()
      const workingNodes = cloneSceneNodes(this.nodes)
      const instantiated: SceneNode[] = []

      for (const entry of clipboardEntries) {
        const instance = await this.instantiatePrefabData(entry.prefab, {
          dependencyAssetIds: entry.dependencyAssetIds,
          runtimeSnapshots,
        })
        if (parentId) {
          const inserted = insertNodeMutable(workingNodes, parentId, instance, 'inside')
          if (!inserted) {
            workingNodes.push(instance)
          } else {
            instance.position = { x: 0, y: 0, z: 0 }
            instance.rotation = instance.rotation ?? { x: 0, y: 0, z: 0 }
            instance.scale = instance.scale ?? { x: 1, y: 1, z: 1 }
            componentManager.syncNode(instance)
          }
        } else {
          workingNodes.push(instance)
        }
        instantiated.push(instance)
      }

      if (!instantiated.length) {
        return false
      }

      this.captureHistorySnapshot()
      this.nodes = workingNodes
      await this.ensureSceneAssetsReady({ nodes: instantiated, showOverlay: false })

      const boundingInfo = collectNodeBoundingInfo(instantiated)
      let adjusted = false
      instantiated.forEach((node) => {
        const bounds = boundingInfo.get(node.id)?.bounds ?? null
        if (!bounds) {
          return
        }
        const spawnPosition = new Vector3(node.position?.x ?? 0, node.position?.y ?? 0, node.position?.z ?? 0)
        const offsetY = spawnPosition.y - bounds.min.y
        if (Math.abs(offsetY) > PREFAB_PLACEMENT_EPSILON) {
          const currentPosition = node.position ?? { x: 0, y: 0, z: 0 }
          node.position = {
            x: currentPosition.x,
            y: currentPosition.y + offsetY,
            z: currentPosition.z,
          }
          componentManager.syncNode(node)
          adjusted = true
        }
      })
      if (adjusted) {
        this.nodes = [...this.nodes]
      }

      if (parentId) {
        this.recenterGroupAncestry(parentId, { captureHistory: false })
      }

      useAssetCacheStore().recalculateUsage(this.nodes)
      const createdIds = instantiated.map((node) => node.id)
      this.setSelection(createdIds)
      commitSceneSnapshot(this)

      if (this.clipboard?.cut) {
        this.clipboard = null
      }
      return true
    },
    clearClipboard() {
      this.clipboard = null
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
      await scenesStore.saveSceneDocument(document)
      applyCurrentSceneMeta(this, document)
      this.hasUnsavedChanges = false
      return document
    },
    async createScene(
      name = 'Untitled Scene',
      thumbnailOrOptions?: string | null | { thumbnail?: string | null; groundSettings?: Partial<GroundSettings> },
    ) {
      const scenesStore = useScenesStore()
      const displayName = name.trim() || 'Untitled Scene'
      let resolvedThumbnail: string | null | undefined
      let resolvedGroundOptions: Partial<GroundSettings> | undefined
      if (thumbnailOrOptions && typeof thumbnailOrOptions === 'object' && !Array.isArray(thumbnailOrOptions)) {
        resolvedThumbnail = thumbnailOrOptions.thumbnail ?? null
        resolvedGroundOptions = thumbnailOrOptions.groundSettings
      } else {
        resolvedThumbnail = (thumbnailOrOptions ?? null) as string | null
      }

      const groundSettings = cloneGroundSettings(resolvedGroundOptions ?? this.groundSettings)
      const baseNodes = createDefaultSceneNodes(groundSettings)
      const baseAssetCatalog = cloneAssetCatalog(initialAssetCatalog)
      const baseAssetIndex = cloneAssetIndex(initialAssetIndex)

      const sceneDocument = createSceneDocument(displayName, {
        thumbnail: resolvedThumbnail ?? null,
        resourceProviderId: this.resourceProviderId,
        viewportSettings: this.viewportSettings,
        skybox: this.skybox,
        shadowsEnabled: this.shadowsEnabled,
        nodes: baseNodes,
        materials: this.materials,
        groundSettings,
        assetCatalog: baseAssetCatalog,
        assetIndex: baseAssetIndex,
        packageAssetMap: {},
        panelVisibility: this.panelVisibility,
        panelPlacement: this.panelPlacement,
      })

      await scenesStore.saveSceneDocument(sceneDocument)
      this.currentSceneId = sceneDocument.id
      applyCurrentSceneMeta(this, sceneDocument)
      applySceneAssetState(this, sceneDocument)
      this.nodes = cloneSceneNodes(sceneDocument.nodes)
      this.environment = resolveSceneDocumentEnvironment(sceneDocument)
      this.rebuildGeneratedMeshRuntimes()
      this.groundSettings = cloneGroundSettings(sceneDocument.groundSettings)
      this.setSelection(sceneDocument.selectedNodeIds ?? (sceneDocument.selectedNodeId ? [sceneDocument.selectedNodeId] : []))
      this.camera = cloneCameraState(sceneDocument.camera)
      this.viewportSettings = cloneViewportSettings(sceneDocument.viewportSettings)
      this.skybox = cloneSkyboxSettings(sceneDocument.skybox)
      this.shadowsEnabled = normalizeShadowsEnabledInput(sceneDocument.shadowsEnabled)
      this.panelVisibility = normalizePanelVisibilityState(sceneDocument.panelVisibility)
      this.panelPlacement = normalizePanelPlacementStateInput(sceneDocument.panelPlacement)
      this.resourceProviderId = sceneDocument.resourceProviderId
      useAssetCacheStore().recalculateUsage(this.nodes)
      this.isSceneReady = true
      this.hasUnsavedChanges = false
      return sceneDocument.id
    },
    async createSceneFromTemplate(
      name: string,
      template: PresetSceneDocument,
      options: { groundWidth?: number; groundDepth?: number } = {},
    ) {
      const scenesStore = useScenesStore()
      const displayName = name.trim() || template.name?.trim() || 'Untitled Scene'

      const fallbackWidth = this.groundSettings.width
      const fallbackDepth = this.groundSettings.depth
      const widthCandidate = options.groundWidth ?? template.groundSettings?.width ?? fallbackWidth
      const depthCandidate = options.groundDepth ?? template.groundSettings?.depth ?? fallbackDepth

      const groundSettings = cloneGroundSettings({
        width: widthCandidate,
        depth: depthCandidate,
      })

      const nodes = Array.isArray(template.nodes) && template.nodes.length
        ? (template.nodes as SceneNode[])
        : createDefaultSceneNodes(groundSettings)
      const materials = Array.isArray(template.materials) && template.materials.length
        ? (template.materials as SceneMaterial[])
        : undefined

      const selectedNodeId = typeof template.selectedNodeId === 'string' ? template.selectedNodeId : null
      const selectedNodeIds = Array.isArray(template.selectedNodeIds)
        ? (template.selectedNodeIds as unknown[]).filter((id): id is string => typeof id === 'string')
        : undefined
      const cameraState = normalizeCameraStateInput(template.camera) ?? this.camera

      const sceneDocument = createSceneDocument(displayName, {
        nodes,
        materials,
        selectedNodeId,
        selectedNodeIds,
        camera: cameraState,
        thumbnail: typeof template.thumbnail === 'string' ? template.thumbnail : null,
        resourceProviderId: typeof template.resourceProviderId === 'string'
          ? template.resourceProviderId
          : this.resourceProviderId,
        assetCatalog: isAssetCatalog(template.assetCatalog)
          ? (template.assetCatalog as Record<string, ProjectAsset[]>)
          : undefined,
        assetIndex: isAssetIndex(template.assetIndex)
          ? (template.assetIndex as Record<string, AssetIndexEntry>)
          : undefined,
        packageAssetMap: isPackageAssetMap(template.packageAssetMap)
          ? (template.packageAssetMap as Record<string, string>)
          : undefined,
        viewportSettings: normalizeViewportSettingsInput(template.viewportSettings),
        skybox: template.skybox,
        shadowsEnabled: template.shadowsEnabled,
        panelVisibility: normalizePanelVisibilityInput(template.panelVisibility),
        panelPlacement: normalizePanelPlacementInput(template.panelPlacement),
        groundSettings,
        environment: template.environment,
      })

      const timestamp = new Date().toISOString()
      sceneDocument.createdAt = timestamp
      sceneDocument.updatedAt = timestamp

      await scenesStore.saveSceneDocument(sceneDocument)

      this.currentSceneId = sceneDocument.id
      applyCurrentSceneMeta(this, sceneDocument)
      applySceneAssetState(this, sceneDocument)
      this.nodes = cloneSceneNodes(sceneDocument.nodes)
      this.environment = resolveSceneDocumentEnvironment(sceneDocument)
      this.groundSettings = cloneGroundSettings(sceneDocument.groundSettings)
      this.setSelection(sceneDocument.selectedNodeIds ?? (sceneDocument.selectedNodeId ? [sceneDocument.selectedNodeId] : []))
      this.camera = cloneCameraState(sceneDocument.camera)
      this.viewportSettings = cloneViewportSettings(sceneDocument.viewportSettings)
      this.skybox = cloneSkyboxSettings(sceneDocument.skybox)
      this.shadowsEnabled = normalizeShadowsEnabledInput(sceneDocument.shadowsEnabled)
      this.panelVisibility = normalizePanelVisibilityState(sceneDocument.panelVisibility)
      this.panelPlacement = normalizePanelPlacementStateInput(sceneDocument.panelPlacement)
      this.resourceProviderId = sceneDocument.resourceProviderId
      useAssetCacheStore().recalculateUsage(this.nodes)
      this.isSceneReady = true
      this.hasUnsavedChanges = false
      return sceneDocument.id
    },
    async selectScene(sceneId: string) {
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

        this.currentSceneId = sceneId
        applyCurrentSceneMeta(this, scene)
        applySceneAssetState(this, scene)
        this.nodes = cloneSceneNodes(scene.nodes)
        this.environment = resolveSceneDocumentEnvironment(scene)
        this.rebuildGeneratedMeshRuntimes()
        this.setSelection(scene.selectedNodeIds ?? (scene.selectedNodeId ? [scene.selectedNodeId] : []))
        this.camera = cloneCameraState(scene.camera)
        this.viewportSettings = cloneViewportSettings(scene.viewportSettings)
        this.skybox = resolveDocumentSkybox(scene)
        this.shadowsEnabled = resolveDocumentShadowsEnabled(scene)
        this.panelVisibility = normalizePanelVisibilityState(scene.panelVisibility)
        this.panelPlacement = normalizePanelPlacementStateInput(scene.panelPlacement)
        this.groundSettings = cloneGroundSettings(scene.groundSettings)
        this.resourceProviderId = scene.resourceProviderId ?? 'builtin'
        useAssetCacheStore().recalculateUsage(this.nodes)
        this.hasUnsavedChanges = false
      } finally {
        this.isSceneReady = true
      }
      return true
    },
    async deleteScene(sceneId: string) {
      const scenesStore = useScenesStore()
      const target = await scenesStore.loadSceneDocument(sceneId)
      if (!target) {
        return false
      }

      target.nodes.forEach((node) => releaseRuntimeTree(node))

      await scenesStore.deleteScene(sceneId)
      await scenesStore.refreshMetadata()

      if (!scenesStore.metadata.length) {
        const fallback = createSceneDocument('Untitled Scene', {
          resourceProviderId: 'builtin',
          groundSettings: this.groundSettings,
          environment: this.environment,
        })
        await scenesStore.saveSceneDocument(fallback)
        this.currentSceneId = fallback.id
        applyCurrentSceneMeta(this, fallback)
        applySceneAssetState(this, fallback)
        this.nodes = cloneSceneNodes(fallback.nodes)
        this.environment = resolveSceneDocumentEnvironment(fallback)
        this.rebuildGeneratedMeshRuntimes()
        this.setSelection(fallback.selectedNodeIds ?? (fallback.selectedNodeId ? [fallback.selectedNodeId] : []))
        this.camera = cloneCameraState(fallback.camera)
        this.panelVisibility = normalizePanelVisibilityState(fallback.panelVisibility)
        this.panelPlacement = normalizePanelPlacementStateInput(fallback.panelPlacement)
        this.groundSettings = cloneGroundSettings(fallback.groundSettings)
        this.resourceProviderId = fallback.resourceProviderId
        useAssetCacheStore().recalculateUsage(this.nodes)
        this.isSceneReady = true
        this.hasUnsavedChanges = false
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
      if (this.currentSceneId === sceneId) {
        applyCurrentSceneMeta(this, updated)
      }
      return true
    },
    async updateSceneThumbnail(sceneId: string, thumbnail: string | null) {
      const scenesStore = useScenesStore()
      const document = await scenesStore.loadSceneDocument(sceneId)
      if (!document) {
        return false
      }
      const updated: StoredSceneDocument = {
        ...document,
        thumbnail,
        updatedAt: new Date().toISOString(),
      }
      await scenesStore.saveSceneDocument(updated)
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
      const options = exportOptions ?? { embedResources: false }
      const scenes = await Promise.all(collected.map((scene) => cloneSceneDocumentForExport(scene, options)))
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
        throw new Error('场景文件版本无效')
      }
      if (formatVersion > SCENE_BUNDLE_FORMAT_VERSION) {
        throw new Error('暂不支持该版本的场景文件')
      }
      if (!Array.isArray(payload.scenes) || !payload.scenes.length) {
        throw new Error('场景文件不包含任何场景数据')
      }

      const scenesStore = useScenesStore()
      const existingNames = new Set(scenesStore.metadata.map((scene) => scene.name))
      const imported: StoredSceneDocument[] = []
      const renamedScenes: Array<{ originalName: string; renamedName: string }> = []

      for (let index = 0; index < payload.scenes.length; index += 1) {
        const entry = payload.scenes[index]
        if (!isPlainObject(entry)) {
          throw new Error(`场景数据格式错误 (索引 ${index})`)
        }
        if (!Array.isArray(entry.nodes)) {
          throw new Error(`场景数据缺少节点信息 (索引 ${index})`)
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
          selectedNodeId: typeof entry.selectedNodeId === 'string' ? entry.selectedNodeId : null,
          selectedNodeIds: Array.isArray(entry.selectedNodeIds)
            ? (entry.selectedNodeIds as unknown[]).filter((id): id is string => typeof id === 'string')
            : undefined,
          camera: normalizeCameraStateInput(entry.camera),
          thumbnail: typeof entry.thumbnail === 'string' ? entry.thumbnail : null,
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

        imported.push(sceneDocument)
      }

      if (!imported.length) {
        throw new Error('场景文件不包含任何有效场景')
      }

      await scenesStore.saveSceneDocuments(imported)
      await scenesStore.refreshMetadata()

      return {
        importedSceneIds: imported.map((scene) => scene.id),
        renamedScenes,
      }
    },
    async ensureCurrentSceneLoaded(options: { skipComponentSync?: boolean } = {}) {
      this.isSceneReady = false
      const scenesStore = useScenesStore()

      try {
        if (!scenesStore.metadata.length) {
          const fallback = createSceneDocument('Untitled Scene', { resourceProviderId: 'builtin' })
          await scenesStore.saveSceneDocument(fallback)
          await scenesStore.refreshMetadata()
          this.currentSceneId = fallback.id
          applyCurrentSceneMeta(this, fallback)
          applySceneAssetState(this, fallback)
          this.nodes = cloneSceneNodes(fallback.nodes)
          this.setSelection(fallback.selectedNodeIds ?? (fallback.selectedNodeId ? [fallback.selectedNodeId] : []))
          this.camera = cloneCameraState(fallback.camera)
          this.viewportSettings = cloneViewportSettings(fallback.viewportSettings)
          this.panelVisibility = normalizePanelVisibilityState(fallback.panelVisibility)
          this.panelPlacement = normalizePanelPlacementStateInput(fallback.panelPlacement)
          this.resourceProviderId = fallback.resourceProviderId
          this.hasUnsavedChanges = false
          await this.refreshRuntimeState({ showOverlay: false, refreshViewport: false, skipComponentSync: options.skipComponentSync })
        } else {
          await this.refreshRuntimeState({ showOverlay: true, refreshViewport: false, skipComponentSync: options.skipComponentSync })
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
      'selectedNodeId',
      'selectedNodeIds',
      'activeTool',
      'activeDirectoryId',
      'selectedAssetId',
      'camera',
      'viewportSettings',
      'panelVisibility',
      'panelPlacement',
      'projectPanelTreeSize',
      'resourceProviderId',
      'assetCatalog',
      'assetIndex',
      'packageAssetMap',
      'hasUnsavedChanges',
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