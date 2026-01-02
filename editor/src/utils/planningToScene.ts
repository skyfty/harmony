import * as THREE from 'three'
import type {
  GroundDynamicMesh,
  RoadDynamicMesh,
  SceneNode,
  SceneNodeMaterial,
  SceneNodeEditorFlags,
} from '@harmony/schema'
import type {ProjectAsset} from '@/types/project-asset'
import {
  ensureTerrainScatterStore,
  getTerrainScatterStore,
  loadTerrainScatterSnapshot,
  removeTerrainScatterLayer,
  replaceTerrainScatterInstances,
  serializeTerrainScatterStore,
  upsertTerrainScatterLayer,
  type TerrainScatterCategory,
  type TerrainScatterInstance,
  type TerrainScatterStore,
} from '@harmony/schema/terrain-scatter'
import { sampleGroundHeight, sampleGroundNormal } from '@schema/groundMesh'
import { terrainScatterPresets } from '@/resources/projectProviders/asset'
import { releaseScatterInstance } from '@/utils/terrainScatterRuntime'
import { buildRandom, generateFpsScatterPointsInPolygon, hashSeedFromString } from '@/utils/scatterSampling'
import type { PlanningSceneData } from '@/types/planning-scene-data'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import {
  FLOOR_COMPONENT_TYPE,
  ROAD_COMPONENT_TYPE,
  ROAD_DEFAULT_JUNCTION_SMOOTHING,
  RIGIDBODY_COMPONENT_TYPE,
  WATER_COMPONENT_TYPE,
  WALL_COMPONENT_TYPE,
  WALL_DEFAULT_SMOOTHING,
} from '@schema/components'
import { createRoadNodeMaterials, ROAD_SURFACE_DEFAULT_COLOR } from '@/utils/roadNodeMaterials'
import { generateUuid } from '@/utils/uuid'

export type PlanningConversionProgress = {
  step: string
  progress: number
}

export type ConvertPlanningToSceneOptions = {
  sceneStore: {
    nodes: SceneNode[]
    groundSettings: { width: number; depth: number }
    captureHistorySnapshot: (options?: { resetRedo?: boolean }) => void
    withHistorySuppressed: <T>(fn: () => Promise<T> | T) => Promise<T>
    setGroundDimensions: (payload: { width?: number; depth?: number }) => boolean
    addSceneNode: (payload: {
      nodeId?: string
      nodeType: any
      object: THREE.Object3D
      name?: string
      position?: { x: number; y: number; z: number }
      rotation?: { x: number; y: number; z: number }
      scale?: { x: number; y: number; z: number }
      canPrefab?: boolean
      parentId?: string | null
      userData?: Record<string, unknown>
      editorFlags?: SceneNodeEditorFlags
    }) => SceneNode
    createWallNode: (payload: {
      segments: Array<{ start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } }>
      dimensions?: { height?: number; width?: number; thickness?: number }
      name?: string
      editorFlags?: SceneNodeEditorFlags
    }) => SceneNode | null
    createRoadNode: (payload: {
      points: Array<{ x: number; y: number; z: number }>
      width?: number
      name?: string
      editorFlags?: SceneNodeEditorFlags
    }) => SceneNode | null
    createFloorNode: (payload: {
      points: Array<{ x: number; y: number; z: number }>
      name?: string
      editorFlags?: SceneNodeEditorFlags
    }) => SceneNode | null
    addNodeComponent: (nodeId: string, type: string) => unknown
    updateNodeComponentProps: (nodeId: string, componentId: string, patch: Record<string, unknown>) => boolean
    moveNode: (payload: { nodeId: string; targetId: string | null; position: 'before' | 'after' | 'inside' }) => boolean
    removeSceneNodes: (ids: string[]) => void
    updateNodeDynamicMesh: (nodeId: string, dynamicMesh: any) => void
    setNodeLocked: (nodeId: string, locked: boolean) => void
    updateNodeUserData: (nodeId: string, userData: Record<string, unknown> | null) => void
    setNodeMaterials: (nodeId: string, materials: SceneNodeMaterial[]) => boolean
    refreshRuntimeState: (options?: { showOverlay?: boolean; refreshViewport?: boolean; }) => Promise<void>
    registerAsset: (asset: ProjectAsset) => Promise<void>
  }
  planningData: PlanningSceneData
  overwriteExisting: boolean
  onProgress?: (payload: PlanningConversionProgress) => void
}

const PLANNING_CONVERSION_ROOT_TAG = 'planningConversionRoot'
const PLANNING_CONVERSION_SOURCE = 'planning-conversion'
const PLANNING_PIXELS_PER_METER = 10

// Air walls are invisible collision boundaries.
// Use fixed dimensions (do not depend on wall-layer settings).
const AIR_WALL_HEIGHT_M = 3
const AIR_WALL_THICKNESS_M = 0.02
const AIR_WALL_WIDTH_M = 0.25

function monotonicUpdatedAt(previousSnapshot: any | null | undefined, nextUpdatedAt: unknown): number {
  const prev = Number(previousSnapshot?.metadata?.updatedAt)
  const next = Number(nextUpdatedAt)
  if (!Number.isFinite(prev)) {
    return Number.isFinite(next) ? next : Date.now()
  }
  if (!Number.isFinite(next)) {
    return prev + 1
  }
  return next <= prev ? prev + 1 : next
}

const MAX_SCATTER_INSTANCES_PER_POLYGON = 1500

type LayerKind = 'road' | 'green' | 'wall' | 'floor' | 'water' | 'building'

type PlanningPoint = { id?: string; x: number; y: number }

type PlanningPolygonAny = {
  id: string
  name?: string
  layerId: string
  points: PlanningPoint[]
  scatter?: unknown
  airWallEnabled?: unknown
}

type PlanningPolylineAny = {
  id: string
  name?: string
  layerId: string
  points: PlanningPoint[]
  scatter?: unknown
  cornerSmoothness?: unknown
  airWallEnabled?: unknown
}

type RoadGraphSegment = { a: number; b: number; featureIds: Set<string> }

function quantizedCoordKey(value: number, step: number): number {
  if (!Number.isFinite(value) || step <= 0) return 0
  return Math.round(value / step)
}

