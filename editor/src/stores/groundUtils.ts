// Ground-related helper utilities extracted from sceneStore.
// These functions use `import type` to reference shared types only at compile time
// to avoid runtime circular dependencies.

import {
  GROUND_TERRAIN_CHUNK_SIZE_METERS,
  getGroundVertexIndex,
  GROUND_HEIGHT_UNSET_VALUE,
  type GroundDynamicMesh,
  type GroundGenerationSettings,
  type GroundSettings,
  type SceneNode,
  resolveGroundWorkingGridSize,
} from '@schema'
import type { SceneMaterialProps, SceneNodeMaterial, SceneMaterialType } from '@/types/material'
import type { Vector3 } from 'three'
import { computeGroundBaseHeightAtVertex } from '@schema/groundGeneration'

const DEFAULT_GROUND_CELL_SIZE = 1
const DEFAULT_GROUND_EXTENT = 100
const DEFAULT_GROUND_RENDER_RADIUS_CHUNKS = 4
const DEFAULT_GROUND_COLLISION_RADIUS_CHUNKS = 2
const MIN_GROUND_EXTENT = 1
const HEIGHT_EPSILON = 1e-5
const GROUND_CREATION_AXIS_TARGET = 1024
const GROUND_CREATION_HIGH_VERTEX_BUDGET = 1_500_000
const GROUND_CREATION_BALANCED_VERTEX_BUDGET = 4_000_000
const GROUND_CREATION_SEVERE_VERTEX_BUDGET = 16_000_000
const GROUND_CREATION_EDIT_TILE_WORLD_TARGET = 128
const GROUND_CREATION_EDIT_TILE_MIN_RESOLUTION = 64
const GROUND_CREATION_EDIT_TILE_MAX_RESOLUTION = 256

export type GroundCreationQuality = 'high' | 'balanced' | 'constrained'

export type GroundCreationWarningLevel = 'none' | 'info' | 'caution' | 'severe'

export type GroundCreationProfile = {
  quality: GroundCreationQuality
  storageMode: 'full' | 'tiled'
  cellSize: number
  rows: number
  columns: number
  tileSizeMeters: number
  tileResolution: number
  globalLodCellSize: number
  activeEditWindowRadius: number
  editTileSizeMeters: number
  editTileResolution: number
  editCellSize: number
  collisionMode: 'full-heightfield' | 'tiled-heightfield' | 'near-field-only'
  estimatedVertexCount: number
  estimatedHeightBytes: number
  estimatedTileCount: number
  warningLevel: GroundCreationWarningLevel
  warningMessage: string | null
}

export type GroundRegionBounds = {
  minRow: number
  maxRow: number
  minColumn: number
  maxColumn: number
}

export type GroundDeps = {
  createVector: (x: number, y: number, z: number) => Vector3
  createNodeMaterial: (props: SceneMaterialProps, options?: { id?: string; name?: string; type?: SceneMaterialType }) => SceneNodeMaterial
  createMaterialProps: (overrides?: Partial<SceneMaterialProps> | null) => SceneMaterialProps
  generateUuid: () => string
  clampRigidbodyComponentProps: (p: any) => any
  RIGIDBODY_COMPONENT_TYPE: string
  
  GROUND_NODE_ID?: string
  getPrimaryNodeMaterial?: (node: SceneNode) => SceneNodeMaterial | null
  cloneNode?: (node: SceneNode) => SceneNode
}

function manualDeepCloneLocal(source: unknown): unknown {
  if (Array.isArray(source)) {
    return source.map((entry) => manualDeepCloneLocal(entry))
  }
  if (source && typeof source === 'object') {
    const target: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      target[key] = manualDeepCloneLocal(value)
    }
    return target
  }
  return source
}

type GroundDynamicMeshLike = GroundDynamicMesh & { terrainScatter?: unknown; terrainPaint?: unknown }
type GroundDynamicMeshResult = GroundDynamicMesh & { terrainScatter?: unknown; terrainPaint?: unknown }
type GroundRuntimeDynamicMesh = GroundDynamicMesh & { manualHeightMap: Float64Array; planningHeightMap: Float64Array }

