import * as THREE from 'three'
import type { Ref } from 'vue'
import type { BuildTool } from '@/types/build-tool'
import type { GuideRouteDynamicMesh, Vector3Like } from '@schema/core'
import type { useSceneStore } from '@/stores/sceneStore'
import {
  createGuideRouteGroup,
  GUIDE_ROUTE_EDITOR_RENDER_OPTIONS,
  updateGuideRouteGroup,
} from '@schema/guideRouteMesh'

export type GuideRouteBuildToolSession = {
  points: THREE.Vector3[]
  previewEnd: THREE.Vector3 | null
  previewGroup: THREE.Group | null
  surfaceProviderNodeId: string | null
}

export type GuideRouteBuildToolHandle = {
  getSession: () => GuideRouteBuildToolSession | null
  flushPreviewIfNeeded: (scene: THREE.Scene | null) => void
  handlePointerDown: (event: PointerEvent) => boolean
  handlePointerMove: (event: PointerEvent) => boolean
  handlePointerUp: (event: PointerEvent) => boolean
  handlePointerCancel: (event: PointerEvent) => boolean
  cancel: () => boolean
  dispose: () => void
}

type RightClickState = {
  pointerId: number
  startX: number
  startY: number
  moved: boolean
}

type LeftClickState = {
  atMs: number
  clientX: number
  clientY: number
}

type BuildSurfacePlacementPoint = {
  point: THREE.Vector3
  nodeId: string | null
}

const DOUBLE_CLICK_MAX_INTERVAL_MS = 320
const DOUBLE_CLICK_MAX_DISTANCE_PX = 8
const PREVIEW_Y_OFFSET = 0.04

function getNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}

function createPreviewDefinition(points: THREE.Vector3[]): GuideRouteDynamicMesh {
  return {
    type: 'GuideRoute',
    vertices: points.map((point) => ({ x: point.x, y: point.y, z: point.z })),
  }
}

function createPreviewGroup(points: THREE.Vector3[]): THREE.Group {
  const group = createGuideRouteGroup(
    createPreviewDefinition(points),
    GUIDE_ROUTE_EDITOR_RENDER_OPTIONS,
  )
  group.name = '__GuideRoutePreview'
  group.userData.isGuideRoutePreview = true
  return group
}

function updatePreviewGroup(group: THREE.Group, points: THREE.Vector3[]): void {
  updateGuideRouteGroup(
    group,
    createPreviewDefinition(points),
    GUIDE_ROUTE_EDITOR_RENDER_OPTIONS,
  )
  group.userData.isGuideRoutePreview = true
}

function disposePreviewGroup(group: THREE.Group): void {
  group.traverse((child) => {
    const drawable = child as THREE.Line | THREE.Mesh
    drawable.geometry?.dispose?.()
    const material = drawable.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(material)) {
      material.forEach((entry) => entry?.dispose?.())
    } else {
      material?.dispose?.()
    }
  })
}

