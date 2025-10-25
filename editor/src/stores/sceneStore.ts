import { watch, type WatchStopHandle } from 'vue'
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
import type { CameraNodeProperties, SceneNode, SceneNodeType, Vector3Like } from '@/types/scene'
import { normalizeLightNodeType, type LightNodeProperties, type LightNodeType } from '@/types/light'
import type { ClipboardEntry } from '@/types/clipboard-entry'
import type { DetachResult } from '@/types/detach-result'
import type { DuplicateContext } from '@/types/duplicate-context'
import type { EditorTool } from '@/types/editor-tool'
import type { EnsureSceneAssetsOptions } from '@/types/ensure-scene-assets-options'
import type { PanelVisibilityState } from '@/types/panel-visibility-state'
import type { PanelPlacementState, PanelPlacement } from '@/types/panel-placement-state'
import type { HierarchyTreeItem } from '@/types/hierarchy-tree-item'
import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import type { AssetIndexEntry, AssetSourceMetadata } from '@/types/asset-index-entry'
import type { SceneCameraState } from '@/types/scene-camera-state'
import type { SceneHistoryEntry } from '@/types/scene-history-entry'
import type { SceneState } from '@/types/scene-state'
import type { StoredSceneDocument } from '@/types/stored-scene-document'
import type { TransformUpdatePayload } from '@/types/transform-update-payload'
import type { CameraProjectionMode, CameraControlMode, SceneSkyboxSettings, SceneViewportSettings } from '@/types/scene-viewport-settings'
import type { DynamicMeshVector3, GroundDynamicMesh, PlatformDynamicMesh, SceneDynamicMesh, WallDynamicMesh } from '@/types/dynamic-mesh'
import { normalizeDynamicMeshType } from '@/types/dynamic-mesh'
import type { GroundSettings } from '@/types/ground-settings'
import type {
  SceneMaterial,
  SceneMaterialProps,
  SceneMaterialTextureRef,
  SceneMaterialTextureSlot,
  SceneMaterialType,
  SceneNodeMaterial,
} from '@/types/material'
import { cloneTextureSettings } from '@/types/material'
import { DEFAULT_SCENE_MATERIAL_ID, DEFAULT_SCENE_MATERIAL_TYPE, normalizeSceneMaterialType } from '@/types/material'

import {
  CUSTOM_SKYBOX_PRESET_ID,
  DEFAULT_SKYBOX_SETTINGS,
  cloneSkyboxSettings,
  normalizeSkyboxSettings,
  resolveSkyboxPreset,
} from '@/stores/skyboxPresets'
import { useAssetCacheStore } from './assetCacheStore'
import { useUiStore } from './uiStore'
import { useScenesStore } from './scenesStore'
import { loadObjectFromFile } from '@/plugins/assetImport'
import { generateUuid } from '@/plugins/uuid'
import { getCachedModelObject, getOrLoadModelObject } from './modelObjectCache'
import { createWallGroup, updateWallGroup } from '@/plugins/wallMesh'
import { computeBlobHash, blobToDataUrl, dataUrlToBlob, inferBlobFilename, extractExtension, ensureExtension } from '@/plugins/blob'

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

export { ASSETS_ROOT_DIRECTORY_ID, buildPackageDirectoryId, extractProviderIdFromPackageDirectoryId } from './assetCatalog'

export type EditorPanel = 'hierarchy' | 'inspector' | 'project'

export type HierarchyDropPosition = 'before' | 'after' | 'inside'

export const SCENE_BUNDLE_FORMAT_VERSION = 1

