import * as THREE from 'three'
import type { Ref } from 'vue'
import type { BuildTool } from '@/types/build-tool'
import type { PointerInteractionSession } from '@/types/pointer-interaction'
import {
  ROAD_SURFACE_SIDECAR_FILENAME,
  ROAD_SURFACE_SIDECAR_VERSION,
  type RoadDynamicMesh,
  type SceneNode,
} from '@schema'
import { createRoadPreviewRenderer, type RoadPreviewSession } from './RoadPreviewRenderer'
import { applyRoadSurfaceStrokeToChunks } from './roadSurfaceRaster'

const ROAD_DEFAULT_CHUNK_SIZE_METERS = 32
const ROAD_DEFAULT_SAMPLE_SPACING_METERS = 0.5
const ROAD_DEFAULT_SURFACE_OFFSET = 0.01
const ROAD_DEFAULT_BRUSH_FALLOFF = 0.5

function normalizeChunkSizeMeters(mesh: RoadDynamicMesh): number {
  const raw = Number(mesh.chunkSizeMeters)
  return Number.isFinite(raw) ? Math.max(1, raw) : ROAD_DEFAULT_CHUNK_SIZE_METERS
}

function normalizeSampleSpacingMeters(mesh: RoadDynamicMesh): number {
  const raw = Number(mesh.sampleSpacingMeters)
  return Number.isFinite(raw) ? Math.max(0.05, raw) : ROAD_DEFAULT_SAMPLE_SPACING_METERS
}

function normalizeSurfaceOffset(mesh: RoadDynamicMesh): number {
  const raw = Number(mesh.surfaceOffset)
  return Number.isFinite(raw) ? Math.max(0, raw) : ROAD_DEFAULT_SURFACE_OFFSET
}

function normalizeBrushFalloff(mesh: RoadDynamicMesh): number {
  const raw = Number(mesh.brushFalloff)
  return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : ROAD_DEFAULT_BRUSH_FALLOFF
}

function mergeBounds(
  current: RoadDynamicMesh['bounds'] | null | undefined,
  next: { minX: number; minZ: number; maxX: number; maxZ: number } | null,
): RoadDynamicMesh['bounds'] | null {
  if (!next) {
    return current ?? null
  }
  if (!current) {
    return {
      minX: next.minX,
      minZ: next.minZ,
      maxX: next.maxX,
      maxZ: next.maxZ,
    }
  }
  return {
    minX: Math.min(current.minX, next.minX),
    minZ: Math.min(current.minZ, next.minZ),
    maxX: Math.max(current.maxX, next.maxX),
    maxZ: Math.max(current.maxZ, next.maxZ),
  }
}

function collectStrokeLocalPolyline(
  runtime: THREE.Object3D | null,
  worldPoints: THREE.Vector3[],
  fallbackOrigin?: { x: number; z: number } | null,
): Array<{ x: number; z: number }> {
  if (worldPoints.length === 0) {
    return []
  }
  const helper = new THREE.Vector3()
  const localPoints: Array<{ x: number; z: number }> = []
  for (const point of worldPoints) {
    if (runtime) {
      helper.copy(point)
      runtime.worldToLocal(helper)
    } else if (fallbackOrigin) {
      helper.set(point.x - fallbackOrigin.x, 0, point.z - fallbackOrigin.z)
    } else {
      continue
    }
    if (!Number.isFinite(helper.x) || !Number.isFinite(helper.z)) {
      continue
    }
    const prev = localPoints[localPoints.length - 1]
    if (prev && Math.abs(prev.x - helper.x) <= 1e-6 && Math.abs(prev.z - helper.z) <= 1e-6) {
      continue
    }
    localPoints.push({ x: helper.x, z: helper.z })
  }
  return localPoints
}

function collectStrokeLocalBounds(localPoints: Array<{ x: number; z: number }>): {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
} | null {
  if (localPoints.length === 0) {
    return null
  }
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const point of localPoints) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) {
      continue
    }
    minX = Math.min(minX, point.x)
    minZ = Math.min(minZ, point.z)
    maxX = Math.max(maxX, point.x)
    maxZ = Math.max(maxZ, point.z)
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minZ) || !Number.isFinite(maxX) || !Number.isFinite(maxZ)) {
    return null
  }
  return { minX, minZ, maxX, maxZ }
}