function buildRoadGraphFromPlanningLayer(options: {
  layerId: string
  polylines: PlanningPolylineAny[]
  groundWidth: number
  groundDepth: number
  roadWidth: number
}) {
  const { polylines, groundWidth, groundDepth, roadWidth } = options

  // Use a conservative weld step so points inserted via intersections align even if ids differ.
  const weldStepMeters = 1e-3
  const verticesWorld: Array<{ x: number; z: number }> = []
  const idToVertex = new Map<string, number>()
  const posToVertex = new Map<string, number>()
  const segmentMap = new Map<string, RoadGraphSegment>()

  const getVertexIndex = (point: PlanningPoint): number | null => {
    if (!point) return null
    const world = toWorldPoint(point, groundWidth, groundDepth, 0)
    const x = Number(world.x)
    const z = Number(world.z)
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null

    const id = typeof point.id === 'string' && point.id.trim() ? point.id.trim() : null
    if (id && idToVertex.has(id)) {
      return idToVertex.get(id)!
    }

    const qx = quantizedCoordKey(x, weldStepMeters)
    const qz = quantizedCoordKey(z, weldStepMeters)
    const posKey = `${qx},${qz}`

    const existing = posToVertex.get(posKey)
    if (existing != null) {
      if (id) idToVertex.set(id, existing)
      return existing
    }

    const nextIndex = verticesWorld.length
    verticesWorld.push({ x, z })
    posToVertex.set(posKey, nextIndex)
    if (id) idToVertex.set(id, nextIndex)
    return nextIndex
  }

  const addSegment = (a: number, b: number, featureId: string) => {
    if (a === b) return
    const low = Math.min(a, b)
    const high = Math.max(a, b)
    const key = `${low}-${high}`
    const existing = segmentMap.get(key)
    if (existing) {
      existing.featureIds.add(featureId)
      return
    }
    segmentMap.set(key, { a: low, b: high, featureIds: new Set([featureId]) })
  }

  for (const line of polylines) {
    const featureId = typeof line?.id === 'string' ? line.id : ''
    let prev: number | null = null
    for (const point of line.points ?? []) {
      const idx = getVertexIndex(point)
      if (idx == null) continue
      if (prev != null && prev !== idx) {
        addSegment(prev, idx, featureId)
      }
      prev = idx
    }
  }

  const segments = Array.from(segmentMap.values())
  const adjacency = new Map<number, Set<number>>()
  const ensureAdj = (v: number) => {
    const existing = adjacency.get(v)
    if (existing) return existing
    const created = new Set<number>()
    adjacency.set(v, created)
    return created
  }
  for (const seg of segments) {
    ensureAdj(seg.a).add(seg.b)
    ensureAdj(seg.b).add(seg.a)
  }

  const visited = new Array(verticesWorld.length).fill(false)
  const components: Array<{
    center: { x: number; z: number }
    dynamicMesh: RoadDynamicMesh
    featureIds: string[]
  }> = []

  for (let start = 0; start < verticesWorld.length; start += 1) {
    if (visited[start]) continue
    const neighbors = adjacency.get(start)
    if (!neighbors || neighbors.size === 0) {
      visited[start] = true
      continue
    }

    const queue: number[] = [start]
    visited[start] = true
    const componentSet = new Set<number>()
    componentSet.add(start)

    while (queue.length) {
      const v = queue.shift()!
      const adj = adjacency.get(v)
      if (!adj) continue
      for (const n of adj) {
        if (visited[n]) continue
        visited[n] = true
        componentSet.add(n)
        queue.push(n)
      }
    }

    const vertexIndices = Array.from(componentSet).sort((a, b) => a - b)
    const componentSegments = segments.filter((seg) => componentSet.has(seg.a) && componentSet.has(seg.b))
    if (vertexIndices.length < 2 || componentSegments.length === 0) {
      continue
    }

    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    let maxZ = Number.NEGATIVE_INFINITY
    for (const idx of vertexIndices) {
      const v = verticesWorld[idx]!
      minX = Math.min(minX, v.x)
      maxX = Math.max(maxX, v.x)
      minZ = Math.min(minZ, v.z)
      maxZ = Math.max(maxZ, v.z)
    }
    const centerX = Number.isFinite(minX) && Number.isFinite(maxX) ? (minX + maxX) * 0.5 : 0
    const centerZ = Number.isFinite(minZ) && Number.isFinite(maxZ) ? (minZ + maxZ) * 0.5 : 0

    const remap = new Map<number, number>()
    vertexIndices.forEach((oldIndex, nextIndex) => remap.set(oldIndex, nextIndex))

    const vertices = vertexIndices.map((oldIndex) => {
      const v = verticesWorld[oldIndex]!
      return [v.x - centerX, v.z - centerZ] as [number, number]
    })

    const meshSegments = componentSegments
      .map((seg) => ({ a: remap.get(seg.a)!, b: remap.get(seg.b)! }))
      .filter((seg) => seg.a !== seg.b)

    const featureIdSet = new Set<string>()
    componentSegments.forEach((seg) => seg.featureIds.forEach((id) => id && featureIdSet.add(id)))

    const dynamicMesh: RoadDynamicMesh = {
      type: 'Road',
      width: roadWidth,
      vertices,
      segments: meshSegments,
    }

    components.push({
      center: { x: centerX, z: centerZ },
      dynamicMesh,
      featureIds: Array.from(featureIdSet.values()),
    })
  }

  return components
}

function ensureAirWall(sceneStore: ConvertPlanningToSceneOptions['sceneStore'], node: SceneNode) {
  const component = (node.components as any)?.[WALL_COMPONENT_TYPE] as { id?: string } | undefined
  if (component?.id) {
    sceneStore.updateNodeComponentProps(node.id, component.id, { isAirWall: true })
  }
  ensureStaticRigidbody(sceneStore, node)
}

function createAirWallFromSegments(options: {
  sceneStore: ConvertPlanningToSceneOptions['sceneStore']
  rootNodeId: string
  name: string
  planningLayerId: string
  ownerFeatureId: string
  ownerFeatureKind: 'water' | 'green'
  segments: Array<{ start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } }>
}) {
  const { sceneStore, rootNodeId, name, planningLayerId, ownerFeatureId, ownerFeatureKind, segments } = options
  if (!segments.length) return null
  const wall = sceneStore.createWallNode({
    segments,
    dimensions: { height: AIR_WALL_HEIGHT_M, thickness: AIR_WALL_THICKNESS_M, width: AIR_WALL_WIDTH_M },
    name,
  })
  if (!wall) return null

  sceneStore.moveNode({ nodeId: wall.id, targetId: rootNodeId, position: 'inside' })
  sceneStore.setNodeLocked(wall.id, true)
  ensureAirWall(sceneStore, wall)
  sceneStore.updateNodeUserData(wall.id, {
    source: PLANNING_CONVERSION_SOURCE,
    planningLayerId,
    kind: 'airWall',
    ownerFeatureId,
    ownerFeatureKind,
  })
  return wall
}

function clampWallCornerSmoothness(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) {
    return WALL_DEFAULT_SMOOTHING
  }
  return Math.min(1, Math.max(0, num))
}

function ensureStaticRigidbody(sceneStore: ConvertPlanningToSceneOptions['sceneStore'], node: SceneNode) {
  const existing = (node.components as any)?.[RIGIDBODY_COMPONENT_TYPE] as { id?: string } | undefined
  if (existing?.id) {
    sceneStore.updateNodeComponentProps(node.id, existing.id, { bodyType: 'STATIC', mass: 0 })
    return
  }

  const created = sceneStore.addNodeComponent(node.id, RIGIDBODY_COMPONENT_TYPE) as { id?: string } | null
  if (created?.id) {
    sceneStore.updateNodeComponentProps(node.id, created.id, { bodyType: 'STATIC', mass: 0 })
  }
}

type ScatterAssignment = {
  assetId: string
  category: TerrainScatterCategory
  name?: string
  densityPercent?: number
  footprintAreaM2?: number
  footprintMaxSizeM?: number
}

function defaultFootprintAreaM2(category: TerrainScatterCategory): number {
  const preset = terrainScatterPresets[category]
  const spacing = Number.isFinite(preset?.spacing) ? Number(preset.spacing) : 1
  return Math.max(0.01, spacing * spacing)
}

function clampFootprintAreaM2(category: TerrainScatterCategory, value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num) || num <= 0) {
    return defaultFootprintAreaM2(category)
  }
  return Math.min(1e6, Math.max(0.0001, num))
}

function defaultFootprintMaxSizeM(category: TerrainScatterCategory): number {
  const preset = terrainScatterPresets[category]
  const spacing = Number.isFinite(preset?.spacing) ? Number(preset.spacing) : 1
  return Math.max(0.05, spacing)
}

