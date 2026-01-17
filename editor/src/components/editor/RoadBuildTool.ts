import * as THREE from 'three'
import type { Ref } from 'vue'
import type { BuildTool } from '@/types/build-tool'
import type { PointerInteractionSession } from '@/types/pointer-interaction'
import type { RoadDynamicMesh, SceneNode } from '@harmony/schema'
import { createRoadPreviewRenderer, type RoadPreviewSession } from './RoadPreviewRenderer'
import {
  findConnectableRoadNodeId,
  integrateWorldPolylineIntoRoadMesh,
  splitRoadSelfIntersectionsMesh,
} from './RoadBuildGeometry'

export type RoadSnapVertex = { position: THREE.Vector3; nodeId: string; vertexIndex: number }

export type RoadBuildToolSession = RoadPreviewSession & {
  snapVertices: RoadSnapVertex[]
  /** When set, edits an existing Road node (branch build). */
  targetNodeId: string | null
  /** Vertex index in the target node to branch from. */
  startVertexIndex: number | null
}

type PointerInteractionApi = {
  get: () => PointerInteractionSession | null
  ensureMoved: (event: PointerEvent) => boolean
  clearIfKind: (kind: PointerInteractionSession['kind']) => boolean
}

export type RoadBuildToolHandle = {
  getSession: () => RoadBuildToolSession | null
  flushPreviewIfNeeded: (scene: THREE.Scene | null) => void
  flushPreview: (scene: THREE.Scene | null) => void
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
  createRoadNode: (options: { points: Array<{ x: number; y: number; z: number }>; width: number }) => SceneNode | null
  setNodeMaterials: (nodeId: string, materials: any[]) => void
  selectNode: (nodeId: string) => void

  createRoadNodeMaterials: () => any[]
  ensureRoadVertexHandlesForSelectedNode: (options?: { force?: boolean }) => void
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
      targetNodeId: null,
      startVertexIndex: null,
    }
    return session
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

    // If this is the first point, prefer raycast-based interaction:
    // - If clicking on an existing road surface, start a branch by splitting the nearest segment.
    // - Otherwise, fall back to the ground-plane placement + vertex snapping.
    if (current.points.length === 0) {
      const hit = options.pickNodeAtPointer(event)
      if (hit?.nodeId) {
        const node = options.findSceneNode(options.sceneNodes(), hit.nodeId)
        const runtime = options.getRuntimeObject(hit.nodeId)
        if (node?.dynamicMesh?.type === 'Road' && runtime) {
          const base = node.dynamicMesh
          const vertices = Array.isArray(base.vertices)
            ? base.vertices.map((v) => [Number(v[0]), Number(v[1])] as [number, number])
            : ([] as [number, number][]) 
          const segments = Array.isArray(base.segments)
            ? base.segments.map((s) => ({ a: Math.trunc(Number((s as any).a)), b: Math.trunc(Number((s as any).b)) }))
            : ([] as Array<{ a: number; b: number }>)

          if (vertices.length >= 2 && segments.length >= 1) {
            const localHit = runtime.worldToLocal(hit.point.clone())
            const clickX = localHit.x
            const clickZ = localHit.z

            const EPS2 = 1e-6
            const findExistingVertexIndex = (x: number, z: number): number => {
              for (let i = 0; i < vertices.length; i += 1) {
                const v = vertices[i]!
                const dx = (v[0] ?? 0) - x
                const dz = (v[1] ?? 0) - z
                if (dx * dx + dz * dz <= EPS2) {
                  return i
                }
              }
              return -1
            }

            // Find nearest segment and compute closest-point projection in local XZ.
            let bestSegmentIndex = -1
            let bestDist2 = Number.POSITIVE_INFINITY
            let bestAx = 0
            let bestAz = 0
            let bestBx = 0
            let bestBz = 0
            let bestProjX = 0
            let bestProjZ = 0
            let bestAIndex = -1
            let bestBIndex = -1

            for (let i = 0; i < segments.length; i += 1) {
              const seg = segments[i]!
              const a = seg.a
              const b = seg.b
              if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a === b) {
                continue
              }
              if (a >= vertices.length || b >= vertices.length) {
                continue
              }
              const va = vertices[a]
              const vb = vertices[b]
              if (!va || !vb) {
                continue
              }
              const ax = va[0]
              const az = va[1]
              const bx = vb[0]
              const bz = vb[1]
              if (!Number.isFinite(ax) || !Number.isFinite(az) || !Number.isFinite(bx) || !Number.isFinite(bz)) {
                continue
              }

              const dx = bx - ax
              const dz = bz - az
              const len2 = dx * dx + dz * dz
              if (len2 <= EPS2) {
                continue
              }
              const tRaw = ((clickX - ax) * dx + (clickZ - az) * dz) / len2
              const t = Math.max(0, Math.min(1, tRaw))
              const px = ax + dx * t
              const pz = az + dz * t
              const ddx = clickX - px
              const ddz = clickZ - pz
              const dist2 = ddx * ddx + ddz * ddz
              if (dist2 < bestDist2) {
                bestDist2 = dist2
                bestSegmentIndex = i
                bestAx = ax
                bestAz = az
                bestBx = bx
                bestBz = bz
                bestProjX = px
                bestProjZ = pz
                bestAIndex = a
                bestBIndex = b
              }
            }

            if (bestSegmentIndex >= 0 && bestAIndex >= 0 && bestBIndex >= 0) {
              const endpointSnap2 = options.vertexSnapDistance * options.vertexSnapDistance
              const daX = bestProjX - bestAx
              const daZ = bestProjZ - bestAz
              const dbX = bestProjX - bestBx
              const dbZ = bestProjZ - bestBz
              const dist2ToA = daX * daX + daZ * daZ
              const dist2ToB = dbX * dbX + dbZ * dbZ

              let startIndex = -1

              // If projection is near an endpoint, prefer reusing that endpoint.
              if (dist2ToA <= endpointSnap2) {
                startIndex = bestAIndex
              } else if (dist2ToB <= endpointSnap2) {
                startIndex = bestBIndex
              } else {
                const existingIndex = findExistingVertexIndex(bestProjX, bestProjZ)
                if (existingIndex >= 0) {
                  startIndex = existingIndex
                } else {
                  // Insert a new vertex and split the nearest segment.
                  const newIndex = vertices.length
                  vertices.push([bestProjX, bestProjZ])
                  const originalA = bestAIndex
                  const originalB = bestBIndex
                  segments[bestSegmentIndex] = { a: originalA, b: newIndex }
                  segments.push({ a: newIndex, b: originalB })
                  startIndex = newIndex
                }
              }

              if (startIndex >= 0) {
                const next: RoadDynamicMesh = {
                  type: 'Road',
                  width: Number.isFinite(base.width) ? Math.max(0.2, base.width) : current.width,
                  vertices,
                  segments,
                }

                // Persist the split immediately so subsequent clicks/commit can extend from this vertex.
                options.updateNodeDynamicMesh(hit.nodeId, next)

                const worldProjected = runtime.localToWorld(new THREE.Vector3(bestProjX, 0, bestProjZ))
                worldProjected.y = 0

                current.targetNodeId = hit.nodeId
                current.startVertexIndex = startIndex
                current.snapVertices = options.collectRoadSnapVertices()
                current.points.push(worldProjected.clone())
                current.previewEnd = worldProjected.clone()
                updatePreview()
                return true
              }
            }
          }
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
    if (
      current.points.length === 0 &&
      snappedResult.nodeId &&
      typeof snappedResult.vertexIndex === 'number' &&
      snappedResult.vertexIndex >= 0
    ) {
      current.targetNodeId = snappedResult.nodeId
      current.startVertexIndex = snappedResult.vertexIndex
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

  const finalize = () => {
    if (!session) {
      return
    }

    const committed = session.points.map((p) => p.clone())
    if (committed.length < 2) {
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
    const startVertexIndex = session.startVertexIndex
    if (targetNodeId && typeof startVertexIndex === 'number' && Number.isFinite(startVertexIndex) && startVertexIndex >= 0) {
      const node = options.findSceneNode(options.sceneNodes(), targetNodeId)
      if (node?.dynamicMesh?.type === 'Road') {
        const width = Number.isFinite(node.dynamicMesh.width) ? node.dynamicMesh.width : session.width
        const runtime = options.getRuntimeObject(targetNodeId)
        if (runtime) {
          const next = integrateWorldPolylineIntoRoadMesh({
            baseMesh: node.dynamicMesh,
            runtime,
            worldPoints: committed,
            width,
            defaultWidth: options.defaultWidth,
          })
          if (next) {
            options.updateNodeDynamicMesh(targetNodeId, next)
          }
        }
        options.ensureRoadVertexHandlesForSelectedNode({ force: true })
        clearSession()
        return
      }
    }

    const connectNodeId = findConnectableRoadNodeId({
      worldPoints: committed,
      nodes: options.sceneNodes(),
      getRuntimeObject: options.getRuntimeObject,
      collectRoadSnapVertices: options.collectRoadSnapVertices,
      snapRoadPointToVertices: options.snapRoadPointToVertices,
      vertexSnapDistance: options.vertexSnapDistance,
    })
    if (connectNodeId) {
      const node = options.findSceneNode(options.sceneNodes(), connectNodeId)
      const width = node?.dynamicMesh?.type === 'Road' && Number.isFinite(node.dynamicMesh.width)
        ? node.dynamicMesh.width
        : session.width
      const runtime = options.getRuntimeObject(connectNodeId)
      if (node?.dynamicMesh?.type === 'Road' && runtime) {
        const next = integrateWorldPolylineIntoRoadMesh({
          baseMesh: node.dynamicMesh,
          runtime,
          worldPoints: committed,
          width,
          defaultWidth: options.defaultWidth,
        })
        if (next) {
          options.updateNodeDynamicMesh(connectNodeId, next)
        }
      }
      options.selectNode(connectNodeId)
      options.ensureRoadVertexHandlesForSelectedNode({ force: true })
      clearSession()
      return
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
      const split = splitRoadSelfIntersectionsMesh(created.dynamicMesh, options.defaultWidth)
      if (split) {
        options.updateNodeDynamicMesh(created.id, split)
      }
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

    handlePointerMove: (event: PointerEvent) => {
      if (options.activeBuildTool.value !== 'road') {
        return false
      }

      if (session?.points.length) {
        const isCameraNavActive = (event.buttons & 2) !== 0 || (event.buttons & 4) !== 0
        if (!isCameraNavActive) {
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

    beginBranchFromVertex: ({ nodeId, vertexIndex, worldPoint, width }) => {
      if (options.activeBuildTool.value !== 'road') {
        return false
      }
      const current = ensureSession()
      current.points = [worldPoint.clone()]
      current.previewEnd = worldPoint.clone()
      current.width = Number.isFinite(width) ? width : current.width
      current.snapVertices = options.collectRoadSnapVertices()
      current.targetNodeId = nodeId
      current.startVertexIndex = vertexIndex
      updatePreview({ immediate: true })
      return true
    },

    dispose: () => {
      previewRenderer.dispose(session)
      clearSession({ disposePreview: false })
    },
  }
}
