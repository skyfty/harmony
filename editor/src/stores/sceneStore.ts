import { watch, type WatchStopHandle } from 'vue'
import { defineStore } from 'pinia'
import { Matrix4, Quaternion, Vector3, Euler, Box3, MathUtils, type Object3D } from 'three'
import type { LightNodeProperties, LightNodeType, SceneNode, SceneNodeType, Vector3Like } from '@/types/scene'
import type { ClipboardEntry } from '@/types/clipboard-entry'
import type { DetachResult } from '@/types/detach-result'
import type { DuplicateContext } from '@/types/duplicate-context'
import type { EditorTool } from '@/types/editor-tool'
import type { EnsureSceneAssetsOptions } from '@/types/ensure-scene-assets-options'
import type { HierarchyTreeItem } from '@/types/hierarchy-tree-item'
import type { PanelVisibilityState } from '@/types/panel-visibility-state'
import type { PanelPlacementState, PanelPlacement } from '@/types/panel-placement-state'
import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import type { AssetIndexEntry, AssetSourceMetadata } from '@/types/asset-index-entry'
import type { SceneCameraState } from '@/types/scene-camera-state'
import type { SceneHistoryEntry } from '@/types/scene-history-entry'
import type { SceneState } from '@/types/scene-state'
import type { SceneSummary } from '@/types/scene-summary'
import type { StoredSceneDocument } from '@/types/stored-scene-document'
import type { TransformUpdatePayload } from '@/types/transform-update-payload'
import type { CameraProjectionMode, CameraControlMode, SceneSkyboxSettings, SceneViewportSettings } from '@/types/scene-viewport-settings'
import type { DynamicMeshVector3, GroundDynamicMesh, SceneDynamicMesh, WallDynamicMesh } from '@/types/dynamic-mesh'
import type { GroundSettings } from '@/types/ground-settings'
import type {
  SceneMaterial,
  SceneMaterialProps,
  SceneMaterialTextureRef,
  SceneMaterialTextureSlot,
  SceneMaterialType,
  SceneNodeMaterial,
} from '@/types/material'

import {
  CUSTOM_SKYBOX_PRESET_ID,
  DEFAULT_SKYBOX_SETTINGS,
  cloneSkyboxSettings,
  normalizeSkyboxSettings,
  resolveSkyboxPreset,
} from '@/stores/skyboxPresets'
import { useAssetCacheStore } from './assetCacheStore'
import { useUiStore } from './uiStore'
import { loadObjectFromFile } from '@/plugins/assetImport'
import { generateUuid } from '@/plugins/uuid'
import { getCachedModelObject, getOrLoadModelObject } from './modelObjectCache'
import { createWallGroup, updateWallGroup } from '@/plugins/wallMesh'

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

const DEFAULT_MATERIAL_TYPE: SceneMaterialType = 'mesh-standard'