function clampFootprintMaxSizeM(category: TerrainScatterCategory, value: unknown, fallbackAreaM2?: number): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num) || num <= 0) {
    if (Number.isFinite(fallbackAreaM2) && (fallbackAreaM2 as number) > 0) {
      return Math.max(0.05, Math.sqrt(fallbackAreaM2 as number))
    }
    return defaultFootprintMaxSizeM(category)
  }
  return Math.min(1000, Math.max(0.01, num))
}

function estimateFootprintDiagonalM(footprintAreaM2: number, footprintMaxSizeM: number): number {
  const area = Number.isFinite(footprintAreaM2) ? footprintAreaM2 : 0
  const maxSide = Number.isFinite(footprintMaxSizeM) ? footprintMaxSizeM : 0
  if (area <= 0 || maxSide <= 0) {
    return 0
  }
  const otherSide = area / maxSide
  if (!Number.isFinite(otherSide) || otherSide <= 0) {
    return 0
  }
  return Math.sqrt(maxSide * maxSide + otherSide * otherSide)
}

function emitProgress(options: ConvertPlanningToSceneOptions, step: string, progress: number) {
  options.onProgress?.({ step, progress: clampProgress(progress) })
}

function clampProgress(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value)))
}

export function findPlanningConversionRootIds(nodes: SceneNode[]): string[] {
  const ids: string[] = []
  const visit = (list: SceneNode[]) => {
    for (const node of list) {
      const userData = (node.userData ?? {}) as Record<string, unknown>
      if (userData[PLANNING_CONVERSION_ROOT_TAG] === true) {
        ids.push(node.id)
      }
      if (node.children?.length) {
        visit(node.children)
      }
    }
  }
  visit(nodes)
  return ids
}

export async function clearPlanningGeneratedContent(sceneStore: ConvertPlanningToSceneOptions['sceneStore']) {
  // 1) Remove previously converted scene nodes (walls/roads/floors/etc.).
  const existingRoots = findPlanningConversionRootIds(sceneStore.nodes)
  if (existingRoots.length) {
    sceneStore.removeSceneNodes(existingRoots)
  }

  // 2) Remove previously generated terrain scatter (managed by ground node).
  const groundNode = findGroundNode(sceneStore.nodes)
  if (groundNode?.dynamicMesh?.type === 'Ground') {
    const previousSnapshot = (groundNode.dynamicMesh as any)?.terrainScatter
    const store = ensureScatterStore(groundNode.id, (groundNode.dynamicMesh as any)?.terrainScatter)
    removePlanningScatterLayers(store)
    const snapshot = serializeTerrainScatterStore(store)
    snapshot.metadata.updatedAt = monotonicUpdatedAt(previousSnapshot, snapshot.metadata.updatedAt)
    const next = {
      ...(groundNode.dynamicMesh as any),
      terrainScatter: snapshot,
    }
    sceneStore.updateNodeDynamicMesh(groundNode.id, next)
  }

  // 3) Sync runtime so the viewport reflects the removals immediately.
  await sceneStore.refreshRuntimeState({ showOverlay: false, refreshViewport: true })
}

function layerKindFromId(layerId: string): LayerKind | null {
  switch (layerId) {
    case 'road-layer':
      return 'road'
    case 'floor-layer':
      return 'floor'
    case 'green-layer':
      return 'green'
    case 'water-layer':
      return 'water'
    case 'wall-layer':
      return 'wall'
    case 'building-layer':
      return 'building'
    default:
      break
  }

  // Support dynamic layer ids like "road-layer-1a2b3c4d".
  const match = /^(road|floor|green|water|wall|building)-layer\b/i.exec(layerId)
  if (match && match[1]) {
    return match[1].toLowerCase() as LayerKind
  }
  return null
}

function resolveLayerOrderFromPlanningData(planningData: PlanningSceneData): string[] {
  const raw = (planningData as any)?.layers
  if (Array.isArray(raw) && raw.length) {
    const ids = raw
      .map((item: any) => (item && typeof item.id === 'string' ? item.id : null))
      .filter((id: any): id is string => typeof id === 'string' && id.trim().length > 0)
    if (ids.length) {
      return ids
    }
  }
  return ['road-layer', 'floor-layer', 'building-layer', 'water-layer', 'green-layer', 'wall-layer']
}

function resolveLayerKindFromPlanningData(planningData: PlanningSceneData, layerId: string): LayerKind | null {
  const raw = (planningData as any)?.layers
  if (Array.isArray(raw)) {
    const found = raw.find((item: any) => item && item.id === layerId)
    const kind = found?.kind
    if (typeof kind === 'string') {
      const normalized = kind.toLowerCase()
      if (
        normalized === 'road'
        || normalized === 'floor'
        || normalized === 'green'
        || normalized === 'water'
        || normalized === 'wall'
        || normalized === 'building'
      ) {
        return normalized as LayerKind
      }
    }
  }
  return layerKindFromId(layerId)
}

function resolveLayerNameFromPlanningData(planningData: PlanningSceneData, layerId: string): string | null {
  const raw = (planningData as any)?.layers
  if (Array.isArray(raw)) {
    const found = raw.find((item: any) => item && item.id === layerId)
    const name = found?.name
    if (typeof name === 'string' && name.trim()) {
      return name.trim()
    }
  }
  return null
}

function resolveLayerColorFromPlanningData(planningData: PlanningSceneData, layerId: string): string | null {
  const raw = (planningData as any)?.layers
  if (Array.isArray(raw)) {
    const found = raw.find((item: any) => item && item.id === layerId)
    const color = found?.color
    if (typeof color === 'string' && color.trim()) {
      return color.trim()
    }
  }
  return null
}

function resolveRoadWidthFromPlanningData(planningData: PlanningSceneData, layerId: string): number {
  const raw = (planningData as any)?.layers
  if (Array.isArray(raw)) {
    const found = raw.find((item: any) => item && item.id === layerId)
    const widthRaw = found?.roadWidthMeters
    const width = typeof widthRaw === 'number' ? widthRaw : Number(widthRaw)
    if (Number.isFinite(width)) {
      return Math.min(10, Math.max(0.2, width))
    }
  }
  return 2
}

function resolveRoadJunctionSmoothingFromPlanningData(planningData: PlanningSceneData, layerId: string): number {
  const raw = (planningData as any)?.layers
  if (Array.isArray(raw)) {
    const found = raw.find((item: any) => item && item.id === layerId)
    const smoothingRaw = found?.roadSmoothing
    const smoothing = typeof smoothingRaw === 'number' ? smoothingRaw : Number(smoothingRaw)
    if (Number.isFinite(smoothing)) {
      return Math.min(1, Math.max(0, smoothing))
    }
  }
  return ROAD_DEFAULT_JUNCTION_SMOOTHING
}

function resolveFloorSmoothFromPlanningData(planningData: PlanningSceneData, layerId: string): number {
  const raw = (planningData as any)?.layers
  if (Array.isArray(raw)) {
    const found = raw.find((item: any) => item && item.id === layerId)
    const smoothRaw = found?.floorSmooth
    const smooth = typeof smoothRaw === 'number' ? smoothRaw : Number(smoothRaw)
    if (Number.isFinite(smooth)) {
      return Math.min(1, Math.max(0, smooth))
    }
  }
  return 0.1
}