export function createGuideRouteBuildTool(options: {
  activeBuildTool: Ref<BuildTool | null>
  sceneStore: ReturnType<typeof useSceneStore>
  rootGroup: THREE.Group
  resolveRouteSurfacePlacementPoint?: (
    event: PointerEvent,
    options?: { surfaceProviderNodeId?: string | null },
  ) => (BuildSurfacePlacementPoint & { surfaceProviderNodeId: string }) | null
  snapPoint: (point: THREE.Vector3) => THREE.Vector3
  resolveVertexSnapPoint?: (event: PointerEvent, point: THREE.Vector3, options?: { excludeNodeIds?: readonly string[]; keepSourceY?: boolean }) => THREE.Vector3 | null
  clearVertexSnap?: () => void
  isAltOverrideActive: () => boolean
  showStartIndicator?: (point: THREE.Vector3, options?: { height?: number | null }) => void
  hideStartIndicator?: () => void
  holdStartIndicatorUntilNodeVisible?: (options: { nodeId: string; point: THREE.Vector3; height?: number | null }) => void
  clickDragThresholdPx: number
}): GuideRouteBuildToolHandle {
  let session: GuideRouteBuildToolSession | null = null
  let previewDirty = false
  let rightClickState: RightClickState | null = null
  let leftClickState: LeftClickState | null = null

  const resolveRoutePlacementPoint = (
    event: PointerEvent,
  ): (BuildSurfacePlacementPoint & { surfaceProviderNodeId: string }) | null => {
    const directRoutePlacement = options.resolveRouteSurfacePlacementPoint?.(event, {
      surfaceProviderNodeId: session?.surfaceProviderNodeId ?? null,
    })
    if (directRoutePlacement) {
      if (session?.surfaceProviderNodeId && session.surfaceProviderNodeId !== directRoutePlacement.surfaceProviderNodeId) {
        return null
      }
      return {
        point: directRoutePlacement.point.clone(),
        nodeId: directRoutePlacement.surfaceProviderNodeId,
        surfaceProviderNodeId: directRoutePlacement.surfaceProviderNodeId,
      }
    }
    return null
  }

  const resolvePlacementPoint = (event: PointerEvent, rawPoint: THREE.Vector3): THREE.Vector3 => {
    const snapped = options.resolveVertexSnapPoint?.(event, rawPoint, { keepSourceY: false })
    if (snapped) {
      return snapped.clone()
    }
    return options.snapPoint(rawPoint.clone())
  }

  const ensureSession = (): GuideRouteBuildToolSession => {
    if (session) {
      return session
    }
    session = {
      points: [],
      previewEnd: null,
      previewGroup: null,
      surfaceProviderNodeId: null,
    }
    return session
  }

  const clearSession = () => {
    if (session?.previewGroup) {
      session.previewGroup.removeFromParent()
      disposePreviewGroup(session.previewGroup)
    }
    session = null
    previewDirty = false
    rightClickState = null
    options.hideStartIndicator?.()
    options.clearVertexSnap?.()
  }

  const getPreviewPoints = (target: GuideRouteBuildToolSession | null): THREE.Vector3[] => {
    if (!target) {
      return []
    }
    const combined = target.points.map((point) => point.clone())
    if (target.previewEnd) {
      const last = combined[combined.length - 1] ?? null
      if (!last || last.distanceToSquared(target.previewEnd) > 1e-10) {
        combined.push(target.previewEnd.clone())
      }
    }
    return combined.map((point) => new THREE.Vector3(point.x, point.y + PREVIEW_Y_OFFSET, point.z))
  }

  const flushPreview = (_scene: THREE.Scene | null) => {
    previewDirty = false
    const previewPoints = getPreviewPoints(session)
    if (previewPoints.length < 2) {
      if (session?.previewGroup) {
        session.previewGroup.removeFromParent()
        disposePreviewGroup(session.previewGroup)
        session.previewGroup = null
      }
      return
    }
    if (!session) {
      return
    }
    if (!session.previewGroup) {
      const group = createPreviewGroup(previewPoints)
      session.previewGroup = group
      options.rootGroup.add(group)
      return
    }
    updatePreviewGroup(session.previewGroup, previewPoints)
  }

  const isLeftDoubleClick = (event: PointerEvent): boolean => {
    if (event.button !== 0) {
      return false
    }
    const now = Number.isFinite(event.timeStamp) ? Number(event.timeStamp) : getNowMs()
    const previous = leftClickState
    leftClickState = { atMs: now, clientX: event.clientX, clientY: event.clientY }
    if (!previous) {
      return false
    }
    const dt = now - previous.atMs
    if (dt < 0 || dt > DOUBLE_CLICK_MAX_INTERVAL_MS) {
      return false
    }
    return Math.hypot(event.clientX - previous.clientX, event.clientY - previous.clientY) <= DOUBLE_CLICK_MAX_DISTANCE_PX
  }

  const updateCursorPreview = (event: PointerEvent) => {
    if (!session || !session.points.length || options.isAltOverrideActive()) {
      return
    }
    const surfacePlacement = resolveRoutePlacementPoint(event)
    if (!surfacePlacement) {
      return
    }
    const point = resolvePlacementPoint(event, surfacePlacement.point.clone())
    const previous = session.previewEnd
    if (previous && previous.equals(point)) {
      return
    }
    session.previewEnd = point.clone()
    previewDirty = true
  }

  const updateStartIndicator = (event: PointerEvent) => {
    const isCameraNavActive = (event.buttons & 2) !== 0 || (event.buttons & 4) !== 0
    if (isCameraNavActive || options.isAltOverrideActive()) {
      options.hideStartIndicator?.()
      return
    }
    if (session?.points.length) {
      options.showStartIndicator?.(session.points[0]!, { height: 0.2 })
      return
    }
    const surfacePlacement = resolveRoutePlacementPoint(event)
    if (!surfacePlacement) {
      options.hideStartIndicator?.()
      return
    }
    options.showStartIndicator?.(resolvePlacementPoint(event, surfacePlacement.point.clone()), { height: 0.2 })
  }

  const finalize = () => {
    if (!session || session.points.length < 2) {
      clearSession()
      return
    }
    const created = options.sceneStore.createGuideRouteNode({
      points: session.points.map((point) => ({ x: point.x, y: point.y, z: point.z }) satisfies Vector3Like),
      surfaceProviderNodeId: session.surfaceProviderNodeId,
      travelMode: 'vehicle',
      editorFlags: { runtimeHiddenInPreview: false, editorOnly: true },
    })
    const startPoint = session.points[0]?.clone() ?? null
    clearSession()
    if (created) {
      options.sceneStore.selectNode(created.id)
      if (startPoint) {
        options.holdStartIndicatorUntilNodeVisible?.({ nodeId: created.id, point: startPoint, height: 0.2 })
      }
    }
  }

  return {
    getSession: () => session,
    flushPreviewIfNeeded: (scene) => {
      if (!previewDirty) {
        return
      }
      flushPreview(scene)
    },
    handlePointerDown: (event) => {
      if (options.activeBuildTool.value !== 'guideRoute') {
        return false
      }
      if (event.button === 2 && session) {
        rightClickState = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false }
      }
      return false
    },
    handlePointerMove: (event) => {
      if (rightClickState && event.pointerId === rightClickState.pointerId && !rightClickState.moved) {
        if (Math.hypot(event.clientX - rightClickState.startX, event.clientY - rightClickState.startY) >= options.clickDragThresholdPx) {
          rightClickState.moved = true
        }
      }
      if (options.activeBuildTool.value !== 'guideRoute') {
        return false
      }
      // Route drawing is click-based. While any mouse button is held, the
      // viewport gesture owns the pointer; skip expensive surface sampling.
      const isPointerGestureActive = event.buttons !== 0 || options.isAltOverrideActive()
      if (isPointerGestureActive) {
        options.hideStartIndicator?.()
        return false
      }
      updateStartIndicator(event)
      if (session?.points.length) {
        updateCursorPreview(event)
        return true
      }
      return false
    },
    handlePointerUp: (event) => {
      if (options.activeBuildTool.value !== 'guideRoute') {
        return false
      }
      if (event.button === 0) {
        if (options.isAltOverrideActive()) {
          return false
        }
        const surfacePlacement = resolveRoutePlacementPoint(event)
        if (!surfacePlacement) {
          return false
        }
        const current = ensureSession()
        current.surfaceProviderNodeId ??= surfacePlacement.surfaceProviderNodeId
        const point = resolvePlacementPoint(event, surfacePlacement.point.clone())
        const last = current.points[current.points.length - 1] ?? null
        if (!last || last.distanceToSquared(point) > 1e-6) {
          current.points.push(point.clone())
        }
        current.previewEnd = point.clone()
        previewDirty = true
        if (isLeftDoubleClick(event) && current.points.length >= 2) {
          finalize()
        }
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return true
      }
      if (event.button === 2 && rightClickState && rightClickState.pointerId === event.pointerId) {
        const clickWasDrag = rightClickState.moved
        rightClickState = null
        if (!clickWasDrag && session) {
          clearSession()
          return true
        }
      }
      return false
    },
    handlePointerCancel: (event) => {
      if (rightClickState?.pointerId === event.pointerId) {
        rightClickState = null
      }
      if (options.activeBuildTool.value !== 'guideRoute') {
        return false
      }
      if (!session) {
        return false
      }
      clearSession()
      return true
    },
    cancel: () => {
      if (!session) {
        return false
      }
      clearSession()
      return true
    },
    dispose: () => {
      clearSession()
      leftClickState = null
    },
  }
}