function buildPrimaryGroundMaterialProps(
  createMaterialProps: GroundDeps['createMaterialProps'],
  primaryMaterial: SceneNodeMaterial | null,
): SceneMaterialProps {
  const materialProps: Partial<SceneMaterialProps> = {
    color: primaryMaterial?.color ?? '#707070',
    transparent: primaryMaterial?.transparent,
    opacity: primaryMaterial?.opacity,
    side: primaryMaterial?.side,
    wireframe: primaryMaterial?.wireframe,
    metalness: primaryMaterial?.metalness,
    roughness: primaryMaterial?.roughness,
    emissive: primaryMaterial?.emissive,
    emissiveIntensity: primaryMaterial?.emissiveIntensity,
    aoStrength: primaryMaterial?.aoStrength,
    envMapIntensity: primaryMaterial?.envMapIntensity,
    textures: manualDeepCloneLocal(primaryMaterial?.textures ?? null) as SceneMaterialProps['textures'],
  }
  return createMaterialProps(materialProps)
}

export function cloneGroundGenerationSettings(settings?: GroundGenerationSettings | null): GroundGenerationSettings | undefined {
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

export function cloneGroundDynamicMesh(definition: GroundDynamicMeshLike): GroundDynamicMeshResult {
  const result: GroundDynamicMeshResult = {
    type: 'Ground',
    terrainMode: definition.terrainMode ?? 'infinite',
    chunkSizeMeters: definition.chunkSizeMeters ?? GROUND_TERRAIN_CHUNK_SIZE_METERS,
    baseHeight: definition.baseHeight ?? 0,
    renderRadiusChunks: definition.renderRadiusChunks ?? DEFAULT_GROUND_RENDER_RADIUS_CHUNKS,
    collisionRadiusChunks: definition.collisionRadiusChunks ?? DEFAULT_GROUND_COLLISION_RADIUS_CHUNKS,
    chunkManifestRevision: Number.isFinite(definition.chunkManifestRevision) ? Math.max(0, Math.trunc(definition.chunkManifestRevision as number)) : 0,
    cellSize: definition.cellSize,
    storageMode: definition.storageMode,
    tileSizeMeters: definition.tileSizeMeters,
    tileResolution: definition.tileResolution,
    globalLodCellSize: definition.globalLodCellSize,
    activeEditWindowRadius: definition.activeEditWindowRadius,
    editTileSizeMeters: definition.editTileSizeMeters,
    editTileResolution: definition.editTileResolution,
    collisionMode: definition.collisionMode,
    chunkStreamingEnabled: definition.chunkStreamingEnabled,
    surfaceRevision: Number.isFinite(definition.surfaceRevision) ? Math.max(0, Math.trunc(definition.surfaceRevision as number)) : 0,
    heightComposition: { ...(definition.heightComposition ?? { mode: 'planning_plus_manual' as const }) },
    planningMetadata: manualDeepCloneLocal(definition.planningMetadata ?? null) as unknown as GroundDynamicMesh['planningMetadata'],
    terrainScatterInstancesUpdatedAt: definition.terrainScatterInstancesUpdatedAt,
    textureDataUrl: definition.textureDataUrl ?? null,
    textureName: definition.textureName ?? null,
    generation: cloneGroundGenerationSettings(definition.generation) ?? null,
    localEditTiles: manualDeepCloneLocal(definition.localEditTiles ?? null) as GroundDynamicMesh['localEditTiles'],
  }
  if (definition.optimizedMesh !== undefined) {
    result.optimizedMesh = manualDeepCloneLocal(definition.optimizedMesh) as GroundDynamicMesh['optimizedMesh']
  }
  if (definition.castShadow !== undefined) {
    result.castShadow = definition.castShadow
  }
  return result
}

export function normalizeGroundDimension(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseFloat(value)
      : Number.NaN
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  if (numeric <= MIN_GROUND_EXTENT) {
    return MIN_GROUND_EXTENT
  }
  return numeric
}

export function normalizeGroundSettings(settings: Partial<GroundSettings> | null | undefined): GroundSettings {
  return {
    width: normalizeGroundDimension(settings?.width as unknown, DEFAULT_GROUND_EXTENT),
    depth: normalizeGroundDimension(settings?.depth as unknown, DEFAULT_GROUND_EXTENT),
    chunkSizeMeters: normalizeGroundDimension(settings?.chunkSizeMeters as unknown, GROUND_TERRAIN_CHUNK_SIZE_METERS),
    baseHeight: typeof settings?.baseHeight === 'number' && Number.isFinite(settings.baseHeight) ? settings.baseHeight : 0,
    renderRadiusChunks: Math.max(1, Math.trunc(typeof settings?.renderRadiusChunks === 'number' && Number.isFinite(settings.renderRadiusChunks) ? settings.renderRadiusChunks : DEFAULT_GROUND_RENDER_RADIUS_CHUNKS)),
    collisionRadiusChunks: Math.max(1, Math.trunc(typeof settings?.collisionRadiusChunks === 'number' && Number.isFinite(settings.collisionRadiusChunks) ? settings.collisionRadiusChunks : DEFAULT_GROUND_COLLISION_RADIUS_CHUNKS)),
    enableAirWall: settings?.enableAirWall === true,
    editorScatterDynamicStreamingEnabled: settings?.editorScatterDynamicStreamingEnabled !== false,
    editorScatterVisible: settings?.editorScatterVisible !== false,
  }
}

export function cloneGroundSettings(settings: Partial<GroundSettings> | null | undefined): GroundSettings {
  return normalizeGroundSettings(settings ?? null)
}

export function resolveGroundCreationProfile(
  width: number,
  depth: number,
  baseCellSize = DEFAULT_GROUND_CELL_SIZE,
): GroundCreationProfile {
  const safeWidth = Math.max(MIN_GROUND_EXTENT, Number.isFinite(width) ? Math.abs(width) : DEFAULT_GROUND_EXTENT)
  const safeDepth = Math.max(MIN_GROUND_EXTENT, Number.isFinite(depth) ? Math.abs(depth) : DEFAULT_GROUND_EXTENT)
  const normalizedBaseCellSize = Math.max(DEFAULT_GROUND_CELL_SIZE, Number.isFinite(baseCellSize) ? Math.abs(baseCellSize) : DEFAULT_GROUND_CELL_SIZE)

  const denseColumns = Math.max(1, Math.ceil(safeWidth / normalizedBaseCellSize))
  const denseRows = Math.max(1, Math.ceil(safeDepth / normalizedBaseCellSize))
  const denseVertexCount = (denseColumns + 1) * (denseRows + 1)

  let storageMode: 'full' | 'tiled' = 'full'
  let quality: GroundCreationQuality = 'high'
  let warningLevel: GroundCreationWarningLevel = 'none'
  let warningMessage: string | null = null
  let cellSize = normalizedBaseCellSize

  if (denseVertexCount > GROUND_CREATION_HIGH_VERTEX_BUDGET) {
    storageMode = 'tiled'
    quality = 'balanced'
    warningLevel = 'info'
    cellSize = Math.max(normalizedBaseCellSize, Math.ceil(Math.max(safeWidth, safeDepth) / GROUND_CREATION_AXIS_TARGET))
    warningMessage = '地形已自动切换为分层/流式配置，并提高单元尺寸以控制工作集。'
  }

  const columns = Math.max(1, Math.ceil(safeWidth / cellSize))
  const rows = Math.max(1, Math.ceil(safeDepth / cellSize))
  const estimatedVertexCount = (columns + 1) * (rows + 1)
  const estimatedHeightBytes = estimatedVertexCount * Float64Array.BYTES_PER_ELEMENT * 2
  const estimatedTileCount = Math.max(1, Math.ceil(columns / GROUND_CREATION_AXIS_TARGET) * Math.ceil(rows / GROUND_CREATION_AXIS_TARGET))
  const tileSizeMeters = Math.max(128, Math.min(512, Math.ceil(Math.max(safeWidth, safeDepth) / Math.max(1, Math.ceil(Math.sqrt(estimatedTileCount))))))
  const tileResolution = Math.max(32, Math.min(128, Math.ceil(tileSizeMeters / cellSize)))
  const globalLodCellSize = Math.max(cellSize * 2, Math.ceil(Math.max(safeWidth, safeDepth) / Math.max(1, GROUND_CREATION_AXIS_TARGET * 2)))
  const activeEditWindowRadius = Math.max(tileSizeMeters, Math.min(tileSizeMeters * 2, Math.ceil(Math.max(safeWidth, safeDepth) / 8)))
  const editTileSizeMeters = Math.max(cellSize, Math.min(tileSizeMeters, GROUND_CREATION_EDIT_TILE_WORLD_TARGET))
  const editTileResolution = Math.max(
    GROUND_CREATION_EDIT_TILE_MIN_RESOLUTION,
    Math.min(
      GROUND_CREATION_EDIT_TILE_MAX_RESOLUTION,
      Math.ceil(editTileSizeMeters / normalizedBaseCellSize),
    ),
  )
  const editCellSize = editTileSizeMeters / editTileResolution
  const collisionMode: 'full-heightfield' | 'tiled-heightfield' | 'near-field-only' = estimatedVertexCount <= GROUND_CREATION_HIGH_VERTEX_BUDGET
    ? 'full-heightfield'
    : estimatedVertexCount <= GROUND_CREATION_BALANCED_VERTEX_BUDGET
      ? 'tiled-heightfield'
      : 'near-field-only'

  if (estimatedVertexCount > GROUND_CREATION_BALANCED_VERTEX_BUDGET) {
    storageMode = 'tiled'
    quality = 'constrained'
    warningLevel = 'caution'
    warningMessage = '地形工作集较大，系统将优先保留近场高精编辑 tile，并在远场使用更粗的显示分辨率。'
  }

  if (estimatedVertexCount > GROUND_CREATION_SEVERE_VERTEX_BUDGET) {
    warningLevel = 'severe'
    warningMessage = '地形规模极大，系统会强依赖局部高精编辑 tile 与远场流式显示，建议围绕工作区进行编辑。'
  }

  return {
    quality,
    storageMode,
    cellSize,
    rows,
    columns,
    tileSizeMeters,
    tileResolution,
    globalLodCellSize,
    activeEditWindowRadius,
    editTileSizeMeters,
    editTileResolution,
    editCellSize,
    collisionMode,
    estimatedVertexCount,
    estimatedHeightBytes,
    estimatedTileCount,
    warningLevel,
    warningMessage,
  }
}

export function createGroundDynamicMeshDefinition(overrides: Partial<GroundDynamicMesh> = {}, settings?: GroundSettings): GroundDynamicMesh {
  const baseSettings = normalizeGroundSettings(settings ?? null)
  const o = overrides as Partial<GroundDynamicMeshLike>
  const creationProfile = resolveGroundCreationProfile(
    baseSettings.width,
    baseSettings.depth,
    overrides.cellSize ?? DEFAULT_GROUND_CELL_SIZE,
  )
  const cellSize = overrides.cellSize ?? creationProfile.cellSize
  const initialGeneration = cloneGroundGenerationSettings(overrides.generation) ?? null
  const definition: GroundDynamicMesh = {
    type: 'Ground',
    terrainMode: overrides.terrainMode ?? 'infinite',
    chunkSizeMeters: overrides.chunkSizeMeters ?? baseSettings.chunkSizeMeters ?? GROUND_TERRAIN_CHUNK_SIZE_METERS,
    baseHeight: overrides.baseHeight ?? baseSettings.baseHeight ?? 0,
    renderRadiusChunks: overrides.renderRadiusChunks ?? baseSettings.renderRadiusChunks ?? DEFAULT_GROUND_RENDER_RADIUS_CHUNKS,
    collisionRadiusChunks: overrides.collisionRadiusChunks ?? baseSettings.collisionRadiusChunks ?? DEFAULT_GROUND_COLLISION_RADIUS_CHUNKS,
    chunkManifestRevision: Number.isFinite(overrides.chunkManifestRevision) ? Math.max(0, Math.trunc(overrides.chunkManifestRevision as number)) : 0,
    cellSize,
    storageMode: creationProfile.storageMode,
    tileSizeMeters: creationProfile.tileSizeMeters,
    tileResolution: creationProfile.tileResolution,
    globalLodCellSize: creationProfile.globalLodCellSize,
    activeEditWindowRadius: creationProfile.activeEditWindowRadius,
    editTileSizeMeters: creationProfile.editTileSizeMeters,
    editTileResolution: creationProfile.editTileResolution,
    collisionMode: creationProfile.collisionMode,
      chunkStreamingEnabled: overrides.chunkStreamingEnabled ?? true,
    surfaceRevision: Number.isFinite(overrides.surfaceRevision) ? Math.max(0, Math.trunc(overrides.surfaceRevision as number)) : 0,
    heightComposition: {
      mode: overrides.heightComposition?.mode ?? 'planning_plus_manual',
      policyVersion: overrides.heightComposition?.policyVersion,
    },
    planningMetadata: manualDeepCloneLocal(overrides.planningMetadata ?? null) as unknown as GroundDynamicMesh['planningMetadata'],
    terrainScatterInstancesUpdatedAt: Date.now(),
    textureDataUrl: overrides.textureDataUrl ?? null,
    textureName: overrides.textureName ?? null,
    generation: initialGeneration,
  }

  if (o.optimizedMesh !== undefined) {
    definition.optimizedMesh = manualDeepCloneLocal(o.optimizedMesh) as GroundDynamicMesh['optimizedMesh']
  }

  if (typeof (o as any).castShadow === 'boolean') {
    definition.castShadow = (o as any).castShadow
  }

  if (initialGeneration) {
    // applyGroundGeneration is editor-specific; caller can apply if needed.
  }

  return definition
}

export function normalizeGroundBounds(definition: GroundDynamicMesh, bounds: GroundRegionBounds): GroundRegionBounds {
  const gridSize = resolveGroundWorkingGridSize(definition)
  const minRow = Math.max(0, Math.min(gridSize.rows, Math.min(bounds.minRow, bounds.maxRow)))
  const maxRow = Math.max(0, Math.min(gridSize.rows, Math.max(bounds.minRow, bounds.maxRow)))
  const minColumn = Math.max(0, Math.min(gridSize.columns, Math.min(bounds.minColumn, bounds.maxColumn)))
  const maxColumn = Math.max(0, Math.min(gridSize.columns, Math.max(bounds.minColumn, bounds.maxColumn)))
  return { minRow, maxRow, minColumn, maxColumn }
}

export function applyGroundRegionTransform(
  definition: GroundRuntimeDynamicMesh,
  bounds: GroundRegionBounds,
  transform: (current: number, row: number, column: number) => number,
): { definition: GroundRuntimeDynamicMesh; changed: boolean } {
  const gridSize = resolveGroundWorkingGridSize(definition)
  const getBaseHeight = (row: number, column: number): number => computeGroundBaseHeightAtVertex(definition, row, column)
  const getManualHeight = (row: number, column: number): number => {
    const raw = definition.manualHeightMap[getGroundVertexIndex(gridSize.columns, row, column)]
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw
    }
    return getBaseHeight(row, column)
  }
  const getPlanningHeight = (row: number, column: number): number => {
    const raw = definition.planningHeightMap[getGroundVertexIndex(gridSize.columns, row, column)]
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw
    }
    return getBaseHeight(row, column)
  }
  const resolveEffectiveHeight = (row: number, column: number): number => {
    const base = getBaseHeight(row, column)
    const manual = getManualHeight(row, column)
    const planning = getPlanningHeight(row, column)
    return planning + (manual - base)
  }
  const resolveManualForEffective = (row: number, column: number, effective: number): number => {
    const base = getBaseHeight(row, column)
    const planning = getPlanningHeight(row, column)
    return base + (effective - planning)
  }
  const roundHeight = (value: number): number => {
    const rounded = Math.round(value * 100) / 100
    return Object.is(rounded, -0) ? 0 : rounded
  }

  const normalized = normalizeGroundBounds(definition, bounds)
  const nextHeightMap = definition.manualHeightMap
  let changed = false
  for (let row = normalized.minRow; row <= normalized.maxRow; row += 1) {
    for (let column = normalized.minColumn; column <= normalized.maxColumn; column += 1) {
      const heightIndex = getGroundVertexIndex(gridSize.columns, row, column)
      const previousStored = nextHeightMap[heightIndex] ?? Number.NaN
      const currentEffective = resolveEffectiveHeight(row, column)
      const nextEffective = transform(currentEffective, row, column)
      if (!Number.isFinite(nextEffective)) {
        continue
      }

      const nextManual = resolveManualForEffective(row, column, nextEffective)
      const roundedManual = roundHeight(nextManual)
      const roundedBase = roundHeight(getBaseHeight(row, column))

      if (roundedManual === roundedBase) {
        nextHeightMap[heightIndex] = GROUND_HEIGHT_UNSET_VALUE
      } else {
        nextHeightMap[heightIndex] = roundedManual
      }

      const nextStored = nextHeightMap[heightIndex]
      const previousFinite = Number.isFinite(previousStored)
      const nextFinite = Number.isFinite(nextStored)
      if (!previousFinite && !nextFinite) {
        continue
      }
      if (!previousFinite || !nextFinite) {
        changed = true
        continue
      }
      if (Math.abs(nextStored - previousStored) > HEIGHT_EPSILON) {
        changed = true
      }
    }
  }
  if (!changed) {
    return { definition, changed: false }
  }
  return {
    definition,
    changed: true,
  }
}

