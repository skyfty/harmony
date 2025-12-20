import * as THREE from 'three'
import type { GroundDynamicMesh, RoadDynamicMesh, SceneNode } from '@harmony/schema'
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
import { createRoadGroup } from '@schema/roadMesh'
import { terrainScatterPresets } from '@/resources/projectProviders/asset'
import { releaseScatterInstance } from '@/utils/terrainScatterRuntime'
import { generateUuid } from '@/utils/uuid'
import { sampleUniformPointInPolygon } from '@/utils/polygonSampling'
import type { PlanningSceneData } from '@/types/planning-scene-data'

export type PlanningConversionProgress = {
  step: string
  progress: number
}

export type ConvertPlanningToSceneOptions = {
  sceneStore: {
    nodes: SceneNode[]
    groundSettings: { width: number; depth: number }
    setGroundDimensions: (payload: { width?: number; depth?: number }) => boolean
    addSceneNode: (payload: {
      nodeId?: string
      nodeType: any
      object: THREE.Object3D
      name?: string
      position?: { x: number; y: number; z: number }
      rotation?: { x: number; y: number; z: number }
      scale?: { x: number; y: number; z: number }
      parentId?: string | null
      userData?: Record<string, unknown>
    }) => SceneNode
    createWallNode: (payload: {
      segments: Array<{ start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } }>
      dimensions?: { height?: number; width?: number; thickness?: number }
      name?: string
    }) => SceneNode | null
    moveNode: (payload: { nodeId: string; targetId: string | null; position: 'before' | 'after' | 'inside' }) => boolean
    removeSceneNodes: (ids: string[]) => void
    updateNodeDynamicMesh: (nodeId: string, dynamicMesh: any) => void
    refreshRuntimeState: (options?: { showOverlay?: boolean; refreshViewport?: boolean; skipComponentSync?: boolean }) => Promise<void>
  }
  planningData: PlanningSceneData
  overwriteExisting: boolean
  onProgress?: (payload: PlanningConversionProgress) => void
}

const PLANNING_CONVERSION_ROOT_TAG = 'planningConversionRoot'
const PLANNING_CONVERSION_SOURCE = 'planning-conversion'

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
const POISSON_CANDIDATES_PER_ACTIVE = 24

type LayerKind = 'terrain' | 'building' | 'road' | 'green' | 'wall'

type PlanningPoint = { id?: string; x: number; y: number }

type PlanningPolygonAny = {
  id: string
  name?: string
  layerId: string
  points: PlanningPoint[]
  scatter?: unknown
}

type PlanningPolylineAny = {
  id: string
  name?: string
  layerId: string
  points: PlanningPoint[]
  scatter?: unknown
}

type ScatterAssignment = {
  assetId: string
  category: TerrainScatterCategory
  name?: string
  densityPercent?: number
  minSpacingMeters?: number
  footprintAreaM2?: number
}

function clampMinSpacingMeters(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return 1
  return Math.round(THREE.MathUtils.clamp(num, 0, 10) * 10) / 10
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
  // 1) Remove previously converted scene nodes (walls/roads/buildings/etc.).
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
    case 'terrain-layer':
      return 'terrain'
    case 'building-layer':
      return 'building'
    case 'road-layer':
      return 'road'
    case 'green-layer':
      return 'green'
    case 'wall-layer':
      return 'wall'
    default:
      break
  }

  // Support dynamic layer ids like "road-layer-1a2b3c4d".
  const match = /^(terrain|building|road|green|wall)-layer\b/i.exec(layerId)
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
  return ['terrain-layer', 'building-layer', 'road-layer', 'green-layer', 'wall-layer']
}