function buildRoadMeshWithSurfaceMetadata(params: {
  base: RoadDynamicMesh
  next: RoadDynamicMesh
  runtime: THREE.Object3D | null
  worldPoints: THREE.Vector3[]
  strokeWidth: number
  erase?: boolean
  fallbackOrigin?: { x: number; z: number } | null
}): RoadDynamicMesh {
  const { base, next, runtime, worldPoints, strokeWidth } = params
  const strokeLocalPolyline = collectStrokeLocalPolyline(runtime, worldPoints, params.fallbackOrigin)
  const strokeBounds = collectStrokeLocalBounds(strokeLocalPolyline)
  const mergedBounds = mergeBounds(base.bounds, strokeBounds)
  const mergedForChunks: RoadDynamicMesh = {
    ...base,
    ...next,
    type: 'Road',
    width: Number.isFinite(next.width) ? Math.max(0.2, next.width) : Math.max(0.2, base.width),
    version: Number.isFinite(base.version) ? Math.max(1, Math.trunc(base.version!)) : 1,
    chunkSizeMeters: normalizeChunkSizeMeters(base),
    sampleSpacingMeters: normalizeSampleSpacingMeters(base),
    surfaceOffset: normalizeSurfaceOffset(base),
    brushFalloff: normalizeBrushFalloff(base),
    previewMode: base.previewMode === 'mesh' ? 'mesh' : 'overlay',
    sidecar: base.sidecar ?? {
      filename: ROAD_SURFACE_SIDECAR_FILENAME,
      version: ROAD_SURFACE_SIDECAR_VERSION,
    },
    bounds: mergedBounds,
  }
  const result: RoadDynamicMesh = {
    ...mergedForChunks,
    roadSurfaceChunks: applyRoadSurfaceStrokeToChunks({
      mesh: mergedForChunks,
      localPolyline: strokeLocalPolyline,
      strokeWidth,
      erase: Boolean(params.erase),
    }),
  }
  if (result.roadSurfaceChunks && Object.keys(result.roadSurfaceChunks).length > 0) {
    delete (result as Partial<RoadDynamicMesh>).vertices
    delete (result as Partial<RoadDynamicMesh>).segments
  }
  return result
}

export type RoadSnapVertex = { position: THREE.Vector3; nodeId: string; vertexIndex: number }

export type RoadBuildToolSession = RoadPreviewSession & {
  snapVertices: RoadSnapVertex[]
  eraseMode: boolean
  draggedStroke: boolean
  livePreviewNodeId: string | null
  liveOriginalMesh: RoadDynamicMesh | null
  liveApplied: boolean
  liveCommitted: boolean
  lastLiveUpdateAt: number
  /** When set, edits an existing Road node (branch build). */
  targetNodeId: string | null
}

const ROAD_DRAG_APPEND_DISTANCE = 0.2
const ROAD_LIVE_UPDATE_INTERVAL_MS = 66
const ROAD_DEBUG_PREFIX = '[RoadBuildDebug]'

type PointerInteractionApi = {
  get: () => PointerInteractionSession | null
  ensureMoved: (event: PointerEvent) => boolean
  clearIfKind: (kind: PointerInteractionSession['kind']) => boolean
}

export type RoadBuildToolHandle = {
  getSession: () => RoadBuildToolSession | null
  flushPreviewIfNeeded: (scene: THREE.Scene | null) => void
  flushPreview: (scene: THREE.Scene | null) => void
  handlePointerDown: (event: PointerEvent) => boolean
  handlePointerMove: (event: PointerEvent) => boolean
  handlePointerUp: (event: PointerEvent) => boolean
  handlePointerCancel: (event: PointerEvent) => boolean
  cancel: () => boolean
  dispose: () => void
  beginBranchFromVertex: (options: {
    nodeId: string
    vertexIndex: number
    worldPoint: THREE.Vector3
    width: number
  }) => boolean
}

