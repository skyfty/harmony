// Ground-related helper utilities extracted from sceneStore.
// These functions use `import type` to reference shared types only at compile time
// to avoid runtime circular dependencies.

import type { GroundDynamicMesh, GroundGenerationSettings, GroundSettings, SceneNode } from '@harmony/schema'
import type { SceneMaterialProps, SceneNodeMaterial, SceneMaterialType } from '@/types/material'
import type { Vector3 } from 'three'

const DEFAULT_GROUND_CELL_SIZE = 1
const DEFAULT_GROUND_EXTENT = 100
const MIN_GROUND_EXTENT = 1
const MAX_GROUND_EXTENT = 20000
const HEIGHT_EPSILON = 1e-5

export type GroundRegionBounds = {
  minRow: number
  maxRow: number
  minColumn: number
  maxColumn: number
}

export type GroundDeps = {
  createVector: (x: number, y: number, z: number) => Vector3
  createNodeMaterial: (materialId: string | null, props: SceneMaterialProps, options?: { id?: string; name?: string; type?: SceneMaterialType }) => SceneNodeMaterial
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

type GroundDynamicMeshLike = GroundDynamicMesh & { hasManualEdits?: boolean; terrainScatter?: unknown; terrainPaint?: unknown }
type GroundDynamicMeshResult = GroundDynamicMesh & { hasManualEdits?: boolean; terrainScatter?: unknown; terrainPaint?: unknown }

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
  const terrainScatter = manualDeepCloneLocal(definition.terrainScatter) as unknown as GroundDynamicMesh['terrainScatter']
  const terrainPaint = manualDeepCloneLocal(definition.terrainPaint) as unknown as GroundDynamicMesh['terrainPaint']
  const result: GroundDynamicMeshResult = {
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

export function normalizeGroundDimension(value: unknown, fallback: number): number {
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

export function normalizeGroundSettings(settings: Partial<GroundSettings> | null | undefined): GroundSettings {
  return {
    width: normalizeGroundDimension(settings?.width as unknown, DEFAULT_GROUND_EXTENT),
    depth: normalizeGroundDimension(settings?.depth as unknown, DEFAULT_GROUND_EXTENT),
    enableAirWall: settings?.enableAirWall !== false,
  }
}

export function cloneGroundSettings(settings: Partial<GroundSettings> | null | undefined): GroundSettings {
  return normalizeGroundSettings(settings ?? null)
}

export function createGroundDynamicMeshDefinition(overrides: Partial<GroundDynamicMesh> = {}, settings?: GroundSettings): GroundDynamicMesh {
  const baseSettings = normalizeGroundSettings(settings ?? null)
  const o = overrides as Partial<GroundDynamicMeshLike>
  const cellSize = overrides.cellSize ?? DEFAULT_GROUND_CELL_SIZE
  const normalizedWidth = overrides.width !== undefined
    ? normalizeGroundDimension(overrides.width as unknown, baseSettings.width)
    : baseSettings.width
  const normalizedDepth = overrides.depth !== undefined
    ? normalizeGroundDimension(overrides.depth as unknown, baseSettings.depth)
    : baseSettings.depth
  const derivedColumns = overrides.columns ?? Math.max(1, Math.round(normalizedWidth / Math.max(cellSize, 1e-6)))
  const derivedRows = overrides.rows ?? Math.max(1, Math.round(normalizedDepth / Math.max(cellSize, 1e-6)))
  const width = overrides.width !== undefined ? normalizedWidth : derivedColumns * cellSize
  const depth = overrides.depth !== undefined ? normalizedDepth : derivedRows * cellSize
  const heightMapOverrides = overrides.heightMap ?? null
  const hasHeightOverrides = Boolean(heightMapOverrides && Object.keys(heightMapOverrides).length > 0)
  const initialGeneration = cloneGroundGenerationSettings(overrides.generation) ?? null
  const definition: GroundDynamicMesh = {
    type: 'Ground',
    width,
    depth,
    rows: derivedRows,
    columns: derivedColumns,
    cellSize,
    heightMap: { ...(heightMapOverrides ?? {}) },
    terrainScatterInstancesUpdatedAt: Date.now(),
    textureDataUrl: overrides.textureDataUrl ?? null,
    textureName: overrides.textureName ?? null,
    generation: initialGeneration,
    // GroundDynamicMesh may or may not include these optional editor-only fields
    hasManualEdits: o.hasManualEdits,
    terrainScatter: manualDeepCloneLocal(o.terrainScatter) as unknown as GroundDynamicMesh['terrainScatter'],
    terrainPaint: manualDeepCloneLocal(o.terrainPaint) as unknown as GroundDynamicMesh['terrainPaint'],
  }

  if (initialGeneration && !hasHeightOverrides) {
    // applyGroundGeneration is editor-specific; caller can apply if needed.
  }

  return definition
}

export function groundVertexKey(row: number, column: number): string {
  return `${row}:${column}`
}
// add explicit typing for groundVertexKey
export function _groundVertexKeyTyped(row: number, column: number): string {
  return `${row}:${column}`
}

export function normalizeGroundBounds(definition: GroundDynamicMesh, bounds: GroundRegionBounds): GroundRegionBounds {
  const minRow = Math.max(0, Math.min(definition.rows, Math.min(bounds.minRow, bounds.maxRow)))
  const maxRow = Math.max(0, Math.min(definition.rows, Math.max(bounds.minRow, bounds.maxRow)))
  const minColumn = Math.max(0, Math.min(definition.columns, Math.min(bounds.minColumn, bounds.maxColumn)))
  const maxColumn = Math.max(0, Math.min(definition.columns, Math.max(bounds.minColumn, bounds.maxColumn)))
  return { minRow, maxRow, minColumn, maxColumn }
}

export function applyGroundRegionTransform(
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
    components: {},
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
    components: {
      [RIGIDBODY_COMPONENT_TYPE]: {
        id: generateUuid(),
        type: RIGIDBODY_COMPONENT_TYPE,
        enabled: true,
        props: clampRigidbodyComponentProps({ bodyType: 'STATIC', mass: 0 }),
      },
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

    return {
      ...node,
      id: GROUND_NODE_ID,
      name: 'Ground',
      nodeType: 'Mesh',
      allowChildNodes: false,
      // preserve primary material identity when possible
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
      dynamicMesh: createGroundDynamicMeshDefinition((node.dynamicMesh as GroundDynamicMesh) ?? {}, settings),
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
  groundVertexKey,
  normalizeGroundBounds,
  applyGroundRegionTransform,
  isGroundNode,
  findGroundNode,
  ensureGroundNode,
  createGroundSceneNodeWithDeps,
  normalizeGroundSceneNodeWithDeps,
}
