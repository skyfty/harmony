import type * as THREE from 'three'
import type { SceneNode } from '@harmony/schema'
import type { PointerUpResult } from './types'
import type { PointerTrackingState } from '@/types/scene-viewport-pointer-tracking-state'

export function handlePointerUpSelection(
  event: PointerEvent,
  ctx: {
    pointerTrackingState: PointerTrackingState | null
    clearPointerTrackingState: () => void
    pointerInteractionReleaseIfCaptured: (pointerId: number) => void

    transformControlsDragging: boolean

    restoreOrbitAfterSelectDrag: () => void
    updateGridHighlightFromObject: (object: THREE.Object3D) => void
    commitSelectionDragTransforms: (drag: any) => void
    sceneStoreEndTransformInteraction: () => void
    updateSelectionHighlights: () => void

    activeTool: string
    rotateActiveSelection: (primaryId: string) => void

    sceneSelectedNodeId: string | null
    selectedNodeIdProp: string | null
    sceneStoreIsNodeSelectionLocked: (nodeId: string) => boolean
    sceneStoreIsDescendant: (ancestorId: string, nodeId: string) => boolean
    findSceneNode: (nodes: SceneNode[], nodeId: string) => SceneNode | null
    sceneNodes: SceneNode[]

    pickNodeAtPointer: (event: PointerEvent) => any | null
    pickActiveSelectionBoundingBoxHit: (event: PointerEvent) => any | null

    handleClickSelection: (
      event: PointerEvent,
      trackingState: PointerTrackingState,
      options: { allowDeselectOnReselect: boolean },
    ) => void
  },
): PointerUpResult | null {
  if (!ctx.pointerTrackingState || event.pointerId !== ctx.pointerTrackingState.pointerId) {
    return null
  }

  const trackingState = ctx.pointerTrackingState
  ctx.clearPointerTrackingState()
  ctx.pointerInteractionReleaseIfCaptured(event.pointerId)

  if (ctx.transformControlsDragging) {
    return { handled: true }
  }

  const drag = trackingState.selectionDrag
  if (drag) {
    ctx.restoreOrbitAfterSelectDrag()
    ctx.updateGridHighlightFromObject(drag.object)
    if (drag.hasDragged) {
      ctx.commitSelectionDragTransforms(drag)
      ctx.sceneStoreEndTransformInteraction()
      ctx.updateSelectionHighlights()
      return { handled: true }
    }
  }

  if (trackingState.button === 2) {
    if (!trackingState.moved) {
      if (ctx.activeTool === 'select') {
        const primaryId = ctx.sceneSelectedNodeId ?? ctx.selectedNodeIdProp ?? null
        if (primaryId && !ctx.sceneStoreIsNodeSelectionLocked(primaryId)) {
          let hit = ctx.pickNodeAtPointer(event) ?? trackingState.hitResult
          if (!hit) {
            hit = ctx.pickActiveSelectionBoundingBoxHit(event)
          }

          const primaryNode = ctx.findSceneNode(ctx.sceneNodes, primaryId)
          const hitMatchesPrimary = Boolean(
            hit &&
              (hit.nodeId === primaryId ||
                (primaryNode?.nodeType === 'Group' && ctx.sceneStoreIsDescendant(primaryId, hit.nodeId))),
          )

          if (hitMatchesPrimary) {
            ctx.rotateActiveSelection(primaryId)
            return {
              handled: true,
              preventDefault: true,
              stopPropagation: true,
            }
          }
        }
      }

      return {
        handled: true,
        preventDefault: true,
        stopPropagation: true,
      }
    }
    return { handled: true }
  }

  if (trackingState.button !== 0) {
    return { handled: true }
  }

  if (trackingState.moved) {
    return { handled: true }
  }

  if (ctx.activeTool !== 'select' && trackingState.transformAxis) {
    return { handled: true }
  }

  ctx.handleClickSelection(event, trackingState, {
    allowDeselectOnReselect: ctx.activeTool === 'select',
  })

  return { handled: true }
}
