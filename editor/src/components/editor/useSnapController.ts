import * as THREE from 'three'
import type { Ref } from 'vue'
import { findNodeIdForInstance } from '@schema/modelObjectCache'
import { MeshBVH } from 'three-mesh-bvh'

export type VertexSnapResult = {
  sourceWorld: THREE.Vector3
  targetWorld: THREE.Vector3
  delta: THREE.Vector3
  targetNodeId: string

  // Debug/overlay support
  sourceMesh?: THREE.Mesh | THREE.InstancedMesh
  sourceInstanceId?: number | null
  targetMesh?: THREE.Mesh | THREE.InstancedMesh
  targetInstanceId?: number | null
}

export type PlacementSnapResult = {
  best: VertexSnapResult | null
  candidates: VertexSnapResult[]
}

export type ViewportPixelProjection = {
  x: number
  y: number
  ndcZ: number
}

type SnapSourceState = {
  nodeId: string
  mesh: THREE.Mesh | THREE.InstancedMesh
  instanceId: number | null
  localPosition: THREE.Vector3
}

type SnapTargetCandidate = {
  nodeId: string
  worldPosition: THREE.Vector3
  screenDistance: number
}

type LockedTargetState = {
  nodeId: string
  mesh: THREE.Mesh | THREE.InstancedMesh
  instanceId: number | null
  vertexIndex: number
  localPosition: THREE.Vector3
}

type SnapSourceCandidate = {
  mesh: THREE.Mesh | THREE.InstancedMesh
  instanceId: number | null
  localPosition: THREE.Vector3
  worldPosition: THREE.Vector3
  screenDistance: number
  vertexIndex: number
}

type WorldVertexCandidate = {
  mesh: THREE.Mesh | THREE.InstancedMesh
  instanceId: number | null
  localPosition: THREE.Vector3
  worldPosition: THREE.Vector3
  vertexIndex: number
  thresholdWorld: number | null
}

type SourceVertexSet = {
  vertices: WorldVertexCandidate[]
  bounds: THREE.Box3 | null
  maxThresholdWorld: number | null
  grid: Map<string, number[]> | null
  cellSize: number | null
  kdTree: KDNode | null
}

type KDNode = {
  point: WorldVertexCandidate
  axis: 0 | 1 | 2
  left: KDNode | null
  right: KDNode | null
}

export type UseSnapControllerOptions = {
  canvasRef: Ref<HTMLCanvasElement | null>
  camera: Ref<THREE.Camera | null>
  objectMap: Map<string, THREE.Object3D>
  instancedMeshes?: THREE.InstancedMesh[]
  // Prefer providing instanced pick targets via a callback so callers can keep
  // matrices/bounds in sync with their existing picking architecture.
  getInstancedPickTargets?: () => THREE.InstancedMesh[]
  isNodeVisible: (nodeId: string) => boolean
  isObjectWorldVisible: (object: THREE.Object3D | null) => boolean
  isNodeLocked?: (nodeId: string) => boolean
  pixelThreshold?: number

  // Placement-time snap (preview placement) is currently experimental.
  // Keep it opt-in so unfinished behavior can't affect asset placement state.
  enablePlacementSideSnap?: boolean
}

export type SnapQuery = {
  event: MouseEvent
  selectedNodeId: string | null
  selectedObject: THREE.Object3D | null
  active: boolean
  excludeNodeIds?: Set<string>
  pixelThresholdPx?: number
}

export type PlacementSideSnapQuery = {
  event: MouseEvent
  previewObject: THREE.Object3D | null
  active: boolean
  excludeNodeIds?: Set<string>
  pixelThresholdPx?: number
}