export function createRoadBuildTool(options: {
  activeBuildTool: Ref<BuildTool | null>
  pointerInteraction: PointerInteractionApi
  rootGroup: THREE.Group
  heightSampler: (x: number, z: number) => number
  getScene: () => THREE.Scene | null

  defaultWidth: number

  isAltOverrideActive: () => boolean
  raycastGroundPoint: (event: PointerEvent, result: THREE.Vector3) => boolean
  collectRoadSnapVertices: () => RoadSnapVertex[]
  snapRoadPointToVertices: (
    point: THREE.Vector3,
    vertices: RoadSnapVertex[],
    vertexSnapDistance?: number,
  ) => { position: THREE.Vector3; nodeId: string | null; vertexIndex: number | null }
  vertexSnapDistance: number

  pickNodeAtPointer: (event: PointerEvent) => { nodeId: string; point: THREE.Vector3 } | null
  findSceneNode: (nodes: SceneNode[], id: string) => SceneNode | null
  getRuntimeObject: (nodeId: string) => THREE.Object3D | null
  sceneNodes: () => SceneNode[]

  updateNodeDynamicMesh: (nodeId: string, mesh: RoadDynamicMesh) => void
  updateNodeDynamicMeshTransient?: (nodeId: string, mesh: RoadDynamicMesh) => void
  createRoadNode: (options: { points: Array<{ x: number; y: number; z: number }>; width: number }) => SceneNode | null
  setNodeMaterials: (nodeId: string, materials: any[]) => void
  selectNode: (nodeId: string) => void

  createRoadNodeMaterials: () => any[]
  ensureRoadVertexHandlesForSelectedNode: (options?: { force?: boolean }) => void
  onRoadSurfaceMeshCommitted?: (payload: {
    nodeId: string
    mesh: RoadDynamicMesh
    reason: 'branch-extend' | 'new-road'
  }) => void
}): RoadBuildToolHandle {
  const previewRenderer = createRoadPreviewRenderer({
    rootGroup: options.rootGroup,
    heightSampler: options.heightSampler,
  })

  const groundPointerHelper = new THREE.Vector3()

  let session: RoadBuildToolSession | null = null

  const clearPreview = () => {
    previewRenderer.clear(session)
  }

  const updatePreview = (updateOptions?: { immediate?: boolean }) => {
    if (updateOptions?.immediate) {
      previewRenderer.flush(options.getScene(), session)
      return
    }
    previewRenderer.markDirty()
  }

  const clearSession = (clearOptions: { disposePreview?: boolean } = {}) => {
    if (session?.liveApplied && !session.liveCommitted && session.livePreviewNodeId && session.liveOriginalMesh && options.updateNodeDynamicMeshTransient) {
      options.updateNodeDynamicMeshTransient(session.livePreviewNodeId, session.liveOriginalMesh)
    }
    if (clearOptions.disposePreview ?? true) {
      clearPreview()
    } else if (session?.previewGroup) {
      session.previewGroup.removeFromParent()
    }
    session = null
    options.pointerInteraction.clearIfKind('buildToolRightClick')
    previewRenderer.reset()
  }

  const ensureSession = (): RoadBuildToolSession => {
    if (session) {
      return session
    }
    session = {
      points: [],
      previewEnd: null,
      previewGroup: null,
      width: Number.isFinite(options.defaultWidth) ? options.defaultWidth : 2,
      snapVertices: options.collectRoadSnapVertices(),
      eraseMode: false,
      draggedStroke: false,
      livePreviewNodeId: null,
      liveOriginalMesh: null,
      liveApplied: false,
      liveCommitted: false,
      lastLiveUpdateAt: 0,
      targetNodeId: null,
    }
    return session
  }

  const cloneRoadDynamicMesh = (mesh: RoadDynamicMesh): RoadDynamicMesh => {
    const cloneChunkMap = (input: RoadDynamicMesh['roadSurfaceChunks']): RoadDynamicMesh['roadSurfaceChunks'] => {
      if (!input || typeof input !== 'object') {
        return null
      }
      const next: NonNullable<RoadDynamicMesh['roadSurfaceChunks']> = {}
      for (const [key, value] of Object.entries(input)) {
        if (!value || typeof value !== 'object') {
          continue
        }
        next[key] = {
          revision: Number.isFinite(value.revision) ? Math.max(0, Math.trunc(value.revision)) : 0,
          resolution: Number.isFinite(value.resolution) ? Math.max(1, Math.trunc(value.resolution)) : 1,
          coverageAssetId: typeof value.coverageAssetId === 'string' ? value.coverageAssetId : null,
          heightAssetId: typeof value.heightAssetId === 'string' ? value.heightAssetId : null,
          coverageData: typeof value.coverageData === 'string' ? value.coverageData : null,
          heightData: typeof value.heightData === 'string' ? value.heightData : null,
        }
      }
      return Object.keys(next).length ? next : null
    }

    return {
      type: 'Road',
      version: Number.isFinite(mesh.version) ? Math.max(1, Math.trunc(mesh.version!)) : 1,
      width: Number.isFinite(mesh.width) ? mesh.width : 2,
      chunkSizeMeters: Number.isFinite(mesh.chunkSizeMeters) ? mesh.chunkSizeMeters : undefined,
      sampleSpacingMeters: Number.isFinite(mesh.sampleSpacingMeters) ? mesh.sampleSpacingMeters : undefined,
      surfaceOffset: Number.isFinite(mesh.surfaceOffset) ? mesh.surfaceOffset : undefined,
      brushFalloff: Number.isFinite(mesh.brushFalloff) ? mesh.brushFalloff : undefined,
      previewMode: mesh.previewMode === 'mesh' ? 'mesh' : 'overlay',
      bounds: mesh.bounds
        ? {
            minX: mesh.bounds.minX,
            minZ: mesh.bounds.minZ,
            maxX: mesh.bounds.maxX,
            maxZ: mesh.bounds.maxZ,
          }
        : null,
      sidecar: mesh.sidecar
        ? {
            filename: mesh.sidecar.filename,
            version: Number.isFinite(mesh.sidecar.version) ? Math.trunc(mesh.sidecar.version) : 1,
          }
        : null,
      roadSurfaceChunks: cloneChunkMap(mesh.roadSurfaceChunks),
      vertices: Array.isArray(mesh.vertices)
        ? mesh.vertices
            .map((vertex) => {
              if (!Array.isArray(vertex) || vertex.length < 2) {
                return null
              }
              const x = Number(vertex[0])
              const z = Number(vertex[1])
              if (!Number.isFinite(x) || !Number.isFinite(z)) {
                return null
              }
              return [x, z] as [number, number]
            })
            .filter((vertex): vertex is [number, number] => Boolean(vertex))
        : undefined,
      segments: Array.isArray(mesh.segments)
        ? mesh.segments
            .map((segment) => {
              const a = Number((segment as any)?.a)
              const b = Number((segment as any)?.b)
              if (!Number.isInteger(a) || !Number.isInteger(b)) {
                return null
              }
              return { a, b }
            })
            .filter((segment): segment is { a: number; b: number } => Boolean(segment))
        : undefined,
    }
  }

  const applyLiveTransientUpdate = () => {
    if (!session || !options.updateNodeDynamicMeshTransient) {
      return
    }
    const targetNodeId = session.targetNodeId
    if (!targetNodeId || session.points.length < 2) {
      return
    }
    const now = Date.now()
    if (now - session.lastLiveUpdateAt < ROAD_LIVE_UPDATE_INTERVAL_MS) {
      return
    }
    const node = options.findSceneNode(options.sceneNodes(), targetNodeId)
    if (node?.dynamicMesh?.type !== 'Road') {
      return
    }
    const runtime = options.getRuntimeObject(targetNodeId)
    if (!runtime) {
      return
    }

    if (session.livePreviewNodeId !== targetNodeId || !session.liveOriginalMesh) {
      session.livePreviewNodeId = targetNodeId
      session.liveOriginalMesh = cloneRoadDynamicMesh(node.dynamicMesh)
    }
    const baseMesh = session.liveOriginalMesh ?? node.dynamicMesh
    const width = Number.isFinite(baseMesh.width) ? baseMesh.width : session.width
    const next: RoadDynamicMesh = {
      type: 'Road',
      width,
    }
    const merged = buildRoadMeshWithSurfaceMetadata({
      base: baseMesh,
      next,
      runtime,
      worldPoints: session.points,
      strokeWidth: width,
      erase: session.eraseMode,
    })
    options.updateNodeDynamicMeshTransient(targetNodeId, merged)
    session.liveApplied = true
    session.lastLiveUpdateAt = now
  }

  const updateCursorPreview = (event: PointerEvent) => {
    if (options.isAltOverrideActive()) {
      return
    }
    if (!session || session.points.length === 0) {
      return
    }
    if (!options.raycastGroundPoint(event, groundPointerHelper)) {
      return
    }

    session.snapVertices = options.collectRoadSnapVertices()

    const rawPointer = groundPointerHelper.clone()
    rawPointer.y = 0
    const { position: next } = options.snapRoadPointToVertices(rawPointer, session.snapVertices, options.vertexSnapDistance)

    const previous = session.previewEnd
    if (previous && previous.equals(next)) {
      return
    }

    session.previewEnd = next
    updatePreview()
  }

  const handlePlacementClick = (event: PointerEvent): boolean => {
    if (options.activeBuildTool.value !== 'road') {
      return false
    }
    if (options.isAltOverrideActive()) {
      return false
    }

    const current = ensureSession()
    if (current.points.length === 0) {
      current.eraseMode = Boolean(event.shiftKey)
      current.draggedStroke = false
    }

    // If this is the first point, prefer raycast-based interaction:
    // - If clicking on an existing road surface, start a branch by splitting the nearest segment.
    // - Otherwise, fall back to the ground-plane placement + vertex snapping.
    if (current.points.length === 0) {
      const hit = options.pickNodeAtPointer(event)
      if (hit?.nodeId) {
        const node = options.findSceneNode(options.sceneNodes(), hit.nodeId)
        const runtime = options.getRuntimeObject(hit.nodeId)
        if (node?.dynamicMesh?.type === 'Road' && runtime) {
          const worldProjected = hit.point.clone()
          worldProjected.y = 0
          current.livePreviewNodeId = null
          current.liveOriginalMesh = null
          current.liveApplied = false
          current.liveCommitted = false
          current.lastLiveUpdateAt = 0
          current.targetNodeId = hit.nodeId
          current.snapVertices = options.collectRoadSnapVertices()
          current.points.push(worldProjected.clone())
          current.previewEnd = worldProjected.clone()
          updatePreview()
          return true
        }
      }
    }

    // Fall back to ground-plane placement + vertex snapping.
    if (!options.raycastGroundPoint(event, groundPointerHelper)) {
      return false
    }

    const snapped = groundPointerHelper.clone()
    snapped.y = 0

    current.snapVertices = options.collectRoadSnapVertices()
    const snappedResult = options.snapRoadPointToVertices(snapped, current.snapVertices, options.vertexSnapDistance)
    let point = snappedResult.position

    // If starting on an existing road vertex, branch into that road node.
    if (current.points.length === 0 && snappedResult.nodeId) {
      current.targetNodeId = snappedResult.nodeId
    }

    if (current.points.length === 0) {
      current.points.push(point.clone())
      current.previewEnd = point.clone()
      updatePreview()
      return true
    }

    // Close loop: if user clicks near the starting point, reuse it.
    if (current.points.length >= 2) {
      const first = current.points[0]!
      const dx = first.x - point.x
      const dz = first.z - point.z
      if (dx * dx + dz * dz <= options.vertexSnapDistance * options.vertexSnapDistance) {
        point = first.clone()
      }
    }

    const last = current.points[current.points.length - 1]!
    if (last.distanceToSquared(point) <= 1e-6) {
      current.previewEnd = point.clone()
      updatePreview()
      return true
    }

    current.points.push(point.clone())
    current.previewEnd = point.clone()
    updatePreview()
    return true
  }

  const beginStrokeAtPointerDown = (event: PointerEvent): boolean => {
    if (options.activeBuildTool.value !== 'road') {
      return false
    }
    if (event.button !== 0 || options.isAltOverrideActive()) {
      return false
    }

    const current = ensureSession()
    if (current.points.length > 0) {
      return true
    }

    current.eraseMode = Boolean(event.shiftKey)
    current.draggedStroke = false

    const hit = options.pickNodeAtPointer(event)
    if (hit?.nodeId) {
      const node = options.findSceneNode(options.sceneNodes(), hit.nodeId)
      const runtime = options.getRuntimeObject(hit.nodeId)
      if (node?.dynamicMesh?.type === 'Road' && runtime) {
        const worldProjected = hit.point.clone()
        worldProjected.y = 0
        current.livePreviewNodeId = null
        current.liveOriginalMesh = null
        current.liveApplied = false
        current.liveCommitted = false
        current.lastLiveUpdateAt = 0
        current.targetNodeId = hit.nodeId
        current.snapVertices = options.collectRoadSnapVertices()
        current.points = [worldProjected.clone()]
        current.previewEnd = worldProjected.clone()
        updatePreview({ immediate: true })
        console.log(ROAD_DEBUG_PREFIX, 'pointerdown initialized from road hit', {
          targetNodeId: current.targetNodeId,
        })
        return true
      }
    }

    if (!options.raycastGroundPoint(event, groundPointerHelper)) {
      console.log(ROAD_DEBUG_PREFIX, 'pointerdown init failed: ground raycast miss')
      return false
    }

    const snapped = groundPointerHelper.clone()
    snapped.y = 0
    current.snapVertices = options.collectRoadSnapVertices()
    const snappedResult = options.snapRoadPointToVertices(snapped, current.snapVertices, options.vertexSnapDistance)
    const point = snappedResult.position
    if (snappedResult.nodeId) {
      current.targetNodeId = snappedResult.nodeId
    }
    current.points = [point.clone()]
    current.previewEnd = point.clone()
    updatePreview({ immediate: true })
    console.log(ROAD_DEBUG_PREFIX, 'pointerdown initialized from ground snap', {
      targetNodeId: current.targetNodeId,
      x: point.x,
      z: point.z,
    })
    return true
  }

  const finalize = () => {
    if (!session) {
      return
    }

    const committed = session.points.map((p) => p.clone())
    if (committed.length < 2) {
      console.log(ROAD_DEBUG_PREFIX, 'finalize cancelled: insufficient points', {
        pointCount: committed.length,
      })
      clearSession()
      return
    }

    // If last click is near the first point, reuse it to form a closed loop.
    if (committed.length >= 3) {
      const first = committed[0]!
      const last = committed[committed.length - 1]!
      const dx = first.x - last.x
      const dz = first.z - last.z
      if (dx * dx + dz * dz <= options.vertexSnapDistance * options.vertexSnapDistance) {
        committed[committed.length - 1] = first.clone()
      }
    }

    const targetNodeId = session.targetNodeId
    if (targetNodeId) {
      const node = options.findSceneNode(options.sceneNodes(), targetNodeId)
      if (node?.dynamicMesh?.type === 'Road') {
        const width = Number.isFinite(node.dynamicMesh.width) ? node.dynamicMesh.width : session.width
        const runtime = options.getRuntimeObject(targetNodeId)
        if (session.liveApplied && session.liveOriginalMesh && options.updateNodeDynamicMeshTransient) {
          options.updateNodeDynamicMeshTransient(targetNodeId, session.liveOriginalMesh)
        }
        const baseMesh = session.liveOriginalMesh ?? node.dynamicMesh
        if (runtime) {
          const next: RoadDynamicMesh = {
            type: 'Road',
            width,
          }
          const merged = buildRoadMeshWithSurfaceMetadata({
            base: baseMesh,
            next,
            runtime,
            worldPoints: committed,
            strokeWidth: width,
            erase: session.eraseMode,
          })
          options.updateNodeDynamicMesh(targetNodeId, merged)
          session.liveCommitted = true
          console.log(ROAD_DEBUG_PREFIX, 'finalize committed branch-extend', {
            targetNodeId,
            chunkCount: Object.keys(merged.roadSurfaceChunks ?? {}).length,
            committedPointCount: committed.length,
          })
          options.onRoadSurfaceMeshCommitted?.({
            nodeId: targetNodeId,
            mesh: merged,
            reason: 'branch-extend',
          })
        }
        options.ensureRoadVertexHandlesForSelectedNode({ force: true })
        clearSession()
        return
      }
    }

    const created = options.createRoadNode({
      points: committed.map((p) => ({ x: p.x, y: 0, z: p.z })),
      width: session.width,
    })

    if (created) {
      const roadMaterials = options.createRoadNodeMaterials()
      if (roadMaterials.length) {
        options.setNodeMaterials(created.id, roadMaterials)
      }
    }

    if (created?.dynamicMesh?.type === 'Road') {
      const runtime = options.getRuntimeObject(created.id)
      const next: RoadDynamicMesh = {
        type: 'Road',
        width: Number.isFinite(created.dynamicMesh.width) ? created.dynamicMesh.width : session.width,
      }
      const merged = buildRoadMeshWithSurfaceMetadata({
        base: created.dynamicMesh,
        next,
        runtime,
        worldPoints: committed,
        strokeWidth: next.width,
        erase: session.eraseMode,
        fallbackOrigin: {
          x: Number.isFinite(created.position?.x as number) ? (created.position!.x as number) : 0,
          z: Number.isFinite(created.position?.z as number) ? (created.position!.z as number) : 0,
        },
      })
      options.updateNodeDynamicMesh(created.id, merged)
      console.log(ROAD_DEBUG_PREFIX, 'finalize committed new-road', {
        nodeId: created.id,
        chunkCount: Object.keys(merged.roadSurfaceChunks ?? {}).length,
        committedPointCount: committed.length,
      })
      options.onRoadSurfaceMeshCommitted?.({
        nodeId: created.id,
        mesh: merged,
        reason: 'new-road',
      })
    }

    if (created?.dynamicMesh?.type === 'Road') {
      options.selectNode(created.id)
      options.ensureRoadVertexHandlesForSelectedNode({ force: true })
    }

    clearSession()
  }

  return {
    getSession: () => session,

    flushPreviewIfNeeded: (scene: THREE.Scene | null) => {
      previewRenderer.flushIfNeeded(scene, session)
    },

    flushPreview: (scene: THREE.Scene | null) => {
      previewRenderer.flush(scene, session)
    },

    handlePointerDown: (event: PointerEvent) => {
      return beginStrokeAtPointerDown(event)
    },

    handlePointerMove: (event: PointerEvent) => {
      if (options.activeBuildTool.value !== 'road') {
        return false
      }

      if (session?.points.length) {
        const isCameraNavActive = (event.buttons & 2) !== 0 || (event.buttons & 4) !== 0
        if (!isCameraNavActive) {
          if ((event.buttons & 1) !== 0 && !options.isAltOverrideActive()) {
            if (options.raycastGroundPoint(event, groundPointerHelper)) {
              session.snapVertices = options.collectRoadSnapVertices()
              const rawPointer = groundPointerHelper.clone()
              rawPointer.y = 0
              const snapped = options.snapRoadPointToVertices(rawPointer, session.snapVertices, options.vertexSnapDistance).position
              const last = session.points[session.points.length - 1] ?? null
              if (!last || last.distanceToSquared(snapped) >= ROAD_DRAG_APPEND_DISTANCE * ROAD_DRAG_APPEND_DISTANCE) {
                session.points.push(snapped.clone())
                session.draggedStroke = true
              }
              session.previewEnd = snapped.clone()
              applyLiveTransientUpdate()
              updatePreview()
              return true
            }
          }
          updateCursorPreview(event)
          return true
        }
      }

      return false
    },

    handlePointerUp: (event: PointerEvent) => {
      if (options.activeBuildTool.value !== 'road') {
        return false
      }

      if (event.button === 0) {
        if (options.isAltOverrideActive()) {
          return false
        }
        if (session?.draggedStroke && session.points.length >= 2) {
          finalize()
          event.preventDefault()
          event.stopPropagation()
          event.stopImmediatePropagation()
          return true
        }
        const handled = handlePlacementClick(event)
        if (handled) {
          event.preventDefault()
          event.stopPropagation()
          event.stopImmediatePropagation()
        }
        return handled
      }

      if (event.button === 2) {
        if (options.isAltOverrideActive()) {
          return false
        }
        const active = options.pointerInteraction.get()
        if (active?.kind === 'buildToolRightClick' && active.pointerId === event.pointerId && active.roadCancelEligible) {
          const clickWasDrag = active.moved || options.pointerInteraction.ensureMoved(event)
          if (!clickWasDrag && session) {
            finalize()
          }
        }
        return Boolean(active?.kind === 'buildToolRightClick' && active.pointerId === event.pointerId)
      }

      return false
    },

    handlePointerCancel: (event: PointerEvent) => {
      if (options.activeBuildTool.value !== 'road') {
        return false
      }
      if (!session) {
        return false
      }
      clearSession()
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return true
    },

    cancel: () => {
      if (!session) {
        return false
      }
      clearSession()
      return true
    },

    beginBranchFromVertex: ({ nodeId, vertexIndex: _vertexIndex, worldPoint, width }) => {
      if (options.activeBuildTool.value !== 'road') {
        return false
      }
      const current = ensureSession()
      current.points = [worldPoint.clone()]
      current.previewEnd = worldPoint.clone()
      current.width = Number.isFinite(width) ? width : current.width
      current.snapVertices = options.collectRoadSnapVertices()
      current.targetNodeId = nodeId
      updatePreview({ immediate: true })
      return true
    },

    dispose: () => {
      previewRenderer.dispose(session)
      clearSession({ disposePreview: false })
    },
  }
}