export function isGroundNode(node: SceneNode): boolean {
  return node?.id === 'ground' || node?.dynamicMesh?.type === 'Ground'
}

export function findGroundNode(nodes: SceneNode[]): SceneNode | null {
  for (const node of nodes) {
    if (isGroundNode(node)) {
      return node
    }
    if (node.children?.length) {
      const found = findGroundNode(node.children)
      if (found) return found
    }
  }
  return null
}

export function ensureGroundNode(nodes: SceneNode[], settings?: GroundSettings): SceneNode[] {
  let groundNode: SceneNode | null = null
  const others: SceneNode[] = []
  for (const node of nodes) {
    if (!groundNode && isGroundNode(node)) {
      groundNode = node
    } else {
      others.push(node)
    }
  }
  if (!groundNode) {
    groundNode = createGroundSceneNodeFallback(settings)
  }
  return [groundNode, ...others]
}

// Fallback creator used when ensureGroundNode is called without access to sceneStore's createVector/createNodeMaterial.
function createGroundSceneNodeFallback(settings?: GroundSettings): SceneNode {
  const dynamicMesh = createGroundDynamicMeshDefinition({}, settings)
  return {
    id: 'ground',
    name: 'Ground',
    nodeType: 'Mesh',
    selectedHighlight: false,
    canPrefab: false,
    allowChildNodes: false,
    materials: [],
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    locked: true,
    dynamicMesh,
    components: {
    },
  }
}

