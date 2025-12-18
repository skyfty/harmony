import * as THREE from 'three'
import type { SceneNode } from '@harmony/schema'
import {
  ensureTerrainScatterStore,
  loadTerrainScatterSnapshot,
  removeTerrainScatterLayer,
  replaceTerrainScatterInstances,
  serializeTerrainScatterStore,
  upsertTerrainScatterLayer,
  type TerrainScatterCategory,
  type TerrainScatterInstance,
  type TerrainScatterStore,
} from '@harmony/schema/terrain-scatter'
import { generateUuid } from '@/utils/uuid'
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
    createSurfaceNode: (payload: { points: Array<{ x: number; y: number; z: number }>; name?: string }) => SceneNode | null
    moveNode: (payload: { nodeId: string; targetId: string | null; position: 'before' | 'after' | 'inside' }) => boolean
    removeSceneNodes: (ids: string[]) => void
    updateNodeDynamicMesh: (nodeId: string, dynamicMesh: any) => void
  }
  planningData: PlanningSceneData
  overwriteExisting: boolean
  onProgress?: (payload: PlanningConversionProgress) => void
}

const PLANNING_CONVERSION_ROOT_TAG = 'planningConversionRoot'
const PLANNING_CONVERSION_SOURCE = 'planning-conversion'

type LayerKind = 'terrain' | 'building' | 'road' | 'green' | 'wall'

type PlanningPoint = { x: number; y: number }

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
      return null
  }
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
  return { assetId, category, name }
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

function polylineToStripPolygon(points: PlanningPoint[], width: number): PlanningPoint[] | null {
  if (points.length < 2) return null
  const half = Math.max(0.01, width * 0.5)

  const left: PlanningPoint[] = []
  const right: PlanningPoint[] = []

  const n = points.length
  const getDir = (a: PlanningPoint, b: PlanningPoint) => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1e-12
    return { x: dx / len, y: dy / len }
  }
  const getNormal = (dir: { x: number; y: number }) => ({ x: -dir.y, y: dir.x })

  for (let i = 0; i < n; i += 1) {
    const p = points[i]!
    const dirPrev = i > 0 ? getDir(points[i - 1]!, p) : null
    const dirNext = i < n - 1 ? getDir(p, points[i + 1]!) : null

    const normalPrev = dirPrev ? getNormal(dirPrev) : null
    const normalNext = dirNext ? getNormal(dirNext) : null

    let nx: number
    let ny: number

    if (normalPrev && normalNext) {
      nx = normalPrev.x + normalNext.x
      ny = normalPrev.y + normalNext.y
      const len = Math.hypot(nx, ny) || 1e-12
      nx /= len
      ny /= len
    } else if (normalPrev) {
      nx = normalPrev.x
      ny = normalPrev.y
    } else if (normalNext) {
      nx = normalNext.x
      ny = normalNext.y
    } else {
      nx = 0
      ny = 1
    }

    left.push({ x: p.x + nx * half, y: p.y + ny * half })
    right.push({ x: p.x - nx * half, y: p.y - ny * half })
  }

  return [...left, ...right.reverse()]
}

function ensureScatterStore(groundNodeId: string, snapshot: any | null | undefined): TerrainScatterStore {
  const store = ensureTerrainScatterStore(groundNodeId)
  if (snapshot && typeof snapshot === 'object') {
    try {
      loadTerrainScatterSnapshot(groundNodeId, snapshot)
    } catch (_error) {
      // ignore invalid snapshot
    }
  }
  return store
}

function removePlanningScatterLayers(store: TerrainScatterStore) {
  const idsToRemove: string[] = []
  store.layers.forEach((layer) => {
    const payload = layer.params?.payload as Record<string, unknown> | null | undefined
    if (payload?.source === PLANNING_CONVERSION_SOURCE) {
      idsToRemove.push(layer.id)
    }
  })
  idsToRemove.forEach((id) => removeTerrainScatterLayer(store, id))
}

