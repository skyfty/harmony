import * as THREE from 'three'
import type { Ref } from 'vue'
import type { BuildTool } from '@/types/build-tool'
import type { PointerInteractionSession } from '@/types/pointer-interaction'
import { GROUND_NODE_ID } from '@schema'
import type { RoadDynamicMesh, SceneNode } from '@schema'
import type { RoadPresetData } from '@/utils/roadPreset'
import { buildRoadPreviewBuild, createRoadPreviewRenderer, type RoadPreviewSession } from './RoadPreviewRenderer'
import {
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
  /** Active road node being incrementally built in this session. */
  liveNodeId: string | null
  /** First anchor point of the current build session. */
  buildStartPoint: THREE.Vector3 | null
  /** Number of committed segments in this session. */
  committedSegmentCount: number
}

type LeftClickState = {
  atMs: number
  clientX: number
  clientY: number
}

type PointerInteractionApi = {
  get: () => PointerInteractionSession | null
  ensureMoved: (event: PointerEvent) => boolean
  clearIfKind: (kind: PointerInteractionSession['kind']) => boolean
}

type VertexSnapResolverOptions = {
  excludeNodeIds?: readonly string[]
  keepSourceY?: boolean
}

type BuildSurfacePlacementPoint = {
  point: THREE.Vector3
  nodeId: string | null
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
  projectPointToTerrain?: (point: THREE.Vector3) => THREE.Vector3
  getScene: () => THREE.Scene | null

  defaultWidth: number

  isAltOverrideActive: () => boolean
  isEditReferenceVisible?: () => boolean
  showStartIndicator?: (point: THREE.Vector3, options?: { height?: number | null }) => void
  hideStartIndicator?: () => void
  holdStartIndicatorUntilNodeVisible?: (options: {
    nodeId: string
    point: THREE.Vector3
    height?: number | null
  }) => void
  raycastGroundPoint: (event: PointerEvent, result: THREE.Vector3) => boolean
  resolveBuildPlacementPoint?: (event: PointerEvent, result: THREE.Vector3) => boolean
  resolveBuildPlacementSurfacePoint?: (event: PointerEvent) => BuildSurfacePlacementPoint | null
  resolveVertexSnapPoint?: (event: PointerEvent, point: THREE.Vector3, options?: VertexSnapResolverOptions) => THREE.Vector3 | null
  clearVertexSnap?: () => void
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
  getActiveNodeId: () => string | null

  updateNodeDynamicMesh: (nodeId: string, mesh: RoadDynamicMesh) => void
  createRoadNode: (options: {
    points: Array<{ x: number; y: number; z: number }>
    width: number
    roadPresetData?: RoadPresetData | null
    segmentHeights?: number[][]
  }) => SceneNode | null
  setNodeMaterials: (nodeId: string, materials: any[]) => void
  selectNode: (nodeId: string) => void

  getRoadBrush?: () => { presetAssetId: string | null; presetData: RoadPresetData | null }
  createRoadNodeMaterials: () => any[]
  ensureRoadVertexHandlesForSelectedNode: (options?: { force?: boolean }) => void
}): RoadBuildToolHandle {
  const DOUBLE_CLICK_MAX_INTERVAL_MS = 320
  const DOUBLE_CLICK_MAX_DISTANCE_PX = 8
  const previewRenderer = createRoadPreviewRenderer({
    rootGroup: options.rootGroup,
    heightSampler: options.heightSampler,
  })

  let session: RoadBuildToolSession | null = null
  let leftClickState: LeftClickState | null = null

  const isLeftDoubleClick = (event: PointerEvent): boolean => {
    if (event.button !== 0) {
      return false
    }
    const now = Number.isFinite(event.timeStamp) ? Number(event.timeStamp) : Date.now()
    const previous = leftClickState
    leftClickState = {
      atMs: now,
      clientX: event.clientX,
      clientY: event.clientY,
    }
    if (!previous) {
      return false
    }
    const dt = now - previous.atMs
    if (dt < 0 || dt > DOUBLE_CLICK_MAX_INTERVAL_MS) {
      return false
    }
    const distance = Math.hypot(event.clientX - previous.clientX, event.clientY - previous.clientY)
    return distance <= DOUBLE_CLICK_MAX_DISTANCE_PX
  }

  const hideStartIndicator = () => {
    options.hideStartIndicator?.()
  }

  const showLockedStartIndicator = (point: THREE.Vector3 | null | undefined) => {
    if (!point) {
      return
    }
    options.showStartIndicator?.(point, { height: 2 })
  }

  const holdStartIndicatorUntilNodeVisible = (nodeId: string | null | undefined, point: THREE.Vector3 | null | undefined) => {
    if (!nodeId || !point) {
      return
    }
    options.holdStartIndicatorUntilNodeVisible?.({
      nodeId,
      point: point.clone(),
      height: 2,
    })
  }

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
    hideStartIndicator()
    options.clearVertexSnap?.()
    session = null
    options.pointerInteraction.clearIfKind('buildToolRightClick')
    previewRenderer.reset()
  }

  const ensureSession = (): RoadBuildToolSession => {
    if (session) {
      return session
    }
    const presetWidth = Number(options.getRoadBrush?.()?.presetData?.width)
    const defaultWidth = Number.isFinite(presetWidth)
      ? Math.max(0.2, presetWidth)
      : (Number.isFinite(options.defaultWidth) ? options.defaultWidth : 2)
    session = {
      points: [],
      previewEnd: null,
      previewGroup: null,
      width: defaultWidth,
      snapVertices: options.collectRoadSnapVertices(),
      targetNodeId: null,
      startVertexIndex: null,
      liveNodeId: null,
      buildStartPoint: null,
      committedSegmentCount: 0,
    }
    return session
  }

  const shouldProjectToTerrain = (surfaceNodeId?: string | null): boolean => {
    return !surfaceNodeId || surfaceNodeId === GROUND_NODE_ID
  }

  const projectPointToTerrain = (point: THREE.Vector3, surfaceNodeId?: string | null): THREE.Vector3 => {
    if (!shouldProjectToTerrain(surfaceNodeId)) {
      return point.clone()
    }
    const projected = options.projectPointToTerrain?.(point.clone())
    return projected ?? point.clone()
  }

  const resolveSurfacePlacementPoint = (event: PointerEvent): BuildSurfacePlacementPoint | null => {
    if (options.resolveBuildPlacementSurfacePoint) {
      const resolved = options.resolveBuildPlacementSurfacePoint(event)
      if (resolved) {
        return resolved
      }
    }
    const point = new THREE.Vector3()
    if (!raycastPlacementPoint(event, point)) {
      return null
    }
    return { point, nodeId: GROUND_NODE_ID }
  }

  const raycastPlacementPoint = (event: PointerEvent, result: THREE.Vector3): boolean => {
    if (options.resolveBuildPlacementPoint) {
      return options.resolveBuildPlacementPoint(event, result)
    }
    return options.raycastGroundPoint(event, result)
  }

  const resolveWorldPoint = (event: PointerEvent, rawPoint: THREE.Vector3, surfaceNodeId?: string | null): THREE.Vector3 => {
    const snapped = options.resolveVertexSnapPoint?.(event, rawPoint, {
      excludeNodeIds: (session?.liveNodeId ?? session?.targetNodeId)
        ? [session?.liveNodeId ?? session?.targetNodeId!]
        : undefined,
      keepSourceY: true,
    })
    if (snapped) {
      return snapped.clone()
    }

    const roadSnap = options.snapRoadPointToVertices(
      rawPoint,
      session?.snapVertices ?? options.collectRoadSnapVertices(),
      options.vertexSnapDistance,
    )
    return projectPointToTerrain(roadSnap.position, surfaceNodeId)
  }

  const updateCursorPreview = (event: PointerEvent) => {
    if (options.isAltOverrideActive()) {
      return
    }
    if (!session || session.points.length === 0) {
      return
    }
    const surfacePlacement = resolveSurfacePlacementPoint(event)
    if (!surfacePlacement) {
      return
    }

    session.snapVertices = options.collectRoadSnapVertices()

    const rawPointer = surfacePlacement.point.clone()
    const next = resolveWorldPoint(event, rawPointer, surfacePlacement.nodeId)

    const previous = session.previewEnd
    if (previous && previous.equals(next)) {
      return
    }

    session.previewEnd = next
    updatePreview()
  }

  const updateStartIndicatorCursorPreview = (event: PointerEvent): boolean => {
    const isCameraNavActive = (event.buttons & 2) !== 0 || (event.buttons & 4) !== 0
    if (isCameraNavActive || options.isAltOverrideActive()) {
      hideStartIndicator()
      return false
    }
    if (options.isEditReferenceVisible?.()) {
      hideStartIndicator()
      return false
    }
    if (session && session.points.length > 0) {
      showLockedStartIndicator(session.points[0] ?? null)
      return true
    }
    const surfacePlacement = resolveSurfacePlacementPoint(event)
    if (!surfacePlacement) {
      hideStartIndicator()
      return false
    }

    const rawPointer = surfacePlacement.point.clone()

    const snapped = options.resolveVertexSnapPoint?.(event, rawPointer, {
      keepSourceY: true,
    })
    const point = snapped
      ? projectPointToTerrain(snapped, surfacePlacement.nodeId)
      : projectPointToTerrain(options.snapRoadPointToVertices(
          rawPointer,
          session?.snapVertices ?? options.collectRoadSnapVertices(),
          options.vertexSnapDistance,
        ).position, surfacePlacement.nodeId)

    options.showStartIndicator?.(point, { height: 2 })
    return true
  }

  // 处理道路放置点击事件
  const handlePlacementClick = (event: PointerEvent): boolean => {
    // 检查当前激活的工具是否为道路工具
    if (options.activeBuildTool.value !== 'road') {
      return false
    }
    // 检查是否有Alt键覆盖（用于其他操作）
    if (options.isAltOverrideActive()) {
      return false
    }

    // 确保存在会话对象
    const current = ensureSession()

    // 如果这是第一个点，优先使用射线投射交互：
    // - 如果点击了现有道路表面，通过分割最近的线段来开始分支
    // - 否则，回退到地面平面放置 + 顶点吸附
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

                const worldProjected = runtime.localToWorld(new THREE.Vector3(bestProjX, localHit.y, bestProjZ))

                current.targetNodeId = hit.nodeId
                current.startVertexIndex = startIndex
                current.snapVertices = options.collectRoadSnapVertices()
                current.points.push(worldProjected.clone())
                current.previewEnd = worldProjected.clone()
                hideStartIndicator()
                updatePreview()
                return true
              }
            }
          }
        }
      }
    }

    // Fall back to ground-plane placement + vertex snapping.
    const surfacePlacement = resolveSurfacePlacementPoint(event)
    if (!surfacePlacement) {
      return false
    }

    const snapped = surfacePlacement.point.clone()

    current.snapVertices = options.collectRoadSnapVertices()
    const snappedResult = options.snapRoadPointToVertices(snapped, current.snapVertices, options.vertexSnapDistance)
    const vertexSnapPoint = options.resolveVertexSnapPoint?.(event, snapped, {
      excludeNodeIds: (current.liveNodeId ?? current.targetNodeId)
        ? [current.liveNodeId ?? current.targetNodeId!]
        : undefined,
      keepSourceY: true,
    })
    let point = vertexSnapPoint
      ? projectPointToTerrain(vertexSnapPoint, surfacePlacement.nodeId)
      : projectPointToTerrain(snappedResult.position, surfacePlacement.nodeId)

    // If starting on an existing road vertex, branch into that road node.
    if (
      !vertexSnapPoint &&
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
      current.buildStartPoint = point.clone()
      hideStartIndicator()
      updatePreview()
      return true
    }

    // 闭合路径：如果用户点击靠近起始锚点的位置，则复用该点来闭合循环
    if (current.committedSegmentCount >= 2 && current.buildStartPoint) {
      const first = current.buildStartPoint
      // 计算当前点与起始点的水平距离平方（忽略Y轴）
      const dx = first.x - point.x
      const dz = first.z - point.z
      // 如果距离在吸附范围内，将当前点替换为起始点
      if (dx * dx + dz * dz <= options.vertexSnapDistance * options.vertexSnapDistance) {
        point = first.clone()
      }
    }

    // 获取路径中的最后一个点
    const last = current.points[current.points.length - 1]!
    // 检查当前点是否与最后一个点重合（距离很小）
    if (last.distanceToSquared(point) <= 1e-6) {
      // 更新预览终点并重新渲染预览
      current.previewEnd = point.clone()
      updatePreview()
      return true
    }

    const commitSegment = (segmentStart: THREE.Vector3, segmentEnd: THREE.Vector3): string | null => {
      if (!session) {
        return null
      }

      const build = buildRoadPreviewBuild([segmentStart], segmentEnd, session.width, {
        heightSampler: options.heightSampler,
      })
      if (!build) {
        return null
      }

      const roadPresetData = options.getRoadBrush?.()?.presetData ?? null
      const segmentPoints = build.worldPoints.map((entry) => ({ x: entry.x, y: entry.y, z: entry.z }))
      const segmentHeights = Array.isArray((build.definition as any).segmentHeights)
        ? ([...(build.definition as any).segmentHeights] as number[][])
        : undefined

      let activeNodeId = session.liveNodeId ?? session.targetNodeId
      if (!activeNodeId) {
        activeNodeId = options.getActiveNodeId?.();
      }
      if (activeNodeId) {
        const targetNode = options.findSceneNode(options.sceneNodes(), activeNodeId)
        const runtime = options.getRuntimeObject(activeNodeId)
        if (targetNode?.dynamicMesh?.type === 'Road' && runtime) {
          let merged = integrateWorldPolylineIntoRoadMesh({
            baseMesh: targetNode.dynamicMesh,
            runtime,
            worldPoints: build.worldPoints,
            width: build.definition.width,
            defaultWidth: session.width,
            segmentHeights: build.definition.segmentHeights,
          })

          if (merged) {
            const normalized = splitRoadSelfIntersectionsMesh(merged, build.definition.width)
            if (normalized) {
              merged = normalized
            }
            options.updateNodeDynamicMesh(activeNodeId, merged)
            return activeNodeId
          }
        }
      }

      const created = options.createRoadNode({
        points: segmentPoints,
        width: build.definition.width,
        roadPresetData,
        segmentHeights,
      })
      if (!created) {
        return null
      }

      if (!roadPresetData) {
        options.setNodeMaterials(created.id, options.createRoadNodeMaterials())
      }

      return created.id

    }

    const committedNodeId = commitSegment(last, point)
    if (!committedNodeId) {
      current.previewEnd = point.clone()
      updatePreview()
      return true
    }

    current.liveNodeId = committedNodeId
    current.targetNodeId = committedNodeId
    current.startVertexIndex = null
    current.committedSegmentCount += 1
    current.points = [point.clone()]
    current.previewEnd = point.clone()
    showLockedStartIndicator(point)

    options.selectNode(committedNodeId)
    options.ensureRoadVertexHandlesForSelectedNode({ force: true })
    holdStartIndicatorUntilNodeVisible(committedNodeId, current.buildStartPoint ?? point)
    updatePreview()
    return true
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

      updateStartIndicatorCursorPreview(event)

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
          if (isLeftDoubleClick(event)) {
            clearSession()
          }
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
          options.pointerInteraction.ensureMoved(event)
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
        hideStartIndicator()
        options.clearVertexSnap?.()
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
      current.liveNodeId = null
      current.buildStartPoint = worldPoint.clone()
      current.committedSegmentCount = 0
      showLockedStartIndicator(worldPoint)
      updatePreview({ immediate: true })
      return true
    },

    dispose: () => {
      hideStartIndicator()
      options.clearVertexSnap?.()
      previewRenderer.dispose(session)
      clearSession({ disposePreview: false })
    },
  }
}
