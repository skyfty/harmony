import * as THREE from 'three'
import type { Ref } from 'vue'
import type { BuildTool } from '@/types/build-tool'
import type { Vector3Like } from '@harmony/schema'
import { createFloorPreviewRenderer, type FloorPreviewSession } from './FloorPreviewRenderer'
import type { useSceneStore } from '@/stores/sceneStore'

export type FloorBuildToolHandle = {
  getSession: () => FloorPreviewSession | null
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

export function createFloorBuildTool(options: {
  activeBuildTool: Ref<BuildTool | null>
  sceneStore: ReturnType<typeof useSceneStore>
  rootGroup: THREE.Group
  raycastGroundPoint: (event: PointerEvent, result: THREE.Vector3) => boolean
  snapPoint: (point: THREE.Vector3) => THREE.Vector3
  isAltOverrideActive: () => boolean
  clickDragThresholdPx: number
}): FloorBuildToolHandle {
  const previewRenderer = createFloorPreviewRenderer({ rootGroup: options.rootGroup })

  const groundPointerHelper = new THREE.Vector3()

  let session: FloorPreviewSession | null = null
  let rightClickState: RightClickState | null = null

  const ensureSession = (): FloorPreviewSession => {
    if (session) {
      return session
    }
    session = {
      points: [],
      previewEnd: null,
      previewGroup: null,
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
    rightClickState = null
    previewRenderer.reset()
  }

  const updateCursorPreview = (event: PointerEvent) => {
    if (!session || session.points.length === 0) {
      return
    }
    if (options.isAltOverrideActive()) {
      return
    }
    if (!options.raycastGroundPoint(event, groundPointerHelper)) {
      return
    }

    const raw = groundPointerHelper.clone()
    raw.y = 0
    const snapped = options.snapPoint(raw)
    const previous = session.previewEnd
    if (previous && previous.equals(snapped)) {
      return
    }

    session.previewEnd = snapped
    previewRenderer.markDirty()
  }

  const handlePlacementClick = (event: PointerEvent): boolean => {
    if (options.activeBuildTool.value !== 'floor') {
      return false
    }
    if (options.isAltOverrideActive()) {
      return false
    }
    if (!options.raycastGroundPoint(event, groundPointerHelper)) {
      return false
    }

    const raw = groundPointerHelper.clone()
    raw.y = 0
    const point = options.snapPoint(raw)

    const current = ensureSession()
    if (current.points.length > 0) {
      const last = current.points[current.points.length - 1]!
      if (last.distanceToSquared(point) <= 1e-6) {
        current.previewEnd = point.clone()
        previewRenderer.markDirty()
        return true
      }
    }

    current.points.push(point.clone())
    current.previewEnd = point.clone()
    previewRenderer.markDirty()
    return true
  }

  const finalize = () => {
    if (!session) {
      return
    }

    const points = session.points
    if (points.length < 3) {
      clearSession(true)
      return
    }

    const created = options.sceneStore.createFloorNode({
      points: points.map((p) => ({ x: p.x, y: 0, z: p.z }) satisfies Vector3Like),
    })

    if (created) {
      options.sceneStore.selectNode(created.id)
    }

    clearSession(true)
  }

  return {
    getSession: () => session,

    flushPreviewIfNeeded: (scene: THREE.Scene | null) => {
      previewRenderer.flushIfNeeded(scene, session)
    },

    handlePointerDown: (event: PointerEvent) => {
      if (options.activeBuildTool.value !== 'floor') {
        return false
      }

      // Block middle-button camera panning while in floor build mode.
      if (event.button === 1 && !options.isAltOverrideActive()) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return true
      }

      // Right click ends the build only if it's a click (not a drag used for rotating the camera).
      if (event.button === 2 && session) {
        rightClickState = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
        }
      }

      return false
    },

    handlePointerMove: (event: PointerEvent) => {
      if (rightClickState && event.pointerId === rightClickState.pointerId && !rightClickState.moved) {
        const dx = event.clientX - rightClickState.startX
        const dy = event.clientY - rightClickState.startY
        if (Math.hypot(dx, dy) >= options.clickDragThresholdPx) {
          rightClickState.moved = true
        }
      }

      if (options.activeBuildTool.value !== 'floor') {
        return false
      }

      if (session && session.points.length > 0) {
        const isRightButtonActive = (event.buttons & 2) !== 0
        if (!isRightButtonActive) {
          updateCursorPreview(event)
          return true
        }
      }

      return false
    },

    handlePointerUp: (event: PointerEvent) => {
      if (options.activeBuildTool.value !== 'floor') {
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
        if (rightClickState && rightClickState.pointerId === event.pointerId) {
          const clickWasDrag = rightClickState.moved
          rightClickState = null
          if (!clickWasDrag && session) {
            finalize()
            return true
          }
        }
        return false
      }

      return false
    },

    handlePointerCancel: (_event: PointerEvent) => {
      if (options.activeBuildTool.value !== 'floor') {
        return false
      }
      if (!session) {
        return false
      }
      clearSession(true)
      return true
    },

    cancel: () => {
      if (!session) {
        return false
      }
      clearSession(true)
      return true
    },

    dispose: () => {
      previewRenderer.dispose(session)
      clearSession(false)
    },
  }
}