function estimateScatterCount(area: number): number {
  // Simple heuristic; keeps UI snappy.
  if (!Number.isFinite(area) || area <= 0) return 0
  return Math.min(200, Math.max(5, Math.round(area * 0.15)))
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

function upsertPlanningScatterLayer(store: TerrainScatterStore, payload: { category: TerrainScatterCategory; assetId: string; label?: string }) {
  const layerId = `planning:${payload.category}:${payload.assetId}`
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
      minScale: 0.85,
      maxScale: 1.15,
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

  const layerOrder: string[] = ['terrain-layer', 'building-layer', 'road-layer', 'green-layer', 'wall-layer']

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
    const kind = layerKindFromId(layerId)
    if (!kind) continue

    const group = featuresByLayer.get(layerId)!

    if (kind === 'building') {
      for (const poly of group.polygons) {
        const footprint = poly.points.map((p) => toWorldPoint(p, groundWidth, groundDepth, 0.01))
        const surface = sceneStore.createSurfaceNode({ points: footprint, name: poly.name?.trim() || 'Building Footprint' })
        if (surface) {
          sceneStore.moveNode({ nodeId: surface.id, targetId: root.id, position: 'inside' })
        }

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
        const strip = polylineToStripPolygon(line.points, 4)
        if (strip) {
          const points = strip.map((p) => toWorldPoint(p, groundWidth, groundDepth, 0.005))
          const road = sceneStore.createSurfaceNode({ points, name: line.name?.trim() || 'Road' })
          if (road) {
            sceneStore.moveNode({ nodeId: road.id, targetId: root.id, position: 'inside' })
          }
        }
        updateProgressForUnit(`Converting road: ${line.name?.trim() || line.id}`)
      }
    } else if (kind === 'green') {
      for (const poly of group.polygons) {
        const points = poly.points.map((p) => toWorldPoint(p, groundWidth, groundDepth, 0.008))
        const green = sceneStore.createSurfaceNode({ points, name: poly.name?.trim() || 'Greenery' })
        if (green) {
          sceneStore.moveNode({ nodeId: green.id, targetId: root.id, position: 'inside' })
        }

        const scatter = normalizeScatter(poly.scatter)
        if (scatter) {
          const layer = upsertPlanningScatterLayer(store, {
            category: scatter.category,
            assetId: scatter.assetId,
            label: scatter.name ?? 'Planning Scatter',
          })
          const area = polygonArea2D(poly.points)
          const targetCount = estimateScatterCount(area)
          const random = buildRandom(Math.floor(Date.now() % 2147483647))

          const existing = Array.isArray(layer.instances) ? [...layer.instances] : []
          const additions: TerrainScatterInstance[] = []
          for (let i = 0; i < targetCount; i += 1) {
            const sample = samplePointInPolygon(poly.points, random)
            if (!sample) continue
            const local = toWorldPoint(sample, groundWidth, groundDepth, 0)
            const yaw = (random() * Math.PI * 2)
            const scale = 0.85 + random() * 0.4
            additions.push({
              id: generateUuid(),
              assetId: scatter.assetId,
              layerId: layer.id,
              profileId: null,
              seed: null,
              localPosition: { x: local.x, y: 0, z: local.z },
              localRotation: { x: 0, y: yaw, z: 0 },
              localScale: { x: scale, y: scale, z: scale },
              groundCoords: null,
              binding: null,
              metadata: {
                source: PLANNING_CONVERSION_SOURCE,
                featureId: poly.id,
              },
            })
          }
          replaceTerrainScatterInstances(store, layer.id, [...existing, ...additions])
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
        const points = poly.points.map((p) => toWorldPoint(p, groundWidth, groundDepth, 0.002))
        const surface = sceneStore.createSurfaceNode({ points, name: poly.name?.trim() || 'Terrain Area' })
        if (surface) {
          sceneStore.moveNode({ nodeId: surface.id, targetId: root.id, position: 'inside' })
        }
        updateProgressForUnit(`Converting terrain: ${poly.name?.trim() || poly.id}`)
      }
    }
  }

  // Persist terrain scatter into ground mesh.
  const finalGround = findGroundNode(sceneStore.nodes)
  if (finalGround?.dynamicMesh?.type === 'Ground') {
    emitProgress(options, 'Applying scatter…', 96)
    const snapshot = serializeTerrainScatterStore(store)
    const next = {
      ...(finalGround.dynamicMesh as any),
      terrainScatter: snapshot,
    }
    sceneStore.updateNodeDynamicMesh(finalGround.id, next)
  }

  emitProgress(options, 'Done', 100)
  return { rootNodeId: root.id }
}