function createEmptyTextureMap(input?: MaterialTextureMap | null): MaterialTextureMap {
  const map: MaterialTextureMap = {}
  MATERIAL_TEXTURE_SLOTS.forEach((slot) => {
    const value = input?.[slot] ?? null
    map[slot] = value ? { assetId: value.assetId, name: value.name } : null
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
        next.textures![slot] = value ? { assetId: value.assetId, name: value.name } : null
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

function createSceneMaterial(name = 'New Material', props?: Partial<SceneMaterialProps>, options: { type?: SceneMaterialType } = {}): SceneMaterial {
  const now = new Date().toISOString()
  const resolvedName = name.trim() || 'New Material'
  const resolvedProps = createMaterialProps(props)
  return {
    id: generateUuid(),
    name: resolvedName,
    description: undefined,
    type: options.type ?? DEFAULT_MATERIAL_TYPE,
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
    type: material.type ?? DEFAULT_MATERIAL_TYPE,
    createdAt: material.createdAt,
    updatedAt: material.updatedAt,
  }
}

function cloneSceneMaterials(materials: SceneMaterial[]): SceneMaterial[] {
  return materials.map((material) => cloneSceneMaterial(material))
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
    type: options.type ?? DEFAULT_MATERIAL_TYPE,
    ...cloneMaterialProps(props),
  }
}

function cloneNodeMaterial(material: SceneNodeMaterial): SceneNodeMaterial {
  return createNodeMaterial(material.materialId, material, {
    id: material.id,
    name: material.name,
    type: material.type ?? DEFAULT_MATERIAL_TYPE,
  })
}

function cloneNodeMaterials(materials?: SceneNodeMaterial[] | null): SceneNodeMaterial[] {
  return (materials ?? []).map((material) => cloneNodeMaterial(material))
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
        result.textures![slot] = value ? { assetId: value.assetId, name: value.name } : null
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

const LEGACY_GROUND_ASSET_ID = 'preset:models/ground.glb'

function cloneDynamicMeshVector3(vec: DynamicMeshVector3): DynamicMeshVector3 {
  return { x: vec.x, y: vec.y, z: vec.z }
}

function cloneGroundDynamicMesh(definition: GroundDynamicMesh): GroundDynamicMesh {
  return {
    type: 'ground',
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
    type: 'wall',
    segments: dynamicSegments,
  }

  return { center, definition }
}

function cloneDynamicMeshDefinition(mesh?: SceneDynamicMesh): SceneDynamicMesh | undefined {
  if (!mesh) {
    return undefined
  }
  switch (mesh.type) {
    case 'ground':
      return cloneGroundDynamicMesh(mesh)
    case 'wall':
      return {
        type: 'wall',
        segments: mesh.segments.map((segment) => ({
          start: cloneDynamicMeshVector3(segment.start),
          end: cloneDynamicMeshVector3(segment.end),
          height: Number.isFinite(segment.height) ? segment.height : DEFAULT_WALL_HEIGHT,
          width: Number.isFinite((segment as { width?: number }).width)
            ? (segment as { width?: number }).width!
            : DEFAULT_WALL_WIDTH,
          thickness: Number.isFinite(segment.thickness) ? segment.thickness : DEFAULT_WALL_THICKNESS,
        })),
      }
    case 'platform':
      return {
        type: 'platform',
        footprint: mesh.footprint.map(cloneDynamicMeshVector3),
        height: mesh.height,
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
    type: 'ground',
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
    nodeType: 'mesh',
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
  return node.id === GROUND_NODE_ID || node.dynamicMesh?.type === 'ground' || node.sourceAssetId === LEGACY_GROUND_ASSET_ID
}

function normalizeGroundSceneNode(node: SceneNode | null | undefined, settings?: GroundSettings): SceneNode {
  if (!node) {
    return createGroundSceneNode({}, settings)
  }
  if (node.dynamicMesh?.type === 'ground') {
    const primaryMaterial = getPrimaryNodeMaterial(node)
    return {
      ...node,
      id: GROUND_NODE_ID,
      name: 'Ground',
      nodeType: 'mesh',
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
  if (node.sourceAssetId === LEGACY_GROUND_ASSET_ID) {
    return createGroundSceneNode({}, settings)
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

function stripLegacyGroundAssetFromCatalog(
  catalog?: Record<string, ProjectAsset[]> | null,
): Record<string, ProjectAsset[]> | null | undefined {
  if (!catalog) {
    return catalog
  }
  let mutated = false
  const next: Record<string, ProjectAsset[]> = {}
  Object.entries(catalog).forEach(([categoryId, assets]) => {
    if (!Array.isArray(assets) || assets.length === 0) {
      next[categoryId] = assets ?? []
      return
    }
    const filtered = assets.filter((asset) => asset.id !== LEGACY_GROUND_ASSET_ID)
    if (filtered.length !== assets.length) {
      mutated = true
    }
    next[categoryId] = filtered
  })
  return mutated ? next : catalog
}

function stripLegacyGroundAssetFromIndex(
  index?: Record<string, AssetIndexEntry> | null,
): Record<string, AssetIndexEntry> | null | undefined {
  if (!index) {
    return index
  }
  if (!(LEGACY_GROUND_ASSET_ID in index)) {
    return index
  }
  const { [LEGACY_GROUND_ASSET_ID]: _removed, ...rest } = index
  return rest
}

function stripLegacyGroundAssetFromPackageMap(
  packageMap?: Record<string, string> | null,
): Record<string, string> | null | undefined {
  if (!packageMap) {
    return packageMap
  }
  if (!Object.values(packageMap).some((value) => value === LEGACY_GROUND_ASSET_ID)) {
    return packageMap
  }
  const next: Record<string, string> = {}
  Object.entries(packageMap).forEach(([key, value]) => {
    if (value !== LEGACY_GROUND_ASSET_ID) {
      next[key] = value
    }
  })
  return next
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
  const light: LightNodeProperties = {
    type: options.type,
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
    nodeType: 'light',
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
  switch (type) {
    case 'directional':
      return {
        name: 'Directional Light',
        color: '#ffffff',
        intensity: 1.2,
        position: createVector(20, 40, 20),
        target: createVector(0, 0, 0),
        extras: { castShadow: true } as LightNodeExtras,
      }
    case 'point':
      return {
        name: 'Point Light',
        color: '#ffffff',
        intensity: 1,
        position: createVector(0, 8, 0),
        extras: { distance: 60, decay: 2, castShadow: false } as LightNodeExtras,
      }
    case 'spot':
      return {
        name: 'Spot Light',
        color: '#ffffff',
        intensity: 1,
        position: createVector(12, 18, 12),
        target: createVector(0, 0, 0),
        extras: { angle: Math.PI / 5, penumbra: 0.35, distance: 80, decay: 2, castShadow: true } as LightNodeExtras,
      }
    case 'ambient':
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

const initialMaterials: SceneMaterial[] = [
  createSceneMaterial('Default Material', {
    color: '#ffffff',
    metalness: 0,
    roughness: 0.8,
  }),
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

      if (!node.isPlaceholder && node.nodeType !== 'light') {
        const runtimeObject = getRuntimeObject(node.id)
  if (runtimeObject && node.dynamicMesh?.type !== 'ground') {
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
          type: entry.type,
        })
      })
      if (nodeChanged) {
        node.materials = nextMaterials
        changed = true
      }
    }
    if (node.children?.length) {
      if (applyMaterialPropsToNodeTree(node.children, materialId, props, assignedId)) {
        changed = true
      }
    }
  })
  return changed
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
  return {
    ...node,
    materials: cloneNodeMaterials(node.materials),
    light: node.light
      ? {
          ...node.light,
          target: node.light.target ? cloneVector(node.light.target) : undefined,
        }
      : undefined,
    position: cloneVector(node.position),
    rotation: cloneVector(node.rotation),
    scale: cloneVector(node.scale),
    children: node.children ? node.children.map(cloneNode) : undefined,
    dynamicMesh: cloneDynamicMeshDefinition(node.dynamicMesh),
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

function cloneSceneDocumentForExport(scene: StoredSceneDocument): StoredSceneDocument {
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
    packageAssetMap: scene.packageAssetMap,
  materials: scene.materials,
    viewportSettings: scene.viewportSettings,
    panelVisibility: scene.panelVisibility,
    panelPlacement: scene.panelPlacement,
    groundSettings: scene.groundSettings,
  })
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

type ScenePersistedState = Partial<SceneState>

function ensureActiveTool(state: ScenePersistedState): ScenePersistedState {
  return {
    ...state,
    activeTool: (state.activeTool as EditorTool | undefined) ?? 'select',
  }
}

function ensureCameraAndPanelState(state: ScenePersistedState): ScenePersistedState {
  const cameraState = state.camera as Partial<SceneCameraState> | undefined
  const panelState = normalizePanelVisibilityState(state.panelVisibility as Partial<PanelVisibilityState> | undefined)

  return {
    ...state,
    camera: (() => {
      const position = cloneVector(cameraState?.position ?? defaultCameraState.position)
      const target = cloneVector(cameraState?.target ?? defaultCameraState.target)
      const forward = cameraState?.forward ? cloneVector(cameraState.forward) : computeForwardVector(position, target)
      return {
        position,
        target,
        fov: cameraState?.fov ?? defaultCameraState.fov,
        forward,
      }
    })(),
    panelVisibility: panelState,
  }
}

function ensurePanelPlacement(state: ScenePersistedState): ScenePersistedState {
  const placementState = normalizePanelPlacementStateInput(
    (state as { panelPlacement?: Partial<PanelPlacementState> | undefined }).panelPlacement,
  )

  return {
    ...state,
    panelPlacement: placementState,
  }
}

function ensureScenePanelState(state: ScenePersistedState): ScenePersistedState {
  const scenes = state.scenes as Partial<StoredSceneDocument>[] | undefined
  if (!Array.isArray(scenes)) {
    return state
  }

  const normalizedScenes = scenes.map((scene) => ({
    ...scene,
    panelVisibility: normalizePanelVisibilityState(scene.panelVisibility as Partial<PanelVisibilityState> | undefined),
    panelPlacement: normalizePanelPlacementStateInput(scene.panelPlacement as Partial<PanelPlacementState> | undefined),
  }))

  return {
    ...state,
    scenes: normalizedScenes as StoredSceneDocument[],
  }
}

function ensureViewportSettings(state: ScenePersistedState): ScenePersistedState {
  const normalizedSettings = cloneViewportSettings(state.viewportSettings as Partial<SceneViewportSettings> | undefined)
  const scenes = state.scenes as Partial<StoredSceneDocument>[] | undefined
  const normalizedScenes = Array.isArray(scenes)
    ? scenes.map((scene) => ({
        ...scene,
        viewportSettings: cloneViewportSettings(scene.viewportSettings as Partial<SceneViewportSettings> | undefined),
        panelVisibility: normalizePanelVisibilityState(scene.panelVisibility as Partial<PanelVisibilityState> | undefined),
        panelPlacement: normalizePanelPlacementStateInput(scene.panelPlacement as Partial<PanelPlacementState> | undefined),
      }) as StoredSceneDocument)
    : scenes

  return {
    ...state,
    viewportSettings: normalizedSettings,
    scenes: normalizedScenes as StoredSceneDocument[] | undefined,
  }
}

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

function ensureProjectPanelTreeSize(state: ScenePersistedState): ScenePersistedState {
  const value = (state as { projectPanelTreeSize?: unknown }).projectPanelTreeSize
  return {
    ...state,
    projectPanelTreeSize: normalizeProjectPanelTreeSize(value),
  }
}

function removeLegacyExternalNodes(state: ScenePersistedState): ScenePersistedState {
  const rawNodes = state.nodes as SceneNode[] | undefined
  return {
    ...state,
    nodes: Array.isArray(rawNodes)
      ? rawNodes.filter((node) => (node as SceneNode).nodeType !== 'mesh')
      : rawNodes,
  }
}

function ensureSceneCollection(state: ScenePersistedState): ScenePersistedState {
  const existingScenes = state.scenes as StoredSceneDocument[] | undefined
  if (Array.isArray(existingScenes) && existingScenes.length > 0) {
    return state
  }

  const rawNodes = (state.nodes as SceneNode[] | undefined) ?? []
  const selectedNodeId = (state.selectedNodeId as string | null | undefined) ?? null
  const cameraState = state.camera as Partial<SceneCameraState> | undefined
  const rawCatalog = (state.assetCatalog as Record<string, ProjectAsset[]> | undefined) ?? null
  const rawIndex = (state.assetIndex as Record<string, AssetIndexEntry> | undefined) ?? null
  const rawPackageMap = (state.packageAssetMap as Record<string, string> | undefined) ?? null
  const rawGround = findGroundNode(rawNodes)
  const fallbackGroundSettings = cloneGroundSettings(
    (state as { groundSettings?: Partial<GroundSettings> | null }).groundSettings ??
      (rawGround?.dynamicMesh?.type === 'ground'
        ? { width: rawGround.dynamicMesh.width, depth: rawGround.dynamicMesh.depth }
        : undefined),
  )

  const cameraPosition = cloneVector(cameraState?.position ?? defaultCameraState.position)
  const cameraTarget = cloneVector(cameraState?.target ?? defaultCameraState.target)
  const cameraForward = cameraState?.forward ? cloneVector(cameraState.forward) : computeForwardVector(cameraPosition, cameraTarget)
  const camera: SceneCameraState = {
    position: cameraPosition,
    target: cameraTarget,
    fov: cameraState?.fov ?? defaultCameraState.fov,
    forward: cameraForward,
  }
  const viewportSettings = cloneViewportSettings(state.viewportSettings as Partial<SceneViewportSettings> | undefined)

  const recoveredScene = createSceneDocument('Recovered Scene', {
    nodes: rawNodes,
    selectedNodeId,
    camera,
    resourceProviderId: (state.resourceProviderId as string | undefined) ?? 'builtin',
    assetCatalog: rawCatalog ?? undefined,
    assetIndex: rawIndex ?? undefined,
    packageAssetMap: rawPackageMap ?? undefined,
    viewportSettings,
    panelVisibility: state.panelVisibility as Partial<PanelVisibilityState> | undefined,
    panelPlacement: (state as { panelPlacement?: Partial<PanelPlacementState> }).panelPlacement,
    groundSettings: fallbackGroundSettings,
  })

  return {
    ...state,
    scenes: [recoveredScene],
    currentSceneId: recoveredScene.id,
    nodes: cloneSceneNodes(recoveredScene.nodes),
    selectedNodeId: recoveredScene.selectedNodeId,
    selectedNodeIds: cloneSelection(recoveredScene.selectedNodeIds),
    camera: cloneCameraState(recoveredScene.camera),
    viewportSettings: cloneViewportSettings(recoveredScene.viewportSettings),
    panelVisibility: normalizePanelVisibilityState(recoveredScene.panelVisibility),
    panelPlacement: normalizePanelPlacementStateInput(recoveredScene.panelPlacement),
    groundSettings: cloneGroundSettings(recoveredScene.groundSettings),
    assetCatalog: cloneAssetCatalog(recoveredScene.assetCatalog),
    assetIndex: cloneAssetIndex(recoveredScene.assetIndex),
    packageAssetMap: clonePackageAssetMap(recoveredScene.packageAssetMap),
  }
}

function ensureResourceProvider(state: ScenePersistedState): ScenePersistedState {
  const scenes = state.scenes as StoredSceneDocument[] | undefined
  const updatedScenes = Array.isArray(scenes)
    ? scenes.map((scene) => ({
        ...scene,
        resourceProviderId: scene.resourceProviderId ?? 'builtin',
      }))
    : scenes

  return {
    ...state,
    scenes: updatedScenes,
    resourceProviderId: (state.resourceProviderId as string | undefined) ?? 'builtin',
  }
}

function ensureSceneTimestamps(state: ScenePersistedState): ScenePersistedState {
  const scenes = state.scenes as Partial<StoredSceneDocument>[] | undefined
  if (!Array.isArray(scenes)) {
    return state
  }

  const now = new Date().toISOString()
  const upgradedScenes = scenes.map((scene) => {
    const createdAt = scene.createdAt ?? now
    const updatedAt = scene.updatedAt ?? scene.createdAt ?? createdAt ?? now
    return {
      ...scene,
      createdAt,
      updatedAt,
      panelVisibility: normalizePanelVisibilityState(scene.panelVisibility as Partial<PanelVisibilityState> | undefined),
      panelPlacement: normalizePanelPlacementStateInput(scene.panelPlacement as Partial<PanelPlacementState> | undefined),
    } as StoredSceneDocument
  })

  return {
    ...state,
    scenes: upgradedScenes,
  }
}

function normalizeSceneSelections(state: ScenePersistedState): ScenePersistedState {
  const scenes = state.scenes as Partial<StoredSceneDocument>[] | undefined
  const updatedScenes = Array.isArray(scenes)
    ? scenes.map((scene) => {
        const nodes = Array.isArray(scene.nodes) ? (scene.nodes as SceneNode[]) : []
        const existingSelection = Array.isArray(scene.selectedNodeIds) ? scene.selectedNodeIds : undefined
        const fallbackId = scene.selectedNodeId ?? null
        const normalizedSelection = normalizeSelectionIds(
          nodes,
          existingSelection ?? (fallbackId ? [fallbackId] : []),
        )
        return {
          ...scene,
          selectedNodeIds: normalizedSelection,
          selectedNodeId: normalizedSelection[normalizedSelection.length - 1] ?? (fallbackId ?? null),
          panelVisibility: normalizePanelVisibilityState(scene.panelVisibility as Partial<PanelVisibilityState> | undefined),
          panelPlacement: normalizePanelPlacementStateInput(scene.panelPlacement as Partial<PanelPlacementState> | undefined),
        } as StoredSceneDocument
      })
    : scenes

  const nodes = Array.isArray(state.nodes) ? (state.nodes as SceneNode[]) : []
  const stateSelection = normalizeSelectionIds(nodes, state.selectedNodeIds as string[] | undefined)
  const fallbackId = (state.selectedNodeId as string | null | undefined) ?? null
  const normalizedStateSelection = stateSelection.length
    ? stateSelection
    : fallbackId
      ? [fallbackId]
      : []

  return {
    ...state,
    scenes: updatedScenes as StoredSceneDocument[] | undefined,
    selectedNodeIds: normalizedStateSelection,
    selectedNodeId: normalizedStateSelection[normalizedStateSelection.length - 1] ?? null,
  }
}

function ensureAssetCatalogState(state: ScenePersistedState): ScenePersistedState {
  const rawCatalog = (state as { assetCatalog?: unknown }).assetCatalog
  const rawIndex = (state as { assetIndex?: unknown }).assetIndex
  const rawPackageAssetMap = (state as { packageAssetMap?: unknown }).packageAssetMap

  const normalizedCatalogBase = createEmptyAssetCatalog()
  const normalizedCatalogEntries: Record<string, ProjectAsset[]> = { ...normalizedCatalogBase }
  if (rawCatalog && typeof rawCatalog === 'object') {
    const source = rawCatalog as Record<string, ProjectAsset[] | undefined>
    Object.keys(normalizedCatalogEntries).forEach((categoryId) => {
      const list = source[categoryId]
      normalizedCatalogEntries[categoryId] = Array.isArray(list) ? cloneAssetList(list) : []
    })
    Object.keys(source).forEach((categoryId) => {
      if (!(categoryId in normalizedCatalogEntries)) {
        const list = source[categoryId]
        if (Array.isArray(list)) {
          normalizedCatalogEntries[categoryId] = cloneAssetList(list)
        }
      }
    })
  }

  const normalizedIndex = rawIndex && typeof rawIndex === 'object'
    ? { ...(rawIndex as Record<string, AssetIndexEntry>) }
    : {}

  const normalizedPackageAssetMap = rawPackageAssetMap && typeof rawPackageAssetMap === 'object'
    ? { ...(rawPackageAssetMap as Record<string, string>) }
    : {}

  return {
    ...state,
    assetCatalog: normalizedCatalogEntries,
    assetIndex: normalizedIndex,
    packageAssetMap: normalizedPackageAssetMap,
  }
}

function ensurePackageDirectoryState(state: ScenePersistedState): ScenePersistedState {
  const rawCache = (state as { packageDirectoryCache?: unknown }).packageDirectoryCache
  const rawLoaded = (state as { packageDirectoryLoaded?: unknown }).packageDirectoryLoaded
  const normalizedCache: Record<string, ProjectDirectory[]> = rawCache && typeof rawCache === 'object'
    ? { ...(rawCache as Record<string, ProjectDirectory[]>) }
    : {}
  const normalizedLoaded: Record<string, boolean> = rawLoaded && typeof rawLoaded === 'object'
    ? { ...(rawLoaded as Record<string, boolean>) }
    : {}
  return {
    ...state,
    packageDirectoryCache: normalizedCache,
    packageDirectoryLoaded: normalizedLoaded,
  }
}

function normalizeGroundState(state: ScenePersistedState): ScenePersistedState {
  const processedScenes = Array.isArray(state.scenes)
    ? state.scenes.map((scene) => {
        if (!scene || typeof scene !== 'object') {
          return scene
        }
        const typedScene = scene as StoredSceneDocument
        const nodesSource = Array.isArray(typedScene.nodes) ? (typedScene.nodes as SceneNode[]) : []
        const existingGround = findGroundNode(nodesSource)
        const sceneGroundSettings = cloneGroundSettings(
          (typedScene as { groundSettings?: Partial<GroundSettings> | null }).groundSettings ??
            (existingGround?.dynamicMesh?.type === 'ground'
              ? { width: existingGround.dynamicMesh.width, depth: existingGround.dynamicMesh.depth }
              : undefined),
        )
        const normalizedNodes = ensureGroundNode(cloneSceneNodes(nodesSource), sceneGroundSettings)
        const selectedIdsSource = Array.isArray(typedScene.selectedNodeIds)
          ? typedScene.selectedNodeIds.filter((id) => normalizedNodes.some((node) => node.id === id && !isGroundNode(node)))
          : []
        const selectedNodeId = selectedIdsSource.includes(typedScene.selectedNodeId ?? '')
          ? typedScene.selectedNodeId
          : selectedIdsSource[0] ?? null
        return {
          ...typedScene,
          nodes: normalizedNodes,
          selectedNodeId,
          selectedNodeIds: selectedIdsSource,
          groundSettings: sceneGroundSettings,
          assetCatalog: stripLegacyGroundAssetFromCatalog(typedScene.assetCatalog) ?? typedScene.assetCatalog,
          assetIndex: stripLegacyGroundAssetFromIndex(typedScene.assetIndex) ?? typedScene.assetIndex,
          packageAssetMap: stripLegacyGroundAssetFromPackageMap(typedScene.packageAssetMap) ?? typedScene.packageAssetMap,
        }
      })
    : state.scenes

  const rootNodesSource = Array.isArray(state.nodes) ? (state.nodes as SceneNode[]) : []
  const rootGround = findGroundNode(rootNodesSource)
  const rootGroundSettings = cloneGroundSettings(
    (state as { groundSettings?: Partial<GroundSettings> | null }).groundSettings ??
      (rootGround?.dynamicMesh?.type === 'ground'
        ? { width: rootGround.dynamicMesh.width, depth: rootGround.dynamicMesh.depth }
        : undefined),
  )
  const normalizedRootNodes = ensureGroundNode(cloneSceneNodes(rootNodesSource), rootGroundSettings)

  return {
    ...state,
    nodes: normalizedRootNodes,
    assetCatalog: stripLegacyGroundAssetFromCatalog(state.assetCatalog) ?? state.assetCatalog,
    assetIndex: stripLegacyGroundAssetFromIndex(state.assetIndex) ?? state.assetIndex,
    packageAssetMap: stripLegacyGroundAssetFromPackageMap(state.packageAssetMap) ?? state.packageAssetMap,
    scenes: processedScenes,
    groundSettings: rootGroundSettings,
  }
}

const sceneStoreMigrationSteps: Array<(state: ScenePersistedState) => ScenePersistedState> = [
  ensureActiveTool,
  ensureCameraAndPanelState,
  ensurePanelPlacement,
  ensureScenePanelState,
  ensureViewportSettings,
  ensureProjectPanelTreeSize,
  removeLegacyExternalNodes,
  ensureSceneCollection,
  ensureResourceProvider,
  ensureSceneTimestamps,
  normalizeSceneSelections,
  ensureAssetCatalogState,
  ensurePackageDirectoryState,
  normalizeGroundState,
]

function migrateScenePersistedState(
  state: ScenePersistedState,
  _fromVersion: number,
  _toVersion: number,
): ScenePersistedState {
  if (!state || typeof state !== 'object') {
    return state
  }

  return sceneStoreMigrationSteps.reduce<ScenePersistedState>((current, step) => step(current), {
    ...state,
  })
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
  const groundSettings = cloneGroundSettings(
    options.groundSettings ??
      (existingGround?.dynamicMesh?.type === 'ground'
        ? { width: existingGround.dynamicMesh.width, depth: existingGround.dynamicMesh.depth }
        : undefined),
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

function commitSceneSnapshot(
  store: SceneState,
  options: { updateNodes?: boolean; updateCamera?: boolean } = {},
) {
  if (!store.currentSceneId) return
  const index = store.scenes.findIndex((scene) => scene.id === store.currentSceneId)
  if (index === -1) return

  const updateNodes = options.updateNodes ?? true
  const updateCamera = options.updateCamera ?? true
  const current = store.scenes[index]!
  const updatedAt = new Date().toISOString()

  const updatedScene: StoredSceneDocument = {
    ...current,
    nodes: updateNodes ? cloneSceneNodes(store.nodes) : current.nodes,
    materials: cloneSceneMaterials(store.materials),
    selectedNodeId: store.selectedNodeId,
    selectedNodeIds: cloneSelection(store.selectedNodeIds),
    camera: updateCamera ? cloneCameraState(store.camera) : current.camera,
    viewportSettings: cloneViewportSettings(store.viewportSettings),
  groundSettings: cloneGroundSettings(store.groundSettings),
    panelVisibility: normalizePanelVisibilityState(store.panelVisibility),
    panelPlacement: normalizePanelPlacementStateInput(store.panelPlacement),
    resourceProviderId: store.resourceProviderId,
    updatedAt,
    assetCatalog: cloneAssetCatalog(store.assetCatalog),
    assetIndex: cloneAssetIndex(store.assetIndex),
    packageAssetMap: clonePackageAssetMap(store.packageAssetMap),
  }

  store.scenes = [
    ...store.scenes.slice(0, index),
    updatedScene,
    ...store.scenes.slice(index + 1),
  ]
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
      scenes: [initialSceneDocument],
      currentSceneId: initialSceneDocument.id,
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
    }
  },
  getters: {
    currentScene(state): StoredSceneDocument | null {
      if (!state.scenes.length) {
        return null
      }
      if (state.currentSceneId) {
        const current = state.scenes.find((scene) => scene.id === state.currentSceneId)
        if (current) {
          return current
        }
      }
      return state.scenes[0] ?? null
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
    sceneSummaries(state): SceneSummary[] {
      return [...state.scenes]
        .map((scene) => ({
          id: scene.id,
          name: scene.name,
          thumbnail: scene.thumbnail ?? null,
          createdAt: scene.createdAt,
          updatedAt: scene.updatedAt,
        }))
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
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
      if (groundNode.dynamicMesh?.type !== 'ground') {
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
          existingGround.dynamicMesh?.type === 'ground'
            ? {
                ...existingGround.dynamicMesh,
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
      if (groundNode.dynamicMesh?.type !== 'ground') {
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
    setSelection(ids: string[], options: { commit?: boolean; primaryId?: string | null } = {}) {
      const commitChange = options.commit ?? true
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
      if (commitChange) {
        commitSceneSnapshot(this, { updateNodes: false, updateCamera: false })
      }
      return true
    },
    selectNode(id: string | null) {
      this.setSelection(id ? [id] : [], { commit: true, primaryId: id })
    },
    selectAllNodes() {
      const allIds = flattenNodeIds(this.nodes)
      this.setSelection(allIds, { commit: true })
    },
    clearSelection() {
      this.setSelection([], { commit: true })
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
      if (!target || (target.nodeType ?? 'mesh') !== 'mesh') {
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
        if ((node.nodeType ?? 'mesh') !== 'mesh') {
          return
        }
        const existingCount = node.materials?.length ?? 0
        const fallbackName = options.name?.trim() || shared?.name || `Material ${existingCount + 1}`
        const type = shared?.type ?? options.type ?? DEFAULT_MATERIAL_TYPE
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
      if (!target || (target.nodeType ?? 'mesh') !== 'mesh' || !target.materials?.length) {
        return false
      }
      if (!target.materials.some((entry) => entry.id === nodeMaterialId)) {
        return false
      }

      this.captureHistorySnapshot()
      let removed = false
      visitNode(this.nodes, nodeId, (node) => {
        if ((node.nodeType ?? 'mesh') !== 'mesh' || !node.materials?.length) {
          return
        }
        const nextMaterials = node.materials.filter((entry) => entry.id !== nodeMaterialId)
        if (nextMaterials.length !== node.materials.length) {
          node.materials = nextMaterials
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
        if ((node.nodeType ?? 'mesh') !== 'mesh' || !node.materials?.length) {
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
    assignNodeMaterial(nodeId: string, nodeMaterialId: string, materialId: string | null) {
      const shared = materialId ? this.materials.find((entry) => entry.id === materialId) ?? null : null
      if (materialId && !shared) {
        return false
      }

      let updated = false
      this.captureHistorySnapshot()
      visitNode(this.nodes, nodeId, (node) => {
        if ((node.nodeType ?? 'mesh') !== 'mesh' || !node.materials?.length) {
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
    updateNodeMaterialMetadata(nodeId: string, nodeMaterialId: string, metadata: { name?: string | null }) {
      const rawName = metadata.name
      const trimmedName = typeof rawName === 'string' ? rawName.trim() : rawName

      let updated = false
      this.captureHistorySnapshot()
      visitNode(this.nodes, nodeId, (node) => {
        if ((node.nodeType ?? 'mesh') !== 'mesh' || !node.materials?.length) {
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
          return createNodeMaterial(null, entry, {
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
      this.captureHistorySnapshot()
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
      this.captureHistorySnapshot()
      this.materials = [...this.materials, duplicated]
      commitSceneSnapshot(this, { updateNodes: false })
      return duplicated
    },
    updateMaterialDefinition(materialId: string, update: Partial<SceneMaterialProps> & { name?: string; description?: string }) {
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

      if (!hasPropChanges && !nameChanged && !descriptionChanged) {
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
      }

      this.captureHistorySnapshot()
      const nextList = [...this.materials]
      nextList.splice(existingIndex, 1, nextMaterial)
      this.materials = nextList

      let changedNodes = false
      if (applyMaterialPropsToNodeTree(this.nodes, materialId, nextMaterial)) {
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

      this.captureHistorySnapshot()

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
        if (applyMaterialPropsToNodeTree(this.nodes, materialId, defaultProps, null)) {
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
        this.setSelection(nextSelection, { commit: false })
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
        this.setSelection([], { commit: false })
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
        this.setSelection(remainingSelection, { commit: false, primaryId: nextPrimary })
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

          let stopDownloadWatcher: WatchStopHandle | null = null
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

          const shouldCacheModelObject = asset?.type === 'model'
          const baseObject = shouldCacheModelObject
            ? await getOrLoadModelObject(assetId, () => loadObjectFromFile(file))
            : await loadObjectFromFile(file)

          nodesForAsset.forEach((node, index) => {
            const object = shouldCacheModelObject || index > 0 ? baseObject.clone(true) : baseObject
            tagObjectWithNodeId(object, node.id)
            registerRuntimeObject(node.id, object)
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
    registerAsset(asset: ProjectAsset, options: { categoryId?: string; source?: AssetSourceMetadata } = {}) {
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
      commitSceneSnapshot(this, { updateNodes: false, updateCamera: false })
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
    deleteProjectAssets(assetIds: string[]): string[] {
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

      const assetIdSet = new Set(deletableIds)
      const assetCache = useAssetCacheStore()

      const assetNodeMap = collectNodesByAssetId(this.nodes)
      const nodeIdsToRemove: string[] = []
      deletableIds.forEach((assetId) => {
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

      const now = new Date().toISOString()
      const updatedScenes = this.scenes.map((scene) => {
        if (scene.id === this.currentSceneId) {
          return scene
        }
        const sceneAssetNodeMap = collectNodesByAssetId(scene.nodes)
        const sceneNodeIds: string[] = []
        deletableIds.forEach((assetId) => {
          const nodes = sceneAssetNodeMap.get(assetId)
          if (nodes?.length) {
            nodes.forEach((node) => sceneNodeIds.push(node.id))
          }
        })
        if (!sceneNodeIds.length) {
          return scene
        }
        const removedNodeIds: string[] = []
        const prunedNodes = pruneNodes(scene.nodes, new Set(sceneNodeIds), removedNodeIds)
        const removedSet = new Set(removedNodeIds)

        let selectedNodeIds = Array.isArray(scene.selectedNodeIds)
          ? scene.selectedNodeIds.filter((id) => !removedSet.has(id))
          : []
        let selectedNodeId = scene.selectedNodeId
        if (selectedNodeId && removedSet.has(selectedNodeId)) {
          selectedNodeId = null
        }
        if (!selectedNodeId && prunedNodes.length > 0) {
          selectedNodeId = prunedNodes[0]!.id
        }
        if (!selectedNodeIds.length && selectedNodeId) {
          selectedNodeIds = [selectedNodeId]
        }
        selectedNodeIds = normalizeSelectionIds(prunedNodes, selectedNodeIds)
        if (selectedNodeId && !selectedNodeIds.includes(selectedNodeId)) {
          selectedNodeId = selectedNodeIds[selectedNodeIds.length - 1] ?? null
        }

        return {
          ...scene,
          nodes: prunedNodes,
          selectedNodeId,
          selectedNodeIds,
          updatedAt: now,
        }
      })
      this.scenes = updatedScenes

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
        if (!assetIdSet.has(value)) {
          nextPackageMap[key] = value
        }
      })
      this.packageAssetMap = nextPackageMap

      deletableIds.forEach((assetId) => {
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
      commitSceneSnapshot(this, { updateNodes: false, updateCamera: false })
    },
    setCameraState(camera: SceneCameraState) {
      this.camera = cloneCameraState(camera)
      commitSceneSnapshot(this, { updateNodes: false })
    },
    resetCameraState() {
      this.camera = cloneCameraState(defaultCameraState)
      commitSceneSnapshot(this, { updateNodes: false })
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
      commitSceneSnapshot(this, { updateNodes: false, updateCamera: false })
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
      commitSceneSnapshot(this, { updateNodes: false, updateCamera: false })
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
      this.captureHistorySnapshot()
  const id = generateUuid()
      const node: SceneNode = {
        id,
        name: asset.name,
        nodeType: 'mesh',
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

      this.nodes = [...this.nodes, node]
      this.setSelection([id], { commit: false })
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
        const file = assetCache.createFileFromCache(asset.id)
        if (!file) {
          throw new Error('资源未缓存完成')
        }

        const shouldCacheModelObject = asset.type === 'model'
        const baseObject = shouldCacheModelObject
          ? await getOrLoadModelObject(asset.id, () => loadObjectFromFile(file))
          : await loadObjectFromFile(file)
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
      this.nodes = [...this.nodes, node]
      this.setSelection([node.id], { commit: false })
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

      const nodeType = payload.nodeType ?? 'mesh'
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
      const baseMaterial = this.materials[0] ?? null
      const initialProps: SceneMaterialProps = baseMaterial ? baseMaterial : createMaterialProps()
      const initialMaterial = createNodeMaterial(baseMaterial?.id ?? null, initialProps, {
        name: baseMaterial?.name,
        type: baseMaterial?.type ?? DEFAULT_MATERIAL_TYPE,
      })
      const node: SceneNode = {
        id,
        name: payload.name ?? payload.object.name ?? 'Imported Mesh',
        nodeType: payload.nodeType,
        materials: [initialMaterial],
        position: payload.position ?? { x: 0, y: 0, z: 0 },
        rotation: payload.rotation ?? { x: 0, y: 0, z: 0 },
        scale: payload.scale ?? { x: 1, y: 1, z: 1 },
        visible: true,
        sourceAssetId: payload.sourceAssetId,
        dynamicMesh: payload.dynamicMesh ? cloneDynamicMeshDefinition(payload.dynamicMesh) : undefined,
      }

      registerRuntimeObject(id, payload.object)
      tagObjectWithNodeId(payload.object, id)
      this.nodes = [...this.nodes, node]
      this.setSelection([id], { commit: false })
      commitSceneSnapshot(this)

      return node
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
        nodeType: 'mesh',
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
      if (!node || node.dynamicMesh?.type !== 'wall') {
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
      if (!node || node.dynamicMesh?.type !== 'wall') {
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
        type: 'wall',
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
      this.setSelection(nextSelection, { commit: false })
      const assetCache = useAssetCacheStore()
      assetCache.recalculateUsage(this.nodes)
      commitSceneSnapshot(this)
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
        this.setSelection(duplicateIds, { commit: false, primaryId: nextPrimary })
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
        this.setSelection(duplicateIds, { commit: false })
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
    createScene(
      name = 'Untitled Scene',
      thumbnailOrOptions?: string | null | { thumbnail?: string | null; groundSettings?: Partial<GroundSettings> },
    ) {
      commitSceneSnapshot(this)
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
      const scene = createSceneDocument(displayName, {
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
      this.scenes = [...this.scenes, scene]
      this.currentSceneId = scene.id
      applySceneAssetState(this, scene)
      this.nodes = cloneSceneNodes(scene.nodes)
      this.groundSettings = cloneGroundSettings(scene.groundSettings)
      this.setSelection(scene.selectedNodeIds ?? (scene.selectedNodeId ? [scene.selectedNodeId] : []), {
        commit: false,
      })
      this.camera = cloneCameraState(scene.camera)
      this.viewportSettings = cloneViewportSettings(scene.viewportSettings)
  this.panelVisibility = normalizePanelVisibilityState(scene.panelVisibility)
  this.panelPlacement = normalizePanelPlacementStateInput(scene.panelPlacement)
      this.resourceProviderId = scene.resourceProviderId
      useAssetCacheStore().recalculateUsage(this.nodes)
      this.isSceneReady = true
      return scene.id
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
      commitSceneSnapshot(this)
      const scene = this.scenes.find((item) => item.id === sceneId)
      if (!scene) {
        return false
      }

      this.nodes.forEach((node) => releaseRuntimeTree(node))

      this.isSceneReady = false
      try {
        await this.ensureSceneAssetsReady({
          nodes: scene.nodes,
          showOverlay: true,
          refreshViewport: false,
        })

        this.currentSceneId = sceneId
        applySceneAssetState(this, scene)
        this.nodes = cloneSceneNodes(scene.nodes)
        this.setSelection(scene.selectedNodeIds ?? (scene.selectedNodeId ? [scene.selectedNodeId] : []), {
          commit: false,
        })
        this.camera = cloneCameraState(scene.camera)
        this.viewportSettings = cloneViewportSettings(scene.viewportSettings)
        this.panelVisibility = normalizePanelVisibilityState(scene.panelVisibility)
        this.panelPlacement = normalizePanelPlacementStateInput(scene.panelPlacement)
        this.groundSettings = cloneGroundSettings(scene.groundSettings)
        this.resourceProviderId = scene.resourceProviderId ?? 'builtin'
        useAssetCacheStore().recalculateUsage(this.nodes)
      } finally {
        this.isSceneReady = true
      }
      return true
    },
    async deleteScene(sceneId: string) {
      commitSceneSnapshot(this)
      const index = this.scenes.findIndex((scene) => scene.id === sceneId)
      if (index === -1) {
        return false
      }

      const target = this.scenes[index]!
      target.nodes.forEach((node) => releaseRuntimeTree(node))

      const remaining = this.scenes.filter((scene) => scene.id !== sceneId)

      if (remaining.length === 0) {
        const fallback = createSceneDocument('Untitled Scene', {
          resourceProviderId: 'builtin',
          groundSettings: this.groundSettings,
        })
        this.scenes = [fallback]
        this.currentSceneId = fallback.id
        applySceneAssetState(this, fallback)
        this.nodes = cloneSceneNodes(fallback.nodes)
        this.setSelection(fallback.selectedNodeIds ?? (fallback.selectedNodeId ? [fallback.selectedNodeId] : []), {
          commit: false,
        })
        this.camera = cloneCameraState(fallback.camera)
        this.panelVisibility = normalizePanelVisibilityState(fallback.panelVisibility)
        this.panelPlacement = normalizePanelPlacementStateInput(fallback.panelPlacement)
        this.groundSettings = cloneGroundSettings(fallback.groundSettings)
        this.resourceProviderId = fallback.resourceProviderId
        useAssetCacheStore().recalculateUsage(this.nodes)
        this.isSceneReady = true
        return true
      }

      this.scenes = remaining

      if (this.currentSceneId === sceneId) {
        const next = remaining[0]!
        this.isSceneReady = false
        try {
          await this.ensureSceneAssetsReady({
            nodes: next.nodes,
            showOverlay: true,
            refreshViewport: false,
          })
          this.currentSceneId = next.id
          applySceneAssetState(this, next)
          this.nodes = cloneSceneNodes(next.nodes)
          this.setSelection(next.selectedNodeIds ?? (next.selectedNodeId ? [next.selectedNodeId] : []), {
            commit: false,
          })
          this.camera = cloneCameraState(next.camera)
          this.panelVisibility = normalizePanelVisibilityState(next.panelVisibility)
          this.panelPlacement = normalizePanelPlacementStateInput(next.panelPlacement)
          this.groundSettings = cloneGroundSettings(next.groundSettings)
          this.resourceProviderId = next.resourceProviderId ?? 'builtin'
          useAssetCacheStore().recalculateUsage(this.nodes)
        } finally {
          this.isSceneReady = true
        }
      }

      return true
    },
    renameScene(sceneId: string, name: string) {
      const trimmed = name.trim()
      if (!trimmed) {
        return false
      }
      const index = this.scenes.findIndex((scene) => scene.id === sceneId)
      if (index === -1) {
        return false
      }
      const scene = this.scenes[index]!
      const updated: StoredSceneDocument = {
        ...scene,
        name: trimmed,
        updatedAt: new Date().toISOString(),
      }
      this.scenes = [
        ...this.scenes.slice(0, index),
        updated,
        ...this.scenes.slice(index + 1),
      ]
      return true
    },
    updateSceneThumbnail(sceneId: string, thumbnail: string | null) {
      const index = this.scenes.findIndex((scene) => scene.id === sceneId)
      if (index === -1) {
        return false
      }
      const scene = this.scenes[index]!
      const updated: StoredSceneDocument = {
        ...scene,
        thumbnail,
        updatedAt: new Date().toISOString(),
      }
      this.scenes = [
        ...this.scenes.slice(0, index),
        updated,
        ...this.scenes.slice(index + 1),
      ]
      return true
    },
    exportSceneBundle(sceneIds: string[]): SceneBundleExportPayload | null {
      if (!Array.isArray(sceneIds) || !sceneIds.length) {
        return null
      }
      const uniqueIds = Array.from(new Set(sceneIds))
      const idSet = new Set(uniqueIds)
      const selected = this.scenes.filter((scene) => idSet.has(scene.id))
      if (!selected.length) {
        return null
      }
      return {
        formatVersion: SCENE_BUNDLE_FORMAT_VERSION,
        exportedAt: new Date().toISOString(),
        scenes: selected.map((scene) => cloneSceneDocumentForExport(scene)),
      }
    },
    importSceneBundle(payload: SceneBundleImportPayload): SceneImportResult {
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

      const existingNames = new Set(this.scenes.map((scene) => scene.name))
      const imported: StoredSceneDocument[] = []
      const renamedScenes: Array<{ originalName: string; renamedName: string }> = []

      payload.scenes.forEach((entry, index) => {
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

        imported.push(sceneDocument)
      })

      if (!imported.length) {
        throw new Error('场景文件不包含任何有效场景')
      }

      this.scenes = [...this.scenes, ...imported]

      return {
        importedSceneIds: imported.map((scene) => scene.id),
        renamedScenes,
      }
    },
    async ensureCurrentSceneLoaded() {
      this.isSceneReady = false
      if (!this.scenes.length) {
        const fallback = createSceneDocument('Untitled Scene', { resourceProviderId: 'builtin' })
        this.scenes = [fallback]
        this.currentSceneId = fallback.id
        applySceneAssetState(this, fallback)
        this.nodes = cloneSceneNodes(fallback.nodes)
        this.setSelection(fallback.selectedNodeIds ?? (fallback.selectedNodeId ? [fallback.selectedNodeId] : []), {
          commit: false,
        })
        this.camera = cloneCameraState(fallback.camera)
        this.viewportSettings = cloneViewportSettings(fallback.viewportSettings)
        this.panelVisibility = normalizePanelVisibilityState(fallback.panelVisibility)
        this.panelPlacement = normalizePanelPlacementStateInput(fallback.panelPlacement)
        this.resourceProviderId = fallback.resourceProviderId
        this.isSceneReady = true
        return
      }

      let target = this.scenes.find((scene) => scene.id === this.currentSceneId) ?? null
      if (!target) {
        target = this.scenes[0]!
        this.currentSceneId = target.id
      }

      await this.ensureSceneAssetsReady({
        nodes: target.nodes,
        showOverlay: true,
        refreshViewport: false,
      })

      this.nodes = cloneSceneNodes(target.nodes)
      this.setSelection(target.selectedNodeIds ?? (target.selectedNodeId ? [target.selectedNodeId] : []), {
        commit: false,
      })
      this.camera = cloneCameraState(target.camera)
      this.viewportSettings = cloneViewportSettings(target.viewportSettings)
      this.panelVisibility = normalizePanelVisibilityState(target.panelVisibility)
      this.panelPlacement = normalizePanelPlacementStateInput(target.panelPlacement)
      this.resourceProviderId = target.resourceProviderId ?? 'builtin'
      applySceneAssetState(this, target)
      useAssetCacheStore().recalculateUsage(this.nodes)
      this.isSceneReady = true
    },
  },
  persist: {
    key: 'scene-store',
    storage: 'local',
    version: 1,
    pick: [
      'scenes',
      'currentSceneId',
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
    ],
    migrations: migrateScenePersistedState,
  },
})