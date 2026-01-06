import * as THREE from 'three'
import type { Ref } from 'vue'
import type { BuildTool } from '@/types/build-tool'
import type { SceneNodeComponentState, SceneNode } from '@harmony/schema'
import { WALL_COMPONENT_TYPE, type WallComponentProps } from '@schema/components'
import { createWallPreviewRenderer, type WallPreviewSession, type WallPreviewSegment } from './WallPreviewRenderer'
import { GRID_MAJOR_SPACING, WALL_DIAGONAL_SNAP_THRESHOLD } from './constants'
import { findSceneNode } from './sceneUtils'
import type { useSceneStore } from '@/stores/sceneStore'

export type WallBuildToolHandle = {
  getSession: () => WallBuildToolSession | null
  flushPreviewIfNeeded: (scene: THREE.Scene | null) => void
  flushPreview: (scene: THREE.Scene | null) => void
  handlePointerDown: (event: PointerEvent) => boolean
  handlePointerMove: (event: PointerEvent) => boolean
  handlePointerUp: (event: PointerEvent) => boolean
  handlePointerCancel: (event: PointerEvent) => boolean
  cancel: () => boolean
  dispose: () => void
}

export type WallBuildToolSession = WallPreviewSession & {
  bodyAssetId: string | null
  jointAssetId: string | null
}