function resolveWaterSmoothingFromPlanningData(planningData: PlanningSceneData, layerId: string): number {
  const raw = (planningData as any)?.layers
  if (Array.isArray(raw)) {
    const found = raw.find((item: any) => item && item.id === layerId)
    const smoothingRaw = found?.waterSmoothing
    const smoothing = typeof smoothingRaw === 'number' ? smoothingRaw : Number(smoothingRaw)
    if (Number.isFinite(smoothing)) {
      return Math.min(1, Math.max(0, smoothing))
    }
  }
  return 0.1
}

function resolveWallHeightFromPlanningData(planningData: PlanningSceneData, layerId: string): number {
  const raw = (planningData as any)?.layers
  if (Array.isArray(raw)) {
    const found = raw.find((item: any) => item && item.id === layerId)
    const heightRaw = found?.wallHeightMeters
    const height = typeof heightRaw === 'number' ? heightRaw : Number(heightRaw)
    if (Number.isFinite(height)) {
      return Math.min(100, Math.max(0.1, height))
    }
  }
  return 8
}

function resolveWallThicknessFromPlanningData(planningData: PlanningSceneData, layerId: string): number {
  const raw = (planningData as any)?.layers
  if (Array.isArray(raw)) {
    const found = raw.find((item: any) => item && item.id === layerId)
    const thicknessRaw = found?.wallThicknessMeters
    const thickness = typeof thicknessRaw === 'number' ? thicknessRaw : Number(thicknessRaw)
    if (Number.isFinite(thickness)) {
      return Math.min(10, Math.max(0.01, thickness))
    }
  }
  return 0.15
}

function findGroundNode(nodes: SceneNode[]): SceneNode | null {
  const visit = (list: SceneNode[]): SceneNode | null => {
    for (const node of list) {
      if (node?.dynamicMesh?.type === 'Ground') {
        return node
      }
      const child = visit(Array.isArray(node.children) ? node.children : [])
      if (child) {
        return child
      }
    }
    return null
  }

  return visit(nodes)
}

function resolvePlanningUnitsToMeters(planningData: PlanningSceneData, groundWidth: number, groundDepth: number): number {
  const referenceSize = Math.max(1, Math.abs(Number(groundWidth)), Math.abs(Number(groundDepth)))
  let maxCoordinate = 0

  const scanPoints = (points: PlanningPoint[] | undefined) => {
    if (!Array.isArray(points)) return
    for (const point of points) {
      if (!point) continue
      const x = Number(point.x)
      const y = Number(point.y)
      if (Number.isFinite(x)) {
        maxCoordinate = Math.max(maxCoordinate, Math.abs(x))
      }
      if (Number.isFinite(y)) {
        maxCoordinate = Math.max(maxCoordinate, Math.abs(y))
      }
    }
  }

  const rawPolygons = (planningData as any)?.polygons
  if (Array.isArray(rawPolygons)) {
    rawPolygons.forEach((poly) => scanPoints((poly as PlanningPolygonAny)?.points))
  }

  const rawPolylines = (planningData as any)?.polylines
  if (Array.isArray(rawPolylines)) {
    rawPolylines.forEach((line) => scanPoints((line as PlanningPolylineAny)?.points))
  }

  if (maxCoordinate <= 0 || !Number.isFinite(referenceSize) || referenceSize <= 0) {
    return 1
  }

  const ratio = maxCoordinate / referenceSize

  // When planning data is stored in canvas pixels (1m = 10px), coordinates will be
  // roughly an order of magnitude larger than the ground size in meters. Detect that
  // pattern and scale down to meters; otherwise leave data untouched.
  if (ratio >= PLANNING_PIXELS_PER_METER * 0.5) {
    return 1 / PLANNING_PIXELS_PER_METER
  }

  return 1
}

function normalizePlanningPoints(points: PlanningPoint[] | undefined, unitsToMeters: number): PlanningPoint[] {
  const scale = Number.isFinite(unitsToMeters) && unitsToMeters > 0 ? unitsToMeters : 1
  if (!Array.isArray(points) || points.length === 0) return []
  return points.map((point) => {
    const x = Number(point?.x)
    const y = Number(point?.y)
    return {
      ...point,
      x: Number.isFinite(x) ? x * scale : 0,
      y: Number.isFinite(y) ? y * scale : 0,
    }
  })
}

function toWorldPoint(
  p: PlanningPoint,
  groundWidth: number,
  groundDepth: number,
  y = 0,
): { x: number; y: number; z: number } {
  return {
    x: p.x - groundWidth * 0.5,
    y,
    z: p.y - groundDepth * 0.5,
  }
}

function polygonEdges(points: PlanningPoint[]): Array<{ start: PlanningPoint; end: PlanningPoint }> {
  if (!Array.isArray(points) || points.length < 2) return []
  const edges: Array<{ start: PlanningPoint; end: PlanningPoint }> = []
  for (let i = 0; i < points.length; i += 1) {
    const start = points[i]!
    const end = points[(i + 1) % points.length]!
    edges.push({ start, end })
  }
  return edges
}

function buildFloorWorldPointsFromPlanning(
  points: PlanningPoint[],
  groundWidth: number,
  groundDepth: number,
): Array<{ x: number; z: number }> {
  const worldPoints: Array<{ x: number; z: number }> = []
  const duplicateEpsilon = 1e-10
  points.forEach((point) => {
    if (!point) {
      return
    }
    const world = toWorldPoint(point, groundWidth, groundDepth, 0)
    const x = world.x
    const z = world.z
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return
    }
    const previous = worldPoints[worldPoints.length - 1]
    if (previous) {
      const dx = x - previous.x
      const dz = z - previous.z
      if (dx * dx + dz * dz <= duplicateEpsilon) {
        return
      }
    }
    worldPoints.push({ x, z })
  })

  if (worldPoints.length >= 3) {
    const first = worldPoints[0]!
    const last = worldPoints[worldPoints.length - 1]!
    const dx = first.x - last.x
    const dz = first.z - last.z
    if (dx * dx + dz * dz <= 1e-10) {
      worldPoints.pop()
    }
  }

  return worldPoints
}

function normalizeScatter(raw: unknown): ScatterAssignment | null {
  if (!raw || typeof raw !== 'object') return null
  const payload = raw as Record<string, unknown>
  const assetId = typeof payload.assetId === 'string' ? payload.assetId.trim() : ''
  const category = typeof payload.category === 'string' ? (payload.category as TerrainScatterCategory) : null
  if (!assetId || !category) return null
  const name = typeof payload.name === 'string' ? payload.name : undefined
  const densityRaw = payload.densityPercent
  const densityPercent = typeof densityRaw === 'number' ? densityRaw : Number(densityRaw)
  const normalizedDensity = Number.isFinite(densityPercent)
    ? THREE.MathUtils.clamp(Math.round(densityPercent), 0, 100)
    : 50
  const footprintAreaM2 = clampFootprintAreaM2(category, payload.footprintAreaM2)
  const footprintMaxSizeM = clampFootprintMaxSizeM(category, payload.footprintMaxSizeM, footprintAreaM2)
  return { assetId, category, name, densityPercent: normalizedDensity, footprintAreaM2, footprintMaxSizeM }
}

function polygonArea2D(points: PlanningPoint[]): number {
  if (points.length < 3) return 0
  let sum = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) * 0.5
}