function resolveLayerKindFromPlanningData(planningData: PlanningSceneData, layerId: string): LayerKind | null {
  const raw = (planningData as any)?.layers
  if (Array.isArray(raw)) {
    const found = raw.find((item: any) => item && item.id === layerId)
    const kind = found?.kind
    if (typeof kind === 'string') {
      const normalized = kind.toLowerCase()
      if (normalized === 'terrain' || normalized === 'building' || normalized === 'road' || normalized === 'green' || normalized === 'wall') {
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

function computeRoadCenterFromWorldXZ(points: Array<{ x: number; z: number }>): { x: number; z: number } {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  points.forEach((p) => {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minZ = Math.min(minZ, p.z)
    maxZ = Math.max(maxZ, p.z)
  })
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
    return { x: 0, z: 0 }
  }
  return { x: (minX + maxX) * 0.5, z: (minZ + maxZ) * 0.5 }
}

function buildRoadDynamicMeshFromPlanningPolylines(options: {
  polylines: PlanningPolylineAny[]
  groundWidth: number
  groundDepth: number
  widthMeters: number
}): { center: { x: number; y: number; z: number }; definition: RoadDynamicMesh } | null {
  const { polylines, groundWidth, groundDepth, widthMeters } = options
  if (!Array.isArray(polylines) || polylines.length === 0) {
    return null
  }

  const vertexIndexByKey = new Map<string, number>()
  const worldVertices: Array<{ x: number; z: number }> = []
  const segments: RoadDynamicMesh['segments'] = []
  const segmentKeys = new Set<string>()

  const getVertexKey = (point: PlanningPoint) => {
    const rawId = typeof point.id === 'string' ? point.id.trim() : ''
    if (rawId) {
      return `id:${rawId}`
    }
    // Fallback for legacy snapshots: use rounded coordinates in planning space.
    return `xy:${Number(point.x).toFixed(2)},${Number(point.y).toFixed(2)}`
  }

  const ensureVertexIndex = (point: PlanningPoint) => {
    const key = getVertexKey(point)
    const existing = vertexIndexByKey.get(key)
    if (existing != null) {
      return existing
    }
    const world = toWorldPoint(point, groundWidth, groundDepth, 0)
    const index = worldVertices.length
    worldVertices.push({ x: world.x, z: world.z })
    vertexIndexByKey.set(key, index)
    return index
  }

  polylines.forEach((line) => {
    const pts = Array.isArray(line.points) ? line.points : []
    if (pts.length < 2) {
      return
    }
    for (let i = 0; i < pts.length - 1; i += 1) {
      const aPoint = pts[i]!
      const bPoint = pts[i + 1]!
      const a = ensureVertexIndex(aPoint)
      const b = ensureVertexIndex(bPoint)
      if (a === b) {
        continue
      }
      const lo = Math.min(a, b)
      const hi = Math.max(a, b)
      const key = `${lo}-${hi}`
      if (segmentKeys.has(key)) {
        continue
      }
      segmentKeys.add(key)
      segments.push({ a, b, materialId: null })
    }
  })

  if (worldVertices.length < 2 || segments.length === 0) {
    return null
  }

  const centerXZ = computeRoadCenterFromWorldXZ(worldVertices)
  const vertices: RoadDynamicMesh['vertices'] = worldVertices.map((v) => [v.x - centerXZ.x, v.z - centerXZ.z])

  const definition: RoadDynamicMesh = {
    type: 'Road',
    width: Number.isFinite(widthMeters) ? Math.min(10, Math.max(0.2, widthMeters)) : 2,
    vertices,
    segments,
  }

  return { center: { x: centerXZ.x, y: 0, z: centerXZ.z }, definition }
}

function findGroundNode(nodes: SceneNode[]): SceneNode | null {
  const visit = (list: SceneNode[]): SceneNode | null => {
    for (const node of list) {
      if (node.id === 'ground' || node.dynamicMesh?.type === 'Ground') {
        return node
      }
      if (node.children?.length) {
        const nested = visit(node.children)
        if (nested) return nested
      }
    }
    return null
  }
  return visit(nodes)
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
  const minSpacingMeters = clampMinSpacingMeters(payload.minSpacingMeters)
  const footprintAreaM2 = clampFootprintAreaM2(category, payload.footprintAreaM2)
  return { assetId, category, name, densityPercent: normalizedDensity, minSpacingMeters, footprintAreaM2 }
}

function hashSeedFromString(value: string): number {
  // FNV-1a 32bit
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
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

function pointInPolygon(point: PlanningPoint, polygon: PlanningPoint[]): boolean {
  // Ray casting
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i]!.x
    const yi = polygon[i]!.y
    const xj = polygon[j]!.x
    const yj = polygon[j]!.y

    const intersect = yi > point.y !== yj > point.y
      && point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-12) + xi
    if (intersect) inside = !inside
  }
  return inside
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

function buildRandom(seed: number) {
  // LCG
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

function samplePointInPolygon(polygon: PlanningPoint[], random: () => number): PlanningPoint | null {
  const uniform = sampleUniformPointInPolygon(polygon, random)
  if (uniform) return uniform

  // Fallback: rejection sampling within bounding box.
  // This is still uniform over the polygon area (conditional on acceptance), but can be slower for thin shapes.
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  polygon.forEach((p) => {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  })
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null
  }

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const p = { x: minX + (maxX - minX) * random(), y: minY + (maxY - minY) * random() }
    if (pointInPolygon(p, polygon)) return p
  }
  return null
}

function takeRandomSubset<T>(items: T[], count: number, random: () => number): T[] {
  if (count <= 0) return []
  if (items.length <= count) return items.slice()
  const arr = items.slice()
  // Partial Fisher–Yates shuffle.
  for (let i = 0; i < count; i += 1) {
    const j = i + Math.floor(random() * (arr.length - i))
    const tmp = arr[i]
    arr[i] = arr[j]!
    arr[j] = tmp!
  }
  arr.length = count
  return arr
}

function computeBoundingBox(points: PlanningPoint[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!Array.isArray(points) || points.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null
  return { minX, minY, maxX, maxY }
}

function poissonSampleInPolygon(
  polygon: PlanningPoint[],
  minDistance: number,
  random: () => number,
  maxPoints: number,
): PlanningPoint[] {
  if (!Array.isArray(polygon) || polygon.length < 3) return []
  if (!Number.isFinite(minDistance) || minDistance <= 0) return []
  if (!Number.isFinite(maxPoints) || maxPoints <= 0) return []

  const bbox = computeBoundingBox(polygon)
  if (!bbox) return []

  const cellSize = minDistance / Math.SQRT2
  const gridWidth = Math.max(1, Math.ceil((bbox.maxX - bbox.minX) / cellSize))
  const gridHeight = Math.max(1, Math.ceil((bbox.maxY - bbox.minY) / cellSize))
  const grid = new Int32Array(gridWidth * gridHeight)
  grid.fill(-1)

  const points: PlanningPoint[] = []
  const active: number[] = []

  const toGridX = (x: number) => Math.floor((x - bbox.minX) / cellSize)
  const toGridY = (y: number) => Math.floor((y - bbox.minY) / cellSize)
  const gridIndex = (gx: number, gy: number) => gy * gridWidth + gx

  const insertPoint = (p: PlanningPoint) => {
    points.push(p)
    const index = points.length - 1
    active.push(index)
    const gx = THREE.MathUtils.clamp(toGridX(p.x), 0, gridWidth - 1)
    const gy = THREE.MathUtils.clamp(toGridY(p.y), 0, gridHeight - 1)
    grid[gridIndex(gx, gy)] = index
  }

  const hasNeighborWithin = (p: PlanningPoint): boolean => {
    const gx = toGridX(p.x)
    const gy = toGridY(p.y)
    const radius = 2
    const minSq = minDistance * minDistance
    for (let y = Math.max(0, gy - radius); y <= Math.min(gridHeight - 1, gy + radius); y += 1) {
      for (let x = Math.max(0, gx - radius); x <= Math.min(gridWidth - 1, gx + radius); x += 1) {
        const storedIndex = grid[gridIndex(x, y)]
        if (storedIndex == null || storedIndex === -1) continue
        const other = points[storedIndex]
        if (!other) continue
        const dx = other.x - p.x
        const dy = other.y - p.y
        if (dx * dx + dy * dy < minSq) return true
      }
    }
    return false
  }

  const start = samplePointInPolygon(polygon, random)
  if (!start) return []
  insertPoint(start)

  while (active.length && points.length < maxPoints) {
    const activeIndex = Math.floor(random() * active.length)
    const baseIndex = active[activeIndex]!
    const base = points[baseIndex]!

    let found = false
    for (let attempt = 0; attempt < POISSON_CANDIDATES_PER_ACTIVE; attempt += 1) {
      const angle = random() * Math.PI * 2
      const radius = minDistance * (1 + random())
      const candidate: PlanningPoint = {
        x: base.x + Math.cos(angle) * radius,
        y: base.y + Math.sin(angle) * radius,
      }
      if (candidate.x < bbox.minX || candidate.x > bbox.maxX || candidate.y < bbox.minY || candidate.y > bbox.maxY) {
        continue
      }
      if (!pointInPolygon(candidate, polygon)) {
        continue
      }
      if (hasNeighborWithin(candidate)) {
        continue
      }
      insertPoint(candidate)
      found = true
      break
    }

    if (!found) {
      active[activeIndex] = active[active.length - 1]!
      active.pop()
    }
  }

  return points
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
    userData: {
      [PLANNING_CONVERSION_ROOT_TAG]: true,
      source: PLANNING_CONVERSION_SOURCE,
      createdAt: Date.now(),
    },
  })

  // Collect features
  const polygons = (Array.isArray((planningData as any).polygons) ? (planningData as any).polygons : []) as PlanningPolygonAny[]
  const polylines = (Array.isArray((planningData as any).polylines) ? (planningData as any).polylines : []) as PlanningPolylineAny[]

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

    if (kind === 'building') {
      for (const poly of group.polygons) {
        const segments = polygonEdges(poly.points).map((edge) => ({
          start: toWorldPoint(edge.start, groundWidth, groundDepth, 0),
          end: toWorldPoint(edge.end, groundWidth, groundDepth, 0),
        }))
        const wall = sceneStore.createWallNode({
          segments,
          dimensions: { height: 12, thickness: 0.2, width: 0.3 },
          name: poly.name?.trim() ? `${poly.name.trim()} Wall` : 'Building Wall',
        })
        if (wall) {
          sceneStore.moveNode({ nodeId: wall.id, targetId: root.id, position: 'inside' })
        }
        updateProgressForUnit(`Converting building: ${poly.name?.trim() || poly.id}`)
      }
    } else if (kind === 'road') {
      for (const line of group.polylines) {
        updateProgressForUnit(`Converting road: ${line.name?.trim() || line.id}`)
      }

      const widthMeters = resolveRoadWidthFromPlanningData(planningData, layerId)
      const build = buildRoadDynamicMeshFromPlanningPolylines({
        polylines: group.polylines,
        groundWidth,
        groundDepth,
        widthMeters,
      })

      if (build) {
        const roadObject = createRoadGroup(build.definition)
        const layerName = resolveLayerNameFromPlanningData(planningData, layerId)
        const roadNode = sceneStore.addSceneNode({
          nodeType: 'Mesh',
          object: roadObject,
          name: layerName ? `${layerName} Road` : 'Planning Road',
          position: build.center,
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          userData: {
            source: PLANNING_CONVERSION_SOURCE,
            planningLayerId: layerId,
            kind: 'road',
          },
        })
        sceneStore.moveNode({ nodeId: roadNode.id, targetId: root.id, position: 'inside' })
        sceneStore.updateNodeDynamicMesh(roadNode.id, build.definition)
      }
    } else if (kind === 'green') {
      for (const poly of group.polygons) { 
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
          const userMinSpacing = clampMinSpacingMeters(scatter.minSpacingMeters)

          // Estimate capacity from:
          // - polygon area
          // - model footprint (bounding-box base area)
          // - user minimum spacing
          const presetMinScale = Number.isFinite(preset.minScale) ? Number(preset.minScale) : 1
          const presetMaxScale = Number.isFinite(preset.maxScale) ? Number(preset.maxScale) : 1
          const minScaleForCapacity = Number.isFinite(layerParams.minScale) ? Number(layerParams.minScale) : presetMinScale
          const maxScaleForCapacity = Number.isFinite(layerParams.maxScale) ? Number(layerParams.maxScale) : presetMaxScale
          const avgScale = (minScaleForCapacity + maxScaleForCapacity) * 0.5
          const baseFootprintAreaM2 = clampFootprintAreaM2(scatter.category, scatter.footprintAreaM2)
          const effectiveFootprintAreaM2 = baseFootprintAreaM2 * avgScale * avgScale

          const area = polygonArea2D(poly.points)
          const perInstanceArea = Math.max(effectiveFootprintAreaM2, userMinSpacing * userMinSpacing)
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

          const minDistance = Math.max(userMinSpacing, Math.sqrt(effectiveFootprintAreaM2), 0.05)
          if (targetCount > 0) {
            const seedBase = layerParams.seed != null
              ? Math.floor(Number(layerParams.seed))
              : hashSeedFromString(`${PLANNING_CONVERSION_SOURCE}:${layer.id}:${poly.id}`)
            const randomPoints = buildRandom(seedBase)
            const randomProps = buildRandom(hashSeedFromString(`${seedBase}:props`))

            const candidates = poissonSampleInPolygon(
              poly.points,
              minDistance,
              randomPoints,
              Math.min(MAX_SCATTER_INSTANCES_PER_POLYGON, Math.max(1, Math.ceil(targetCount * 1.6))),
            )

            // If we generated more than we need, choose a random subset.
            // This avoids biases from consuming the Poisson sequence in generation order.
            const selected = takeRandomSubset(candidates, targetCount, randomPoints)

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
      for (const line of group.polylines) {
        const segments = [] as Array<{ start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } }>
        for (let i = 0; i < line.points.length - 1; i += 1) {
          segments.push({
            start: toWorldPoint(line.points[i]!, groundWidth, groundDepth, 0),
            end: toWorldPoint(line.points[i + 1]!, groundWidth, groundDepth, 0),
          })
        }
        if (segments.length) {
          const wall = sceneStore.createWallNode({
            segments,
            dimensions: { height: 3, thickness: 0.15, width: 0.25 },
            name: line.name?.trim() || 'Wall',
          })
          if (wall) {
            sceneStore.moveNode({ nodeId: wall.id, targetId: root.id, position: 'inside' })
          }
        }
        updateProgressForUnit(`Converting wall: ${line.name?.trim() || line.id}`)
      }

      for (const poly of group.polygons) {
        const segments = polygonEdges(poly.points).map((edge) => ({
          start: toWorldPoint(edge.start, groundWidth, groundDepth, 0),
          end: toWorldPoint(edge.end, groundWidth, groundDepth, 0),
        }))
        if (segments.length) {
          const wall = sceneStore.createWallNode({
            segments,
            dimensions: { height: 3, thickness: 0.15, width: 0.25 },
            name: poly.name?.trim() || 'Wall',
          })
          if (wall) {
            sceneStore.moveNode({ nodeId: wall.id, targetId: root.id, position: 'inside' })
          }
        }
        updateProgressForUnit(`Converting wall: ${poly.name?.trim() || poly.id}`)
      }
    } else if (kind === 'terrain') {
      for (const poly of group.polygons) {
        updateProgressForUnit(`Converting terrain: ${poly.name?.trim() || poly.id}`)
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