// Dependency-aware creator: deps must provide runtime helpers used by sceneStore
export function createGroundSceneNodeWithDeps(deps: GroundDeps, overrides: { dynamicMesh?: Partial<GroundDynamicMesh> } = {}, settings?: GroundSettings): SceneNode {
  const dynamicMesh = createGroundDynamicMeshDefinition(overrides.dynamicMesh ?? {}, settings)
  const createVector = deps.createVector
  const createNodeMaterial = deps.createNodeMaterial
  const createMaterialProps = deps.createMaterialProps
  const generateUuid = deps.generateUuid
  const clampRigidbodyComponentProps = deps.clampRigidbodyComponentProps
  const RIGIDBODY_COMPONENT_TYPE = deps.RIGIDBODY_COMPONENT_TYPE
  const GROUND_NODE_ID = deps.GROUND_NODE_ID ?? 'ground'

  return {
    id: GROUND_NODE_ID,
    name: 'Ground',
    nodeType: 'Mesh',
    selectedHighlight: false,
    canPrefab: false,
    allowChildNodes: false,
    materials: [
      createNodeMaterial(buildPrimaryGroundMaterialProps(createMaterialProps, null), { name: 'Ground Material' })
    ],
    position: createVector(0, 0, 0),
    rotation: createVector(0, 0, 0),
    scale: createVector(1, 1, 1),
    visible: true,
    locked: true,
    dynamicMesh,
    components: {
      [RIGIDBODY_COMPONENT_TYPE]: {
        id: generateUuid(),
        type: RIGIDBODY_COMPONENT_TYPE,
        enabled: true,
        props: clampRigidbodyComponentProps({ bodyType: 'STATIC', mass: 0 }),
      }
    },
  }
}