export interface SceneBundleExportPayload {
  formatVersion: number
  exportedAt: string
  scenes: StoredSceneDocument[]
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

const HISTORY_LIMIT = 50

const LOCAL_EMBEDDED_ASSET_PREFIX = 'local::'

const DEFAULT_WALL_HEIGHT = 3
const DEFAULT_WALL_WIDTH = 0.2
const DEFAULT_WALL_THICKNESS = 0.2
const MIN_WALL_HEIGHT = 0.5
const MIN_WALL_WIDTH = 0.1
const MIN_WALL_THICKNESS = 0.05

const GRID_CELL_SIZE = 1
const CAMERA_NEAR = 0.1
const CAMERA_FAR = 500
const CAMERA_DISTANCE_EPSILON = 1e-6
const MAX_SPAWN_ATTEMPTS = 64
const COLLISION_MARGIN = 0.35
const DEFAULT_SPAWN_RADIUS = GRID_CELL_SIZE * 0.75
const GROUND_NODE_ID = 'harmony:ground'
const DEFAULT_GROUND_EXTENT = 100
const MIN_GROUND_EXTENT = 1
const MAX_GROUND_EXTENT = 20000
const DEFAULT_GROUND_CELL_SIZE = GRID_CELL_SIZE
const SEMI_TRANSPARENT_OPACITY = 0.35
const HEIGHT_EPSILON = 1e-5

declare module '@/types/scene-state' {
  interface SceneState {
    panelPlacement: PanelPlacementState
  }
}
const OPACITY_EPSILON = 1e-3

const MATERIAL_TEXTURE_SLOTS: SceneMaterialTextureSlot[] = ['albedo', 'normal', 'metalness', 'roughness', 'ao', 'emissive']

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

const DEFAULT_MATERIAL_TYPE: SceneMaterialType = DEFAULT_SCENE_MATERIAL_TYPE

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
    type: normalizeSceneMaterialType(options.type),
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
    type: normalizeSceneMaterialType(material.type),
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
    type: normalizeSceneMaterialType(options.type),
    ...cloneMaterialProps(props),
  }
}