function ensureScatterStore(groundNodeId: string, snapshot: any | null | undefined): TerrainScatterStore {
  let store = getTerrainScatterStore(groundNodeId) ?? ensureTerrainScatterStore(groundNodeId)
  if (snapshot && typeof snapshot === 'object') {
    const snapshotUpdatedAt = Number((snapshot as any)?.metadata?.updatedAt)
    const storeUpdatedAt = Number((store as any)?.metadata?.updatedAt)
    const hasSnapshotUpdatedAt = Number.isFinite(snapshotUpdatedAt)
    const hasStoreUpdatedAt = Number.isFinite(storeUpdatedAt)
    const shouldHydrate = hasSnapshotUpdatedAt
      ? (!hasStoreUpdatedAt || snapshotUpdatedAt !== storeUpdatedAt)
      : true

    if (shouldHydrate) {
      // IMPORTANT: release existing runtime bindings BEFORE rehydrating the store.
      // Otherwise we'd overwrite in-memory instances (with binding info) and leak instanced slots.
      try {
        for (const layer of Array.from(store.layers.values())) {
          for (const instance of layer.instances ?? []) {
            releaseScatterInstance(instance)
          }
        }
      } catch {
        // ignore
      }

      try {
        store = loadTerrainScatterSnapshot(groundNodeId, snapshot)
      } catch (_error) {
        // ignore invalid snapshot
        store = ensureTerrainScatterStore(groundNodeId)
      }
    }
  }
  return store
}

function removePlanningScatterLayers(store: TerrainScatterStore) {
  const layersToRemove: string[] = []
  store.layers.forEach((layer) => {
    const payload = layer.params?.payload as Record<string, unknown> | null | undefined
    if (payload?.source === PLANNING_CONVERSION_SOURCE) {
      layersToRemove.push(layer.id)
      // Release runtime bindings immediately so instancing cache count updates now.
      for (const instance of layer.instances ?? []) {
        releaseScatterInstance(instance)
      }
    }
  })
  layersToRemove.forEach((id) => removeTerrainScatterLayer(store, id))
}

function upsertPlanningScatterLayer(
  store: TerrainScatterStore,
  payload: { category: TerrainScatterCategory; assetId: string; label?: string },
) {
  const layerId = `planning:${payload.category}:${payload.assetId}`
  const preset = terrainScatterPresets[payload.category]
  return upsertTerrainScatterLayer(store, {
    id: layerId,
    label: payload.label ?? 'Planning Scatter',
    category: payload.category,
    assetId: payload.assetId,
    profileId: null,
    params: {
      alignToNormal: true,
      randomYaw: true,
      minSlope: 0,
      maxSlope: 90,
      minHeight: -10000,
      maxHeight: 10000,
      minScale: preset?.minScale ?? 0.85,
      maxScale: preset?.maxScale ?? 1.15,
      density: 1,
      seed: null,
      jitter: {
        position: 0.25,
        rotation: 1,
        scale: 0.25,
      },
      payload: {
        source: PLANNING_CONVERSION_SOURCE,
      },
    },
  })
}