export function normalizeGroundSceneNodeWithDeps(deps: GroundDeps, node: SceneNode | null | undefined, settings?: GroundSettings): SceneNode {
  if (!node) {
    return createGroundSceneNodeWithDeps(deps, {}, settings)
  }
  if (node.dynamicMesh?.type === 'Ground') {
    const createVector = deps.createVector
    const getPrimaryNodeMaterial = deps.getPrimaryNodeMaterial
    const cloneNode = deps.cloneNode
    const createNodeMaterial = deps.createNodeMaterial
    const createMaterialProps = deps.createMaterialProps
    const generateUuid = deps.generateUuid
    const clampRigidbodyComponentProps = deps.clampRigidbodyComponentProps
    const GROUND_NODE_ID = deps.GROUND_NODE_ID ?? 'ground'

    const primaryMaterial = getPrimaryNodeMaterial ? getPrimaryNodeMaterial(node) : null
    const children = node.children?.length ? node.children.map(cloneNode ?? ((n) => n)) : undefined
    const nextComponents = (() => {
      const base = { ...(node.components ?? {}) }
      if (!base[deps.RIGIDBODY_COMPONENT_TYPE]) {
        base[deps.RIGIDBODY_COMPONENT_TYPE] = {
          id: generateUuid(),
          type: deps.RIGIDBODY_COMPONENT_TYPE,
          enabled: true,
          props: clampRigidbodyComponentProps({ bodyType: 'STATIC', mass: 0 }),
        }
      }
      return Object.keys(base).length ? base : undefined
    })()

    const normalizedDynamicMesh = createGroundDynamicMeshDefinition((node.dynamicMesh as GroundDynamicMesh) ?? {}, settings)
    const primaryMaterialProps = buildPrimaryGroundMaterialProps(createMaterialProps, primaryMaterial)

    return {
      ...node,
      id: GROUND_NODE_ID,
      name: 'Ground',
      nodeType: 'Mesh',
      allowChildNodes: false,
      // preserve primary material identity when possible
      materials: [
        createNodeMaterial(
          primaryMaterialProps,
          { id: primaryMaterial?.id, name: primaryMaterial?.name ?? 'Ground Material', type: primaryMaterial?.type },
        )
      ],
      position: createVector(0, 0, 0),
      rotation: createVector(0, 0, 0),
      scale: createVector(1, 1, 1),
      visible: node.visible ?? true,
      locked: true,
      dynamicMesh: normalizedDynamicMesh,
      components: nextComponents,
      sourceAssetId: undefined,
      children,
    }
  }
  return createGroundSceneNodeWithDeps(deps, {}, settings)
}

export default {
  cloneGroundGenerationSettings,
  cloneGroundDynamicMesh,
  normalizeGroundDimension,
  normalizeGroundSettings,
  cloneGroundSettings,
  createGroundDynamicMeshDefinition,
  normalizeGroundBounds,
  applyGroundRegionTransform,
  isGroundNode,
  findGroundNode,
  ensureGroundNode,
  createGroundSceneNodeWithDeps,
  normalizeGroundSceneNodeWithDeps,
}
