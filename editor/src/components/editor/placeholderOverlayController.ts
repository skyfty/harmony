import { computed, reactive, ref } from 'vue'
import * as THREE from 'three'
import type { SceneNode } from '@harmony/schema'
import type { PlaceholderOverlayState } from '@/types/scene-viewport-placeholder-overlay-state'

export type PlaceholderOverlayControllerDeps = {
  getSceneNodes: () => SceneNode[]
  getCamera: () => THREE.Camera | null
  objectMap: Map<string, THREE.Object3D>
  getThumbnailUrl?: (node: SceneNode) => string | null
}

export function usePlaceholderOverlayController(deps: PlaceholderOverlayControllerDeps) {
  const overlayContainerRef = ref<HTMLDivElement | null>(null)
  const placeholderOverlays = reactive<Record<string, PlaceholderOverlayState>>({})
  const placeholderOverlayList = computed(() => Object.values(placeholderOverlays))
  const overlayPositionHelper = new THREE.Vector3()

  function refreshPlaceholderOverlays() {
    const activeIds = new Set<string>()

    const visit = (nodes: SceneNode[]) => {
      nodes.forEach((node) => {
        if (node.isPlaceholder) {
          activeIds.add(node.id)
          const progress = Math.min(100, Math.max(0, node.downloadProgress ?? 0))
          const error = node.downloadError ?? null
          const thumbnail = deps.getThumbnailUrl?.(node) ?? null
          const existing = placeholderOverlays[node.id]
          if (existing) {
            existing.name = node.name
            existing.thumbnail = thumbnail
            existing.progress = progress
            existing.error = error
          } else {
            placeholderOverlays[node.id] = {
              id: node.id,
              name: node.name,
              thumbnail,
              progress,
              error,
              visible: true,
              x: 0,
              y: 0,
            }
          }
        }

        if (node.children?.length) {
          visit(node.children)
        }
      })
    }

    visit(deps.getSceneNodes())

    Object.keys(placeholderOverlays).forEach((id) => {
      if (!activeIds.has(id)) {
        delete placeholderOverlays[id]
      }
    })
  }

  function clearPlaceholderOverlays() {
    Object.keys(placeholderOverlays).forEach((id) => {
      delete placeholderOverlays[id]
    })
  }

  function updatePlaceholderOverlayPositions() {
    const activeCamera = deps.getCamera()
    if (!activeCamera || !overlayContainerRef.value) {
      return
    }

    const bounds = overlayContainerRef.value.getBoundingClientRect()
    const width = bounds.width
    const height = bounds.height

    if (width === 0 || height === 0) {
      placeholderOverlayList.value.forEach((overlay) => {
        overlay.visible = false
      })
      return
    }

    placeholderOverlayList.value.forEach((overlay) => {
      const object = deps.objectMap.get(overlay.id)
      if (!object) {
        overlay.visible = false
        return
      }

      overlayPositionHelper.setFromMatrixPosition(object.matrixWorld)
      overlayPositionHelper.project(activeCamera)

      if (overlayPositionHelper.z < -1 || overlayPositionHelper.z > 1) {
        overlay.visible = false
        return
      }

      overlay.visible = true
      overlay.x = (overlayPositionHelper.x * 0.5 + 0.5) * width
      overlay.y = (-overlayPositionHelper.y * 0.5 + 0.5) * height
    })
  }

  return {
    overlayContainerRef,
    placeholderOverlayList,
    placeholderOverlays,
    refreshPlaceholderOverlays,
    clearPlaceholderOverlays,
    updatePlaceholderOverlayPositions,
  }
}