export function useSnapController(options: UseSnapControllerOptions) {
  const pixelThreshold = (typeof options.pixelThreshold === 'number' && Number.isFinite(options.pixelThreshold))
    ? options.pixelThreshold
    : 12

  const enablePlacementSideSnap = options.enablePlacementSideSnap === true
  const releaseMultiplier = 1.5
  // Source vertex acquisition should be easier than target snapping.
  // Users expect to "grab" a corner vertex even when the pointer is near it,
  // without needing pixel-perfect placement.
  const sourceAcquireMultiplier = 2.5
  const sourceAcquireMinPx = 20
  const sourceAcquireMaxPx = 64
  const switchImprovementRatio = 0.7
  const switchMinImprovementPx = 2
  const switchScanGateRatio = 0.6
  const placementVerticalTolerance = 0.1
  const placementSideHorizontalRatio = 0.8
  const placementCandidateLimit = 2
  let activeSource: SnapSourceState | null = null
  let lockedTarget: LockedTargetState | null = null

  let placementSideSnapResult: VertexSnapResult | null = null

  const sourceWorldHelper = new THREE.Vector3()
  const targetWorldHelper = new THREE.Vector3()
  const vertexLocalHelper = new THREE.Vector3()
  const vertexWorldHelper = new THREE.Vector3()
  const projectedHelper = new THREE.Vector3()
  const placementProjectedHelper = new THREE.Vector3()
  const placementUnprojectedHelper = new THREE.Vector3()
  const placementSourceBoundsHelper = new THREE.Box3()
  const placementTargetBoundsHelper = new THREE.Box3()
  const placementExpandedBoundsHelper = new THREE.Box3()
  const placementInverseMatrixHelper = new THREE.Matrix4()
  const placementLocalBoundsHelper = new THREE.Box3()
  const placementVertexIndexSet = new Set<number>()

  const instancedRaycaster = new THREE.Raycaster()
  const pointerNdc = new THREE.Vector2()
  const instancedMatrixHelper = new THREE.Matrix4()
  const instancedWorldHelper = new THREE.Matrix4()
  const instancedVertexWorldHelper = new THREE.Vector3()

  const MAX_VERTEX_SCAN = 20000

  function isInternalHelperMesh(object: THREE.Object3D): boolean {
    const name = String(object.name ?? '')
    if (name.includes('PickProxy') || name.includes('Outline') || name.includes('InstancedOutline')) {
      return true
    }
    const userData = (object as any).userData
    if (userData?.instancedPickProxy === true || userData?.excludeFromOutline === true) {
      return true
    }
    return false
  }

  const reset = () => {
    activeSource = null
    lockedTarget = null
  }

  const resetPlacementSideSnap = () => {
    placementSideSnapResult = null
  }

  function computeWorldDistanceThreshold(worldPosition: THREE.Vector3, pixelDistance: number): number | null {
    const projected = projectWorldToViewportPixels(worldPosition, placementProjectedHelper)
    if (!projected) {
      return null
    }
    const unprojected = unprojectViewportPixelsAtNdcZ(
      projected.x + pixelDistance,
      projected.y,
      projected.ndcZ,
      placementUnprojectedHelper,
    )
    if (!unprojected) {
      return null
    }
    return Math.hypot(unprojected.x - worldPosition.x, unprojected.z - worldPosition.z)
  }

  function buildSourceSpatialGrid(vertices: WorldVertexCandidate[], cellSize: number): Map<string, number[]> {
    const grid = new Map<string, number[]>()
    const inv = 1 / cellSize
    for (let i = 0; i < vertices.length; i += 1) {
      const v = vertices[i]
      if (!v) {
        continue
      }
      const ix = Math.floor(v.worldPosition.x * inv)
      const iz = Math.floor(v.worldPosition.z * inv)
      const key = `${ix},${iz}`
      const bucket = grid.get(key)
      if (bucket) {
        bucket.push(i)
      } else {
        grid.set(key, [i])
      }
    }
    return grid
  }

  function ensureGeometryBvh(geometry: THREE.BufferGeometry): MeshBVH {
    const anyGeometry = geometry as unknown as { boundsTree?: MeshBVH }
    if (!anyGeometry.boundsTree) {
      anyGeometry.boundsTree = new MeshBVH(geometry)
    }
    return anyGeometry.boundsTree
  }

  function collectCandidateVertexIndicesFromBvh(
    geometry: THREE.BufferGeometry,
    localBounds: THREE.Box3,
    out: Set<number>,
  ): void {
    const boundsTree = ensureGeometryBvh(geometry)
    const index = geometry.index
    boundsTree.shapecast({
      intersectsBounds: (box) => localBounds.intersectsBox(box),
      intersectsTriangle: (_tri, triIndex) => {
        if (index) {
          const i0 = index.getX(triIndex * 3)
          const i1 = index.getX(triIndex * 3 + 1)
          const i2 = index.getX(triIndex * 3 + 2)
          out.add(i0)
          out.add(i1)
          out.add(i2)
        } else {
          const i0 = triIndex * 3
          out.add(i0)
          out.add(i0 + 1)
          out.add(i0 + 2)
        }
        return false
      },
    })
  }

  function buildSourceKdTree(vertices: WorldVertexCandidate[], depth = 0): KDNode | null {
    if (vertices.length === 0) {
      return null
    }
    const axis = (depth % 3) as 0 | 1 | 2
    const sorted = vertices.slice().sort((a, b) => {
      const av = axis === 0 ? a.worldPosition.x : axis === 1 ? a.worldPosition.y : a.worldPosition.z
      const bv = axis === 0 ? b.worldPosition.x : axis === 1 ? b.worldPosition.y : b.worldPosition.z
      return av - bv
    })
    const mid = Math.floor(sorted.length / 2)
    const point = sorted[mid]!
    return {
      point,
      axis,
      left: buildSourceKdTree(sorted.slice(0, mid), depth + 1),
      right: buildSourceKdTree(sorted.slice(mid + 1), depth + 1),
    }
  }

  function findNearestSourceInKdTree(
    node: KDNode | null,
    target: THREE.Vector3,
    thresholdPx: number,
    best: { source: WorldVertexCandidate; distance: number } | null,
  ): { source: WorldVertexCandidate; distance: number } | null {
    if (!node) {
      return best
    }

    const point = node.point
    const distance = target.distanceTo(point.worldPosition)
    const maxDistance = point.thresholdWorld ?? computeWorldDistanceThreshold(point.worldPosition, thresholdPx)
    if (typeof maxDistance !== 'number' || !Number.isFinite(maxDistance) || distance <= maxDistance) {
      if (!best || distance < best.distance) {
        best = { source: point, distance }
      }
    }

    const axis = node.axis
    const targetAxis = axis === 0 ? target.x : axis === 1 ? target.y : target.z
    const pointAxis = axis === 0 ? point.worldPosition.x : axis === 1 ? point.worldPosition.y : point.worldPosition.z
    const delta = targetAxis - pointAxis

    const near = delta <= 0 ? node.left : node.right
    const far = delta <= 0 ? node.right : node.left

    best = findNearestSourceInKdTree(near, target, thresholdPx, best)

    const bestDistance = best?.distance ?? Number.POSITIVE_INFINITY
    if (delta * delta < bestDistance * bestDistance) {
      best = findNearestSourceInKdTree(far, target, thresholdPx, best)
    }

    return best
  }

  function findNearestSourceVertex(
    worldPosition: THREE.Vector3,
    sourceSet: SourceVertexSet,
    thresholdPx: number,
  ): { source: WorldVertexCandidate; distance: number } | null {
    const vertices = sourceSet.vertices
    if (vertices.length === 0) {
      return null
    }

    const cellSize = sourceSet.cellSize
    const grid = sourceSet.grid
    const kdTree = sourceSet.kdTree

    let bestSource: WorldVertexCandidate | null = null
    let bestDistance = Number.POSITIVE_INFINITY

    const considerSource = (source: WorldVertexCandidate) => {
      const distance = worldPosition.distanceTo(source.worldPosition)
      const maxDistance = source.thresholdWorld ?? computeWorldDistanceThreshold(source.worldPosition, thresholdPx)
      if (typeof maxDistance === 'number' && Number.isFinite(maxDistance) && distance > maxDistance) {
        return
      }
      if (distance < bestDistance) {
        bestDistance = distance
        bestSource = source
      }
    }

    if (kdTree) {
      const found = findNearestSourceInKdTree(kdTree, worldPosition, thresholdPx, null)
      if (found && found.distance <= 1e-6) {
        return found
      }
      if (found) {
        bestSource = found.source
        bestDistance = found.distance
      }
    }

    if (!kdTree && cellSize && grid) {
      const inv = 1 / cellSize
      const ix = Math.floor(worldPosition.x * inv)
      const iz = Math.floor(worldPosition.z * inv)
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const key = `${ix + dx},${iz + dz}`
          const bucket = grid.get(key)
          if (!bucket) {
            continue
          }
          for (const idx of bucket) {
            const candidate = vertices[idx]
            if (!candidate) {
              continue
            }
            considerSource(candidate)
            if (bestDistance <= 1e-6) {
              return { source: bestSource!, distance: bestDistance }
            }
          }
        }
      }
    } else {
      for (const source of vertices) {
        considerSource(source)
        if (bestDistance <= 1e-6) {
          break
        }
      }
    }

    if (!bestSource || !Number.isFinite(bestDistance)) {
      return null
    }

    return { source: bestSource, distance: bestDistance }
  }

  function collectWorldVerticesForObject(object: THREE.Object3D, thresholdPx: number): SourceVertexSet {
    const vertices: WorldVertexCandidate[] = []
    let bounds: THREE.Box3 | null = null
    let maxThresholdWorld: number | null = null

    object.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!(mesh as unknown as { isMesh?: boolean }).isMesh) {
        return
      }
      if ((mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) {
        return
      }
      if (isInternalHelperMesh(mesh)) {
        return
      }
      if (!mesh.visible) {
        return
      }

      const geometry = mesh.geometry as THREE.BufferGeometry | undefined
      const position = geometry?.getAttribute('position') as THREE.BufferAttribute | undefined
      if (!position || position.itemSize < 3) {
        return
      }

      mesh.updateMatrixWorld(true)

      const stride = position.count > MAX_VERTEX_SCAN ? Math.ceil(position.count / MAX_VERTEX_SCAN) : 1
      for (let i = 0; i < position.count; i += stride) {
        vertexLocalHelper.fromBufferAttribute(position, i)
        vertexWorldHelper.copy(vertexLocalHelper).applyMatrix4(mesh.matrixWorld)

        const thresholdWorld = computeWorldDistanceThreshold(vertexWorldHelper, thresholdPx)
        if (typeof thresholdWorld === 'number' && Number.isFinite(thresholdWorld)) {
          maxThresholdWorld = typeof maxThresholdWorld === 'number'
            ? Math.max(maxThresholdWorld, thresholdWorld)
            : thresholdWorld
        }

        if (!bounds) {
          bounds = placementSourceBoundsHelper.clone()
          bounds.min.copy(vertexWorldHelper)
          bounds.max.copy(vertexWorldHelper)
        } else {
          bounds.expandByPoint(vertexWorldHelper)
        }

        vertices.push({
          mesh,
          instanceId: null,
          localPosition: vertexLocalHelper.clone(),
          worldPosition: vertexWorldHelper.clone(),
          vertexIndex: i,
          thresholdWorld,
        })
      }
    })

    const cellSize = typeof maxThresholdWorld === 'number' && Number.isFinite(maxThresholdWorld) && maxThresholdWorld > 0
      ? maxThresholdWorld
      : null
    const shouldBuildKdTree = vertices.length >= 800

    return {
      vertices,
      bounds,
      maxThresholdWorld,
      grid: !shouldBuildKdTree && cellSize ? buildSourceSpatialGrid(vertices, cellSize) : null,
      cellSize: !shouldBuildKdTree ? cellSize : null,
      kdTree: shouldBuildKdTree ? buildSourceKdTree(vertices) : null,
    }
  }

  function isObjectGeometryReady(object: THREE.Object3D | null): boolean {
    if (!object) {
      return false
    }
    let hasVertexData = false
    object.traverse((child) => {
      if (hasVertexData) {
        return
      }
      const mesh = child as THREE.Mesh
      if (!(mesh as any)?.isMesh) {
        return
      }
      if (isInternalHelperMesh(mesh)) {
        return
      }
      const geometry = (mesh as any).geometry as THREE.BufferGeometry | undefined
      const position = geometry?.getAttribute('position') as THREE.BufferAttribute | undefined
      if (!position || position.itemSize < 3 || position.count <= 0) {
        return
      }
      hasVertexData = true
    })
    return hasVertexData
  }

  function isNodeGeometryReady(nodeId: string | null | undefined): boolean {
    if (!nodeId) {
      return false
    }
    const object = options.objectMap.get(nodeId) ?? null
    return isObjectGeometryReady(object)
  }


  const projectWorldToViewportPixels = (worldPosition: THREE.Vector3, out?: THREE.Vector3): ViewportPixelProjection | null => {
    const canvas = options.canvasRef.value
    const camera = options.camera.value
    if (!canvas || !camera) {
      return null
    }
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      return null
    }

    const projected = out ?? projectedHelper
    projected.copy(worldPosition).project(camera)
    if (projected.z < -1 || projected.z > 1) {
      return null
    }

    const x = (projected.x + 1) * 0.5 * rect.width
    const y = (1 - (projected.y + 1) * 0.5) * rect.height
    return { x, y, ndcZ: projected.z }
  }

  const unprojectViewportPixelsAtNdcZ = (x: number, y: number, ndcZ: number, out?: THREE.Vector3): THREE.Vector3 | null => {
    const canvas = options.canvasRef.value
    const camera = options.camera.value
    if (!canvas || !camera) {
      return null
    }
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      return null
    }

    const ndcX = (x / rect.width) * 2 - 1
    const ndcY = -((y / rect.height) * 2 - 1)
    const target = out ?? new THREE.Vector3()
    target.set(ndcX, ndcY, ndcZ)
    target.unproject(camera)
    return target
  }

  const update = (query: SnapQuery): VertexSnapResult | null => {
        const threshold = typeof query.pixelThresholdPx === 'number' && Number.isFinite(query.pixelThresholdPx)
          ? query.pixelThresholdPx
          : pixelThreshold

    const sourceThreshold = Math.min(
      Math.max(Math.round(threshold * sourceAcquireMultiplier), sourceAcquireMinPx),
      sourceAcquireMaxPx,
    )

    if (!query.active) {
      reset()
      return null
    }

    const canvas = options.canvasRef.value
    const camera = options.camera.value
    if (!canvas || !camera) {
      reset()
      return null
    }

    const selectedNodeId = query.selectedNodeId
    const selectedObject = query.selectedObject
    if (!selectedNodeId || !selectedObject) {
      reset()
      return null
    }

    if (!options.isNodeVisible(selectedNodeId)) {
      reset()
      return null
    }

    if (!options.isObjectWorldVisible(selectedObject)) {
      reset()
      return null
    }

    selectedObject.updateMatrixWorld(true)

    const excludeNodeIds = query.excludeNodeIds

    if (!activeSource || activeSource.nodeId !== selectedNodeId) {
      const sourceCandidate = findNearestVertexOnObject(
        selectedObject,
        query.event,
        canvas,
        camera,
        sourceThreshold,
      )

      // If selected object has no direct mesh vertices (common for instanced-only rendering),
      // fall back to picking an instanced vertex belonging to this node.
      // NOTE: callers typically pass `excludeNodeIds` that include the currently-selected node
      // to prevent snapping *targets* to itself. Source acquisition is different: we must allow
      // selecting a source vertex on the selected node.
      const sourceExcludeNodeIds = excludeNodeIds && excludeNodeIds.has(selectedNodeId)
        ? new Set(Array.from(excludeNodeIds).filter((id) => id !== selectedNodeId))
        : excludeNodeIds
      const instancedSourceCandidate = !sourceCandidate
        ? findNearestVertexOnInstancedMeshes(query.event, canvas, camera, sourceThreshold, {
            includeNodeIds: new Set([selectedNodeId]),
            excludeNodeIds: sourceExcludeNodeIds,
          })
        : null

      const chosen = sourceCandidate ?? instancedSourceCandidate
      if (!chosen) {
        activeSource = null
        return null
      }

      activeSource = {
        nodeId: selectedNodeId,
        mesh: chosen.mesh,
        instanceId: chosen.instanceId,
        localPosition: chosen.localPosition.clone(),
      }
    }

    const sourceWorld = computeSourceWorld(activeSource)
    if (!sourceWorld) {
      reset()
      return null
    }

    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      return null
    }

    let lockedTargetWorld = lockedTarget ? computeLockedTargetWorld(lockedTarget, camera, rect, sourceWorld, threshold) : null
    if (!lockedTargetWorld) {
      const best = findNearestVertexInScene(query.event, canvas, camera, threshold, {
        excludeNodeIds: excludeNodeIds ?? new Set([selectedNodeId]),
      })
      if (!best) {
        lockedTarget = null
        return null
      }

      if (options.isNodeLocked?.(best.nodeId)) {
        lockedTarget = null
        return null
      }
      lockedTarget = {
        nodeId: best.nodeId,
        mesh: best.mesh,
        instanceId: best.instanceId,
        vertexIndex: best.vertexIndex,
        localPosition: best.localPosition.clone(),
      }
      lockedTargetWorld = best.worldPosition.clone()
    } else {
      // Sticky switching (hysteresis): avoid jumping between near-equal candidates.
      // Only scan for alternatives when the pointer is relatively far from the current locked target.
      const currentPointerDistance = computePointerDistanceToWorld(lockedTargetWorld, camera, rect, query.event)
      if (typeof currentPointerDistance === 'number' && Number.isFinite(currentPointerDistance)) {
        if (currentPointerDistance >= threshold * switchScanGateRatio) {
          const best = findNearestVertexInScene(query.event, canvas, camera, threshold, {
            excludeNodeIds: excludeNodeIds ?? new Set([selectedNodeId]),
          })
          if (best) {
            const sameAsLocked =
              lockedTarget &&
              best.mesh === lockedTarget.mesh &&
              best.instanceId === lockedTarget.instanceId &&
              best.vertexIndex === lockedTarget.vertexIndex

            if (!sameAsLocked) {
              const improvementPx = currentPointerDistance - best.screenDistance
              const ratioOk = best.screenDistance < currentPointerDistance * switchImprovementRatio
              const deltaOk = improvementPx >= switchMinImprovementPx
              if (ratioOk && deltaOk) {
                lockedTarget = {
                  nodeId: best.nodeId,
                  mesh: best.mesh,
                  instanceId: best.instanceId,
                  vertexIndex: best.vertexIndex,
                  localPosition: best.localPosition.clone(),
                }
                lockedTargetWorld = best.worldPosition.clone()
              }
            }
          }
        }
      }
    }

    if (!lockedTarget) {
      return null
    }

    const targetWorld = computeTargetWorld(lockedTarget)
    if (!targetWorld) {
      lockedTarget = null
      return null
    }

    const delta = targetWorld.clone().sub(sourceWorld)

    return {
      sourceWorld: sourceWorld.clone(),
      targetWorld: targetWorld.clone(),
      delta,
      targetNodeId: lockedTarget.nodeId,
      sourceMesh: activeSource.mesh,
      sourceInstanceId: activeSource.instanceId,
      targetMesh: lockedTarget.mesh,
      targetInstanceId: lockedTarget.instanceId,
    }
  }

  const updatePlacementSideSnap = (query: PlacementSideSnapQuery): PlacementSnapResult | null => {
    if (!enablePlacementSideSnap) {
      resetPlacementSideSnap()
      return null
    }

    const threshold = typeof query.pixelThresholdPx === 'number' && Number.isFinite(query.pixelThresholdPx)
      ? query.pixelThresholdPx
      : pixelThreshold

    if (!query.active) {
      resetPlacementSideSnap()
      return null
    }

    const previewObject = query.previewObject
    if (!previewObject) {
      resetPlacementSideSnap()
      return null
    }

    const canvas = options.canvasRef.value
    const camera = options.camera.value
    if (!canvas || !camera) {
      resetPlacementSideSnap()
      return null
    }

    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      resetPlacementSideSnap()
      return null
    }

    previewObject.updateMatrixWorld(true)

    // 放置吸附改为使用预览模型所有顶点与场景顶点的世界距离计算候选点
    const sourceSet = collectWorldVerticesForObject(previewObject, threshold)
    if (sourceSet.vertices.length === 0) {
      resetPlacementSideSnap()
      return null
    }

    const sideThresholdPx = threshold * placementSideHorizontalRatio

    type PlacementCandidateMeta = {
      result: VertexSnapResult
      screenDistance: number
      horizontalDistance: number
    }

    const sideCandidates: PlacementCandidateMeta[] = []
    const bottomCandidates: PlacementCandidateMeta[] = []

    const insertCandidate = (list: PlacementCandidateMeta[], candidate: PlacementCandidateMeta) => {
      let index = list.findIndex((entry) => candidate.screenDistance < entry.screenDistance)
      if (index < 0) {
        index = list.length
      }
      list.splice(index, 0, candidate)
      if (list.length > placementCandidateLimit) {
        list.length = placementCandidateLimit
      }
    }

    const considerCandidate = (
      candidate: SnapSourceCandidate & {
        nodeId: string
        sourceWorld: THREE.Vector3
        sourceMesh: THREE.Mesh | THREE.InstancedMesh
        sourceInstanceId: number | null
        sourceThresholdWorld: number | null
      },
    ) => {
      const sourceWorld = candidate.sourceWorld
      const targetWorld = candidate.worldPosition
      const deltaY = targetWorld.y - sourceWorld.y
      if (Math.abs(deltaY) > placementVerticalTolerance) {
        return
      }

      const horizontalDistance = Math.hypot(
        targetWorld.x - sourceWorld.x,
        targetWorld.z - sourceWorld.z,
      )
      const sideThresholdWorld = candidate.sourceThresholdWorld
      const isSideCandidate = typeof sideThresholdWorld === 'number' && Number.isFinite(sideThresholdWorld)
        ? horizontalDistance <= sideThresholdWorld * placementSideHorizontalRatio
        : candidate.screenDistance <= sideThresholdPx

      const delta = targetWorld.clone().sub(sourceWorld)
      const result: VertexSnapResult = {
        sourceWorld: sourceWorld.clone(),
        targetWorld: targetWorld.clone(),
        delta,
        targetNodeId: candidate.nodeId,
        sourceMesh: candidate.sourceMesh,
        sourceInstanceId: candidate.sourceInstanceId,
        targetMesh: candidate.mesh,
        targetInstanceId: candidate.instanceId,
      }

      const meta: PlacementCandidateMeta = {
        result,
        screenDistance: candidate.screenDistance,
        horizontalDistance,
      }

      if (isSideCandidate) {
        insertCandidate(sideCandidates, meta)
      } else {
        insertCandidate(bottomCandidates, meta)
      }
    }

    const excludeNodeIds = query.excludeNodeIds

    const instancedBest = findNearestVertexOnInstancedMeshes(query.event, canvas, camera, threshold, {
      excludeNodeIds,
      sourceVertices: sourceSet,
    })
    if (instancedBest && instancedBest.sourceWorld && instancedBest.sourceMesh) {
      considerCandidate({
        nodeId: instancedBest.nodeId,
        mesh: instancedBest.mesh,
        instanceId: instancedBest.instanceId,
        localPosition: instancedBest.localPosition,
        worldPosition: instancedBest.worldPosition,
        screenDistance: instancedBest.screenDistance,
        vertexIndex: instancedBest.vertexIndex,
        sourceWorld: instancedBest.sourceWorld,
        sourceMesh: instancedBest.sourceMesh,
        sourceInstanceId: instancedBest.sourceInstanceId ?? null,
        sourceThresholdWorld: instancedBest.sourceThresholdWorld ?? null,
      })
    }

    for (const [nodeId, object] of options.objectMap.entries()) {
      if (!object) {
        continue
      }
      if (excludeNodeIds?.has(nodeId)) {
        continue
      }
      if (!options.isNodeVisible(nodeId)) {
        continue
      }
      if (options.isNodeLocked?.(nodeId)) {
        continue
      }
      if (!options.isObjectWorldVisible(object)) {
        continue
      }

      object.updateMatrixWorld(true)
      const candidate = findNearestVertexOnObjectByWorldDistance(object, sourceSet, threshold)
      if (!candidate) {
        continue
      }

      considerCandidate({
        nodeId,
        mesh: candidate.mesh,
        instanceId: candidate.instanceId,
        localPosition: candidate.localPosition,
        worldPosition: candidate.worldPosition,
        screenDistance: candidate.screenDistance,
        vertexIndex: candidate.vertexIndex,
        sourceWorld: candidate.sourceWorld,
        sourceMesh: candidate.sourceMesh,
        sourceInstanceId: candidate.sourceInstanceId,
        sourceThresholdWorld: candidate.sourceThresholdWorld,
      })
    }

    const chosen = sideCandidates.length > 0 ? sideCandidates : bottomCandidates
    const candidates = chosen.map((entry) => entry.result)
    placementSideSnapResult = candidates[0] ?? null

    if (!placementSideSnapResult) {
      resetPlacementSideSnap()
      return null
    }

    return {
      best: placementSideSnapResult,
      candidates,
    }
  }

  const consumePlacementSideSnapResult = (): VertexSnapResult | null => {
    if (!enablePlacementSideSnap) {
      resetPlacementSideSnap()
      return null
    }
    const result = placementSideSnapResult
    resetPlacementSideSnap()
    return result
  }

  function computeSourceWorld(source: SnapSourceState): THREE.Vector3 | null {
    if (!source.mesh) {
      return null
    }
    source.mesh.updateMatrixWorld(true)

    if ((source.mesh as THREE.InstancedMesh).isInstancedMesh && source.instanceId != null) {
      const instanced = source.mesh as THREE.InstancedMesh
      instanced.getMatrixAt(source.instanceId, instancedMatrixHelper)
      instancedWorldHelper.multiplyMatrices(instanced.matrixWorld, instancedMatrixHelper)
      sourceWorldHelper.copy(source.localPosition).applyMatrix4(instancedWorldHelper)
      return sourceWorldHelper
    }

    sourceWorldHelper.copy(source.localPosition).applyMatrix4((source.mesh as THREE.Mesh).matrixWorld)
    return sourceWorldHelper
  }

  function computeTargetWorld(target: LockedTargetState): THREE.Vector3 | null {
    if (!target.mesh) {
      return null
    }
    target.mesh.updateMatrixWorld(true)

    if ((target.mesh as THREE.InstancedMesh).isInstancedMesh && target.instanceId != null) {
      const instanced = target.mesh as THREE.InstancedMesh
      instanced.getMatrixAt(target.instanceId, instancedMatrixHelper)
      instancedWorldHelper.multiplyMatrices(instanced.matrixWorld, instancedMatrixHelper)
      return target.localPosition.clone().applyMatrix4(instancedWorldHelper)
    }

    return target.localPosition.clone().applyMatrix4((target.mesh as THREE.Mesh).matrixWorld)
  }

  function findNearestVertexInScene(
    event: MouseEvent,
    canvas: HTMLCanvasElement,
    camera: THREE.Camera,
    threshold: number,
    filters: { excludeNodeIds: Set<string> },
  ): (SnapTargetCandidate & { mesh: THREE.Mesh | THREE.InstancedMesh; instanceId: number | null; vertexIndex: number; localPosition: THREE.Vector3 }) | null {
    let best: (SnapTargetCandidate & { mesh: THREE.Mesh | THREE.InstancedMesh; instanceId: number | null; vertexIndex: number; localPosition: THREE.Vector3 }) | null = null

    const instancedBest = findNearestVertexOnInstancedMeshes(event, canvas, camera, threshold, { excludeNodeIds: filters.excludeNodeIds })
    if (instancedBest) {
      best = {
        nodeId: instancedBest.nodeId,
        worldPosition: instancedBest.worldPosition.clone(),
        screenDistance: instancedBest.screenDistance,
        mesh: instancedBest.mesh,
        instanceId: instancedBest.instanceId,
        vertexIndex: instancedBest.vertexIndex,
        localPosition: instancedBest.localPosition.clone(),
      }
    }

    for (const [nodeId, object] of options.objectMap.entries()) {
      if (!object || filters.excludeNodeIds.has(nodeId)) {
        continue
      }
      if (!options.isNodeVisible(nodeId)) {
        continue
      }
      if (options.isNodeLocked?.(nodeId)) {
        continue
      }
      if (!options.isObjectWorldVisible(object)) {
        continue
      }

      object.updateMatrixWorld(true)
      const candidate = findNearestVertexOnObject(object, event, canvas, camera, threshold)
      if (!candidate) {
        continue
      }

      if (!best || candidate.screenDistance < best.screenDistance) {
        best = {
          nodeId,
          worldPosition: candidate.worldPosition.clone(),
          screenDistance: candidate.screenDistance,
          mesh: candidate.mesh,
          instanceId: candidate.instanceId,
          vertexIndex: candidate.vertexIndex,
          localPosition: candidate.localPosition.clone(),
        }
      }
    }

    return best
  }

  function findNearestVertexOnObjectByWorldDistance(
    object: THREE.Object3D,
    sourceSet: SourceVertexSet,
    thresholdPx: number,
  ): (SnapTargetCandidate & {
    mesh: THREE.Mesh
    instanceId: null
    vertexIndex: number
    localPosition: THREE.Vector3
    sourceWorld: THREE.Vector3
    sourceMesh: THREE.Mesh | THREE.InstancedMesh
    sourceInstanceId: number | null
    sourceThresholdWorld: number | null
  }) | null {
    let best: (SnapTargetCandidate & {
      mesh: THREE.Mesh
      instanceId: null
      vertexIndex: number
      localPosition: THREE.Vector3
      sourceWorld: THREE.Vector3
      sourceMesh: THREE.Mesh | THREE.InstancedMesh
      sourceInstanceId: number | null
      sourceThresholdWorld: number | null
    }) | null = null

    const sourceBounds = sourceSet.bounds
    const maxThresholdWorld = sourceSet.maxThresholdWorld
    object.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!(mesh as unknown as { isMesh?: boolean }).isMesh) {
        return
      }
      if ((mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) {
        return
      }
      if (isInternalHelperMesh(mesh)) {
        return
      }
      if (!mesh.visible) {
        return
      }

      const geometry = mesh.geometry as THREE.BufferGeometry | undefined
      const position = geometry?.getAttribute('position') as THREE.BufferAttribute | undefined
      if (!position || position.itemSize < 3) {
        return
      }

      mesh.updateMatrixWorld(true)

      // 若存在源顶点包围盒与最大阈值，先用包围盒快速剔除不可能匹配的网格
      if (sourceBounds && typeof maxThresholdWorld === 'number' && Number.isFinite(maxThresholdWorld) && geometry) {
        const geometryBounds = geometry.boundingBox ?? (geometry.computeBoundingBox(), geometry.boundingBox)
        if (geometryBounds) {
          placementTargetBoundsHelper.copy(geometryBounds)
          placementTargetBoundsHelper.applyMatrix4(mesh.matrixWorld)
          placementExpandedBoundsHelper.copy(placementTargetBoundsHelper).expandByScalar(maxThresholdWorld)
          if (!placementExpandedBoundsHelper.intersectsBox(sourceBounds)) {
            return
          }
        }
      }
      const stride = position.count > MAX_VERTEX_SCAN ? Math.ceil(position.count / MAX_VERTEX_SCAN) : 1
      for (let i = 0; i < position.count; i += stride) {
        vertexLocalHelper.fromBufferAttribute(position, i)
        vertexWorldHelper.copy(vertexLocalHelper).applyMatrix4(mesh.matrixWorld)

        const nearest = findNearestSourceVertex(vertexWorldHelper, sourceSet, thresholdPx)
        const bestSource = nearest?.source ?? null
        const bestDistance = nearest?.distance ?? Number.POSITIVE_INFINITY

        if (!bestSource || !Number.isFinite(bestDistance)) {
          continue
        }

        if (!best || bestDistance < best.screenDistance) {
          best = {
            nodeId: '',
            worldPosition: vertexWorldHelper.clone(),
            screenDistance: bestDistance,
            mesh,
            instanceId: null,
            vertexIndex: i,
            localPosition: vertexLocalHelper.clone(),
            sourceWorld: bestSource.worldPosition.clone(),
            sourceMesh: bestSource.mesh,
            sourceInstanceId: bestSource.instanceId,
            sourceThresholdWorld: bestSource.thresholdWorld,
          }
        }
      }
    })

    if (!best) {
      return null
    }

    return best
  }

  function findNearestVertexOnObject(
    object: THREE.Object3D,
    event: MouseEvent,
    canvas: HTMLCanvasElement,
    camera: THREE.Camera,
    threshold: number,
  ): SnapSourceCandidate | null {
    // 获取画布在页面中的边界信息（用于将世界坐标投影到屏幕像素坐标）
    const rect = canvas.getBoundingClientRect()
    // 如果画布尺寸为 0 则无法投影，直接返回 null
    if (rect.width === 0 || rect.height === 0) {
      return null
    }

    // 最佳匹配结果（返回给调用者），初始化为空
    let best: SnapSourceCandidate | null = null

    // 遍历传入对象的所有子孙节点，查找 Mesh（非 InstancedMesh）的顶点。
    // 说明：这里仅在非实例化的网格上扫描顶点；InstancedMesh 的顶点采样由
    // `findNearestVertexOnInstancedMeshes` 单独处理。
    object.traverse((child) => {
      const mesh = child as THREE.Mesh

      // 如果不是 Mesh，则跳过
      if (!(mesh as unknown as { isMesh?: boolean }).isMesh) {
        return
      }

      // 跳过 InstancedMesh（本函数仅处理普通 Mesh）
      if ((mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) {
        return
      }

      // 跳过内部帮助器/代理网格（比如 PickProxy、Outline 等），这些不是场景实际几何
      if (isInternalHelperMesh(mesh)) {
        return
      }

      // 不可见的网格无需参与拾取
      if (!mesh.visible) {
        return
      }

      // 读取几何数据并拿到 position attribute（顶点坐标）
      const geometry = mesh.geometry as THREE.BufferGeometry | undefined
      const position = geometry?.getAttribute('position') as THREE.BufferAttribute | undefined
      // 如果没有 position 或者 itemSize < 3（不是三维顶点），则跳过
      if (!position || position.itemSize < 3) {
        return
      }

      // 确保网格世界变换已更新，用于局部->世界坐标转换
      mesh.updateMatrixWorld(true)

      // 为了性能，当顶点数量非常大时进行抽样（stride）以限制最多扫描 MAX_VERTEX_SCAN 个顶点。
      // stride = 1 表示逐个顶点扫描；当 position.count > MAX_VERTEX_SCAN 时按比例采样。
      const stride = position.count > MAX_VERTEX_SCAN ? Math.ceil(position.count / MAX_VERTEX_SCAN) : 1

      // 遍历顶点（按采样步长），把每个顶点从本地坐标转换到世界坐标，然后投影到屏幕上
      for (let i = 0; i < position.count; i += stride) {
        // 从 attribute 中读取局部顶点坐标到 vertexLocalHelper
        vertexLocalHelper.fromBufferAttribute(position, i)
        // 将局部坐标转换到世界坐标（考虑网格的 matrixWorld）
        vertexWorldHelper.copy(vertexLocalHelper).applyMatrix4(mesh.matrixWorld)

        // 将世界坐标投影到屏幕像素坐标；投影失败（顶点在相机裁切面外）则跳过
        if (!projectToScreen(vertexWorldHelper, camera, rect, projectedHelper)) {
          continue
        }

        // 计算投影点与鼠标指针位置的屏幕像素距离（dx, dy）并求出欧氏距离
        // 注意：这里使用 event.clientX/Y（页面坐标），因此 projectToScreen 也使用了相同的 rect
        const dx = projectedHelper.x - event.clientX
        const dy = projectedHelper.y - event.clientY
        const distance = Math.hypot(dx, dy)

        // 如果距离超过阈值（threshold，像素），则忽略该顶点
        if (distance > threshold) {
          continue
        }

        // 如果当前顶点比已有最佳顶点更接近指针（screenDistance 更小），则记录为新的最佳匹配
        if (!best || distance < best.screenDistance) {
          best = {
            mesh,
            instanceId: null,
            // 注意需要克隆局部与世界向量以防后续复用覆盖
            localPosition: vertexLocalHelper.clone(),
            worldPosition: vertexWorldHelper.clone(),
            screenDistance: distance,
            vertexIndex: i,
          }
        }
      }
    })

    // 返回找到的最优顶点候选（可能为 null）
    return best
  }

  function projectToScreen(
    worldPosition: THREE.Vector3,
    camera: THREE.Camera,
    rect: DOMRect,
    out: THREE.Vector3,
  ): boolean {
    out.copy(worldPosition).project(camera)
    if (out.z < -1 || out.z > 1) {
      return false
    }

    out.x = rect.left + (out.x + 1) * 0.5 * rect.width
    out.y = rect.top + (1 - (out.y + 1) * 0.5) * rect.height
    return true
  }

  function computePointerDistanceToWorld(
    worldPosition: THREE.Vector3,
    camera: THREE.Camera,
    rect: DOMRect,
    event: MouseEvent,
  ): number | null {
    if (!projectToScreen(worldPosition, camera, rect, projectedHelper)) {
      return null
    }
    const dx = projectedHelper.x - event.clientX
    const dy = projectedHelper.y - event.clientY
    return Math.hypot(dx, dy)
  }

  function computeLockedTargetWorld(
    target: LockedTargetState,
    camera: THREE.Camera,
    rect: DOMRect,
    sourceWorld: THREE.Vector3,
    threshold: number,
  ): THREE.Vector3 | null {
    if (!target.mesh) {
      return null
    }
    if (!target.mesh.visible) {
      return null
    }
    if (!options.isObjectWorldVisible(target.mesh)) {
      return null
    }
    target.mesh.updateMatrixWorld(true)
    const computed = computeTargetWorld(target)
    if (!computed) {
      return null
    }
    targetWorldHelper.copy(computed)
    if (!projectToScreen(targetWorldHelper, camera, rect, projectedHelper)) {
      return null
    }

    if (!projectToScreen(sourceWorld, camera, rect, vertexWorldHelper)) {
      return null
    }

    const dx = projectedHelper.x - vertexWorldHelper.x
    const dy = projectedHelper.y - vertexWorldHelper.y
    const distance = Math.hypot(dx, dy)
    if (distance > threshold * releaseMultiplier) {
      return null
    }
    return targetWorldHelper
  }

  function findNearestVertexOnInstancedMeshes(
    event: MouseEvent,
    canvas: HTMLCanvasElement,
    camera: THREE.Camera,
    threshold: number,
    filters: {
      excludeNodeIds?: Set<string>
      includeNodeIds?: Set<string>
      sourceVertices?: SourceVertexSet
    },
  ): (SnapTargetCandidate & {
    mesh: THREE.InstancedMesh
    instanceId: number
    vertexIndex: number
    localPosition: THREE.Vector3
    sourceWorld?: THREE.Vector3
    sourceMesh?: THREE.Mesh | THREE.InstancedMesh
    sourceInstanceId?: number | null
    sourceThresholdWorld?: number | null
  }) | null {
    // 获取用于实例化拾取的 InstancedMesh 列表。调用者可以通过 `getInstancedPickTargets`
    // 回调提供最新的候选数组，否则使用内部注册的 `options.instancedMeshes`。
    const meshes = options.getInstancedPickTargets?.() ?? options.instancedMeshes
    if (!meshes || meshes.length === 0) {
      return null
    }

    // 获取画布边界用于后续屏幕投影判断
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      return null
    }

    const sourceSet = filters.sourceVertices
    const usingSourceVertices = Boolean(sourceSet && sourceSet.vertices.length > 0)

    // 若存在 sourceVertices，则采用“预览顶点 vs 场景实例顶点”的世界距离计算模式；
    // 否则保持原有鼠标射线拾取模式。
    let picked: { mesh: THREE.InstancedMesh; instanceId: number; nodeId: string } | null = null

    if (!usingSourceVertices) {
      // 使用射线检测快速定位用户指针下可能命中的实例（instanceId）集合。
      // 这里先把指针从像素坐标转换到 NDC（-1..1），然后让 instancedRaycaster 从相机发射射线。
      pointerNdc.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height * 2 - 1))
      instancedRaycaster.setFromCamera(pointerNdc, camera)
      const intersections = instancedRaycaster.intersectObjects(meshes, false)
      // 如果没有任何交点，则没有可用的实例候选
      if (!intersections.length) {
        return null
      }

      // 从交点中挑选第一个满足条件（可见、未锁定、未被过滤）的实例。
      // 注意：intersections 中的 hit 可能包含 `instanceId`（由 three.js 的实例拾取扩展提供）。
      for (const hit of intersections) {
        const mesh = hit.object as THREE.InstancedMesh
        const instanceId = (hit as any).instanceId as number | undefined
        // 如果 intersection 未包含 instanceId，跳过
        if (typeof instanceId !== 'number' || instanceId < 0) {
          continue
        }
        // 根据实例查找宿主节点 ID（modelObjectCache 提供的映射）
        const nodeId = findNodeIdForInstance(mesh, instanceId)
        if (!nodeId) {
          continue
        }
        // 过滤器：排除用户传入的 excludeNodeIds
        if (filters.excludeNodeIds?.has(nodeId)) {
          continue
        }
        // 可选包含集（若指定则必须包含）
        if (filters.includeNodeIds && !filters.includeNodeIds.has(nodeId)) {
          continue
        }
        // 节点可见性、锁定状态、目标对象的世界可见性检查
        if (!options.isNodeVisible(nodeId)) {
          continue
        }
        if (options.isNodeLocked?.(nodeId)) {
          continue
        }
        if (!options.isObjectWorldVisible(mesh)) {
          continue
        }

        // 首个满足条件的命中作为候选实例（不继续寻找更多 intersection）
        picked = { mesh, instanceId, nodeId }
        break
      }

      // 如果未选中任何实例，返回 null
      if (!picked) {
        return null
      }
    }

    // 现在我们有了一个目标 InstancedMesh + instanceId，需要把该实例的局部顶点
    // 变换到世界空间。流程：获取实例局部矩阵（getMatrixAt），与网格的 matrixWorld
    // 相乘得到实例的 world 矩阵，然后用该矩阵把每个顶点转换到世界坐标后再投影到屏幕。
    let best: (SnapTargetCandidate & {
      mesh: THREE.InstancedMesh
      instanceId: number
      vertexIndex: number
      localPosition: THREE.Vector3
      sourceWorld?: THREE.Vector3
      sourceMesh?: THREE.Mesh | THREE.InstancedMesh
      sourceInstanceId?: number | null
      sourceThresholdWorld?: number | null
    }) | null = null

    if (!usingSourceVertices && picked) {
      const instancedMesh = picked.mesh
      instancedMesh.updateMatrixWorld(true)
      instancedMesh.getMatrixAt(picked.instanceId, instancedMatrixHelper)
      instancedWorldHelper.multiplyMatrices(instancedMesh.matrixWorld, instancedMatrixHelper)

      // 从几何体读取 position attribute（顶点数组）
      const geometry = instancedMesh.geometry as THREE.BufferGeometry | undefined
      const position = geometry?.getAttribute('position') as THREE.BufferAttribute | undefined
      if (!position || position.itemSize < 3) {
        return null
      }

      // 遍历顶点，采用与普通网格相同的抽样策略以限制最大扫描数（MAX_VERTEX_SCAN）
      const stride = position.count > MAX_VERTEX_SCAN ? Math.ceil(position.count / MAX_VERTEX_SCAN) : 1
      for (let i = 0; i < position.count; i += stride) {
        // 读取顶点局部坐标
        vertexLocalHelper.fromBufferAttribute(position, i)
        // 将顶点从实例局部空间转换到实例世界空间（使用 instancedWorldHelper）
        instancedVertexWorldHelper.copy(vertexLocalHelper).applyMatrix4(instancedWorldHelper)
        // 将转换后的世界坐标投影到屏幕，若在视锥外则跳过
        if (!projectToScreen(instancedVertexWorldHelper, camera, rect, projectedHelper)) {
          continue
        }

        // 计算与指针的屏幕像素距离并进行阈值过滤
        const dx = projectedHelper.x - event.clientX
        const dy = projectedHelper.y - event.clientY
        const distance = Math.hypot(dx, dy)
        if (distance > threshold) {
          continue
        }

        // 记录最接近的顶点为最佳候选（基于屏幕距离）
        if (!best || distance < best.screenDistance) {
          best = {
            nodeId: picked.nodeId,
            worldPosition: instancedVertexWorldHelper.clone(),
            screenDistance: distance,
            mesh: instancedMesh,
            instanceId: picked.instanceId,
            vertexIndex: i,
            localPosition: vertexLocalHelper.clone(),
          }
        }
      }

      return best
    }

    // 世界距离模式：对所有 instanced meshes 与所有实例顶点进行扫描
    const sourceBounds = sourceSet?.bounds ?? null
    const maxThresholdWorld = sourceSet?.maxThresholdWorld ?? null
    for (const instancedMesh of meshes) {
      if (!instancedMesh.visible) {
        continue
      }
      if (!options.isObjectWorldVisible(instancedMesh)) {
        continue
      }

      instancedMesh.updateMatrixWorld(true)
      const geometry = instancedMesh.geometry as THREE.BufferGeometry | undefined
      const position = geometry?.getAttribute('position') as THREE.BufferAttribute | undefined
      if (!position || position.itemSize < 3) {
        continue
      }

      // 若存在源顶点包围盒与最大阈值，先基于几何体包围盒进行粗略剔除
      let geometryBounds: THREE.Box3 | null = null
      if (geometry) {
        geometryBounds = geometry.boundingBox ?? (geometry.computeBoundingBox(), geometry.boundingBox)
      }

      const instanceCount = instancedMesh.count
      if (!Number.isFinite(instanceCount) || instanceCount <= 0) {
        continue
      }

      const vertexStride = position.count > MAX_VERTEX_SCAN ? Math.ceil(position.count / MAX_VERTEX_SCAN) : 1
      for (let instanceId = 0; instanceId < instanceCount; instanceId += 1) {
        const nodeId = findNodeIdForInstance(instancedMesh, instanceId)
        if (!nodeId) {
          continue
        }
        if (filters.excludeNodeIds?.has(nodeId)) {
          continue
        }
        if (filters.includeNodeIds && !filters.includeNodeIds.has(nodeId)) {
          continue
        }
        if (!options.isNodeVisible(nodeId)) {
          continue
        }
        if (options.isNodeLocked?.(nodeId)) {
          continue
        }

        instancedMesh.getMatrixAt(instanceId, instancedMatrixHelper)
        instancedWorldHelper.multiplyMatrices(instancedMesh.matrixWorld, instancedMatrixHelper)

        if (sourceBounds && typeof maxThresholdWorld === 'number' && Number.isFinite(maxThresholdWorld) && geometryBounds) {
          placementTargetBoundsHelper.copy(geometryBounds)
          placementTargetBoundsHelper.applyMatrix4(instancedWorldHelper)
          placementExpandedBoundsHelper.copy(placementTargetBoundsHelper).expandByScalar(maxThresholdWorld)
          if (!placementExpandedBoundsHelper.intersectsBox(sourceBounds)) {
            continue
          }
        }

        placementVertexIndexSet.clear()
        if (sourceBounds && typeof maxThresholdWorld === 'number' && Number.isFinite(maxThresholdWorld) && geometry) {
          placementExpandedBoundsHelper.copy(sourceBounds).expandByScalar(maxThresholdWorld)
          placementInverseMatrixHelper.copy(instancedWorldHelper).invert()
          placementLocalBoundsHelper.copy(placementExpandedBoundsHelper).applyMatrix4(placementInverseMatrixHelper)
          collectCandidateVertexIndicesFromBvh(geometry, placementLocalBoundsHelper, placementVertexIndexSet)
        }

        if (placementVertexIndexSet.size > 0) {
          for (const i of placementVertexIndexSet) {
            if (i < 0 || i >= position.count) {
              continue
            }
            vertexLocalHelper.fromBufferAttribute(position, i)
            instancedVertexWorldHelper.copy(vertexLocalHelper).applyMatrix4(instancedWorldHelper)

            const nearest = sourceSet ? findNearestSourceVertex(instancedVertexWorldHelper, sourceSet, threshold) : null
            const bestSource = nearest?.source ?? null
            const bestDistance = nearest?.distance ?? Number.POSITIVE_INFINITY
            if (!bestSource || !Number.isFinite(bestDistance)) {
              continue
            }

            if (!best || bestDistance < best.screenDistance) {
              best = {
                nodeId,
                worldPosition: instancedVertexWorldHelper.clone(),
                screenDistance: bestDistance,
                mesh: instancedMesh,
                instanceId,
                vertexIndex: i,
                localPosition: vertexLocalHelper.clone(),
                sourceWorld: bestSource.worldPosition.clone(),
                sourceMesh: bestSource.mesh,
                sourceInstanceId: bestSource.instanceId,
                sourceThresholdWorld: bestSource.thresholdWorld,
              }
            }
          }
          continue
        }

        for (let i = 0; i < position.count; i += vertexStride) {
          vertexLocalHelper.fromBufferAttribute(position, i)
          instancedVertexWorldHelper.copy(vertexLocalHelper).applyMatrix4(instancedWorldHelper)

          const nearest = sourceSet ? findNearestSourceVertex(instancedVertexWorldHelper, sourceSet, threshold) : null
          const bestSource = nearest?.source ?? null
          const bestDistance = nearest?.distance ?? Number.POSITIVE_INFINITY

          if (!bestSource || !Number.isFinite(bestDistance)) {
            continue
          }

          if (!best || bestDistance < best.screenDistance) {
            best = {
              nodeId,
              worldPosition: instancedVertexWorldHelper.clone(),
              screenDistance: bestDistance,
              mesh: instancedMesh,
              instanceId,
              vertexIndex: i,
              localPosition: vertexLocalHelper.clone(),
              sourceWorld: bestSource.worldPosition.clone(),
              sourceMesh: bestSource.mesh,
              sourceInstanceId: bestSource.instanceId,
              sourceThresholdWorld: bestSource.thresholdWorld,
            }
          }
        }
      }
    }

    return best
  }

  const findHoverCandidate = (query: { event: MouseEvent; excludeNodeIds?: Set<string>; pixelThresholdPx?: number }): {
    nodeId: string
    mesh: THREE.Mesh | THREE.InstancedMesh
    instanceId: number | null
    localPosition: THREE.Vector3
    worldPosition: THREE.Vector3
  } | null => {
    const canvas = options.canvasRef.value
    const camera = options.camera.value
    if (!canvas || !camera) {
      return null
    }
    const threshold = typeof query.pixelThresholdPx === 'number' && Number.isFinite(query.pixelThresholdPx)
      ? query.pixelThresholdPx
      : pixelThreshold
    const exclude = query.excludeNodeIds ?? new Set<string>()
    const best = findNearestVertexInScene(query.event, canvas, camera, threshold, { excludeNodeIds: exclude })
    if (!best) {
      return null
    }
    return {
      nodeId: best.nodeId,
      mesh: best.mesh,
      instanceId: best.instanceId,
      localPosition: best.localPosition.clone(),
      worldPosition: best.worldPosition.clone(),
    }
  }

  return {
    update,
    reset,
    updatePlacementSideSnap,
    consumePlacementSideSnapResult,
    resetPlacementSideSnap,
    isNodeGeometryReady,
    findHoverCandidate,
    projectWorldToViewportPixels,
    unprojectViewportPixelsAtNdcZ,
  }
}