function cloneNodeMaterial(material: SceneNodeMaterial): SceneNodeMaterial {
  return createNodeMaterial(material.materialId, material, {
    id: material.id,
    name: material.name,
    type: normalizeSceneMaterialType(material.type),
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
  return normalized !== 'Light' && normalized !== 'Group' && normalized !== 'Camera'
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

function createVector(x: number, y: number, z: number): Vector3Like {
  return { x, y, z }
}

function computeForwardVector(position: Vector3Like, target: Vector3Like): Vector3Like {
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

function cloneDynamicMeshVector3(vec: DynamicMeshVector3): DynamicMeshVector3 {
  return { x: vec.x, y: vec.y, z: vec.z }
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

function normalizeGroundSceneNode(node: SceneNode | null | undefined, settings?: GroundSettings): SceneNode {
  if (!node) {
    return createGroundSceneNode({}, settings)
  }
  if (node.dynamicMesh?.type === 'Ground') {
    const primaryMaterial = getPrimaryNodeMaterial(node)
    return {
      ...node,
      id: GROUND_NODE_ID,
      name: 'Ground',
  nodeType: 'Mesh',
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
  position: Vector3Like
  rotation?: Vector3Like
  target?: Vector3Like
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

const IMPORT_TEXTURE_SLOT_MAP: Array<{ slot: SceneMaterialTextureSlot; key: string }> = [
  { slot: 'albedo', key: 'map' },
  { slot: 'normal', key: 'normalMap' },
  { slot: 'metalness', key: 'metalnessMap' },
  { slot: 'roughness', key: 'roughnessMap' },
  { slot: 'ao', key: 'aoMap' },
  { slot: 'emissive', key: 'emissiveMap' },
]

function toHexColor(color: Color | null | undefined, fallback = '#ffffff'): string {
  if (!color) {
    return fallback
  }
  return `#${color.getHexString()}`
}

function toVector(vec: Vector3 | Euler): Vector3Like {
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
  const typeName = normalizeSceneMaterialType((material.type as SceneMaterialType) ?? DEFAULT_MATERIAL_TYPE)
  const materialName = typeof material.name === 'string' && material.name.trim().length ? material.name.trim() : undefined

  return createNodeMaterial(null, props, {
    name: materialName,
    type: typeName,
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
    prepareRuntimeObjectForNode(runtimeObject)

    tagObjectWithNodeId(runtimeObject, node.id)
    registerRuntimeObject(node.id, runtimeObject)
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

const initialNodes: SceneNode[] = [createGroundSceneNode()]

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
  project: 'floating',
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

const defaultViewportSettings: SceneViewportSettings = {
  showGrid: true,
  showAxes: false,
  cameraProjection: 'perspective',
  cameraControlMode: 'map',
  shadowsEnabled: true,
  skybox: cloneSkyboxSettings(defaultSkyboxSettings),
}

function isCameraProjectionMode(value: unknown): value is CameraProjectionMode {
  return value === 'perspective' || value === 'orthographic'
}

function isCameraControlMode(value: unknown): value is CameraControlMode {
  return value === 'orbit' || value === 'map'
}

function cloneViewportSettings(settings?: Partial<SceneViewportSettings> | null): SceneViewportSettings {
  const baseSkybox = settings?.skybox ?? defaultSkyboxSettings
  return {
    showGrid: settings?.showGrid ?? defaultViewportSettings.showGrid,
    showAxes: settings?.showAxes ?? defaultViewportSettings.showAxes,
    cameraProjection: isCameraProjectionMode(settings?.cameraProjection)
      ? settings!.cameraProjection
      : defaultViewportSettings.cameraProjection,
    cameraControlMode: isCameraControlMode(settings?.cameraControlMode)
      ? settings!.cameraControlMode
      : defaultViewportSettings.cameraControlMode,
    shadowsEnabled: typeof settings?.shadowsEnabled === 'boolean'
      ? settings.shadowsEnabled
      : defaultViewportSettings.shadowsEnabled,
    skybox: normalizeSkyboxSettings(baseSkybox),
  }
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
    a.cameraControlMode === b.cameraControlMode &&
    a.shadowsEnabled === b.shadowsEnabled &&
    skyboxSettingsEqual(a.skybox, b.skybox)
  )
}

const initialSceneDocument = createSceneDocument('Sample Scene', {
  nodes: initialNodes,
  materials: initialMaterials,
  selectedNodeId: initialNodes[0]?.id ?? null,
  resourceProviderId: 'builtin',
  assetCatalog: initialAssetCatalog,
  assetIndex: initialAssetIndex,
})

const runtimeObjectRegistry = new Map<string, Object3D>()

function registerRuntimeObject(id: string, object: Object3D) {
  runtimeObjectRegistry.set(id, object)
}

function unregisterRuntimeObject(id: string) {
  runtimeObjectRegistry.delete(id)
}

export function getRuntimeObject(id: string): Object3D | null {
  return runtimeObjectRegistry.get(id) ?? null
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
    bucket.set(node.id, runtime.clone(true))
  }
  node.children?.forEach((child) => collectRuntimeSnapshots(child, bucket))
}

function collectClipboardPayload(nodes: SceneNode[], ids: string[]): { entries: ClipboardEntry[]; runtimeSnapshots: Map<string, Object3D> } {
  const runtimeSnapshots = new Map<string, Object3D>()
  if (!ids.length) {
    return { entries: [], runtimeSnapshots }
  }
  const uniqueIds = Array.from(new Set(ids))
  const parentMap = buildParentMap(nodes)
  const topLevelIds = filterTopLevelNodeIds(uniqueIds, parentMap)
  const entries: ClipboardEntry[] = []
  topLevelIds.forEach((id) => {
    const found = findNodeById(nodes, id)
    if (found) {
      entries.push({ sourceId: id, node: cloneNode(found) })
      collectRuntimeSnapshots(found, runtimeSnapshots)
    }
  })
  return { entries, runtimeSnapshots }
}

function duplicateNodeTree(original: SceneNode, context: DuplicateContext): SceneNode {
  const duplicated = cloneNode(original)
  duplicated.id = generateUuid()

  if (original.children?.length) {
    duplicated.children = original.children.map((child) => duplicateNodeTree(child, context))
  } else {
    delete duplicated.children
  }
  if (duplicated.sourceAssetId) {
    context.assetCache.registerUsage(duplicated.sourceAssetId)
  }

  const runtimeObject = getRuntimeObject(original.id) ?? context.runtimeSnapshots.get(original.id) ?? null
  if (runtimeObject) {
    const clonedObject = runtimeObject.clone(true)
    tagObjectWithNodeId(clonedObject, duplicated.id)
    registerRuntimeObject(duplicated.id, clonedObject)
  }

  return duplicated
}

function cloneVector(vector: Vector3Like): Vector3Like {
  return { x: vector.x, y: vector.y, z: vector.z }
}

function computeAssetSpawnTransform(asset: ProjectAsset, position?: Vector3Like) {
  const spawnPosition = position ? cloneVector(position) : { x: 0, y: 0, z: 0 }
  const rotation: Vector3Like = { x: 0, y: 0, z: 0 }
  const scale: Vector3Like = { x: 1, y: 1, z: 1 }

  if (!position && asset.type !== 'model') {
    spawnPosition.y = 1
  }

  if (asset.type === 'model') {
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
  return { x: vector.x, y: vector.y, z: vector.z }
}

function collectCollisionSpheres(nodes: SceneNode[]): CollisionSphere[] {
  const spheres: CollisionSphere[] = []
  const traverse = (list: SceneNode[], parentMatrix: Matrix4) => {
    list.forEach((node) => {
      const nodeMatrix = composeNodeMatrix(node)
      const worldMatrix = new Matrix4().multiplyMatrices(parentMatrix, nodeMatrix)

  if (!node.isPlaceholder && node.nodeType !== 'Light') {
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
}): Vector3 {
  const { baseY, radius, localCenter, camera } = params
  if (!camera) {
    return new Vector3(snapAxisToGrid(0), baseY, snapAxisToGrid(0))
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
    candidate.x = snapAxisToGrid(candidate.x)
    candidate.z = snapAxisToGrid(candidate.z)
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
  candidate.x = snapAxisToGrid(candidate.x)
  candidate.z = snapAxisToGrid(candidate.z)
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
    children: node.children?.map(toHierarchyItem),
  }
}

function cloneNode(node: SceneNode): SceneNode {
  const nodeType = normalizeSceneNodeType(node.nodeType)
  const materials = sceneNodeTypeSupportsMaterials(nodeType) ? cloneNodeMaterials(node.materials) : undefined
  return {
    ...node,
    nodeType,
    materials,
    light: node.light
      ? {
          ...node.light,
          target: node.light.target ? cloneVector(node.light.target) : undefined,
        }
      : undefined,
    camera: node.camera
      ? { ...node.camera }
      : undefined,
    position: cloneVector(node.position),
    rotation: cloneVector(node.rotation),
    scale: cloneVector(node.scale),
    children: node.children ? node.children.map(cloneNode) : undefined,
    dynamicMesh: cloneDynamicMeshDefinition(node.dynamicMesh),
    importMetadata: node.importMetadata
      ? {
          assetId: node.importMetadata.assetId,
          objectPath: [...node.importMetadata.objectPath],
        }
      : undefined,
  }
}

function createDefaultSceneNodes(settings?: GroundSettings): SceneNode[] {
  const nodes = initialNodes.map((node) => cloneNode(node))
  if (!settings) {
    return nodes
  }
  return ensureGroundNode(nodes, settings)
}

function cloneSceneNodes(nodes: SceneNode[]): SceneNode[] {
  return nodes.map(cloneNode)
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

async function buildPackageAssetMapForExport(scene: StoredSceneDocument): Promise<Record<string, string>> {
  const assetCache = useAssetCacheStore()
  const baseMap = clonePackageAssetMap(scene.packageAssetMap)
  const localAssetIds = Object.entries(scene.assetIndex)
    .filter(([, entry]) => entry.source?.type === 'local')
    .map(([assetId]) => assetId)

  for (const assetId of localAssetIds) {
    const key = `${LOCAL_EMBEDDED_ASSET_PREFIX}${assetId}`
    if (baseMap[key]) {
      continue
    }
    let entry = assetCache.hasCache(assetId) ? assetCache.getEntry(assetId) : null
    if (!entry || entry.status !== 'cached' || !entry.blob) {
      entry = await assetCache.loadFromIndexedDb(assetId)
    }
    if (!entry || entry.status !== 'cached' || !entry.blob) {
      console.warn('缺少本地资源数据，无法导出', assetId)
      continue
    }
    try {
      baseMap[key] = await blobToDataUrl(entry.blob)
    } catch (error) {
      console.warn('序列化本地资源失败', assetId, error)
    }
  }

  return baseMap
}

async function cloneSceneDocumentForExport(scene: StoredSceneDocument): Promise<StoredSceneDocument> {
  const packageAssetMap = await buildPackageAssetMapForExport(scene)
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
    assetIndex: scene.assetIndex,
    packageAssetMap,
    materials: scene.materials,
    viewportSettings: scene.viewportSettings,
    panelVisibility: scene.panelVisibility,
    panelPlacement: scene.panelPlacement,
    groundSettings: scene.groundSettings,
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

function parseVector3Like(value: unknown): Vector3Like | null {
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
  const input = { ...value } as Partial<SceneViewportSettings>
  if (input.skybox && !isPlainObject(input.skybox)) {
    delete (input as Record<string, unknown>).skybox
  }
  return input
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
  const seen = new Set<string>()
  const normalized: string[] = []
  ids.forEach((id) => {
    if (!validIds.has(id) || seen.has(id)) {
      return
    }
    normalized.push(id)
    seen.add(id)
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
    viewportSettings?: Partial<SceneViewportSettings>
    panelVisibility?: Partial<PanelVisibilityState>
    panelPlacement?: Partial<PanelPlacementState>
    groundSettings?: Partial<GroundSettings>
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
  const nodes = ensureGroundNode(clonedNodes, groundSettings)
  const camera = options.camera ? cloneCameraState(options.camera) : cloneCameraState(defaultCameraState)
  let selectedNodeId = options.selectedNodeId ?? (nodes.find((node) => !isGroundNode(node))?.id ?? null)
  if (selectedNodeId && !nodes.some((node) => node.id === selectedNodeId)) {
    selectedNodeId = nodes.find((node) => !isGroundNode(node))?.id ?? null
  }
  const selectedNodeIds = normalizeSelectionIds(nodes, options.selectedNodeIds ?? (selectedNodeId ? [selectedNodeId] : []))
  const now = new Date().toISOString()
  const createdAt = options.createdAt ?? now
  const updatedAt = options.updatedAt ?? createdAt
  const assetCatalog = options.assetCatalog ? cloneAssetCatalog(options.assetCatalog) : createEmptyAssetCatalog()
  const assetIndex = options.assetIndex ? cloneAssetIndex(options.assetIndex) : {}
  const packageAssetMap = options.packageAssetMap ? clonePackageAssetMap(options.packageAssetMap) : {}
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
    groundSettings,
    panelVisibility,
    panelPlacement,
    resourceProviderId: options.resourceProviderId ?? 'builtin',
    createdAt,
    updatedAt,
    assetCatalog,
    assetIndex,
    packageAssetMap,
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

  return {
    id: store.currentSceneId,
    name: meta.name,
    thumbnail: meta.thumbnail ?? null,
    nodes: cloneSceneNodes(store.nodes),
    materials: cloneSceneMaterials(store.materials),
    selectedNodeId: store.selectedNodeId,
    selectedNodeIds: cloneSelection(store.selectedNodeIds),
    camera: cloneCameraState(store.camera),
    viewportSettings: cloneViewportSettings(store.viewportSettings),
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
      if (position === 'inside') {
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
    return {
      currentSceneId: initialSceneDocument.id,
      currentSceneMeta: {
        name: initialSceneDocument.name,
        thumbnail: initialSceneDocument.thumbnail ?? null,
        createdAt: initialSceneDocument.createdAt,
        updatedAt: initialSceneDocument.updatedAt,
      },
      nodes: cloneSceneNodes(initialSceneDocument.nodes),
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
      groundSettings: cloneGroundSettings(initialSceneDocument.groundSettings),
      panelVisibility: { ...defaultPanelVisibility },
      panelPlacement: { ...defaultPanelPlacement },
      projectPanelTreeSize: DEFAULT_PROJECT_PANEL_TREE_SIZE,
      resourceProviderId: initialSceneDocument.resourceProviderId,
      cameraFocusNodeId: null,
      cameraFocusRequestId: 0,
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
    canUndo(state): boolean {
      return state.undoStack.length > 0
    },
    canRedo(state): boolean {
      return state.redoStack.length > 0
    },
  },
  actions: {
    onPersistHydrated(_state?: Partial<SceneState>) {
      const nextTree = createProjectTreeFromCache(this.assetCatalog, this.packageDirectoryCache)
      this.projectTree = nextTree
      if (this.activeDirectoryId && !findDirectory(nextTree, this.activeDirectoryId)) {
        this.activeDirectoryId = defaultDirectoryId
      }
      if (this.selectedAssetId && !findAssetInTree(nextTree, this.selectedAssetId)) {
        this.selectedAssetId = null
      }
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
        this.groundSettings = cloneGroundSettings(snapshot.groundSettings)
        this.resourceProviderId = snapshot.resourceProviderId

        assetCache.recalculateUsage(this.nodes)

        snapshot.runtimeSnapshots.forEach((object, nodeId) => {
          const clonedObject = object.clone(true)
          tagObjectWithNodeId(clonedObject, nodeId)
          registerRuntimeObject(nodeId, clonedObject)
        })

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
      const updatedNodes = ensureGroundNode(clonedNodes, normalized)
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
      commitSceneSnapshot(this)
    },
    updateNodeProperties(payload: TransformUpdatePayload) {
      const target = findNodeById(this.nodes, payload.id)
      if (!target) {
        return
      }
      let changed = false
      if (payload.position && !vectorsEqual(target.position, payload.position)) {
        changed = true
      }
      if (payload.rotation && !vectorsEqual(target.rotation, payload.rotation)) {
        changed = true
      }
      if (payload.scale && !vectorsEqual(target.scale, payload.scale)) {
        changed = true
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
      commitSceneSnapshot(this)
    },
    updateNodePropertiesBatch(payloads: TransformUpdatePayload[]) {
      if (!Array.isArray(payloads) || payloads.length === 0) {
        return
      }

      const prepared: TransformUpdatePayload[] = []

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
        const type = normalizeSceneMaterialType(shared?.type ?? options.type ?? DEFAULT_MATERIAL_TYPE)
        const entry = createNodeMaterial(shared?.id ?? null, baseProps, {
          name: shared ? shared.name : fallbackName,
          type,
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
              type: normalizeSceneMaterialType(baseMaterial?.type ?? DEFAULT_MATERIAL_TYPE),
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
            type: normalizeSceneMaterialType(type),
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
        DEFAULT_MATERIAL_TYPE,
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
      const type = normalizeSceneMaterialType(existing.type ?? DEFAULT_MATERIAL_TYPE)
      const nameCandidates = [
        typeof options.name === 'string' ? options.name.trim() : '',
        typeof existing.name === 'string' ? existing.name.trim() : '',
      ]
      const fallbackName = `Material ${this.materials.length + 1}`
      const resolvedName = nameCandidates.find((value) => value && value.length) ?? fallbackName
      const normalizedDescription =
        typeof options.description === 'string' ? options.description.trim() : undefined

      const material = createSceneMaterial(resolvedName, props, { type })
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
      const currentType = normalizeSceneMaterialType(current.type)
      const nextType = normalizeSceneMaterialType(update.type ?? currentType)
      const typeChanged = nextType !== currentType

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
            DEFAULT_MATERIAL_TYPE,
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
        .filter((node): node is SceneNode => Boolean(node))
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

          const shouldCacheModelObject = asset?.type === 'model'
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
    async spawnAssetAtPosition(assetId: string, position: Vector3Like): Promise<{ asset: ProjectAsset; node: SceneNode }> {
      const asset = findAssetInTree(this.projectTree, assetId)
      if (!asset) {
        throw new Error('Unable to find the requested asset')
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
      return registeredAsset
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
    setViewportShadowsEnabled(enabled: boolean) {
      this.setViewportSettings({ shadowsEnabled: enabled })
    },
    toggleViewportShadowsEnabled() {
      this.setViewportShadowsEnabled(!this.viewportSettings.shadowsEnabled)
    },
    setViewportCameraProjection(mode: CameraProjectionMode) {
      if (!isCameraProjectionMode(mode)) {
        return
      }
      this.setViewportSettings({ cameraProjection: mode })
    },
    toggleViewportCameraProjection() {
      const next: CameraProjectionMode = this.viewportSettings.cameraProjection === 'perspective'
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
      const current = cloneSkyboxSettings(this.viewportSettings.skybox)
      const next = normalizeSkyboxSettings({ ...current, ...partial })
      if (options.markCustom && !partial.presetId) {
        next.presetId = CUSTOM_SKYBOX_PRESET_ID
      }
      if (skyboxSettingsEqual(this.viewportSettings.skybox, next)) {
        return
      }
      this.setViewportSettings({ skybox: next })
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
      if (skyboxSettingsEqual(this.viewportSettings.skybox, next)) {
        return
      }
      this.setViewportSettings({ skybox: next })
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

    isDescendant(ancestorId: string, maybeChildId: string) {
      if (!ancestorId || !maybeChildId) return false
      if (ancestorId === maybeChildId) return true
      return isDescendantNode(this.nodes, ancestorId, maybeChildId)
    },

    moveNode(payload: { nodeId: string; targetId: string | null; position: HierarchyDropPosition }) {
      const { nodeId, targetId, position } = payload
      if (!nodeId) return false
      if (targetId && nodeId === targetId) return false

      if (targetId && isDescendantNode(this.nodes, nodeId, targetId)) {
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

      let updatedLocal: { position: Vector3Like; rotation: Vector3Like; scale: Vector3Like } | null = null

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
      commitSceneSnapshot(this)

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
      const target = findNodeById(this.nodes, nodeId)
      if (!target) {
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

        const object = shouldCacheModelObject ? baseObject.clone(true) : baseObject
        tagObjectWithNodeId(object, nodeId)
        registerRuntimeObject(nodeId, object)
        assetCache.registerUsage(asset.id)
        assetCache.touch(asset.id)

        target.isPlaceholder = false
        target.downloadStatus = undefined
        target.downloadProgress = undefined
        target.downloadError = null
        target.name = asset.name

        this.nodes = [...this.nodes]
        commitSceneSnapshot(this)
      } catch (error) {
        target.isPlaceholder = true
        target.downloadStatus = 'error'
        target.downloadError = (error as Error).message ?? '资源加载失败'
        this.nodes = [...this.nodes]
      }
    },

    addLightNode(type: LightNodeType, options: { position?: Vector3Like; name?: string } = {}) {
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
      position?: Vector3Like
      baseY?: number
      name?: string
      sourceAssetId?: string
      rotation?: Vector3Like
      scale?: Vector3Like
    }): Promise<SceneNode | null> {
      if (!payload.object && !payload.asset) {
        throw new Error('addModelNode requires either an object or an asset')
      }

      const rotation: Vector3Like = payload.rotation ?? { x: 0, y: 0, z: 0 }
      const scale: Vector3Like = payload.scale ?? { x: 1, y: 1, z: 1 }
      let baseY = payload.baseY ?? 0

      let workingObject: Object3D
      let name = payload.name
      let sourceAssetId = payload.sourceAssetId
      let assetCache: ReturnType<typeof useAssetCacheStore> | null = null
      let registerAssetId: string | null = null

      
      if (payload.asset) {
        const asset = payload.asset
        if (asset.type !== 'model') {
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

      if (payload.baseY === undefined) {
        const minY = metrics.bounds.min.y
        if (Number.isFinite(minY) && minY < 0) {
          const EPSILON = 1e-3
          baseY = Math.max(baseY, -minY + EPSILON)
        }
      }

      let spawnVector: Vector3
      if (payload.position) {
        spawnVector = new Vector3(payload.position.x, payload.position.y + baseY, payload.position.z)
      } else {
        spawnVector = resolveSpawnPosition({
          baseY,
          radius: metrics.radius,
          localCenter: metrics.center,
          camera: this.camera,
          nodes: this.nodes,
        })
      }

      const nodeType = payload.nodeType ?? resolveSceneNodeTypeFromObject(workingObject)

      const node = this.addSceneNode({
        nodeType,
        object: workingObject,
        name: name ?? workingObject.name ?? 'Imported Mesh',
        position: toPlainVector(spawnVector),
        rotation,
        scale,
        sourceAssetId: sourceAssetId ?? undefined,
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
          type: normalizeSceneMaterialType(baseMaterial?.type ?? DEFAULT_MATERIAL_TYPE),
        })
        nodeMaterials = [initialMaterial]
      }
      const node: SceneNode = {
        id,
        name: payload.name ?? payload.object.name ?? 'Imported Mesh',
        nodeType,
        materials: nodeMaterials,
        position: payload.position ?? { x: 0, y: 0, z: 0 },
        rotation: payload.rotation ?? { x: 0, y: 0, z: 0 },
        scale: payload.scale ?? { x: 1, y: 1, z: 1 },
        visible: true,
        sourceAssetId: payload.sourceAssetId,
        dynamicMesh: payload.dynamicMesh ? cloneDynamicMeshDefinition(payload.dynamicMesh) : undefined,
      }

      registerRuntimeObject(id, payload.object)
      tagObjectWithNodeId(payload.object, id)
      this.nodes = [node, ...this.nodes]
      this.setSelection([id])
      commitSceneSnapshot(this)

      return node
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

      this.captureHistorySnapshot()
      node.position = createVector(build.center.x, build.center.y, build.center.z)
      node.dynamicMesh = build.definition
      this.nodes = [...this.nodes]
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

  const existing = node.dynamicMesh.segments[0]
      const { height, width, thickness } = normalizeWallDimensions({
        height: dimensions.height ?? existing?.height ?? DEFAULT_WALL_HEIGHT,
        width: dimensions.width ?? existing?.width ?? DEFAULT_WALL_WIDTH,
        thickness: dimensions.thickness ?? existing?.thickness ?? DEFAULT_WALL_THICKNESS,
      })
      let changed = false
      const nextSegments = node.dynamicMesh.segments.map((segment) => {
        const nextSegment = {
          ...segment,
          height,
          width,
          thickness,
        }
        if (
          segment.height !== nextSegment.height ||
          segment.width !== nextSegment.width ||
          segment.thickness !== nextSegment.thickness
        ) {
          changed = true
        }
        return nextSegment
      })

      if (!changed) {
        return false
      }

      this.captureHistorySnapshot()
      node.dynamicMesh = {
        type: 'Wall',
        segments: nextSegments,
      }
      this.nodes = [...this.nodes]
      commitSceneSnapshot(this)

      const runtime = getRuntimeObject(nodeId)
      if (runtime) {
        updateWallGroup(runtime, node.dynamicMesh)
      }
      return true
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
      const existingIds = ids.filter((id) => id !== GROUND_NODE_ID && !!findNodeById(this.nodes, id))
      if (!existingIds.length) {
        return
      }
      const idSet = new Set(existingIds)

      this.captureHistorySnapshot()

      const removed: string[] = []
      this.nodes = pruneNodes(this.nodes, idSet, removed)

  removed.forEach((id) => stopPlaceholderWatcher(id))

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
        if (!id || id === GROUND_NODE_ID) {
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

      this.captureHistorySnapshot()

      topLevelIds.forEach((id) => {
        const source = findNodeById(this.nodes, id)
        if (!source) {
          return
        }
        const duplicate = duplicateNodeTree(source, { assetCache, runtimeSnapshots })
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
      const { entries, runtimeSnapshots } = collectClipboardPayload(this.nodes, nodeIds)
      if (!entries.length) {
        this.clipboard = null
        return false
      }
      this.clipboard = {
        entries,
        runtimeSnapshots,
        cut: false,
      }
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
    pasteClipboard(targetId?: string | null) {
      if (!this.clipboard || !this.clipboard.entries.length) {
        return false
      }

      const assetCache = useAssetCacheStore()
      const context: DuplicateContext = {
        assetCache,
        runtimeSnapshots: this.clipboard.runtimeSnapshots,
      }
      const duplicates = this.clipboard.entries.map((entry) => duplicateNodeTree(entry.node, context))
      if (!duplicates.length) {
        return false
      }

      const working = cloneSceneNodes(this.nodes)

      let anchorId: string | null = null
      if (targetId && findNodeById(working, targetId)) {
        anchorId = targetId
      } else if (this.selectedNodeId && findNodeById(working, this.selectedNodeId)) {
        anchorId = this.selectedNodeId
      }

      duplicates.forEach((duplicate) => {
        const inserted = insertNodeMutable(working, anchorId, duplicate, anchorId ? 'after' : 'after')
        if (!inserted) {
          insertNodeMutable(working, null, duplicate, 'after')
        }
        anchorId = duplicate.id
      })

      this.captureHistorySnapshot()
      this.nodes = working
      const duplicateIds = duplicates.map((duplicate) => duplicate.id)
      if (duplicateIds.length) {
        this.setSelection(duplicateIds)
      }
      commitSceneSnapshot(this)
      assetCache.recalculateUsage(this.nodes)

      if (this.clipboard.cut) {
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
      await scenesStore.initialize()

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
      await scenesStore.initialize()

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
      this.groundSettings = cloneGroundSettings(sceneDocument.groundSettings)
      this.setSelection(sceneDocument.selectedNodeIds ?? (sceneDocument.selectedNodeId ? [sceneDocument.selectedNodeId] : []))
      this.camera = cloneCameraState(sceneDocument.camera)
      this.viewportSettings = cloneViewportSettings(sceneDocument.viewportSettings)
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
      await scenesStore.initialize()
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
        this.setSelection(scene.selectedNodeIds ?? (scene.selectedNodeId ? [scene.selectedNodeId] : []))
        this.camera = cloneCameraState(scene.camera)
        this.viewportSettings = cloneViewportSettings(scene.viewportSettings)
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
      await scenesStore.initialize()

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
        })
        await scenesStore.saveSceneDocument(fallback)
        this.currentSceneId = fallback.id
        applyCurrentSceneMeta(this, fallback)
        applySceneAssetState(this, fallback)
        this.nodes = cloneSceneNodes(fallback.nodes)
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
      await scenesStore.initialize()
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
      await scenesStore.initialize()
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
    async exportSceneBundle(sceneIds: string[]): Promise<SceneBundleExportPayload | null> {
      if (!Array.isArray(sceneIds) || !sceneIds.length) {
        return null
      }
      const scenesStore = useScenesStore()
      await scenesStore.initialize()
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
        throw new Error('场景文件版本无效')
      }
      if (formatVersion > SCENE_BUNDLE_FORMAT_VERSION) {
        throw new Error('暂不支持该版本的场景文件')
      }
      if (!Array.isArray(payload.scenes) || !payload.scenes.length) {
        throw new Error('场景文件不包含任何场景数据')
      }

      const scenesStore = useScenesStore()
      await scenesStore.initialize()
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
    async ensureCurrentSceneLoaded() {
      this.isSceneReady = false
      const scenesStore = useScenesStore()
      await scenesStore.initialize()

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
        } else {
          await this.ensureSceneAssetsReady({
            nodes: this.nodes,
            showOverlay: true,
            refreshViewport: false,
          })
        }
        useAssetCacheStore().recalculateUsage(this.nodes)
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
    ],
    migrations: migrateScenePersistedState,
  },
})