export async function convertPlanningTo3DScene(options: ConvertPlanningToSceneOptions): Promise<{ rootNodeId: string }> {
  const { sceneStore, planningData } = options

  emitProgress(options, 'Preparing…', 0)


  // Ensure ground exists when missing.
  const groundWidth = Number(sceneStore.groundSettings?.width ?? 100)
  const groundDepth = Number(sceneStore.groundSettings?.depth ?? 100)

  const planningUnitsToMeters = resolvePlanningUnitsToMeters(planningData, groundWidth, groundDepth)

  if (!findGroundNode(sceneStore.nodes)) {
    emitProgress(options, 'Creating ground…', 5)
    sceneStore.setGroundDimensions({ width: groundWidth, depth: groundDepth })
  }

  const existingRoots = findPlanningConversionRootIds(sceneStore.nodes)
  if (existingRoots.length && options.overwriteExisting) {
    emitProgress(options, 'Removing existing converted content…', 10)
    sceneStore.removeSceneNodes(existingRoots)
  }

  emitProgress(options, 'Creating root group…', 15)
  const root = sceneStore.addSceneNode({
    nodeType: 'Group',
    object: new THREE.Group(),
    name: 'Planning 3D Scene',
    canPrefab: false,
    userData: {
      [PLANNING_CONVERSION_ROOT_TAG]: true,
      source: PLANNING_CONVERSION_SOURCE,
      createdAt: Date.now(),
    },
  })
  sceneStore.setNodeLocked(root.id, true)

  // Collect features
  const rawPolygons = (Array.isArray((planningData as any).polygons) ? (planningData as any).polygons : []) as PlanningPolygonAny[]
  const rawPolylines = (Array.isArray((planningData as any).polylines) ? (planningData as any).polylines : []) as PlanningPolylineAny[]

  const polygons = rawPolygons.map((poly) => ({
    ...poly,
    points: normalizePlanningPoints(poly?.points, planningUnitsToMeters),
  }))

  const polylines = rawPolylines.map((line) => ({
    ...line,
    points: normalizePlanningPoints(line?.points, planningUnitsToMeters),
  }))

  const layerOrder: string[] = resolveLayerOrderFromPlanningData(planningData)

  const featuresByLayer = new Map<string, { polygons: PlanningPolygonAny[]; polylines: PlanningPolylineAny[] }>()
  layerOrder.forEach((id) => featuresByLayer.set(id, { polygons: [], polylines: [] }))

  polygons.forEach((poly) => {
    if (featuresByLayer.has(poly.layerId)) featuresByLayer.get(poly.layerId)!.polygons.push(poly)
  })
  polylines.forEach((line) => {
    if (featuresByLayer.has(line.layerId)) featuresByLayer.get(line.layerId)!.polylines.push(line)
  })

  const totalUnits = polygons.length + polylines.length
  let doneUnits = 0

  // Terrain scatter preparation
  const groundNode = findGroundNode(sceneStore.nodes)
  const groundNodeId = groundNode?.id ?? 'ground'
  const groundDynamicMesh = groundNode?.dynamicMesh
  const groundDefinition: GroundDynamicMesh | null = groundDynamicMesh?.type === 'Ground' ? (groundDynamicMesh as GroundDynamicMesh) : null

  const groundHeightAt = (x: number, z: number) => (groundDefinition ? sampleGroundHeight(groundDefinition, x, z) : 0)
  const store = ensureScatterStore(groundNodeId, (groundDynamicMesh as any)?.terrainScatter)
  if (options.overwriteExisting) {
    removePlanningScatterLayers(store)
  }

  const updateProgressForUnit = (label: string) => {
    doneUnits += 1
    const base = 20
    const span = 75
    const fraction = totalUnits > 0 ? doneUnits / totalUnits : 1
    emitProgress(options, label, base + span * fraction)
  }

  // Convert layer-by-layer
  for (const layerId of layerOrder) {
    const kind = resolveLayerKindFromPlanningData(planningData, layerId)
    if (!kind) continue

    const group = featuresByLayer.get(layerId)!

    if (kind === 'road') {
      const roadWidth = resolveRoadWidthFromPlanningData(planningData, layerId)
      const junctionSmoothing = resolveRoadJunctionSmoothingFromPlanningData(planningData, layerId)
      const layerName = resolveLayerNameFromPlanningData(planningData, layerId)

      for (const line of group.polylines) {
        updateProgressForUnit(`Preparing roads: ${line.name?.trim() || line.id}`)
      }

      const components = buildRoadGraphFromPlanningLayer({
        layerId,
        polylines: group.polylines,
        groundWidth,
        groundDepth,
        roadWidth,
      })

      const baseName = layerName ? `${layerName} Road` : 'Planning Road'
      const roadMaterials = createRoadNodeMaterials(ROAD_SURFACE_DEFAULT_COLOR, layerName)

      for (let index = 0; index < components.length; index += 1) {
        const component = components[index]!
        const nodeName = components.length > 1 ? `${baseName} ${index + 1}` : baseName

        // Create a placeholder road node whose computed center matches the component center.
        // We'll overwrite its dynamic mesh with a branching road graph afterwards.
        const cx = component.center.x
        const cz = component.center.z
        const placeholder = [
          { x: cx - 0.5, y: 0, z: cz },
          { x: cx + 0.5, y: 0, z: cz },
        ]

        const roadNode = sceneStore.createRoadNode({
          points: placeholder,
          width: roadWidth,
          name: nodeName,
        })

        if (!roadNode) {
          continue
        }

        sceneStore.updateNodeDynamicMesh(roadNode.id, component.dynamicMesh)
        sceneStore.moveNode({ nodeId: roadNode.id, targetId: root.id, position: 'inside' })

        if (roadMaterials.length) {
          sceneStore.setNodeMaterials(roadNode.id, roadMaterials)
        }

        const featureIds = component.featureIds
        const userData: Record<string, unknown> = {
          source: PLANNING_CONVERSION_SOURCE,
          planningLayerId: layerId,
          kind: 'road',
          planningFeatureIds: featureIds,
        }
        if (featureIds.length === 1) {
          userData.planningFeatureId = featureIds[0]
        }
        sceneStore.updateNodeUserData(roadNode.id, userData)

        // Default: roads participate in physics collision.
        ensureStaticRigidbody(sceneStore, roadNode)

        const roadComponent = roadNode.components?.[ROAD_COMPONENT_TYPE] as { id?: string } | undefined
        if (roadComponent?.id) {
          sceneStore.updateNodeComponentProps(roadNode.id, roadComponent.id, { junctionSmoothing })
        }

        sceneStore.setNodeLocked(roadNode.id, true)
      }
    } else if (kind === 'floor') {
      const floorSmooth = resolveFloorSmoothFromPlanningData(planningData, layerId)
      const layerName = resolveLayerNameFromPlanningData(planningData, layerId)
      for (const poly of group.polygons) {
        updateProgressForUnit(`Converting floor: ${poly.name?.trim() || poly.id}`)
        const worldXZ = buildFloorWorldPointsFromPlanning(poly.points, groundWidth, groundDepth)
        if (worldXZ.length < 3) {
          continue
        }

        const worldPoints = worldXZ.map((pt) => ({ x: pt.x, y: 0, z: pt.z }))
        const nodeName = poly.name?.trim()
          ? poly.name.trim()
          : (layerName ? `${layerName} Floor` : 'Planning Floor')

        const floorNode = sceneStore.createFloorNode({
          points: worldPoints,
          name: nodeName,
        })

        if (!floorNode) {
          continue
        }

        sceneStore.moveNode({ nodeId: floorNode.id, targetId: root.id, position: 'inside' })

        const floorComponent = floorNode.components?.[FLOOR_COMPONENT_TYPE] as { id: string } | undefined
        if (floorComponent?.id) {
          sceneStore.updateNodeComponentProps(floorNode.id, floorComponent.id, { smooth: floorSmooth })
        }

        sceneStore.updateNodeUserData(floorNode.id, {
          source: PLANNING_CONVERSION_SOURCE,
          planningLayerId: layerId,
          kind: 'floor',
        })
        sceneStore.setNodeLocked(floorNode.id, true)
      }
    } else if (kind === 'building') {
      const layerName = resolveLayerNameFromPlanningData(planningData, layerId)
      for (const poly of group.polygons) {
        updateProgressForUnit(`Converting building: ${poly.name?.trim() || poly.id}`)
        const worldXZ = buildFloorWorldPointsFromPlanning(poly.points, groundWidth, groundDepth)
        if (worldXZ.length < 3) {
          continue
        }

        const worldPoints = worldXZ.map((pt) => ({ x: pt.x, y: 0, z: pt.z }))
        const nodeName = poly.name?.trim()
          ? poly.name.trim()
          : (layerName ? `${layerName} Building` : 'Planning Building')

        const floorNode = sceneStore.createFloorNode({
          points: worldPoints,
          name: nodeName,
          editorFlags: {editorOnly: true},
        })

        if (!floorNode) {
          continue
        }

        sceneStore.moveNode({ nodeId: floorNode.id, targetId: root.id, position: 'inside' })

        // 设置building图层为wireframe模式，方便查看边界
        sceneStore.setNodeMaterials(floorNode.id, [
          {
            id: generateUuid(),
            materialId: null,
            type: 'MeshStandardMaterial',
            name: 'Building Wireframe',
            color: '#cccccc',
            transparent: false,
            opacity: 1,
            side: 'front',
            wireframe: true,
            metalness: 0.2,
            roughness: 0.7,
            emissive: '#000000',
            emissiveIntensity: 0,
            aoStrength: 1,
            envMapIntensity: 1,
            textures: {
              albedo: null,
              normal: null,
              metalness: null,
              roughness: null,
              ao: null,
              emissive: null,
              displacement: null,
            },
          },
        ])

        // setting the node's userData and then attempting a conservative editor flag
        // mutation to keep the node out of runtime exports.
        sceneStore.updateNodeUserData(floorNode.id, {
          source: PLANNING_CONVERSION_SOURCE,
          planningLayerId: layerId,
          planningFeatureId: poly.id,
          kind: 'building',
        })
        sceneStore.setNodeLocked(floorNode.id, true)
      }
    } else if (kind === 'water') {
      const waterSmooth = resolveWaterSmoothingFromPlanningData(planningData, layerId)
      const layerName = resolveLayerNameFromPlanningData(planningData, layerId)
      for (const poly of group.polygons) {
        updateProgressForUnit(`Converting water: ${poly.name?.trim() || poly.id}`)
        const worldXZ = buildFloorWorldPointsFromPlanning(poly.points, groundWidth, groundDepth)
        if (worldXZ.length < 3) {
          continue
        }

        const worldPoints = worldXZ.map((pt) => ({ x: pt.x, y: 0, z: pt.z }))
        const nodeName = poly.name?.trim()
          ? poly.name.trim()
          : (layerName ? `${layerName} Water` : 'Planning Water')

        const waterNode = sceneStore.createFloorNode({
          points: worldPoints,
          name: nodeName,
        })

        // 设置默认水面材质贴图（albedo 和 normal）
        if (waterNode) {
          // 默认贴图资产ID
          const defaultTextureId = '694be79d9a9cceb7dd16834d'

          const projectAsset: ProjectAsset = {
            id: defaultTextureId,
            name: 'Default Water Texture',
            type: 'texture',
            downloadUrl:'https://v.touchmagic.cn/uploads/FhhKc4p770XqX71U.jpg',
            previewColor: '#ffffff',
            thumbnail: 'https://v.touchmagic.cn/uploads/thumb-xjq8ZTRJEQo8_7e0.jpg',
            description: "waternormals.jpg",
            gleaned: true,
          }
          await sceneStore.registerAsset(projectAsset)
  
          // 构造SceneNodeMaterial类型材质，补全必需字段
          sceneStore.setNodeMaterials(waterNode.id, [
            {
              id: generateUuid(),
              materialId: null,
              type: 'MeshStandardMaterial',
              name: 'Water Material',
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
              textures: {
                albedo: { assetId: defaultTextureId },
                normal: { assetId: defaultTextureId },
                metalness: null,
                roughness: null,
                ao: null,
                emissive: null,
                displacement: null,
              },
            },
          ])
        }

        if (!waterNode) {
          continue
        }

        sceneStore.moveNode({ nodeId: waterNode.id, targetId: root.id, position: 'inside' })

        const floorComponent = waterNode.components?.[FLOOR_COMPONENT_TYPE] as { id: string } | undefined
        if (floorComponent?.id) {
          sceneStore.updateNodeComponentProps(waterNode.id, floorComponent.id, { smooth: waterSmooth })
        }

        sceneStore.addNodeComponent(waterNode.id, WATER_COMPONENT_TYPE)

        // Build userData including any preset info persisted on the planning polygon
        const userData: Record<string, unknown> = {
          source: PLANNING_CONVERSION_SOURCE,
          planningLayerId: layerId,
          kind: 'water',
        }

        sceneStore.updateNodeUserData(waterNode.id, userData)
        sceneStore.setNodeLocked(waterNode.id, true)
        
        // If preset params provided, apply them to the water component props so runtime matches
        const waterComponent = waterNode.components?.[WATER_COMPONENT_TYPE] as { id: string } | undefined
        if (waterComponent?.id) {
            const presetId = (poly as any).waterPresetId
            sceneStore.updateNodeComponentProps(waterNode.id, waterComponent.id, presetId ? { presetId } : {})
        }

        if (Boolean((poly as any).airWallEnabled)) {
          const segments = polygonEdges(poly.points).map((edge) => {
            const start = toWorldPoint(edge.start, groundWidth, groundDepth, 0)
            const end = toWorldPoint(edge.end, groundWidth, groundDepth, 0)
            start.y = groundHeightAt(start.x, start.z)
            end.y = groundHeightAt(end.x, end.z)
            return { start, end }
          })
          createAirWallFromSegments({
            sceneStore,
            rootNodeId: root.id,
            name: `${nodeName} (Air Wall)`,
            planningLayerId: layerId,
            ownerFeatureId: poly.id,
            ownerFeatureKind: 'water',
            segments,
          })
        }
      }
    } else if (kind === 'green') {
      const layerName = resolveLayerNameFromPlanningData(planningData, layerId)
      for (const poly of group.polygons) { 
        if (Boolean((poly as any).airWallEnabled)) {
          const baseName = poly.name?.trim()
            ? poly.name.trim()
            : (layerName ? `${layerName} Green` : 'Planning Green')
          const segments = polygonEdges(poly.points).map((edge) => {
            const start = toWorldPoint(edge.start, groundWidth, groundDepth, 0)
            const end = toWorldPoint(edge.end, groundWidth, groundDepth, 0)
            start.y = groundHeightAt(start.x, start.z)
            end.y = groundHeightAt(end.x, end.z)
            return { start, end }
          })
          createAirWallFromSegments({
            sceneStore,
            rootNodeId: root.id,
            name: `${baseName} (Air Wall)`,
            planningLayerId: layerId,
            ownerFeatureId: poly.id,
            ownerFeatureKind: 'green',
            segments,
          })
        }

        const scatter = normalizeScatter(poly.scatter)
        if (scatter) {
          const preset = terrainScatterPresets[scatter.category] ?? {
            label: 'Scatter',
            icon: 'mdi-cube-outline',
            spacing: 1.2,
            minScale: 0.9,
            maxScale: 1.1,
          }
          const layer = upsertPlanningScatterLayer(store, {
            category: scatter.category,
            assetId: scatter.assetId,
            label: scatter.name ?? 'Planning Scatter',
          })

          const layerParams = layer.params as {
            alignToNormal?: boolean
            randomYaw?: boolean
            minSlope?: number
            maxSlope?: number
            minHeight?: number
            maxHeight?: number
            minScale?: number
            maxScale?: number
            seed?: number | null
          }

          const densityPercent = Number.isFinite(scatter.densityPercent) ? Number(scatter.densityPercent) : 50

          // Estimate capacity from:
          // - polygon area
          // - model footprint (bounding-box base area)
          const presetMinScale = Number.isFinite(preset.minScale) ? Number(preset.minScale) : 1
          const presetMaxScale = Number.isFinite(preset.maxScale) ? Number(preset.maxScale) : 1
          const minScaleForCapacity = Number.isFinite(layerParams.minScale) ? Number(layerParams.minScale) : presetMinScale
          const maxScaleForCapacity = Number.isFinite(layerParams.maxScale) ? Number(layerParams.maxScale) : presetMaxScale
          const baseFootprintAreaM2 = clampFootprintAreaM2(scatter.category, scatter.footprintAreaM2)
          const baseFootprintMaxSizeM = clampFootprintMaxSizeM(scatter.category, scatter.footprintMaxSizeM, baseFootprintAreaM2)
          const baseDiagonal = estimateFootprintDiagonalM(baseFootprintAreaM2, baseFootprintMaxSizeM)
          const effectiveFootprintAreaM2 = baseFootprintAreaM2 * maxScaleForCapacity * maxScaleForCapacity
          const effectiveDiagonalM = Math.max(0.01, baseDiagonal * maxScaleForCapacity)
          // Treat the (scaled) max side length as an approximate "diameter" for overlap avoidance.
          const effectiveModelDiameterM = Math.max(0.01, baseFootprintMaxSizeM * maxScaleForCapacity)

          const area = polygonArea2D(poly.points)
          const perInstanceArea = Math.max(effectiveFootprintAreaM2, effectiveDiagonalM * effectiveDiagonalM, 1e-6)
          const maxByArea = (Number.isFinite(area) && area > 0 && perInstanceArea > 1e-6)
            ? Math.floor(area / perInstanceArea)
            : 0
          const targetCount = Math.min(
            MAX_SCATTER_INSTANCES_PER_POLYGON,
            Math.max(0, Math.round((maxByArea * THREE.MathUtils.clamp(densityPercent, 0, 100)) / 100)),
          )

          if (targetCount <= 0) {
            // Still remove previously generated instances for this feature to stay idempotent.
            const existingRaw = Array.isArray(layer.instances) ? (layer.instances as TerrainScatterInstance[]) : []
            const removed = existingRaw.filter((instance) => {
              const meta = instance.metadata as Record<string, unknown> | null | undefined
              if (!meta) return false
              return meta.source === PLANNING_CONVERSION_SOURCE && meta.featureId === poly.id
            })
            removed.forEach((instance) => releaseScatterInstance(instance))
            const existing = existingRaw.filter((instance) => {
              const meta = instance.metadata as Record<string, unknown> | null | undefined
              if (!meta) return true
              return !(meta.source === PLANNING_CONVERSION_SOURCE && meta.featureId === poly.id)
            })
            replaceTerrainScatterInstances(store, layer.id, existing)
            updateProgressForUnit(`Converting greenery: ${poly.name?.trim() || poly.id}`)
            continue
          }
          if (targetCount > 0) {
            const spacingFromCount = (Number.isFinite(area) && area > 0)
              ? Math.sqrt(area / targetCount)
              : 0
            const densityNormalized = THREE.MathUtils.clamp(densityPercent, 0.0001, 100)
            const spacingFromDensity = 100 / densityNormalized
            const minDistance = Math.max(spacingFromCount, effectiveDiagonalM, spacingFromDensity + effectiveModelDiameterM, 0.05)

            const seedBase = layerParams.seed != null
              ? Math.floor(Number(layerParams.seed))
              : hashSeedFromString(`${PLANNING_CONVERSION_SOURCE}:${layer.id}:${poly.id}`)
            const randomPoints = buildRandom(seedBase)
            const randomProps = buildRandom(hashSeedFromString(`${seedBase}:props`))

            const maxCandidates = Math.min(8000, Math.max(600, Math.ceil(targetCount * 6)))
            const selected = generateFpsScatterPointsInPolygon({
              polygon: poly.points,
              targetCount,
              minDistance,
              random: randomPoints,
              maxCandidates,
            })

            const minScale = minScaleForCapacity
            const maxScale = maxScaleForCapacity
            const minHeight = Number.isFinite(layerParams.minHeight) ? Number(layerParams.minHeight) : -10000
            const maxHeight = Number.isFinite(layerParams.maxHeight) ? Number(layerParams.maxHeight) : 10000
            const minSlope = Number.isFinite(layerParams.minSlope) ? Number(layerParams.minSlope) : 0
            const maxSlope = Number.isFinite(layerParams.maxSlope) ? Number(layerParams.maxSlope) : 90
            const randomYawEnabled = layerParams.randomYaw !== false

            const existingRaw = Array.isArray(layer.instances) ? (layer.instances as TerrainScatterInstance[]) : []
            // Keep conversion idempotent per feature even when overwriteExisting=false.
            const removed = existingRaw.filter((instance) => {
              const meta = instance.metadata as Record<string, unknown> | null | undefined
              if (!meta) return false
              return meta.source === PLANNING_CONVERSION_SOURCE && meta.featureId === poly.id
            })
            removed.forEach((instance) => releaseScatterInstance(instance))
            const existing = existingRaw.filter((instance) => {
              const meta = instance.metadata as Record<string, unknown> | null | undefined
              if (!meta) return true
              return !(meta.source === PLANNING_CONVERSION_SOURCE && meta.featureId === poly.id)
            })

            const additions: TerrainScatterInstance[] = []
            for (const sample of selected) {
              const localXZ = toWorldPoint(sample, groundWidth, groundDepth, 0)
              const height = groundDefinition ? sampleGroundHeight(groundDefinition, localXZ.x, localXZ.z) : 0
              if (height < minHeight || height > maxHeight) {
                continue
              }
              const normal = groundDefinition ? sampleGroundNormal(groundDefinition, localXZ.x, localXZ.z) : null
              const slopeDeg = normal ? (Math.acos(THREE.MathUtils.clamp(normal.y, -1, 1)) * (180 / Math.PI)) : 0
              if (slopeDeg < minSlope || slopeDeg > maxSlope) {
                continue
              }

              const yaw = randomYawEnabled ? (randomProps() * Math.PI * 2) : 0
              const scaleFactor = THREE.MathUtils.lerp(minScale, maxScale, randomProps())
              additions.push({
                id: generateUuid(),
                assetId: scatter.assetId,
                layerId: layer.id,
                profileId: layer.profileId ?? scatter.assetId,
                seed: Math.floor(randomProps() * Number.MAX_SAFE_INTEGER),
                localPosition: { x: localXZ.x, y: height, z: localXZ.z },
                localRotation: { x: 0, y: yaw, z: 0 },
                localScale: { x: scaleFactor, y: scaleFactor, z: scaleFactor },
                groundCoords: {
                  x: localXZ.x,
                  z: localXZ.z,
                  height,
                  normal: normal ? { x: normal.x, y: normal.y, z: normal.z } : null,
                },
                binding: null,
                metadata: {
                  source: PLANNING_CONVERSION_SOURCE,
                  featureId: poly.id,
                },
              })
            }

            replaceTerrainScatterInstances(store, layer.id, [...existing, ...additions])
          }
        }

        updateProgressForUnit(`Converting greenery: ${poly.name?.trim() || poly.id}`)
      }
    } else if (kind === 'wall') {
      const wallHeight = resolveWallHeightFromPlanningData(planningData, layerId)
      const wallThickness = resolveWallThicknessFromPlanningData(planningData, layerId)
      for (const line of group.polylines) {
        const segments = [] as Array<{ start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } }>
        for (let i = 0; i < line.points.length - 1; i += 1) {
          const start = toWorldPoint(line.points[i]!, groundWidth, groundDepth, 0)
          const end = toWorldPoint(line.points[i + 1]!, groundWidth, groundDepth, 0)
          start.y = groundHeightAt(start.x, start.z)
          end.y = groundHeightAt(end.x, end.z)
          segments.push({ start, end })
        }
        if (segments.length) {
          const smoothing = clampWallCornerSmoothness((line as PlanningPolylineAny).cornerSmoothness)
          const wall = sceneStore.createWallNode({
            segments,
            dimensions: { height: wallHeight, thickness: wallThickness, width: 0.25 },
            name: line.name?.trim() || 'Wall',
          })
          if (wall) {
            sceneStore.moveNode({ nodeId: wall.id, targetId: root.id, position: 'inside' })
            sceneStore.setNodeLocked(wall.id, true)
            ensureStaticRigidbody(sceneStore, wall)

            const component = (wall.components as any)?.[WALL_COMPONENT_TYPE] as { id?: string } | undefined
            if (component?.id) {
              sceneStore.updateNodeComponentProps(wall.id, component.id, {
                smoothing,
                isAirWall: Boolean((line as any).airWallEnabled) || undefined,
              })
            }
          }
        }
        updateProgressForUnit(`Converting wall: ${line.name?.trim() || line.id}`)
      }

      for (const poly of group.polygons) {
        const segments = polygonEdges(poly.points).map((edge) => {
          const start = toWorldPoint(edge.start, groundWidth, groundDepth, 0)
          const end = toWorldPoint(edge.end, groundWidth, groundDepth, 0)
          start.y = groundHeightAt(start.x, start.z)
          end.y = groundHeightAt(end.x, end.z)
          return { start, end }
        })
        if (segments.length) {
          const wall = sceneStore.createWallNode({
            segments,
            dimensions: { height: wallHeight, thickness: wallThickness, width: 0.25 },
            name: poly.name?.trim() || 'Wall',
          })
          if (wall) {
            sceneStore.moveNode({ nodeId: wall.id, targetId: root.id, position: 'inside' })
            sceneStore.setNodeLocked(wall.id, true)
            ensureStaticRigidbody(sceneStore, wall)

            if (Boolean((poly as any).airWallEnabled)) {
              ensureAirWall(sceneStore, wall)
            }
          }
        }
        updateProgressForUnit(`Converting wall: ${poly.name?.trim() || poly.id}`)
      }
    }
  }

  // Persist terrain scatter into ground mesh.
  const finalGround = findGroundNode(sceneStore.nodes)
  if (finalGround?.dynamicMesh?.type === 'Ground') {
    emitProgress(options, 'Applying scatter…', 96)
    const previousSnapshot = (finalGround.dynamicMesh as any)?.terrainScatter
    const snapshot = serializeTerrainScatterStore(store)
    snapshot.metadata.updatedAt = monotonicUpdatedAt(previousSnapshot, snapshot.metadata.updatedAt)
    const next = {
      ...(finalGround.dynamicMesh as any),
      terrainScatter: snapshot,
    }
    sceneStore.updateNodeDynamicMesh(finalGround.id, next)
  }

  // Ensure runtime objects/components are synced so the converted content shows up immediately.
  // Conversion creates/moves many nodes; some runtime consumers require an explicit refresh.
  emitProgress(options, 'Refreshing scene…', 98)

  await sceneStore.refreshRuntimeState({ showOverlay: false, refreshViewport: true })

  emitProgress(options, 'Done', 100)
  return { rootNodeId: root.id }
}