export function createWallBuildTool(options: {
  activeBuildTool: Ref<BuildTool | null>
  sceneStore: ReturnType<typeof useSceneStore>
  rootGroup: THREE.Group
  raycastGroundPoint: (event: PointerEvent, result: THREE.Vector3) => boolean
  snapPoint: (point: THREE.Vector3) => THREE.Vector3
  isAltOverrideActive: () => boolean
  disableOrbitForWallBuild: () => void
  restoreOrbitAfterWallBuild: () => void
  normalizeWallDimensionsForViewport: (values: {
    height?: number
    width?: number
    thickness?: number
  }) => { height: number; width: number; thickness: number }
}) : WallBuildToolHandle {
  const previewRenderer = createWallPreviewRenderer({
    rootGroup: options.rootGroup,
    normalizeWallDimensionsForViewport: options.normalizeWallDimensionsForViewport,
  })

  const groundPointerHelper = new THREE.Vector3()

  let session: WallBuildToolSession | null = null

  const ensureSession = (): WallBuildToolSession => {
    if (session) {
      return session
    }
    session = {
      dragStart: null,
      dragEnd: null,
      segments: [],
      previewGroup: null,
      nodeId: null,
      dimensions: options.normalizeWallDimensionsForViewport({}),
      bodyAssetId: null,
      jointAssetId: null,
    }
    return session
  }

  const clearSession = (disposePreview = true) => {
    if (disposePreview) {
      previewRenderer.clear(session)
    } else if (session?.previewGroup) {
      session.previewGroup.removeFromParent()
    }
    session = null
    previewRenderer.reset()
  }

  const expandWallSegmentsToWorld = (node: SceneNode): WallPreviewSegment[] => {
    if (node.dynamicMesh?.type !== 'Wall') {
      return []
    }
    const origin = new THREE.Vector3(node.position.x, node.position.y, node.position.z)
    return node.dynamicMesh.segments.map((segment) => ({
      start: new THREE.Vector3(segment.start.x + origin.x, segment.start.y + origin.y, segment.start.z + origin.z),
      end: new THREE.Vector3(segment.end.x + origin.x, segment.end.y + origin.y, segment.end.z + origin.z),
    }))
  }

  const getWallNodeDimensions = (node: SceneNode): { height: number; width: number; thickness: number } => {
    if (node.dynamicMesh?.type !== 'Wall' || node.dynamicMesh.segments.length === 0) {
      return options.normalizeWallDimensionsForViewport({})
    }
    const sample = node.dynamicMesh.segments[0]!
    return options.normalizeWallDimensionsForViewport({
      height: sample.height,
      width: sample.width,
      thickness: sample.thickness,
    })
  }

  const constrainWallEndPoint = (start: THREE.Vector3, target: THREE.Vector3, rawTarget?: THREE.Vector3): THREE.Vector3 => {
    const delta = target.clone().sub(start)
    let stepX = Math.round(delta.x / GRID_MAJOR_SPACING)
    let stepZ = Math.round(delta.z / GRID_MAJOR_SPACING)

    if (stepX === 0 && stepZ === 0) {
      return start.clone()
    }

    const rawDelta = rawTarget ? rawTarget.clone().sub(start) : delta.clone()
    const absRawX = Math.abs(rawDelta.x)
    const absRawZ = Math.abs(rawDelta.z)

    if (absRawX > 1e-4 || absRawZ > 1e-4) {
      const angle = Math.atan2(absRawZ, absRawX)
      const diagonalAngle = Math.PI * 0.25
      if (!Number.isNaN(angle) && Math.abs(angle - diagonalAngle) <= WALL_DIAGONAL_SNAP_THRESHOLD) {
        const diagSteps = Math.max(Math.abs(stepX), Math.abs(stepZ), 1)
        const signX = rawDelta.x >= 0 ? 1 : -1
        const signZ = rawDelta.z >= 0 ? 1 : -1
        stepX = diagSteps * signX
        stepZ = diagSteps * signZ
      }
    }

    if (stepX !== 0 && stepZ !== 0 && Math.abs(stepX) !== Math.abs(stepZ)) {
      if (Math.abs(stepX) > Math.abs(stepZ)) {
        stepZ = 0
      } else {
        stepX = 0
      }
    }

    return new THREE.Vector3(
      start.x + stepX * GRID_MAJOR_SPACING,
      start.y,
      start.z + stepZ * GRID_MAJOR_SPACING,
    )
  }

  const hydrateFromSelection = (target: WallBuildToolSession) => {
    const isFreshSession = !target.nodeId && target.segments.length === 0
    if (isFreshSession) {
      const selectedId = options.sceneStore.selectedNodeId
      if (selectedId) {
        const selectedNode = findSceneNode(options.sceneStore.nodes, selectedId)
        if (selectedNode?.dynamicMesh?.type === 'Wall') {
          target.dimensions = getWallNodeDimensions(selectedNode)
          const wallComponent = selectedNode.components?.[WALL_COMPONENT_TYPE] as
            | SceneNodeComponentState<WallComponentProps>
            | undefined
          target.bodyAssetId = wallComponent?.props?.bodyAssetId ?? null
          target.jointAssetId = wallComponent?.props?.jointAssetId ?? null
        }
      }
      target.dimensions = options.normalizeWallDimensionsForViewport(target.dimensions)
      return
    }

    if (!target.nodeId) {
      const selectedId = options.sceneStore.selectedNodeId
      if (selectedId) {
        const selectedNode = findSceneNode(options.sceneStore.nodes, selectedId)
        if (selectedNode?.dynamicMesh?.type === 'Wall') {
          target.nodeId = selectedNode.id
          target.dimensions = getWallNodeDimensions(selectedNode)
          target.segments = expandWallSegmentsToWorld(selectedNode)
        }
      }
    } else {
      const node = findSceneNode(options.sceneStore.nodes, target.nodeId)
      if (node?.dynamicMesh?.type === 'Wall') {
        target.dimensions = getWallNodeDimensions(node)
        target.segments = expandWallSegmentsToWorld(node)
      }
    }

    target.dimensions = options.normalizeWallDimensionsForViewport(target.dimensions)
  }

  const beginSegmentDrag = (startPoint: THREE.Vector3) => {
    options.disableOrbitForWallBuild()
    const current = ensureSession()
    hydrateFromSelection(current)
    current.dragStart = startPoint.clone()
    current.dragEnd = startPoint.clone()
    previewRenderer.markDirty()
  }

  const cancelDrag = () => {
    if (!session) {
      return
    }
    session.dragStart = null
    session.dragEnd = null
    options.restoreOrbitAfterWallBuild()
    previewRenderer.markDirty()
  }

  const commitSegmentDrag = (): boolean => {
    if (!session || !session.dragStart || !session.dragEnd) {
      return false
    }

    const start = session.dragStart.clone()
    const end = session.dragEnd.clone()
    if (start.distanceToSquared(end) < 1e-6) {
      cancelDrag()
      return false
    }

    const segment: WallPreviewSegment = { start, end }
    const pendingSegments = [...session.segments, segment]

    const segmentPayload = pendingSegments.map((entry) => ({
      start: entry.start.clone(),
      end: entry.end.clone(),
    }))

    let nodeId = session.nodeId
    if (!nodeId) {
      const created = options.sceneStore.createWallNode({
        segments: segmentPayload,
        dimensions: session.dimensions,
        bodyAssetId: session.bodyAssetId,
        jointAssetId: session.jointAssetId,
      })
      if (!created) {
        cancelDrag()
        return false
      }
      nodeId = created.id
      session.nodeId = nodeId
      session.segments = pendingSegments
      session.dimensions = getWallNodeDimensions(created)
    } else {
      const updated = options.sceneStore.updateWallNodeGeometry(nodeId, {
        segments: segmentPayload,
        dimensions: session.dimensions,
      })
      if (!updated) {
        cancelDrag()
        return false
      }
      session.segments = pendingSegments
      const refreshed = findSceneNode(options.sceneStore.nodes, nodeId)
      if (refreshed?.dynamicMesh?.type === 'Wall') {
        session.dimensions = getWallNodeDimensions(refreshed)
      }
    }

    session.dragStart = end.clone()
    session.dragEnd = end.clone()
    session.dimensions = options.normalizeWallDimensionsForViewport(session.dimensions)
    previewRenderer.markDirty()
    return true
  }

  const handlePlacementClick = (event: PointerEvent): boolean => {
    if (options.activeBuildTool.value !== 'wall') {
      return false
    }
    if (options.isAltOverrideActive()) {
      return false
    }
    if (!options.raycastGroundPoint(event, groundPointerHelper)) {
      return false
    }

    const rawPointer = groundPointerHelper.clone()
    const snappedPoint = options.snapPoint(rawPointer.clone())

    const current = ensureSession()
    if (!current.dragStart) {
      beginSegmentDrag(snappedPoint)
      return true
    }

    const constrained = constrainWallEndPoint(current.dragStart, snappedPoint, rawPointer)
    const previous = current.dragEnd
    if (!previous || !previous.equals(constrained)) {
      current.dragEnd = constrained
      previewRenderer.markDirty()
    }

    const committed = commitSegmentDrag()
    if (!committed) {
      current.dragStart = constrained.clone()
      current.dragEnd = constrained.clone()
      previewRenderer.markDirty()
    }

    return true
  }

  const updateSegmentDrag = (event: PointerEvent) => {
    if (options.isAltOverrideActive()) {
      return
    }
    if (!session?.dragStart) {
      return
    }
    if (!options.raycastGroundPoint(event, groundPointerHelper)) {
      return
    }

    const rawPointer = groundPointerHelper.clone()
    const pointer = options.snapPoint(rawPointer.clone())
    const constrained = constrainWallEndPoint(session.dragStart, pointer, rawPointer)
    const previous = session.dragEnd
    if (previous && previous.equals(constrained)) {
      return
    }
    session.dragEnd = constrained
    previewRenderer.markDirty()
  }

  const finalize = () => {
    if (!session) {
      return
    }
    cancelDrag()
    clearSession(true)
    options.restoreOrbitAfterWallBuild()
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
      if (options.activeBuildTool.value !== 'wall') {
        return false
      }

      // Block middle-button camera panning while in wall build mode.
      if (event.button === 1 && !options.isAltOverrideActive()) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return true
      }

      return false
    },

    handlePointerMove: (event: PointerEvent) => {
      if (options.activeBuildTool.value !== 'wall') {
        return false
      }

      if (session?.dragStart) {
        const isRightButtonActive = (event.buttons & 2) !== 0
        if (!isRightButtonActive) {
          updateSegmentDrag(event)
          return true
        }
      }

      return false
    },

    handlePointerUp: (event: PointerEvent) => {
      if (options.activeBuildTool.value !== 'wall') {
        return false
      }

      if (event.button === 1) {
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
        if (session) {
          finalize()
          event.preventDefault()
          event.stopPropagation()
          event.stopImmediatePropagation()
          return true
        }
        return false
      }

      return false
    },

    handlePointerCancel: (event: PointerEvent) => {
      if (options.activeBuildTool.value !== 'wall') {
        return false
      }
      if (!session) {
        return false
      }
      cancelDrag()
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return true
    },

    cancel: () => {
      if (!session) {
        return false
      }
      cancelDrag()
      clearSession(true)
      options.restoreOrbitAfterWallBuild()
      return true
    },

    dispose: () => {
      previewRenderer.dispose(session)
      clearSession(false)
    },
  }
}
